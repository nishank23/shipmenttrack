import { load } from 'cheerio'

/**
 * Every extractor returns the same normalized shape:
 * {
 *   source: 'MSC' | 'ONE' | ...,
 *   trackingNumber: string,
 *   eta: Date | null,
 *   events: Array<{
 *     id: string,
 *     title: string,
 *     description: string,
 *     location: string,
 *     container: string,
 *     occurredAt: Date | null,
 *   }>,
 * }
 */
const carrierExtractors = {
  MSC: extractMscTracking,
  ONE: extractOneTracking,
  EVERGREEN: extractEvergreenTracking,
  PIL: extractPilTracking,
  CMA_CGM: extractCmaCgmTracking,
}

export function extractTrackingPayload({ carrier, payload, blNo }) {
  const normalizedCarrier = normalizeString(carrier).toUpperCase()
  const extractor = carrierExtractors[normalizedCarrier] || extractUnknownTracking

  return extractor(payload, blNo)
}

function buildResult(source, blNo, eta = null, events = []) {
  return {
    source,
    trackingNumber: blNo,
    eta,
    events: sortEvents(dedupeEvents(events)),
  }
}

function buildEvent({ id, title, description, location, container, occurredAt }) {
  return {
    id: normalizeString(id),
    title: normalizeString(title) || 'Status update',
    description: normalizeString(description),
    location: normalizeString(location),
    container: normalizeString(container),
    occurredAt: parseDateCandidate(occurredAt),
  }
}

function extractUnknownTracking(payload, blNo) {
  const normalizedPayload = parsePotentialJson(payload)

  if (isHtmlPayload(normalizedPayload)) {
    const $ = load(normalizedPayload)
    return buildResult('UNKNOWN', blNo, extractEtaFromHtml($), extractEventsFromHtml($))
  }

  return buildResult(
    'UNKNOWN',
    blNo,
    extractEtaFromObject(normalizedPayload),
    extractEventsFromObject(normalizedPayload),
  )
}

/* ------------------------------------------------------------------ */
/* MSC                                                                 */
/* ------------------------------------------------------------------ */

function extractMscTracking(payload, blNo) {
  const normalizedPayload = parsePotentialJson(payload)

  if (normalizedPayload?.IsSuccess === false) {
    throw new Error(`MSC tracking failed for ${blNo}`)
  }

  const data = normalizedPayload?.Data || normalizedPayload
  const billOfLading = findMatchingBillOfLading(data?.BillOfLadings, blNo)

  if (!billOfLading) {
    return buildResult('MSC', blNo)
  }

  const containers = Array.isArray(billOfLading?.ContainersInfo)
    ? billOfLading.ContainersInfo
    : []

  const eta = firstNormalizedDate([
    billOfLading?.GeneralTrackingInfo?.FinalPodEtaDate,
    ...containers.map((container) => container?.PodEtaDate),
  ])

  const events = containers.flatMap((container) => {
    const containerNo = normalizeString(container?.ContainerNumber)
    const containerEvents = Array.isArray(container?.Events) ? container.Events : []

    return containerEvents.map((event, index) => {
      const detail = Array.isArray(event?.Detail)
        ? event.Detail.filter(Boolean).join(' · ')
        : event?.Detail

      return buildEvent({
        id: `msc-${containerNo}-${event?.Order ?? index}`,
        title: event?.Description,
        description: detail,
        location: event?.Location,
        container: containerNo,
        occurredAt: event?.Date,
      })
    })
  })

  return buildResult('MSC', blNo, eta, events)
}

function findMatchingBillOfLading(billOfLadings, blNo) {
  const items = Array.isArray(billOfLadings) ? billOfLadings : []
  const normalizedBlNo = normalizeString(blNo).toUpperCase()

  return (
    items.find(
      (item) =>
        normalizeString(item?.BillOfLadingNumber).toUpperCase() === normalizedBlNo,
    ) || items[0] || null
  )
}

/* ------------------------------------------------------------------ */
/* ONE                                                                 */
/* ------------------------------------------------------------------ */

function extractOneTracking(payload, blNo) {
  const normalizedPayload = parsePotentialJson(payload)

  /**
   * ONE response format:
   * {
   *   status: 200,
   *   code: 1,
   *   data: [ { containerNo, cargoEvents: [...] }, ... ]
   * }
   */
  const containers = Array.isArray(normalizedPayload?.data)
    ? normalizedPayload.data
    : []

  if (!containers.length) {
    return buildResult('ONE', blNo)
  }

  const allEvents = containers.flatMap((container) =>
    (Array.isArray(container?.cargoEvents) ? container.cargoEvents : []).map(
      (event) => ({ event, containerNo: container?.containerNo }),
    ),
  )

  /**
   * ETA Priority:
   *
   * E105 = Final arrival / destination arrival
   * E089 = Before arrival fallback
   *
   * Prefer the earliest matching arrival date.
   */
  const etaCandidates = allEvents
    .filter(({ event }) => event?.matrixId === 'E105' || event?.matrixId === 'E089')
    .map(({ event }) => parseDateCandidate(event?.date || event?.localPortDate))
    .filter(Boolean)
    .sort((a, b) => a.getTime() - b.getTime())

  const events = allEvents.map(({ event, containerNo }, index) =>
    buildEvent({
      id: `one-${containerNo || 'bl'}-${event?.matrixId || 'event'}-${index}`,
      title:
        event?.eventName ||
        event?.eventDescription ||
        event?.statusName ||
        event?.description ||
        event?.matrixId,
      description: [event?.vesselName, event?.trigger].filter(Boolean).join(' · '),
      location: event?.locationName,
      container: containerNo,
      occurredAt: event?.date || event?.localPortDate,
    }),
  )

  return buildResult('ONE', blNo, etaCandidates[0] || null, events)
}

/* ------------------------------------------------------------------ */
/* Evergreen (HTML)                                                    */
/* ------------------------------------------------------------------ */

export function extractEvergreenTracking(html, blNo) {
  const $ = load(String(html || ''))

  return buildResult(
    'EVERGREEN',
    blNo,
    parseDateCandidate(extractEvergreenEta($)),
    extractEventsFromHtml($, 'evergreen'),
  )
}

export function extractEvergreenEta($) {
  try {
    const etaText = $('td.ec-fs-16b')
      .filter((_, el) =>
        $(el).text().includes('Estimated Date of Arrival at Destination')
      )
      .find('font')
      .text()
      .trim();

    return etaText || null;
  } catch (error) {
    console.error('Evergreen ETA extraction failed:', error);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* PIL (JSON wrapping HTML)                                            */
/* ------------------------------------------------------------------ */

function extractPilTracking(payload, blNo) {
  const normalizedPayload = parsePotentialJson(payload)

  /**
   * PIL response format:
   * {
   *   success: true,
   *   data: "<html string>"
   * }
   */

  const html = normalizedPayload?.data || ''

  if (!html || typeof html !== 'string') {
    return buildResult('PIL', blNo)
  }

  const $ = load(html)

  let eta = null
  const events = []

  /**
   * We want:
   * Discharge Port row
   *
   * Example:
   * <td class="location">
   *   Discharge Port
   *   SINGAPORE
   *   SGSIN
   * </td>
   *
   * next-location contains:
   * MZMPM
   * 03-May-2026   ← ETA we want
   */

  $('tr.resultrow').each((index, row) => {
    const locationText = cleanText($(row).find('.location').text())

    if (locationText.includes('Discharge Port')) {
      const nextLocationText = cleanText($(row).find('.next-location').text())

      /**
       * Example:
       * "MZMPM 03-May-2026"
       */

      const dateMatch = nextLocationText.match(/\d{2}-[A-Za-z]{3}-\d{4}/)

      if (dateMatch?.[0]) {
        eta = parseDateCandidate(dateMatch[0])
      }

      events.push(
        buildEvent({
          id: `pil-discharge-${index}`,
          title: 'Discharge Port',
          description: nextLocationText,
          location: locationText.replace('Discharge Port', ''),
          occurredAt: eta,
        }),
      )
    }
  })

  return buildResult('PIL', blNo, eta, events)
}

export function extractPilContainers(payload) {
  const normalizedPayload = parsePotentialJson(payload)
  const html = normalizedPayload?.data || ''

  if (!html || typeof html !== 'string') return []

  const $ = load(html)
  const containers = new Set()

  $('.next-location').each((_, el) => {
    const match = cleanText($(el).text()).match(/[A-Z]{4}\d{7}/)

    if (match) {
      containers.add(match[0])
    }
  })

  return [...containers]
}

export function extractPilContainerTracking(payload, blNo, cntrNo) {
  const normalizedPayload = parsePotentialJson(payload)
  const html = normalizedPayload?.data || ''

  if (!html || typeof html !== 'string') {
    return buildResult('PIL', blNo)
  }

  const $ = load(html)

  let eta = null
  const events = []

  $('tr.bg-lightblue').each((index, row) => {
    const cells = $(row).find('td')

    if (cells.length < 6) return

    const eventDate = $(cells[3]).text().replace(/\*/g, '').trim()
    const eventName = $(cells[4]).text().trim()
    const location = $(cells[5]).text().trim()

    if (!eventName) return

    const parsedDate =
      eventDate !== 'Information Not Available'
        ? parseDateCandidate(eventDate)
        : null

    events.push(
      buildEvent({
        id: `pil-${cntrNo}-${index}`,
        title: eventName,
        location,
        container: cntrNo,
        occurredAt: parsedDate,
      }),
    )

    if (eventName === 'Vessel Discharge' && parsedDate) {
      eta = parsedDate
    }
  })

  return buildResult('PIL', blNo, eta, events)
}

/**
 * Combine per-container results into one B/L-level result.
 * B/L ETA = latest container discharge (shipment is complete when the last box lands).
 */
export function mergeTrackingResults(source, blNo, results) {
  const etas = results.map((result) => result?.eta).filter(Boolean)
  const eta = etas.length
    ? new Date(Math.max(...etas.map((date) => date.getTime())))
    : null

  return buildResult(
    source,
    blNo,
    eta,
    results.flatMap((result) => result?.events || []),
  )
}

/* ------------------------------------------------------------------ */
/* CMA CGM (rendered HTML from Lightpanda)                             */
/* ------------------------------------------------------------------ */

export function isCmaCgmBlockedPage(html) {
  return /captcha-delivery|datadome|Access denied|Please enable JS/i.test(
    String(html || ''),
  )
}

function extractCmaCgmTracking(html, blNo) {
  const $ = load(String(html || ''))
  const bodyText = cleanText($('body').text())

  /**
   * CMA CGM shows the arrival as e.g.
   * "ETA Berth at POD Sunday 03-MAY-2026 12:00"
   * or "Estimated Time of Arrival 03-May-2026".
   */
  const etaMatch = bodyText.match(
    /(?:ETA[^0-9]{0,40}|Estimated Time of Arrival[^0-9]{0,20})(\d{1,2}[-\s][A-Za-z]{3}[-\s]\d{4}(?:\s+\d{1,2}:\d{2})?)/i,
  )

  const eta = etaMatch
    ? parseDateCandidate(etaMatch[1])
    : extractEtaFromHtml($)

  const events = [
    ...extractEventsFromHtml($, 'cma'),
    ...extractTimelineListEvents($, 'cma'),
  ]

  return buildResult('CMA_CGM', blNo, eta, events)
}

/* ------------------------------------------------------------------ */
/* Generic object / HTML helpers                                       */
/* ------------------------------------------------------------------ */

function extractEtaFromObject(payload) {
  const namedEntries = collectNamedValues(payload)
  const priorityEntries = namedEntries.filter((entry) =>
    /(eta|estimated.*arrival|arrival|arrive|discharge|destination)/i.test(
      entry.path,
    ),
  )

  for (const entry of [...priorityEntries, ...namedEntries]) {
    const parsedDate = parseDateCandidate(entry.value)

    if (parsedDate) {
      return parsedDate
    }
  }

  return null
}

function extractEventsFromObject(payload) {
  const eventArray = findEventArray(payload)

  if (!eventArray) {
    return []
  }

  return eventArray.map((event, index) => mapEventRecord(event, index)).filter(Boolean)
}

function collectNamedValues(value, path = 'root', depth = 0, entries = []) {
  if (depth > 6 || value === undefined || value === null) {
    return entries
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      collectNamedValues(item, `${path}[${index}]`, depth + 1, entries)
    })
    return entries
  }

  if (typeof value === 'object') {
    Object.entries(value).forEach(([key, nestedValue]) => {
      collectNamedValues(nestedValue, `${path}.${key}`, depth + 1, entries)
    })
    return entries
  }

  entries.push({
    path,
    value,
  })

  return entries
}

function findEventArray(value, depth = 0) {
  if (depth > 6 || value === undefined || value === null) {
    return null
  }

  if (Array.isArray(value)) {
    if (value.some(isEventLikeObject)) {
      return value
    }

    for (const item of value) {
      const found = findEventArray(item, depth + 1)

      if (found) {
        return found
      }
    }

    return null
  }

  if (typeof value === 'object') {
    for (const nestedValue of Object.values(value)) {
      const found = findEventArray(nestedValue, depth + 1)

      if (found) {
        return found
      }
    }
  }

  return null
}

function isEventLikeObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const keyString = Object.keys(value).join(' ')
  return /(status|event|location|date|time|title|activity|description)/i.test(
    keyString,
  )
}

function mapEventRecord(event, index) {
  if (!event) {
    return null
  }

  if (typeof event === 'string') {
    return buildEvent({ id: `${index}-${event}`, title: event })
  }

  return buildEvent({
    id: event.id || `${index}-${event.status || event.title || 'event'}`,
    title: event.status || event.event || event.title || event.name,
    description: event.description || event.message,
    location: event.location || event.port || event.place,
    container: event.container || event.containerNo,
    occurredAt:
      event.timestamp ||
      event.occurredAt ||
      event.date ||
      event.eventDate ||
      event.updatedAt ||
      event.time,
  })
}

function extractEtaFromHtml($) {
  const rowEta = extractEtaFromRows(
    $('table tr')
      .map((_, row) => [
        $(row)
          .find('th,td')
          .map((__, cell) => cleanText($(cell).text()))
          .get(),
      ])
      .get(),
  )

  if (rowEta) {
    return rowEta
  }

  const bodyText = cleanText($('body').text())
  const labeledMatch = bodyText.match(
    /(eta|estimated arrival|arrival)[^A-Za-z0-9]{0,8}([A-Za-z0-9,/: .-]{6,50})/i,
  )

  return labeledMatch ? parseDateCandidate(labeledMatch[2]) : null
}

/**
 * Generic table-row event extraction: any row that has a date cell and
 * at least one other text cell becomes an event.
 */
function extractEventsFromHtml($, idPrefix = 'html') {
  const events = []

  $('table tr').each((rowIndex, row) => {
    const cells = $(row)
      .find('td')
      .map((__, cell) => cleanText($(cell).text()))
      .get()
      .filter(Boolean)

    if (cells.length < 2) {
      return
    }

    const occurredAt = cells.map(parseDateCandidate).find(Boolean) || null
    const nonDateCells = cells.filter((cell) => !parseDateCandidate(cell))

    if (!occurredAt || nonDateCells.length < 1) {
      return
    }

    const container = cells.join(' ').match(/\b[A-Z]{4}\d{7}\b/)?.[0] || ''

    events.push(
      buildEvent({
        id: `${idPrefix}-row-${rowIndex}`,
        title: nonDateCells[0],
        description: nonDateCells.slice(1, -1).join(' · '),
        location: nonDateCells.length > 1 ? nonDateCells[nonDateCells.length - 1] : '',
        container,
        occurredAt,
      }),
    )
  })

  return events
}

/**
 * Timeline-style markup (<li> items) used by newer carrier portals.
 */
function extractTimelineListEvents($, idPrefix = 'timeline') {
  const events = []

  $('[class*="timeline"] li, [class*="Timeline"] li').each((index, item) => {
    const text = cleanText($(item).text())
    const occurredAt = parseDateCandidate(text)

    if (!occurredAt) {
      return
    }

    const lines = $(item)
      .find('*')
      .map((_, el) => cleanText($(el).clone().children().remove().end().text()))
      .get()
      .filter((line) => line && !parseDateCandidate(line))

    events.push(
      buildEvent({
        id: `${idPrefix}-li-${index}`,
        title: lines[0] || text.slice(0, 80),
        description: lines.slice(2).join(' · '),
        location: lines[1] || '',
        occurredAt,
      }),
    )
  })

  return events
}

function extractEtaFromRows(rows) {
  for (const row of rows) {
    const labeledCell = row.find((cell) =>
      /(eta|estimated arrival|arrival|arrive)/i.test(cell),
    )

    if (!labeledCell) {
      continue
    }

    for (const cell of row) {
      const parsedDate = parseDateCandidate(cell)

      if (parsedDate) {
        return parsedDate
      }
    }
  }

  return null
}

/* ------------------------------------------------------------------ */
/* Event list hygiene                                                  */
/* ------------------------------------------------------------------ */

function dedupeEvents(events) {
  const seen = new Set()

  return events.filter((event) => {
    const key = [
      event.title,
      event.location,
      event.container,
      event.occurredAt ? event.occurredAt.toISOString() : 'na',
    ].join('|')

    if (seen.has(key)) {
      return false
    }

    seen.add(key)
    return true
  })
}

function sortEvents(events) {
  return [...events].sort((left, right) => {
    const leftTime = left.occurredAt ? left.occurredAt.getTime() : Number.MAX_SAFE_INTEGER
    const rightTime = right.occurredAt ? right.occurredAt.getTime() : Number.MAX_SAFE_INTEGER
    return leftTime - rightTime
  })
}

/* ------------------------------------------------------------------ */
/* Primitive parsers                                                   */
/* ------------------------------------------------------------------ */

function parsePotentialJson(payload) {
  if (typeof payload !== 'string') {
    return payload
  }

  const trimmedPayload = payload.trim()

  if (!trimmedPayload.startsWith('{') && !trimmedPayload.startsWith('[')) {
    return payload
  }

  try {
    return JSON.parse(trimmedPayload)
  } catch {
    return payload
  }
}

export function parseDateCandidate(value) {
  if (!value) {
    return null
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }

  if (typeof value?.toDate === 'function') {
    return value.toDate()
  }

  const source = String(value)
    .replace(/\s+/g, ' ')
    .replace(/(\d)(st|nd|rd|th)\b/gi, '$1')
    .trim()

  if (!source || source.length > 80) {
    return null
  }

  // dd/mm/yyyy, dd.mm.yyyy, dd-mm-yyyy (optionally followed by hh:mm)
  const numericDate = source.match(
    /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?$/,
  )

  if (numericDate) {
    const [, day, month, year, hours = '12', minutes = '0'] = numericDate
    const normalizedYear = year.length === 2 ? `20${year}` : year
    const parsedDate = new Date(
      Number(normalizedYear),
      Number(month) - 1,
      Number(day),
      Number(hours),
      Number(minutes),
    )

    return Number.isNaN(parsedDate.getTime()) ? null : parsedDate
  }

  const candidates = [
    source,
    ...(source.match(
      /\b(?:\d{4}-\d{1,2}-\d{1,2}(?:[T ]\d{1,2}:\d{2}(?::\d{2})?)?|\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{1,2}-[A-Za-z]{3}-\d{4}(?:\s+\d{1,2}:\d{2})?|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})\b/g,
    ) || []),
  ]

  for (const candidate of candidates) {
    // V8's Date parser is very lenient ("Port 12" parses as 2001).
    // Only accept candidates that carry an explicit 4-digit year.
    if (!/(?:^|\D)(?:19|20)\d{2}(?:\D|$)/.test(candidate)) {
      continue
    }

    const numericCandidate = candidate.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/)

    if (numericCandidate) {
      const nested = parseDateCandidate(candidate)
      if (nested) return nested
      continue
    }

    const parsedDate = new Date(candidate)

    if (!Number.isNaN(parsedDate.getTime()) && parsedDate.getFullYear() > 2000) {
      return parsedDate
    }
  }

  return null
}

function firstNormalizedDate(values) {
  for (const value of values) {
    const parsedDate = parseDateCandidate(value)

    if (parsedDate) {
      return parsedDate
    }
  }

  return null
}

function isHtmlPayload(payload) {
  return (
    typeof payload === 'string' &&
    /<html|<body|<table|<tr|<td|<div/i.test(payload)
  )
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function normalizeString(value) {
  return String(value || '').trim()
}

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

  const events = []
  const arrivals = []

  containers.forEach((container) => {
    const containerNo = normalizeString(container?.containerNo)
    const vessel = normalizeString(container?.vesselVoyage?.vesselName)
    const countryByPlace = new Map(
      [container?.por, container?.pod].filter(Boolean).map((place) => [
        normalizeString(place.locationName).toUpperCase(),
        normalizeString(place.code).slice(0, 2),
      ]),
    )
    const placeName = (name, countryCode) => {
      const place = normalizeString(name)
      const country = normalizeString(countryCode) || countryByPlace.get(place.toUpperCase())
      return place && country ? `${place}, ${country}` : place
    }

    const cargoEvents = Array.isArray(container?.cargoEvents) ? container.cargoEvents : []
    cargoEvents.forEach((event, index) => {
      const name = oneMilestones[event?.matrixId]
      // Codes outside the map are deadlines (cut-off, last free day), not moves.
      if (!name) return
      const actual = normalizeString(event?.trigger).toUpperCase() === 'ACTUAL'
      // `date` is UTC; `localPortDate` is port-local time with a misleading Z.
      const occurredAt = parseDateCandidate(event?.date || event?.localPortDate)

      events.push(
        buildEvent({
          id: `one-${containerNo || 'bl'}-${event.matrixId}-${index}`,
          title: actual ? name : `Expected ${name.toLowerCase()}`,
          description: vessel,
          location: placeName(event?.locationName, event?.countryCode),
          container: containerNo,
          occurredAt,
        }),
      )
      if (event.matrixId === 'E089' && occurredAt) arrivals.push(occurredAt)
    })

    // The container's latest status is the only place ONE names
    // post-arrival moves such as the empty return.
    const latest = container?.latestEvent
    if (latest?.eventName) {
      events.push(
        buildEvent({
          id: `one-${containerNo || 'bl'}-latest`,
          title: latest.eventName,
          location: placeName(latest.locationName),
          container: containerNo,
          occurredAt: latest.date,
        }),
      )
    }
  })

  // B/L ETA: the latest container arrival at the port of discharge.
  const eta = arrivals.length ? new Date(Math.max(...arrivals.map((date) => date.getTime()))) : null

  return buildResult('ONE', blNo, eta, events)
}

/**
 * Milestone codes in ONE's cargoEvents, as ONE's own tracking page labels
 * them. Other codes in that list (E105 demurrage last free day, E167 cargo
 * cut-off) are deadlines and are skipped.
 */
const oneMilestones = {
  E061: 'Vessel departure from port of loading',
  E089: 'Vessel arrival at POD',
}

/* ------------------------------------------------------------------ */
/* Evergreen (HTML)                                                    */
/* ------------------------------------------------------------------ */

/**
 * The B/L page lists each container's current status only. Without the
 * per-container moves this is what we keep: one status event per container,
 * at the port of discharge.
 */
export function extractEvergreenTracking(html, blNo) {
  const $ = load(String(html || ''))
  const { containers, pod } = extractEvergreenBl($)

  return buildResult(
    'EVERGREEN',
    blNo,
    parseDateCandidate(extractEvergreenEta($)),
    containers
      .filter((container) => container.status)
      .map((container) =>
        buildEvent({
          id: `evergreen-${container.number}-status`,
          title: container.status,
          location: pod,
          container: container.number,
          occurredAt: parseEvergreenDate(container.date),
        }),
      ),
  )
}

/**
 * Everything needed to ask Evergreen for each container's moves: the
 * container numbers and the hidden fields of the page's frmCntrMove form.
 */
export function extractEvergreenMoveRequests(html) {
  const source = String(html || '')
  // Read from the raw markup: the form sits inside a table, so an HTML
  // parser closes it before its inputs.
  const form = source.match(/<form[^>]*name="frmCntrMove"[\s\S]*?<\/form>/i)?.[0] || ''
  const fields = {}
  for (const [input] of form.matchAll(/<input[^>]*>/gi)) {
    const name = input.match(/name="([^"]*)"/i)?.[1]
    if (name && name !== 'cntr_no') fields[name] = input.match(/value="([^"]*)"/i)?.[1] || ''
  }
  return { fields, containers: extractEvergreenBl(load(source)).containers.map((container) => container.number) }
}

function extractEvergreenBl($) {
  const containers = []
  let pod = ''

  $('tr').each((_, row) => {
    const cells = $(row).children('td, th').map((__, cell) => cleanText($(cell).text())).get()
    const podIndex = cells.indexOf('Port of Discharge')
    if (podIndex !== -1 && cells[podIndex + 1]) pod = toPlace(cells[podIndex + 1])

    const number = cells[0]?.match(/^([A-Z]{4}\d{7})\b/)?.[1]
    // Container rows: number, size, seal, service, quantity, method, VGM, status, date.
    if (number && cells.length >= 9 && parseEvergreenDate(cells.at(-1))) {
      containers.push({ number, status: cells.at(-2), date: cells.at(-1) })
    }
  })

  return { containers, pod }
}

/** One container's moves page: Date | Container Moves | Location | Vessel Voyage. */
export function extractEvergreenContainerMoves(html, blNo, cntrNo) {
  const $ = load(String(html || ''))
  const events = []

  $('tr').each((index, row) => {
    const cells = $(row).children('td').map((_, cell) => cleanText($(cell).text())).get()
    if (cells.length < 3) return
    const occurredAt = parseEvergreenDate(cells[0])
    if (!occurredAt || !cells[1]) return

    events.push(
      buildEvent({
        id: `evergreen-${cntrNo}-${index}`,
        title: cells[1],
        description: cells[3] || '',
        location: toPlace(cells[2]),
        container: cntrNo,
        occurredAt,
      }),
    )
  })

  return buildResult('EVERGREEN', blNo, null, events)
}

const monthIndex = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 }

/** Evergreen dates: "JUL-08-2026", optionally followed by "hh:mm". */
function parseEvergreenDate(value) {
  const match = String(value || '').match(/\b([A-Z]{3})-(\d{1,2})-(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/i)
  const month = match && monthIndex[match[1].toUpperCase()]
  if (month === undefined || month === null) return null
  const [, , day, year, hours = '12', minutes = '0'] = match
  return new Date(Date.UTC(Number(year), month, Number(day), Number(hours), Number(minutes)))
}

/** "HAZIRA (IN)" -> "HAZIRA, IN", the form the rest of the app reads. */
function toPlace(value) {
  return cleanText(value).replace(/\s*\(([A-Z]{2})\)$/, ', $1')
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
   * PIL response format: { success: true, data: "<html string>" }.
   * Without the per-container traces, the B/L routing table is what we have:
   * one row per vessel leg,
   *   Arrival/Delivery | Location ("Load Port SURABAYA IDSUB") |
   *   Vessel/Voyage | Next Location ("SGSIN 23-Mar-2026")
   * The last row's next location is the destination, with its ETA.
   */
  const html = normalizedPayload?.data || ''

  if (!html || typeof html !== 'string') {
    return buildResult('PIL', blNo)
  }

  const $ = load(html)
  const events = []
  let eta = null

  const lines = (cell) =>
    ($(cell).html() || '')
      .split(/<br\s*\/?>/i)
      .map((part) => cleanText(load(part).text()))
      .filter(Boolean)

  $('tr.resultrow').each((index, row) => {
    const [role = 'Port', name = '', locode = ''] = lines($(row).find('.location'))
    const [arrival] = lines($(row).find('.arrival-delivery'))
    const [vessel = '', voyage = ''] = lines($(row).find('.vessel-voyage'))
    const [nextLocode = '', nextDate = ''] = lines($(row).find('.next-location'))
    const description = [vessel, voyage].filter(Boolean).join(' · ')

    events.push(
      buildEvent({
        id: `pil-leg-${index}`,
        title: role === 'Load Port' ? 'Vessel Loading' : `Vessel at ${role.toLowerCase()}`,
        description,
        location: locode ? `${name}, ${locode.slice(0, 2)}` : name,
        occurredAt: parseDateCandidate(arrival),
      }),
    )
    eta = parseDateCandidate(nextDate) || eta
    if (index === $('tr.resultrow').length - 1 && nextLocode) {
      events.push(
        buildEvent({
          id: `pil-destination`,
          title: 'Estimated arrival',
          description,
          location: nextLocode,
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

  $('.cont-numb').each((_, el) => {
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

  // The trace is bare <tr> rows; the HTML parser drops them outside a table.
  const $ = load(`<table>${html}</table>`)

  let eta = null
  const events = []

  $('tr.bg-lightblue').each((index, row) => {
    const cells = $(row).find('td')

    if (cells.length < 6) return

    const eventDate = cleanText($(cells[3]).text()).replace(/\*/g, '')
    const eventName = cleanText($(cells[4]).text())
    const location = cleanText($(cells[5]).text())
    const parsedDate = parseDateCandidate(eventDate)

    // Skips the header row ("Event Date | Event Name | ...") too.
    if (!eventName || !parsedDate) return

    const vessel = [cleanText($(cells[1]).text()), cleanText($(cells[2]).text())]
      .filter(Boolean)
      .join(' · ')

    events.push(
      buildEvent({
        id: `pil-${cntrNo}-${index}`,
        title: eventName,
        description: vessel,
        location,
        container: cntrNo,
        occurredAt: parsedDate,
      }),
    )

    if (eventName === 'Vessel Discharge') {
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

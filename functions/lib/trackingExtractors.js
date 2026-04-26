const { cheerio } = require('cheerio')

const carrierExtractors = {
  MSC: extractMscTracking,
  ONE: extractOneTracking,
  EVERGREEN: extractEvergreenTracking,
  PIL: extractPilTracking,
}
function extractOneEta(payload) {
  return payload?.data[0].cargoEvents?.last.date
}
function extractMscEta(payload) {
  return payload?.Data?.BillOfLadings?.[0]?.GeneralTrackingInfo?.FinalPodEtaDate
}

function extractTrackingPayload({ carrier, payload, blNo }) {
  const normalizedCarrier = normalizeString(carrier).toUpperCase()
  const extractor = carrierExtractors[normalizedCarrier] || extractUnknownTracking
  
  return extractor(payload, blNo)
}

function extractUnknownTracking(payload, blNo) {
  return extractHtmlOrObjectTracking('UNKNOWN', payload, blNo)
}

function extractMscTracking(payload, blNo) {
  const normalizedPayload = parsePotentialJson(payload)

  if (normalizedPayload?.IsSuccess === false) {
    throw new Error(`MSC tracking failed for ${blNo}`)
  }

  const data = normalizedPayload?.Data || normalizedPayload
  const billOfLading = findMatchingBillOfLading(
    data?.BillOfLadings,
    blNo
  )

  if (!billOfLading) {
    return {
      source: 'MSC',
      eta: null,
      events: [],
      trackingNumber: blNo,
    }
  }

  const eta =
    firstNormalizedDate([
      billOfLading?.GeneralTrackingInfo?.FinalPodEtaDate,
      ...(billOfLading?.ContainersInfo || []).map(c => c?.PodEtaDate),
    ]) || null

  return {
    source: 'MSC',
    eta,
    events: [],
    trackingNumber: blNo,
  }
}

function extractOneTracking(payload, blNo) {
  const normalizedPayload = parsePotentialJson(payload)

  /**
   * ONE response format:
   * {
   *   status: 200,
   *   code: 1,
   *   data: [...]
   * }
   */
  const containers = Array.isArray(normalizedPayload?.data)
    ? normalizedPayload.data
    : []

  if (!containers.length) {
    return {
      source: 'ONE',
      eta: null,
      events: [],
      trackingNumber: blNo,
    }
  }

  /**
   * Collect all cargo events from all containers
   */
  const allEvents = containers.flatMap(
    (container) => Array.isArray(container?.cargoEvents)
      ? container.cargoEvents
      : []
  )

  /**
   * ETA Priority:
   *
   * E105 = Final arrival / destination arrival
   * E089 = Before arrival fallback
   *
   * Prefer E105 first
   */
  const etaCandidates = allEvents
    .filter(
      (event) =>
        event?.matrixId === 'E105' ||
        event?.matrixId === 'E089'
    )
    .map((event) =>
      parseDateCandidate(
        event?.date || event?.localPortDate
      )
    )
    .filter(Boolean)
    .sort((a, b) => a.getTime() - b.getTime())

  const eta =
    etaCandidates.length > 0
      ? etaCandidates[0]
      : null

  /**
   * Normalize events for your system
   */
  const events = allEvents.map((event, index) => ({
    id: `${event?.matrixId || 'event'}-${index}`,

    title:
      normalizeString(event?.matrixId) ||
      'Shipment Update',

    description: [
      normalizeString(event?.locationName),
      normalizeString(event?.trigger),
    ]
      .filter(Boolean)
      .join(' - '),

    location: normalizeString(
      event?.locationName
    ),

    occurredAt: parseDateCandidate(
      event?.date || event?.localPortDate
    ),
  }))

  return {
    source: 'ONE',
    eta,
    events,
    trackingNumber: blNo,
  }
}

function extractEvergreenTracking(payload, blNo) {
  return extractHtmlOrObjectTracking('EVERGREEN', payload, blNo)
}

function extractPilTracking(payload, blNo) {
  return extractHtmlOrObjectTracking('PIL', payload, blNo)
}

function extractHtmlOrObjectTracking(source, payload, blNo) {
  const normalizedPayload = parsePotentialJson(payload)

  if (isHtmlPayload(normalizedPayload)) {
    return extractTrackingFromHtml(source, normalizedPayload, blNo)
  }

  if (
    normalizedPayload &&
    (typeof normalizedPayload === 'object' || Array.isArray(normalizedPayload))
  ) {
    return extractGenericTrackingObject(source, normalizedPayload, blNo)
  }

  return {
    source,
    eta: null,
    events: [],
    trackingNumber: blNo,
  }
}

function extractTrackingFromHtml(source, html, blNo) {
  const $ = cheerio.load(String(html || ''))
  const events = extractEventsFromHtml($)

  return {
    source,
    eta: extractEtaFromHtml($),
    events,
    trackingNumber: blNo,
  }
}

function extractGenericTrackingObject(source, payload, blNo) {
  return {
    source,
    eta: extractEtaFromObject(payload),
    events: extractEventsFromObject(payload),
    trackingNumber: blNo,
  }
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

function buildMscEventDescription(detail, containers) {
  const containerList = Array.from(containers || [])
  const containerSummary =
    containerList.length > 0
      ? `Containers: ${containerList.join(', ')}`
      : ''

  return normalizeString([detail, containerSummary].filter(Boolean).join(' | '))
}

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
    return {
      id: `${index}-${event}`,
      title: event,
      description: '',
      location: '',
      occurredAt: null,
    }
  }

  const occurredAt = parseDateCandidate(
    event.timestamp ||
      event.occurredAt ||
      event.date ||
      event.eventDate ||
      event.updatedAt ||
      event.time,
  )

  const title = normalizeString(
    event.status || event.event || event.title || event.name || 'Status update',
  )

  return {
    id: normalizeString(event.id || `${index}-${title}`),
    title,
    description: normalizeString(event.description || event.message || ''),
    location: normalizeString(event.location || event.port || event.place || ''),
    occurredAt,
  }
}

function extractEtaFromHtml($) {
  const rowEta = extractEtaFromRows(
    $('table tr')
      .map((_, row) =>
        $(row)
          .find('th,td')
          .map((__, cell) => $(cell).text().replace(/\s+/g, ' ').trim())
          .get(),
      )
      .get(),
  )

  if (rowEta) {
    return rowEta
  }

  const bodyText = $('body').text().replace(/\s+/g, ' ').trim()
  const labeledMatch = bodyText.match(
    /(eta|estimated arrival|arrival)[^A-Za-z0-9]{0,8}([A-Za-z0-9,/: .-]{6,50})/i,
  )

  if (labeledMatch) {
    return parseDateCandidate(labeledMatch[2])
  }

  return parseDateCandidate(bodyText)
}

function extractEventsFromHtml($) {
  const seen = new Set()
  const events = []

  $('table tr').each((_, row) => {
    const cells = $(row)
      .find('th,td')
      .map((__, cell) => $(cell).text().replace(/\s+/g, ' ').trim())
      .get()
      .filter(Boolean)

    if (cells.length < 2) {
      return
    }

    const occurredAt = cells.map(parseDateCandidate).find(Boolean) || null
    const nonDateCells = cells.filter((cell) => !parseDateCandidate(cell))

    if (!occurredAt && nonDateCells.length < 2) {
      return
    }

    const title = normalizeString(nonDateCells[0] || 'Status update')
    const description = normalizeString(nonDateCells.slice(1).join(' | '))
    const location = normalizeString(nonDateCells[nonDateCells.length - 1] || '')
    const key = `${title}|${occurredAt ? occurredAt.toISOString() : 'na'}|${location}`

    if (seen.has(key)) {
      return
    }

    seen.add(key)
    events.push({
      id: key,
      title,
      description,
      location,
      occurredAt,
    })
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
  } catch (error) {
    return payload
  }
}

function parseDateCandidate(value) {
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

  if (!source) {
    return null
  }

  const slashOrDotDate = source.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/)

  if (slashOrDotDate) {
    const [, day, month, year] = slashOrDotDate
    const normalizedYear = year.length === 2 ? `20${year}` : year
    const parsedDate = new Date(
      Number(normalizedYear),
      Number(month) - 1,
      Number(day),
      12,
    )

    if (!Number.isNaN(parsedDate.getTime())) {
      return parsedDate
    }
  }

  const candidates = [
    source,
    ...(source.match(
      /\b(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})\b/g,
    ) || []),
  ]

  for (const candidate of candidates) {
    const parsedDate = new Date(candidate)

    if (!Number.isNaN(parsedDate.getTime())) {
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

function normalizeString(value) {
  return String(value || '').trim()
}

module.exports = {
  extractTrackingPayload,
  extractMscTracking,
  extractOneTracking,
  extractEvergreenTracking,
  extractPilTracking,
}

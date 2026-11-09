/**
 * Live vessel position for a shipment, from one of two AIS sources:
 * - VesselFinder (https://api.vesselfinder.com/docs/vessels.html), paid,
 *   looked up by IMO, which only MSC events give;
 * - Shiptrail (https://shiptrail.io/agents), free, through its MCP endpoint,
 *   looked up by vessel name. Its terms ask for a credit and a link back.
 */

// A box is at sea after it is loaded or the vessel departs, until the next
// discharge or arrival. "Unloaded" must not count, hence the word boundary.
const departureEvent = /\b(?:load(?:ed|ing)|depart(?:ed|ure)?|sail(?:ed|ing)?|on ?board)\b/i

const VESSELFINDER_URL = 'https://api.vesselfinder.com/vessels'

/**
 * The vessel the box is on now, from the latest actual event when that event
 * is a load or departure: { name, voyage, imo } (imo is '' for carriers that
 * name only the vessel). Null while the box is ashore.
 */
export function getVesselAtSea(events) {
  const actual = (Array.isArray(events) ? events : [])
    .filter((event) => event?.occurredAt && !event.estimated)
    .sort((left, right) => toTime(left.occurredAt) - toTime(right.occurredAt))
  const latest = actual.at(-1)
  if (!latest || !departureEvent.test(latest.title || '')) return null
  const imo = /^\d{7}$/.test(latest.vesselImo || '') ? latest.vesselImo : ''
  const name = String(latest.vessel || '').trim()
  if (!imo && !name) return null
  // A position fix older than the departure is from an earlier voyage.
  return { name, voyage: String(latest.voyage || '').trim(), imo, since: new Date(toTime(latest.occurredAt)) }
}

/**
 * Turns one VesselFinder record into the shipment's vesselPosition field, or
 * null when it has no usable fix.
 */
export function toVesselPosition(record) {
  const ais = record?.AIS
  const lat = Number(ais?.LATITUDE)
  const lon = Number(ais?.LONGITUDE)
  if (!ais || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return null
  }
  // "2017-08-11 11:18:05 UTC"
  const reportedAt = new Date(String(ais.TIMESTAMP || '').replace(' UTC', 'Z').replace(' ', 'T'))
  const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : null)

  return {
    lat,
    lon,
    speed: number(ais.SPEED),
    course: number(ais.COURSE),
    vesselName: String(ais.NAME || '').trim(),
    imo: String(ais.IMO || ''),
    mmsi: String(ais.MMSI || ''),
    destination: String(ais.DESTINATION || '').trim(),
    reportedAt: Number.isNaN(reportedAt.getTime()) ? null : reportedAt,
    source: 'vesselfinder',
  }
}

/**
 * Latest AIS fix for an IMO. Throws on an API error so the caller can keep the
 * previous position; returns null when VesselFinder has no record.
 */
export async function fetchVesselPosition({ imo, apiKey, http, timeout = 15000 }) {
  const response = await http.get(VESSELFINDER_URL, {
    params: { userkey: apiKey, imo },
    timeout,
  })
  const data = response.data
  if (data && !Array.isArray(data) && data.error) {
    throw new Error(`VesselFinder: ${data.error}`)
  }
  return toVesselPosition(Array.isArray(data) ? data[0] : null)
}

const SHIPTRAIL_URL = 'https://shiptrail.io/mcp'

const normalizeName = (value) => String(value || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()

async function callShiptrail(http, tool, args, timeout) {
  const response = await http.post(
    SHIPTRAIL_URL,
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } },
    {
      timeout,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    },
  )
  const { result, error } = response.data || {}
  if (error || result?.isError) {
    throw new Error(`Shiptrail ${tool}: ${error?.message || result?.content?.[0]?.text || 'error'}`)
  }
  return result?.structuredContent ?? null
}

/**
 * Latest position for a vessel named by the carrier, from Shiptrail. Only an
 * exact name match counts (Shiptrail also returns look-alike names), the IMO
 * must agree when the carrier gave one, and the fix must be newer than the
 * departure. `knownMmsi` (from the last lookup of the same vessel) skips the
 * search. Returns null when there is no usable fix.
 */
export async function fetchShiptrailPosition({ vessel, knownMmsi = '', http, timeout = 15000 }) {
  let mmsi = /^\d{9}$/.test(String(knownMmsi)) ? Number(knownMmsi) : null
  if (!mmsi) {
    const found = await callShiptrail(http, 'search_ships', { query: vessel.name || vessel.imo, limit: 5 }, timeout)
    const match = (found?.ships || []).find(
      (ship) => !ship.nearMatch && normalizeName(ship.name) === normalizeName(vessel.name),
    )
    if (!match) return null
    mmsi = match.mmsi
  }

  const ship = await callShiptrail(http, 'get_ship', { mmsi }, timeout)
  if (!ship) return null
  if (vessel.imo && ship.imo && String(ship.imo) !== vessel.imo) return null

  const at = new Date(ship.position?.at)
  if (Number.isNaN(at.getTime()) || (vessel.since && at < vessel.since)) return null
  const lat = Number(ship.position?.lat)
  const lon = Number(ship.position?.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : null)

  return {
    lat,
    lon,
    speed: number(ship.speedKn),
    course: number(ship.courseDeg),
    vesselName: String(ship.name || vessel.name),
    imo: ship.imo ? String(ship.imo) : vessel.imo || '',
    mmsi: String(ship.mmsi || mmsi),
    destination: String(ship.voyage?.boundFor?.name || ship.voyage?.destination || ''),
    reportedAt: at,
    source: 'shiptrail',
    url: String(ship.url || ''),
  }
}

function toTime(value) {
  const date = typeof value?.toDate === 'function' ? value.toDate() : new Date(value)
  return Number.isNaN(date.getTime()) ? 0 : date.getTime()
}

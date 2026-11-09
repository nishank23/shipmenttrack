/**
 * Live vessel position for a shipment, from VesselFinder's AIS API
 * (https://api.vesselfinder.com/docs/vessels.html).
 *
 * VesselFinder looks vessels up by IMO or MMSI only, so this works for
 * carriers whose events name the vessel's IMO (MSC today).
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
  return imo || name ? { name, voyage: String(latest.voyage || '').trim(), imo } : null
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

function toTime(value) {
  const date = typeof value?.toDate === 'function' ? value.toDate() : new Date(value)
  return Number.isNaN(date.getTime()) ? 0 : date.getTime()
}

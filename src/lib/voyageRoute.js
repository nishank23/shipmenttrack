import { resolvePort } from './portLocations.js'
import { isArrivalEvent } from './shipmentDashboard.js'
import { buildLane } from './tradeLanes.js'

// Matches functions/lib/vesselPosition.js. "Unloaded" must not count.
const departureEvent = /\b(?:load(?:ed|ing)|depart(?:ed|ure)?|sail(?:ed|ing)?|on ?board)\b/i
const shortDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })

function toUnit({ lat, lon }) {
  const a = (lat * Math.PI) / 180
  const b = (lon * Math.PI) / 180
  return [Math.cos(a) * Math.cos(b), Math.cos(a) * Math.sin(b), Math.sin(a)]
}

// Point midway between two unit vectors, as lat/lon (the second one when they
// are antipodal and any midpoint would do).
function midpoint(a, b) {
  const sum = [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
  const length = Math.hypot(...sum)
  const [x, y, z] = length < 1e-6 ? b : sum.map((value) => value / length)
  return { lat: (Math.asin(z) * 180) / Math.PI, lon: (Math.atan2(y, x) * 180) / Math.PI }
}

const clamp = (value, min, max) => Math.min(Math.max(value, min), max)

/**
 * Turns carrier checkpoints into a voyage for the globe: the ports in the
 * order the box visits them (reported, then planned), and where the vessel is
 * now. Without a live position, "now" is the latest reported event: at its
 * port, or part-way along the next leg after a departure, estimated from the
 * departure time and the next planned arrival. `position` ({ lat, lon }, for
 * example from an AIS feed) overrides that estimate.
 *
 * Returns null when fewer than two ports can be placed on the map.
 */
export function getVoyageRoute(history, { eta = null, now = Date.now(), position = null } = {}) {
  const stops = []
  const stopFor = (port) => stops.find((stop) => stop.port === port)

  // Reported events oldest first. Containers on one B/L can interleave, so a
  // port joins the route once, at its first visit.
  const reported = [...history.reported].reverse()
  for (const event of reported) {
    const port = resolvePort(event.location)
    if (!port) continue
    const stop = stopFor(port)
    if (stop) stop.lastEvent = event
    else stops.push({ port, reached: true, at: event.occurredAt, lastEvent: event })
    // Any arrival there counts, not just the latest event (an empty return
    // or gate out can follow the discharge).
    if (isArrivalEvent(event)) stopFor(port).arrived = true
  }
  for (const event of history.planned) {
    const port = resolvePort(event.location)
    if (!port || stopFor(port)) continue
    stops.push({ port, reached: false, at: event.occurredAt, lastEvent: null })
  }
  if (stops.length < 2) return null

  const latest = history.reported.find((event) => resolvePort(event.location)) ?? null
  const destination = stops.at(-1)
  if (!destination.reached && eta) destination.at = eta

  let index = latest ? stops.indexOf(stopFor(resolvePort(latest.location))) : 0
  let leg = 0
  let status = latest ? 'at-port' : 'planned'
  if (latest && index === stops.length - 1 && (isArrivalEvent(latest) || stops[index].arrived)) {
    status = 'arrived'
  } else if (latest && departureEvent.test(latest.title) && index < stops.length - 1) {
    status = 'in-transit'
    const from = latest.occurredAt?.getTime()
    const to = stops[index + 1].at?.getTime()
    leg = from && to && to > from ? clamp((now - from) / (to - from), 0.04, 0.96) : 0.04
  }

  const live = Number.isFinite(position?.lat) && Number.isFinite(position?.lon) && index < stops.length - 1
  if (live) status = 'live'

  const waypoints = stops.map((stop, stopIndex) => {
    const last = stopIndex === stops.length - 1
    const note = last && stop.at
      ? `${status === 'arrived' ? 'Arrived' : 'ETA'} ${shortDate.format(stop.at)}`
      : ''
    return {
      lat: stop.port.lat,
      lon: stop.port.lon,
      name: stop.port.name,
      label: note ? `${stop.port.name} · ${note}` : stop.port.name,
    }
  })
  // A live fix becomes a waypoint the route bends through.
  if (live) waypoints.splice(index + 1, 0, { lat: position.lat, lon: position.lon })

  // Frame the two ports farthest apart: centre between them, closer in for a
  // regional voyage, the whole globe for one that spans it.
  const units = waypoints.map(toUnit)
  let widest = [units[0], units.at(-1)]
  let widestDot = Infinity
  units.forEach((a, i) => units.slice(i + 1).forEach((b) => {
    const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
    if (dot < widestDot) {
      widestDot = dot
      widest = [a, b]
    }
  }))
  const centre = midpoint(...widest)
  const halfSpan = Math.acos(clamp(widestDot, -1, 1)) / 2
  // 1.04 keeps the widest pair inside about 70% of the frame at the base distance.
  const zoom = halfSpan >= Math.PI / 2 ? 1 : clamp(1.04 / Math.max(Math.sin(halfSpan), 0.3), 1, 2.2)
  const lane = {
    id: waypoints.map((point) => `${point.lat},${point.lon}`).join('|'),
    legArcs: true,
    focus: { from: centre, to: centre },
    waypoints,
  }
  const fractions = buildLane(lane).waypointFractions
  const progress = live
    ? fractions[index + 1]
    : fractions[index] + ((fractions[index + 1] ?? fractions[index]) - fractions[index]) * leg

  // The vessel the box is on (or last sailed on), and the next one planned.
  const vesselOf = (event) => (event?.vessel ? { name: event.vessel, voyage: event.voyage || '' } : null)
  const lastVessel = vesselOf(history.reported.find((event) => event.vessel))
  const nextVessel = vesselOf(history.planned.find((event) => event.vessel && event.vessel !== lastVessel?.name))

  return {
    lane,
    progress,
    vessel: lastVessel,
    nextVessel: status === 'arrived' ? null : nextVessel,
    zoom,
    status,
    latest,
    current: stops[index],
    next: stops[index + 1] ?? null,
    stops: stops.map((stop, stopIndex) => ({
      name: stop.port.name,
      country: stop.port.country,
      at: stop.at,
      state: status === 'planned' || stopIndex > index ? 'planned' : stopIndex === index ? 'current' : 'visited',
    })),
  }
}

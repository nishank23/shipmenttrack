/**
 * Popular container trade lanes shown on the sign-in globe.
 *
 * Waypoints trace a plausible sea path (straits, canals and capes) so legs
 * never cut across land; only waypoints with a `name` are ports or passages
 * the lane stops at. Transit times are typical published ranges for
 * illustration, not ShipTrack or customer data.
 */
export const TRADE_LANES = [
  {
    id: 'asia-europe',
    title: 'Shanghai → Rotterdam',
    subtitle: 'Asia–Europe via Suez · typically 30–35 days',
    badge: 'Example lane',
    focus: { from: { lat: 18, lon: 108 }, to: { lat: 40, lon: 14 } },
    waypoints: [
      { lat: 31.23, lon: 121.8, name: 'Shanghai' },
      { lat: 24.5, lon: 119.8 },
      { lat: 20.5, lon: 114.5 },
      { lat: 10, lon: 109.5 },
      { lat: 1.25, lon: 103.9, name: 'Singapore' },
      { lat: 5.8, lon: 97 },
      { lat: 5.8, lon: 80.5 },
      { lat: 12.3, lon: 52 },
      { lat: 12.6, lon: 43.4 },
      { lat: 20.5, lon: 38.4 },
      { lat: 27.6, lon: 33.9 },
      { lat: 30.1, lon: 32.55, name: 'Suez Canal' },
      { lat: 31.6, lon: 32.2 },
      { lat: 34.2, lon: 24.5 },
      { lat: 37.1, lon: 11.5 },
      { lat: 37.4, lon: 0 },
      { lat: 35.95, lon: -5.6 },
      { lat: 37.1, lon: -9.4 },
      { lat: 43.6, lon: -9.8 },
      { lat: 48.6, lon: -5.6 },
      { lat: 50.4, lon: 0.5 },
      { lat: 51.95, lon: 4.05, name: 'Rotterdam', label: 'Rotterdam · ~32 days' },
    ],
    events: [
      { title: 'Loaded on vessel', place: 'Shanghai, China' },
      { title: 'Transshipment', place: 'Singapore' },
      { title: 'Canal transit', place: 'Suez Canal, Egypt' },
      { title: 'Arrives at Rotterdam', place: 'Rotterdam, Netherlands · about 32 days' },
    ],
  },
  {
    id: 'transpacific',
    title: 'Shanghai → Los Angeles',
    subtitle: 'Transpacific eastbound · typically 14–18 days',
    badge: 'Example lane',
    focus: { from: { lat: 26, lon: 150 }, to: { lat: 30, lon: 215 } },
    waypoints: [
      { lat: 31.23, lon: 121.8, name: 'Shanghai' },
      { lat: 30.5, lon: 128 },
      { lat: 33.2, lon: 136 },
      { lat: 38.5, lon: 155 },
      { lat: 41.5, lon: 175 },
      { lat: 41.5, lon: -165 },
      { lat: 38.5, lon: -145 },
      { lat: 33.72, lon: -118.27, name: 'Los Angeles', label: 'Los Angeles · ~16 days' },
    ],
    events: [
      { title: 'Loaded on vessel', place: 'Shanghai, China' },
      { title: 'Arrives at Los Angeles', place: 'Los Angeles, United States · about 16 days' },
    ],
  },
  {
    id: 'transatlantic',
    title: 'Rotterdam → New York',
    subtitle: 'Transatlantic westbound · typically 9–12 days',
    badge: 'Example lane',
    focus: { from: { lat: 48, lon: -8 }, to: { lat: 42, lon: -52 } },
    waypoints: [
      { lat: 51.95, lon: 4.05, name: 'Rotterdam' },
      { lat: 50.4, lon: 0.5 },
      { lat: 49.4, lon: -5.8 },
      { lat: 46, lon: -30 },
      { lat: 41.5, lon: -60 },
      { lat: 40.55, lon: -73.9, name: 'New York', label: 'New York · ~10 days' },
    ],
    events: [
      { title: 'Loaded on vessel', place: 'Rotterdam, Netherlands' },
      { title: 'Arrives at New York', place: 'New York, United States · about 10 days' },
    ],
  },
  {
    id: 'asia-middle-east',
    title: 'Singapore → Jebel Ali',
    subtitle: 'Asia–Middle East · typically 8–11 days',
    badge: 'Example lane',
    focus: { from: { lat: 6, lon: 98 }, to: { lat: 21, lon: 62 } },
    waypoints: [
      { lat: 1.25, lon: 103.9, name: 'Singapore' },
      { lat: 5.8, lon: 97 },
      { lat: 5.8, lon: 80.5 },
      { lat: 15, lon: 66 },
      { lat: 22.8, lon: 60 },
      { lat: 25.6, lon: 57.4 },
      { lat: 26.55, lon: 56.4 },
      { lat: 25.9, lon: 55.2 },
      { lat: 25.01, lon: 55.06, name: 'Jebel Ali', label: 'Jebel Ali · ~9 days' },
    ],
    events: [
      { title: 'Loaded on vessel', place: 'Singapore' },
      { title: 'Arrives at Jebel Ali', place: 'Dubai, United Arab Emirates · about 9 days' },
    ],
  },
  {
    id: 'asia-south-america',
    title: 'Shanghai → Santos',
    subtitle: 'Asia–Brazil via the Cape · typically 35–40 days',
    badge: 'Example lane',
    focus: { from: { lat: 12, lon: 108 }, to: { lat: -28, lon: -28 } },
    waypoints: [
      { lat: 31.23, lon: 121.8, name: 'Shanghai' },
      { lat: 24.5, lon: 119.8 },
      { lat: 20.5, lon: 114.5 },
      { lat: 10, lon: 109.5 },
      { lat: 1.25, lon: 103.9, name: 'Singapore' },
      { lat: 5.8, lon: 97 },
      { lat: -8, lon: 82 },
      { lat: -28, lon: 45 },
      { lat: -35.6, lon: 25 },
      { lat: -35.2, lon: 18.5, name: 'Cape of Good Hope' },
      { lat: -30, lon: 0 },
      { lat: -25.5, lon: -38 },
      { lat: -23.98, lon: -46.3, name: 'Santos', label: 'Santos · ~38 days' },
    ],
    events: [
      { title: 'Loaded on vessel', place: 'Shanghai, China' },
      { title: 'Transshipment', place: 'Singapore' },
      { title: 'Rounding the Cape', place: 'Cape of Good Hope, South Africa' },
      { title: 'Arrives at Santos', place: 'Santos, Brazil · about 38 days' },
    ],
  },
  {
    id: 'asia-us-east-coast',
    title: 'Shanghai → New York',
    subtitle: 'Asia–US East Coast via Panama · typically 30–35 days',
    badge: 'Example lane',
    focus: { from: { lat: 26, lon: 150 }, to: { lat: 24, lon: 282 } },
    waypoints: [
      { lat: 31.23, lon: 121.8, name: 'Shanghai' },
      { lat: 30.5, lon: 128 },
      { lat: 33.2, lon: 136 },
      { lat: 30, lon: 160 },
      { lat: 22, lon: -160 },
      { lat: 14, lon: -120 },
      { lat: 7.5, lon: -88 },
      { lat: 8.7, lon: -79.55, name: 'Panama Canal' },
      { lat: 9.45, lon: -79.9 },
      { lat: 14, lon: -77.5 },
      { lat: 19.9, lon: -73.9 },
      { lat: 25.5, lon: -74 },
      { lat: 34, lon: -73.5 },
      { lat: 40.55, lon: -73.9, name: 'New York', label: 'New York · ~32 days' },
    ],
    events: [
      { title: 'Loaded on vessel', place: 'Shanghai, China' },
      { title: 'Canal transit', place: 'Panama Canal, Panama' },
      { title: 'Arrives at New York', place: 'New York, United States · about 32 days' },
    ],
  },
]

function toUnit(lat, lon) {
  const phi = ((90 - lat) * Math.PI) / 180
  const theta = ((lon + 180) * Math.PI) / 180
  return [-Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta)]
}

function angleBetween(a, b) {
  const dot = Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))
  return Math.acos(dot)
}

/**
 * Samples a lane along great-circle legs between waypoints. Returns unit-sphere
 * points with a gentle lift over the whole lane, and the arc-length fraction at
 * every waypoint and at each named stop (in order).
 */
export function buildLane(lane, { radius = 1, altitude = 0.006, hump = 0.03 } = {}) {
  const units = lane.waypoints.map((point) => toUnit(point.lat, point.lon))
  const raw = []
  const waypointAt = [0]

  units.slice(0, -1).forEach((a, leg) => {
    const b = units[leg + 1]
    const angle = angleBetween(a, b)
    const steps = Math.max(4, Math.ceil(angle / 0.012))
    const sin = Math.sin(angle) || 1
    for (let step = leg === 0 ? 0 : 1; step <= steps; step += 1) {
      const t = step / steps
      const wa = angle ? Math.sin((1 - t) * angle) / sin : 1 - t
      const wb = angle ? Math.sin(t * angle) / sin : t
      const x = a[0] * wa + b[0] * wb
      const y = a[1] * wa + b[1] * wb
      const z = a[2] * wa + b[2] * wb
      const length = Math.hypot(x, y, z) || 1
      raw.push([x / length, y / length, z / length])
    }
    waypointAt.push(raw.length - 1)
  })

  const cumulative = [0]
  for (let index = 1; index < raw.length; index += 1) {
    cumulative.push(cumulative[index - 1] + angleBetween(raw[index - 1], raw[index]))
  }
  const total = cumulative[cumulative.length - 1] || 1

  // Sea lanes hug the surface with one gentle lift; a lane of straight port
  // to port legs (`legArcs`) lifts each leg on its own, higher for longer legs,
  // so a leg reads as a hop between ports rather than a path over land.
  let leg = 0
  const points = raw.map((point, index) => {
    let lift
    if (lane.legArcs) {
      while (leg < waypointAt.length - 2 && index > waypointAt[leg + 1]) leg += 1
      const start = cumulative[waypointAt[leg]]
      const span = cumulative[waypointAt[leg + 1]] - start
      lift = span ? Math.sin(Math.PI * ((cumulative[index] - start) / span)) * Math.min(0.14, span * 0.16) : 0
    } else {
      lift = Math.sin(Math.PI * (cumulative[index] / total)) * hump
    }
    const r = radius + altitude + lift
    return [point[0] * r, point[1] * r, point[2] * r]
  })

  const waypointFractions = waypointAt.map((index) => cumulative[index] / total)
  return {
    points,
    waypointFractions,
    stopFractions: waypointFractions.filter((_, index) => lane.waypoints[index].name),
    stops: lane.waypoints.filter((point) => point.name),
  }
}

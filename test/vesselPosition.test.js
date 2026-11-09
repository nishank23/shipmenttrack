import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fetchShiptrailPosition, fetchVesselPosition, getVesselAtSea, toVesselPosition } from '../functions/lib/vesselPosition.js'

const event = (title, occurredAt, extra = {}) => ({ title, occurredAt: new Date(occurredAt), estimated: false, vesselImo: '', ...extra })

test('the vessel is looked up only while the box is at sea', () => {
  const loaded = event('Export Loaded on Vessel', '2026-10-31', { vesselImo: '9328493' })
  assert.deepEqual(getVesselAtSea([event('Export received at CY', '2026-10-26'), loaded]), { name: '', voyage: '', imo: '9328493', since: new Date('2026-10-31') })
  // Discharged at transshipment: ashore.
  assert.equal(getVesselAtSea([loaded, event('Full Transshipment Discharged', '2026-11-05', { vesselImo: '9328493' })]), null)
  // "Unloaded" is not a departure.
  assert.equal(getVesselAtSea([event('Unloaded from vessel', '2026-11-05', { vesselImo: '9328493' })]), null)
  // Planned moves don't count, and carriers without an IMO give nothing.
  assert.equal(getVesselAtSea([loaded, { ...event('Transshipment Loaded', '2026-11-13', { vesselImo: '9224324' }), estimated: true }]).imo, '9328493')
  // Carriers without an IMO still name the vessel and voyage.
  assert.deepEqual(getVesselAtSea([event('Vessel Loading', '2026-03-20', { vessel: 'KOTA NIPAH', voyage: 'KNPH0177W' })]), { name: 'KOTA NIPAH', voyage: 'KNPH0177W', imo: '', since: new Date('2026-03-20') })
  assert.equal(getVesselAtSea([event('Vessel Loading', '2026-03-20')]), null)
})

test('a VesselFinder AIS record becomes vesselPosition', () => {
  const position = toVesselPosition({
    AIS: { MMSI: 538003777, IMO: 9441271, NAME: 'M/V CANARY', LATITUDE: 36.28361, LONGITUDE: -3.5416, SPEED: 11.2, COURSE: 260, TIMESTAMP: '2017-08-11 11:18:05 UTC', DESTINATION: 'GIBRALTAR' },
  })
  assert.equal(position.lat, 36.28361)
  assert.equal(position.lon, -3.5416)
  assert.equal(position.vesselName, 'M/V CANARY')
  assert.equal(position.reportedAt.toISOString(), '2017-08-11T11:18:05.000Z')
  assert.equal(toVesselPosition({ AIS: { LATITUDE: 'x', LONGITUDE: 1 } }), null)
})

test('VesselFinder errors throw; empty results give null', async () => {
  const http = (data) => ({ get: async () => ({ data }) })
  await assert.rejects(fetchVesselPosition({ imo: '9441271', apiKey: 'k', http: http({ error: 'Insufficient credits' }) }), /Insufficient credits/)
  assert.equal(await fetchVesselPosition({ imo: '9441271', apiKey: 'k', http: http([]) }), null)
})

// Fake Shiptrail MCP endpoint: answers search_ships and get_ship.
function shiptrail({ ships, ship }) {
  const calls = []
  return {
    calls,
    post: async (_url, body) => {
      calls.push(body.params.name)
      const structuredContent = body.params.name === 'search_ships' ? { ships } : ship
      return { data: { jsonrpc: '2.0', id: 1, result: { structuredContent } } }
    },
  }
}

const vessel = { name: 'KOTA NIPAH', voyage: 'KNPH0177W', imo: '', since: new Date('2026-04-11T00:00:00Z') }
const kotaNipah = {
  mmsi: 566118000, name: 'KOTA NIPAH', imo: 9593696, speedKn: 14.2, courseDeg: 250,
  position: { lat: -8.5, lon: 70.2, at: '2026-04-20T08:00:00Z' },
  voyage: { boundFor: { name: 'Maputo' } }, url: 'https://shiptrail.io/vessel/566118000-kota-nipah',
}

test('Shiptrail: exact name match gives the live position', async () => {
  const http = shiptrail({ ships: [{ mmsi: 566118000, name: 'KOTA NIPAH' }], ship: kotaNipah })
  const position = await fetchShiptrailPosition({ vessel, http })
  assert.deepEqual(http.calls, ['search_ships', 'get_ship'])
  assert.equal(position.lat, -8.5)
  assert.equal(position.mmsi, '566118000')
  assert.equal(position.source, 'shiptrail')
  assert.equal(position.destination, 'Maputo')
})

test('Shiptrail: look-alike names, stale fixes and IMO mismatches are rejected', async () => {
  const nearMatch = shiptrail({ ships: [{ mmsi: 372354000, name: 'EVER BRAVE', nearMatch: true }], ship: kotaNipah })
  assert.equal(await fetchShiptrailPosition({ vessel: { ...vessel, name: 'EVER BRACE' }, http: nearMatch }), null)

  const stale = shiptrail({ ships: [], ship: { ...kotaNipah, position: { lat: 1, lon: 2, at: '2026-03-01T00:00:00Z' } } })
  assert.equal(await fetchShiptrailPosition({ vessel, knownMmsi: '566118000', http: stale }), null)
  assert.deepEqual(stale.calls, ['get_ship'])

  const wrongImo = shiptrail({ ships: [], ship: kotaNipah })
  assert.equal(await fetchShiptrailPosition({ vessel: { ...vessel, imo: '1234567' }, knownMmsi: '566118000', http: wrongImo }), null)
})

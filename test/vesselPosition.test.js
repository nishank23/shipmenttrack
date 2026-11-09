import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fetchVesselPosition, getVesselAtSea, toVesselPosition } from '../functions/lib/vesselPosition.js'

const event = (title, occurredAt, extra = {}) => ({ title, occurredAt: new Date(occurredAt), estimated: false, vesselImo: '', ...extra })

test('the vessel is looked up only while the box is at sea', () => {
  const loaded = event('Export Loaded on Vessel', '2026-10-31', { vesselImo: '9328493' })
  assert.deepEqual(getVesselAtSea([event('Export received at CY', '2026-10-26'), loaded]), { imo: '9328493' })
  // Discharged at transshipment: ashore.
  assert.equal(getVesselAtSea([loaded, event('Full Transshipment Discharged', '2026-11-05', { vesselImo: '9328493' })]), null)
  // "Unloaded" is not a departure.
  assert.equal(getVesselAtSea([event('Unloaded from vessel', '2026-11-05', { vesselImo: '9328493' })]), null)
  // Planned moves don't count, and carriers without an IMO give nothing.
  assert.deepEqual(getVesselAtSea([loaded, { ...event('Transshipment Loaded', '2026-11-13', { vesselImo: '9224324' }), estimated: true }]), { imo: '9328493' })
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

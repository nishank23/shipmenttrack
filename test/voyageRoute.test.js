import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolvePort } from '../src/lib/portLocations.js'
import { getCheckpointHistory } from '../src/lib/shipmentDetail.js'
import { getVoyageRoute } from '../src/lib/voyageRoute.js'

const now = Date.parse('2026-11-10T12:00:00Z')

test('carrier location strings resolve to ports by name, alias or LOCODE', () => {
  assert.equal(resolvePort('MAPUTO, MZ')?.name, 'Maputo')
  assert.equal(resolvePort('SINGAPORE CMA CGM PSA LION TERMINAL')?.name, 'Singapore')
  assert.equal(resolvePort('MZMPM')?.name, 'Maputo')
  assert.equal(resolvePort('PORT ELIZABETH, ZA')?.name, 'Port Elizabeth')
  assert.equal(resolvePort('LOMBOK'), null)
  assert.equal(resolvePort(''), null)
})

test('a departure puts the vessel part-way along the next leg by time', () => {
  const history = getCheckpointHistory({
    events: [
      { title: 'Export Loaded on Vessel', location: 'SURABAYA, ID', occurredAt: '2026-10-01T00:00:00Z' },
      { title: 'Transshipment Discharged', location: 'SINGAPORE, SG', occurredAt: '2026-10-06T00:00:00Z' },
      { title: 'Transshipment Loaded on Vessel', location: 'SINGAPORE, SG', occurredAt: '2026-11-01T00:00:00Z' },
      { title: 'Estimated arrival', location: 'MAPUTO, MZ', occurredAt: '2026-11-19T00:00:00Z', estimated: true },
    ],
  }, null, now)
  const route = getVoyageRoute(history, { now })
  assert.deepEqual(route.stops.map(({ name, state }) => [name, state]), [
    ['Surabaya', 'visited'], ['Singapore', 'current'], ['Maputo', 'planned'],
  ])
  assert.equal(route.status, 'in-transit')
  assert.equal(route.next.port.name, 'Maputo')
  assert.ok(route.progress > 0.25 && route.progress < 0.9, `progress ${route.progress}`)
  assert.match(route.lane.waypoints.at(-1).label, /^Maputo · ETA Nov 19$/)
})

test('discharge at the last port marks the voyage arrived', () => {
  const history = getCheckpointHistory({
    events: [
      { title: 'Export Loaded on Vessel', location: 'SINGAPORE, SG', occurredAt: '2026-10-20T00:00:00Z' },
      { title: 'Import Discharged from Vessel', location: 'MAPUTO, MZ', occurredAt: '2026-11-07T00:00:00Z' },
    ],
  }, null, now)
  const route = getVoyageRoute(history, { now })
  assert.equal(route.status, 'arrived')
  assert.equal(route.progress, 1)
  assert.equal(route.lane.waypoints.at(-1).label, 'Maputo · Arrived Nov 7')
})

test('a live position becomes the vessel waypoint', () => {
  const history = getCheckpointHistory({
    events: [
      { title: 'Export Loaded on Vessel', location: 'SINGAPORE, SG', occurredAt: '2026-11-01T00:00:00Z' },
      { title: 'Estimated arrival', location: 'MAPUTO, MZ', occurredAt: '2026-11-19T00:00:00Z', estimated: true },
    ],
  }, null, now)
  const route = getVoyageRoute(history, { now, position: { lat: -10, lon: 70 } })
  assert.equal(route.status, 'live')
  assert.equal(route.lane.waypoints.length, 3)
  assert.ok(route.progress > 0 && route.progress < 1)
})

test('fewer than two known ports gives no route', () => {
  const history = getCheckpointHistory({ events: [{ title: 'Gate in', location: 'MAPUTO, MZ', occurredAt: '2026-11-01T00:00:00Z' }] }, null, now)
  assert.equal(getVoyageRoute(history, { now }), null)
})

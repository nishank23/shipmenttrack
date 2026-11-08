import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getCarrierBrand } from '../src/lib/carriers.js'
import { getCheckpointHistory, getPlannedCheckpointGroups, getRouteCheckpoints, toTrackingDate } from '../src/lib/shipmentDetail.js'

const now = Date.parse('2026-11-07T14:30:00Z')
const older = { id: '1', title: 'Loaded on vessel', occurredAt: '2026-11-01T10:30:00Z', location: 'Port Klang' }
const latest = { id: '2', title: 'Vessel departure', occurredAt: '2026-11-07T10:30:00Z', location: 'Durban' }
const forecast = { id: '3', title: 'Estimated arrival', occurredAt: '2026-11-07T11:30:00Z', location: 'Maputo' }

test('forecasts and future checkpoints never become the latest reported checkpoint', () => {
  const future = { ...latest, occurredAt: '2026-11-08T14:30:00Z', estimated: false }
  const history = getCheckpointHistory({ events: [older, future, forecast, latest] }, latest, now)
  assert.deepEqual(history.reported.map(({ location }) => location), ['Durban', 'Port Klang'])
  assert.deepEqual(history.planned.map(({ location }) => location), ['Maputo', 'Durban'])
  const route = getRouteCheckpoints(history.reported)
  assert.equal(route.first.location, 'Port Klang')
  assert.equal(route.last.location, 'Durban')
})

test('shows a shared planned checkpoint once while keeping all three container IDs and the per-container filter', () => {
  const containers = ['MSCU1000001', 'MSCU1000002', 'MSCU1000003']
  const shared = { ...forecast, description: 'MSC HINA / JO640A' }
  const events = [
    ...containers.map((container) => ({ ...shared, container })),
    { ...shared, container: containers[0] },
    ...containers.map((container) => ({ ...latest, container })),
  ]
  const history = getCheckpointHistory({ events }, null, now)
  const all = getPlannedCheckpointGroups(history.planned)
  assert.equal(all.length, 1)
  assert.deepEqual(all[0].containers, containers)
  assert.equal(all[0].description, shared.description)
  for (const container of containers) {
    assert.deepEqual(getPlannedCheckpointGroups(history.planned, container).map((group) => group.containers), [[container]])
  }
  assert.equal(history.planned.length, 4)
  assert.equal(history.reported.length, 3)
})

test('does not merge plans that differ by event, date, port, or vessel, or lack a date or container', () => {
  const base = { ...forecast, container: 'MSCU1000001', description: 'MSC HINA / JO640A' }
  const next = { ...base, container: 'MSCU1000002' }
  const events = [
    base,
    { ...next, title: 'Estimated departure' },
    { ...next, location: 'Durban' },
    { ...next, description: 'MSC JAGUAR / ZF629A' },
    { ...next, occurredAt: '2026-11-08T14:30:00Z' },
    { ...base, occurredAt: null },
    { ...next, occurredAt: null },
    { ...next, container: '' },
  ]
  const { planned } = getCheckpointHistory({ events }, null, now)
  assert.deepEqual(getPlannedCheckpointGroups(planned).map((group) => group.id), planned.map((event) => event.id))
})

test('uses a saved checkpoint when cache is missing and does not invent a second location', () => {
  const history = getCheckpointHistory(null, latest, now)
  const route = getRouteCheckpoints(history.reported)
  assert.equal(route.first, null)
  assert.equal(route.last.location, 'Durban')
  assert.equal(getRouteCheckpoints(getCheckpointHistory({ events: [forecast] }, forecast, now).reported).last, null)
})

test('accepts legacy checkpoint shapes and invalid dates without breaking the timeline', () => {
  const history = getCheckpointHistory({ statusEvents: [null, 'Undated event', {
    status: 'Vessel departure', date: '2026-11-07T10:30:00Z', port: 'Durban', container: 'mscu123',
  }] }, null, now)
  assert.equal(history.reported[0].container, 'MSCU123')
  assert.equal(history.reported[1].occurredAt, null)
  assert.equal(toTrackingDate('unparseable'), null)
  assert.equal(toTrackingDate({ toDate: () => new Date(now) }).getTime(), now)
})

test('carrier marks are local and unknown carriers have a text fallback', () => {
  assert.equal(getCarrierBrand(' msc ').logo, '/carrier-marks/msc.svg')
  assert.equal(getCarrierBrand('PIL').label, 'PIL')
  assert.equal(getCarrierBrand('PIL').logo, '')
  assert.equal(getCarrierBrand().label, 'Unknown')
})

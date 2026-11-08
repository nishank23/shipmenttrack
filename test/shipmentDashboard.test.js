import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getManifestSelection, getNextShipment, getShipmentEta, isArrivalEvent, selectShipments } from '../src/lib/shipmentDashboard.js'

const now = new Date(2026, 3, 15, 12)
const arrival = (offset, hour = 12) => new Date(2026, 3, 15 + offset, hour)
const row = (id, eta, latestEvent = {}, carrier = 'MSC') => ({
  id, eta, latestEvent, carrier, invoiceNo: `INV-${id}`, blNo: `BL-${id}`, ...getShipmentEta(eta, now),
})

test('ETA windows are calendar-based and keep missing dates separate from later dates', () => {
  assert.deepEqual(getShipmentEta(arrival(0, 0), now), { daysLeft: 0, bucket: 'week' })
  assert.deepEqual(getShipmentEta(arrival(-1), now), { daysLeft: -1, bucket: 'overdue' })
  assert.equal(getShipmentEta(arrival(7), now).bucket, 'week')
  assert.equal(getShipmentEta(arrival(8), now).bucket, 'fortnight')
  assert.equal(getShipmentEta(arrival(14), now).bucket, 'fortnight')
  assert.equal(getShipmentEta(arrival(15), now).bucket, 'later')
  assert.deepEqual(getShipmentEta(null, now), { daysLeft: null, bucket: 'missing' })
})

test('manifest opens only the requested shipment while it remains visible', () => {
  const rows = [row('5', arrival(4)), row('2', arrival(1), { title: 'Delivered to consignee' }), row('0', null)]
  assert.equal(getManifestSelection(rows, '2'), rows[1])
  assert.equal(getManifestSelection(rows.toReversed(), '2'), rows[1])
  assert.equal(getManifestSelection([rows[0], rows[2]], '2'), null)
  assert.equal(getManifestSelection([rows[2]], null), null)
  assert.equal(getManifestSelection([], '2'), null)
})

test('next arrival is the earliest upcoming ETA, regardless of manifest order', () => {
  const rows = [row('1', arrival(-1)), row('2', null), row('3', arrival(2)), row('4', arrival(0, 8)), row('5', arrival(0, 18))]
  assert.equal(getNextShipment(rows), rows[3])
  assert.equal(getNextShipment(rows.toReversed()), rows[3])
  assert.equal(getNextShipment(rows.slice(0, 2)), null)
})

test('the register searches actual event wording and does not hide records by inferred status', () => {
  const rows = [row('10', arrival(2), { title: 'Loaded at transshipment port', location: 'Port Klang' }, 'ONE'),
    row('2', arrival(3), { title: 'Loaded at transshipment port', location: 'Port Klang' }, 'ONE'),
    row('3', null, { title: 'Delivered', location: 'Durban' }), row('4', arrival(15), { title: 'In transit' })]
  const options = { carrier: 'ONE', window: 'week', search: 'one transshipment klang', sort: 'latest' }
  const ids = (filters) => selectShipments(rows, { ...options, ...filters }).map(({ id }) => id)
  assert.deepEqual(ids({}), ['2', '10'])
  assert.deepEqual(ids({ sort: 'earliest' }), ['10', '2'])
  assert.deepEqual(ids({ sort: 'invoice' }), ['2', '10'])
  assert.deepEqual(ids({ carrier: 'all', window: 'all', search: '', sort: 'earliest' }), ['10', '2', '4', '3'])
  assert.deepEqual(ids({ carrier: 'all', window: 'missing', search: '' }), ['3'])
  assert.deepEqual(ids({ carrier: 'all', window: 'later', search: '' }), ['4'])
})

test('a destination discharge marks the shipment arrived even after its ETA has passed', () => {
  const discharged = { title: 'Import Discharged from Vessel', location: 'MAPUTO, MZ', occurredAt: arrival(-1) }
  assert.deepEqual(getShipmentEta(arrival(-3), now, discharged), { daysLeft: null, bucket: 'arrived', arrivedAt: arrival(-1) })
  assert.equal(isArrivalEvent({ title: 'Full Transshipment Discharged' }), false)
  assert.equal(isArrivalEvent({ title: 'Empty received at CY' }), true)
  assert.equal(isArrivalEvent({ title: 'Delivered', estimated: true }), false)
  assert.equal(getShipmentEta(arrival(-3), now, { title: 'Full Transshipment Loaded' }).bucket, 'overdue')
  assert.equal(getNextShipment([{ ...row('9', arrival(2)), ...getShipmentEta(arrival(2), now, discharged), eta: arrival(2) }]), null)
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getShipmentNotificationKind } from '../functions/lib/notificationPreferences.js'
import { getProfileSettings, validateProfileSettings } from '../src/lib/profileSettings.js'
import { filterArchive, getArchiveDeliveryDate } from '../src/lib/shipmentArchive.js'

test('archive filters combine range, carrier and normalized tracking search', () => {
  const now = new Date(2026, 10, 7, 12).getTime()
  const shipments = [
    { id: 'recent', archivedAt: new Date(2026, 10, 1), invoiceNo: 'INV-1', blNo: 'MEDU-1234', carrier: 'MSC' },
    { id: 'older', archivedAt: new Date(2026, 8, 15), invoiceNo: 'INV-2', blNo: 'MEDU-1234', carrier: 'MSC' },
    { id: 'other', archivedAt: new Date(2026, 10, 1), invoiceNo: 'INV-3', blNo: 'MEDU-1234', carrier: 'ONE' },
  ]
  const ids = (range) => filterArchive(shipments, { range, carrier: 'MSC', search: 'medu1234' }, now).map(({ id }) => id)
  assert.deepEqual(ids('30'), ['recent'])
  assert.deepEqual(ids('90'), ['recent', 'older'])
})

test('delivery date filtering and sorting do not use archive dates for unknown deliveries', () => {
  const now = new Date(2026, 10, 7, 12).getTime()
  const shipments = [
    { id: 'unknown', archivedAt: new Date(2026, 10, 6), blNo: 'MEDU-1234', carrier: 'MSC' },
    { id: 'earlier', archivedAt: new Date(2026, 10, 4), deliveredAt: new Date(2026, 8, 25), blNo: 'MEDU-2345', carrier: 'MSC' },
    { id: 'later', archivedAt: new Date(2026, 10, 3), deliveredAt: new Date(2026, 10, 2), blNo: 'MEDU-3456', carrier: 'MSC' },
    { id: 'other-carrier', archivedAt: new Date(2026, 10, 5), deliveredAt: new Date(2026, 10, 4), blNo: 'ONEY-4567', carrier: 'ONE' },
  ]
  const ids = (range, dateField) => filterArchive(shipments, { range, dateField, carrier: 'MSC', search: 'medu' }, now).map(({ id }) => id)
  assert.deepEqual(ids('30', 'archivedAt'), ['unknown', 'earlier', 'later'])
  assert.deepEqual(ids('30', 'deliveredAt'), ['later'])
  assert.deepEqual(ids('all', 'deliveredAt'), ['later', 'earlier', 'unknown'])
})

test('delivery dates never come from ETA, archive date or a partial container move', () => {
  const now = Date.parse('2026-11-07T12:00:00Z')
  const occurredAt = '2026-11-06T12:00:00Z'
  assert.equal(getArchiveDeliveryDate({ archiveReason: 'empty-returned', archivedAt: occurredAt, eta: occurredAt }, now), null)
  assert.equal(getArchiveDeliveryDate({ latestEvent: { title: 'Port arrival', occurredAt } }, now), null)
  assert.equal(getArchiveDeliveryDate({ latestEvent: { title: 'Delivered', occurredAt, container: 'MSCU1234' }, containerNumbers: ['MSCU1234', 'MSCU1235'] }, now), null)
  assert.equal(getArchiveDeliveryDate({ latestEvent: { title: 'Delivered to consignee', occurredAt } }, now).toISOString(), occurredAt.replace('Z', '.000Z'))
  const latestEvent = { title: 'Delivered', occurredAt, container: 'MSCU1234' }
  assert.equal(getArchiveDeliveryDate({ latestEvent, containerNumbers: 'MSCU1234\nMSCU1235' }, now), null)
  assert.equal(getArchiveDeliveryDate({ latestEvent, containerNumbers: 'MSCU1234' }, now).toISOString(), occurredAt.replace('Z', '.000Z'))
})

test('profile settings preserve legacy emails and validate only enabled delivery options', () => {
  const user = { displayName: 'Harbor Operations', email: 'ops@example.test' }
  const defaults = getProfileSettings(user)
  assert.equal(defaults.arrivalReminders, true)
  assert.equal(defaults.etaUpdates, true)
  const disabled = getProfileSettings(user, { defaultCarrier: ' msc ', arrivalReminders: false, etaUpdates: false })
  assert.equal(disabled.defaultCarrier, 'MSC')
  assert.deepEqual(validateProfileSettings({ ...disabled, alertEmail: '', alertDays: '' }), {})
  assert.deepEqual(Object.keys(validateProfileSettings({ ...defaults, alertEmail: 'invalid', alertDays: '31' })), ['alertEmail', 'alertDays'])
})

test('notification preferences retain ETA priority and independently disable each category', () => {
  const shipment = { daysRemaining: 2, etaChanged: true }
  assert.equal(getShipmentNotificationKind(shipment, {}, 14), 'eta-update')
  assert.equal(getShipmentNotificationKind(shipment, { etaUpdates: false }, 14), 'arrival-reminder')
  assert.equal(getShipmentNotificationKind(shipment, { arrivalReminders: false }, 14), 'eta-update')
  assert.equal(getShipmentNotificationKind(shipment, { arrivalReminders: false, etaUpdates: false }, 14), null)
  assert.equal(getShipmentNotificationKind({ ...shipment, archived: true }, {}, 14), null)
})

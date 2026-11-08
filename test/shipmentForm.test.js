import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isTrackingNumber, normalizeTrackingNumber, resolveFormCarrier, validateShipmentForm } from '../src/lib/shipmentForm.js'

test('pasted B/L numbers normalize without changing hyphens or truncating the reference', () => {
  assert.equal(normalizeTrackingNumber('  medu-123 4567\n'), 'MEDU-1234567')
  assert.equal(isTrackingNumber('  medu-123 4567\n'), true)
  assert.equal(isTrackingNumber('MEDU' + '9'.repeat(37)), false)
  assert.equal(isTrackingNumber('!MEDU123'), false)
  assert.equal(isTrackingNumber('----'), false)
})

test('known prefixes win over a manual fallback, as in the lookup service', () => {
  assert.equal(resolveFormCarrier('oney123456', 'MSC'), 'ONE')
  assert.equal(resolveFormCarrier('sub123456', ''), 'PIL')
  assert.equal(resolveFormCarrier('REF1234', ' evergreen '), 'EVERGREEN')
  assert.equal(resolveFormCarrier('REF1234', ''), '')
})

test('validates required fields in focus order and permits manual ETA without a carrier', () => {
  const fields = { blNo: '', invoiceNo: '', eta: '', invAmount: '' }
  assert.deepEqual(Object.keys(validateShipmentForm(fields)), ['blNo', 'invoiceNo', 'eta'])
  assert.deepEqual(validateShipmentForm({ ...fields, blNo: 'REF1234', invoiceNo: 'INV-88', eta: '2026-11-12' }), {})
  assert.match(validateShipmentForm({ ...fields, invAmount: '-1' }).invAmount, /zero or more/)
})

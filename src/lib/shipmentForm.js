import { detectCarrierFromBlNumber } from './carriers.js'

export function normalizeTrackingNumber(value) {
  return String(value ?? '').toUpperCase().replace(/\s+/g, '')
}

export function isTrackingNumber(value) {
  return /^(?=.*[A-Z0-9])[A-Z0-9-]{4,40}$/.test(normalizeTrackingNumber(value))
}

export function resolveFormCarrier(blNo, manualCarrier) {
  return detectCarrierFromBlNumber(blNo) || String(manualCarrier ?? '').trim().toUpperCase()
}

export function validateShipmentForm(values) {
  const errors = {}
  if (!normalizeTrackingNumber(values.blNo)) errors.blNo = 'Enter a B/L number.'
  else if (!isTrackingNumber(values.blNo)) errors.blNo = 'Use 4 to 40 letters, numbers, or hyphens.'
  if (!values.invoiceNo.trim()) errors.invoiceNo = 'Enter an invoice number.'
  if (!values.eta) errors.eta = 'Choose an estimated arrival date.'
  if (values.invAmount !== '' && (!Number.isFinite(Number(values.invAmount)) || Number(values.invAmount) < 0)) {
    errors.invAmount = 'Enter an invoice amount of zero or more.'
  }
  return errors
}

import { carriers } from './carriers.js'

export function normalizeDefaultCarrier(value) {
  const code = String(value ?? '').trim().toUpperCase()
  return carriers.some((carrier) => carrier.code === code) ? code : ''
}

export function getProfileSettings(user, data = {}) {
  return {
    displayName: data.name?.trim() || user.displayName?.trim() || '',
    alertEmail: data.alertEmail?.trim() || user.email || data.email?.trim() || '',
    alertDays: String(data.alertDays ?? 14),
    defaultCarrier: normalizeDefaultCarrier(data.defaultCarrier),
    arrivalReminders: data.arrivalReminders !== false,
    etaUpdates: data.etaUpdates !== false,
  }
}

export function validateProfileSettings(values) {
  const errors = {}
  if (!values.displayName.trim()) errors.displayName = 'Enter a display name.'
  if ((values.arrivalReminders || values.etaUpdates) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.alertEmail.trim())) {
    errors.alertEmail = 'Enter a valid alert email address.'
  }
  const days = Number(values.alertDays)
  if (values.arrivalReminders && (!Number.isInteger(days) || days < 1 || days > 30)) {
    errors.alertDays = 'Enter a whole number from 1 to 30.'
  }
  return errors
}

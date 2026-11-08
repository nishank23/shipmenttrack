// Single source of truth for carrier metadata on the frontend.
// Keep prefixes in sync with carrierPrefixMap in functions/index.js.
export const carriers = [
  {
    code: 'MSC',
    label: 'MSC',
    accent: '#ffcc00',
    mark: 'msc.svg',
    prefixes: ['MEDU', 'MSDU', 'MSNU', 'MSMU', 'MSCU'],
    badge: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-200',
  },
  {
    code: 'ONE',
    label: 'ONE',
    accent: '#bd0f72',
    mark: 'one.svg',
    prefixes: ['ONEY', 'BRDG'],
    badge: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-200',
  },
  {
    code: 'EVERGREEN',
    label: 'Evergreen',
    accent: '#008738',
    mark: 'evergreen.svg',
    prefixes: ['EGLV', 'EGSU', 'EGHU'],
    badge:
      'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200',
  },
  {
    code: 'PIL',
    label: 'PIL',
    prefixes: ['SUB', 'PIL'],
    badge: 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-200',
  },
]

const defaultBadge = 'bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-200'

function findCarrier(code) {
  const normalizedCode = String(code ?? '').trim().toUpperCase()
  return carriers.find((carrier) => carrier.code === normalizedCode)
}

export function detectCarrierFromBlNumber(value) {
  const sanitizedValue = String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')

  return (
    carriers.find((carrier) =>
      carrier.prefixes.some((prefix) => sanitizedValue.startsWith(prefix)),
    )?.code ?? ''
  )
}

export function getCarrierBadgeClass(code) {
  return findCarrier(code)?.badge ?? defaultBadge
}

export function getCarrierLabel(code) {
  return findCarrier(code)?.label ?? (String(code ?? '').trim() || 'Unknown')
}

export function getCarrierBrand(code) {
  const carrier = findCarrier(code)
  return {
    label: getCarrierLabel(code),
    accent: carrier?.accent ?? 'var(--st-accent)',
    logo: carrier?.mark ? `${import.meta.env?.BASE_URL ?? '/'}carrier-marks/${carrier.mark}` : '',
  }
}

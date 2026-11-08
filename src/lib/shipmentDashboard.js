import { getCarrierLabel } from './carriers.js'

const dayMs = 86400000
const calendarDay = (date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / dayMs

export function getShipmentEta(eta, now) {
  const daysLeft = eta ? calendarDay(eta) - calendarDay(now) : null
  const bucket = daysLeft === null ? 'missing'
    : daysLeft < 0 ? 'overdue' : daysLeft <= 7 ? 'week' : daysLeft <= 14 ? 'fortnight' : 'later'
  return { daysLeft, bucket }
}

export function getManifestSelection(shipments, selectedId) {
  return shipments.find(({ id }) => id === selectedId) ?? null
}

export function getNextShipment(shipments) {
  return shipments.reduce((next, shipment) =>
    shipment.eta && shipment.daysLeft >= 0 && (!next || shipment.eta < next.eta)
      ? shipment : next, null)
}

export function selectShipments(shipments, { carrier, window, search, sort }) {
  const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return shipments.filter((shipment) => {
    if (carrier !== 'all' && shipment.carrier !== carrier) return false
    if (window !== 'all' && shipment.bucket !== window) return false
    if (!terms.length) return true
    const text = [shipment.invoiceNo, shipment.blNo, shipment.consigneeName, getCarrierLabel(shipment.carrier),
      shipment.latestEvent?.title, shipment.latestEvent?.location].join(' ').toLowerCase()
    return terms.every((term) => text.includes(term))
  }).sort((a, b) => {
    const byEta = !a.eta || !b.eta ? Number(!a.eta) - Number(!b.eta)
      : (a.eta - b.eta) * (sort === 'latest' ? -1 : 1)
    return (sort !== 'invoice' && byEta) || a.invoiceNo.localeCompare(b.invoiceNo, undefined, { numeric: true })
  })
}

import { getCarrierLabel } from './carriers.js'

const dayMs = 86400000
const calendarDay = (date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / dayMs

// Carrier wording for "the box is at its destination". Transshipment
// discharges happen mid-voyage, so they never count.
const arrivalEvent = /\b(?:import discharged|discharged from vessel|discharged at (?:pod|destination)|unloaded from vessel at (?:pod|destination)|vessel arrival at (?:pod|destination)|arrived at (?:pod|destination)|delivered|import gate out|empty (?:container )?(?:received|returned))\b/i

export function isArrivalEvent(event) {
  return Boolean(event?.title && !event.estimated && !/transship/i.test(event.title) && arrivalEvent.test(event.title))
}

/**
 * ETA window for a shipment. Once the carrier reports the box discharged at
 * its destination, the shipment is 'arrived', whatever the old ETA said
 * (carriers usually drop the ETA at that point).
 */
export function getShipmentEta(eta, now, latestEvent = null) {
  if (isArrivalEvent(latestEvent)) {
    return { daysLeft: null, bucket: 'arrived', arrivedAt: latestEvent.occurredAt ?? null }
  }
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
    shipment.eta && typeof shipment.daysLeft === 'number' && shipment.daysLeft >= 0 && (!next || shipment.eta < next.eta)
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

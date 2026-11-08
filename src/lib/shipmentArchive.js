import { isDeliveryConfirmed } from './arrivalRunway.js'
import { getCarrierLabel } from './carriers.js'
import { toTrackingDate } from './shipmentDetail.js'

export function getArchiveDeliveryDate(shipment, now) {
  const deliveredAt = toTrackingDate(shipment.deliveredAt)
  if (deliveredAt && deliveredAt.getTime() <= now) return deliveredAt

  const event = shipment.latestEvent
  const occurredAt = toTrackingDate(event?.occurredAt)
  if (!occurredAt || occurredAt.getTime() > now) return null
  if (event.container) {
    const numbers = Array.isArray(shipment.containerNumbers) ? shipment.containerNumbers : String(shipment.containerNumbers ?? '').split(/[\s,]+/)
    const containers = new Set(numbers.map((value) => String(value ?? '').trim().toUpperCase()).filter(Boolean))
    if (containers.size > 1) return null
  }
  return isDeliveryConfirmed({ ...event, occurredAt }, now) ? occurredAt : null
}

const compact = (value) => value.replace(/[^a-z0-9]/g, '')

export function filterArchive(shipments, { search, carrier, range, dateField = 'archivedAt' }, now) {
  const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const cutoff = new Date(now)
  cutoff.setHours(0, 0, 0, 0)
  if (range === 'year') cutoff.setMonth(0, 1)
  else if (range !== 'all') cutoff.setDate(cutoff.getDate() - (Number(range) - 1))

  const dateKey = dateField === 'deliveredAt' ? 'deliveredAt' : 'archivedAt'
  const timestamp = (shipment, key) => shipment[key]?.getTime() ?? -Infinity
  return shipments.filter((shipment) => {
    if (carrier !== 'all' && shipment.carrier !== carrier) return false
    const date = timestamp(shipment, dateKey)
    if (range !== 'all' && (date < cutoff.getTime() || date > now)) return false
    const text = [shipment.invoiceNo, shipment.blNo, shipment.consignee, getCarrierLabel(shipment.carrier)]
      .filter(Boolean).join(' ').toLowerCase()
    const tracking = compact(shipment.blNo.toLowerCase())
    return terms.every((term) => text.includes(term) || (compact(term) && tracking.includes(compact(term))))
  }).sort((left, right) => (timestamp(right, dateKey) - timestamp(left, dateKey))
    || (timestamp(right, 'archivedAt') - timestamp(left, 'archivedAt')))
}

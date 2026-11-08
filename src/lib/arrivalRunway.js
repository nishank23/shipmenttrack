const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

export const runwayMilestones = [
  { id: 'dispatched', label: 'Dispatched', progress: 0 },
  { id: 'in-transit', label: 'In Transit', progress: 100 / 3 },
  { id: 'out-for-delivery', label: 'Out for Delivery', progress: 200 / 3 },
  { id: 'arriving', label: 'Arriving', progress: 100 },
]

const [dispatched, inTransit, outForDelivery, arriving] = runwayMilestones

const forecastTitle = /\b(estimated|expected|planned|scheduled|forecast|eta|etd)\b/i
const blockedMilestone = /\b(not|awaiting|pending|cancelled|canceled)\b/
const confirmedDelivery = /^(?:delivered|delivery completed)$|\b(?:delivered|delivery completed) (?:to )?(?:consignee|customer)\b/
const normalizeEventTitle = (title) => title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

export function isActualRunwayEvent(event, now) {
  return Boolean(event?.title && !event.estimated && !forecastTitle.test(event.title)
    && !(event.estimated !== false && event.occurredAt?.getTime() > now))
}

export function getRunwayMilestone(event, now) {
  if (!isActualRunwayEvent(event, now)) return null

  const title = normalizeEventTitle(event.title)
  if (blockedMilestone.test(title)) return null
  if (/\bout for (?:final )?delivery\b/.test(title)) return outForDelivery
  if (confirmedDelivery.test(title) || /\b(?:final arrival|destination arrival|arriv(?:ed|al) (?:at )?(?:final )?(?:port of discharge|destination))\b|^e105$/.test(title)) return arriving
  if (/\b(?:departed|vessel departure|loaded (?:on|onto) (?:the )?vessel|vessel loaded|in transit|transship(?:ment|ped))\b/.test(title)) return inTransit
  if (/\b(?:dispatched|picked up from shipper|received from shipper|origin gate in|gate in at origin)\b/.test(title)) return dispatched

  return null
}

export function isDeliveryConfirmed(event, now) {
  if (!isActualRunwayEvent(event, now)) return false
  const title = normalizeEventTitle(event.title)
  return !blockedMilestone.test(title) && confirmedDelivery.test(title)
}

export function hasTimedEta(eta, source) {
  if (!eta || source !== 'carrier') return false
  // Both the date parser and the form can synthesize midnight or noon.
  const isDefaultTime = (hours, minutes) => minutes === 0 && (hours === 0 || hours === 12)
  return !isDefaultTime(eta.getHours(), eta.getMinutes())
    && !isDefaultTime(eta.getUTCHours(), eta.getUTCMinutes())
}

function localDay(date) {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY
}

export function getRunwayEta(eta, now, hasTime) {
  if (!eta || !Number.isFinite(eta.getTime())) return { label: 'No ETA reported', dueSoon: false, overdue: false }

  const days = localDay(eta) - localDay(new Date(now))
  const remaining = eta.getTime() - now
  if (!hasTime) {
    if (days < 0) return { label: `${-days}d past ETA`, dueSoon: false, overdue: true }
    if (days === 0) return { label: 'Due today', dueSoon: true, overdue: false }
    return { label: days === 1 ? 'Due tomorrow' : `Due in ${days}d`, dueSoon: false, overdue: false }
  }

  const minutes = Math.max(1, Math.ceil(Math.abs(remaining) / 60000))
  const hours = Math.floor(minutes / 60)
  const duration = hours >= 24
    ? `${Math.floor(hours / 24)}d ${hours % 24}h`
    : hours > 0 ? `${hours}h${minutes % 60 ? ` ${minutes % 60}m` : ''}` : `${minutes}m`
  if (remaining < 0) return { label: `${duration} past ETA`, dueSoon: false, overdue: true }
  return { label: `Due in ${duration}`, dueSoon: remaining <= DAY, overdue: false }
}

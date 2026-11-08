import { httpsCallable } from 'firebase/functions'
import { doc, onSnapshot } from 'firebase/firestore'
import { db, functions } from '../../firebase'
import { carriers } from './carriers'

const liveCarrierCodes = new Set(carriers.map((carrier) => carrier.code))

export function supportsLiveTracking(carrierCode) {
  return liveCarrierCodes.has(String(carrierCode ?? '').trim().toUpperCase())
}

/**
 * Calls the lookupTracking Cloud Function.
 * Pass shipmentId to also store the events on that shipment (server-side).
 * Resolves to { carrier, eta, eventCount, latestEvent } with ISO date strings.
 */
export async function lookupTracking({ blNo, carrier, shipmentId }) {
  if (!functions) {
    throw new Error('Firebase is not configured.')
  }

  const callable = httpsCallable(functions, 'lookupTracking', { timeout: 130000 })
  const result = await callable({ blNo, carrier, shipmentId })
  return result.data
}

export function subscribeShipmentTracking(shipmentId, onData, onError) {
  return onSnapshot(doc(db, 'tracking_cache', shipmentId), (snapshot) => {
    onData(snapshot.exists() ? snapshot.data() : null)
  }, onError)
}

/**
 * Moves a shipment to archived_shipments (archived: true) or back (false).
 * Runs server-side so the move is atomic and ownership is checked.
 */
export async function setShipmentArchived(shipmentId, archived) {
  if (!functions) {
    throw new Error('Firebase is not configured.')
  }

  const callable = httpsCallable(functions, 'setShipmentArchived')
  const result = await callable({ shipmentId, archived })
  return result.data
}

export function describeArchiveReason(reason) {
  if (reason === 'empty-returned') {
    return 'Auto · empty container returned'
  }

  return reason === 'manual' ? 'Archived manually' : 'Archived'
}

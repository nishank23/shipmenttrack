import { httpsCallable } from 'firebase/functions'
import { functions } from '../../firebase'
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

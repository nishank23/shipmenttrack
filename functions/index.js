import axios from 'axios'
import { createTransport } from 'nodemailer'
import { initializeApp, applicationDefault, cert }  from 'firebase-admin/app'
import { getFirestore, Timestamp , FieldValue, Filter } from 'firebase-admin/firestore'
import { info, error as _error, warn } from 'firebase-functions/logger'
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https'
import { defineSecret } from 'firebase-functions/params'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import {
  extractTrackingPayload,
  extractPilContainers,
  extractPilContainerTracking,
  mergeTrackingResults,
} from './lib/trackingExtractors.js'

initializeApp();


const db = getFirestore();
const SMTP_EMAIL = defineSecret('SMTP_EMAIL')
const SMTP_PASSWORD = defineSecret('SMTP_PASSWORD')
const TRACKING_SECRETS = [SMTP_EMAIL, SMTP_PASSWORD]
const MAX_STORED_EVENTS = 200

const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const HTTP_TIMEOUT_MS = 15000
const DEFAULT_ALERT_DAYS = 14
const MAPUTO_TIMEZONE = 'Africa/Maputo'

const carrierPrefixMap = [
  { carrier: 'MSC', prefixes: ['MEDU', 'MSDU', 'MSNU', 'MSMU', 'MSCU'] },
  { carrier: 'ONE', prefixes: ['ONEY', 'BRDG'] },
  { carrier: 'EVERGREEN', prefixes: ['EGLV', 'EGSU', 'EGHU'] },
  { carrier: 'PIL', prefixes: ['SUB', 'PIL'] },
]

const LIVE_TRACKING_CARRIERS = new Set(carrierPrefixMap.map((entry) => entry.carrier))

const defaultHeaders = {
  'user-agent':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  'accept':
    'text/html,application/json,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  

}

const mailDateFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: MAPUTO_TIMEZONE,
})

const etaFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: MAPUTO_TIMEZONE,
})

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

export const dailyShipmentCheck = onSchedule(
  {
    schedule: '0 8 * * *',
    timeZone: MAPUTO_TIMEZONE,
    timeoutSeconds: 540,
    secrets: TRACKING_SECRETS,
  },
  async () => {
    const summary = await runShipmentCheck({
      sendEmails: true,
      forceRefresh: true,
    })

    info('Daily shipment check completed.', summary)
  },
)

export const manualCheck = onRequest(
  {
    timeoutSeconds: 540,
    secrets: TRACKING_SECRETS,
  },
  async (request, response) => {
    if (!['GET', 'POST'].includes(request.method)) {
      response.status(405).json({
        ok: false,
        error: 'Method not allowed. Use GET or POST.',
      })
      return
    }

    try {
      const uid = normalizeString(
        pickInput(request, ['uid', 'userId', 'user_id']),
      )
      const forceRefresh = toBoolean(
        pickInput(request, ['forceRefresh', 'force_refresh']),
      )
      const sendEmails = toBoolean(
        pickInput(request, ['sendEmail', 'sendEmails', 'send_email']),
      )

      const summary = await runShipmentCheck({
        uid,
        forceRefresh,
        sendEmails,
      })

      response.status(200).json({
        ok: true,
        ...summary,
      })
    } catch (error) {
      _error('manualCheck failed.', error)
      response.status(500).json({
        ok: false,
        error: error.message || 'Shipment check failed.',
      })
    }
  },
)

/**
 * Signed-in users look up live tracking for a B/L.
 *
 * - Without shipmentId: preview only (used while filling the add/edit form).
 * - With shipmentId: also stores events on that shipment. ETA is never written
 *   here, because the ETA is user-editable on the form; events are server-owned.
 */
export const lookupTracking = onCall(
  {
    timeoutSeconds: 120,
  },
  async (request) => {
    const uid = request.auth?.uid

    if (!uid) {
      throw new HttpsError('unauthenticated', 'Sign in to look up tracking.')
    }

    const blNo = normalizeString(request.data?.blNo).toUpperCase().replace(/\s+/g, '')
    const shipmentId = normalizeString(request.data?.shipmentId)

    if (!/^[A-Z0-9-]{4,40}$/.test(blNo)) {
      throw new HttpsError('invalid-argument', 'Enter a valid B/L number.')
    }

    const carrier =
      detectCarrierFromBl(blNo) || normalizeString(request.data?.carrier).toUpperCase()

    if (!LIVE_TRACKING_CARRIERS.has(carrier)) {
      throw new HttpsError(
        'failed-precondition',
        'Live tracking is not available for this carrier.',
      )
    }

    let shipmentRef = null

    if (shipmentId) {
      shipmentRef = db.collection('shipments').doc(shipmentId)
      const shipmentSnapshot = await shipmentRef.get()

      if (!shipmentSnapshot.exists || shipmentSnapshot.data()?.uid !== uid) {
        throw new HttpsError('permission-denied', 'Shipment not found.')
      }
    }

    let liveResult

    try {
      liveResult = await scrapeLiveTracking({ blNo, carrier })
    } catch (error) {
      warn(`Tracking lookup failed for ${blNo}`, error)

      if (shipmentRef) {
        await shipmentRef.set(
          {
            trackingStatus: 'error',
            trackingError: error.message || 'Tracking failed',
          },
          { merge: true },
        )
      }

      throw new HttpsError('unavailable', 'The carrier did not return tracking data. Try again later.')
    }

    const events = normalizeEvents(liveResult.events).slice(-MAX_STORED_EVENTS)
    const latestEvent = getLatestEvent(events)
    const eta = normalizeDate(liveResult.eta)

    if (shipmentRef) {
      await Promise.all([
        db.collection('tracking_cache').doc(shipmentId).set(
          {
            shipmentId,
            blNo,
            carrier,
            latestEta: eta ? Timestamp.fromDate(eta) : null,
            checkedAt: Timestamp.now(),
            expiresAt: Timestamp.fromMillis(Date.now() + CACHE_TTL_MS),
            status: eta ? 'live' : 'fallback',
            source: liveResult.source || carrier,
            events,
            eventCount: events.length,
            error: null,
          },
          { merge: true },
        ),
        shipmentRef.set(
          {
            latestEvent: latestEvent || null,
            eventCount: events.length,
            trackingStatus: 'live',
            trackingError: null,
          },
          { merge: true },
        ),
      ])
    }

    const importComplete = isImportComplete(events)
    let archived = false

    if (shipmentRef && importComplete) {
      const shipmentData = (await shipmentRef.get()).data() || {}

      if (!shipmentData.autoArchiveDisabled) {
        archived = await moveShipmentToArchive(shipmentId, {
          reason: 'empty-returned',
          archivedBy: 'system',
        })
      }
    }

    return {
      carrier,
      eta: eta ? eta.toISOString() : null,
      importComplete,
      archived,
      eventCount: events.length,
      latestEvent: latestEvent
        ? {
            title: latestEvent.title,
            location: latestEvent.location,
            container: latestEvent.container,
            occurredAt: latestEvent.occurredAt
              ? latestEvent.occurredAt.toDate().toISOString()
              : null,
          }
        : null,
    }
  },
)

/**
 * Manually archive or restore one of the caller's shipments.
 * Archived shipments live in archived_shipments/{sameId}; tracking_cache/{id}
 * is kept so the timeline stays available.
 */
export const setShipmentArchived = onCall(async (request) => {
  const uid = request.auth?.uid

  if (!uid) {
    throw new HttpsError('unauthenticated', 'Sign in to manage shipments.')
  }

  const shipmentId = normalizeString(request.data?.shipmentId)
  const archived = request.data?.archived === true

  if (!shipmentId) {
    throw new HttpsError('invalid-argument', 'shipmentId is required.')
  }

  const moved = archived
    ? await moveShipmentToArchive(shipmentId, { reason: 'manual', archivedBy: uid, uid })
    : await restoreShipmentFromArchive(shipmentId, { uid })

  if (!moved) {
    throw new HttpsError('not-found', 'Shipment not found.')
  }

  return { shipmentId, archived }
})

const EMPTY_RETURN_PATTERN = /\bempty\b.*\b(received|returned|return)\b/i

/**
 * Import is finished when every container's most recent actual event is an
 * empty-container return (e.g. MSC "Empty received at CY").
 */
function isImportComplete(events) {
  const actualEvents = (Array.isArray(events) ? events : []).filter(
    (event) => event?.occurredAt && !event.estimated,
  )

  if (actualEvents.length === 0) {
    return false
  }

  const latestByContainer = new Map()

  actualEvents.forEach((event) => {
    latestByContainer.set(event.container || 'bl', event)
  })

  // Ignore B/L-level rows when container-level events exist.
  if (latestByContainer.size > 1) {
    latestByContainer.delete('bl')
  }

  return Array.from(latestByContainer.values()).every((event) =>
    EMPTY_RETURN_PATTERN.test(event.title),
  )
}

/**
 * Atomically moves shipments/{id} to archived_shipments/{id}.
 * Pass uid to require ownership. Resolves false when there is nothing to move.
 */
async function moveShipmentToArchive(shipmentId, { reason, archivedBy, uid }) {
  const shipmentRef = db.collection('shipments').doc(shipmentId)
  const archiveRef = db.collection('archived_shipments').doc(shipmentId)

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(shipmentRef)

    if (!snapshot.exists || (uid && snapshot.data()?.uid !== uid)) {
      return false
    }

    transaction.set(archiveRef, {
      ...snapshot.data(),
      archivedAt: FieldValue.serverTimestamp(),
      archiveReason: reason,
      archivedBy,
    })
    transaction.delete(shipmentRef)
    return true
  })
}

async function restoreShipmentFromArchive(shipmentId, { uid }) {
  const shipmentRef = db.collection('shipments').doc(shipmentId)
  const archiveRef = db.collection('archived_shipments').doc(shipmentId)

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(archiveRef)

    if (!snapshot.exists || snapshot.data()?.uid !== uid) {
      return false
    }

    // eslint-disable-next-line no-unused-vars
    const { archivedAt, archiveReason, archivedBy, ...shipmentData } = snapshot.data()

    transaction.set(shipmentRef, {
      ...shipmentData,
      // The user brought it back on purpose: don't auto-archive it again.
      autoArchiveDisabled: true,
      restoredAt: FieldValue.serverTimestamp(),
    })
    transaction.delete(archiveRef)
    return true
  })
}

async function runShipmentCheck({ uid = '', forceRefresh = true, sendEmails = true }) {
  const users = await getUserDocs(uid)
  const transporter = sendEmails ? createTransporter() : null

  const summary = {
    processedUsers: 0,
    usersWithShipments: 0,
    alertsSent: 0,
    shipmentsChecked: 0,
    results: [],
  }

  for (const userDoc of users) {
    const userResult = await processUserShipments(userDoc, {
      forceRefresh,
      sendEmails,
      transporter,
    })

    summary.processedUsers += 1
    summary.shipmentsChecked += userResult.shipmentCount

    if (userResult.shipmentCount > 0) {
      summary.usersWithShipments += 1
    }

    if (userResult.emailSent) {
      summary.alertsSent += 1
    }

    summary.results.push(userResult)
  }

  return summary
}

async function getUserDocs(uid) {
  if (uid) {
    const userSnapshot = await db.collection('users').doc(uid).get()
    return userSnapshot.exists ? [userSnapshot] : []
  }

  const usersSnapshot = await db.collection('users').get()
  return usersSnapshot.docs
}
async function getShipmentsWithinWindow(uid, alertDays) {
  const startDate = new Date()
  const endDate = new Date(startDate)
  endDate.setDate(endDate.getDate() + alertDays)

  const shipmentsSnapshot = await db
    .collection('shipments')
    .where('uid', '==', uid)
    .where('eta', '>=', startDate)
    .where('eta', '<=', endDate)
    .orderBy('eta', 'asc')
    .get()

  return shipmentsSnapshot.docs
}
function buildEtaChangedEmailHtml({ displayName, shipments }) {
  const generatedAt = mailDateFormatter.format(new Date())
  const totalShipments = shipments.length

  const rows = shipments
    .map(
      (shipment) => `
        <tr>
          <td style="padding:12px;border-bottom:1px solid #e2e8f0;">
            ${escapeHtml(shipment.invoiceNo)}
          </td>

          <td style="padding:12px;border-bottom:1px solid #e2e8f0;">
            ${escapeHtml(shipment.blNo)}
          </td>

          <td style="padding:12px;border-bottom:1px solid #e2e8f0;">
            ${escapeHtml(shipment.carrier)}
          </td>

          <td style="padding:12px;border-bottom:1px solid #e2e8f0;">
            ${escapeHtml(formatEta(shipment.previousEta))}
          </td>

          <td style="padding:12px;border-bottom:1px solid #e2e8f0;">
            ${escapeHtml(formatEta(shipment.eta))}
          </td>

          <td style="padding:12px;border-bottom:1px solid #e2e8f0;">
            ${escapeHtml(formatDaysRemaining(shipment.daysRemaining))}
          </td>
        </tr>
      `
    )
    .join('')

  return `
    <div style="background:#f8fafc;padding:32px;font-family:Arial,sans-serif;color:#0f172a;">
      <div style="max-width:860px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:24px;padding:32px;">

        <div style="display:inline-flex;align-items:center;gap:10px;padding:10px 16px;border:1px solid #cbd5e1;border-radius:999px;background:#f8fafc;font-weight:700;">
          <span style="font-size:20px;">🚢</span>
          <span>ShipTrack</span>
        </div>

        <h1 style="margin:20px 0 12px;font-size:28px;line-height:1.2;">
          Shipment ETA Updated
        </h1>

        <p style="margin:0;color:#475569;line-height:1.7;">
          Hello ${escapeHtml(displayName)},
          ${
            totalShipments === 1
              ? 'your shipment ETA has been updated.'
              : `${totalShipments} shipment ETAs have been updated.`
          }
        </p>

        <p style="margin:12px 0 0;color:#475569;line-height:1.7;">
          Please review the updated arrival schedule below and plan accordingly.
        </p>

        <p style="margin:12px 0 0;color:#64748b;font-size:14px;">
          Generated at ${escapeHtml(generatedAt)} (${MAPUTO_TIMEZONE})
        </p>

        <section style="margin-top:24px;">
          <table style="width:100%;border-collapse:collapse;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">

            <thead style="background:#f8fafc;color:#475569;text-transform:uppercase;font-size:12px;letter-spacing:0.08em;">
              <tr>
                <th style="padding:12px;text-align:left;">Invoice No</th>
                <th style="padding:12px;text-align:left;">B/L</th>
                <th style="padding:12px;text-align:left;">Carrier</th>
                <th style="padding:12px;text-align:left;">Previous ETA</th>
                <th style="padding:12px;text-align:left;">Updated ETA</th>
                <th style="padding:12px;text-align:left;">Days Remaining</th>
              </tr>
            </thead>

            <tbody>
              ${rows}
            </tbody>

          </table>
        </section>

      </div>
    </div>
  `
}


async function processUserShipments(userDoc, { forceRefresh, sendEmails, transporter }) {
  const user = userDoc.data() || {}
  const alertDays = clampInt(user.alertDays, 1, 30, DEFAULT_ALERT_DAYS)
  const alertEmail = normalizeString(user.alertEmail || user.email)
  const displayName = normalizeString(
    user.name || user.displayName || 'ShipTrack user'
  )

  /**
   * IMPORTANT:
   * Fetch ALL shipments
   * not only alert window shipments
   *
   * because ETA changes can happen anytime
   */
  const shipmentDocs = await getUserShipments(userDoc.id)

  if (!alertEmail) {
    return {
      uid: userDoc.id,
      alertEmail: '',
      shipmentCount: shipmentDocs.length,
      emailSent: false,
      reason: 'No alert email configured.',
    }
  }

  const etaChangedShipments = []
  const reminderShipments = []
  const allProcessedShipments = []

  for (const shipmentDoc of shipmentDocs) {
    const shipment = await buildShipmentAlertRecord(
      shipmentDoc,
      { forceRefresh }
    )

    allProcessedShipments.push(shipment)

    // Import finished (empty container returned): no more alerts.
    if (shipment.archived) {
      continue
    }

    /**
     * PRIORITY 1:
     * ETA changed email
     */
    if (shipment.etaChanged) {
      etaChangedShipments.push(shipment)
      continue
    }

    /**
     * PRIORITY 2:
     * Normal reminder email
     */
    if (
      shipment.daysRemaining !== null &&
      shipment.daysRemaining >= 0 &&
      shipment.daysRemaining <= alertDays
    ) {
      reminderShipments.push(shipment)
    }
  }

  if (allProcessedShipments.length === 0) {
    return {
      uid: userDoc.id,
      alertEmail,
      shipmentCount: 0,
      emailSent: false,
      reason: 'No shipments found.',
    }
  }

  let emailSent = false

  if (sendEmails && transporter) {
    /**
     * ETA Changed Email has HIGHER priority
     */
    if (etaChangedShipments.length > 0) {
      const html = buildEtaChangedEmailHtml({
        displayName,
        shipments: etaChangedShipments,
      })

      const subject =
        etaChangedShipments.length === 1
          ? 'ShipTrack: Shipment ETA Updated'
          : `ShipTrack: ${etaChangedShipments.length} Shipment ETAs Updated`

      await transporter.sendMail({
        from: `"ShipTrack Alerts" <${SMTP_EMAIL.value()}>`,
        to: alertEmail,
        subject,
        html,
      })

      emailSent = true
    }

    /**
     * Only send reminder if NO ETA changes
     */
    else if (reminderShipments.length > 0) {
      const html = buildAlertEmailHtml({
        displayName,
        alertDays,
        shipments: reminderShipments,
      })

      const subject =
        
          `ShipTrack alert: ${reminderShipments.length} shipments arriving soon`

      await transporter.sendMail({
        from: `"ShipTrack Alerts" <${SMTP_EMAIL.value()}>`,
        to: alertEmail,
        subject,
        html,
      })

      emailSent = true
    }
  }

  return {
    uid: userDoc.id,
    alertEmail,
    shipmentCount: allProcessedShipments.length,
    emailSent,
    etaChangedCount: etaChangedShipments.length,
    reminderCount: reminderShipments.length,
    shipments: allProcessedShipments.map((shipment) => ({
      id: shipment.id,
      invoiceNo: shipment.invoiceNo,
      blNo: shipment.blNo,
      carrier: shipment.carrier,
      eta: shipment.eta
        ? shipment.eta.toISOString()
        : null,
      previousEta: shipment.previousEta
        ? shipment.previousEta.toISOString()
        : null,
      etaChanged: shipment.etaChanged || false,
      etaSource: shipment.etaSource,
      archived: shipment.archived,
      daysRemaining: shipment.daysRemaining,
    })),
  }
}


/**
 * New helper function
 * Fetch ALL user shipments
 */
async function getUserShipments(uid) {
  const shipmentsSnapshot = await db
    .collection('shipments')
    .where('uid', '==', uid)
    .get()

  return shipmentsSnapshot.docs
}


async function buildShipmentAlertRecord(shipmentDoc, { forceRefresh }) {
  const shipment = shipmentDoc.data() || {}
  const blNo = normalizeString(
    shipment.blNo || shipment.blNumber
  )

  const carrier = normalizeString(
    shipment.carrier ||
    detectCarrierFromBl(blNo) ||
    'Unknown'
  )

  const firestoreEta = normalizeDate(
    shipment.currentEta ||
    shipment.eta
  )

  let tracking = {
    eta: firestoreEta,
    etaSource: 'firestore',
    etaChanged: false,
    previousEta: null,
  }

  if (LIVE_TRACKING_CARRIERS.has(carrier.toUpperCase())) {
    tracking = await resolveTrackingInfo({
      shipmentId: shipmentDoc.id,
      blNo,
      carrier,
      firestoreEta,
      forceRefresh,
    })
  }

  const eta = tracking.eta || firestoreEta
  let archived = false

  if (tracking.importComplete && !shipment.autoArchiveDisabled) {
    try {
      archived = await moveShipmentToArchive(shipmentDoc.id, {
        reason: 'empty-returned',
        archivedBy: 'system',
      })
    } catch (archiveError) {
      warn(`Auto-archive failed for ${blNo}`, archiveError)
    }
  }

  return {
    id: shipmentDoc.id,
    archived,

    invoiceNo: normalizeString(
      shipment.invoiceNo ||
      shipment.invoiceNumber ||
      shipment.invoice ||
      shipment.invoice_number ||
      '—'
    ),

    blNo: blNo || '—',
    carrier,

    consigneeName: normalizeString(
      shipment.consigneeName ||
      'Unassigned consignee'
    ),
    eta,
    previousEta: tracking.previousEta || null,
    etaChanged: tracking.etaChanged || false,
    etaSource: tracking.etaSource,

    daysRemaining: getDayDifference(eta),

    invAmount:
      shipment.invAmount ??
      shipment.invoiceAmount ??
      shipment.amount ??
      null,
  }
}


async function resolveTrackingInfo({ shipmentId, blNo, carrier, firestoreEta, forceRefresh }) {
  const cacheRef = db.collection('tracking_cache').doc(shipmentId)
  const shipmentRef = db.collection('shipments').doc(shipmentId)

  const [cacheSnapshot, shipmentSnapshot] = await Promise.all([
    cacheRef.get(),
    shipmentRef.get(),
  ])

  const cachedData = cacheSnapshot.exists ? cacheSnapshot.data() : null
  const shipmentData = shipmentSnapshot.exists ? shipmentSnapshot.data() : {}


  const currentShipmentEta = normalizeDate(shipmentData.currentEta 
    || shipmentData.eta || firestoreEta
  )


  if (!forceRefresh && isFreshLiveCache(cachedData)) {
    return {
      eta: normalizeDate(cachedData.latestEta),
      etaSource: 'live-cache',
      etaChanged:false,
    }
  }

  try {
    const liveResult = await scrapeLiveTracking({
      blNo,
      carrier,
    })
    const liveEta = normalizeDate(liveResult.eta || firestoreEta)
    const previousEta = currentShipmentEta
    const etaChanged = 
      previousEta &&
      liveEta &&
      previousEta.getTime() !== liveEta.getTime()

    const events = normalizeEvents(liveResult.events).slice(-MAX_STORED_EVENTS)
    const latestEvent = getLatestEvent(events)

    info(`Tracked ${blNo}`, {
      shipmentId,
      previousEta,
      liveEta,
      etaChanged,
      eventCount: events.length,
    })


    /**
     * STEP 1:
     * If ETA changed → create eta_history entry
     */

    if(etaChanged){
      await db.collection('eta_history').add({
        shipmentId,
        blNo,
        oldEta: previousEta ? Timestamp.fromDate(previousEta) : null,
        newEta: liveEta ? Timestamp.fromDate(liveEta) : null,
        changedAt: Timestamp.now(),
        source : liveResult.source || carrier,
        reason: 'Carrier updated Eta',
        changedBy: 'system',
      })

    }

    /**
     * STEP 2:
     * Always update shipment official ETA
     */

    await shipmentRef.set(
       {
        originalEta:
          shipmentData.originalEta ||
          (firestoreEta ? Timestamp.fromDate(firestoreEta) : null),

        currentEta: liveEta
          ? Timestamp.fromDate(liveEta)
          : null,

        eta: liveEta
          ? Timestamp.fromDate(liveEta)
          : null, // keep old field if needed

        etaSource: liveResult.eta ? 'carrier' : 'firestore',
        etaVerified: !!liveResult.eta,
        etaChangeCount: FieldValue.increment(
          etaChanged ? 1 : 0
        ),
        lastEtaSyncAt: Timestamp.now(),

        // Denormalized so the dashboard can show status without reading the cache.
        latestEvent: latestEvent || null,
        eventCount: events.length,
        trackingStatus: 'live',
        trackingError: null,
      },
      { merge: true },
    )
      /**
     * STEP 3:
     * Update tracking cache
     */
    await cacheRef.set(
      {
        shipmentId,
        blNo,
        carrier,

        previousEta: previousEta
          ? Timestamp.fromDate(previousEta)
          : null,

        latestEta: liveEta
          ? Timestamp.fromDate(liveEta)
          : null,


        checkedAt: Timestamp.now(),
        expiresAt: Timestamp.fromMillis(
          Date.now() + CACHE_TTL_MS
        ),

        status: etaChanged
          ? 'eta-changed'
          : liveResult.eta
          ? 'live'
          : 'fallback',

        source: liveResult.source || 'unknown',
        events,
        eventCount: events.length,
        error: null,
      },
      { merge: true }
    )

    return {
      eta: liveEta,
      etaSource: liveResult.eta ? 'live' : 'firestore',
      etaChanged,
      previousEta,
      importComplete: isImportComplete(events),
    }
  } catch (error) {
    warn(`Tracking scrape failed for ${blNo}`, error)

    await cacheRef.set(
      {
        shipmentId,
        blNo,
        carrier,

        latestEta: currentShipmentEta
          ? Timestamp.fromDate(currentShipmentEta)
          : null,

        checkedAt: Timestamp.now(),
        expiresAt: Timestamp.fromMillis(
          Date.now() + CACHE_TTL_MS
        ),

        status: 'fallback',
        source: 'firestore',
        error: error.message || 'Tracking failed',
      },
      { merge: true }
    )

    await shipmentRef.set(
      {
        trackingStatus: 'error',
        trackingError: error.message || 'Tracking failed',
        lastEtaSyncAt: Timestamp.now(),
      },
      { merge: true },
    )

    return {
      eta: currentShipmentEta || firestoreEta,
      etaSource: 'firestore',
      etaChanged: false,
    }
  }
}

function isFreshLiveCache(cacheData) {
  if (!cacheData || !['live', 'eta-changed'].includes(cacheData.status)) {
    return false
  }

  const expiresAt = normalizeDate(cacheData.expiresAt)
  const eta = normalizeDate(cacheData.latestEta)

  return Boolean(expiresAt && eta && expiresAt.getTime() > Date.now())
}

async function scrapeLiveTracking({ blNo, carrier }) {
  const detectedCarrier = detectCarrierFromBl(blNo) || normalizeString(carrier).toUpperCase()

  switch (detectedCarrier) {
    case 'MSC':
      return scrapeMsc(blNo)
    case 'ONE':
      return scrapeOne(blNo)
    case 'EVERGREEN':
      return scrapeEvergreen(blNo)
    case 'PIL':
      return scrapePil(blNo)
    default:
      return {
        source: 'firestore',
        eta: null,
      }
  }
}


async function scrapeMsc(blNo) {
 var response =  await axios.post(
      "https://www.msc.com/api/feature/tools/TrackingInfo",
      {
        trackingNumber: blNo,
        trackingMode: "0"
      },
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
          "Referer": "https://www.msc.com/en/track-a-shipment",
          "X-Requested-With": "XMLHttpRequest",
          "Content-Type": "application/json"
        },
        timeout: 15000
      }
    )
  return extractTrackingPayload({
    carrier: 'MSC',
    payload: response.data,
    blNo,
  })
}

async function scrapeOne(blNo) {
  const normalizedTrackingNumber = normalizeOneBl(blNo)
  console.log(`check current timestamp for ONE tracking: ${normalizedTrackingNumber} ${Date.now()}`)
  const legacyResponse = await axios.post(
    'https://ecomm.one-line.com/api/v1/edh/containers/track-and-trace/search',
      {"page":1,"page_length":10,
        "filters":{"search_text": normalizedTrackingNumber,
          "search_type":"BKG_NO"},
          "timestamp":Date.now(),},
    {
      timeout: HTTP_TIMEOUT_MS,
      headers: {
        ...defaultHeaders,
        'content-type': 'application/json',
        'origin': 'https://ecomm.one-line.com',
        'referer': 'https://ecomm.one-line.com/',
      }
    },
  )
  
  let parsed = extractTrackingPayload({
    carrier: 'ONE',
    payload: legacyResponse.data,
    blNo,
  })
  console.log('Raw ONE response:', parsed)
  return parsed
}

async function scrapeEvergreen(blNo) {
  const normalizedTrackingNumber = normalizeEvergreenBl(blNo)

  const body = new URLSearchParams({
    BL: normalizedTrackingNumber,
    TYPE: 'BL'
  })

  const response = await axios.post(
    'https://ct.shipmentlink.com/servlet/TDB1_CargoTracking.do',
    body.toString(),
    {
      timeout: HTTP_TIMEOUT_MS,
      headers: {
        ...defaultHeaders,
        "Origin": 'https://ct.shipmentlink.com',
        'Referer': 'https://ct.shipmentlink.com/servlet/TDB1_CargoTracking.do',
        'User-Agent': ' Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36', 
        'content-type': 'application/x-www-form-urlencoded',
      },
    },
  )

  return extractTrackingPayload({
    carrier: 'EVERGREEN',
    payload: response.data,
    blNo,
  })
}

async function scrapePil(blNo) {
  const getN = await axios.get(
    'https://www.pilship.com/wp-content/themes/hello-theme-child-master/pil-api/common/get-n.php',
    {
      params: {
        timestamp: Date.now(),
      },
      timeout: HTTP_TIMEOUT_MS,
      headers: {
        ...defaultHeaders,
        Referer:
          `https://www.pilship.com/digital-solutions/?tab=customer&id=track-trace&label=containerTandT&module=TrackTraceBL&refNo=${blNo}`,
      },
    }
  )

  const nValue = getN.data?.n

  const blResponse = await axios.get(
    'https://www.pilship.com/wp-content/themes/hello-theme-child-master/pil-api/trackntrace-containertnt.php',
    {
      params: {
        module: 'TrackTraceBL',
        refNo: blNo,
        n: nValue,
        timestamp: Date.now(),
      },
      timeout: HTTP_TIMEOUT_MS,
      headers: {
        ...defaultHeaders,
        Referer:
          `https://www.pilship.com/digital-solutions/?tab=customer&id=track-trace&label=containerTandT&module=TrackTraceBL&refNo=${blNo}`,
      },
    }
  )

  const containers = extractPilContainers(blResponse.data)

  if (!containers.length) {
    return extractTrackingPayload({
      carrier: 'PIL',
      payload: blResponse.data,
      blNo,
    })
  }

  const results = []

  for (const cntrNo of containers) {
    const cntrResponse = await axios.get(
      'https://www.pilship.com/wp-content/themes/hello-theme-child-master/pil-api/trackntrace-containertnt-trace.php',
      {
        params: {
          module: 'TrackTraceBL',
          reference_no: blNo,
          cntr_no: cntrNo,
          n: nValue,
          timestamp: Date.now(),
        },
        timeout: HTTP_TIMEOUT_MS,
        headers: {
          ...defaultHeaders,
          Referer:
            `https://www.pilship.com/digital-solutions/?tab=customer&id=track-trace&label=containerTandT&module=TrackTraceBL&refNo=${blNo}`,
        },
      }
    )

    results.push(
      extractPilContainerTracking(
        cntrResponse.data,
        blNo,
        cntrNo
      )
    )
  }

  return mergeTrackingResults('PIL', blNo, results)
}

function normalizeEvents(events) {
  return (Array.isArray(events) ? events : [])
    .map((event, index) => {
      const occurredAt = normalizeDate(event?.occurredAt)
      const title = normalizeString(event?.title || 'Status update')

      return {
        id: normalizeString(event?.id || `event-${index}`),
        title,
        description: normalizeString(event?.description || ''),
        location: normalizeString(event?.location || ''),
        container: normalizeString(event?.container || ''),
        occurredAt: occurredAt ? Timestamp.fromDate(occurredAt) : null,
        // Carrier timelines mix actual and planned moves. Future dates are planned,
        // and so are forecast rows (e.g. MSC "Estimated Time of Arrival") even
        // after their date has passed.
        estimated:
          isForecastEventTitle(title) ||
          Boolean(occurredAt && occurredAt.getTime() > Date.now()),
      }
    })
    .filter((event) => event.title)
}

function isForecastEventTitle(title) {
  return /\b(estimated|expected|planned|ETA|ETD)\b/i.test(title)
}

/**
 * Most recent event that has actually happened (not a planned future move).
 */
function getLatestEvent(events) {
  const actualEvents = events.filter((event) => event.occurredAt && !event.estimated)
  return actualEvents.length > 0 ? actualEvents[actualEvents.length - 1] : null
}

function normalizeDate(value) {
  if (!value) {
    return null
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }

  if (typeof value?.toDate === 'function') {
    return value.toDate()
  }

  const parsedDate = new Date(value)
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate
}

function detectCarrierFromBl(blNo) {
  const normalizedBl = normalizeString(blNo).toUpperCase()

  for (const entry of carrierPrefixMap) {
    const match = entry.prefixes.find((prefix) => normalizedBl.startsWith(prefix))

    if (match) {
      return entry.carrier
    }
  }

  return ''
}

function normalizeOneBl(blNo) {
  const normalizedBl = normalizeString(blNo).toUpperCase()

  if (normalizedBl.startsWith('ONEY') && normalizedBl.length > 4) {
    return normalizedBl.slice(4)
  }

  return normalizedBl.length > 12 ? normalizedBl.slice(-12) : normalizedBl
}

function normalizeEvergreenBl(blNo) {
  const normalizedBl = normalizeString(blNo).toUpperCase()

  if (normalizedBl.startsWith('EGLV') && normalizedBl.length > 4) {
    return normalizedBl.slice(4)
  }

  return normalizedBl.length > 12 ? normalizedBl.slice(-12) : normalizedBl
}

function createTransporter() {
  return createTransport({
    host : 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      user: SMTP_EMAIL.value(),
      pass: SMTP_PASSWORD.value(),
    },
  })
}

function buildAlertEmailHtml({ displayName, alertDays, shipments }) {
  const groupedShipments = groupByConsignee(shipments)
  const generatedAt = mailDateFormatter.format(new Date())
  const totalShipments = shipments.length

  const groupMarkup = Object.entries(groupedShipments)
    .map(([consigneeName, items]) => {
      const rows = items
        .map(
          (shipment) => `
            <tr>
              <td style="padding:12px;border-bottom:1px solid #e2e8f0;">${escapeHtml(shipment.invoiceNo)}</td>
              <td style="padding:12px;border-bottom:1px solid #e2e8f0;">${escapeHtml(shipment.blNo)}</td>
              <td style="padding:12px;border-bottom:1px solid #e2e8f0;">${escapeHtml(shipment.carrier)}</td>
              <td style="padding:12px;border-bottom:1px solid #e2e8f0;">${escapeHtml(formatEta(shipment.eta))}</td>
              <td style="padding:12px;border-bottom:1px solid #e2e8f0;">${escapeHtml(formatDaysRemaining(shipment.daysRemaining))}</td>
              <td style="padding:12px;border-bottom:1px solid #e2e8f0;">${escapeHtml(formatAmount(shipment.invAmount))}</td>
            </tr>
          `,
        )
        .join('')

      return `
        <section style="margin-top:24px;">
          <h2 style="font-size:18px;margin:0 0 12px;color:#0f172a;">${escapeHtml(consigneeName)}</h2>
          <table style="width:100%;border-collapse:collapse;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">
            <thead style="background:#f8fafc;color:#475569;text-transform:uppercase;font-size:12px;letter-spacing:0.08em;">
              <tr>
                <th style="padding:12px;text-align:left;">Invoice No</th>
                <th style="padding:12px;text-align:left;">B/L</th>
                <th style="padding:12px;text-align:left;">Carrier</th>
                <th style="padding:12px;text-align:left;">ETA</th>
                <th style="padding:12px;text-align:left;">Days remaining</th>
                <th style="padding:12px;text-align:left;">INV Amount</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </section>
      `
    })
    .join('')

  return `
    <div style="background:#f8fafc;padding:32px;font-family:Arial,sans-serif;color:#0f172a;">
      <div style="max-width:860px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:24px;padding:32px;">
        <div style="display:inline-flex;align-items:center;gap:10px;padding:10px 16px;border:1px solid #cbd5e1;border-radius:999px;background:#f8fafc;font-weight:700;">
          <span style="font-size:20px;">🚢</span>
          <span>ShipTrack</span>
        </div>
        <h1 style="margin:20px 0 12px;font-size:28px;line-height:1.2;">Upcoming shipment alert</h1>
        <p style="margin:0;color:#475569;line-height:1.7;">
          Hello ${escapeHtml(displayName)}, here ${totalShipments === 1 ? 'is' : 'are'} ${totalShipments}
          shipment${totalShipments === 1 ? '' : 's'} arriving within your next ${alertDays} day alert window.
        </p>
        <p style="margin:12px 0 0;color:#64748b;font-size:14px;">
          Generated at ${escapeHtml(generatedAt)} (${MAPUTO_TIMEZONE})
        </p>
        ${groupMarkup}
      </div>
    </div>
  `
}

function groupByConsignee(shipments) {
  return shipments.reduce((groups, shipment) => {
    const consigneeName = shipment.consigneeName || 'Unassigned consignee'

    if (!groups[consigneeName]) {
      groups[consigneeName] = []
    }

    groups[consigneeName].push(shipment)

    groups[consigneeName].sort((left, right) => {
      const leftEta = left.eta ? left.eta.getTime() : Number.MAX_SAFE_INTEGER
      const rightEta = right.eta ? right.eta.getTime() : Number.MAX_SAFE_INTEGER
      return leftEta - rightEta
    })

    return groups
  }, {})
}

function formatEta(value) {
  const eta = normalizeDate(value)
  return eta ? etaFormatter.format(eta) : 'No ETA available'
}

function getDayDifference(value) {
  const targetDate = normalizeDate(value)

  if (!targetDate) {
    return null
  }

  const etaDay = new Date(targetDate)
  etaDay.setHours(0, 0, 0, 0)

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  return Math.round((etaDay.getTime() - today.getTime()) / 86400000)
}

function formatDaysRemaining(daysRemaining) {
  if (daysRemaining === null) {
    return 'Unknown'
  }

  if (daysRemaining < 0) {
    const overdueDays = Math.abs(daysRemaining)
    return `${overdueDays} day${overdueDays === 1 ? '' : 's'} overdue`
  }

  if (daysRemaining === 0) {
    return 'Due today'
  }

  return `${daysRemaining} day${daysRemaining === 1 ? '' : 's'}`
}

function formatAmount(value) {
  if (value === undefined || value === null || value === '') {
    return '—'
  }

  const numericValue =
    typeof value === 'string' ? Number(value.replaceAll(',', '')) : Number(value)

  return Number.isNaN(numericValue) ? '—' : currencyFormatter.format(numericValue)
}

function clampInt(value, min, max, fallback) {
  const parsedValue = Number.parseInt(value, 10)

  if (Number.isNaN(parsedValue)) {
    return fallback
  }

  return Math.min(max, Math.max(min, parsedValue))
}

function normalizeString(value) {
  return String(value || '').trim()
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function toBoolean(value) {
  if (typeof value === 'boolean') {
    return value
  }

  return ['1', 'true', 'yes', 'y', 'on'].includes(
    String(value || '').toLowerCase(),
  )
}

function pickInput(request, keys) {
  for (const key of keys) {
    if (request.query?.[key] !== undefined) {
      return request.query[key]
    }

    if (request.body && request.body[key] !== undefined) {
      return request.body[key]
    }
  }

  return undefined
}

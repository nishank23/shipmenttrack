import axios from 'axios'
import { createTransport } from 'nodemailer'
import { initializeApp, applicationDefault, cert }  from 'firebase-admin/app'
import { getFirestore, Timestamp , FieldValue, Filter } from 'firebase-admin/firestore'
import { info, error as _error, warn } from 'firebase-functions/logger'
import { onRequest } from 'firebase-functions/v2/https'
import { defineSecret } from 'firebase-functions/params'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { extractTrackingPayload } from './lib/trackingExtractors.js'

initializeApp();


const db = getFirestore();
const SMTP_EMAIL = defineSecret('SMTP_EMAIL')
const SMTP_PASSWORD = defineSecret('SMTP_PASSWORD')

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
    secrets: [SMTP_EMAIL, SMTP_PASSWORD],
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
    secrets: [SMTP_EMAIL, SMTP_PASSWORD],
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

  if (detectCarrierFromBl(blNo)) {
    tracking = await resolveTrackingInfo({
      shipmentId: shipmentDoc.id,
      blNo,
      carrier,
      firestoreEta,
      forceRefresh,
    })
  }

  const eta = tracking.eta || firestoreEta

  return {
    id: shipmentDoc.id,

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
      eta: normalizeDate(cachedData.eta),
      etaSource: 'live-cache',
      etaChanged:false,
    }
  }

  try {
    const liveResult = await scrapeLiveTracking({
      blNo,
      carrier,
    })
    console.log(`Live tracking result for ${blNo}:`, liveResult)
    const liveEta = normalizeDate(liveResult.eta || firestoreEta)
    const previousEta = currentShipmentEta
    const etaChanged = 
      previousEta &&
      liveEta &&
      previousEta.getTime() !== liveEta.getTime()

    
    console.log(`Shipment ${shipmentId}`)
    console.log('Previous ETA:', previousEta)
    console.log('Live ETA:', liveEta)
    console.log('ETA Changed:', etaChanged)


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
        error: null,
      },
      { merge: true }
    )

    return {
      eta: liveEta,
      etaSource: liveResult.eta ? 'live' : 'firestore',
      etaChanged,
      previousEta,
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

    return {
      eta: currentShipmentEta || firestoreEta,
      etaSource: 'firestore',
      etaChanged: false,
    }
  }
}

function isFreshLiveCache(cacheData) {
  if (!cacheData || cacheData.status !== 'live') {
    return false
  }

  const expiresAt = normalizeDate(cacheData.expiresAt)
  const eta = normalizeDate(cacheData.eta)

  return Boolean(expiresAt && eta && expiresAt.getTime() > Date.now())
}

async function scrapeLiveTracking({ blNo, carrier }) {
  const detectedCarrier = detectCarrierFromBl(blNo) || carrier

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
    'https://www.pilship.com/wp-content/themes/hello-theme-child-master/pil-api/common/get-n.php?',
    {
      params: {
        timestamp: Date.now(),
      },
      timeout: HTTP_TIMEOUT_MS,
      headers: { ...defaultHeaders,
          'Referer': 'https://www.pilship.com/digital-solutions/?tab=customer&id=track-trace&label=containerTandT&module=TrackTraceBL&refNo=' + blNo,
      }
    },
  )
  const nValue = getN.data?.n
  console.log(`Obtained n value for PIL tracking: ${nValue} (BL: ${blNo})`)
  const response = await axios.get('https://www.pilship.com/wp-content/themes/hello-theme-child-master/pil-api/trackntrace-containertnt.php?', {
     params: {
        module: 'TrackTraceBL',
        'refNo': blNo,
        'n': nValue,
        timestamp: Date.now(),
      },
      timeout: HTTP_TIMEOUT_MS,
      headers:{ ...defaultHeaders,
          'Referer': 'https://www.pilship.com/digital-solutions/?tab=customer&id=track-trace&label=containerTandT&module=TrackTraceBL&refNo=' + blNo,
      } 
  })


  console.log(`Raw PIL response for ${blNo}:`, response.data)



  return extractTrackingPayload({
    carrier: 'PIL',
    payload: response.data,
    blNo,
  })
}

function normalizeEvents(events) {
  return (Array.isArray(events) ? events : [])
    .map((event, index) => {
      const occurredAt = normalizeDate(event?.occurredAt)

      return {
        id: normalizeString(event?.id || `event-${index}`),
        title: normalizeString(event?.title || 'Status update'),
        description: normalizeString(event?.description || ''),
        location: normalizeString(event?.location || ''),
        occurredAt: occurredAt ? Timestamp.fromDate(occurredAt) : null,
      }
    })
    .filter((event) => event.title)
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

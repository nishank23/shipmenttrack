import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { deleteDoc, doc, getDoc } from 'firebase/firestore'
import { db } from '../../firebase'
import useAuth from '../hooks/useAuth'

const carrierBadgeStyles = {
  MSC: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-200',
  ONE: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-200',
  EVERGREEN:
    'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200',
  PIL: 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-200',
}

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

const dateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

function normalizeDate(value) {
  if (!value) {
    return null
  }

  if (typeof value.toDate === 'function') {
    return value.toDate()
  }

  if (value instanceof Date) {
    return value
  }

  const parsedDate = new Date(value)

  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate
}

function getDayDifference(value) {
  const etaDate = normalizeDate(value)

  if (!etaDate) {
    return null
  }

  const etaDay = new Date(etaDate)
  etaDay.setHours(0, 0, 0, 0)

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  return Math.round((etaDay.getTime() - today.getTime()) / 86400000)
}

function formatEta(value) {
  const date = normalizeDate(value)
  return date ? dateFormatter.format(date) : 'No ETA'
}

function formatDateTime(value) {
  const date = normalizeDate(value)
  return date ? dateTimeFormatter.format(date) : 'Timestamp unavailable'
}

function formatDaysLeft(daysLeft) {
  if (daysLeft === null) {
    return 'Unknown'
  }

  if (daysLeft < 0) {
    return `${Math.abs(daysLeft)} day${Math.abs(daysLeft) === 1 ? '' : 's'} overdue`
  }

  if (daysLeft === 0) {
    return 'Due today'
  }

  return `${daysLeft} day${daysLeft === 1 ? '' : 's'}`
}

function formatAmount(value) {
  if (value === undefined || value === null || value === '') {
    return '—'
  }

  const sanitizedValue =
    typeof value === 'string' ? Number(value.replaceAll(',', '')) : Number(value)

  return Number.isNaN(sanitizedValue) ? '—' : currencyFormatter.format(sanitizedValue)
}

function getCarrierBadgeClass(carrier) {
  return (
    carrierBadgeStyles[String(carrier).trim().toUpperCase()] ??
    'bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-200'
  )
}

function extractTimelineEvents(cacheData) {
  const rawEvents = Array.isArray(cacheData?.events)
    ? cacheData.events
    : Array.isArray(cacheData?.statusEvents)
      ? cacheData.statusEvents
      : Array.isArray(cacheData?.timeline)
        ? cacheData.timeline
        : Array.isArray(cacheData?.history)
          ? cacheData.history
          : []

  return rawEvents
    .map((event, index) => {
      if (typeof event === 'string') {
        return {
          id: `${index}-${event}`,
          title: event,
          description: '',
          location: '',
          occurredAt: null,
          sortValue: index,
        }
      }

      const occurredAt = normalizeDate(
        event?.timestamp ??
          event?.occurredAt ??
          event?.date ??
          event?.updatedAt ??
          event?.createdAt ??
          event?.at,
      )

      const title =
        event?.status ??
        event?.title ??
        event?.event ??
        event?.name ??
        event?.label ??
        'Status updated'

      return {
        id: event?.id ?? `${index}-${title}`,
        title,
        description: event?.description ?? event?.message ?? event?.details ?? '',
        location: event?.location ?? event?.port ?? event?.place ?? '',
        occurredAt,
        sortValue: occurredAt ? occurredAt.getTime() : index,
      }
    })
    .sort((left, right) => left.sortValue - right.sortValue)
}

function DetailItem({ label, children }) {
  return (
    <div className="rounded-3xl border border-slate-200/70 bg-slate-50/80 p-5 dark:border-white/10 dark:bg-white/5">
      <p className="text-xs font-medium tracking-[0.24em] text-slate-500 uppercase dark:text-slate-400">
        {label}
      </p>
      <div className="mt-3 text-sm leading-7 text-slate-700 dark:text-slate-200">
        {children}
      </div>
    </div>
  )
}

function ShipmentDetail() {
  const { shipmentId } = useParams()
  const navigate = useNavigate()
  const { currentUser } = useAuth()
  const [shipment, setShipment] = useState(null)
  const [timelineEvents, setTimelineEvents] = useState([])
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isDeleting, setIsDeleting] = useState(false)

  useEffect(() => {
    if (!shipmentId || !currentUser?.uid) {
      setIsLoading(false)
      return undefined
    }

    let isMounted = true

    async function loadShipmentDetail() {
      setIsLoading(true)
      setError('')

      try {
        const shipmentRef = doc(db, 'shipments', shipmentId)
        const shipmentSnapshot = await getDoc(shipmentRef)

        if (!shipmentSnapshot.exists()) {
          throw new Error('Shipment not found.')
        }

        const shipmentData = shipmentSnapshot.data()

        if (shipmentData.uid !== currentUser.uid) {
          navigate('/dashboard', { replace: true })
          return
        }

        const shipmentRecord = {
          id: shipmentSnapshot.id,
          ...shipmentData,
        }

        if (isMounted) {
          setShipment(shipmentRecord)
        }

        const trackingKey = String(
          shipmentData.blNo ?? shipmentData.blNumber ?? '',
        ).trim()

        if (!trackingKey) {
          if (isMounted) {
            setTimelineEvents([])
          }
          return
        }

        const trackingSnapshot = await getDoc(doc(db, 'tracking_cache', trackingKey))

        if (isMounted) {
          setTimelineEvents(
            trackingSnapshot.exists()
              ? extractTimelineEvents(trackingSnapshot.data())
              : [],
          )
        }
      } catch (loadError) {
        console.error('Failed to load shipment detail.', loadError)

        if (isMounted) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'Unable to load this shipment right now.',
          )
          setShipment(null)
          setTimelineEvents([])
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    loadShipmentDetail()

    return () => {
      isMounted = false
    }
  }, [currentUser?.uid, navigate, shipmentId])

  const handleDelete = async () => {
    if (!shipment?.id) {
      return
    }

    const confirmed = window.confirm(
      'Delete this shipment? This action cannot be undone.',
    )

    if (!confirmed) {
      return
    }

    setError('')
    setIsDeleting(true)

    try {
      await deleteDoc(doc(db, 'shipments', shipment.id))
      navigate('/dashboard', { replace: true })
    } catch (deleteError) {
      console.error('Failed to delete shipment.', deleteError)
      setError('Shipment could not be deleted. Please try again.')
      setIsDeleting(false)
    }
  }

  if (isLoading) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex min-h-[70vh] items-center justify-center rounded-[2rem] border border-slate-200/80 bg-white/90 p-8 text-sm text-slate-500 shadow-xl shadow-slate-900/5 backdrop-blur dark:border-white/10 dark:bg-slate-950/70 dark:text-slate-300 dark:shadow-black/20">
          Loading shipment details...
        </div>
      </main>
    )
  }

  if (!shipment) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <section className="rounded-[2rem] border border-slate-200/80 bg-white/90 p-8 text-center shadow-xl shadow-slate-900/5 backdrop-blur dark:border-white/10 dark:bg-slate-950/70 dark:shadow-black/20">
          <p className="text-sm font-medium tracking-[0.24em] text-sky-600 uppercase dark:text-sky-200">
            ShipTrack
          </p>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 dark:text-white">
            Shipment unavailable
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
            {error || 'We could not find that shipment.'}
          </p>
          <Link
            to="/dashboard"
            className="mt-6 inline-flex items-center justify-center rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"
          >
            Back to dashboard
          </Link>
        </section>
      </main>
    )
  }

  const invoiceNo = shipment.invoiceNo ?? shipment.invoiceNumber ?? '—'
  const blNo = shipment.blNo ?? shipment.blNumber ?? '—'
  const carrier = shipment.carrier ?? 'Unknown'
  const consigneeName = shipment.consigneeName?.trim() || '—'
  const notes = shipment.notes?.trim() || 'No notes added.'
  const containerNumbers = Array.isArray(shipment.containerNumbers)
    ? shipment.containerNumbers
    : shipment.containerNumbers
      ? [shipment.containerNumbers]
      : []
  const daysLeft = getDayDifference(shipment.eta)

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium tracking-[0.24em] text-sky-600 uppercase dark:text-sky-200">
              ShipTrack
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950 dark:text-white">
              Shipment detail
            </h1>
            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
              Review shipment metadata, arrival timing, and recent tracking cache events.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              to="/dashboard"
              className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-100 dark:hover:bg-white/10"
            >
              Back to dashboard
            </Link>
            <Link
              to={`/edit/${shipment.id}`}
              className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-100 dark:hover:bg-white/10"
            >
              Edit
            </Link>
            <button
              type="button"
              onClick={handleDelete}
              disabled={isDeleting}
              className="inline-flex items-center justify-center rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-70 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200 dark:hover:bg-rose-500/15"
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        </div>

        {error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100">
            {error}
          </div>
        ) : null}

        <section className="rounded-[2rem] border border-slate-200/80 bg-white/90 p-6 shadow-xl shadow-slate-900/5 backdrop-blur dark:border-white/10 dark:bg-slate-950/70 dark:shadow-black/20 sm:p-8">
          <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="space-y-6">
              <div className="rounded-[2rem] border border-slate-200/70 bg-slate-50/80 p-6 dark:border-white/10 dark:bg-white/5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      Invoice {invoiceNo}
                    </p>
                    <h2 className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
                      {blNo}
                    </h2>
                  </div>

                  <span
                    className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${getCarrierBadgeClass(carrier)}`}
                  >
                    {carrier}
                  </span>
                </div>

                <div className="mt-6 grid gap-4 sm:grid-cols-3">
                  <div className="rounded-2xl border border-slate-200/70 bg-white p-4 dark:border-white/10 dark:bg-slate-950/70">
                    <p className="text-xs tracking-[0.24em] text-slate-500 uppercase dark:text-slate-400">
                      ETA
                    </p>
                    <p className="mt-2 text-lg font-semibold text-slate-950 dark:text-white">
                      {formatEta(shipment.eta)}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-slate-200/70 bg-white p-4 dark:border-white/10 dark:bg-slate-950/70">
                    <p className="text-xs tracking-[0.24em] text-slate-500 uppercase dark:text-slate-400">
                      Days to arrival
                    </p>
                    <p className="mt-2 text-lg font-semibold text-slate-950 dark:text-white">
                      {formatDaysLeft(daysLeft)}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-slate-200/70 bg-white p-4 dark:border-white/10 dark:bg-slate-950/70">
                    <p className="text-xs tracking-[0.24em] text-slate-500 uppercase dark:text-slate-400">
                      INV Amount
                    </p>
                    <p className="mt-2 text-lg font-semibold text-slate-950 dark:text-white">
                      {formatAmount(shipment.invAmount)}
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <DetailItem label="Invoice No">{invoiceNo}</DetailItem>
                <DetailItem label="B/L Number">{blNo}</DetailItem>
                <DetailItem label="Carrier">
                  <span
                    className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${getCarrierBadgeClass(carrier)}`}
                  >
                    {carrier}
                  </span>
                </DetailItem>
                <DetailItem label="Consignee">{consigneeName}</DetailItem>
              </div>

              <DetailItem label="Containers">
                {containerNumbers.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {containerNumbers.map((containerNumber) => (
                      <span
                        key={containerNumber}
                        className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 dark:border-white/10 dark:bg-slate-950/70 dark:text-slate-200"
                      >
                        {containerNumber}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span>—</span>
                )}
              </DetailItem>

              <DetailItem label="Notes">{notes}</DetailItem>
            </div>

            <section className="rounded-[2rem] border border-slate-200/70 bg-slate-50/80 p-6 dark:border-white/10 dark:bg-white/5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-slate-900 dark:text-white">
                    Tracking timeline
                  </p>
                  <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                    Loaded from tracking_cache/{blNo}
                  </p>
                </div>
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 dark:border-white/10 dark:bg-slate-950/70 dark:text-slate-300">
                  {timelineEvents.length} event{timelineEvents.length === 1 ? '' : 's'}
                </span>
              </div>

              {timelineEvents.length === 0 ? (
                <div className="mt-6 rounded-3xl border border-dashed border-slate-200 bg-white/80 px-4 py-8 text-center text-sm text-slate-500 dark:border-white/10 dark:bg-slate-950/70 dark:text-slate-300">
                  No cached tracking events found for this B/L number yet.
                </div>
              ) : (
                <ol className="mt-6 space-y-5">
                  {timelineEvents.map((event, index) => (
                    <li key={event.id} className="relative pl-8">
                      <span className="absolute left-0 top-1.5 flex h-3.5 w-3.5 rounded-full bg-sky-500 ring-4 ring-sky-100 dark:ring-sky-500/20" />
                      {index < timelineEvents.length - 1 ? (
                        <span className="absolute top-5 left-[6px] h-[calc(100%+1rem)] w-px bg-slate-200 dark:bg-white/10" />
                      ) : null}

                      <div className="rounded-2xl border border-slate-200/70 bg-white p-4 dark:border-white/10 dark:bg-slate-950/70">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <p className="text-sm font-semibold text-slate-950 dark:text-white">
                              {event.title}
                            </p>
                            {event.description ? (
                              <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
                                {event.description}
                              </p>
                            ) : null}
                          </div>

                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {formatDateTime(event.occurredAt)}
                          </p>
                        </div>

                        {event.location ? (
                          <p className="mt-3 text-xs font-medium tracking-[0.18em] text-slate-500 uppercase dark:text-slate-400">
                            {event.location}
                          </p>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        </section>
      </div>
    </main>
  )
}

export default ShipmentDetail

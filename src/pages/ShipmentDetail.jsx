import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { deleteDoc, doc, getDoc } from 'firebase/firestore'
import { db } from '../../firebase'
import useAuth from '../hooks/useAuth'
import { getCarrierBadgeClass, getCarrierLabel } from '../lib/carriers'
import { describeArchiveReason, setShipmentArchived } from '../lib/tracking'

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
        container: event?.container ?? '',
        estimated:
          event?.estimated ?? Boolean(occurredAt && occurredAt.getTime() > Date.now()),
        occurredAt,
        sortValue: occurredAt ? occurredAt.getTime() : index,
      }
    })
    .sort((left, right) => left.sortValue - right.sortValue)
}

const RECENT_EVENT_COUNT = 4

/**
 * One foldable group per container (plus one for B/L-level events),
 * ordered so the container with the most recent activity comes first.
 */
function groupTimelineEvents(events) {
  const groups = new Map()

  events.forEach((event) => {
    const key = event.container || 'bl'

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        label: event.container || 'Shipment',
        events: [],
      })
    }

    groups.get(key).events.push(event)
  })

  return Array.from(groups.values())
    .map((group) => {
      const actualEvents = group.events.filter((event) => !event.estimated)
      const latestEvent = actualEvents[actualEvents.length - 1] ?? null

      return {
        ...group,
        latestEvent,
        sortValue: latestEvent?.occurredAt ? latestEvent.occurredAt.getTime() : 0,
      }
    })
    .sort((left, right) => right.sortValue - left.sortValue)
}

function TimelineGroup({ group, defaultOpen }) {
  const [showAll, setShowAll] = useState(false)
  const actualEvents = group.events.filter((event) => !event.estimated)
  const plannedEvents = group.events.filter((event) => event.estimated)
  const hiddenCount = Math.max(actualEvents.length - RECENT_EVENT_COUNT, 0)
  const shownEvents = showAll
    ? group.events
    : [...actualEvents.slice(-RECENT_EVENT_COUNT), ...plannedEvents]

  return (
    <details
      open={defaultOpen}
      className="group rounded-2xl border border-slate-200/70 bg-white dark:border-white/10 dark:bg-slate-950/70"
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span
          aria-hidden="true"
          className="text-xs text-slate-400 transition group-open:rotate-90"
        >
          ▶
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-950 dark:text-white">
            {group.label}
          </p>
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">
            {group.latestEvent
              ? `${group.latestEvent.title} · ${formatDateTime(group.latestEvent.occurredAt)}`
              : 'Planned moves only'}
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:border-white/10 dark:text-slate-300">
          {group.events.length}
        </span>
      </summary>

      <div className="border-t border-slate-200/70 px-4 pt-3 pb-4 dark:border-white/10">
        {hiddenCount > 0 ? (
          <button
            type="button"
            onClick={() => setShowAll((current) => !current)}
            className="mb-3 text-xs font-medium text-sky-600 hover:underline dark:text-sky-300"
          >
            {showAll
              ? 'Show recent only'
              : `Show ${hiddenCount} earlier event${hiddenCount === 1 ? '' : 's'}`}
          </button>
        ) : null}

        <ol className="relative space-y-3 border-l border-slate-200 pl-4 dark:border-white/10">
          {shownEvents.map((event) => (
            <li key={event.id} className="relative">
              <span
                aria-hidden="true"
                className={`absolute top-1.5 -left-[21px] h-2.5 w-2.5 rounded-full ${
                  event.estimated
                    ? 'border-2 border-sky-500 bg-white dark:bg-slate-950'
                    : 'bg-sky-500'
                }`}
              />
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-medium text-slate-900 dark:text-white">
                  {event.title}
                  {event.estimated ? (
                    <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 align-middle text-[11px] font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-200">
                      Planned
                    </span>
                  ) : null}
                </p>
                <p className="shrink-0 text-xs text-slate-500 dark:text-slate-400">
                  {formatDateTime(event.occurredAt)}
                </p>
              </div>
              {event.location || event.description ? (
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {[event.location, event.description].filter(Boolean).join(' · ')}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      </div>
    </details>
  )
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
  const [trackingMeta, setTrackingMeta] = useState(null)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isArchiving, setIsArchiving] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

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
        let shipmentSnapshot = await getDoc(doc(db, 'shipments', shipmentId))
        let isArchived = false

        // Not active: it may have been moved to the archive.
        if (!shipmentSnapshot.exists()) {
          shipmentSnapshot = await getDoc(doc(db, 'archived_shipments', shipmentId))
          isArchived = true
        }

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
          isArchived,
        }

        if (isMounted) {
          setShipment(shipmentRecord)
        }

        // The tracking function writes tracking_cache/{shipmentId}.
        const trackingSnapshot = await getDoc(
          doc(db, 'tracking_cache', shipmentSnapshot.id),
        )
        const trackingData = trackingSnapshot.exists() ? trackingSnapshot.data() : null

        if (isMounted) {
          setTimelineEvents(extractTimelineEvents(trackingData))
          setTrackingMeta(
            trackingData
              ? {
                  status: trackingData.status ?? '',
                  source: trackingData.source ?? '',
                  checkedAt: trackingData.checkedAt ?? null,
                  error: trackingData.error ?? '',
                }
              : null,
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
          setTrackingMeta(null)
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
  }, [currentUser?.uid, navigate, shipmentId, reloadKey])

  const handleArchiveToggle = async () => {
    if (!shipment?.id) {
      return
    }

    const archiving = !shipment.isArchived

    if (
      archiving &&
      !window.confirm('Move this shipment to the archive? You can restore it later.')
    ) {
      return
    }

    setError('')
    setIsArchiving(true)

    try {
      await setShipmentArchived(shipment.id, archiving)
      setReloadKey((current) => current + 1)
    } catch (archiveError) {
      console.error('Failed to update archive state.', archiveError)
      setError(
        archiving
          ? 'Shipment could not be archived. Please try again.'
          : 'Shipment could not be restored. Please try again.',
      )
    } finally {
      setIsArchiving(false)
    }
  }

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
      await deleteDoc(
        doc(db, shipment.isArchived ? 'archived_shipments' : 'shipments', shipment.id),
      )
      navigate(shipment.isArchived ? '/archive' : '/dashboard', { replace: true })
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
  const timelineGroups = groupTimelineEvents(timelineEvents)

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
            {shipment.isArchived ? null : (
              <Link
                to={`/edit/${shipment.id}`}
                className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-100 dark:hover:bg-white/10"
              >
                Edit
              </Link>
            )}
            <button
              type="button"
              onClick={handleArchiveToggle}
              disabled={isArchiving}
              className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70 dark:border-white/10 dark:bg-white/5 dark:text-slate-100 dark:hover:bg-white/10"
            >
              {isArchiving ? 'Working...' : shipment.isArchived ? 'Restore' : 'Archive'}
            </button>
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

        {shipment.isArchived ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-200">
            Archived {formatEta(shipment.archivedAt)} ·{' '}
            {describeArchiveReason(shipment.archiveReason)}. Restore it to edit or
            track it again.
          </div>
        ) : null}

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
                    {getCarrierLabel(carrier)}
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
                    {getCarrierLabel(carrier)}
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
                    {trackingMeta?.checkedAt
                      ? `Last checked ${formatDateTime(trackingMeta.checkedAt)}`
                      : 'Not checked yet'}
                  </p>
                </div>
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 dark:border-white/10 dark:bg-slate-950/70 dark:text-slate-300">
                  {timelineEvents.length} event{timelineEvents.length === 1 ? '' : 's'}
                </span>
              </div>

              {trackingMeta?.error ? (
                <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
                  Last live check failed: {trackingMeta.error}
                </div>
              ) : null}

              {timelineEvents.length === 0 ? (
                <div className="mt-6 rounded-3xl border border-dashed border-slate-200 bg-white/80 px-4 py-8 text-center text-sm text-slate-500 dark:border-white/10 dark:bg-slate-950/70 dark:text-slate-300">
                  No tracking events recorded for this shipment yet.
                </div>
              ) : (
                <div className="mt-6 space-y-3">
                  {timelineGroups.map((group, index) => (
                    <TimelineGroup
                      key={group.key}
                      group={group}
                      defaultOpen={index === 0}
                    />
                  ))}
                </div>
              )}
            </section>
          </div>
        </section>
      </div>
    </main>
  )
}

export default ShipmentDetail

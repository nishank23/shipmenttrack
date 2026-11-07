import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore'
import { db } from '../../firebase'
import { Icon } from '@iconify/react'
import useAuth from '../hooks/useAuth'
import ArrivalLane from '../components/ArrivalLane'
import { gsap, prefersReducedMotion, useSmoothScroll } from '../lib/motion'
import { getCarrierLabel } from '../lib/carriers'
import { setShipmentArchived } from '../lib/tracking'

const DAY_MS = 86400000

// Urgency buckets double as the filter tabs at the top of the screen.
const buckets = [
  { key: 'all', label: 'All shipments' },
  { key: 'overdue', label: 'Past ETA' },
  { key: 'week', label: 'Arriving in 7 days' },
  { key: 'fortnight', label: 'In 8–14 days' },
  { key: 'later', label: 'Later or no ETA' },
]

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

const shortDateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
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

  const parsedDate = value instanceof Date ? value : new Date(value)
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate
}

function startOfDay(date) {
  const day = new Date(date)
  day.setHours(0, 0, 0, 0)
  return day
}

function getDayDifference(value) {
  const etaDate = normalizeDate(value)
  return etaDate
    ? Math.round((startOfDay(etaDate).getTime() - startOfDay(new Date()).getTime()) / DAY_MS)
    : null
}

function getBucket(daysLeft) {
  if (daysLeft === null) return 'later'
  if (daysLeft < 0) return 'overdue'
  if (daysLeft <= 7) return 'week'
  if (daysLeft <= 14) return 'fortnight'
  return 'later'
}

function formatDaysLeft(daysLeft) {
  if (daysLeft === null) return 'No ETA'
  if (daysLeft < 0) {
    const days = Math.abs(daysLeft)
    return `${days} day${days === 1 ? '' : 's'} past ETA`
  }
  if (daysLeft === 0) return 'Due today'
  return `In ${daysLeft} day${daysLeft === 1 ? '' : 's'}`
}

// Colour carries urgency only.
function urgencyText(bucket) {
  if (bucket === 'overdue') return 'text-rose-600 dark:text-rose-300'
  if (bucket === 'week') return 'text-amber-700 dark:text-amber-300'
  return 'text-slate-600 dark:text-slate-300'
}

function formatAmount(value) {
  if (value === undefined || value === null || value === '') return '—'
  const amount = typeof value === 'string' ? Number(value.replaceAll(',', '')) : Number(value)
  return Number.isNaN(amount) ? '—' : currencyFormatter.format(amount)
}

function mapShipment(documentSnapshot) {
  const data = documentSnapshot.data()
  const eta = normalizeDate(data.eta)
  const daysLeft = getDayDifference(eta)
  const latestEvent = data.latestEvent?.title
    ? {
        title: data.latestEvent.title,
        location: data.latestEvent.location ?? '',
        occurredAt: normalizeDate(data.latestEvent.occurredAt),
      }
    : null

  return {
    id: documentSnapshot.id,
    invoiceNo:
      data.invoiceNo ?? data.invoiceNumber ?? data.invoice ?? data.invoice_number ?? '—',
    blNo: data.blNo ?? data.blNumber ?? data.billOfLadingNo ?? data.bill_of_lading_no ?? '—',
    carrier: String(data.carrier ?? 'Unknown').trim() || 'Unknown',
    consigneeName: String(data.consigneeName ?? '').trim(),
    eta,
    daysLeft,
    bucket: getBucket(daysLeft),
    invAmount: data.invAmount ?? data.invoiceAmount ?? data.amount ?? '',
    latestEvent,
    eventCount: data.eventCount ?? 0,
    trackingStatus: data.trackingStatus ?? '',
  }
}

function ShipTrackMark() {
  // A container seen side-on: the product's object, in the accent.
  return (
    <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
      <rect x="2" y="8" width="28" height="16" rx="2" className="fill-[#1f3038] dark:fill-teal-300" />
      <path
        d="M8 11v10M13 11v10M18 11v10M23 11v10"
        className="stroke-white dark:stroke-[#06101f]"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

function Dashboard() {
  const { currentUser, signOut } = useAuth()
  const navigate = useNavigate()
  const [shipments, setShipments] = useState([])
  const [bucket, setBucket] = useState('all')
  const [carrierFilter, setCarrierFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [quickBl, setQuickBl] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  const kpiRef = useRef(null)
  const listRef = useRef(null)
  const countedRef = useRef(false)

  useSmoothScroll()

  useEffect(() => {
    if (!currentUser?.uid) {
      setShipments([])
      setIsLoading(false)
      return undefined
    }

    setIsLoading(true)
    setError('')

    const shipmentsQuery = query(
      collection(db, 'shipments'),
      where('uid', '==', currentUser.uid),
      orderBy('eta', 'asc'),
    )

    return onSnapshot(
      shipmentsQuery,
      (snapshot) => {
        setShipments(snapshot.docs.map(mapShipment))
        setIsLoading(false)
      },
      (snapshotError) => {
        console.error('Failed to load shipments from Firestore.', snapshotError)
        setError('Shipments could not be loaded. Check your connection and refresh.')
        setIsLoading(false)
      },
    )
  }, [currentUser?.uid])

  const counts = useMemo(() => {
    const result = { all: shipments.length, overdue: 0, week: 0, fortnight: 0, later: 0 }
    shipments.forEach((shipment) => {
      result[shipment.bucket] += 1
    })
    return result
  }, [shipments])

  const carriers = useMemo(
    () => Array.from(new Set(shipments.map((shipment) => shipment.carrier))).sort(),
    [shipments],
  )

  const searchTerm = search.trim().toLowerCase()
  const visible = shipments.filter((shipment) => {
    if (bucket !== 'all' && shipment.bucket !== bucket) return false
    if (carrierFilter !== 'all' && shipment.carrier !== carrierFilter) return false
    if (!searchTerm) return true
    return [shipment.invoiceNo, shipment.blNo, shipment.consigneeName]
      .join(' ')
      .toLowerCase()
      .includes(searchTerm)
  })

  const laneShipments = shipments.map((shipment) => ({
    id: shipment.id,
    label: shipment.invoiceNo,
    daysLeft: shipment.daysLeft,
    bucket: shipment.bucket,
    href: `/shipments/${shipment.id}`,
    lines: [
      `${shipment.blNo} · ${getCarrierLabel(shipment.carrier)}`,
      `ETA ${shipment.eta ? dateFormatter.format(shipment.eta) : '—'} · ${formatDaysLeft(shipment.daysLeft)}`,
      shipment.latestEvent
        ? `${shipment.latestEvent.title}${shipment.latestEvent.location ? `, ${shipment.latestEvent.location}` : ''}`
        : 'Waiting for first carrier check',
    ],
  }))
  const visibleKey = visible.map((shipment) => shipment.id).join('|')

  // KPI figures count up once, when the first data arrives.
  useLayoutEffect(() => {
    const root = kpiRef.current
    if (!root || isLoading || countedRef.current) return
    countedRef.current = true
    if (prefersReducedMotion()) return

    root.querySelectorAll('[data-count]').forEach((node, index) => {
      const target = Number(node.dataset.count)
      const counter = { value: 0 }
      gsap.to(counter, {
        value: target,
        duration: 1.1,
        delay: index * 0.05,
        ease: 'expo.out',
        onUpdate: () => {
          node.textContent = String(Math.round(counter.value))
        },
      })
    })
  }, [isLoading])

  // Rows ease in whenever the visible set changes (load, filter, search).
  useLayoutEffect(() => {
    const root = listRef.current
    if (!root || prefersReducedMotion()) return undefined

    const ctx = gsap.context(() => {
      gsap.from('[data-row]', {
        y: 10,
        opacity: 0,
        duration: 0.6,
        stagger: 0.035,
        ease: 'expo.out',
        clearProps: 'transform,opacity',
      })
    }, root)

    return () => ctx.revert()
  }, [visibleKey])

  const nextArrival = shipments.find((shipment) => shipment.daysLeft !== null && shipment.daysLeft >= 0)
  const hasFilters = bucket !== 'all' || carrierFilter !== 'all' || searchTerm

  const handleSignOut = async () => {
    setError('')
    setIsSigningOut(true)

    try {
      await signOut()
    } catch (signOutError) {
      console.error('Sign-out failed.', signOutError)
      setError('Sign-out failed. Try again.')
    } finally {
      setIsSigningOut(false)
    }
  }

  const handleQuickTrack = (event) => {
    event.preventDefault()
    const bl = quickBl.toUpperCase().replace(/[^A-Z0-9-]/g, '')
    navigate(bl ? `/add?bl=${encodeURIComponent(bl)}` : '/add')
  }

  const runRowAction = async (shipmentId, action) => {
    setError('')
    setBusyId(shipmentId)

    try {
      await action()
    } catch (actionError) {
      console.error('Shipment action failed.', actionError)
      setError('That did not work. Try again.')
    } finally {
      setBusyId('')
    }
  }

  const handleArchive = (shipmentId) => {
    if (window.confirm('Move this shipment to the archive? You can restore it later.')) {
      runRowAction(shipmentId, () => setShipmentArchived(shipmentId, true))
    }
  }

  const handleDelete = (shipmentId) => {
    if (window.confirm('Delete this shipment? This cannot be undone.')) {
      runRowAction(shipmentId, () => deleteDoc(doc(db, 'shipments', shipmentId)))
    }
  }

  const clearFilters = () => {
    setBucket('all')
    setCarrierFilter('all')
    setSearch('')
  }

  const displayName = currentUser?.displayName || currentUser?.email || 'ShipTrack user'
  const navClass = ({ isActive }) =>
    `rounded-md px-3 py-2 text-sm transition ${
      isActive
        ? 'bg-slate-100 font-semibold text-slate-950 dark:bg-white/10 dark:text-white'
        : 'text-slate-600 hover:text-slate-950 dark:text-slate-300 dark:hover:text-white'
    }`

  const iconButton =
    'inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-950 active:scale-95 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-white'

  const rowActions = (shipment) => (
    <div className="inline-flex gap-0.5">
      <Link to={`/edit/${shipment.id}`} className={iconButton} title="Edit" aria-label={`Edit ${shipment.invoiceNo}`}>
        <Icon icon="solar:pen-2-linear" width="18" height="18" aria-hidden="true" />
      </Link>
      <button
        type="button"
        onClick={() => handleArchive(shipment.id)}
        disabled={busyId === shipment.id}
        className={iconButton}
        title="Move to archive"
        aria-label={`Archive ${shipment.invoiceNo}`}
      >
        <Icon icon="solar:archive-down-minimlistic-linear" width="18" height="18" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={() => handleDelete(shipment.id)}
        disabled={busyId === shipment.id}
        className={`${iconButton} hover:!bg-rose-50 hover:!text-rose-700 dark:hover:!bg-rose-500/10 dark:hover:!text-rose-300`}
        title="Delete"
        aria-label={`Delete ${shipment.invoiceNo}`}
      >
        <Icon icon="solar:trash-bin-minimalistic-linear" width="18" height="18" aria-hidden="true" />
      </button>
    </div>
  )

  const eventSummary = (shipment) =>
    shipment.latestEvent
      ? [
          shipment.latestEvent.location,
          shipment.latestEvent.occurredAt ? shortDateFormatter.format(shipment.latestEvent.occurredAt) : '',
        ]
          .filter(Boolean)
          .join(' · ')
      : ''

  return (
    <div className="min-h-screen bg-[#f7f9fa] text-[#1f3038] dark:bg-[#06101f] dark:text-slate-100">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 dark:border-white/10 dark:bg-[#0a1628]/95">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6 lg:px-8">
          <Link to="/dashboard" className="flex items-center gap-2 text-base font-bold">
            <ShipTrackMark />
            ShipTrack
          </Link>
          <nav aria-label="Main" className="order-3 flex w-full items-center gap-1 overflow-x-auto sm:order-none sm:w-auto">
            <NavLink to="/dashboard" className={navClass}>
              <span className="inline-flex items-center gap-2">
                <Icon icon="solar:box-linear" width="18" height="18" aria-hidden="true" />
                Shipments
              </span>
            </NavLink>
            <NavLink to="/archive" className={navClass}>
              <span className="inline-flex items-center gap-2">
                <Icon icon="solar:archive-linear" width="18" height="18" aria-hidden="true" />
                Archive
              </span>
            </NavLink>
            <NavLink to="/profile" className={navClass}>
              <span className="inline-flex items-center gap-2 whitespace-nowrap">
                <Icon icon="solar:bell-linear" width="18" height="18" aria-hidden="true" />
                Alerts &amp; profile
              </span>
            </NavLink>
          </nav>
          <div className="ml-auto flex min-w-0 items-center gap-2">
            {currentUser?.photoURL ? (
              <img
                src={currentUser.photoURL}
                alt=""
                referrerPolicy="no-referrer"
                className="h-8 w-8 flex-none rounded-full object-cover"
              />
            ) : (
              <Icon icon="solar:user-circle-linear" width="32" height="32" className="flex-none text-slate-400" aria-hidden="true" />
            )}
            <span className="hidden max-w-[12rem] truncate text-sm text-slate-600 sm:inline dark:text-slate-300">
              {displayName}
            </span>
            <button
              type="button"
              onClick={handleSignOut}
              disabled={isSigningOut}
              className={iconButton}
              title="Sign out"
              aria-label="Sign out"
            >
              <Icon icon="solar:logout-2-linear" width="18" height="18" aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">Shipments</h1>
            <p className="mt-1 truncate text-sm text-slate-600 dark:text-slate-300">
              {isLoading
                ? 'Loading…'
                : nextArrival
                  ? `${counts.all} active · next arrival ${nextArrival.invoiceNo}, ${formatDaysLeft(nextArrival.daysLeft).toLowerCase()}`
                  : `${counts.all} active`}
            </p>
          </div>

          <form onSubmit={handleQuickTrack} className="flex w-full gap-2 lg:max-w-md">
            <label htmlFor="quick-bl" className="sr-only">
              B/L number to track
            </label>
            <div className="relative min-w-0 flex-1">
              <Icon
                icon="solar:box-linear"
                width="18"
                height="18"
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400"
              />
              <input
                id="quick-bl"
                value={quickBl}
                onChange={(event) => setQuickBl(event.target.value)}
                placeholder="Track a B/L number"
                maxLength={40}
                autoComplete="off"
                spellCheck="false"
                className="h-10 w-full rounded-lg border border-slate-300 bg-white pr-3 pl-9 text-sm uppercase transition placeholder:normal-case focus:border-teal-600 focus:ring-2 focus:ring-teal-200 focus:outline-none dark:border-white/15 dark:bg-[#0d1b30] dark:focus:border-teal-300 dark:focus:ring-teal-300/20"
              />
            </div>
            <button
              type="submit"
              className="inline-flex h-10 flex-none items-center gap-2 rounded-lg bg-teal-600 px-4 text-sm font-semibold text-white transition hover:bg-teal-700 active:scale-[0.97] dark:bg-teal-300 dark:text-[#06101f] dark:hover:bg-teal-200"
            >
              <Icon icon="solar:add-circle-linear" width="18" height="18" aria-hidden="true" />
              <span className="whitespace-nowrap">Add shipment</span>
            </button>
          </form>
        </div>

        {error ? (
          <div role="alert" className="flex items-center gap-2 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:bg-rose-500/10 dark:text-rose-200">
            <Icon icon="solar:danger-triangle-linear" width="18" height="18" aria-hidden="true" />
            {error}
          </div>
        ) : null}

        <div
          ref={kpiRef}
          role="group"
          aria-label="Filter by arrival"
          className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-xl bg-white px-5 py-4 sm:grid-cols-3 lg:grid-cols-5 dark:bg-[#0d1b30]"
        >
          {buckets.map((item) => {
            const active = bucket === item.key
            const count = counts[item.key]

            return (
              <button
                key={item.key}
                type="button"
                aria-pressed={active}
                onClick={() => setBucket(active && item.key !== 'all' ? 'all' : item.key)}
                className={`min-w-0 rounded-md text-left transition duration-300 ${active ? '' : 'opacity-60 hover:opacity-100'}`}
              >
                <span
                  data-count={count}
                  className={`block text-3xl font-semibold tabular-nums ${
                    item.key === 'overdue' && count > 0
                      ? 'text-rose-600 dark:text-rose-300'
                      : item.key === 'week' && count > 0
                        ? 'text-amber-700 dark:text-amber-300'
                        : ''
                  }`}
                >
                  {count}
                </span>
                <span
                  className={`mt-1 block truncate border-b-2 pb-1 text-sm transition-colors duration-300 ${
                    active
                      ? 'border-teal-600 font-semibold dark:border-teal-300'
                      : 'border-transparent text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {item.label}
                </span>
              </button>
            )
          })}
        </div>

        {shipments.length > 0 ? (
          <div className="rounded-xl bg-white px-5 pt-4 pb-4 dark:bg-[#0d1b30]">
            <ArrivalLane
              shipments={laneShipments}
              title="Arrival lane"
              caption="Three weeks back to five weeks ahead · hover a shipment for details"
            />
          </div>
        ) : null}

        <section aria-labelledby="list-title" className="overflow-hidden rounded-xl bg-white dark:bg-[#0d1b30]">
          <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between dark:border-white/10">
            <h2 id="list-title" className="min-w-0 truncate text-sm font-semibold">
              {bucket === 'all' ? 'All shipments' : buckets.find((item) => item.key === bucket)?.label}
              <span className="ml-2 font-normal text-slate-500 dark:text-slate-400">
                {visible.length} of {shipments.length}
              </span>
            </h2>
            <div className="flex flex-col gap-2 sm:flex-row">
              <label className="sr-only" htmlFor="search">
                Search shipments
              </label>
              <div className="relative">
                <Icon
                  icon="solar:magnifer-linear"
                  width="18"
                  height="18"
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400"
                />
                <input
                  id="search"
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Invoice, B/L or consignee"
                  className="h-10 w-full rounded-lg border border-slate-300 bg-white pr-3 pl-9 text-sm transition sm:w-64 focus:border-teal-600 focus:ring-2 focus:ring-teal-200 focus:outline-none dark:border-white/15 dark:bg-[#06101f] dark:focus:border-teal-300 dark:focus:ring-teal-300/20"
                />
              </div>
              <label className="sr-only" htmlFor="carrier">
                Carrier
              </label>
              <select
                id="carrier"
                value={carrierFilter}
                onChange={(event) => setCarrierFilter(event.target.value)}
                className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-white/15 dark:bg-[#06101f]"
              >
                <option value="all">All carriers</option>
                {carriers.map((carrier) => (
                  <option key={carrier} value={carrier}>
                    {getCarrierLabel(carrier)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {isLoading ? (
            <div className="space-y-3 px-5 py-6" aria-label="Loading shipments">
              {[0, 1, 2].map((row) => (
                <div key={row} className="h-12 animate-pulse rounded-lg bg-slate-100 dark:bg-white/5" />
              ))}
            </div>
          ) : shipments.length === 0 ? (
            <div className="px-5 py-16 text-center">
              <Icon icon="solar:box-linear" width="36" height="36" className="mx-auto text-slate-400" aria-hidden="true" />
              <p className="mt-3 text-base font-semibold">No shipments yet</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-slate-600 dark:text-slate-300">
                Paste a B/L number above. ShipTrack reads the carrier and loads every container move
                and the ETA.
              </p>
            </div>
          ) : visible.length === 0 ? (
            <div className="px-5 py-16 text-center">
              <p className="text-sm break-words text-slate-600 dark:text-slate-300">
                Nothing matches {searchTerm ? `“${search.trim()}”` : 'these filters'}.
              </p>
              {hasFilters ? (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="mt-3 text-sm font-semibold text-teal-700 hover:underline dark:text-teal-300"
                >
                  Clear filters
                </button>
              ) : null}
            </div>
          ) : (
            <div ref={listRef}>
              <table className="hidden w-full table-fixed text-left text-sm md:table">
                <colgroup>
                  <col className="w-[20%]" />
                  <col className="w-[17%]" />
                  <col className="w-[27%]" />
                  <col className="w-[15%]" />
                  <col className="w-[11%]" />
                  <col className="w-[10%]" />
                </colgroup>
                <thead className="text-slate-500 dark:text-slate-400">
                  <tr className="border-b border-slate-200 dark:border-white/10">
                    <th scope="col" className="px-5 py-3 font-medium">Shipment</th>
                    <th scope="col" className="px-3 py-3 font-medium">B/L</th>
                    <th scope="col" className="px-3 py-3 font-medium">Latest event</th>
                    <th scope="col" className="px-3 py-3 font-medium">ETA</th>
                    <th scope="col" className="px-3 py-3 text-right font-medium">Amount</th>
                    <th scope="col" className="px-5 py-3 text-right font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((shipment) => (
                    <tr
                      key={shipment.id}
                      data-row
                      className="group border-b border-slate-100 align-top transition-colors duration-200 last:border-0 hover:bg-slate-50 dark:border-white/5 dark:hover:bg-white/[0.03]"
                    >
                      <td className="px-5 py-3">
                        <Link
                          to={`/shipments/${shipment.id}`}
                          className="block truncate font-semibold text-slate-950 hover:underline dark:text-white"
                          title={shipment.invoiceNo}
                        >
                          {shipment.invoiceNo}
                        </Link>
                        <p className="truncate text-slate-500 dark:text-slate-400" title={shipment.consigneeName}>
                          {shipment.consigneeName || '—'}
                        </p>
                      </td>
                      <td className="px-3 py-3">
                        <p className="truncate tabular-nums" title={shipment.blNo}>
                          {shipment.blNo}
                        </p>
                        <p className="truncate text-slate-500 dark:text-slate-400">
                          {getCarrierLabel(shipment.carrier)}
                        </p>
                      </td>
                      <td className="px-3 py-3">
                        {shipment.latestEvent ? (
                          <>
                            <p className="truncate" title={shipment.latestEvent.title}>
                              {shipment.latestEvent.title}
                            </p>
                            <p className="truncate text-slate-500 dark:text-slate-400" title={eventSummary(shipment)}>
                              {eventSummary(shipment)}
                            </p>
                          </>
                        ) : (
                          <p className="truncate text-slate-400 dark:text-slate-500">
                            {shipment.trackingStatus === 'error' ? 'Carrier did not answer' : 'Waiting for first check'}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <p className="truncate tabular-nums">
                          {shipment.eta ? dateFormatter.format(shipment.eta) : '—'}
                        </p>
                        <p className={`truncate ${urgencyText(shipment.bucket)}`}>{formatDaysLeft(shipment.daysLeft)}</p>
                      </td>
                      <td className="truncate px-3 py-3 text-right tabular-nums">{formatAmount(shipment.invAmount)}</td>
                      <td className="px-5 py-2 text-right">{rowActions(shipment)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <ul className="divide-y divide-slate-100 md:hidden dark:divide-white/5">
                {visible.map((shipment) => (
                  <li key={shipment.id} data-row className="px-5 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link
                          to={`/shipments/${shipment.id}`}
                          className="block truncate font-semibold text-slate-950 hover:underline dark:text-white"
                        >
                          {shipment.invoiceNo}
                        </Link>
                        <p className="truncate text-sm text-slate-500 dark:text-slate-400">
                          {shipment.blNo} · {getCarrierLabel(shipment.carrier)}
                        </p>
                      </div>
                      <div className="flex-none text-right">
                        <p className="text-sm tabular-nums">
                          {shipment.eta ? shortDateFormatter.format(shipment.eta) : '—'}
                        </p>
                        <p className={`text-sm ${urgencyText(shipment.bucket)}`}>{formatDaysLeft(shipment.daysLeft)}</p>
                      </div>
                    </div>
                    <p className="mt-2 text-sm break-words text-slate-700 dark:text-slate-200">
                      {shipment.latestEvent
                        ? `${shipment.latestEvent.title}${eventSummary(shipment) ? ` · ${eventSummary(shipment)}` : ''}`
                        : 'Waiting for first check'}
                    </p>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-sm text-slate-500 tabular-nums dark:text-slate-400">
                        {formatAmount(shipment.invAmount)}
                      </span>
                      {rowActions(shipment)}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

export default Dashboard

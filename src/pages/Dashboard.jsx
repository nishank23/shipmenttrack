import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
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
import useAuth from '../hooks/useAuth'

const carrierBadgeStyles = {
  MSC: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-200',
  ONE: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-200',
  EVERGREEN:
    'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200',
  PIL: 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-200',
}

const statusOptions = [
  { value: 'all', label: 'All statuses' },
  { value: 'arriving-this-week', label: 'Arriving this week' },
  { value: 'arriving-in-14-days', label: 'Arriving in 14 days' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'scheduled', label: 'Scheduled later' },
]

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
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

function getStatusKey(daysLeft) {
  if (daysLeft === null) {
    return 'scheduled'
  }

  if (daysLeft < 0) {
    return 'overdue'
  }

  if (daysLeft <= 7) {
    return 'arriving-this-week'
  }

  if (daysLeft <= 14) {
    return 'arriving-in-14-days'
  }

  return 'scheduled'
}

function getDaysLeftClasses(daysLeft) {
  if (daysLeft === null) {
    return 'bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-200'
  }

  if (daysLeft <= 7) {
    return 'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-200'
  }

  if (daysLeft <= 14) {
    return 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-200'
  }

  return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200'
}

function formatEta(value) {
  const date = normalizeDate(value)
  return date ? dateFormatter.format(date) : 'No ETA'
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

function mapShipment(documentSnapshot) {
  const data = documentSnapshot.data()
  const daysLeft = getDayDifference(data.eta)
  const carrier = String(data.carrier ?? 'Unknown').trim() || 'Unknown'

  return {
    id: documentSnapshot.id,
    invoiceNo:
      data.invoiceNo ??
      data.invoiceNumber ??
      data.invoice ??
      data.invoice_number ??
      '—',
    blNo:
      data.blNo ??
      data.blNumber ??
      data.billOfLadingNo ??
      data.bill_of_lading_no ??
      '—',
    carrier,
    eta: data.eta,
    daysLeft,
    statusKey: getStatusKey(daysLeft),
    invAmount: data.invAmount ?? data.invoiceAmount ?? data.amount ?? '',
  }
}

function Dashboard() {
  const { currentUser, signOut } = useAuth()
  const [shipments, setShipments] = useState([])
  const [carrierFilter, setCarrierFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [isLoading, setIsLoading] = useState(true)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [deletingId, setDeletingId] = useState('')
  const [error, setError] = useState('')

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

    const unsubscribe = onSnapshot(
      shipmentsQuery,
      (snapshot) => {
        setShipments(snapshot.docs.map(mapShipment))
        setIsLoading(false)
      },
      (snapshotError) => {
        console.error('Failed to load shipments from Firestore.', snapshotError)
        setError('Unable to load shipments right now. Please try again shortly.')
        setIsLoading(false)
      },
    )

    return unsubscribe
  }, [currentUser?.uid])

  const handleSignOut = async () => {
    setError('')
    setIsSigningOut(true)

    try {
      await signOut()
    } catch (signOutError) {
      console.error('Sign-out failed.', signOutError)
      setError('Sign-out failed. Please try again.')
    } finally {
      setIsSigningOut(false)
    }
  }

  const handleDelete = async (shipmentId) => {
    const confirmed = window.confirm('Delete this shipment? This action cannot be undone.')

    if (!confirmed) {
      return
    }

    setError('')
    setDeletingId(shipmentId)

    try {
      await deleteDoc(doc(db, 'shipments', shipmentId))
    } catch (deleteError) {
      console.error('Failed to delete shipment.', deleteError)
      setError('Shipment could not be deleted. Please try again.')
    } finally {
      setDeletingId('')
    }
  }

  const carriers = Array.from(
    new Set(shipments.map((shipment) => shipment.carrier).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right))

  const filteredShipments = shipments.filter((shipment) => {
    const matchesCarrier =
      carrierFilter === 'all' || shipment.carrier.toUpperCase() === carrierFilter
    const matchesStatus =
      statusFilter === 'all' || shipment.statusKey === statusFilter

    return matchesCarrier && matchesStatus
  })

  const summaryCards = [
    {
      label: 'Total shipments',
      value: shipments.length,
      tone: 'text-slate-900 dark:text-white',
    },
    {
      label: 'Arriving this week',
      value: shipments.filter((shipment) => shipment.statusKey === 'arriving-this-week')
        .length,
      tone: 'text-rose-600 dark:text-rose-200',
    },
    {
      label: 'Arriving in 14 days',
      value: shipments.filter((shipment) => shipment.statusKey === 'arriving-in-14-days')
        .length,
      tone: 'text-amber-600 dark:text-amber-200',
    },
    {
      label: 'Overdue',
      value: shipments.filter((shipment) => shipment.statusKey === 'overdue').length,
      tone: 'text-rose-600 dark:text-rose-200',
    },
  ]

  const displayName = currentUser?.displayName ?? 'ShipTrack User'
  const userEmail = currentUser?.email ?? 'No email'
  const userInitial = (displayName[0] ?? userEmail[0] ?? 'S').toUpperCase()

  return (
    <main className="app-shell mx-auto min-h-screen w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="space-y-6">
        <header className="app-motion-card flex flex-col gap-4 rounded-[2rem] border border-slate-200/80 bg-white/90 p-5 shadow-xl shadow-slate-900/5 backdrop-blur dark:border-white/10 dark:bg-slate-950/70 dark:shadow-black/20 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-medium tracking-[0.24em] text-sky-600 uppercase dark:text-sky-200">
              ShipTrack
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950 dark:text-white">
              Shipment dashboard
            </h1>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              Monitor ETAs, spot overdue freight, and act on upcoming arrivals.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-white/10 dark:bg-white/5">
              {currentUser?.photoURL ? (
                <img
                  src={currentUser.photoURL}
                  alt={displayName}
                  className="h-10 w-10 rounded-full object-cover"
                />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-950 text-sm font-semibold text-white dark:bg-white dark:text-slate-950">
                  {userInitial}
                </div>
              )}

              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-950 dark:text-white">
                  {displayName}
                </p>
                <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                  {userEmail}
                </p>
              </div>
            </div>

            <Link
              to="/profile"
              className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-100 dark:hover:bg-white/10"
            >
              Profile
            </Link>

            <button
              type="button"
              onClick={handleSignOut}
              disabled={isSigningOut}
              className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70 dark:border-white/10 dark:bg-white/5 dark:text-slate-100 dark:hover:bg-white/10"
            >
              {isSigningOut ? 'Signing out...' : 'Sign out'}
            </button>
          </div>
        </header>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {summaryCards.map((card) => (
            <article
              key={card.label}
              className="app-motion-card rounded-3xl border border-slate-200/70 bg-white/90 p-5 shadow-lg shadow-slate-900/5 dark:border-white/10 dark:bg-slate-950/70 dark:shadow-black/20"
            >
              <p className="text-sm text-slate-500 dark:text-slate-400">{card.label}</p>
              <p className={`mt-3 text-3xl font-semibold ${card.tone}`}>{card.value}</p>
            </article>
          ))}
        </section>

        <section className="app-motion-card rounded-[2rem] border border-slate-200/80 bg-white/90 p-5 shadow-xl shadow-slate-900/5 dark:border-white/10 dark:bg-slate-950/70 dark:shadow-black/20 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-col gap-4 md:flex-row md:items-end">
              <label className="flex min-w-[180px] flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                Carrier
                <select
                  value={carrierFilter}
                  onChange={(event) => setCarrierFilter(event.target.value)}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-200 dark:border-white/10 dark:bg-slate-900 dark:text-white dark:focus:border-sky-400 dark:focus:ring-sky-500/20"
                >
                  <option value="all">All carriers</option>
                  {carriers.map((carrier) => (
                    <option key={carrier} value={carrier.toUpperCase()}>
                      {carrier}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex min-w-[220px] flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                Status
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-200 dark:border-white/10 dark:bg-slate-900 dark:text-white dark:focus:border-sky-400 dark:focus:ring-sky-500/20"
                >
                  {statusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Showing {filteredShipments.length} of {shipments.length} shipments
              </p>

              <Link
                to="/add"
                className="inline-flex items-center justify-center rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white shadow-lg shadow-slate-950/10 transition hover:-translate-y-0.5 hover:bg-slate-800 dark:bg-cyan-300 dark:text-slate-950 dark:shadow-cyan-400/10 dark:hover:bg-cyan-200"
              >
                Add shipment
              </Link>
            </div>
          </div>

          {error ? (
            <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100">
              {error}
            </div>
          ) : null}

          <div className="mt-6 overflow-hidden rounded-3xl border border-slate-200/70 dark:border-white/10">
            {isLoading ? (
              <div className="flex min-h-56 items-center justify-center bg-white/90 px-6 py-12 text-sm text-slate-500 dark:bg-slate-950/80 dark:text-slate-300">
                Loading shipments...
              </div>
            ) : shipments.length === 0 ? (
              <div className="flex min-h-72 flex-col items-center justify-center bg-white/90 px-6 py-12 text-center dark:bg-slate-950/80">
                <div className="rounded-full bg-slate-100 px-4 py-2 text-2xl dark:bg-white/5">
                  🚢
                </div>
                <h2 className="mt-4 text-xl font-semibold text-slate-950 dark:text-white">
                  No shipments yet
                </h2>
                <p className="mt-2 max-w-md text-sm leading-6 text-slate-500 dark:text-slate-300">
                  Add your first shipment to track invoice details, upcoming ETAs,
                  and overdue containers from one place.
                </p>
                <Link
                  to="/add"
                  className="mt-6 inline-flex items-center justify-center rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white shadow-lg shadow-slate-950/10 transition hover:-translate-y-0.5 hover:bg-slate-800 dark:bg-cyan-300 dark:text-slate-950 dark:shadow-cyan-400/10 dark:hover:bg-cyan-200"
                >
                  Add shipment
                </Link>
              </div>
            ) : filteredShipments.length === 0 ? (
              <div className="flex min-h-56 items-center justify-center bg-white/90 px-6 py-12 text-center text-sm text-slate-500 dark:bg-slate-950/80 dark:text-slate-300">
                No shipments match the current carrier and status filters.
              </div>
            ) : (
              <div className="overflow-x-auto bg-white/90 dark:bg-slate-950/80">
                <table className="min-w-full text-left">
                  <thead className="bg-slate-50 text-xs tracking-[0.2em] text-slate-500 uppercase dark:bg-white/5 dark:text-slate-400">
                    <tr>
                      <th className="px-4 py-4 font-medium sm:px-6">Invoice No</th>
                      <th className="px-4 py-4 font-medium sm:px-6">B/L No</th>
                      <th className="px-4 py-4 font-medium sm:px-6">Carrier</th>
                      <th className="px-4 py-4 font-medium sm:px-6">ETA</th>
                      <th className="px-4 py-4 font-medium sm:px-6">Days left</th>
                      <th className="px-4 py-4 font-medium sm:px-6">INV Amount</th>
                      <th className="px-4 py-4 font-medium sm:px-6">Actions</th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-slate-200/70 text-sm dark:divide-white/10">
                    {filteredShipments.map((shipment) => (
                      <tr key={shipment.id} className="align-middle">
                        <td className="whitespace-nowrap px-4 py-4 font-medium text-slate-950 dark:text-white sm:px-6">
                          {shipment.invoiceNo}
                        </td>
                        <td className="whitespace-nowrap px-4 py-4 text-slate-600 dark:text-slate-300 sm:px-6">
                          {shipment.blNo}
                        </td>
                        <td className="whitespace-nowrap px-4 py-4 sm:px-6">
                          <span
                            className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${getCarrierBadgeClass(shipment.carrier)}`}
                          >
                            {shipment.carrier}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-4 text-slate-600 dark:text-slate-300 sm:px-6">
                          {formatEta(shipment.eta)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-4 sm:px-6">
                          <span
                            className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${getDaysLeftClasses(shipment.daysLeft)}`}
                          >
                            {formatDaysLeft(shipment.daysLeft)}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-4 text-slate-600 dark:text-slate-300 sm:px-6">
                          {formatAmount(shipment.invAmount)}
                        </td>
                        <td className="px-4 py-4 sm:px-6">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              to={`/shipments/${shipment.id}`}
                              className="inline-flex items-center rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/5"
                            >
                              View
                            </Link>
                            <Link
                              to={`/edit/${shipment.id}`}
                              className="inline-flex items-center rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/5"
                            >
                              Edit
                            </Link>
                            <button
                              type="button"
                              onClick={() => handleDelete(shipment.id)}
                              disabled={deletingId === shipment.id}
                              className="inline-flex items-center rounded-xl border border-rose-200 px-3 py-2 text-xs font-medium text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-70 dark:border-rose-500/30 dark:text-rose-200 dark:hover:bg-rose-500/10"
                            >
                              {deletingId === shipment.id ? 'Deleting...' : 'Delete'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  )
}

export default Dashboard

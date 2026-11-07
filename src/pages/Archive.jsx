import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { collection, deleteDoc, doc, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '../../firebase'
import useAuth from '../hooks/useAuth'
import { getCarrierBadgeClass, getCarrierLabel } from '../lib/carriers'
import { describeArchiveReason, setShipmentArchived } from '../lib/tracking'

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
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

function formatDate(value) {
  const date = normalizeDate(value)
  return date ? dateFormatter.format(date) : '—'
}

function mapArchivedShipment(documentSnapshot) {
  const data = documentSnapshot.data()

  return {
    id: documentSnapshot.id,
    invoiceNo: data.invoiceNo ?? data.invoiceNumber ?? '—',
    blNo: data.blNo ?? data.blNumber ?? '—',
    carrier: String(data.carrier ?? 'Unknown').trim() || 'Unknown',
    eta: data.currentEta ?? data.eta,
    latestEvent: data.latestEvent ?? null,
    archivedAt: normalizeDate(data.archivedAt),
    archiveReason: data.archiveReason ?? '',
  }
}

function Archive() {
  const { currentUser } = useAuth()
  const [shipments, setShipments] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!currentUser?.uid) {
      setShipments([])
      setIsLoading(false)
      return undefined
    }

    setIsLoading(true)

    // Sorted client-side to avoid needing a composite index.
    const archiveQuery = query(
      collection(db, 'archived_shipments'),
      where('uid', '==', currentUser.uid),
    )

    return onSnapshot(
      archiveQuery,
      (snapshot) => {
        setShipments(
          snapshot.docs
            .map(mapArchivedShipment)
            .sort(
              (left, right) =>
                (right.archivedAt?.getTime() ?? 0) - (left.archivedAt?.getTime() ?? 0),
            ),
        )
        setIsLoading(false)
      },
      (snapshotError) => {
        console.error('Failed to load archived shipments.', snapshotError)
        setError('Unable to load the archive right now.')
        setIsLoading(false)
      },
    )
  }, [currentUser?.uid])

  const handleRestore = async (shipmentId) => {
    setError('')
    setBusyId(shipmentId)

    try {
      await setShipmentArchived(shipmentId, false)
    } catch (restoreError) {
      console.error('Failed to restore shipment.', restoreError)
      setError('Shipment could not be restored. Please try again.')
    } finally {
      setBusyId('')
    }
  }

  const handleDelete = async (shipmentId) => {
    const confirmed = window.confirm(
      'Permanently delete this archived shipment? This action cannot be undone.',
    )

    if (!confirmed) {
      return
    }

    setError('')
    setBusyId(shipmentId)

    try {
      await deleteDoc(doc(db, 'archived_shipments', shipmentId))
    } catch (deleteError) {
      console.error('Failed to delete archived shipment.', deleteError)
      setError('Shipment could not be deleted. Please try again.')
    } finally {
      setBusyId('')
    }
  }

  return (
    <main className="app-shell mx-auto min-h-screen w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium tracking-[0.24em] text-sky-600 uppercase dark:text-sky-200">
              ShipTrack
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950 dark:text-white">
              Archive
            </h1>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              Completed imports move here automatically once the empty container is
              returned. You can also archive shipments yourself.
            </p>
          </div>
          <Link
            to="/dashboard"
            className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-100 dark:hover:bg-white/10"
          >
            Back to dashboard
          </Link>
        </div>

        {error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100">
            {error}
          </div>
        ) : null}

        <section className="overflow-hidden rounded-3xl border border-slate-200/70 bg-white/90 dark:border-white/10 dark:bg-slate-950/80">
          {isLoading ? (
            <div className="px-6 py-12 text-center text-sm text-slate-500 dark:text-slate-300">
              Loading archive...
            </div>
          ) : shipments.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-slate-500 dark:text-slate-300">
              No archived shipments yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left">
                <thead className="bg-slate-50 text-xs tracking-[0.2em] text-slate-500 uppercase dark:bg-white/5 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-4 font-medium sm:px-6">Invoice No</th>
                    <th className="px-4 py-4 font-medium sm:px-6">B/L No</th>
                    <th className="px-4 py-4 font-medium sm:px-6">Carrier</th>
                    <th className="px-4 py-4 font-medium sm:px-6">Final event</th>
                    <th className="px-4 py-4 font-medium sm:px-6">Archived</th>
                    <th className="px-4 py-4 font-medium sm:px-6">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/70 text-sm dark:divide-white/10">
                  {shipments.map((shipment) => (
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
                          {getCarrierLabel(shipment.carrier)}
                        </span>
                      </td>
                      <td className="min-w-[200px] px-4 py-4 sm:px-6">
                        {shipment.latestEvent ? (
                          <>
                            <p className="font-medium text-slate-900 dark:text-white">
                              {shipment.latestEvent.title}
                            </p>
                            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                              {[shipment.latestEvent.location, formatDate(shipment.latestEvent.occurredAt)]
                                .filter(Boolean)
                                .join(' · ')}
                            </p>
                          </>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 sm:px-6">
                        <p className="text-slate-700 dark:text-slate-200">
                          {formatDate(shipment.archivedAt)}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                          {describeArchiveReason(shipment.archiveReason)}
                        </p>
                      </td>
                      <td className="px-4 py-4 sm:px-6">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            to={`/shipments/${shipment.id}`}
                            className="inline-flex items-center rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/5"
                          >
                            View
                          </Link>
                          <button
                            type="button"
                            onClick={() => handleRestore(shipment.id)}
                            disabled={busyId === shipment.id}
                            className="inline-flex items-center rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-70 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/5"
                          >
                            {busyId === shipment.id ? 'Working...' : 'Restore'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(shipment.id)}
                            disabled={busyId === shipment.id}
                            className="inline-flex items-center rounded-xl border border-rose-200 px-3 py-2 text-xs font-medium text-rose-700 transition hover:bg-rose-50 disabled:opacity-70 dark:border-rose-500/30 dark:text-rose-200 dark:hover:bg-rose-500/10"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  )
}

export default Archive

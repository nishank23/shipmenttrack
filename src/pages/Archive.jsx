import { useDeferredValue, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { collection, deleteDoc, doc, onSnapshot, query, where } from 'firebase/firestore'
import { AnimatePresence, motion as Motion, useIsPresent, useReducedMotion } from 'motion/react'
import { db } from '../../firebase'
import containerArt from '../assets/archive-container.webp'
import useAuth from '../hooks/useAuth'
import { getCarrierBadgeClass, getCarrierLabel } from '../lib/carriers'
import { filterArchive, getArchiveDeliveryDate } from '../lib/shipmentArchive'
import { toTrackingDate } from '../lib/shipmentDetail'
import { describeArchiveReason, setShipmentArchived } from '../lib/tracking'
import './Archive.css'

const dateFormat = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' })
const dateFields = [['archivedAt', 'Archived'], ['deliveredAt', 'Delivered']]
const ranges = [['all', 'Any date'], ['30', '30 days'], ['90', '90 days'], ['year', 'This year']]

function mapShipment(snapshot) {
  const data = snapshot.data()
  return {
    id: snapshot.id,
    invoiceNo: String(data.invoiceNo ?? data.invoiceNumber ?? data.invoice ?? '').trim(),
    blNo: String(data.blNo ?? data.blNumber ?? data.billOfLadingNo ?? '').trim(),
    consignee: String(data.consigneeName ?? '').trim(),
    carrier: String(data.carrier ?? '').trim().toUpperCase() || 'Unknown',
    archivedAt: toTrackingDate(data.archivedAt),
    deliveredAt: getArchiveDeliveryDate(data, Date.now()),
    archiveReason: data.archiveReason,
  }
}

function ArchiveDate({ value }) {
  return value ? <time dateTime={value.toISOString()}>{dateFormat.format(value)}</time> : 'Not reported'
}

function Pills({ label, options, selected, onSelect }) {
  return (
    <div className="ar-filter">
      <span>{label}</span>
      <div className="ar-pills" role="group" aria-label={label}>
        {options.map(([value, name]) => (
          <button type="button" key={value} aria-pressed={value === selected} onClick={() => onSelect(value)}>{name}</button>
        ))}
      </div>
    </div>
  )
}

function RowActions({ id, title, busy, onAction }) {
  const [mode, setMode] = useState(null)
  const [above, setAbove] = useState(false)
  const open = mode !== null
  const root = useRef(null)
  const trigger = useRef(null)
  const menu = useRef(null)

  function positionMenu() {
    if (!root.current || !menu.current) return
    const { top, bottom } = root.current.getBoundingClientRect()
    const height = menu.current.offsetHeight
    setAbove(window.innerHeight - bottom < height + 8 && top >= height + 8)
  }

  useEffect(() => {
    if (!open) return
    const outside = (event) => {
      if (!root.current?.contains(event.target)) setMode(null)
    }
    const escape = (event) => {
      if (event.key !== 'Escape') return
      if (menu.current?.contains(document.activeElement)) trigger.current?.focus()
      setMode(null)
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  return (
    <div role="cell" className="ar-actions" data-open={open} data-above={above} ref={root}
      onPointerEnter={(event) => {
        if (event.pointerType !== 'mouse' || !window.matchMedia('(hover: hover)').matches) return
        if (document.activeElement?.closest('.ar-actions[data-open="true"]') && !root.current?.contains(document.activeElement)) return
        positionMenu()
        setMode((current) => current ?? 'hover')
      }}
      onPointerLeave={() => setMode((current) => current === 'hover' && !root.current?.contains(document.activeElement) ? null : current)}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setMode(null) }}>
      <button type="button" className="ar-actions__toggle" aria-expanded={open} aria-controls={`archive-actions-${id}`}
        aria-label={`Actions for ${title}`} ref={trigger} onClick={() => {
          positionMenu()
          setMode((current) => current === 'pinned' ? null : 'pinned')
        }}>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="10" r="1.4" /><circle cx="10" cy="10" r="1.4" /><circle cx="15" cy="10" r="1.4" />
        </svg>
      </button>
      <div className="ar-actions__menu" id={`archive-actions-${id}`} ref={menu} inert={!open}>
        <button type="button" aria-disabled={busy} onClick={() => onAction('restore')}>Restore to active</button>
        <button type="button" aria-disabled={busy} className="ar-actions__delete" onClick={() => onAction('delete')}>Delete permanently</button>
      </div>
    </div>
  )
}

function ArchiveRow({ shipment, busy, onAction }) {
  const present = useIsPresent()
  const title = shipment.invoiceNo || shipment.blNo || 'Shipment record'
  const collapse = { height: 0, opacity: 0, overflow: 'hidden', transition: { duration: 0.23, ease: 'easeInOut' } }
  return (
    <Motion.div role="row" className="ar-row-shell" data-archive-row={shipment.id} inert={!present}
      initial={false} animate="visible" exit="removed" variants={{
        visible: { height: 'auto', opacity: 1 },
        removed: ({ removed, reduced }) => !reduced && removed === shipment.id ? collapse : { transition: { duration: 0 } },
      }}>
      <div className="ar-row">
        <div className="ar-row__name" role="cell">
          <Link to={`/shipments/${shipment.id}`} state={{ fromArchive: true }}>{title}</Link>
          {shipment.consignee && <p>{shipment.consignee}</p>}
        </div>
        <div className="ar-row__tracking" role="cell">
          <span className="ar-mobile-label">B/L number</span>
          {shipment.blNo ? <code>{shipment.blNo}</code> : <span>Not recorded</span>}
        </div>
        <div className="ar-row__carrier" role="cell">
          <span className={`ar-carrier ${getCarrierBadgeClass(shipment.carrier)}`}>{getCarrierLabel(shipment.carrier)}</span>
        </div>
        <div className="ar-row__delivered" role="cell">
          <span className="ar-mobile-label">Delivered</span>
          <ArchiveDate value={shipment.deliveredAt} />
        </div>
        <div className="ar-row__archived" role="cell">
          <span className="ar-mobile-label">Archived</span>
          <ArchiveDate value={shipment.archivedAt} />
          <p>{describeArchiveReason(shipment.archiveReason)}</p>
        </div>
        <RowActions id={shipment.id} title={title} busy={busy} onAction={(kind) => onAction(shipment, kind)} />
      </div>
    </Motion.div>
  )
}

function ArchiveVault({ uid }) {
  const [shipments, setShipments] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [feedback, setFeedback] = useState(null)
  const [busy, setBusy] = useState(null)
  const [removed, setRemoved] = useState(null)
  const [search, setSearch] = useState('')
  const [carrier, setCarrier] = useState('all')
  const [range, setRange] = useState('all')
  const [dateField, setDateField] = useState('archivedAt')
  const [now, setNow] = useState(Date.now)
  const searchRef = useRef(null)
  const actionLock = useRef(false)
  const reduced = useReducedMotion()
  const searchTerm = useDeferredValue(search)

  useEffect(() => {
    if (!uid) return
    const archive = query(collection(db, 'archived_shipments'), where('uid', '==', uid))
    return onSnapshot(archive, (snapshot) => {
      setShipments(snapshot.docs.map(mapShipment))
      setNow(Date.now())
      setLoading(false)
      setLoadError('')
    }, (error) => {
      console.error('Failed to load archived shipments.', error)
      setLoadError('The archive could not be loaded. Refresh the page to try again.')
      setLoading(false)
    })
  }, [uid])

  const allRows = busy && !shipments.some(({ id }) => id === busy.id) ? [...shipments, busy] : shipments
  const carrierCodes = [...new Set(allRows.map((shipment) => shipment.carrier))]
  const carrierOptions = [['all', 'All carriers'], ...[...new Set([...carrierCodes, carrier])].filter((code) => code !== 'all')
    .sort((left, right) => getCarrierLabel(left).localeCompare(getCarrierLabel(right)))
    .map((code) => [code, getCarrierLabel(code)])]
  const rows = filterArchive(allRows, { search: searchTerm, carrier, range, dateField }, now)
  const filtered = Boolean(search.trim() || carrier !== 'all' || range !== 'all' || dateField !== 'archivedAt')

  function clearFilters() {
    setSearch('')
    setCarrier('all')
    setRange('all')
    setDateField('archivedAt')
    searchRef.current?.focus()
  }

  async function changeShipment(shipment, kind) {
    if (actionLock.current) return
    if (kind === 'delete' && !window.confirm(`Permanently delete ${shipment.invoiceNo || shipment.blNo || 'this shipment'}? This cannot be undone.`)) return
    actionLock.current = true
    setFeedback(null)
    setBusy(shipment)
    try {
      if (kind === 'restore') await setShipmentArchived(shipment.id, false)
      else await deleteDoc(doc(db, 'archived_shipments', shipment.id))
      if (document.activeElement?.closest('[data-archive-row]')?.dataset.archiveRow === shipment.id) {
        searchRef.current?.focus({ preventScroll: true })
      }
      const rowVisible = Array.from(searchRef.current?.closest('.ar')?.querySelectorAll('[data-archive-row]:not([inert])') ?? [])
        .some((row) => row.dataset.archiveRow === shipment.id)
      setRemoved(rowVisible ? shipment.id : null)
      setShipments((previous) => previous.filter(({ id }) => id !== shipment.id))
      setFeedback({ text: kind === 'restore' ? 'Shipment restored to active.' : 'Shipment permanently deleted.' })
    } catch (error) {
      console.error('Archive action failed.', error)
      setFeedback({ error: true, text: kind === 'restore' ? 'The shipment could not be restored.' : 'The shipment could not be deleted.' })
    } finally {
      actionLock.current = false
      setBusy(null)
    }
  }

  return (
    <main className="ar">
      <header className="ar-heading">
        <div><h1>Archive</h1><p>Find completed imports and shipments you archived manually.</p></div>
        <Link to="/dashboard" className="st-secondary ar-back">Active shipments</Link>
      </header>
      <section className="ar-panel" aria-labelledby="archive-records">
        <div className="ar-toolbar">
          <div className="ar-toolbar__top">
            <h2 id="archive-records">Archived shipments</h2>
            <span className="ar-count" role="status">{loading ? 'Loading' : loadError ? 'Unavailable' : `${rows.length} of ${allRows.length} archived`}</span>
          </div>
          <label className="ar-search">
            <span className="sr-only">Search archive</span>
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <circle cx="8.5" cy="8.5" r="5" /><path d="m12.2 12.2 4.3 4.3" strokeLinecap="round" />
            </svg>
            <input ref={searchRef} className="st-field" type="search" value={search} onChange={(event) => setSearch(event.target.value)}
              placeholder="Invoice, B/L or consignee" />
          </label>
          <div className="ar-filters">
            <Pills label="Date field" options={dateFields} selected={dateField} onSelect={setDateField} />
            <Pills label="Date range" options={ranges} selected={range} onSelect={(value) => { setRange(value); setNow(Date.now()) }} />
            <Pills label="Carrier" options={carrierOptions} selected={carrier} onSelect={setCarrier} />
            {filtered && <button type="button" className="ar-clear" onClick={clearFilters}>Clear filters</button>}
          </div>
          {(loadError || feedback) && <p className="ar-feedback" data-error={Boolean(loadError || feedback?.error)}
            role={loadError || feedback?.error ? 'alert' : 'status'}>{loadError || feedback.text}</p>}
        </div>
        <div role="table" aria-label="Archived shipments" aria-busy={loading}>
          <div role="row" className="ar-row ar-columns">
            <span role="columnheader">Shipment</span>
            <span role="columnheader">B/L number</span>
            <span role="columnheader">Carrier</span>
            {['deliveredAt', 'archivedAt'].map((field) => (
              <span role="columnheader" aria-sort={dateField === field ? 'descending' : undefined} key={field}>
                {field === 'deliveredAt' ? 'Delivered' : 'Archived'}
              </span>
            ))}
            <span role="columnheader" className="sr-only">Actions</span>
          </div>
          <div role="rowgroup">
            <AnimatePresence initial={false} custom={{ removed, reduced }} onExitComplete={() => setRemoved(null)}>
              {rows.map((shipment) => <ArchiveRow key={shipment.id} shipment={shipment} busy={Boolean(busy)} onAction={changeShipment} />)}
            </AnimatePresence>
          </div>
        </div>
        {loading ? <p className="ar-state" role="status">Loading archived shipments...</p>
          : !loadError && !rows.length && !removed && (allRows.length ? (
            <div className="ar-state"><h3>No matching shipments</h3><p>Try another search or clear the filters.</p></div>
          ) : (
            <div className="ar-state ar-state--empty">
              <img className="ar-illustration" src={containerArt} width="384" height="256" decoding="async" alt="" />
              <div><h3>No archived shipments yet</h3><p>Archived shipments will appear here. You can restore them to active tracking at any time.</p>
                <Link to="/dashboard" className="st-secondary ar-back">View active shipments</Link></div>
            </div>
          ))}
      </section>
    </main>
  )
}

export default function Archive() {
  const { currentUser } = useAuth()
  return <ArchiveVault key={currentUser?.uid} uid={currentUser?.uid} />
}

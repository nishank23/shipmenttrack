import { Fragment, useDeferredValue, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { collection, deleteDoc, doc, onSnapshot, query, where } from 'firebase/firestore'
import { Icon } from '@iconify/react'
import { db } from '../../firebase'
import useAuth from '../hooks/useAuth'
import { getCarrierLabel } from '../lib/carriers'
import { getManifestSelection, getNextShipment, getShipmentEta, selectShipments } from '../lib/shipmentDashboard'
import { toTrackingDate } from '../lib/shipmentDetail'
import { normalizeTrackingNumber } from '../lib/shipmentForm'
import { setShipmentArchived } from '../lib/tracking'
import EtaLane from '../components/EtaLane'
import { gsap, prefersReducedMotion } from '../lib/scrollMotion'
import './Dashboard.css'

const etaOptions = [
  ['all', 'Any ETA'], ['arrived', 'Arrived'], ['overdue', 'Past ETA'], ['week', 'Within 7 days'],
  ['fortnight', 'In 8-14 days'], ['later', 'In 15+ days'], ['missing', 'No ETA'],
]
const sortOptions = [['earliest', 'Soonest ETA'], ['latest', 'Latest ETA'], ['invoice', 'Invoice A-Z']]
const dateFormat = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' })
const eventFormat = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' })
const amountFormat = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

const shipmentTitle = ({ invoiceNo, blNo }) => invoiceNo || blNo || 'Shipment record'

function mapShipment(snapshot) {
  const data = snapshot.data()
  const event = data.latestEvent
  return {
    id: snapshot.id,
    invoiceNo: String(data.invoiceNo ?? data.invoiceNumber ?? data.invoice ?? data.invoice_number ?? '').trim(),
    blNo: String(data.blNo ?? data.blNumber ?? data.billOfLadingNo ?? data.bill_of_lading_no ?? '').trim(),
    carrier: String(data.carrier ?? '').trim().toUpperCase() || 'Unknown',
    consigneeName: String(data.consigneeName ?? '').trim(),
    invAmount: data.invAmount ?? data.invoiceAmount ?? data.amount,
    eta: toTrackingDate(data.currentEta) ?? toTrackingDate(data.eta),
    latestEvent: event?.title && !event.estimated ? { ...event, occurredAt: toTrackingDate(event.occurredAt) } : null,
    trackingStatus: data.trackingStatus,
  }
}

function formatAmount(value) {
  if (value === undefined || value === null || value === '') return 'Not recorded'
  const amount = Number(String(value).replaceAll(',', ''))
  return Number.isFinite(amount) ? amountFormat.format(amount) : 'Not recorded'
}

function formatEtaOffset(days) {
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  const count = Math.abs(days)
  const duration = `${count} ${count === 1 ? 'day' : 'days'}`
  return days < 0 ? `${duration} past ETA` : `In ${duration}`
}

function QuickEntry() {
  const navigate = useNavigate()
  const [reference, setReference] = useState('')
  function openForm(event) {
    event.preventDefault()
    const bl = normalizeTrackingNumber(reference)
    navigate(bl ? `/add?bl=${encodeURIComponent(bl)}` : '/add')
  }

  return (
    <form className="dash-quick" onSubmit={openForm}>
      <label className="sr-only" htmlFor="quick-bl">Bill of lading number</label>
      <input id="quick-bl" className="st-field" placeholder="Bill of lading number" value={reference}
        onChange={(event) => setReference(event.target.value)} maxLength={40} autoComplete="off" spellCheck={false} />
      <button type="submit" className="st-secondary">Track B/L</button>
    </form>
  )
}

function FilterSelect({ label, options, value, onChange }) {
  return (
    <select className="st-field" aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map(([key, name]) => <option value={key} key={key}>{name}</option>)}
    </select>
  )
}

function ManifestRow({ shipment, expanded, onToggle }) {
  const title = shipmentTitle(shipment)
  const carrier = getCarrierLabel(shipment.carrier)
  const event = shipment.latestEvent?.title || (shipment.trackingStatus === 'error' ? 'Carrier update unavailable' : 'No carrier event')
  return (
    <tr className="dash-row" id={`shipment-row-${shipment.id}`} data-expanded={expanded}>
      <th scope="row">
        <span className="dash-row__title" title={title}>{title}</span>
        <span className="dash-row__meta" title={shipment.consigneeName}>{shipment.consigneeName || 'Consignee not recorded'}</span>
        <span className="dash-row__mobile-bl" title={shipment.blNo}>{shipment.blNo || 'No B/L'}</span>
        <span className="dash-row__mobile-event" title={event}>{carrier} · {event}</span>
      </th>
      <td className="dash-col-bl"><span title={shipment.blNo}>{shipment.blNo || 'No B/L'}</span></td>
      <td className="dash-col-carrier">{carrier}</td>
      <td className="dash-col-event"><span title={event}>{event}</span></td>
      <td className="dash-col-eta">
        {shipment.bucket === 'arrived' ? (
          <>
            <span className="dash-row__arrived">Arrived</span>
            {shipment.arrivedAt && <time className="dash-row__meta" dateTime={shipment.arrivedAt.toISOString()}>{dateFormat.format(shipment.arrivedAt)}</time>}
          </>
        ) : shipment.eta ? (
          <>
            <time dateTime={shipment.eta.toISOString()}>{dateFormat.format(shipment.eta)}</time>
            <span className="dash-row__meta">{formatEtaOffset(shipment.daysLeft)}</span>
          </>
        ) : <span className="dash-row__meta">No ETA</span>}
      </td>
      <td className="dash-col-open">
        <button type="button" className="dash-row__toggle" aria-label={`Inspect ${title}`} aria-expanded={expanded}
          aria-controls={expanded ? `shipment-preview-${shipment.id}` : undefined} onClick={() => onToggle(shipment.id)}>
          <Icon icon="solar:alt-arrow-down-linear" width="16" height="16" aria-hidden="true" />
        </button>
      </td>
    </tr>
  )
}

function CopyReference({ number }) {
  const [message, setMessage] = useState('')
  const timer = useRef(null)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  async function copy() {
    window.clearTimeout(timer.current)
    try {
      await navigator.clipboard.writeText(number)
      setMessage('B/L number copied.')
    } catch {
      setMessage('Copy unavailable. You can select the B/L number to copy it.')
    }
    timer.current = window.setTimeout(() => setMessage(''), 2400)
  }

  return (
    <>
      <div className="dash-details__reference">
        <span>{number || 'Not recorded'}</span>
        {number && <button type="button" className="dash-copy" onClick={copy} aria-label={`Copy B/L ${number}`} title="Copy B/L number">
          <Icon icon={message === 'B/L number copied.' ? 'solar:check-circle-linear' : 'solar:copy-linear'} width="17" height="17" aria-hidden="true" />
          <span>{message === 'B/L number copied.' ? 'Copied' : 'Copy'}</span>
        </button>}
      </div>
      <span role="status" className={message.startsWith('Copy unavailable') ? 'dash-help' : 'sr-only'}>{message}</span>
    </>
  )
}

function ShipmentPreview({ shipment, busy, onArchive, onDelete }) {
  const { id, blNo, latestEvent } = shipment
  const panelRef = useRef(null)

  // Opening: the panel eases to its height, then its parts rise in turn.
  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!panel || prefersReducedMotion()) return undefined
    const ctx = gsap.context(() => {
      gsap.timeline({ defaults: { ease: 'expo.out' } })
        .fromTo(panel, { height: 0 }, { height: 'auto', duration: 0.55, clearProps: 'height' })
        .from('[data-reveal]', { y: 10, opacity: 0, duration: 0.5, stagger: 0.05 }, 0.08)
    }, panel)
    return () => ctx.revert()
  }, [])

  const status = shipment.bucket === 'arrived'
    ? `Arrived${shipment.arrivedAt ? ` ${dateFormat.format(shipment.arrivedAt)}` : ''}`
    : shipment.eta ? `${dateFormat.format(shipment.eta)} · ${formatEtaOffset(shipment.daysLeft)}` : 'No ETA from the carrier yet'

  return (
    <section ref={panelRef} className="dash-details" id={`shipment-preview-${id}`} aria-label={`Details for ${shipmentTitle(shipment)}`}>
      <div className="dash-details__inner">
        <dl className="dash-details__facts">
          <div className="dash-details__event" data-reveal>
            <dt>Latest carrier event</dt>
            <dd className="dash-details__event-title">{latestEvent?.title || 'No carrier event yet'}</dd>
            {latestEvent && (
              <dd className="dash-help">
                {[latestEvent.location, latestEvent.occurredAt ? eventFormat.format(latestEvent.occurredAt) : ''].filter(Boolean).join(' · ')}
              </dd>
            )}
          </div>
          <div data-reveal><dt>{shipment.bucket === 'arrived' ? 'Status' : 'ETA'}</dt><dd>{status}</dd></div>
          <div data-reveal><dt>Bill of lading</dt><dd><CopyReference number={blNo} /></dd></div>
          <div data-reveal><dt>Consignee</dt><dd>{shipment.consigneeName || 'Not recorded'}</dd></div>
          <div data-reveal><dt>Invoice amount</dt><dd>{formatAmount(shipment.invAmount)}</dd></div>
        </dl>
        <div className="dash-details__actions" role="group" aria-label="Shipment actions" data-reveal>
          <Link className="dash-details__open" to={`/shipments/${id}`}>
            Open shipment <Icon icon="solar:arrow-right-up-linear" width="16" height="16" aria-hidden="true" />
          </Link>
          <div className="dash-details__tools">
            <Link className="st-secondary" to={`/edit/${id}`}><Icon icon="solar:pen-2-linear" width="16" height="16" aria-hidden="true" /> Edit</Link>
            <button type="button" className="st-secondary" disabled={busy} onClick={() => onArchive(shipment)}>
              <Icon icon="solar:archive-linear" width="16" height="16" aria-hidden="true" /> Archive
            </button>
            <button type="button" className="st-secondary dash-details__delete" disabled={busy} onClick={() => onDelete(shipment)}>
              <Icon icon="solar:trash-bin-minimalistic-linear" width="16" height="16" aria-hidden="true" /> Delete
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}

function Dashboard() {
  const { currentUser } = useAuth()
  const [params, setParams] = useSearchParams()
  const requestedId = params.get('shipment')
  const [current, setCurrent] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [now, setNow] = useState(() => new Date())
  const [feedback, setFeedback] = useState(null)
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [carrier, setCarrier] = useState('all')
  const [etaWindow, setEtaWindow] = useState('all')
  const [sort, setSort] = useState('earliest')
  const searchTerm = useDeferredValue(search)
  const searchRef = useRef(null)
  const actionLock = useRef(false)

  useEffect(() => {
    const tick = () => { if (!document.hidden) setNow(new Date()) }
    const interval = window.setInterval(tick, 60_000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [])

  useEffect(() => {
    if (!currentUser?.uid) return
    const owner = where('uid', '==', currentUser.uid)
    return onSnapshot(query(collection(db, 'shipments'), owner), (snapshot) => {
      setCurrent(snapshot.docs.map(mapShipment))
      setNow(new Date())
      setLoading(false)
      setLoadError(false)
    }, (error) => {
      console.error('Failed to load shipments.', error)
      setLoadError(true)
      setLoading(false)
    })
  }, [currentUser?.uid, loadAttempt])

  const shipments = current.map((shipment) => ({ ...shipment, ...getShipmentEta(shipment.eta, now, shipment.latestEvent) }))
  const visible = loadError ? [] : selectShipments(shipments, { search: searchTerm, carrier, window: etaWindow, sort })
  const expandedId = getManifestSelection(visible, requestedId)?.id
  const upcoming = !loadError && getNextShipment(shipments)
  const filtered = Boolean(search.trim() || carrier !== 'all' || etaWindow !== 'all')
  const carrierCodes = new Set(shipments.map((item) => item.carrier))
  if (carrier !== 'all') carrierCodes.add(carrier)
  const carrierOptions = [['all', 'All carriers'], ...[...carrierCodes].map((code) => [code, getCarrierLabel(code)]).sort((a, b) => a[1].localeCompare(b[1]))]

  function toggleShipment(id) {
    const next = new URLSearchParams(params)
    const closing = id === requestedId
    if (closing) next.delete('shipment')
    else next.set('shipment', id)
    const commit = () => setParams(next, { preventScrollReset: true })

    // Closing eases the open panel shut before the row is removed.
    const panel = document.getElementById(`shipment-preview-${expandedId}`)
    if (!panel || prefersReducedMotion() || (!closing && !expandedId)) {
      commit()
      return
    }
    gsap.to(panel, { height: 0, opacity: 0, duration: 0.3, ease: 'power2.in', onComplete: commit })
  }

  // From the lane: open that shipment's row and bring it into view.
  function focusShipment(id) {
    const next = new URLSearchParams(params)
    next.set('shipment', id)
    setParams(next, { preventScrollReset: true })
    window.requestAnimationFrame(() => {
      document.getElementById(`shipment-row-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }

  function resetFilters() {
    setSearch('')
    setCarrier('all')
    setEtaWindow('all')
    searchRef.current?.focus()
  }

  function retryLoad() {
    setLoadError(false)
    setLoading(true)
    setLoadAttempt((value) => value + 1)
  }

  async function changeShipment(shipment, kind) {
    if (actionLock.current) return
    const archive = kind === 'archive'
    const name = shipmentTitle(shipment)
    if (!window.confirm(archive ? `Move ${name} to the archive? You can restore it later.` : `Delete ${name}? This cannot be undone.`)) return
    actionLock.current = true
    setBusy(true)
    setFeedback(null)
    try {
      if (archive) await setShipmentArchived(shipment.id, true)
      else await deleteDoc(doc(db, 'shipments', shipment.id))
      setFeedback({ text: archive ? `${name} moved to Archive.` : `${name} deleted.` })
    } catch (error) {
      console.error('Shipment action failed.', error)
      setFeedback({ error: true, text: `Could not ${kind} ${name}. Try again.` })
    } finally {
      actionLock.current = false
      setBusy(false)
    }
  }

  return (
    <main className="dash">
      <header className="dash-header">
        <div className="dash-title"><h1>Shipments</h1><p>Carrier ETAs and the latest reported events.</p></div>
        {upcoming && (
          <div className="dash-next">
            <p>Next estimated arrival</p>
            <time dateTime={upcoming.eta.toISOString()}>{dateFormat.format(upcoming.eta)}</time>
            <span>{shipmentTitle(upcoming)} · {getCarrierLabel(upcoming.carrier)}</span>
          </div>
        )}
        <QuickEntry />
      </header>
      {!loading && !loadError && (
        <EtaLane
          shipments={shipments.map((item) => ({ ...item, carrierLabel: getCarrierLabel(item.carrier) }))}
          now={now}
          selectedId={expandedId}
          onSelect={focusShipment}
        />
      )}
      {feedback && <p className="dash-feedback" data-error={Boolean(feedback.error)} role={feedback.error ? 'alert' : 'status'}>{feedback.text}</p>}

      <section className="dash-manifest" aria-labelledby="dash-manifest-title">
        <div className="dash-manifest__toolbar">
          <div className="dash-manifest__heading">
            <h2 id="dash-manifest-title">Manifest</h2>
            <span role="status">{loading ? 'Loading...' : loadError ? 'Unavailable' : filtered ? `${visible.length} of ${shipments.length} shipments` : `${shipments.length} ${shipments.length === 1 ? 'shipment' : 'shipments'}`}</span>
          </div>
          <label className="dash-search">
            <span className="sr-only">Search shipments</span>
            <Icon icon="solar:magnifer-linear" width="17" height="17" aria-hidden="true" />
            <input ref={searchRef} className="st-field" type="search" placeholder="Search invoice, B/L or event" value={search}
              onChange={(event) => setSearch(event.target.value)} />
          </label>
          <div className="dash-filters" role="group" aria-label="Shipment filters">
            <FilterSelect label="Carrier" options={carrierOptions} value={carrier} onChange={setCarrier} />
            <FilterSelect label="ETA window" options={etaOptions} value={etaWindow} onChange={setEtaWindow} />
            <FilterSelect label="Sort shipments" options={sortOptions} value={sort} onChange={setSort} />
          </div>
          {filtered && <button type="button" className="dash-clear" onClick={resetFilters}>Clear filters</button>}
        </div>
        <table className="dash-table" aria-labelledby="dash-manifest-title" aria-busy={loading || search !== searchTerm}>
          <thead>
            <tr>
              <th scope="col" className="dash-col-name">Shipment</th>
              <th scope="col" className="dash-col-bl">Bill of lading</th>
              <th scope="col" className="dash-col-carrier">Carrier</th>
              <th scope="col" className="dash-col-event">Latest carrier event</th>
              <th scope="col" className="dash-col-eta">ETA</th>
              <th scope="col" className="dash-col-open"><span className="sr-only">Details</span></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((shipment) => (
              <Fragment key={shipment.id}>
                <ManifestRow shipment={shipment} expanded={shipment.id === expandedId} onToggle={toggleShipment} />
                {shipment.id === expandedId && (
                  <tr className="dash-detail-row">
                    <td colSpan={6}>
                      <ShipmentPreview shipment={shipment} busy={busy}
                        onArchive={(item) => changeShipment(item, 'archive')} onDelete={(item) => changeShipment(item, 'delete')} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {!visible.length && (
              <tr>
                <td colSpan={6} className="dash-list-message">
                  {loading ? 'Loading shipments...'
                    : loadError ? <><p role="alert">Shipments could not be loaded.</p><button type="button" className="st-secondary" onClick={retryLoad}>Try again</button></>
                      : filtered ? <><p>No matching shipments</p><p className="dash-help">Try changing the search or filters.</p></>
                        : <><p>No shipments yet</p><Link className="st-secondary" to="/add">Add your first shipment</Link></>}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  )
}

export default Dashboard

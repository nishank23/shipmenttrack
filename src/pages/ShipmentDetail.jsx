import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { deleteDoc, doc, getDoc } from 'firebase/firestore'
import { Icon } from '@iconify/react'
import { useReducedMotion } from 'motion/react'
import { db } from '../../firebase'
import VoyageGlobe from '../components/VoyageGlobe'
import useAuth from '../hooks/useAuth'
import { getRunwayEta, hasTimedEta } from '../lib/arrivalRunway'
import { getCarrierBadgeClass, getCarrierBrand } from '../lib/carriers'
import { gsap, useSmoothScroll } from '../lib/scrollMotion'
import { getCheckpointHistory, getPlannedCheckpointGroups, getRouteCheckpoints, toTrackingDate } from '../lib/shipmentDetail'
import { describeArchiveReason, setShipmentArchived, subscribeShipmentTracking } from '../lib/tracking'
import { getVoyageRoute } from '../lib/voyageRoute'
import './ShipmentDetail.css'

const dateFormat = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' })
const dateTimeFormat = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' })
const shortDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })
const currencyFormat = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const recentCount = 4
const emptyCache = { data: null, unavailable: false }

function DateLabel({ date, timed = false }) {
  if (!date) return 'Date not reported'
  return <time dateTime={date.toISOString()}>{(timed ? dateTimeFormat : dateFormat).format(date)}</time>
}

function CarrierMark({ code, brand }) {
  const [failed, setFailed] = useState(false)
  return (
    <div className="sd-carrier">
      {brand.logo && !failed ? (
        <img className="sd-carrier__logo" src={brand.logo} alt="" width="88" height="38"
          onError={() => setFailed(true)} />
      ) : <span className={`sd-carrier__badge ${getCarrierBadgeClass(code)}`}>{brand.label}</span>}
      <span>Carrier{brand.logo && !failed ? ` · ${brand.label}` : ''}</span>
    </div>
  )
}

function CopyTrackingId({ number }) {
  const [feedback, setFeedback] = useState('')
  const timer = useRef(null)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  async function copy() {
    try {
      await navigator.clipboard.writeText(number)
      setFeedback('copied')
    } catch {
      setFeedback('failed')
    }
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setFeedback(''), 2400)
  }

  return (
    <>
      <button type="button" className="st-secondary sd-action sd-copy" onClick={copy} aria-label="Copy tracking ID" disabled={!number}>
        {feedback === 'copied'
          ? <span className="sd-copy__check"><Icon icon="solar:check-circle-linear" width="18" height="18" aria-hidden="true" /></span>
          : <Icon icon="solar:copy-linear" width="18" height="18" aria-hidden="true" />}
        {feedback === 'copied' ? 'Copied' : 'Copy ID'}
      </button>
      <span className={feedback === 'failed' ? 'sd-copy-error' : 'sr-only'} role="status">
        {feedback === 'copied' ? 'Tracking ID copied.' : feedback === 'failed' ? 'Copy unavailable. Select the tracking ID to copy it.' : ''}
      </span>
    </>
  )
}

function EtaCountdown({ eta, source, archived }) {
  const [now, setNow] = useState(Date.now)
  const timed = hasTimedEta(eta, source)
  useEffect(() => {
    if (!eta || archived) return
    const tick = () => { if (!document.hidden) setNow(Date.now()) }
    const timer = window.setInterval(tick, 15000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [eta, archived])

  const countdown = getRunwayEta(eta, now, timed)
  const value = archived ? 'Archived' : !eta ? 'No ETA' : countdown.label.replace(/^Due in /, '')
  return (
    <div className="sd-eta" data-overdue={!archived && countdown.overdue}>
      <p>{archived ? 'Last saved ETA' : 'Estimated arrival'}</p>
      <strong className="sd-eta__value">{value}</strong>
      <span>{eta ? <DateLabel date={eta} timed={timed} /> : 'Arrival date not reported'}</span>
    </div>
  )
}

function RouteSummary({ reported }) {
  const { first, last } = getRouteCheckpoints(reported)
  return (
    <section className="sd-panel sd-route" aria-labelledby="sd-route-title">
      <h2 id="sd-route-title">Route summary</h2>
      {last ? (
        <dl className="sd-route__locations">
          {first && (
            <div>
              <dt>First reported location</dt>
              <dd>{first.location}</dd>
              <dd className="sd-meta"><DateLabel date={first.occurredAt} /></dd>
            </div>
          )}
          <div>
            <dt>Last known location</dt>
            <dd>{last.location}</dd>
            <dd className="sd-meta"><DateLabel date={last.occurredAt} /></dd>
          </div>
        </dl>
      ) : <p className="sd-meta sd-empty">No locations reported by the carrier yet.</p>}
      {first?.container && last.container && first.container !== last.container && (
        <p className="sd-meta sd-route__note">Locations may be from different containers on this B/L.</p>
      )}
    </section>
  )
}

function voyageHeadline(route) {
  const here = route.current.port.name
  const destination = route.stops.at(-1).name
  switch (route.status) {
    case 'arrived': return `Arrived at ${here}`
    case 'in-transit': return `Sailing from ${here} to ${route.next.port.name}`
    case 'live': return `At sea, bound for ${route.next.port.name}`
    case 'planned': return `Bound for ${destination}`
    default: return `At ${here}`
  }
}

// "Live AIS position of MSC CAIRO IV, 12.4 kn, 3 h ago."
function aisNote(position) {
  const reportedAt = position?.reportedAt?.toDate?.() ?? null
  const hours = reportedAt ? Math.max(0, Math.round((Date.now() - reportedAt.getTime()) / 3600000)) : null
  const age = hours === null ? '' : hours < 1 ? 'under an hour ago' : hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`
  return [
    `Live AIS position${position?.vesselName ? ` of ${position.vesselName}` : ''}`,
    Number.isFinite(position?.speed) ? `${position.speed} kn` : '',
    age,
  ].filter(Boolean).join(', ') + '.'
}

/**
 * Where the box is on its voyage, on the globe. The route is the ports named
 * in carrier events; the vessel sits at the latest one (or part-way along the
 * leg after a departure) until a live position is available.
 */
function VoyagePanel({ history, eta, position }) {
  const root = useRef(null)
  const reducedMotion = useReducedMotion()
  const [voyage] = useState(() => ({ lane: 0, progress: 0 }))
  const route = getVoyageRoute(history, { eta, now: Date.now(), position })
  const routeKey = route ? `${route.lane.id}|${route.lane.waypoints.at(-1).label}|${route.progress.toFixed(4)}` : ''
  // A new lane rebuilds the globe scene, so it changes only with the route.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const lanes = useMemo(() => (route ? [route.lane] : null), [routeKey])

  useLayoutEffect(() => {
    if (!route) return undefined
    if (reducedMotion) {
      gsap.set(voyage, { progress: route.progress })
      return undefined
    }
    const context = gsap.context(() => {
      gsap.timeline()
        .fromTo(voyage, { progress: 0 }, { progress: route.progress, duration: 2.8, ease: 'power2.inOut' }, 0.35)
        .from('[data-voyage-reveal]', { y: 10, opacity: 0, stagger: 0.06, duration: 0.5, ease: 'power2.out', clearProps: 'transform,opacity' }, 0)
    }, root)
    return () => context.revert()
    // Replays only when the route itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey, reducedMotion])

  if (!route) return <RouteSummary reported={history.reported} />

  const latest = route.latest
  return (
    <section ref={root} className="sd-panel sd-voyage" aria-labelledby="sd-voyage-title">
      <div className="sd-voyage__info">
        <h2 id="sd-voyage-title" data-voyage-reveal>Voyage</h2>
        <p className="sd-voyage__status" data-voyage-reveal>{voyageHeadline(route)}</p>
        {latest && (
          <p className="sd-voyage__event" data-voyage-reveal>
            {latest.title}{latest.occurredAt && <> · <DateLabel date={latest.occurredAt} /></>}
          </p>
        )}
        <ol className="sd-voyage__stops" role="list" aria-label="Ports on this voyage">
          {route.stops.map((stop, index) => (
            <li key={stop.name} data-state={stop.state} data-voyage-reveal>
              <span className="sd-voyage__dot" aria-hidden="true" />
              <strong>{stop.name}</strong>
              <span className="sd-meta">
                {stop.at
                  ? `${stop.state === 'planned' ? (index === route.stops.length - 1 ? 'ETA ' : 'Planned ') : ''}${shortDate.format(stop.at)}`
                  : stop.state === 'planned' ? 'Planned' : ''}
              </span>
            </li>
          ))}
        </ol>
        <p className="sd-meta sd-voyage__note" data-voyage-reveal>
          {route.status === 'live'
            ? aisNote(position)
            : 'Vessel position is estimated from the latest carrier event. Arcs join ports and are not the sailing path.'}
        </p>
      </div>
      <div className="sd-voyage__stage">
        <VoyageGlobe lanes={lanes} voyage={voyage} zoom={route.zoom} className="sd-voyage__globe">
          <div className="sd-voyage__fallback" aria-hidden="true" />
        </VoyageGlobe>
      </div>
    </section>
  )
}

function ShipmentFacts({ shipment, invoice, containerNumbers, busy, onDelete }) {
  const amount = shipment.invAmount === '' || shipment.invAmount == null
    ? NaN : Number(String(shipment.invAmount).replaceAll(',', ''))
  return (
    <section className="sd-panel sd-facts" aria-labelledby="sd-facts-title">
      <h2 id="sd-facts-title">Shipment details</h2>
      <dl className="sd-facts__values">
        <div><dt>Invoice</dt><dd>{invoice || 'Not set'}</dd></div>
        <div><dt>Consignee</dt><dd>{shipment.consigneeName?.trim() || 'Not set'}</dd></div>
        <div><dt>Invoice amount</dt><dd>{Number.isFinite(amount) ? currencyFormat.format(amount) : 'Not set'}</dd></div>
        <div>
          <dt>Containers</dt>
          <dd>{containerNumbers.length ? (
            <ul className="sd-containers" role="list">
              {containerNumbers.map((container) => <li key={container}>{container}</li>)}
            </ul>
          ) : 'Not set'}</dd>
        </div>
        <div><dt>Notes</dt><dd className="sd-notes">{shipment.notes?.trim() || 'No notes added.'}</dd></div>
      </dl>
      <button className="sd-delete" type="button" disabled={busy} onClick={onDelete}>
        <Icon icon="solar:trash-bin-minimalistic-linear" width="16" height="16" aria-hidden="true" />
        Delete shipment
      </button>
    </section>
  )
}

function CheckpointList({ events, latestId, ready }) {
  const root = useRef(null)
  const reducedMotion = useReducedMotion()
  useLayoutEffect(() => {
    if (!ready || reducedMotion) return
    const context = gsap.context(() => {
      gsap.timeline()
        .from('[data-checkpoint-line]', { scaleY: 0, duration: 0.65, ease: 'power2.out' }, 0)
        .from('[data-checkpoint]', { y: 7, opacity: 0.35, stagger: 0.05, duration: 0.26, ease: 'power2.out', clearProps: 'transform,opacity' }, 0.08)
    }, root)
    return () => context.revert()
  }, [ready, reducedMotion])

  return (
    <ol className="sd-timeline" ref={root} role="list" aria-label="Reported checkpoints, newest first">
      <li className="sd-timeline__rail" data-checkpoint-line aria-hidden="true" />
      {events.map((event) => (
        <li key={event.id} className="sd-checkpoint" data-checkpoint data-latest={event.id === latestId}>
          <div className="sd-checkpoint__card">
            <div className="sd-checkpoint__head">
              <h3>{event.title}</h3>
              {event.id === latestId && <span className="sd-latest">Latest reported</span>}
            </div>
            <p className="sd-checkpoint__meta">
              {event.location && <strong>{event.location}</strong>}
              <span><DateLabel date={event.occurredAt} timed /></span>
            </p>
            {event.description && event.description !== event.title && <p className="sd-meta">{event.description}</p>}
            {event.container && <p className="sd-meta sd-checkpoint__container">{event.container}</p>}
          </div>
        </li>
      ))}
    </ol>
  )
}

function TrackingHistory({ history, containers, cache, pending }) {
  const [selection, setSelection] = useState('')
  const [showAll, setShowAll] = useState(false)
  const selected = containers.includes(selection) ? selection : ''
  const reported = history.reported.filter((event) => !selected || event.container === selected)
  const planned = getPlannedCheckpointGroups(history.planned, selected)
  const latest = reported.find((event) => event.occurredAt)
  const checkedAt = toTrackingDate(cache.data?.checkedAt)
  return (
    <section className="sd-panel sd-history" aria-labelledby="sd-history-title">
      <header className="sd-history__head">
        <div>
          <h2 id="sd-history-title">Checkpoint history</h2>
          <p className="sd-meta">
            {checkedAt ? <>Carrier checked <DateLabel date={checkedAt} timed /></>
              : pending ? 'Loading carrier checkpoints…' : 'Carrier check time not reported'}
          </p>
        </div>
        {containers.length > 1 && (
          <select className="st-field sd-history__filter" aria-label="Filter checkpoints by container" value={selected}
            onChange={(event) => { setSelection(event.target.value); setShowAll(false) }}>
            <option value="">All containers</option>
            {containers.map((container) => <option key={container}>{container}</option>)}
          </select>
        )}
      </header>

      {(cache.unavailable || cache.data?.error) && (
        <p className="sd-history__notice" role="status">
          {cache.unavailable ? 'Checkpoint history is unavailable. Any saved checkpoint is shown below.'
            : 'The last carrier check failed. Showing available checkpoints.'}
        </p>
      )}

      {reported.length ? (
        <CheckpointList key={selected} ready={!pending} events={showAll ? reported : reported.slice(0, recentCount)} latestId={latest?.id} />
      ) : <p className="sd-meta sd-empty">{pending ? 'Waiting for carrier history…' : 'No reported checkpoints for this view yet.'}</p>}

      {reported.length > recentCount && (
        <button className="st-secondary sd-action sd-more" type="button" aria-expanded={showAll} onClick={() => setShowAll((value) => !value)}>
          {showAll ? 'Show recent checkpoints' : `Show ${reported.length - recentCount} earlier checkpoints`}
        </button>
      )}
      {planned.length > 0 && (
        <details className="sd-planned">
          <summary>Planned checkpoints <span>{planned.length}</span></summary>
          <ul role="list">
            {planned.map((event) => (
              <li key={event.id}>
                <strong>{event.title}</strong>
                <p className="sd-meta">
                  {event.location && <>{event.location} · </>}
                  <DateLabel date={event.occurredAt} timed />
                </p>
                {event.description && <p className="sd-meta">{event.description}</p>}
                {event.containers.length > 0 && (
                  <p className="sd-meta">
                    {event.containers.length === 1 ? 'Container: ' : 'Containers: '}{event.containers.join(', ')}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}

async function readShipment(id) {
  let active
  try {
    active = await getDoc(doc(db, 'shipments', id))
  } catch (error) {
    // Rules can deny reads of missing active documents after an archive move.
    if (error.code !== 'permission-denied') throw error
  }
  if (active?.exists()) return { ...active.data(), id, isArchived: false }
  const archived = await getDoc(doc(db, 'archived_shipments', id))
  return archived.exists() ? { ...archived.data(), id, isArchived: true } : null
}

function ShipmentDetailPage({ shipmentId, uid }) {
  const navigate = useNavigate()
  const [shipment, setShipment] = useState(null)
  const [loading, setLoading] = useState(true)
  const [cache, setCache] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const trackingId = shipment?.id
  useSmoothScroll()

  useEffect(() => {
    if (!shipmentId || !uid) return
    let ignore = false
    readShipment(shipmentId).then((record) => {
      if (ignore) return
      if (record && record.uid !== uid) {
        navigate('/dashboard', { replace: true })
        return
      }
      setShipment(record)
      setLoading(false)
    }).catch((loadError) => {
      if (ignore) return
      console.error('Failed to load shipment detail.', loadError)
      setError('We could not load this shipment. It may be unavailable or you may not have access.')
      setLoading(false)
    })
    return () => { ignore = true }
  }, [shipmentId, uid, navigate, reloadKey])

  useEffect(() => {
    if (!trackingId) return
    return subscribeShipmentTracking(trackingId, (data) => {
      setCache({ data, unavailable: false })
    }, (cacheError) => {
      console.error('Failed to read shipment checkpoint history.', cacheError)
      setCache((previous) => ({ data: previous?.data ?? null, unavailable: true }))
    })
  }, [trackingId])

  async function handleArchive() {
    const archiving = !shipment.isArchived
    if (archiving && !window.confirm('Move this shipment to the archive? You can restore it later.')) return
    setError('')
    setBusy('archive')
    try {
      await setShipmentArchived(shipment.id, archiving)
      setShipment((current) => ({ ...current, isArchived: archiving, archivedAt: null, archiveReason: archiving ? 'manual' : '' }))
      setReloadKey((value) => value + 1)
    } catch (archiveError) {
      console.error('Failed to update archive state.', archiveError)
      setError(archiving ? 'Shipment could not be archived. Please try again.' : 'Shipment could not be restored. Please try again.')
    } finally {
      setBusy('')
    }
  }

  async function handleDelete() {
    if (!window.confirm('Delete this shipment? This action cannot be undone.')) return
    setError('')
    setBusy('delete')
    try {
      await deleteDoc(doc(db, shipment.isArchived ? 'archived_shipments' : 'shipments', shipment.id))
      navigate(shipment.isArchived ? '/archive' : '/dashboard', { replace: true })
    } catch (deleteError) {
      console.error('Failed to delete shipment.', deleteError)
      setError('Shipment could not be deleted. Please try again.')
      setBusy('')
    }
  }

  if (loading) {
    return <main className="sd"><div className="sd-panel sd-placeholder" role="status">Loading shipment details…</div></main>
  }
  if (!shipment) {
    return (
      <main className="sd">
        <section className="sd-panel sd-placeholder">
          <h1>Shipment unavailable</h1>
          <p>{error || 'We could not find this shipment.'}</p>
          <Link className="st-secondary sd-action" to="/dashboard">Back to dashboard</Link>
        </section>
      </main>
    )
  }

  const invoice = String(shipment.invoiceNo ?? shipment.invoiceNumber ?? '').trim()
  const number = String(shipment.blNo ?? shipment.blNumber ?? '').trim()
  const carrier = shipment.carrier
  const brand = getCarrierBrand(carrier)
  const eta = toTrackingDate(shipment.currentEta ?? shipment.eta)
  const now = new Date().getTime()
  const history = getCheckpointHistory(cache?.data, shipment.latestEvent, now)
  const containerNumbers = [...new Set([shipment.containerNumbers ?? []].flat().map((item) => String(item ?? '').trim().toUpperCase()).filter(Boolean))]
  const containers = [...new Set([...containerNumbers, ...[...history.reported, ...history.planned].map((event) => event.container).filter(Boolean)])]
  const archivedAt = toTrackingDate(shipment.archivedAt)

  return (
    <main className="sd">
      <Link className="sd-back" to={shipment.isArchived ? '/archive' : '/dashboard'}>
        <Icon icon="solar:arrow-left-linear" width="18" height="18" aria-hidden="true" />
        {shipment.isArchived ? 'Archive' : 'Shipments'}
      </Link>
      <header className="sd-hero sd-panel" style={{ '--sd-carrier': brand.accent }}>
        <div className="sd-hero__identity">
          <CarrierMark key={brand.label} code={carrier} brand={brand} />
          <h1>{invoice || number || 'Shipment details'}</h1>
          {number && invoice && <p className="sd-hero__number">B/L <strong>{number}</strong></p>}
          <div className="sd-hero__actions">
            <CopyTrackingId key={number} number={number} />
            {!shipment.isArchived && (
              <Link className="st-secondary sd-action" to={`/edit/${shipment.id}`}>
                <Icon icon="solar:pen-2-linear" width="17" height="17" aria-hidden="true" /> Edit
              </Link>
            )}
            <button className="st-secondary sd-action" type="button" disabled={Boolean(busy)} onClick={handleArchive}>
              <Icon icon="solar:archive-linear" width="17" height="17" aria-hidden="true" />
              {busy === 'archive' ? 'Working…' : shipment.isArchived ? 'Restore' : 'Archive'}
            </button>
          </div>
        </div>
        <EtaCountdown eta={eta} source={shipment.etaSource} archived={shipment.isArchived} />
      </header>

      {shipment.isArchived && (
        <p className="sd-archive-note">{describeArchiveReason(shipment.archiveReason)}{archivedAt && <> · <DateLabel date={archivedAt} /></>}. Restore to edit this shipment.</p>
      )}
      {error && <p className="sd-error" role="alert">{error}</p>}

      <div className="sd-body">
        <VoyagePanel history={history} eta={eta} position={shipment.vesselPosition} />
        <TrackingHistory history={history} containers={containers} cache={cache ?? emptyCache} pending={!cache} />
        <ShipmentFacts shipment={shipment} invoice={invoice} containerNumbers={containers} busy={Boolean(busy)} onDelete={handleDelete} />
      </div>
    </main>
  )
}

function ShipmentDetail() {
  const { shipmentId } = useParams()
  const { currentUser } = useAuth()
  return <ShipmentDetailPage key={`${currentUser?.uid}:${shipmentId}`} uid={currentUser?.uid} shipmentId={shipmentId} />
}

export default ShipmentDetail

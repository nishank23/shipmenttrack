import { useEffect, useId, useRef, useState } from 'react'
import { motion as Motion, useInView, useReducedMotion } from 'motion/react'
import { Link } from 'react-router-dom'
import { getRunwayEta, getRunwayMilestone, isActualRunwayEvent, runwayMilestones } from '../lib/arrivalRunway'
import { getCarrierBadgeClass, getCarrierLabel } from '../lib/carriers'
import { standardSpring } from '../lib/motion'
import './ArrivalLane.css'

const ROW_HEIGHT = 46
const still = { duration: 0 }
const dateFormat = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' })
const timeFormat = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' })

// Inset the rail half a column at both ends so endpoint markers fit on phones.
const railPosition = (progress) => `${12.5 + progress * 0.75}%`

function ShipmentMarker({ item, active, previewId, onPreview, onSelect }) {
  const urgencyLabel = item.milestone?.id === 'out-for-delivery' ? '' : item.priority
  const label = [item.invoiceNo, item.milestone?.label ?? 'Milestone not reported', urgencyLabel]
    .filter(Boolean).join(', ')

  return (
    <button
      type="button"
      className="runway__marker"
      data-runway-marker={item.id}
      data-priority={Boolean(item.priority)}
      aria-label={label}
      aria-expanded={active}
      aria-controls={active ? previewId : undefined}
      onPointerEnter={(event) => {
        if (event.pointerType === 'mouse') onPreview(item.id)
      }}
      onFocus={(event) => {
        if (event.currentTarget.matches(':focus-visible')) onPreview(item.id)
      }}
      onClick={(event) => onSelect(item.id, event.detail === 0)}
    >
      <span className="runway__marker-icon" aria-hidden="true">
        <svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round">
          <rect x="2.5" y="5" width="15" height="10" rx="1.4" />
          <path d="M6.5 8v4m3.5-4v4m3.5-4v4" />
        </svg>
      </span>
      <span className="runway__marker-label">{item.invoiceNo}</span>
    </button>
  )
}

function ShipmentPreview({ item, lastEvent, id, detailsRef, pinned, reducedMotion, onClose }) {
  const arrived = item.milestone?.id === 'arriving'
  return (
    <div
      className="runway__preview-slot"
      data-plotted={Boolean(item.milestone)}
      style={{ '--runway-preview-position': item.milestone ? railPosition(item.milestone.progress) : '50%' }}
    >
      <Motion.div
        id={id}
        role="region"
        aria-label={`Shipment ${item.invoiceNo} preview`}
        className="runway__preview glass-surface"
        initial={reducedMotion ? false : { opacity: 0, y: -5, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={reducedMotion ? still : { ...standardSpring, opacity: { duration: 0.14 } }}
      >
        <div className="runway__preview-head">
          <div>
            <span className={`runway__carrier ${getCarrierBadgeClass(item.carrier)}`}>{getCarrierLabel(item.carrier)}</span>
            <h3>{item.invoiceNo}</h3>
            <p>{item.blNo}</p>
          </div>
          <button type="button" className="runway__close" aria-label="Close shipment preview" onClick={onClose}>
            <svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="m5 5 10 10M15 5 5 15" />
            </svg>
          </button>
        </div>
        <dl className="runway__preview-data">
          <div>
            <dt>Estimated arrival</dt>
            <dd data-overdue={item.etaState.overdue && !arrived}>
              {arrived ? 'Arrival reported' : item.etaState.label}
            </dd>
            {item.eta && (
              <dd className="runway__detail-meta">
                <time dateTime={item.eta.toISOString()}>{(item.etaHasTime ? timeFormat : dateFormat).format(item.eta)}</time>
              </dd>
            )}
          </div>
          <div>
            <dt>Last known location</dt>
            <dd>{lastEvent?.location || 'Not reported'}</dd>
            {lastEvent && <dd className="runway__detail-meta">{lastEvent.title}</dd>}
          </div>
        </dl>
        {pinned && (
          <Link ref={detailsRef} to={`/shipments/${item.id}`} className="runway__details-link">
            View shipment
            <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="M3 10h13m-5-5 5 5-5 5" />
            </svg>
          </Link>
        )}
      </Motion.div>
    </div>
  )
}

function ArrivalLane({ shipments }) {
  const rootRef = useRef(null)
  const detailsRef = useRef(null)
  const skipFocusPreview = useRef(false)
  const focusDetails = useRef(false)
  const headingId = useId()
  const previewId = useId()
  const reducedMotion = useReducedMotion()
  const inView = useInView(rootRef)
  const [now, setNow] = useState(Date.now)
  const [peekId, setPeekId] = useState(null)
  const [pinnedId, setPinnedId] = useState(null)
  const hasEta = shipments.some((shipment) => shipment.eta)

  useEffect(() => {
    if (!hasEta) return undefined
    const refresh = () => {
      if (!document.hidden) setNow(Date.now())
    }
    const timer = window.setInterval(refresh, 15000)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [hasEta])

  const rows = new Map()
  const items = shipments.map((shipment) => {
    const milestone = getRunwayMilestone(shipment.latestEvent, now)
    const etaState = getRunwayEta(shipment.eta, now, shipment.etaHasTime)
    const row = milestone ? rows.get(milestone.id) ?? 0 : 0
    if (milestone) rows.set(milestone.id, row + 1)
    const priority = milestone?.id === 'out-for-delivery'
      ? 'Out for delivery'
      : etaState.dueSoon && milestone?.id !== 'arriving'
        ? (shipment.etaHasTime ? 'Due within 24 hours' : 'Due today')
        : ''
    return { ...shipment, milestone, etaState, row, priority }
  })

  const plotted = items.filter((item) => item.milestone)
  const unplaced = items.filter((item) => !item.milestone)
  const active = items.find(({ id }) => id === pinnedId)
    ?? items.find(({ id }) => id === peekId)
  const activeId = active?.id
  const isPinned = Boolean(active && active.id === pinnedId)
  const lastEvent = isActualRunwayEvent(active?.latestEvent, now) ? active.latestEvent : null
  const priorityCount = items.filter((item) => item.priority).length
  const rowCount = Math.max(0, ...rows.values())

  function dismiss() {
    setPinnedId(null)
    setPeekId(null)
  }

  function restoreMarkerFocus(id) {
    const trigger = [...(rootRef.current?.querySelectorAll('[data-runway-marker]') ?? [])]
      .find((node) => node.dataset.runwayMarker === id)
    skipFocusPreview.current = true
    trigger?.focus({ preventScroll: true })
    skipFocusPreview.current = false
  }

  useEffect(() => {
    if (!activeId) return undefined
    const onOutside = (event) => {
      if (!rootRef.current?.contains(event.target)) dismiss()
    }
    const onEscape = (event) => {
      if (event.key !== 'Escape') return
      if (rootRef.current?.contains(document.activeElement)) restoreMarkerFocus(activeId)
      dismiss()
    }
    document.addEventListener('pointerdown', onOutside)
    document.addEventListener('keydown', onEscape)
    return () => {
      document.removeEventListener('pointerdown', onOutside)
      document.removeEventListener('keydown', onEscape)
    }
  }, [activeId])

  useEffect(() => {
    if (isPinned && focusDetails.current) {
      detailsRef.current?.focus({ preventScroll: true })
      focusDetails.current = false
    }
  }, [isPinned, pinnedId])

  function marker(item) {
    return (
      <ShipmentMarker
        item={item}
        active={active?.id === item.id}
        previewId={previewId}
        onPreview={(id) => {
          if (!skipFocusPreview.current) setPeekId(id)
        }}
        onSelect={(id, viaKeyboard) => {
          if (pinnedId === id) {
            dismiss()
            return
          }
          focusDetails.current = viaKeyboard
          setPinnedId(id)
          setPeekId(null)
        }}
      />
    )
  }

  return (
    <section
      ref={rootRef}
      className="runway surface-raised"
      aria-labelledby={headingId}
      data-in-view={inView}
      onPointerLeave={(event) => {
        if (event.pointerType === 'mouse' && !rootRef.current?.contains(document.activeElement)) {
          setPeekId(null)
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setPeekId(null)
      }}
    >
      <header className="runway__head">
        <div>
          <h2 id={headingId}>Arrival Runway</h2>
          <p>Shipment progress from carrier milestones</p>
        </div>
        <div className="runway__counts">
          <span><strong>{shipments.length}</strong> active</span>
          {priorityCount > 0 && <span className="runway__priority"><i aria-hidden="true" /> <strong>{priorityCount}</strong> priority</span>}
        </div>
      </header>

      <div className="runway__display" data-empty={items.length === 0}>
        <ol className="runway__milestones" aria-label="Shipment milestones">
          {runwayMilestones.map((milestone) => (
            <li key={milestone.id} data-occupied={rows.has(milestone.id)}>
              <span>{milestone.label}</span>
              <i aria-hidden="true" />
            </li>
          ))}
        </ol>
        {plotted.length > 0 && (
          <div className="runway__plot-window">
            <div className="runway__plot" style={{ height: rowCount * ROW_HEIGHT + 9 }}>
              {plotted.map((item) => (
                <Motion.div
                  key={item.id}
                  className="runway__point"
                  initial={false}
                  animate={{ left: railPosition(item.milestone.progress), y: item.row * ROW_HEIGHT }}
                  transition={reducedMotion ? still : standardSpring}
                >
                  {marker(item)}
                </Motion.div>
              ))}
            </div>
          </div>
        )}
        {unplaced.length > 0 && (
          <div className="runway__unplaced">
            <p><strong>{unplaced.length}</strong> without a reported milestone</p>
            <div className="runway__unplaced-items">
              {unplaced.map((item) => <div key={item.id}>{marker(item)}</div>)}
            </div>
          </div>
        )}
        {active && (
          <ShipmentPreview
            key={active.id}
            item={active}
            lastEvent={lastEvent}
            id={previewId}
            detailsRef={detailsRef}
            pinned={isPinned}
            reducedMotion={reducedMotion}
            onClose={() => {
              restoreMarkerFocus(active.id)
              dismiss()
            }}
          />
        )}
      </div>

      <div className="runway__foot">
        <span>{items.length ? 'Select a shipment for details' : 'Track a shipment to see carrier updates here.'}</span>
        {priorityCount > 0 && <span><i aria-hidden="true" /> Out for delivery or ETA soon</span>}
      </div>
    </section>
  )
}

export default ArrivalLane

import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { gsap, prefersReducedMotion } from '../lib/scrollMotion'
import './EtaLane.css'

const DAY = 86400000
const shortDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })
// Tick dates are built from UTC day numbers, so format them in UTC too.
const tickDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const calendarDay = (date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY

// Order and wording of the counts above the lane; each one filters the manifest.
const laneBuckets = {
  overdue: 'past ETA',
  week: 'this week',
  fortnight: 'next week',
  later: 'later',
  arrived: 'arrived',
  missing: 'no ETA',
}

/**
 * Every shipment on one strip around today: arrivals behind the line, ETAs
 * ahead of it. Labels stack into rows so they never overlap; selecting a
 * shipment hands its id to the parent (the manifest opens that row).
 */
function assignRows(items, width) {
  const rowEnds = []
  return items.map((item) => {
    const x = (item.left / 100) * width
    const labelWidth = item.label.length * 7.2 + 18
    const start = item.left < 8 ? x - 6 : item.left > 92 ? x - labelWidth + 6 : x - labelWidth / 2
    let row = rowEnds.findIndex((end) => start > end + 8)
    if (row === -1) {
      row = rowEnds.length
      rowEnds.push(start + labelWidth)
    } else {
      rowEnds[row] = start + labelWidth
    }
    return { ...item, row: Math.min(row, 3) }
  })
}

function EtaLane({ shipments, now, selectedId, onSelect, activeWindow = 'all', onWindowChange, from = -14, to = 35 }) {
  const rootRef = useRef(null)
  const trackRef = useRef(null)
  const [width, setWidth] = useState(900)
  const [hoverId, setHoverId] = useState('')
  const span = to - from
  const position = (day) => ((Math.min(Math.max(day, from), to) - from) / span) * 100
  const today = calendarDay(now)

  const items = useMemo(() => {
    const plotted = shipments
      .map((shipment) => {
        const day = shipment.bucket === 'arrived'
          ? shipment.arrivedAt ? calendarDay(shipment.arrivedAt) - today : null
          : shipment.daysLeft
        if (day === null || day === undefined) return null
        return {
          id: shipment.id,
          label: shipment.invoiceNo || shipment.blNo || 'Shipment',
          day,
          bucket: shipment.bucket,
          left: position(day),
          clipped: day < from ? 'before' : day > to ? 'after' : '',
          lines: [
            [shipment.blNo, shipment.carrierLabel].filter(Boolean).join(' · '),
            shipment.bucket === 'arrived'
              ? `Arrived ${shipment.arrivedAt ? shortDate.format(shipment.arrivedAt) : ''}`
              : `ETA ${shortDate.format(shipment.eta)} · ${day === 0 ? 'today' : day > 0 ? `in ${day} d` : `${-day} d ago`}`,
            shipment.latestEvent?.title ?? '',
          ].filter(Boolean),
        }
      })
      .filter(Boolean)
      .sort((a, b) => a.day - b.day)
    return assignRows(plotted, width)
    // position() only depends on from/to/span, which are in the deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shipments, today, width, from, to, span])

  const counts = Object.keys(laneBuckets)
    .map((key) => [key, shipments.filter((shipment) => shipment.bucket === key).length])
    .filter(([, count]) => count > 0)
  const rows = Math.max(1, ...items.map((item) => item.row + 1))
  const dataKey = items.map((item) => `${item.id}:${item.day}`).join('|')

  // Dates every two weeks around today; fewer marks, nothing to read past.
  const ticks = []
  for (let day = Math.ceil(from / 14) * 14; day <= to; day += 14) ticks.push(day)

  useLayoutEffect(() => {
    const track = trackRef.current
    if (!track || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)))
    observer.observe(track)
    return () => observer.disconnect()
  }, [])

  // Entrance: the today line draws, then each shipment glides out from today to its date.
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root || prefersReducedMotion()) return undefined
    const todayLeft = position(0)
    const ctx = gsap.context(() => {
      const timeline = gsap.timeline({ defaults: { ease: 'expo.out' } })
      timeline
        .from('[data-lane-today]', { scaleY: 0, transformOrigin: 'bottom', duration: 0.9 })
        .from('[data-lane-tick]', { opacity: 0, y: 6, stagger: 0.05, duration: 0.6 }, 0.1)
      // Animate the inner glide, not the button: GSAP folds the button's CSS
      // `translate` (its edge anchoring) into its own transform and loses it.
      root.querySelectorAll('[data-lane-item]').forEach((node, index) => {
        const offset = ((todayLeft - Number(node.dataset.left)) / 100) * width
        timeline.from(node.querySelector('[data-lane-glide]'), { x: offset, opacity: 0, duration: 1.3 }, 0.25 + index * 0.07)
      })
    }, root)
    return () => ctx.revert()
    // Replays only when the plotted shipments change, not on resize.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey])

  if (!shipments.length) return null

  const laneHeight = rows * 28 + 40
  const active = hoverId ? items.find((item) => item.id === hoverId) : null

  return (
    <section ref={rootRef} className="eta-lane" aria-labelledby="eta-lane-title">
      <div className="eta-lane__head">
        <h2 id="eta-lane-title">Arrivals</h2>
        {counts.length > 0 && (
          <div className="eta-lane__counts" role="group" aria-label="Show in the manifest">
            {counts.map(([key, count]) => {
              const pressed = activeWindow === key
              return (
                <button
                  key={key}
                  type="button"
                  className="eta-lane__count"
                  aria-pressed={pressed}
                  onClick={() => onWindowChange?.(pressed ? 'all' : key)}
                >
                  <span className="eta-lane__dot" data-bucket={key} aria-hidden="true" />
                  <strong>{count}</strong> {laneBuckets[key]}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div ref={trackRef} className="eta-lane__track" style={{ height: `${laneHeight}px` }}>
        <span className="eta-lane__axis" aria-hidden="true" />
        <span data-lane-today className="eta-lane__today" style={{ left: `${position(0)}%` }} aria-hidden="true" />

        {items.map((item) => {
          const selected = item.id === selectedId
          const anchor = item.left < 8 ? 'start' : item.left > 92 ? 'end' : 'center'
          return (
            <button
              key={item.id}
              type="button"
              data-lane-item
              data-left={item.left}
              data-anchor={anchor}
              data-dim={activeWindow !== 'all' && activeWindow !== item.bucket ? true : undefined}
              data-bucket={item.bucket}
              className="eta-lane__item"
              aria-pressed={selected}
              aria-label={[item.label, ...item.lines].join(', ')}
              style={{ left: `${item.left}%`, bottom: `${30 + item.row * 28}px` }}
              onMouseEnter={() => setHoverId(item.id)}
              onMouseLeave={() => setHoverId('')}
              onFocus={() => setHoverId(item.id)}
              onBlur={() => setHoverId('')}
              onClick={() => onSelect(item.id)}
            >
              <span data-lane-glide className="eta-lane__glide">
                <span className="eta-lane__label">
                  {item.clipped === 'before' ? '‹ ' : ''}
                  {item.label}
                  {item.clipped === 'after' ? ' ›' : ''}
                </span>
                <span className="eta-lane__dot" data-bucket={item.bucket} />
              </span>
            </button>
          )
        })}

        {active ? (
          <div
            className="eta-lane__card"
            role="tooltip"
            style={{
              left: `clamp(0px, calc(${active.left}% - 130px), calc(100% - 260px))`,
              bottom: `${30 + active.row * 28 + 44}px`,
            }}
          >
            <p className="eta-lane__card-title">{active.label}</p>
            {active.lines.map((line) => <p key={line}>{line}</p>)}
          </div>
        ) : null}

        {ticks.map((day) => (
          <span
            key={day}
            data-lane-tick
            className="eta-lane__tick"
            data-today={day === 0 || undefined}
            style={{
              left: `${position(day)}%`,
              translate: day === from ? '0 0' : day === to ? '-100% 0' : '-50% 0',
            }}
          >
            {day === 0 ? 'Today' : tickDate.format(new Date((today + day) * DAY))}
          </span>
        ))}
      </div>

    </section>
  )
}

export default EtaLane

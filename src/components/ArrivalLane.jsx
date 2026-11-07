import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { gsap, prefersReducedMotion } from '../lib/motion'

const DAY_MS = 86400000

const shortDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })

const bucketStyles = {
  overdue: { dot: 'is-overdue', label: 'Past ETA' },
  week: { dot: 'is-week', label: 'Within 7 days' },
  fortnight: { dot: 'is-fortnight', label: '8–14 days' },
  later: { dot: 'is-later', label: 'Later' },
}

/**
 * Greedy label rows: a label moves up a row when it would overlap the
 * previous label in the same row. Widths are estimated from character count.
 */
function assignRows(items, widthPx) {
  const rowEnds = []

  return items.map((item) => {
    const x = (item.left / 100) * widthPx
    const width = item.label.length * 7.5 + 16
    // Mirror the edge anchoring used when rendering.
    const start = item.left < 8 ? x - 5 : item.left > 92 ? x - width + 5 : x - width / 2
    const end = start + width
    let row = rowEnds.findIndex((rowEnd) => start > rowEnd + 6)

    if (row === -1) {
      row = rowEnds.length
      rowEnds.push(end)
    } else {
      rowEnds[row] = end
    }

    return { ...item, row: Math.min(row, 3) }
  })
}

/**
 * Every shipment's ETA on one strip around today.
 * shipments: [{ id, label, daysLeft, bucket, href?, lines?: string[] }]
 */
function ArrivalLane({ shipments, from = -21, to = 35, title = 'Arrival lane', caption, compact = false }) {
  const rootRef = useRef(null)
  const trackRef = useRef(null)
  const [trackWidth, setTrackWidth] = useState(900)
  const [activeId, setActiveId] = useState('')
  const span = to - from
  const todayLeft = ((0 - from) / span) * 100
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // Weekly ticks; fortnightly on narrow lanes so dates never collide.
  const tickStep = trackWidth < 520 ? 14 : 7
  const ticks = []
  for (let day = from; day <= to; day += 7) {
    if (day % tickStep === 0 || day === from || (day === to && tickStep === 7)) ticks.push(day)
  }
  const gridDays = []
  for (let day = from; day <= to; day += 7) gridDays.push(day)

  const items = useMemo(() => {
    const placed = shipments
      .filter((shipment) => shipment.daysLeft !== null && shipment.daysLeft !== undefined)
      .sort((left, right) => left.daysLeft - right.daysLeft)
      .map((shipment) => ({
        ...shipment,
        left: ((Math.min(Math.max(shipment.daysLeft, from), to) - from) / span) * 100,
        clippedLeft: shipment.daysLeft < from,
        clippedRight: shipment.daysLeft > to,
      }))

    return assignRows(placed, trackWidth)
  }, [shipments, from, to, span, trackWidth])

  const dataKey = items.map((item) => `${item.id}:${item.daysLeft}`).join('|')

  // Keep label rows correct as the lane resizes.
  useLayoutEffect(() => {
    const track = trackRef.current
    if (!track || typeof ResizeObserver === 'undefined') return undefined

    const observer = new ResizeObserver(([entry]) => {
      setTrackWidth(Math.round(entry.contentRect.width))
    })
    observer.observe(track)
    return () => observer.disconnect()
  }, [])

  // Entrance: today line draws, then each shipment glides out from today to its date.
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root || prefersReducedMotion()) return undefined

    const ctx = gsap.context(() => {
      const timeline = gsap.timeline({ defaults: { ease: 'expo.out' } })
      timeline
        .from('[data-lane-today]', { scaleY: 0, transformOrigin: 'bottom', duration: 0.9 })
        .from('[data-lane-tick]', { opacity: 0, y: 6, stagger: 0.03, duration: 0.6 }, 0.1)

      root.querySelectorAll('[data-lane-item]').forEach((node, index) => {
        const offset = ((todayLeft - Number(node.dataset.left)) / 100) * trackWidth
        timeline.from(
          node,
          { x: offset, opacity: 0, duration: 1.4, ease: 'expo.out' },
          0.25 + index * 0.08,
        )
      })
    }, root)

    return () => ctx.revert()
    // Re-run only when the plotted shipments change, not on every resize.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey])

  const usedBuckets = Array.from(new Set(items.map((item) => item.bucket)))
  const rows = Math.max(1, ...items.map((item) => item.row + 1))
  const laneHeight = (compact ? 22 : 26) * rows + 34

  return (
    <section ref={rootRef} aria-label={title} className="lane">
      <div className="lane-head">
        <h2 className="lane-title">{title}</h2>
        {caption ? <p className="lane-caption">{caption}</p> : null}
      </div>

      <div ref={trackRef} className="lane-track" style={{ height: `${laneHeight + 24}px` }}>
        {gridDays.map((tick) => (
          <span
            key={`grid-${tick}`}
            className="lane-grid"
            style={{ left: `${((tick - from) / span) * 100}%` }}
            aria-hidden="true"
          />
        ))}

        <span className="lane-axis" aria-hidden="true" />
        <span data-lane-today className="lane-today" style={{ left: `${todayLeft}%` }} aria-hidden="true" />

        {items.map((item) => {
          const style = bucketStyles[item.bucket] ?? bucketStyles.later
          const isActive = activeId === item.id
          const label = `${item.clippedLeft ? '‹ ' : ''}${item.label}${item.clippedRight ? ' ›' : ''}`
          const content = (
            <>
              <span className="lane-label">{label}</span>
              <span className={`lane-dot ${style.dot}`} />
            </>
          )
          const commonProps = {
            'data-lane-item': true,
            'data-left': item.left,
            className: `lane-item ${isActive ? 'is-active' : ''}`,
            style: {
              left: `${item.left}%`,
              bottom: `${24 + 8 + item.row * (compact ? 22 : 26)}px`,
              zIndex: isActive ? 5 : 1,
              // Near an edge the label hangs inward; the dot stays on its date.
              ...(item.left < 8
                ? { alignItems: 'flex-start', translate: '-5px 0' }
                : item.left > 92
                  ? { alignItems: 'flex-end', translate: 'calc(-100% + 5px) 0' }
                  : null),
            },
            onMouseEnter: () => setActiveId(item.id),
            onMouseLeave: () => setActiveId(''),
            onFocus: () => setActiveId(item.id),
            onBlur: () => setActiveId(''),
            'aria-label': [item.label, ...(item.lines ?? [])].join(', '),
          }

          return (
            <div key={item.id}>
              {item.href ? (
                <Link to={item.href} {...commonProps}>
                  {content}
                </Link>
              ) : (
                <span tabIndex={0} {...commonProps}>
                  {content}
                </span>
              )}
              {isActive && item.lines?.length ? (
                <div
                  role="tooltip"
                  className="lane-card"
                  style={{
                    left: `clamp(0px, calc(${item.left}% - 120px), calc(100% - 240px))`,
                    bottom: `${24 + 8 + item.row * (compact ? 22 : 26) + 40}px`,
                  }}
                >
                  <p className="lane-card-title">{item.label}</p>
                  {item.lines.map((line) => (
                    <p key={line}>{line}</p>
                  ))}
                </div>
              ) : null}
            </div>
          )
        })}

        {ticks.map((tick, index) => (
          <span
            key={tick}
            data-lane-tick
            className={`lane-tick ${tick === 0 ? 'is-today' : ''}`}
            style={{
              left: `${((tick - from) / span) * 100}%`,
              // `translate` (not transform) so GSAP's y offset never fights it.
              translate: index === 0 ? '0 0' : index === ticks.length - 1 ? '-100% 0' : '-50% 0',
            }}
          >
            {tick === 0 ? 'Today' : shortDate.format(new Date(today.getTime() + tick * DAY_MS))}
          </span>
        ))}
      </div>

      {usedBuckets.length > 1 ? (
        <ul className="lane-legend" aria-label="Legend">
          {Object.entries(bucketStyles)
            .filter(([key]) => usedBuckets.includes(key))
            .map(([key, value]) => (
              <li key={key}>
                <span className={`lane-dot ${value.dot}`} aria-hidden="true" />
                {value.label}
              </li>
            ))}
        </ul>
      ) : null}
    </section>
  )
}

export default ArrivalLane

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Icon } from '@iconify/react'
import useAuth from '../hooks/useAuth'
import ArrivalLane from '../components/ArrivalLane'
import { carriers, detectCarrierFromBlNumber, getCarrierLabel } from '../lib/carriers'
import { gsap, prefersReducedMotion, useSmoothScroll } from '../lib/motion'
import '../landing.css'

// Set before Google sign-in so the add form opens with this B/L after login.
const PENDING_BL_KEY = 'shiptrack:pendingBl'
const EXAMPLE_BL = 'MEDUKU648102'
const ADVANCE_MS = 4800

const frames = [
  { id: 'check', name: 'Carrier check', short: 'Check' },
  { id: 'moves', name: 'Container moves', short: 'Moves' },
  { id: 'lane', name: 'Arrival lane', short: 'Lane' },
  { id: 'alert', name: 'ETA email', short: 'Email' },
]

// One real voyage ShipTrack recorded (invoice 547-GVCS, MSC).
const moves = [
  { title: 'Empty to Shipper', place: 'Surabaya', date: 'Aug 19' },
  { title: 'Export Loaded on Vessel', place: 'Surabaya', date: 'Aug 29' },
  { title: 'Full Transshipment Discharged', place: 'Port Elizabeth', date: 'Oct 14', current: true },
  { title: 'Full Transshipment Loaded', place: 'Port Elizabeth', date: 'Nov 2' },
  { title: 'Estimated Time of Arrival', place: 'Maputo', date: 'Nov 13', planned: true },
]

// Four real MSC shipments, placed relative to today.
const laneDemo = [
  { id: 'd546', label: '546-GVCS', daysLeft: -12, bucket: 'overdue', lines: ['MEDUKU647997 · MSC', 'Empty received at CY, Beira'] },
  { id: 'd524', label: '524-GVCS', daysLeft: -2, bucket: 'overdue', lines: ['MEDUKU574985 · MSC', 'ETA passed 2 days ago'] },
  { id: 'd548', label: '548-GVCS', daysLeft: 2, bucket: 'week', lines: ['MEDUKU574829 · MSC', 'Arrives in 2 days'] },
  { id: 'd547', label: '547-GVCS', daysLeft: 6, bucket: 'week', lines: ['MEDUKU648102 · MSC', 'Arrives in 6 days'] },
]

function ShipTrackMark() {
  return (
    <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true">
      <rect x="2" y="8" width="28" height="16" rx="2" fill="#1f3038" />
      <path d="M8 11v10M13 11v10M18 11v10M23 11v10" stroke="#f7f9fa" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function readPendingBl() {
  try {
    return window.sessionStorage.getItem(PENDING_BL_KEY) || ''
  } catch {
    return ''
  }
}

function CheckFrame({ bl }) {
  const shown = bl || EXAMPLE_BL
  const carrier = detectCarrierFromBlNumber(shown)
  const prefix = carrier
    ? carriers.find((entry) => entry.code === carrier).prefixes.find((value) => shown.startsWith(value))
    : ''
  const isExample = !bl

  return (
    <>
      <div className="lp-frame-head">
        <span className="lp-frame-title">Carrier check</span>
        <span>{isExample ? 'Example' : 'Your B/L'}</span>
      </div>
      <p className="lp-check-bl">
        {prefix ? <mark>{prefix}</mark> : null}
        {shown.slice(prefix.length)}
      </p>
      <p className="lp-check-note">
        {prefix
          ? `Read from the prefix ${prefix}, one of ${carriers.find((entry) => entry.code === carrier).prefixes.length} that ${getCarrierLabel(carrier)} uses on its bills of lading.`
          : 'No prefix ShipTrack knows yet. You choose the carrier after signing in.'}
      </p>
      <dl className="lp-check-grid">
        <div>
          <dt>Carrier</dt>
          <dd>{carrier ? getCarrierLabel(carrier) : 'Pick after sign-in'}</dd>
        </div>
        <div>
          <dt>Containers</dt>
          <dd>{isExample ? '3' : 'After sign-in'}</dd>
        </div>
        <div>
          <dt>Carrier ETA</dt>
          <dd>{isExample ? 'Nov 13, 2026' : 'After sign-in'}</dd>
        </div>
      </dl>
    </>
  )
}

function MovesFrame() {
  return (
    <>
      <div className="lp-frame-head">
        <span className="lp-frame-title">Container moves</span>
        <span>FCIU4446860 · 5 of 24</span>
      </div>
      <ol className="lp-moves">
        {moves.map((move) => (
          <li key={move.title} className={move.current ? 'is-current' : ''}>
            <span className="lp-move-title">
              {move.title} <span className="lp-move-place">· {move.place}</span>
              {move.planned ? <span className="lp-tag">Planned</span> : null}
            </span>
            <time>{move.date}</time>
          </li>
        ))}
      </ol>
    </>
  )
}

function AlertFrame() {
  return (
    <div className="lp-mail">
      <div className="lp-frame-head">
        <span className="lp-frame-title">ETA email</span>
        <span>08:00, Maputo time</span>
      </div>
      <p className="lp-mail-subject">ShipTrack: Shipment ETA Updated</p>
      <p className="lp-mail-meta">To your alert address, the morning the carrier changes the date.</p>
      <table>
        <thead>
          <tr>
            <th scope="col">Invoice</th>
            <th scope="col">B/L</th>
            <th scope="col" className="lp-col-prev">Was</th>
            <th scope="col">Now</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>547-GVCS</td>
            <td>MEDUKU648102</td>
            <td className="lp-col-prev">Nov 9</td>
            <td className="is-late">Nov 13</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function Login() {
  const { configError, currentUser, loading, signInWithGoogle } = useAuth()
  const [blNo, setBlNo] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [active, setActive] = useState(0)
  const [paused, setPaused] = useState(false)
  const rootRef = useRef(null)
  const reelRef = useRef(null)
  const trackRef = useRef(null)
  const firstPlaceRef = useRef(true)

  useSmoothScroll()

  const isRedirecting = !loading && Boolean(currentUser)
  const cleanBl = blNo.toUpperCase().replace(/[^A-Z0-9]/g, '')

  // Centre the active frame on the headline's line; on phones, show it in place.
  const placeReel = useCallback(
    (animate) => {
      const track = trackRef.current
      const frame = track?.children[active]
      if (!track || !frame) return

      const stacked = window.matchMedia('(max-width: 960px)').matches
      const y = stacked ? -frame.offsetTop : -(frame.offsetTop + frame.offsetHeight / 2)

      if (!animate || prefersReducedMotion()) {
        gsap.set(track, { y })
      } else {
        gsap.to(track, { y, duration: 1.1, ease: 'expo.inOut', overwrite: true })
      }
    },
    [active],
  )

  useLayoutEffect(() => {
    if (isRedirecting) return
    placeReel(!firstPlaceRef.current)
    firstPlaceRef.current = false
  }, [placeReel, isRedirecting])

  useEffect(() => {
    const reel = reelRef.current
    if (!reel || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(() => placeReel(false))
    observer.observe(reel)
    return () => observer.disconnect()
  }, [placeReel])

  // The reel advances on its own; hover, focus, typing or a hidden tab pause it.
  useEffect(() => {
    if (isRedirecting || paused || prefersReducedMotion()) return undefined

    let timer = window.setInterval(() => setActive((current) => (current + 1) % frames.length), ADVANCE_MS)
    const onVisibility = () => {
      window.clearInterval(timer)
      if (!document.hidden) {
        timer = window.setInterval(() => setActive((current) => (current + 1) % frames.length), ADVANCE_MS)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [isRedirecting, paused])

  // Opening: the two halves of the sentence part around the reel.
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root || isRedirecting || prefersReducedMotion()) return undefined

    const ctx = gsap.context(() => {
      gsap
        .timeline({ defaults: { ease: 'expo.out' } })
        .from('.lp-top > *', { y: -12, opacity: 0, duration: 0.8, stagger: 0.06 })
        .from('.lp-half--left', { x: 120, opacity: 0, duration: 1.4 }, 0.1)
        .from('.lp-half--right', { x: -120, opacity: 0, duration: 1.4 }, 0.1)
        .from('.lp-reel', { scale: 0.92, opacity: 0, duration: 1.3 }, 0.2)
        .from('.lp-reel-nav', { opacity: 0, duration: 0.8 }, 0.7)
        .from('.lp-lead, .lp-form, .lp-quiet', { y: 20, opacity: 0, duration: 1, stagger: 0.08 }, 0.55)
    }, root)

    return () => ctx.revert()
  }, [isRedirecting])

  if (isRedirecting) {
    const pendingBl = readPendingBl()

    if (pendingBl) {
      try {
        window.sessionStorage.removeItem(PENDING_BL_KEY)
      } catch {
        // Storage unavailable: nothing to clear.
      }
      return <Navigate to={`/add?bl=${encodeURIComponent(pendingBl)}`} replace />
    }

    return <Navigate to="/dashboard" replace />
  }

  const detected = detectCarrierFromBlNumber(cleanBl)

  const handleSignIn = async (event) => {
    event?.preventDefault()
    setError('')

    if (cleanBl) {
      try {
        window.sessionStorage.setItem(PENDING_BL_KEY, cleanBl)
      } catch {
        // Storage unavailable: the user lands on the dashboard instead.
      }
    }

    setIsSubmitting(true)

    try {
      await signInWithGoogle()
    } catch (signInError) {
      console.error('Google sign-in failed.', signInError)
      setError('Google sign-in did not finish. Try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleBlChange = (event) => {
    setBlNo(event.target.value)
    setActive(0)
  }

  const busy = loading || isSubmitting || Boolean(configError)

  let hint = <>Free with a Google account. Your B/L carries over.</>
  let hintTone = ''
  if (configError) {
    hint = 'Sign-in is unavailable: Firebase keys are missing.'
    hintTone = 'is-error'
  } else if (error) {
    hint = error
    hintTone = 'is-error'
  } else if (cleanBl && detected) {
    hint = (
      <>
        <strong>{getCarrierLabel(detected)}</strong> bill of lading. Sign in to load its containers and ETA.
      </>
    )
  } else if (cleanBl) {
    hint = 'Prefix not recognised yet. You can pick the carrier after signing in.'
  }

  const frameBody = (id) => {
    if (id === 'check') return <CheckFrame bl={cleanBl} />
    if (id === 'moves') return <MovesFrame />
    // Remount when shown so the lane performs its entrance in view.
    if (id === 'lane') return <ArrivalLane key={active === 2 ? 'shown' : 'waiting'} shipments={laneDemo} from={-14} to={21} compact title="Arrival lane" caption="Today in the middle" />
    return <AlertFrame />
  }

  return (
    <main ref={rootRef} className="lp">
      <header className="lp-top">
        <a href="/" className="lp-word">
          <ShipTrackMark />
          ShipTrack
        </a>
        <div className="lp-top-right">
          <span className="lp-top-note">MSC, ONE, Evergreen and PIL</span>
          <button type="button" className="lp-textlink" onClick={handleSignIn} disabled={busy}>
            Sign in
          </button>
        </div>
      </header>

      <section className="lp-stage" aria-labelledby="lp-title">
        <h1 id="lp-title">
          <span className="lp-half lp-half--left">Paste a B/L.</span>{' '}
          <span className="lp-half lp-half--right">Watch it land.</span>
        </h1>

        <div
          ref={reelRef}
          className="lp-reel"
          role="region"
          aria-roledescription="carousel"
          aria-label="What ShipTrack shows for a B/L"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocus={() => setPaused(true)}
          onBlur={() => setPaused(false)}
        >
          <div ref={trackRef} className="lp-reel-track">
            {frames.map((frame, index) => (
              <div
                key={frame.id}
                className={`lp-frame ${index === active ? 'is-active' : ''}`}
                role="group"
                aria-roledescription="slide"
                aria-label={`${index + 1} of ${frames.length}: ${frame.name}`}
                inert={index !== active}
                data-ui
              >
                <div className="lp-frame-inner">{frameBody(frame.id)}</div>
              </div>
            ))}
          </div>
        </div>

        <nav className="lp-reel-nav" aria-label="Choose a view">
          <ul className="lp-reel-steps">
            {frames.map((frame, index) => (
              <li key={frame.id}>
                <button
                  type="button"
                  aria-current={index === active ? 'true' : undefined}
                  onClick={() => {
                    setActive(index)
                    setPaused(true)
                  }}
                >
                  <span className="lp-step-long">{frame.name}</span>
                  <span className="lp-step-short" aria-hidden="true">
                    {frame.short}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </section>

      <div className="lp-bottom">
        <div>
          <p className="lp-lead">
            ShipTrack follows every container on an MSC, ONE, Evergreen or PIL bill of lading and emails
            you before the ETA moves.
          </p>
          <form className="lp-form" onSubmit={handleSignIn}>
            <label htmlFor="lp-bl">Bill of lading number</label>
            <div className="lp-form-row">
              <input
                id="lp-bl"
                name="bl"
                value={blNo}
                onChange={handleBlChange}
                onFocus={() => setPaused(true)}
                onBlur={() => setPaused(false)}
                placeholder={`e.g. ${EXAMPLE_BL}`}
                maxLength={40}
                autoComplete="off"
                spellCheck="false"
                aria-describedby="lp-hint"
              />
              <button type="submit" className="lp-action" disabled={busy}>
                {loading ? 'Checking…' : isSubmitting ? 'Opening Google…' : 'Track this B/L'}
                <Icon icon="solar:arrow-right-linear" width="18" height="18" aria-hidden="true" />
              </button>
            </div>
            <p id="lp-hint" className={`lp-hint ${hintTone}`} aria-live="polite">
              {hint}
            </p>
          </form>
        </div>

        <p className="lp-quiet">
          <span>B/L tracking for importers</span>
          <a href="https://github.com/nishank23/shipmenttrack">Source on GitHub</a>
          <span>© 2026</span>
        </p>
      </div>
    </main>
  )
}

export default Login

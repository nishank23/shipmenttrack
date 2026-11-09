import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { Icon } from '@iconify/react'
import useAuth from '../hooks/useAuth'
import VoyageGlobe from '../components/VoyageGlobe'
import { TRADE_LANES, buildLane } from '../lib/tradeLanes'
import { detectCarrierFromBlNumber, getCarrierLabel } from '../lib/carriers'
import { gsap, prefersReducedMotion, useSmoothScroll } from '../lib/scrollMotion'
import '../landing.css'

// The voyage cycle: each lane's named stops as arc-length fractions, so the
// timeline can sail the vessel stop by stop.
const LANE_STOPS = TRADE_LANES.map((lane) => buildLane(lane).stopFractions)

const PENDING_BL_KEY = 'shiptrack:pendingBl'

function cleanBillOfLading(value) {
  return value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 40)
}

function storePendingBl(value) {
  try {
    if (value) window.sessionStorage.setItem(PENDING_BL_KEY, value)
    else window.sessionStorage.removeItem(PENDING_BL_KEY)
  } catch {
    // The active sign-in attempt still carries its B/L in memory.
  }
}

function SignedInRedirect({ requestedBl }) {
  const [billOfLading] = useState(() => {
    if (requestedBl !== null) return requestedBl
    try {
      return cleanBillOfLading(window.sessionStorage.getItem(PENDING_BL_KEY) ?? '')
    } catch {
      return ''
    }
  })

  useEffect(() => {
    storePendingBl('')
  }, [])

  return <Navigate to={billOfLading ? `/add?bl=${encodeURIComponent(billOfLading)}` : '/dashboard'} replace />
}

function ShipTrackMark() {
  return (
    <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
      <rect x="2" y="8" width="28" height="16" rx="2" fill="currentColor" />
      <path d="M8 11v10M13 11v10M18 11v10M23 11v10" stroke="var(--lp-mark-lines)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">
      <path fill="#4285f4" d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.5 9.5 0 0 1-4.1 6.2v5h6.6c3.9-3.6 6.1-8.9 6.1-14.9Z" />
      <path fill="#34a853" d="M24 44c5.5 0 10.2-1.8 13.5-4.9l-6.6-5c-1.8 1.2-4.1 1.9-6.9 1.9-5.3 0-9.8-3.6-11.4-8.4H5.8v5.2A20 20 0 0 0 24 44Z" />
      <path fill="#fbbc05" d="M12.6 27.6a12 12 0 0 1 0-7.2v-5.2H5.8a20 20 0 0 0 0 17.6l6.8-5.2Z" />
      <path fill="#ea4335" d="M24 12c3 0 5.7 1 7.8 3.1l5.8-5.8A19.2 19.2 0 0 0 24 4 20 20 0 0 0 5.8 15.2l6.8 5.2C14.2 15.6 18.7 12 24 12Z" />
    </svg>
  )
}

function AuthButton({ type, variant, pending, disabled, onClick, children }) {
  return (
    <button
      type={type}
      className={`lp-button lp-button--${variant}`}
      data-pending={pending || undefined}
      aria-busy={pending}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="lp-button-label">{children}</span>
      <span className="lp-button-progress" aria-hidden="true">
        <span className="lp-spinner" />
        <span className="lp-progress-message">Please wait</span>
      </span>
    </button>
  )
}

/**
 * Hero choreography: the headline rises word by word, then the copy and form;
 * the globe fades in and the voyage plays on a loop that drives both the
 * route on the globe (progress) and the event card (step).
 */
function useVoyage(scope, voyage, setPosition) {
  useLayoutEffect(() => {
    const root = scope.current
    if (!root) return undefined

    if (prefersReducedMotion()) {
      gsap.set(voyage, { lane: 0, progress: 1 })
      setPosition({ lane: 0, step: TRADE_LANES[0].events.length - 1 })
      return undefined
    }

    const ctx = gsap.context(() => {
      gsap
        .timeline({ defaults: { ease: 'expo.out' } })
        .from('[data-word]', { yPercent: 110, duration: 1.1, stagger: 0.06 })
        .from('.lp-sub, .lp-form, .lp-or, .lp-alt, .lp-carriers', { y: 18, opacity: 0, duration: 0.9, stagger: 0.07 }, 0.35)
        .from('.lp-stage', { opacity: 0, duration: 1.4, ease: 'power2.out' }, 0.1)
        .from('.lp-voyage', { y: 28, opacity: 0, duration: 1 }, 0.9)

      // Sail each lane stop by stop; legs take time in proportion to distance.
      const cycle = gsap.timeline({ repeat: -1, delay: 1, defaults: { ease: 'power1.inOut' } })
      TRADE_LANES.forEach((lane, laneIndex) => {
        const fractions = LANE_STOPS[laneIndex]
        cycle
          .call(() => setPosition({ lane: laneIndex, step: 0 }))
          .set(voyage, { lane: laneIndex, progress: 0 })
          .to({}, { duration: 1.1 })
        fractions.slice(1).forEach((fraction, index) => {
          const previous = fractions[index]
          cycle
            .to(voyage, { progress: fraction, duration: Math.max(1.4, (fraction - previous) * 7) })
            .call(() => setPosition({ lane: laneIndex, step: index + 1 }))
            .to({}, { duration: index + 2 === fractions.length ? 2.4 : 0.9 })
        })
      })
    }, root)

    return () => ctx.revert()
  }, [scope, voyage, setPosition])
}

function getSignInMessage(error) {
  switch (error?.code) {
    case 'auth/popup-closed-by-user':
      return 'The Google window closed. Try again when you are ready.'
    case 'auth/popup-blocked':
      return 'Allow pop-ups for this site, then try again.'
    case 'auth/network-request-failed':
      return 'Check your connection, then try signing in again.'
    default:
      return 'Google sign-in did not finish. Please try again.'
  }
}

function Login() {
  const { configError, currentUser, loading, signInWithGoogle } = useAuth()
  const [billOfLading, setBillOfLading] = useState('')
  const [requestedBl, setRequestedBl] = useState(null)
  const [action, setAction] = useState(null)
  const [fieldError, setFieldError] = useState('')
  const [authError, setAuthError] = useState('')
  const inputRef = useRef(null)
  const pageRef = useRef(null)
  // A stable mutable object: GSAP writes it, the globe's render loop reads it.
  const [voyage] = useState(() => ({ lane: 0, progress: 0 }))
  const [position, setPosition] = useState({ lane: 0, step: 0 })
  const signingInRef = useRef(false)
  const cleanBl = cleanBillOfLading(billOfLading)
  const carrier = detectCarrierFromBlNumber(cleanBl)
  const busy = Boolean(action) || loading
  const disabled = busy || Boolean(configError)
  const hasIdentifier = /[A-Z0-9]/.test(cleanBl)

  useSmoothScroll()
  useVoyage(pageRef, voyage, setPosition)

  async function startSignIn(nextAction) {
    if (signingInRef.current || disabled) return

    setAuthError('')
    if ((nextAction === 'track' || billOfLading.trim()) && !hasIdentifier) {
      setFieldError(billOfLading.trim()
        ? 'Use letters or numbers for the B/L.'
        : 'Enter a B/L number to track.')
      inputRef.current?.focus()
      return
    }

    signingInRef.current = true
    setFieldError('')
    setRequestedBl(cleanBl)
    storePendingBl(cleanBl)
    setAction(nextAction)

    try {
      await signInWithGoogle()
    } catch (error) {
      storePendingBl('')
      setRequestedBl(null)
      setAuthError(getSignInMessage(error))
      signingInRef.current = false
      setAction(null)
    }
  }

  if (!loading && currentUser) {
    return <SignedInRedirect requestedBl={requestedBl} />
  }

  const fieldHint = carrier
    ? `${getCarrierLabel(carrier)} bill of lading. Sign in to load its containers and ETA.`
    : hasIdentifier
      ? 'Prefix not recognised. You can pick the carrier after signing in.'
      : 'ShipTrack reads the carrier from the B/L prefix.'
  const lane = TRADE_LANES[position.lane]
  const event = lane.events[position.step]
  const laneStops = lane.waypoints.filter((point) => point.name)

  return (
    <main ref={pageRef} className="lp">
      <section className="lp-panel" aria-labelledby="lp-title">
        <header className="lp-top">
          <Link to="/" className="lp-word">
            <ShipTrackMark />
            ShipTrack
          </Link>
          <a className="lp-source" href="https://github.com/nishank23/shipmenttrack">
            Source on GitHub
          </a>
        </header>

        <div className="lp-copy">
          <h1 id="lp-title" aria-label="Every container. Every ETA.">
            <span className="lp-line" aria-hidden="true">
              <span data-word>Every</span> <span data-word>container.</span>
            </span>
            <span className="lp-line" aria-hidden="true">
              <span data-word>Every</span> <span data-word>ETA.</span>
            </span>
          </h1>
          <p className="lp-sub">
            Paste a bill of lading. ShipTrack follows each container through the carrier&apos;s
            events and emails you the morning its ETA moves.
          </p>

          <form
            className="lp-form"
            onSubmit={(submitEvent) => {
              submitEvent.preventDefault()
              void startSignIn('track')
            }}
            noValidate
          >
            <label className="lp-label" htmlFor="lp-bl">
              Track a new bill of lading
            </label>
            <div className="lp-row" data-invalid={Boolean(fieldError) || undefined}>
              <input
                ref={inputRef}
                id="lp-bl"
                name="bl"
                type="text"
                value={billOfLading}
                onChange={(changeEvent) => {
                  setBillOfLading(changeEvent.target.value)
                  setFieldError('')
                }}
                placeholder="e.g. MEDU1234567"
                maxLength={40}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                readOnly={busy}
                aria-invalid={Boolean(fieldError)}
                aria-describedby="lp-bl-feedback"
              />
              <AuthButton type="submit" variant="track" pending={action === 'track'} disabled={disabled}>
                Track
                <Icon icon="solar:arrow-right-linear" width="18" height="18" aria-hidden="true" />
              </AuthButton>
            </div>
            <p id="lp-bl-feedback" className="lp-feedback" aria-live="polite">
              {fieldError ? (
                <span className="lp-inline-error">{fieldError}</span>
              ) : (
                <>
                  {carrier ? <Icon icon="solar:check-circle-bold" width="16" height="16" aria-hidden="true" /> : null}
                  {fieldHint}
                </>
              )}
            </p>
          </form>

          <p className="lp-or" aria-hidden="true">
            <span>or</span>
          </p>

          <div className="lp-alt">
            <AuthButton
              type="button"
              variant="google"
              pending={action === 'google' || (!action && loading)}
              disabled={disabled}
              onClick={() => {
                void startSignIn('google')
              }}
            >
              <GoogleMark />
              Continue with Google
            </AuthButton>
            {authError || configError ? (
              <p className="lp-inline-error" role="alert">
                {authError || 'Sign-in is temporarily unavailable.'}
              </p>
            ) : (
              <p className="lp-alt-note">Already tracking shipments? Sign in to open your dashboard.</p>
            )}
          </div>

          <p className="lp-carriers">Reads MSC, ONE, Evergreen and PIL bills of lading.</p>
          <p className="sr-only" role="status">
            {action ? 'Connecting to Google.' : loading ? 'Checking your session.' : ''}
          </p>
        </div>

        <p className="lp-foot">
          Globe land data: NASA Blue Marble, public domain.
        </p>
      </section>

      <section className="lp-stage" aria-label="Trade lanes on a globe">
        <VoyageGlobe lanes={TRADE_LANES} voyage={voyage} className="lp-globe">
          <div className="lp-globe-fallback" aria-hidden="true" />
        </VoyageGlobe>

        <article className="lp-voyage" data-ui aria-live="off">
          <header className="lp-voyage-head">
            <span className="lp-voyage-lane">{lane.title}</span>
            <span className="lp-voyage-badge">
              {lane.badge}
            </span>
          </header>
          <p className="lp-voyage-sub">{lane.subtitle}</p>
          <div className="lp-voyage-event" key={`${position.lane}-${position.step}`}>
            <p className="lp-voyage-title">{event.title}</p>
            <p className="lp-voyage-meta">{event.place}</p>
          </div>
          <ol className="lp-voyage-stops" key={lane.id}>
            {laneStops.map((stop, index) => (
              <li key={stop.name} className={index <= position.step ? 'is-reached' : undefined}>
                {stop.name}
              </li>
            ))}
          </ol>
          <ol className="lp-voyage-lanes" aria-label="Trade lanes">
            {TRADE_LANES.map((entry, index) => (
              <li key={entry.id} aria-current={index === position.lane ? 'true' : undefined}>
                <span className="sr-only">{entry.title}</span>
              </li>
            ))}
          </ol>
        </article>
      </section>
    </main>
  )
}

export default Login

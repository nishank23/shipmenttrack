import { useEffect, useRef, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { Icon } from '@iconify/react'
import EtaUpdateDemo from '../components/EtaUpdateDemo'
import useAuth from '../hooks/useAuth'
import { detectCarrierFromBlNumber, getCarrierLabel } from '../lib/carriers'
import '../landing.css'

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
  const signingInRef = useRef(false)
  const cleanBl = cleanBillOfLading(billOfLading)
  const carrier = detectCarrierFromBlNumber(cleanBl)
  const busy = Boolean(action) || loading
  const disabled = busy || Boolean(configError)
  const hasIdentifier = /[A-Z0-9]/.test(cleanBl)

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

  const fieldHint = carrier ? `${getCarrierLabel(carrier)} detected`
    : hasIdentifier ? 'Choose a carrier after signing in.'
      : 'Optional for Google sign-in.'

  return (
    <main className="lp">
      <header className="lp-top">
        <Link to="/" className="lp-word">
          <ShipTrackMark />
          ShipTrack
        </Link>
        <a className="lp-source" href="https://github.com/nishank23/shipmenttrack">Source on GitHub</a>
      </header>

      <div className="lp-shell">
        <section className="lp-entry" aria-labelledby="lp-title">
          <h1 id="lp-title">Track shipment ETAs.</h1>
          <p className="lp-intro">Follow carrier ETAs and get an email when they change.</p>

          <form
            className="lp-card"
            onSubmit={(event) => {
              event.preventDefault()
              void startSignIn('track')
            }}
            noValidate
          >
            <div className="lp-field" data-invalid={Boolean(fieldError) || undefined}>
              <input
                ref={inputRef}
                id="lp-bl"
                name="bl"
                type="text"
                value={billOfLading}
                onChange={(event) => {
                  setBillOfLading(event.target.value)
                  setFieldError('')
                }}
                placeholder=" "
                maxLength={40}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                readOnly={busy}
                aria-invalid={Boolean(fieldError)}
                aria-describedby="lp-bl-feedback"
              />
              <label htmlFor="lp-bl">Bill of lading number</label>
            </div>

            <p id="lp-bl-feedback" className="lp-field-feedback" aria-live="polite">
              {fieldError ? <span className="lp-inline-error">{fieldError}</span> : fieldHint}
            </p>

            <div className="lp-actions">
              <AuthButton type="submit" variant="track" pending={action === 'track'} disabled={disabled}>
                Track this B/L
                <Icon icon="solar:arrow-right-linear" width="18" height="18" aria-hidden="true" />
              </AuthButton>
              <AuthButton
                type="button"
                variant="google"
                pending={action === 'google' || (!action && loading)}
                disabled={disabled}
                onClick={() => { void startSignIn('google') }}
              >
                <GoogleMark />
                Continue with Google
              </AuthButton>
            </div>

            <div className="lp-auth-note">
              {authError || configError ? (
                <p className="lp-inline-error" role="alert">
                  {authError || 'Sign-in is temporarily unavailable.'}
                </p>
              ) : (
                <p className="lp-auth-help">One Google account for new and returning users.</p>
              )}
            </div>
            <p className="sr-only" role="status">
              {action ? 'Connecting to Google.' : loading ? 'Checking your session.' : ''}
            </p>
          </form>
        </section>

        <EtaUpdateDemo />
      </div>
    </main>
  )
}

export default Login

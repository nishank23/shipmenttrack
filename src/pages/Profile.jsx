import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '@iconify/react'
import useAuth from '../hooks/useAuth'
import { carriers, getCarrierBrand } from '../lib/carriers'
import { getProfileSettings, validateProfileSettings } from '../lib/profileSettings'
import { readUserSettings, saveUserSettings } from '../lib/users'
import './Profile.css'

const carrierOptions = [{ code: '', label: 'No default', logo: '' },
  ...carriers.map(({ code }) => ({ code, ...getCarrierBrand(code) }))]

function Avatar({ src, name }) {
  const [failed, setFailed] = useState(false)
  const initials = name.trim().split(/\s+/).slice(0, 2).map((part) => Array.from(part)[0]).join('').toUpperCase()
  const hasPhoto = Boolean(src && !failed)
  return (
    <div className="pf-avatar" data-initials={!hasPhoto} aria-hidden="true">
      {hasPhoto ? <img src={src} alt="" width="56" height="56" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
        : <span>{initials || 'S'}</span>}
    </div>
  )
}

function ProfileField({ name, label, error, descriptionId, ...props }) {
  const description = [error && `profile-${name}-error`, descriptionId].filter(Boolean).join(' ')
  return (
    <div className="pf-field">
      <label htmlFor={`profile-${name}`}>{label}</label>
      <input id={`profile-${name}`} name={name} className="st-field" aria-invalid={Boolean(error)}
        aria-describedby={description || undefined} {...props} />
      {error && <p className="pf-error" id={`profile-${name}-error`}>{error}</p>}
    </div>
  )
}

function NotificationSwitch({ id, label, help, checked, onChange }) {
  return (
    <label className="pf-switch-row" htmlFor={id}>
      <span className="pf-switch-copy">
        <span id={`${id}-label`}>{label}</span>
        <span id={`${id}-help`}>{help}</span>
      </span>
      <input type="checkbox" role="switch" className="sr-only" id={id} checked={checked}
        aria-labelledby={`${id}-label`} aria-describedby={`${id}-help`} onChange={(event) => onChange(event.target.checked)} />
      <span className="pf-switch-track" aria-hidden="true" />
    </label>
  )
}

function CarrierPreferences({ value, onChange }) {
  return (
    <section className="pf-card" aria-labelledby="pf-carrier">
      <h2 id="pf-carrier">Default carrier</h2>
      <p>Used when a new B/L doesn't match a supported carrier.</p>
      <fieldset className="pf-carriers" aria-label="Preferred carrier">
        {carrierOptions.map(({ code, label, logo }) => (
          <label className="pf-carrier" key={code}>
            <input className="sr-only" type="radio" name="defaultCarrier" value={code} checked={value === code}
              onChange={() => onChange(code)} />
            <span className="pf-carrier__tile">
              {logo && <img src={logo} width="24" height="16" alt="" />}
              {label}
            </span>
          </label>
        ))}
      </fieldset>
    </section>
  )
}

function SaveBar({ state, dirty, disabled, error }) {
  const status = state === 'saving' ? 'Saving settings...' : state === 'saved' ? 'Your settings were saved.'
    : error ? '' : dirty ? 'Unsaved changes' : 'No unsaved changes'
  return (
    <div className="pf-card pf-save" data-state={state}>
      <div className="pf-save__feedback">
        <span role="status">{status}</span>
        {error && <span className="pf-error" role="alert">{error}</span>}
      </div>
      <button type="submit" className="st-primary pf-save__button" aria-disabled={disabled || !dirty}>
        <span key={state} className="pf-save__label">
          {state === 'saving' ? <><span className="pf-save__spinner" aria-hidden="true" /> Saving...</>
            : state === 'saved' ? <><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3.5 8 3 3 6-6" /></svg> Saved</>
              : 'Save settings'}
        </span>
      </button>
    </div>
  )
}

function AccountHub({ user, signOut }) {
  const navigate = useNavigate()
  const [values, setValues] = useState(() => getProfileSettings(user))
  const [saved, setSaved] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [errors, setErrors] = useState({})
  const [error, setError] = useState('')
  const [saveState, setSaveState] = useState('idle')
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState('')
  const saving = useRef(false)
  const formRef = useRef(null)
  const uid = user.uid
  const { displayName, email } = user
  const dirty = Boolean(saved && Object.keys(saved).some((key) => values[key] !== saved[key]))

  useEffect(() => {
    let ignore = false
    readUserSettings(uid).then((data) => {
      if (ignore) return
      const settings = getProfileSettings({ displayName, email }, data)
      setValues(settings)
      setSaved(settings)
      setLoading(false)
    }).catch((loadError) => {
      if (ignore) return
      console.error('Failed to load profile settings.', loadError)
      setLoadFailed(true)
      setLoading(false)
    })
    return () => { ignore = true }
  }, [uid, displayName, email, loadAttempt])

  function retryLoad() {
    setLoading(true)
    setLoadFailed(false)
    setLoadAttempt((attempt) => attempt + 1)
  }

  function update(field, value) {
    setValues((previous) => ({ ...previous, [field]: value }))
    setErrors((previous) => {
      const next = { ...previous }
      delete next[field]
      if (field === 'arrivalReminders' || field === 'etaUpdates') {
        delete next.alertEmail
        delete next.alertDays
      }
      return next
    })
    setError('')
    setSaveState('idle')
  }

  async function save(event) {
    event.preventDefault()
    if (saving.current || signingOut || !saved || !dirty) return
    const nextErrors = validateProfileSettings(values)
    setErrors(nextErrors)
    const first = Object.keys(nextErrors)[0]
    if (first) {
      formRef.current?.elements.namedItem(first)?.focus()
      return
    }
    const next = {
      ...values,
      displayName: values.displayName.trim(),
      alertEmail: values.arrivalReminders || values.etaUpdates ? values.alertEmail.trim() : saved.alertEmail,
      alertDays: values.arrivalReminders ? String(Number(values.alertDays)) : saved.alertDays,
    }
    saving.current = true
    setSaveState('saving')
    setError('')
    try {
      const { displayName: name, alertDays, ...preferences } = next
      await saveUserSettings(uid, { ...preferences, name, email: email ?? '', alertDays: Number(alertDays) })
      setValues(next)
      setSaved(next)
      setSaveState('saved')
    } catch (saveError) {
      console.error('Failed to save profile settings.', saveError)
      setSaveState('idle')
      setError('Settings could not be saved. Your edits are still here; try again.')
    } finally {
      saving.current = false
    }
  }

  async function endSession() {
    setSigningOut(true)
    setSignOutError('')
    try {
      await signOut()
      navigate('/login', { replace: true })
    } catch (signOutFailure) {
      console.error('Sign-out failed.', signOutFailure)
      setSignOutError('Could not sign out. Please try again.')
      setSigningOut(false)
    }
  }

  const name = saved?.displayName || displayName || email || 'ShipTrack user'
  const hasEmails = values.arrivalReminders || values.etaUpdates
  const field = (key) => ({ name: key, value: values[key], error: errors[key], onChange: (event) => update(key, event.target.value) })

  return (
    <main className="pf">
      <header className="pf-header">
        <h1>Profile &amp; settings</h1>
        <p>Manage your account and shipment alerts.</p>
      </header>
      <section className="pf-card pf-identity" aria-label="Signed-in account">
        <Avatar key={user.photoURL} src={user.photoURL} name={name} />
        <div className="pf-identity__name"><h2>{name}</h2><p>{email || 'No sign-in email'}</p></div>
        <span className="pf-status"><i aria-hidden="true" /> {user.emailVerified ? 'Email verified' : 'Signed in'}</span>
      </section>

      {loading ? <p className="pf-card" role="status">Loading settings...</p>
        : loadFailed ? <div className="pf-card pf-load-error">
          <p className="pf-error" role="alert">Settings could not be loaded.</p>
          <button className="st-secondary" type="button" onClick={retryLoad}>Try again</button>
        </div>
          : <form ref={formRef} onSubmit={save} noValidate>
            <fieldset className="pf-settings" disabled={saveState === 'saving' || signingOut} aria-label="Profile preferences">
              <div className="pf-preferences">
                <section className="pf-card" aria-labelledby="pf-account">
                  <h2 id="pf-account">Account details</h2>
                  <p>Your name appears in ShipTrack and shipment emails.</p>
                  <div className="pf-fields pf-account-fields">
                    <ProfileField {...field('displayName')} label="Display name" type="text" autoComplete="name" required />
                    <ProfileField name="email" label="Sign-in email" type="email" value={email ?? ''} readOnly />
                  </div>
                </section>
                <CarrierPreferences value={values.defaultCarrier} onChange={(value) => update('defaultCarrier', value)} />
              </div>
              <section className="pf-card pf-notifications" aria-labelledby="pf-notifications">
                <h2 id="pf-notifications">Shipment emails</h2>
                <p>Choose which updates land in your inbox.</p>
                <div className="pf-notifications__controls">
                  <NotificationSwitch id="profile-arrivals" label="Arrival reminders" help="Email reminders for shipments due within your alert window."
                    checked={values.arrivalReminders} onChange={(value) => update('arrivalReminders', value)} />
                  <NotificationSwitch id="profile-eta-updates" label="ETA changes" help="Email when a carrier reports a changed arrival date."
                    checked={values.etaUpdates} onChange={(value) => update('etaUpdates', value)} />
                  <div className="pf-fields pf-notification-fields">
                    <ProfileField {...field('alertEmail')} label="Alert email" type="email" autoComplete="email" required={hasEmails} disabled={!hasEmails} />
                    <ProfileField {...field('alertDays')} label="Alert window (days)" type="number" min="1" max="30" step="1"
                      required={values.arrivalReminders} disabled={!values.arrivalReminders} descriptionId="pf-email-window" />
                  </div>
                  <p className="pf-notifications__note" id="pf-email-window">
                    {hasEmails ? 'The alert window applies to arrival reminders only.' : 'Shipment emails are turned off.'}
                  </p>
                </div>
              </section>
            </fieldset>
            <SaveBar state={saveState} dirty={dirty} disabled={signingOut || saveState === 'saving'} error={error} />
          </form>}

      <section className="pf-card pf-session" aria-labelledby="pf-session">
        <div><h2 id="pf-session">Sign out</h2><p>End your session on this device. Your shipments and settings will be kept.</p>
          {signOutError && <p className="pf-error" role="alert">{signOutError}</p>}</div>
        <button type="button" className="st-secondary pf-signout" disabled={signingOut || saveState === 'saving'} onClick={endSession}>
          <Icon icon="solar:logout-2-linear" width="18" height="18" aria-hidden="true" />
          {signingOut ? 'Signing out...' : 'Sign out'}
        </button>
      </section>
    </main>
  )
}

export default function Profile() {
  const { currentUser, signOut } = useAuth()
  if (!currentUser) return null
  return <AccountHub key={currentUser.uid} user={currentUser} signOut={signOut} />
}

import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from '../../firebase'
import useAuth from '../hooks/useAuth'

const initialValues = {
  displayName: '',
  alertEmail: '',
  alertDays: '14',
}

function validate(values) {
  const nextErrors = {}

  if (!values.displayName.trim()) {
    nextErrors.displayName = 'Display name is required.'
  }

  if (!values.alertEmail.trim()) {
    nextErrors.alertEmail = 'Alert email is required.'
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.alertEmail.trim())) {
    nextErrors.alertEmail = 'Enter a valid email address.'
  }

  const alertDays = Number(values.alertDays)

  if (!values.alertDays) {
    nextErrors.alertDays = 'Alert window is required.'
  } else if (!Number.isInteger(alertDays)) {
    nextErrors.alertDays = 'Alert window must be a whole number.'
  } else if (alertDays < 1 || alertDays > 30) {
    nextErrors.alertDays = 'Alert window must be between 1 and 30 days.'
  }

  return nextErrors
}

function Profile() {
  const navigate = useNavigate()
  const { currentUser, signOut } = useAuth()
  const [values, setValues] = useState(initialValues)
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [successToast, setSuccessToast] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const toastTimeoutRef = useRef(null)

  useEffect(() => {
    if (!currentUser?.uid) {
      setIsLoading(false)
      return undefined
    }

    let isMounted = true

    async function loadProfile() {
      setIsLoading(true)
      setFormError('')

      try {
        const userSnapshot = await getDoc(doc(db, 'users', currentUser.uid))
        const userData = userSnapshot.exists() ? userSnapshot.data() : {}

        if (!isMounted) {
          return
        }

        setValues({
          displayName:
            userData.name?.trim() || currentUser.displayName?.trim() || '',
          alertEmail:
            userData.alertEmail?.trim() || userData.email?.trim() || currentUser.email || '',
          alertDays:
            String(
              userData.alertDays === undefined || userData.alertDays === null
                ? 14
                : userData.alertDays,
            ),
        })
      } catch (loadError) {
        console.error('Failed to load profile settings.', loadError)

        if (isMounted) {
          setFormError('Unable to load your profile right now. Please try again.')
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    loadProfile()

    return () => {
      isMounted = false

      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current)
      }
    }
  }, [currentUser?.uid, currentUser?.displayName, currentUser?.email])

  const handleChange = (field) => (event) => {
    const nextValue = event.target.value

    setValues((currentValues) => ({
      ...currentValues,
      [field]: nextValue,
    }))

    setErrors((currentErrors) => {
      if (!currentErrors[field]) {
        return currentErrors
      }

      const nextErrors = { ...currentErrors }
      delete nextErrors[field]
      return nextErrors
    })
  }

  const handleSave = async (event) => {
    event.preventDefault()

    const nextErrors = validate(values)
    setErrors(nextErrors)

    if (Object.keys(nextErrors).length > 0) {
      return
    }

    if (!currentUser?.uid) {
      setFormError('You must be signed in to update your profile.')
      return
    }

    setIsSaving(true)
    setFormError('')

    try {
      await setDoc(
        doc(db, 'users', currentUser.uid),
        {
          name: values.displayName.trim(),
          email: currentUser.email ?? '',
          alertEmail: values.alertEmail.trim(),
          alertDays: Number(values.alertDays),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      )

      setSuccessToast('Profile saved successfully.')

      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current)
      }

      toastTimeoutRef.current = setTimeout(() => {
        setSuccessToast('')
        toastTimeoutRef.current = null
      }, 3000)
    } catch (saveError) {
      console.error('Failed to save profile settings.', saveError)
      setFormError('Your profile could not be saved. Please try again.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleSignOut = async () => {
    setFormError('')
    setIsSigningOut(true)

    try {
      await signOut()
      navigate('/login', { replace: true })
    } catch (signOutError) {
      console.error('Sign-out failed.', signOutError)
      setFormError('Sign-out failed. Please try again.')
      setIsSigningOut(false)
    }
  }

  const avatarInitial = (
    currentUser?.displayName?.[0] ??
    currentUser?.email?.[0] ??
    'S'
  ).toUpperCase()

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      {successToast ? (
        <div className="fixed top-4 right-4 z-50 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700 shadow-lg dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100">
          {successToast}
        </div>
      ) : null}

      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium tracking-[0.24em] text-sky-600 uppercase dark:text-sky-200">
              ShipTrack
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950 dark:text-white">
              Profile & settings
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">
              Manage your alert preferences and keep your shipment notifications pointed at the right inbox.
            </p>
          </div>

          <Link
            to="/dashboard"
            className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-100 dark:hover:bg-white/10"
          >
            Back to dashboard
          </Link>
        </div>

        <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
          <section className="rounded-[2rem] border border-slate-200/80 bg-white/90 p-6 shadow-xl shadow-slate-900/5 backdrop-blur dark:border-white/10 dark:bg-slate-950/70 dark:shadow-black/20 sm:p-8">
            <p className="text-sm font-medium text-slate-900 dark:text-white">
              Google account
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-300">
              These details come from your signed-in Google account and are shown here as read-only reference.
            </p>

            <div className="mt-6 flex items-center gap-4 rounded-3xl border border-slate-200/70 bg-slate-50/80 p-5 dark:border-white/10 dark:bg-white/5">
              {currentUser?.photoURL ? (
                <img
                  src={currentUser.photoURL}
                  alt={currentUser.displayName ?? 'Google profile avatar'}
                  className="h-16 w-16 rounded-full object-cover"
                />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-950 text-lg font-semibold text-white dark:bg-white dark:text-slate-950">
                  {avatarInitial}
                </div>
              )}

              <div className="min-w-0">
                <p className="truncate text-lg font-semibold text-slate-950 dark:text-white">
                  {currentUser?.displayName ?? 'Google account'}
                </p>
                <p className="truncate text-sm text-slate-500 dark:text-slate-300">
                  {currentUser?.email ?? 'No email available'}
                </p>
              </div>
            </div>

            <div className="mt-6 grid gap-4">
              <div className="rounded-3xl border border-slate-200/70 bg-slate-50/80 p-5 dark:border-white/10 dark:bg-white/5">
                <p className="text-xs font-medium tracking-[0.24em] text-slate-500 uppercase dark:text-slate-400">
                  Account UID
                </p>
                <p className="mt-3 break-all text-sm text-slate-700 dark:text-slate-200">
                  {currentUser?.uid ?? 'Unavailable'}
                </p>
              </div>
            </div>
          </section>

          <section className="rounded-[2rem] border border-slate-200/80 bg-white/90 p-6 shadow-xl shadow-slate-900/5 backdrop-blur dark:border-white/10 dark:bg-slate-950/70 dark:shadow-black/20 sm:p-8">
            {isLoading ? (
              <div className="flex min-h-80 items-center justify-center text-sm text-slate-500 dark:text-slate-300">
                Loading your settings...
              </div>
            ) : (
              <form className="space-y-6" onSubmit={handleSave} noValidate>
                <div>
                  <p className="text-sm font-medium text-slate-900 dark:text-white">
                    Alert settings
                  </p>
                  <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-300">
                    Control the display name shown in ShipTrack and where arrival alerts are sent.
                  </p>
                </div>

                {formError ? (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100">
                    {formError}
                  </div>
                ) : null}

                <label className="flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                  Display name
                  <input
                    type="text"
                    value={values.displayName}
                    onChange={handleChange('displayName')}
                    className={`rounded-2xl border bg-white px-4 py-3 text-sm text-slate-950 outline-none transition dark:bg-slate-900 dark:text-white ${
                      errors.displayName
                        ? 'border-rose-300 focus:border-rose-400 focus:ring-2 focus:ring-rose-100 dark:border-rose-500/40 dark:focus:ring-rose-500/20'
                        : 'border-slate-200 focus:border-sky-400 focus:ring-2 focus:ring-sky-200 dark:border-white/10 dark:focus:ring-sky-500/20'
                    }`}
                    placeholder="Your name in ShipTrack"
                  />
                  {errors.displayName ? (
                    <span className="text-xs text-rose-600 dark:text-rose-200">
                      {errors.displayName}
                    </span>
                  ) : null}
                </label>

                <label className="flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                  Alert email address
                  <input
                    type="email"
                    value={values.alertEmail}
                    onChange={handleChange('alertEmail')}
                    className={`rounded-2xl border bg-white px-4 py-3 text-sm text-slate-950 outline-none transition dark:bg-slate-900 dark:text-white ${
                      errors.alertEmail
                        ? 'border-rose-300 focus:border-rose-400 focus:ring-2 focus:ring-rose-100 dark:border-rose-500/40 dark:focus:ring-rose-500/20'
                        : 'border-slate-200 focus:border-sky-400 focus:ring-2 focus:ring-sky-200 dark:border-white/10 dark:focus:ring-sky-500/20'
                    }`}
                    placeholder="alerts@company.com"
                  />
                  {errors.alertEmail ? (
                    <span className="text-xs text-rose-600 dark:text-rose-200">
                      {errors.alertEmail}
                    </span>
                  ) : null}
                </label>

                <label className="flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                  Alert window in days
                  <input
                    type="number"
                    min="1"
                    max="30"
                    step="1"
                    value={values.alertDays}
                    onChange={handleChange('alertDays')}
                    className={`rounded-2xl border bg-white px-4 py-3 text-sm text-slate-950 outline-none transition dark:bg-slate-900 dark:text-white ${
                      errors.alertDays
                        ? 'border-rose-300 focus:border-rose-400 focus:ring-2 focus:ring-rose-100 dark:border-rose-500/40 dark:focus:ring-rose-500/20'
                        : 'border-slate-200 focus:border-sky-400 focus:ring-2 focus:ring-sky-200 dark:border-white/10 dark:focus:ring-sky-500/20'
                    }`}
                  />
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    ShipTrack will use this window when deciding when to send arrival reminders.
                  </span>
                  {errors.alertDays ? (
                    <span className="text-xs text-rose-600 dark:text-rose-200">
                      {errors.alertDays}
                    </span>
                  ) : null}
                </label>

                <div className="flex justify-end border-t border-slate-200 pt-6 dark:border-white/10">
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="inline-flex items-center justify-center rounded-2xl bg-slate-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"
                  >
                    {isSaving ? 'Saving...' : 'Save settings'}
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>

        <section className="rounded-[2rem] border border-rose-200/80 bg-rose-50/80 p-6 shadow-xl shadow-slate-900/5 backdrop-blur dark:border-rose-500/30 dark:bg-rose-500/10 dark:shadow-black/20 sm:p-8">
          <p className="text-sm font-medium text-rose-700 dark:text-rose-100">
            Danger zone
          </p>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-rose-700/90 dark:text-rose-100/90">
            Signing out ends your current ShipTrack session on this device.
          </p>

          <div className="mt-5">
            <button
              type="button"
              onClick={handleSignOut}
              disabled={isSigningOut}
              className="inline-flex items-center justify-center rounded-2xl border border-rose-200 bg-white px-4 py-3 text-sm font-medium text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-70 dark:border-rose-500/30 dark:bg-slate-950/60 dark:text-rose-100 dark:hover:bg-rose-500/15"
            >
              {isSigningOut ? 'Signing out...' : 'Sign out'}
            </button>
          </div>
        </section>
      </div>
    </main>
  )
}

export default Profile

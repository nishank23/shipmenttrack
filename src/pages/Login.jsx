import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import useAuth from '../hooks/useAuth'

function Login() {
  const { configError, currentUser, loading, signInWithGoogle } = useAuth()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')

  if (!loading && currentUser) {
    return <Navigate to="/dashboard" replace />
  }

  const handleSignIn = async () => {
    setError('')
    setIsSubmitting(true)

    try {
      await signInWithGoogle()
    } catch (signInError) {
      console.error('Google sign-in failed.', signInError)
      setError('Google sign-in failed. Check your Firebase setup and try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="grid min-h-screen place-items-center px-6 py-16">
      <section className="w-full max-w-md rounded-[2rem] border border-slate-200/80 bg-white/90 p-8 shadow-2xl shadow-slate-950/8 backdrop-blur dark:border-white/10 dark:bg-slate-950/75 dark:shadow-black/20 sm:p-10">
        <div className="mx-auto flex w-fit items-center gap-3 rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-base font-semibold text-slate-900 dark:border-white/10 dark:bg-white/5 dark:text-white">
          <span className="text-2xl" aria-hidden="true">
            🚢
          </span>
          <span>ShipTrack</span>
        </div>

        <div className="mt-8 text-center">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950 dark:text-white">
            Track your shipments. Get alerts before they arrive.
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
            Sign in with Google to keep your deliveries, reminders, and shipment
            alerts synced across sessions.
          </p>
        </div>

        {configError ? (
          <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
            Firebase is not configured yet. Create a local
            <code className="mx-1 rounded bg-white px-1.5 py-0.5 text-amber-900 dark:bg-slate-950 dark:text-amber-100">
              .env
            </code>
            from
            <code className="mx-1 rounded bg-white px-1.5 py-0.5 text-amber-900 dark:bg-slate-950 dark:text-amber-100">
              .env.example
            </code>
            and add your
            <code className="mx-1 rounded bg-white px-1.5 py-0.5 text-amber-900 dark:bg-slate-950 dark:text-amber-100">
              VITE_FIREBASE_*
            </code>
            keys.
          </div>
        ) : null}

        <button
          type="button"
          onClick={handleSignIn}
          disabled={loading || isSubmitting || Boolean(configError)}
          className="mt-10 inline-flex w-full items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-slate-950 px-5 py-4 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70 dark:border-white/10 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"
        >
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white text-slate-950 dark:bg-slate-950 dark:text-white">
            G
          </span>
          {loading
            ? 'Checking session...'
            : isSubmitting
              ? 'Signing in...'
              : 'Sign in with Google'}
        </button>

        {error ? (
          <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100">
            {error}
          </div>
        ) : null}
      </section>
    </main>
  )
}

export default Login

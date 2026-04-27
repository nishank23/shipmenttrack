import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import useAuth from '../hooks/useAuth'

const valueTiles = [
  {
    label: 'ETA focus',
    value: '6 days',
    detail: 'Next arrival window',
  },
  {
    label: 'Alert email',
    value: 'Ready',
    detail: 'Inbox configured',
  },
  {
    label: 'Records',
    value: 'Invoice + B/L',
    detail: 'Carrier and ETA saved',
  },
]

const alertPreview = [
  {
    label: 'Email',
    value: 'alerts@company.com',
  },
  {
    label: 'Window',
    value: '14 days before ETA',
  },
  {
    label: 'Focus',
    value: 'Upcoming arrivals',
  },
]

function GoogleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5">
      <path
        d="M21.805 12.23c0-.75-.067-1.47-.193-2.16H12v4.09h5.498a4.704 4.704 0 0 1-2.037 3.086v2.56h3.297c1.93-1.777 3.047-4.397 3.047-7.576Z"
        fill="#4285F4"
      />
      <path
        d="M12 22c2.76 0 5.074-.915 6.765-2.474l-3.297-2.56c-.916.615-2.087.979-3.468.979-2.665 0-4.92-1.799-5.726-4.217H2.866v2.643A10 10 0 0 0 12 22Z"
        fill="#34A853"
      />
      <path
        d="M6.274 13.728A5.99 5.99 0 0 1 5.954 12c0-.6.11-1.181.32-1.728V7.63H2.866A9.998 9.998 0 0 0 2 12c0 1.61.385 3.131 1.066 4.37l3.208-2.642Z"
        fill="#FBBC04"
      />
      <path
        d="M12 6.055c1.502 0 2.85.517 3.911 1.532l2.934-2.934C17.07 2.997 14.756 2 12 2a10 10 0 0 0-9.134 5.63l3.408 2.642C7.08 7.854 9.335 6.055 12 6.055Z"
        fill="#EA4335"
      />
    </svg>
  )
}

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
    <main className="login-stage relative isolate h-dvh overflow-hidden bg-slate-50 text-slate-950 dark:bg-[#050914] dark:text-white">
      <div className="login-grid-bg absolute inset-0" />
      <div className="login-sweep absolute inset-0" />

      <section className="relative mx-auto grid h-full max-w-7xl grid-rows-[auto_1fr] gap-3 px-4 py-3 sm:px-6 sm:py-5 lg:grid-cols-[0.86fr_1.14fr] lg:grid-rows-1 lg:items-stretch lg:gap-5">
        <div className="login-panel flex min-h-0 flex-col justify-between overflow-hidden rounded-3xl border border-slate-200 bg-white/90 p-4 shadow-2xl shadow-slate-950/10 backdrop-blur dark:border-white/10 dark:bg-slate-950/[0.78] dark:shadow-cyan-950/25 sm:p-5 lg:h-full">
          <div className="relative">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase text-cyan-700 dark:text-cyan-200">
                  ShipTrack
                </p>
                <h1 className="mt-1 text-3xl font-bold tracking-normal text-slate-950 dark:text-white sm:text-4xl lg:text-5xl">
                  ETAs. Alerts. Done.
                </h1>
              </div>

              <div className="login-pulse-ring flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-sm font-bold text-white dark:bg-cyan-300 dark:text-slate-950">
                ETA
              </div>
            </div>

            <p className="mt-3 max-w-lg text-sm leading-6 text-slate-600 dark:text-slate-300 sm:text-base">
              Save shipment details, watch arrival dates, and send reminder emails to
              the right inbox before a shipment reaches its ETA.
            </p>

            <div className="login-extra mt-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
              {valueTiles.map((tile) => (
                <div
                  key={tile.label}
                  className="login-stat rounded-2xl border border-slate-200 bg-slate-50/90 p-3 dark:border-white/10 dark:bg-white/[0.06]"
                >
                  <p className="text-[0.68rem] font-semibold uppercase text-slate-500 dark:text-slate-400">
                    {tile.label}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-slate-950 dark:text-white">
                    {tile.value}
                  </p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {tile.detail}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="relative mt-3">
            {configError ? (
              <div
                role="alert"
                className="mb-3 rounded-2xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 dark:border-amber-300/25 dark:bg-amber-300/10 dark:text-amber-100"
              >
                Firebase needs local
                <code className="mx-1 rounded bg-white px-1 py-0.5 dark:bg-slate-950">
                  .env
                </code>
                keys from
                <code className="mx-1 rounded bg-white px-1 py-0.5 dark:bg-slate-950">
                  .env.example
                </code>
                .
              </div>
            ) : null}

            <button
              type="button"
              onClick={handleSignIn}
              disabled={loading || isSubmitting || Boolean(configError)}
              className="login-google-button inline-flex w-full items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-slate-950 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-slate-950/15 transition duration-200 hover:-translate-y-0.5 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:border-cyan-200/30 dark:bg-cyan-300 dark:text-slate-950 dark:shadow-cyan-400/15 dark:hover:bg-cyan-200 sm:py-4"
            >
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white shadow-sm">
                <GoogleIcon />
              </span>
              {loading
                ? 'Checking session...'
                : isSubmitting
                  ? 'Signing in...'
                  : 'Continue with Google'}
            </button>

            {error ? (
              <div
                role="alert"
                className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-400/25 dark:bg-rose-400/10 dark:text-rose-100"
              >
                {error}
              </div>
            ) : null}
          </div>
        </div>

        <div className="login-dashboard relative min-h-0 overflow-hidden rounded-3xl border border-slate-200 bg-white/[0.86] p-3 shadow-2xl shadow-slate-950/10 backdrop-blur dark:border-white/10 dark:bg-slate-950/[0.72] dark:shadow-cyan-950/25 sm:p-4 lg:h-full">
          <div className="login-scanline absolute inset-x-0 top-0 h-px bg-cyan-300/90" />

          <div className="relative flex h-full min-h-0 flex-col gap-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase text-cyan-700 dark:text-cyan-200">
                  ETA board
                </p>
                <h2 className="mt-1 text-2xl font-bold tracking-normal text-slate-950 dark:text-white sm:text-3xl">
                  What ShipTrack does
                </h2>
              </div>
              <span className="rounded-2xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 dark:border-emerald-300/25 dark:bg-emerald-300/10 dark:text-emerald-200">
                Next ETA in 6 days
              </span>
            </div>

            <div className="login-route relative min-h-[150px] flex-1 overflow-hidden rounded-2xl border border-slate-200 bg-slate-950 p-4 text-white shadow-inner shadow-black/30 dark:border-white/10 sm:min-h-[190px]">
              <div className="login-route-glow absolute inset-0" />
              <div className="relative flex h-full min-h-[128px] items-center">
                <div className="login-route-track absolute left-[8%] right-[8%] top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/15" />
                <div className="login-route-fill absolute left-[8%] top-1/2 h-1 w-[68%] -translate-y-1/2 rounded-full bg-cyan-300" />
                <div className="login-route-dot absolute left-[8%] top-1/2 h-5 w-5 -translate-y-1/2 rounded-full border-4 border-slate-950 bg-emerald-300 shadow-[0_0_24px_rgba(110,231,183,0.9)]" />
                <div className="login-route-dot login-route-dot-mid absolute left-[54%] top-1/2 h-5 w-5 -translate-y-1/2 rounded-full border-4 border-slate-950 bg-amber-300 shadow-[0_0_24px_rgba(252,211,77,0.8)]" />
                <div className="login-route-dot absolute right-[8%] top-1/2 h-5 w-5 -translate-y-1/2 rounded-full border-4 border-slate-950 bg-rose-300 shadow-[0_0_24px_rgba(253,164,175,0.85)]" />

                <div className="absolute left-[4%] top-4 rounded-2xl border border-white/10 bg-white/10 px-3 py-2 backdrop-blur">
                  <p className="text-[0.65rem] font-semibold uppercase text-slate-300">
                    Shipment
                  </p>
                  <p className="mt-1 text-sm font-semibold">INV-2048</p>
                </div>

                <div className="absolute right-[4%] bottom-4 rounded-2xl border border-cyan-200/20 bg-cyan-200/10 px-3 py-2 backdrop-blur">
                  <p className="text-[0.65rem] font-semibold uppercase text-cyan-100">
                    ETA
                  </p>
                  <p className="mt-1 text-sm font-semibold">May 4, 2026</p>
                </div>
              </div>
            </div>

            <div className="grid min-h-0 gap-3 md:grid-cols-[0.92fr_1.08fr]">
              <div className="rounded-2xl border border-slate-200 bg-slate-50/90 p-3 dark:border-white/10 dark:bg-white/[0.06]">
                <p className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                  Shipment details
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">B/L</p>
                    <p className="font-semibold text-slate-950 dark:text-white">OOLU918287</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">Carrier</p>
                    <p className="font-semibold text-slate-950 dark:text-white">MSC</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">Status</p>
                    <p className="font-semibold text-amber-700 dark:text-amber-200">
                      Arriving soon
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">Reminder</p>
                    <p className="font-semibold text-emerald-700 dark:text-emerald-200">
                      Email queued
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50/90 p-3 dark:border-white/10 dark:bg-white/[0.06]">
                <p className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                  Arrival email settings
                </p>
                <div className="mt-3 grid gap-2">
                  {alertPreview.map((item) => (
                    <div
                      key={item.label}
                      className="flex items-center justify-between gap-3 rounded-xl bg-white px-3 py-2 text-sm dark:bg-slate-950/60"
                    >
                      <span className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                        {item.label}
                      </span>
                      <span className="truncate font-semibold text-slate-950 dark:text-white">
                        {item.value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}

export default Login

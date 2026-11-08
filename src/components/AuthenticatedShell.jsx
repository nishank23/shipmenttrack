import { Suspense, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
import { AnimatePresence, LayoutGroup, MotionConfig, motion as Motion, useIsPresent, useReducedMotion } from 'motion/react'
import { Link, NavLink, matchPath, useLocation, useNavigate, useOutlet } from 'react-router-dom'
import useAuth from '../hooks/useAuth'
import { getPageMotion, layoutTransition } from '../lib/motion'

const tabs = [
  { path: '/dashboard', label: 'Dashboard' },
  { path: '/archive', label: 'Archive' },
  { path: '/profile', label: 'Profile' },
]

function BrandMark() {
  return (
    <svg className="st-command__mark" viewBox="0 0 32 32" width="26" height="26" aria-hidden="true">
      <rect x="2" y="8" width="28" height="16" rx="2" fill="currentColor" />
      <path
        d="M8 11v10M13 11v10M18 11v10M23 11v10"
        className="st-command__mark-lines"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

function ReadyWorkspacePage({
  children, pathname, isPresent, lastPresentedPathRef, focusTrackingRef, reducedMotion,
}) {
  const contentRef = useRef(null)

  useLayoutEffect(() => {
    if (!isPresent) return

    const previousPath = lastPresentedPathRef.current
    lastPresentedPathRef.current = pathname
    const changedScreen = previousPath !== null && previousPath !== pathname
    const field = focusTrackingRef.current && matchPath('/add', pathname)
      ? contentRef.current?.querySelector('#shipment-bl-number')
      : null
    focusTrackingRef.current = false

    if (changedScreen) window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
    if (field || changedScreen) (field ?? contentRef.current)?.focus({ preventScroll: true })
  }, [isPresent, lastPresentedPathRef, focusTrackingRef, pathname])

  return (
    <Motion.div
      id="workspace-content"
      ref={contentRef}
      className="st-page"
      role="region"
      aria-label="Workspace content"
      tabIndex={-1}
      inert={!isPresent}
      {...getPageMotion(reducedMotion)}
    >
      {children}
    </Motion.div>
  )
}

function WorkspacePage({ loadingLabel, ...pageProps }) {
  const isPresent = useIsPresent()

  return (
    <Suspense fallback={isPresent ? <div className="st-route-status" role="status">{loadingLabel}</div> : null}>
      <ReadyWorkspacePage {...pageProps} isPresent={isPresent} />
    </Suspense>
  )
}

function AuthenticatedShell({ warmRoute }) {
  const { currentUser, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const outlet = useOutlet()
  const reducedMotion = useReducedMotion()
  const lastPresentedPathRef = useRef(null)
  const focusTrackingRef = useRef(false)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState('')
  const { pathname } = location
  const currentTab = tabs.find(({ path }) => matchPath(path, pathname))
  const isAddRoute = Boolean(matchPath('/add', pathname))
  const activeTab = currentTab?.path ??
    (matchPath('/shipments/:shipmentId', pathname) && location.state?.fromArchive
      ? '/archive'
      : '/dashboard')
  const displayName = currentUser?.displayName || currentUser?.email || 'ShipTrack user'
  const appleKeyboard = /Mac|iPhone|iPad|iPod/i.test(navigator.userAgentData?.platform || navigator.platform)
  const shortcut = appleKeyboard ? '⌘K' : 'Ctrl+K'
  const loadingLabel = currentTab ? `Opening ${currentTab.label.toLowerCase()}…`
    : isAddRoute ? 'Opening shipment form…' : 'Opening shipment…'

  useEffect(() => {
    warmRoute(pathname)
  }, [pathname, warmRoute])

  function trackShipment(focusOnOpen) {
    if (isAddRoute) {
      const field = document.querySelector('#workspace-content:not([inert]) #shipment-bl-number')
      if (field) field.focus()
      else focusTrackingRef.current = true
      return
    }

    focusTrackingRef.current = focusOnOpen
    warmRoute('/add')
    navigate('/add')
  }

  const handleShortcut = useEffectEvent((event) => {
    if (event.defaultPrevented || event.repeat || event.isComposing ||
        event.shiftKey || event.altKey || event.metaKey === event.ctrlKey ||
        event.key.toLowerCase() !== 'k') return

    if (event.target instanceof Element &&
        (event.target.isContentEditable || event.target.closest('input, textarea, select, [role="textbox"]'))) return

    event.preventDefault()
    trackShipment(true)
  })

  useEffect(() => {
    const onKeyDown = (event) => handleShortcut(event)
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  async function handleSignOut() {
    setSignOutError('')
    setIsSigningOut(true)
    try {
      await signOut()
    } catch (error) {
      console.error('Sign-out failed.', error)
      setSignOutError('Sign-out failed. Try again.')
    } finally {
      setIsSigningOut(false)
    }
  }

  return (
    <MotionConfig reducedMotion="user">
      <div className="st-workspace">
        <a
          className="st-skip-link st-primary"
          href="#workspace-content"
          onClick={(event) => {
            const content = document.getElementById('workspace-content')
            if (!content || content.inert) return
            event.preventDefault()
            content.focus()
          }}
        >
          Skip to content
        </a>

        <header className="st-command">
          <Link
            to="/dashboard"
            className="st-command__brand"
            onPointerEnter={() => warmRoute('/dashboard')}
            onFocus={() => warmRoute('/dashboard')}
          >
            <BrandMark />
            ShipTrack
          </Link>

          <nav className="st-command__tabs" aria-label="Main navigation">
            <LayoutGroup id="workspace-tabs">
              {tabs.map(({ path, label }) => (
                <NavLink
                  key={path}
                  to={path}
                  end
                  className="st-command__tab"
                  data-active={activeTab === path ? '' : undefined}
                  onPointerEnter={() => warmRoute(path)}
                  onFocus={() => warmRoute(path)}
                >
                  {activeTab === path ? (
                    <Motion.span
                      className="st-command__pill"
                      aria-hidden="true"
                      layoutId={reducedMotion ? undefined : 'active-tab'}
                      transition={layoutTransition}
                    />
                  ) : null}
                  <span className="st-command__label">{label}</span>
                </NavLink>
              ))}
            </LayoutGroup>
          </nav>

          <div className="st-command__actions">
            <button
              type="button"
              className="st-command__track st-primary"
              aria-keyshortcuts="Meta+K Control+K"
              onPointerEnter={() => warmRoute('/add')}
              onFocus={() => warmRoute('/add')}
              onClick={() => trackShipment(false)}
            >
              <span className="st-command__icon" aria-hidden="true">
                <Icon icon="solar:add-circle-linear" width="17" height="17" />
              </span>
              Track Shipment
              <kbd className="st-command__shortcut" aria-hidden="true">{shortcut}</kbd>
            </button>

            <div className="st-command__account">
              {currentUser?.photoURL ? (
                <img
                  className="st-command__avatar"
                  src={currentUser.photoURL}
                  alt={displayName}
                  title={displayName}
                  referrerPolicy="no-referrer"
                  onError={(event) => { event.currentTarget.hidden = true }}
                />
              ) : null}
              <button
                type="button"
                className="st-command__signout"
                aria-label={isSigningOut ? 'Signing out' : 'Sign out'}
                title="Sign out"
                disabled={isSigningOut}
                onClick={handleSignOut}
              >
                <Icon icon="solar:logout-2-linear" width="19" height="19" aria-hidden="true" />
              </button>
            </div>
          </div>
        </header>

        {signOutError ? <p className="st-command-error" role="alert">{signOutError}</p> : null}

        <AnimatePresence mode="wait" initial={false}>
          <WorkspacePage
            key={pathname}
            pathname={pathname}
            lastPresentedPathRef={lastPresentedPathRef}
            focusTrackingRef={focusTrackingRef}
            loadingLabel={loadingLabel}
            reducedMotion={reducedMotion}
          >
            {outlet}
          </WorkspacePage>
        </AnimatePresence>
      </div>
    </MotionConfig>
  )
}

export default AuthenticatedShell

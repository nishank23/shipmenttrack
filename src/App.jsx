import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, matchPath } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'

const AuthenticatedShell = lazy(() => import('./components/AuthenticatedShell'))
const Login = lazy(() => import('./pages/Login'))

const workspaceRoutes = [
  [['/dashboard'], () => import('./pages/Dashboard')],
  [['/archive'], () => import('./pages/Archive')],
  [['/profile'], () => import('./pages/Profile')],
  [['/shipments/:shipmentId'], () => import('./pages/ShipmentDetail')],
  [['/add', '/edit/:shipmentId', '/shipments/:shipmentId/edit'], () => import('./pages/ShipmentForm')],
].flatMap(([paths, load]) => {
  let request
  const preload = () => (request ??= load().catch((error) => {
    request = undefined
    throw error
  }))
  const Screen = lazy(preload)

  return paths.map((path) => ({ path, element: <Screen />, preload }))
})

function warmWorkspaceRoute(pathname) {
  const route = workspaceRoutes.find(({ path }) => matchPath(path, pathname))
  route?.preload().catch(() => {})
}

function ScreenFallback() {
  return (
    <div className="st-screen-status st-screen-status--full" role="status">
      Loading ShipTrack…
    </div>
  )
}

function App() {
  return (
    <Suspense fallback={<ScreenFallback />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Login />} />

        <Route element={<ProtectedRoute />}>
          <Route element={<AuthenticatedShell warmRoute={warmWorkspaceRoute} />}>
            {workspaceRoutes.map(({ path, element }) => (
              <Route key={path} path={path} element={element} />
            ))}
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}

export default App

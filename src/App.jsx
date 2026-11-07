import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'

// Each screen loads on demand, so the landing page does not ship the app.
const Archive = lazy(() => import('./pages/Archive'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Login = lazy(() => import('./pages/Login'))
const Profile = lazy(() => import('./pages/Profile'))
const ShipmentDetail = lazy(() => import('./pages/ShipmentDetail'))
const ShipmentForm = lazy(() => import('./pages/ShipmentForm'))

function ScreenFallback() {
  return <div className="min-h-screen bg-slate-50 dark:bg-[#06101f]" aria-busy="true" />
}

function App() {
  return (
    <Suspense fallback={<ScreenFallback />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Login />} />

        <Route element={<ProtectedRoute />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/archive" element={<Archive />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/add" element={<ShipmentForm />} />
          <Route path="/edit/:shipmentId" element={<ShipmentForm />} />
          <Route path="/shipments/:shipmentId" element={<ShipmentDetail />} />
          <Route path="/shipments/:shipmentId/edit" element={<ShipmentForm />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}

export default App

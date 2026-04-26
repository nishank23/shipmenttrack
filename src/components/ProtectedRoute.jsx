import { Navigate, Outlet, useLocation } from 'react-router-dom'
import useAuth from '../hooks/useAuth'

function ProtectedRoute() {
  const { currentUser, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6 text-sm text-slate-300">
        Checking your ShipTrack session...
      </div>
    )
  }

  if (!currentUser) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  return <Outlet />
}

export default ProtectedRoute

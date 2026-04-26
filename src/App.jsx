import { Navigate, Route, Routes } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import Dashboard from './pages/Dashboard'
import Login from './pages/Login'
import Profile from './pages/Profile'
import ShipmentDetail from './pages/ShipmentDetail'
import ShipmentForm from './pages/ShipmentForm'

function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Navigate to="/dashboard" replace />} />

      <Route element={<ProtectedRoute />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/add" element={<ShipmentForm />} />
        <Route path="/edit/:shipmentId" element={<ShipmentForm />} />
        <Route path="/shipments/:shipmentId" element={<ShipmentDetail />} />
        <Route path="/shipments/:shipmentId/edit" element={<ShipmentForm />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App

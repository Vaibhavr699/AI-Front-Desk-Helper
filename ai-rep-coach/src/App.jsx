import { Routes, Route } from 'react-router-dom'
import Landing from './pages/Landing'
import Privacy from './pages/Privacy'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/privacy" element={<Privacy />} />
    </Routes>
  )
}

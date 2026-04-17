import { Routes, Route } from 'react-router-dom'
import Home from './Home'
import QRForge from './QRForge'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/qr" element={<QRForge />} />
    </Routes>
  )
}

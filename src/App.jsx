import { Routes, Route } from 'react-router-dom'
import Home from './Home'
import QRForge from './QRForge'
import FoldPress from './FoldPress'
import FoldForm from './FoldForm'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/qr" element={<QRForge />} />
      <Route path="/fold" element={<FoldPress />} />
      <Route path="/foldform" element={<FoldForm />} />
    </Routes>
  )
}

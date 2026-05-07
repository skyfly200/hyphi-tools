import { Routes, Route } from 'react-router-dom'
import Home from './Home'
import QRForge from './QRForge'
import FoldPress from './FoldPress'
import FoldForm from './FoldForm'
import FoldStudio from './FoldStudio'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/qr" element={<QRForge />} />
      <Route path="/fold" element={<FoldPress />} />
      <Route path="/foldform" element={<FoldForm />} />
      <Route path="/foldstudio" element={<FoldStudio />} />
    </Routes>
  )
}

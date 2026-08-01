import { Routes, Route } from 'react-router-dom'
import Home from './Home'
import QRForge from './QRForge'
import FoldPress from './FoldPress'
import FoldForm from './FoldForm'
import FoldStudio from './FoldStudio'
import FoldStudioDocs from './FoldStudioDocs'
import PolyForge from './PolyForge'
import HarnessCalculator from './HarnessCalculator'
import LinksDashboard from './LinksDashboard'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/qr" element={<QRForge />} />
      <Route path="/fold" element={<FoldPress />} />
      <Route path="/foldform" element={<FoldForm />} />
      <Route path="/foldstudio" element={<FoldStudio />} />
      <Route path="/foldstudio/docs" element={<FoldStudioDocs />} />
      <Route path="/polyforge" element={<PolyForge />} />
      <Route path="/harness" element={<HarnessCalculator />} />
      <Route path="/links" element={<LinksDashboard />} />
    </Routes>
  )
}

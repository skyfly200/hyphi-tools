import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import QRForge from "../QRForge/qr-generator.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <QRForge />
  </StrictMode>
);

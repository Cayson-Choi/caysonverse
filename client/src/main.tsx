import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { isTouchDevice } from "./device";
import "./index.css";

// Tag the document once (static per session) so touch-only CSS — larger tap
// targets, bottom-sheet chat, safe-area paddings — keys off `.cv-touch`.
if (isTouchDevice) document.documentElement.classList.add("cv-touch");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

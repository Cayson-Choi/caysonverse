import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./game/dracoPath";
import App from "./App";
import { isTouchDevice } from "./device";
import { prewarmSoftwareGlProbe } from "./game/gpuProbe";
import "./index.css";

// Tag the document once (static per session) so touch-only CSS — larger tap
// targets, bottom-sheet chat, safe-area paddings — keys off `.cv-touch`.
if (isTouchDevice) document.documentElement.classList.add("cv-touch");

// Ask once, while the entry screen is idle, whether WebGL is drawn in software ("자동" then picks the light tier): the
// probe makes a throwaway WebGL context (~80 ms), which would otherwise land in the entry click's frame.
prewarmSoftwareGlProbe();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

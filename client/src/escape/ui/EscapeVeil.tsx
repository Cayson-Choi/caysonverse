import type { CSSProperties } from "react";
import { ESCAPE_FX } from "../escapeTimeline";
import "../finale.css";

export type VeilMode = "idle" | "live" | "replay";

/** The CSS reads the show's own lengths, so the DOM part and the 3D part cannot drift apart. */
const TIMING = {
  "--fx-open-at": `${ESCAPE_FX.doorGlowMs}ms`,
  "--fx-lights-at": `${ESCAPE_FX.doorGlowMs + ESCAPE_FX.doorOpenMs}ms`,
  "--fx-lights-ms": `${ESCAPE_FX.lightsMs}ms`,
} as CSSProperties;

/**
 * The room's colours, and the burst of light (AI 학교 탈출, Task 20) — the part of the escape show that
 * lives in the page rather than in the 3D scene, so it costs the phone nothing but two opacity animations:
 *  - the haze: until Ari is set right the room looks a little faded and cloudy (a light grey veil over the
 *    3D view); when the lights come back (escapeTimeline: 2700 → 4200 ms) it lifts and the colours are their own;
 *  - the flash: a warm white bloom when the door swings open.
 * `idle` = the faded room, `live` = the escape is playing (the animations run once), `replay` = a player who
 * comes in after the escape (no haze, no flash). Reduced motion drops the flash and lifts the haze at once (CSS).
 * Never takes a tap.
 */
export function EscapeVeil({ mode }: { mode: VeilMode }) {
  return (
    <div className={`cv-esc-veil is-${mode}`} style={TIMING} aria-hidden="true">
      <div className="cv-esc-haze" />
      <div className="cv-esc-flash" />
    </div>
  );
}

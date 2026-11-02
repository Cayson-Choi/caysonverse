/**
 * The east gate's opening, as numbers (AI 학교 탈출, Task 15). When the teacher starts the
 * class, the gate between the central hall and the east corridor opens over GATE_OPEN_MS:
 *
 *   0 ……… 45 % ……………………… 100 %   of GATE_OPEN_MS
 *   ├─ sweep: a band of light crosses the doorway (0 → 1) ─┤
 *   ├ glow rises to its flash (1) ┤├ settles to OPEN_GLOW ─┤
 *         ├──── bars go (1 shut → 0 open), eased ─────────┤ from 20 %
 *
 * Pure and monotonic: `bars` never goes back down, `sweep` never goes back. Before the start
 * the gate is shut and dark; after the end it is open with a soft glow. `Gate.tsx` samples it
 * every frame with its own `out` object, so the frame path allocates nothing.
 */

/** How long the opening takes (ms). */
export const GATE_OPEN_MS = 1800;

/** Glow left on an open gate (0..1). */
export const OPEN_GLOW = 0.3;

/** Where (fraction of the timeline) the bars start rising, the sweep ends and the glow peaks. */
const BARS_FROM = 0.2;
const SWEEP_TO = 0.45;
const GLOW_PEAK = 0.45;

export interface GateFrame {
  /** 1 = shut … 0 = open (how far the bars still hang down). */
  bars: number;
  /** 0..1: the light band's progress across the doorway. */
  sweep: number;
  /** 0..1: emissive strength of the frame and bars. */
  glow: number;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Smooth ease in-out on [0, 1] (monotonic, 0 → 0, 1 → 1). */
function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** The gate at `elapsedMs` after the start (negative = not started). Fills `out` when given. */
export function gateTimeline(elapsedMs: number, out: GateFrame = { bars: 1, sweep: 0, glow: 0 }): GateFrame {
  if (!(elapsedMs > 0)) {
    // Not started (or exactly the start / NaN): shut and dark.
    out.bars = 1;
    out.sweep = 0;
    out.glow = 0;
    return out;
  }
  const t = clamp01(elapsedMs / GATE_OPEN_MS);
  out.bars = 1 - smooth(clamp01((t - BARS_FROM) / (1 - BARS_FROM)));
  out.sweep = smooth(clamp01(t / SWEEP_TO));
  out.glow =
    t <= GLOW_PEAK
      ? smooth(t / GLOW_PEAK)
      : 1 - (1 - OPEN_GLOW) * smooth((t - GLOW_PEAK) / (1 - GLOW_PEAK));
  return out;
}

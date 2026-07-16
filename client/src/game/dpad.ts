/**
 * First-person D-pad quantizer (pure, design 21). A single sliding touch is
 * snapped to one of 8 discrete 45° sectors and emitted as the SAME keyboard-style
 * {-1,0,1} `Intent` that `readIntent` produces — so the proven desktop FP
 * behaviour (▲ = exact-zero-δ forward, ◀ = curved turn via stepFollowYaw) is
 * reused unchanged. Two anti-chatter guards make thumb tremor invisible:
 *   - ±10° angular hysteresis: with a held sector, the touch must cross a sector
 *     boundary by MORE than 10° to transition (the industry-standard 8-way snap).
 *   - a radial dead zone with differential enter/release radii, so the pad never
 *     flickers between idle and moving at the dead-zone rim either.
 *
 * Input convention (documented for callers): `x`/`y` are the touch offset from
 * the ZONE CENTRE, normalized to the pad radius (edge of the pad = length 1;
 * larger values — a slide past the rim — are fine, only the angle matters then).
 * `y` is UP-positive, matching nipplejs' `vector.y` and therefore the shared
 * moveInput semantics (`forward = +y`); DOM clients must flip their down-positive
 * clientY before calling.
 */

import { normalizeAngle } from "./yaw";
import type { Intent } from "./input";

/** Sector index: 0 = north (▲), clockwise — 1=NE, 2=E(▶), … 7=NW. */
export type DpadSector = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** One quantized reading: the active sector (null = idle) and its intent. */
export interface DpadReading {
  sector: DpadSector | null;
  intent: Intent;
}

/**
 * Radius (fraction of the pad radius) the touch must REACH to start moving —
 * the equivalent of the joystick's force-0.15 dead-zone rule (>= moves).
 */
export const DPAD_DEAD_ZONE = 0.15;

/**
 * Radius the touch must drop BELOW to stop again once moving. Strictly inside
 * DPAD_DEAD_ZONE so a thumb resting near the rim can't chatter idle/moving.
 */
export const DPAD_DEAD_ZONE_RELEASE = 0.1;

/** A held sector releases only when the touch crosses its boundary by this much. */
export const DPAD_HYSTERESIS_RAD = (10 * Math.PI) / 180;

/** Full sector width (45°) and the half-width to a boundary (22.5°). */
const SECTOR_RAD = Math.PI / 4;
const HALF_SECTOR_RAD = Math.PI / 8;

/** Keyboard-equivalent intent per sector (diagonals set both components ±1). */
export const DPAD_SECTOR_INTENTS: ReadonlyArray<Readonly<Intent>> = [
  { forward: 1, right: 0 }, // 0 N  ▲
  { forward: 1, right: 1 }, // 1 NE ↗
  { forward: 0, right: 1 }, // 2 E  ▶
  { forward: -1, right: 1 }, // 3 SE ↘
  { forward: -1, right: 0 }, // 4 S  ▼
  { forward: -1, right: -1 }, // 5 SW ↙
  { forward: 0, right: -1 }, // 6 W  ◀
  { forward: 1, right: -1 }, // 7 NW ↖
];

/** Build a reading with a FRESH intent object (callers mutate moveInput freely). */
function reading(sector: DpadSector | null): DpadReading {
  const intent = sector === null ? { forward: 0, right: 0 } : { ...DPAD_SECTOR_INTENTS[sector] };
  return { sector, intent };
}

/**
 * Quantize one touch sample to a D-pad sector, sticky against `prevSector`.
 *
 *   - Inside the radial dead zone (enter/release differential above) → idle.
 *   - Fresh from idle (`prevSector` null) → pure nearest-sector quantization.
 *   - With a held sector → keep it while the touch stays within its half-width
 *     PLUS the 10° hysteresis margin of the sector centre; beyond that (an
 *     adjacent-boundary crossing or an outright flick across the pad),
 *     re-quantize to the nearest sector.
 */
export function quantizeDpad(x: number, y: number, prevSector: DpadSector | null): DpadReading {
  const radius = Math.hypot(x, y);
  const gate = prevSector === null ? DPAD_DEAD_ZONE : DPAD_DEAD_ZONE_RELEASE;
  if (radius < gate) return reading(null);

  // Angle clockwise from north (▲): atan2(x, y) — 0 up, +90° right, wrap-safe.
  const angle = Math.atan2(x, y);
  if (prevSector !== null) {
    const offCentre = Math.abs(normalizeAngle(angle - prevSector * SECTOR_RAD));
    if (offCentre <= HALF_SECTOR_RAD + DPAD_HYSTERESIS_RAD) return reading(prevSector);
  }
  const sector = ((((Math.round(angle / SECTOR_RAD) % 8) + 8) % 8) as DpadSector);
  return reading(sector);
}

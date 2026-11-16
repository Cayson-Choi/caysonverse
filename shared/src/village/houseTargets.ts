/**
 * What a house floor offers at a spot (집 실내 G): the way out (floor 1's `door__h<N>_exit` pad) and the stair (floor 1's up pad, floor 2's
 * down pad). Pure and browser-safe; the client's context button and the E key read it (client/src/village/villageTargets.ts), and the
 * server decides the same use from the authoritative position (server/src/rooms/villageDoor.ts `useHouseExit` / `useStair`, with
 * `padUsableFrom`).
 *
 * The server accepts a pad within its radius, or within radius + 1.3 m in front of it (`padUsableFrom`). The button is offered a little
 * LESS (`OFFER_REACH_MARGIN`, `OFFER_HALF_WIDTH_MARGIN`): the client's pose runs a few centimetres ahead of the one the server knows, so a
 * button shown at the very edge could be pressed just outside what the server accepts and be dropped without a word (the memorial
 * door's reason, villageTargets.ts `DOOR_OFFER_REACH_M`). The arrival spots of the stair are 0.35 m from their pads, inside.
 */

import {
  EXIT_PAD,
  HOUSE_PAD_HALF_WIDTH,
  HOUSE_PAD_REACH,
  HOUSE_STAIR_TYPE,
  STAIR_PLANS,
  parseHouseFloorArea,
  worldToLocal,
  type HousePad,
} from "./houseAreas";

/** How much nearer than the server's reach the button is offered (m): the pad's reach and its band's half width. */
export const OFFER_REACH_MARGIN = 0.05;
export const OFFER_HALF_WIDTH_MARGIN = 0.1;

export const HOUSE_EXIT_TARGET_ID = "house_exit";
export const HOUSE_STAIR_TARGET_PREFIX = "house_stair:";
export const HOUSE_STAIR_UP_TARGET_ID = `${HOUSE_STAIR_TARGET_PREFIX}up`;
export const HOUSE_STAIR_DOWN_TARGET_ID = `${HOUSE_STAIR_TARGET_PREFIX}down`;

export const HOUSE_EXIT_LABEL = "밖으로 나가기";
export const HOUSE_EXIT_SHORT = "나가기";
export const HOUSE_STAIR_UP_LABEL = "2층으로 올라가기";
export const HOUSE_STAIR_UP_SHORT = "⬆ 2층";
export const HOUSE_STAIR_DOWN_LABEL = "1층으로 내려가기";
export const HOUSE_STAIR_DOWN_SHORT = "⬇ 1층";

/** Whether the button for a pad is offered at LOCAL (x, z): `padUsableFrom` with the margins above. */
export function padOfferedFrom(pad: HousePad, x: number, z: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
  const dx = x - pad.x;
  const dz = z - pad.z;
  const d = Math.hypot(dx, dz);
  if (d <= pad.radius) return true;
  if (d > pad.radius + HOUSE_PAD_REACH - OFFER_REACH_MARGIN) return false;
  const fx = Math.sin(pad.facing);
  const fz = Math.cos(pad.facing);
  const ahead = dx * fx + dz * fz;
  const side = Math.abs(dx * fz - dz * fx);
  return ahead <= 0 && side <= HOUSE_PAD_HALF_WIDTH - OFFER_HALF_WIDTH_MARGIN;
}

export interface HouseOffer {
  id: string;
  /** Metres from the player to the pad's centre. */
  dist: number;
  icon: string;
  label: string;
  short: string;
  /** "exit" uses `UseDoor`, "stair" uses `UseStair`. */
  use: "exit" | "stair";
}

/** What the floor offers at WORLD (x, z) of `area`: nothing, the way out, or the stair (the pads are far apart, so at most one). */
export function houseOffers(area: string, x: number, z: number): HouseOffer[] {
  const hit = parseHouseFloorArea(area);
  if (!hit) return [];
  const local = worldToLocal(hit.n, hit.floor, x, z);
  const plan = STAIR_PLANS[HOUSE_STAIR_TYPE[hit.n]];
  const out: HouseOffer[] = [];
  const dist = (p: HousePad) => Math.hypot(local.x - p.x, local.z - p.z);
  if (hit.floor === 1) {
    if (padOfferedFrom(EXIT_PAD, local.x, local.z)) out.push({ id: HOUSE_EXIT_TARGET_ID, dist: dist(EXIT_PAD), icon: "🚪", label: HOUSE_EXIT_LABEL, short: HOUSE_EXIT_SHORT, use: "exit" });
    if (padOfferedFrom(plan.upPad, local.x, local.z)) out.push({ id: HOUSE_STAIR_UP_TARGET_ID, dist: dist(plan.upPad), icon: "🪜", label: HOUSE_STAIR_UP_LABEL, short: HOUSE_STAIR_UP_SHORT, use: "stair" });
  } else if (padOfferedFrom(plan.downPad, local.x, local.z)) {
    out.push({ id: HOUSE_STAIR_DOWN_TARGET_ID, dist: dist(plan.downPad), icon: "🪜", label: HOUSE_STAIR_DOWN_LABEL, short: HOUSE_STAIR_DOWN_SHORT, use: "stair" });
  }
  return out.sort((a, b) => a.dist - b.dist);
}

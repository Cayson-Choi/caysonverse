/**
 * First-visit guide (controls-ux Task 17) — the pure part: the three steps, what advances
 * them, how a real move / look is recognised, the Korean copy, and where a phone shows
 * the card. No React, no DOM, no globals, so every rule is unit-tested without a browser.
 *
 *   ① move  → ② look  → ③ talk  → done
 *
 * A step advances ONLY on its own action (`nextCoachStep`): talking during ① does not skip
 * ahead, and a stray look during ① does not count for ②. "건너뛰기" ends the guide from any
 * step, and the menu's "조작 안내 다시 보기" starts it over at ①.
 *
 * Moving and looking are measured, not guessed: `detectCoachEvent` is run a few times a
 * second on the live pose and view yaw (CoachMarks does that off the frame path) and
 * wants 1.5 m of walking / 0.6 rad of turning. Talking is reported by the chat input when
 * a line is really sent.
 *
 * The phone's card positions come from the same touch layout the HUD uses (game/hud.ts):
 * `placeCoachCard` picks a spot that keeps 8 px from every HUD button, so a card can never
 * hide a control. Coordinates: CSS px from the viewport's top-left, like hud.ts.
 */

import { normalizeAngle } from "./yaw";
import { MIN_GAP_PX, MIN_TOUCH_PX } from "./settings";
import {
  HUD_CHIP_H_PX,
  HUD_COLUMN_MAX_W_PX,
  HUD_TOP_INSET_PX,
  rectGap,
  restRects,
  type Rect,
  type SafeInsets,
  type TouchHudLayout,
} from "./hud";

export type CoachStep = "move" | "look" | "talk" | "done";
export type CoachEvent = "moved" | "looked" | "talked" | "skip" | "restart";

/** Walking this far (m) from where ① began counts as "움직였어요". */
export const COACH_MOVE_M = 1.5;
/** Turning the view this much in total (rad, either way, wrap-safe) counts as "둘러봤어요". */
export const COACH_LOOK_RAD = 0.6;
/** Float slack: a turn of exactly 0.6 rad comes back from atan2 as 0.5999999999999999 and must still count. */
const EDGE_EPS = 1e-9;
/** How often the move / look check runs (ms): 5 Hz. */
export const COACH_POLL_MS = 200;

/**
 * The step after `ev`. Only the matching action moves forward; skip ends the guide from
 * anywhere, restart goes back to ①; everything else (a different action, anything once
 * the guide is done) leaves the step as it is.
 */
export function nextCoachStep(step: CoachStep, ev: CoachEvent): CoachStep {
  if (ev === "restart") return "move";
  if (ev === "skip") return "done";
  if (step === "move" && ev === "moved") return "look";
  if (step === "look" && ev === "looked") return "talk";
  if (step === "talk" && ev === "talked") return "done";
  return step;
}

// ───────────────────────────────── detection ─────────────────────────────────

/** What the detector remembers between two checks. Mutated in place by `detectCoachEvent`. */
export interface CoachProgress {
  /** Where the player stood when the current step began. */
  startX: number;
  startZ: number;
  /** Total turning (rad, ≥ 0) since the current step began. */
  lookAccum: number;
  /** The view yaw at the last check — the next turn is measured from it. */
  lastYaw: number;
}

/** A fresh progress record for a step that begins now. */
export function createCoachProgress(x: number, z: number, viewYaw: number): CoachProgress {
  return { startX: x, startZ: z, lookAccum: 0, lastYaw: viewYaw };
}

/**
 * One check. `p` is updated in place (the turn since the last check is added to
 * `lookAccum`, `lastYaw` moves on), so call it once per poll with the current pose and
 * view yaw. Returns the event the step is waiting for, or null.
 *
 *  - ① move: the straight distance from the start spot reaches COACH_MOVE_M.
 *  - ② look: the turning adds up to COACH_LOOK_RAD. Each turn is the SHORT way round
 *    between two yaws (normalizeAngle), so a pass through ±π adds a few hundredths of a
 *    radian, not 2π; turning back and forth adds up, it does not cancel.
 *  - ③ talk and done: nothing to measure here (a sent chat line reports "talked").
 *
 * `lastYaw` follows the view in every step, so a turn made during ① never counts for ②.
 */
export function detectCoachEvent(
  step: CoachStep,
  p: CoachProgress,
  x: number,
  z: number,
  viewYaw: number,
): CoachEvent | null {
  const turn = Math.abs(normalizeAngle(viewYaw - p.lastYaw));
  if (Number.isFinite(viewYaw)) p.lastYaw = viewYaw; // a NaN yaw must not poison every later turn
  if (step === "move") {
    return Math.hypot(x - p.startX, z - p.startZ) >= COACH_MOVE_M - EDGE_EPS ? "moved" : null;
  }
  if (step === "look") {
    if (Number.isFinite(turn)) p.lookAccum += turn;
    return p.lookAccum >= COACH_LOOK_RAD - EDGE_EPS ? "looked" : null;
  }
  return null;
}

// ───────────────────────────────────── copy ─────────────────────────────────────

const COPY: Record<Exclude<CoachStep, "done">, { title: string; touch: string; pc: string }> = {
  move: {
    title: "① 움직이기",
    touch: "화면 왼쪽 아래를 누른 채 밀어 보세요. 끝까지 밀면 달려요.",
    pc: "W A S D(또는 방향키)로 걸어 보세요. Shift를 누르면 달려요.",
  },
  look: {
    title: "② 둘러보기",
    touch: "화면 오른쪽을 한 손가락으로 끌어 보세요. 두 손가락으로 벌리면 확대돼요.",
    pc: "마우스를 끌거나 Z·C 키로 둘러보세요. 휠로 확대해요.",
  },
  talk: {
    title: "③ 말하기",
    touch: "아래 💬 버튼을 눌러 인사해 보세요.",
    pc: "Enter 또는 / 를 누르고 인사해 보세요.",
  },
};

/** 왼쪽 ↔ 오른쪽, for the phone copy of a left-handed player (the whole layout is mirrored). */
function mirrorSides(text: string): string {
  return text.replace(/왼쪽|오른쪽/g, (side) => (side === "왼쪽" ? "오른쪽" : "왼쪽"));
}

/**
 * The card's title and body. The wording is fixed; `touch` picks the phone or PC line.
 * Only for a left-handed phone does 왼쪽 / 오른쪽 swap (the stick and the look half trade
 * sides, so the text would otherwise point at the wrong one); every other case is verbatim.
 */
export function coachCopy(
  step: Exclude<CoachStep, "done">,
  touch: boolean,
  leftHanded = false,
): { title: string; body: string } {
  const c = COPY[step];
  if (!touch) return { title: c.title, body: c.pc };
  return { title: c.title, body: leftHanded ? mirrorSides(c.touch) : c.touch };
}

// ──────────────────────────────── phone card placement ────────────────────────────────

/** Widest a phone card gets (px). */
export const COACH_CARD_MAX_W_PX = 300;
/** A card's distance from the screen edges (px) — the same as the HUD's own inset. */
export const COACH_EDGE_PX = HUD_TOP_INSET_PX;
/** Height (px) assumed for a card before it has been measured. */
export const COACH_CARD_H_GUESS_PX = 112;
/** Widest the room-name chip above 👥 can be (px) — an upper bound, the chip is as wide as its text. */
const COACH_CHIP_MAX_W_PX = 120;
/**
 * ①'s card floats this far above the stick zone's top edge (on top of the 8 px gap): the
 * avatar stands at the middle of the screen, right at that edge, and the card should clear its head.
 */
export const COACH_ZONE_LIFT_PX = 32;
/** The admin panel's own border (px), around its 48 px header (admin.css). */
const ADMIN_BORDER_PX = 1;
/** Search resolution (px) of the free-spot search. */
const COACH_GRID_PX = 4;
/** Cost of one px of vertical overlap with the stick zone, in px of distance from the ideal spot. */
const ZONE_PX_COST = 20;
/** Cost of each px a spot comes short of the 8 px gap to a HUD button — high enough that any spot with the full gap wins. */
const SHORTFALL_PX_COST = 1000;

/** A card's width on a `vw` px wide screen: 300 px, or what fits between the edges. */
export function coachCardWidth(vw: number, safe: SafeInsets): number {
  return Math.max(0, Math.min(COACH_CARD_MAX_W_PX, vw - safe.left - safe.right - 2 * COACH_EDGE_PX));
}

export interface CoachPlaceInput {
  vw: number;
  vh: number;
  safe: SafeInsets;
  leftHanded: boolean;
  layout: TouchHudLayout;
  /** The teacher's admin panel hangs (folded) under the chat-log toggle — one more thing to keep clear. */
  admin: boolean;
  /** The card's size: `coachCardWidth` wide, as tall as its text made it. */
  w: number;
  h: number;
}

/**
 * Everything a card must keep MIN_GAP_PX from on a phone: every HUD button at rest, plus
 * the parts of the top-left column that are not buttons in the layout model — the room-name
 * chip and, for a teacher, the admin panel's folded header. (The open emoji fan hides the
 * card instead, see coach.css; the roster and menu hide it too.)
 */
export function coachObstacles(l: TouchHudLayout, vw: number, admin: boolean): Rect[] {
  const onLeft = l.column.side === "left";
  const edge = onLeft ? l.roster.x : l.roster.x + l.roster.w;
  const chipW = COACH_CHIP_MAX_W_PX;
  const out = restRects(l);
  out.push({ x: onLeft ? edge : edge - chipW, y: l.roster.y - MIN_GAP_PX - HUD_CHIP_H_PX, w: chipW, h: HUD_CHIP_H_PX });
  if (admin) {
    const w = Math.min(HUD_COLUMN_MAX_W_PX, vw - 2 * COACH_EDGE_PX);
    out.push({
      x: onLeft ? edge : edge - w,
      y: l.chatLog.y + l.chatLog.h + MIN_GAP_PX,
      w,
      h: MIN_TOUCH_PX + 2 * ADMIN_BORDER_PX,
    });
  }
  return out;
}

/** The values from `min` to `max` on the search grid, plus the ends and the ideal value (so a flush-to-the-edge spot is always tried). */
function axisValues(min: number, max: number, ideal: number): number[] {
  const out = new Set<number>([ideal, max]);
  for (let v = min; v < max; v += COACH_GRID_PX) out.add(v);
  out.add(min);
  return [...out].sort((a, b) => a - b);
}

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Where a phone shows the card for `step`: the free spot nearest to the step's ideal one.
 *
 *  - ① move: just above the stick zone (the lower quarter on the stick's side, a little
 *    higher than touching it so the avatar's head stays clear), flush with that side's edge —
 *    near the thumb's place without sitting on it.
 *  - ② look: on the look side, right under the top button row.
 *  - ③ talk: above the 💬 button, centred on it (the bottom cluster's buttons push it up).
 *
 * "Free" is a hard rule in all but the smallest screens: inside the screen's margins and at
 * least MIN_GAP_PX from every obstacle (`coachObstacles`). Among the free spots the cost is
 * the distance from the ideal one, plus — for ① and ② — a heavy price per px of overlap with
 * the stick zone (a card only sits over the zone when the screen is too short for anywhere
 * else). Searched on a 4 px grid, top to bottom, left to right, so the answer is deterministic.
 * When no spot has the full gap (a screen too small for the HUD itself) every px a spot
 * comes short of 8 px costs far more than any distance, so the least-crowded spot wins.
 * Not a per-frame call: CoachMarks runs it when the screen, settings or step change.
 */
export function placeCoachCard(step: Exclude<CoachStep, "done">, input: CoachPlaceInput): Rect {
  const { vw, vh, safe, leftHanded, layout, admin, w, h } = input;
  const minX = safe.left + COACH_EDGE_PX;
  const maxX = vw - safe.right - COACH_EDGE_PX - w;
  const minY = safe.top + COACH_EDGE_PX;
  const maxY = vh - safe.bottom - COACH_EDGE_PX - h;
  const clampX = (x: number) => Math.min(Math.max(x, minX), Math.max(minX, maxX));
  const clampY = (y: number) => Math.min(Math.max(y, minY), Math.max(minY, maxY));

  // The stick zone: the lower-left quarter, the lower-right when left-handed.
  const zone: Rect = { x: leftHanded ? vw / 2 : 0, y: vh / 2, w: vw / 2, h: vh / 2 };
  let idealX: number;
  let idealY: number;
  let zoneCost = ZONE_PX_COST;
  if (step === "move") {
    idealX = leftHanded ? maxX : minX;
    idealY = zone.y - MIN_GAP_PX - COACH_ZONE_LIFT_PX - h;
  } else if (step === "look") {
    idealX = leftHanded ? minX : maxX;
    idealY = layout.topGroup.y + layout.topGroup.h + MIN_GAP_PX;
  } else {
    idealX = layout.chat.x + layout.chat.w / 2 - w / 2;
    idealY = layout.chat.y - MIN_GAP_PX - h;
    zoneCost = 0; // the 💬 button's own corner may be in the zone: staying near it wins
  }
  idealX = clampX(idealX);
  idealY = clampY(idealY);

  const obstacles = coachObstacles(layout, vw, admin);
  let best: Rect = { x: idealX, y: idealY, w, h };
  let bestCost = Infinity;
  for (const y of axisValues(minY, Math.max(minY, maxY), idealY)) {
    for (const x of axisValues(minX, Math.max(minX, maxX), idealX)) {
      const cand: Rect = { x, y, w, h };
      let cost = Math.abs(x - idealX) + Math.abs(y - idealY);
      if (zoneCost > 0) cost += (overlapArea(cand, zone) / w) * zoneCost;
      if (cost >= bestCost) continue; // the shortfall below only adds
      for (const o of obstacles) {
        const gap = rectGap(cand, o);
        if (gap < MIN_GAP_PX - 1e-6) cost += (MIN_GAP_PX - gap) * SHORTFALL_PX_COST;
        if (cost >= bestCost) break;
      }
      if (cost < bestCost) {
        best = cand;
        bestCost = cost;
      }
    }
  }
  return best;
}

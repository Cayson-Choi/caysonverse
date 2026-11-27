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
import type { ViewMode } from "./viewMode";
import { MIN_GAP_PX } from "./settings";
import {
  HUD_CHIP_H_PX,
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
 * ③ 말하기 only shows where 💬 is (UX 2026-11-16: a first-time player who did not want to chat was stuck on it): it ends by
 * itself this long after it shows (ms), on a tap on its card, or when a line is really sent.
 */
export const COACH_TALK_AUTO_MS = 5000;

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

/**
 * A poller for one step: call `poll` every COACH_POLL_MS with the live pose and view yaw.
 * The FIRST poll only takes the baseline (the spot and view the step is measured from) and
 * reports nothing — so what happened between the card mounting and its first look at the
 * world never counts. That gap is real: a reconnect remount builds the guide while the old
 * first-person state is still up, then the world's reset hands the view back to the orbit
 * yaw, and a baseline taken at mount would read that as a turn ("둘러봤어요") nobody made.
 * Make a new poller per step / restart so earlier walking and turning never carry over.
 */
export interface CoachPoller {
  poll(step: CoachStep, x: number, z: number, viewYaw: number): CoachEvent | null;
}

export function createCoachPoller(): CoachPoller {
  let progress: CoachProgress | null = null;
  return {
    poll(step, x, z, viewYaw) {
      if (progress === null) {
        progress = createCoachProgress(x, z, viewYaw);
        return null;
      }
      return detectCoachEvent(step, progress, x, z, viewYaw);
    },
  };
}

/** The bits of the shared view state the guide reads. */
export interface ViewYawSource {
  mode: ViewMode;
  /** The mode to return to when the overview map closes ('tp' | 'fp'). */
  prevMode: ViewMode;
  fpYaw: number;
}

/**
 * The yaw the player is looking along: the first-person look yaw in FP, the orbit yaw in
 * third person. The overview map touches neither, so under it the view underneath
 * (`prevMode`) counts.
 */
export function viewYawOf(view: ViewYawSource, orbit: { yaw: number }): number {
  const mode = view.mode === "ov" ? view.prevMode : view.mode;
  return mode === "fp" ? view.fpYaw : orbit.yaw;
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
    touch: "아래 💬 버튼을 누르면 이웃과 이야기할 수 있어요.",
    pc: "Enter 또는 / 를 누르면 이웃과 이야기할 수 있어요.",
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
/**
 * Where the player's own avatar and its name tag are on a phone (the follow camera keeps them in the middle of the screen,
 * the tag at about 40 % of the height and the feet at about 67 %): a card never sits over them (UX 2026-11-16: ① covered the
 * name tag). Fractions of the screen, a little wider than measured on a 375×812 iPhone.
 */
export const COACH_AVATAR_BAND = { top: 0.35, bottom: 0.68, halfW: 75 } as const;
/** Cost of each px² of a card over the avatar band, per px of card width (a spot clear of it always wins). */
const AVATAR_PX_COST = 400;

/** The avatar and its name tag on a `vw` × `vh` phone screen (see COACH_AVATAR_BAND). */
export function coachAvatarRect(vw: number, vh: number): Rect {
  const b = COACH_AVATAR_BAND;
  return { x: vw / 2 - b.halfW, y: vh * b.top, w: 2 * b.halfW, h: vh * (b.bottom - b.top) };
}

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
  /** The card's size: `coachCardWidth` wide, as tall as its text made it. */
  w: number;
  h: number;
}

/**
 * Everything a card must keep MIN_GAP_PX from on a phone: every HUD button at rest, plus
 * the parts of the top-left column that are not buttons in the layout model — the room-name
 * chip. (The open emoji fan hides the
 * card instead, see coach.css; the roster and menu hide it too.)
 */
export function coachObstacles(l: TouchHudLayout): Rect[] {
  const onLeft = l.column.side === "left";
  const edge = onLeft ? l.roster.x : l.roster.x + l.roster.w;
  const chipW = COACH_CHIP_MAX_W_PX;
  const out = restRects(l);
  out.push({ x: onLeft ? edge : edge - chipW, y: l.roster.y - MIN_GAP_PX - HUD_CHIP_H_PX, w: chipW, h: HUD_CHIP_H_PX });
  // the scene's own button under the chat-log toggle (케이슨 마을's 🔭): one more slot of the column
  out.push({ ...l.chatLog, y: l.chatLog.y + l.chatLog.h + MIN_GAP_PX });
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
 *  - ① move: at the top on the stick's side, under the top button row (clear of the avatar and
 *    its name tag in the middle of the screen).
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
  const full = placeAt(step, input);
  if (full.cost < CLEAN_COST) return full.rect;
  // No clean spot at full width (a portrait phone: the top-left column and the avatar leave only the strip beside the column
  // above the avatar): the card narrows to that strip, beside the column.
  const l = input.layout;
  const colEdge = l.column.side === "left" ? l.roster.x + l.roster.w : l.roster.x;
  const narrowW =
    l.column.side === "left"
      ? input.vw - input.safe.right - COACH_EDGE_PX - (colEdge + MIN_GAP_PX)
      : colEdge - MIN_GAP_PX - (input.safe.left + COACH_EDGE_PX);
  if (narrowW < 200 || narrowW >= input.w) return full.rect;
  const narrow = placeAt(step, { ...input, w: narrowW, h: Math.ceil((input.h * input.w) / narrowW) });
  return narrow.cost < full.cost ? { ...narrow.rect, h: input.h } : full.rect;
}

/** A cost under this is a spot with the full gap to every button and off the avatar (only the distance from the ideal). */
const CLEAN_COST = 900;

function placeAt(step: Exclude<CoachStep, "done">, input: CoachPlaceInput): { rect: Rect; cost: number } {
  const { vw, vh, safe, leftHanded, layout, w, h } = input;
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
    // at the top on the stick's side (UX 2026-11-16: above the stick zone it sat on the avatar's name tag)
    idealX = leftHanded ? maxX : minX;
    idealY = layout.topGroup.y + layout.topGroup.h + MIN_GAP_PX;
  } else if (step === "look") {
    idealX = leftHanded ? minX : maxX;
    idealY = layout.topGroup.y + layout.topGroup.h + MIN_GAP_PX;
  } else if (vh > vw && layout.emoji.y + layout.emoji.h <= layout.chat.y) {
    // a portrait phone's 2×2 button grid (owner 11-26) stacks the emoji over the 💬: the space above it is the avatar's, so
    // ③ goes to the top on the 💬's side, like ② (still above the bottom cluster, over the 💬's side of the screen)
    idealX = layout.chat.x + layout.chat.w / 2 < vw / 2 ? minX : maxX;
    idealY = layout.topGroup.y + layout.topGroup.h + MIN_GAP_PX;
  } else {
    idealX = layout.chat.x + layout.chat.w / 2 - w / 2;
    idealY = layout.chat.y - MIN_GAP_PX - h;
    zoneCost = 0; // the 💬 button's own corner may be in the zone: staying near it wins
  }
  idealX = clampX(idealX);
  idealY = clampY(idealY);

  const obstacles = coachObstacles(layout);
  // the avatar band only where a card can go round it (a short landscape phone has no room above or below it)
  const avatar = vh > vw ? coachAvatarRect(vw, vh) : null;
  let best: Rect = { x: idealX, y: idealY, w, h };
  let bestCost = Infinity;
  for (const y of axisValues(minY, Math.max(minY, maxY), idealY)) {
    for (const x of axisValues(minX, Math.max(minX, maxX), idealX)) {
      const cand: Rect = { x, y, w, h };
      let cost = Math.abs(x - idealX) + Math.abs(y - idealY);
      if (zoneCost > 0) cost += (overlapArea(cand, zone) / w) * zoneCost;
      if (avatar) cost += (overlapArea(cand, avatar) / w) * AVATAR_PX_COST;
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
  return { rect: best, cost: bestCost };
}

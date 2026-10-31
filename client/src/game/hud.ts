/**
 * HUD layout (controls-ux Task 16) — the pure part: the room names, the roster order,
 * the emoji fan geometry, and the touch layout as plain rectangles. No React, no DOM,
 * no globals, so every rule here is unit-tested without a browser.
 *
 * Why the touch layout is numbers and not CSS: the rule "every button is at least 48 px
 * and at least 8 px from every other" depends on the screen width, the 버튼 크기 setting
 * and the 왼손잡이 mode together, and a CSS twin of this file would drift from the test
 * that guards it. So `touchHudLayout` is the ONE place the positions come from: the
 * components apply its rectangles as inline styles, and hud.test.ts checks those very
 * numbers (375×812 at the largest button size, then every size / hand / phone screen).
 * Only the free-flowing parts (the top-left column's contents, the roster list) are CSS.
 *
 * Coordinates: CSS px from the top-left of the viewport (the DOM's own convention).
 */

import { EMOJIS } from "@caysonverse/shared/constants";
import { ZONES } from "@caysonverse/shared/worldMap";
import { MIN_GAP_PX, MIN_TOUCH_PX, buttonPx, type ButtonSize } from "./settings";

// ───────────────────────────────── room names ─────────────────────────────────

export type ZoneKey = keyof typeof ZONES;

/** What the 왼쪽 위 chip and the 지도 call each room. */
export const ZONE_LABELS: Record<ZoneKey, string> = {
  maze: "미로방",
  lounge: "로비",
  lectureHall: "강의실",
  gallery: "AI 갤러리",
};

/** Lookup order: the rooms share edges (lounge | hall at x = 0, lounge | gallery at z = -18) — first match wins. */
const ZONE_ORDER: readonly ZoneKey[] = ["gallery", "maze", "lectureHall", "lounge"];

/** The room (x, z) is in, or "" outside every room. Edges are inside. */
export function zoneLabelAt(x: number, z: number): string {
  for (const key of ZONE_ORDER) {
    const b = ZONES[key];
    if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) return ZONE_LABELS[key];
  }
  return "";
}

// ─────────────────────────────────── roster ───────────────────────────────────

export interface RosterRow {
  sid: string;
  nickname: string;
  teacher: boolean;
  self: boolean;
}

/** 선생님 → 나 → 나머지 (한글 가나다순). A teacher who is me is the first teacher. */
export function rosterRows(self: RosterRow, remotes: readonly RosterRow[]): RosterRow[] {
  const all: RosterRow[] = [{ ...self, self: true }, ...remotes.map((r) => ({ ...r, self: false }))];
  const rank = (r: RosterRow): number => (r.teacher ? 0 : r.self ? 1 : 2);
  return all.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      Number(b.self) - Number(a.self) ||
      a.nickname.localeCompare(b.nickname, "ko") ||
      (a.sid < b.sid ? -1 : a.sid > b.sid ? 1 : 0),
  );
}

/** "접속자 N명". */
export function rosterTitle(count: number): string {
  return `접속자 ${count}명`;
}

/** One list line: 👑 before a teacher, " (나)" after me. */
export function rosterRowLabel(row: RosterRow): string {
  return `${row.teacher ? "👑 " : ""}${row.nickname}${row.self ? " (나)" : ""}`;
}

// ─────────────────────────────────── emoji fan ───────────────────────────────────

/** A tiny float (sin π ≈ 1e-16) is a zero, so the 180° / 0° buttons sit exactly on the baseline. */
function clean(v: number): number {
  return Math.abs(v) < 1e-9 ? 0 : v;
}

/**
 * Radius (whole px) of the half circle on which `count` buttons of size `btnPx` sit so
 * that neighbours are at least `btnPx + MIN_GAP_PX` apart (centre to centre). The
 * buttons are spread over 180°, so neighbours are π/(count-1) apart on the circle and
 * the straight distance between them is 2·r·sin(π / (2·(count-1))).
 */
export function fanRadius(btnPx: number, count: number): number {
  if (count < 2) return 0;
  return Math.ceil((btnPx + MIN_GAP_PX) / (2 * Math.sin(Math.PI / (2 * (count - 1)))));
}

/**
 * Button centres on an upward half circle around (0, 0), from 180° (left) to 0° (right).
 * `dy` is negative above the centre (screen y grows downward). One button sits straight up.
 */
export function fanPositions(count: number, radiusPx: number): { dx: number; dy: number }[] {
  const out: { dx: number; dy: number }[] = [];
  for (let i = 0; i < count; i++) {
    const theta = count === 1 ? Math.PI / 2 : Math.PI - (i * Math.PI) / (count - 1);
    out.push({ dx: clean(radiusPx * Math.cos(theta)), dy: clean(-radiusPx * Math.sin(theta)) });
  }
  return out;
}

/**
 * Slide the fan's centre sideways so the whole fan (radius + half a button each way)
 * stays MIN_GAP_PX inside a `vw` wide screen. A fan wider than the screen is centred.
 */
export function clampFanCenterX(cx: number, radiusPx: number, btnPx: number, vw: number): number {
  const reach = radiusPx + btnPx / 2 + MIN_GAP_PX;
  const lo = reach;
  const hi = vw - reach;
  if (lo > hi) return vw / 2;
  return Math.min(hi, Math.max(lo, cx));
}

// ───────────────────────────────── touch layout ─────────────────────────────────

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * A circle of diameter `w` (= `h`) instead of the box: jump, action, 💬, the emoji button
   * and the fan buttons are round. `rectGap` measures a circle as a circle — which is what
   * lets six 70 px fan buttons fit a half circle on a 375 px screen with 8 px between them.
   */
  round?: boolean;
}

/** Notch / home-bar insets (CSS px), read from env(safe-area-inset-*) by the layout hook. */
export interface SafeInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Base sizes (px at 보통). Each goes through buttonPx: x scale, never under 48. */
export const HUD_BASE = { top: 48, jump: 72, action: 60, emoji: 56, chat: 56 } as const;
/** Jump button's distance from the bottom and side edges. */
export const HUD_EDGE_PX = 16;
/** Top row's distance from the top and side edges. */
export const HUD_TOP_INSET_PX = 12;
/** Between the jump button and the action button above it. */
export const HUD_ACTION_GAP_PX = 12;
/** Height of the room-name chip above the 👥 button (touch). */
export const HUD_CHIP_H_PX = 28;
/** Width of the 👥 and chat-log buttons in the top-left column (touch). */
export const HUD_INFO_BTN_W_PX = 72;
/** Screens narrower than this stack the cluster in two rows. */
export const HUD_NARROW_BELOW_PX = 480;
/** Buttons in the top-right group: 👁 first-person, 🗺 map, 🔊 sound, ☰ menu. */
export const HUD_TOP_BUTTON_COUNT = 4;

export interface TouchHudLayout {
  /** The two-row cluster (phone portrait) rather than one row (wide screens). */
  narrow: boolean;
  /** Size (px) of the top-right buttons: the chosen button size, or less on a very narrow screen. */
  topPx: number;
  jump: Rect;
  action: Rect;
  /** The emoji button that opens the fan. */
  emoji: Rect;
  /** The 💬 button. */
  chat: Rect;
  /** 👁 🗺 🔊 ☰ in that order (strict mirror when left-handed: ☰ is then in the corner). */
  topButtons: Rect[];
  /** Bounding box of `topButtons`. */
  topGroup: Rect;
  /** 👥 — below the room-name chip in the top-left column. */
  roster: Rect;
  /** The chat-log toggle below 👥. */
  chatLog: Rect;
  /** Where the top-left column hangs: from `side`'s edge by `inset`, `top` from the top. */
  column: { side: "left" | "right"; inset: number; top: number };
  /** The open fan's buttons, left (180°) to right (0°). */
  fan: Rect[];
}

export interface TouchHudInput {
  vw: number;
  vh: number;
  safe: SafeInsets;
  size: ButtonSize;
  leftHanded: boolean;
}

function mirrorRect(r: Rect, left: number, right: number): Rect {
  return { ...r, x: left + right - r.x - r.w };
}

function union(rects: readonly Rect[]): Rect {
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w));
  const y1 = Math.max(...rects.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Size (px) of the fan's buttons: the emoji button's own size, or — on a screen too narrow
 * for the half circle at that size (a 320 px phone at 크게) — the largest that fits, never
 * under 48 px. The fan is as wide as 2 × radius + one button, kept MIN_GAP_PX off both sides.
 */
export function fanButtonPx(emojiPx: number, count: number, room: number): number {
  for (let b = emojiPx; b > MIN_TOUCH_PX; b--) {
    if (2 * fanRadius(b, count) + b + 2 * MIN_GAP_PX <= room) return b;
  }
  return MIN_TOUCH_PX;
}

/** The open fan's button rectangles around `emoji` (centred on the toggle's row, slid inside the screen). */
function fanRects(emoji: Rect, count: number, left: number, right: number): Rect[] {
  const b = fanButtonPx(emoji.w, count, right - left);
  const r = fanRadius(b, count);
  const cx = left + clampFanCenterX(emoji.x + emoji.w / 2 - left, r, b, right - left);
  const cy = emoji.y + emoji.h / 2;
  return fanPositions(count, r).map((p) => ({
    x: cx + p.dx - b / 2,
    y: cy + p.dy - b / 2,
    w: b,
    h: b,
    round: true,
  }));
}

/**
 * Every touch HUD button as a rectangle, for a `vw` × `vh` screen.
 *
 *   top-right   👁 🗺 🔊 ☰  (each `topPx`, 8 px apart, 12 px from the corner)
 *   top-left    room-name chip, then 👥, then the chat-log toggle (a column, 8 px apart)
 *   bottom-right  jump (72, 16 px from the edges); action (60) centred 12 px above it;
 *                 emoji (56) — phones: left of the action (a second row), wide screens:
 *                 left of the jump on the jump's row
 *   bottom      💬 (56) — phones: left of the jump on its row (so the left half stays the
 *               joystick's); wide screens: centred
 *
 * `leftHanded` mirrors everything across the screen's vertical centre line. The open fan
 * hides the jump, action and 💬 buttons (the fan is drawn over their corner), so
 * `fanOpenRects` is what must stay clear while it is up.
 */
export function touchHudLayout({ vw, vh, safe, size, leftHanded }: TouchHudInput): TouchHudLayout {
  const L = safe.left;
  const R = vw - safe.right;
  const T = safe.top;
  const B = vh - safe.bottom;
  const J = buttonPx(HUD_BASE.jump, size);
  const A = buttonPx(HUD_BASE.action, size);
  const E = buttonPx(HUD_BASE.emoji, size);
  const C = buttonPx(HUD_BASE.chat, size);
  const narrow = vw < HUD_NARROW_BELOW_PX;
  // The top-right group shares the row with the 72 px 👥 / chat-log column on its left. On a
  // 360 px phone at 크게 (4 × 60 + gaps) they would touch, so the group gives up size first —
  // never below 48 px, and never on a screen wide enough for the chosen size.
  const groupRoom = R - HUD_TOP_INSET_PX - (L + HUD_TOP_INSET_PX + HUD_INFO_BTN_W_PX + MIN_GAP_PX);
  const topFit = Math.floor((groupRoom - (HUD_TOP_BUTTON_COUNT - 1) * MIN_GAP_PX) / HUD_TOP_BUTTON_COUNT);
  const top = Math.max(MIN_TOUCH_PX, Math.min(buttonPx(HUD_BASE.top, size), topFit));

  // Right-handed first; mirrored at the end.
  const jump: Rect = { x: R - HUD_EDGE_PX - J, y: B - HUD_EDGE_PX - J, w: J, h: J, round: true };
  const action: Rect = {
    x: jump.x + (J - A) / 2,
    y: jump.y - HUD_ACTION_GAP_PX - A,
    w: A,
    h: A,
    round: true,
  };
  const emoji: Rect = narrow
    ? { x: action.x - MIN_GAP_PX - E, y: action.y + A - E, w: E, h: E, round: true }
    : { x: jump.x - MIN_GAP_PX - E, y: jump.y + J - E, w: E, h: E, round: true };
  const chat: Rect = narrow
    ? { x: jump.x - MIN_GAP_PX - C, y: jump.y + J - C, w: C, h: C, round: true }
    : { x: (L + R) / 2 - C / 2, y: jump.y + J - C, w: C, h: C, round: true };

  const topButtons: Rect[] = [];
  for (let i = 0; i < HUD_TOP_BUTTON_COUNT; i++) {
    const fromRight = HUD_TOP_BUTTON_COUNT - 1 - i;
    topButtons.push({
      x: R - HUD_TOP_INSET_PX - top - fromRight * (top + MIN_GAP_PX),
      y: T + HUD_TOP_INSET_PX,
      w: top,
      h: top,
    });
  }
  const roster: Rect = {
    x: L + HUD_TOP_INSET_PX,
    y: T + HUD_TOP_INSET_PX + HUD_CHIP_H_PX + MIN_GAP_PX,
    w: HUD_INFO_BTN_W_PX,
    h: top,
  };
  const chatLog: Rect = { x: roster.x, y: roster.y + top + MIN_GAP_PX, w: HUD_INFO_BTN_W_PX, h: top };

  const m = (r: Rect): Rect => (leftHanded ? mirrorRect(r, L, R) : r);
  const emojiF = m(emoji);
  const topF = topButtons.map(m);
  return {
    narrow,
    topPx: top,
    jump: m(jump),
    action: m(action),
    emoji: emojiF,
    chat: m(chat),
    topButtons: topF,
    topGroup: union(topF),
    roster: m(roster),
    chatLog: m(chatLog),
    column: leftHanded
      ? { side: "right", inset: safe.right + HUD_TOP_INSET_PX, top: T + HUD_TOP_INSET_PX }
      : { side: "left", inset: safe.left + HUD_TOP_INSET_PX, top: T + HUD_TOP_INSET_PX },
    fan: fanRects(emojiF, EMOJIS.length, L, R),
  };
}

/** Everything touchable at rest (the roster list and the admin panel flow below the column; they are not in the model). */
export function restRects(l: TouchHudLayout): Rect[] {
  return [l.jump, l.action, l.emoji, l.chat, ...l.topButtons, l.roster, l.chatLog];
}

/** Everything visible while the emoji fan is open: the toggle, the six fan buttons, the top rows. */
export function fanOpenRects(l: TouchHudLayout): Rect[] {
  return [l.emoji, ...l.fan, ...l.topButtons, l.roster, l.chatLog];
}

/**
 * Straight distance between two shapes' nearest points; 0 when they touch or overlap.
 * A `round` rect is its inscribed circle (two circles: centre distance minus both radii;
 * a circle and a box: the circle's centre to the box, minus the radius).
 */
export function rectGap(a: Rect, b: Rect): number {
  const acx = a.x + a.w / 2;
  const acy = a.y + a.h / 2;
  const bcx = b.x + b.w / 2;
  const bcy = b.y + b.h / 2;
  if (a.round && b.round) return Math.max(0, Math.hypot(acx - bcx, acy - bcy) - (a.w + b.w) / 2);
  if (a.round || b.round) {
    const [c, box] = a.round ? [a, b] : [b, a];
    const px = Math.min(box.x + box.w, Math.max(box.x, c.x + c.w / 2));
    const py = Math.min(box.y + box.h, Math.max(box.y, c.y + c.h / 2));
    return Math.max(0, Math.hypot(c.x + c.w / 2 - px, c.y + c.h / 2 - py) - c.w / 2);
  }
  const dx = Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w));
  const dy = Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h));
  return Math.hypot(dx, dy);
}

import { describe, it, expect } from "vitest";
import { EMOJIS } from "@caysonverse/shared/constants";
import { MIN_GAP_PX, MIN_TOUCH_PX, buttonPx, type ButtonSize } from "./settings";
import {
  HUD_NARROW_BELOW_PX,
  clampFanCenterX,
  fanButtonPx,
  fanOpenRects,
  fanPositions,
  fanRadius,
  rectGap,
  restRects,
  rosterRowLabel,
  rosterRows,
  rosterTitle,
  touchHudLayout,
  type Rect,
  type RosterRow,
  type SafeInsets,
  type TouchHudLayout,
} from "./hud";

const SIZES: readonly ButtonSize[] = ["small", "medium", "large"];
const NO_INSETS: SafeInsets = { top: 0, right: 0, bottom: 0, left: 0 };

const row = (sid: string, nickname: string, extra: Partial<RosterRow> = {}): RosterRow => ({
  sid,
  nickname,
  self: false,
  ...extra,
});

describe("roster", () => {
  it("rosterRows: me first, then Korean order", () => {
    const rows = rosterRows(row("me", "하늘", { self: true }), [row("a", "다람"), row("b", "가나"), row("c", "나비")]);
    expect(rows.map((r) => r.sid)).toEqual(["me", "b", "c", "a"]);
    expect(rows.map((r) => r.nickname)).toEqual(["하늘", "가나", "나비", "다람"]);
  });

  it("flags are normalized: only the first argument is me", () => {
    const rows = rosterRows(row("me", "나", { self: false }), [row("x", "가", { self: true })]);
    expect(rows.find((r) => r.sid === "me")?.self).toBe(true);
    expect(rows.find((r) => r.sid === "x")?.self).toBe(false);
  });

  it("equal nicknames keep a stable order (by session id) and the input is not mutated", () => {
    const remotes = [row("z", "같은"), row("y", "같은")];
    const rows = rosterRows(row("me", "나", { self: true }), remotes);
    expect(rows.map((r) => r.sid)).toEqual(["me", "y", "z"]);
    expect(remotes.map((r) => r.sid)).toEqual(["z", "y"]);
  });

  it("title and row copy: 접속자 N명, (나) after me", () => {
    expect(rosterTitle(1)).toBe("접속자 1명");
    expect(rosterTitle(27)).toBe("접속자 27명");
    expect(rosterRowLabel(row("me", "하늘", { self: true }))).toBe("하늘 (나)");
    expect(rosterRowLabel(row("a", "친구"))).toBe("친구");
  });
});

describe("emoji fan", () => {
  it("emoji fan keeps every button size at least 8 px apart (spec §3)", () => {
    for (const size of SIZES) {
      const b = buttonPx(56, size);
      const p = fanPositions(6, fanRadius(b, 6));
      expect(p).toHaveLength(6);
      for (let i = 1; i < p.length; i++)
        expect(Math.hypot(p[i].dx - p[i - 1].dx, p[i].dy - p[i - 1].dy)).toBeGreaterThanOrEqual(
          b + MIN_GAP_PX - 1e-6,
        );
    }
  });

  it("fanPositions: a half circle from 180° (left) to 0° (right), up is negative y", () => {
    const r = 100;
    const p = fanPositions(6, r);
    expect(p[0].dx).toBeCloseTo(-r, 9);
    expect(p[0].dy).toBeCloseTo(0, 9);
    expect(p[5].dx).toBeCloseTo(r, 9);
    expect(p[5].dy).toBeCloseTo(0, 9);
    for (const q of p) {
      expect(q.dy).toBeLessThanOrEqual(0);
      expect(Math.hypot(q.dx, q.dy)).toBeCloseTo(r, 9);
    }
    // Left to right: dx strictly increases.
    for (let i = 1; i < p.length; i++) expect(p[i].dx).toBeGreaterThan(p[i - 1].dx);
  });

  it("fanRadius is the smallest whole-px radius that keeps the gap, and grows with the button", () => {
    const b = 56;
    const r = fanRadius(b, 6);
    expect(Number.isInteger(r)).toBe(true);
    const chord = (rad: number) => 2 * rad * Math.sin(Math.PI / (2 * 5));
    expect(chord(r)).toBeGreaterThanOrEqual(b + MIN_GAP_PX);
    expect(chord(r - 1)).toBeLessThan(b + MIN_GAP_PX);
    expect(fanRadius(70, 6)).toBeGreaterThan(fanRadius(48, 6));
  });

  it("fanPositions / fanRadius degrade safely for 0 and 1 button", () => {
    expect(fanPositions(0, 100)).toEqual([]);
    expect(fanRadius(56, 0)).toBe(0);
    expect(fanRadius(56, 1)).toBe(0);
    const one = fanPositions(1, 100);
    expect(one).toHaveLength(1);
    expect(one[0].dx).toBeCloseTo(0, 9);
    expect(one[0].dy).toBeCloseTo(-100, 9);
  });

  it("fanButtonPx keeps the emoji button's size where the fan fits and shrinks it (never under 48) where not", () => {
    expect(fanButtonPx(56, 6, 375)).toBe(56);
    expect(fanButtonPx(70, 6, 375)).toBe(70);
    // 320 px phone at 크게: the 70 px fan is 322 px wide — it shrinks until fan + 2 × 8 px fits.
    const b = fanButtonPx(70, 6, 320);
    expect(b).toBeLessThan(70);
    expect(b).toBeGreaterThanOrEqual(MIN_TOUCH_PX);
    expect(2 * fanRadius(b, 6) + b + 2 * MIN_GAP_PX).toBeLessThanOrEqual(320);
    expect(2 * fanRadius(b + 1, 6) + b + 1 + 2 * MIN_GAP_PX).toBeGreaterThan(320);
    expect(fanButtonPx(70, 6, 10)).toBe(MIN_TOUCH_PX); // nothing fits: the floor
  });

  it("clampFanCenterX keeps the fan inside a 375 px screen", () => {
    const b = 56,
      r = fanRadius(b, 6),
      cx = clampFanCenterX(247, r, b, 375);
    expect(cx + r + b / 2).toBeLessThanOrEqual(375 - MIN_GAP_PX + 1e-9);
    expect(cx - r - b / 2).toBeGreaterThanOrEqual(MIN_GAP_PX - 1e-9);
  });

  it("clampFanCenterX pulls a too-far-left centre back inside and leaves a fitting one alone", () => {
    const b = 56,
      r = fanRadius(b, 6);
    expect(clampFanCenterX(20, r, b, 375)).toBeCloseTo(MIN_GAP_PX + r + b / 2, 9);
    expect(clampFanCenterX(200, r, b, 375)).toBe(200);
  });

  it("clampFanCenterX centres a fan that is wider than the screen", () => {
    expect(clampFanCenterX(50, 400, 56, 300)).toBe(150);
  });
});

describe("rectGap", () => {
  const a: Rect = { x: 0, y: 0, w: 10, h: 10 };
  it("is 0 for touching or overlapping rects", () => {
    expect(rectGap(a, { x: 10, y: 0, w: 10, h: 10 })).toBe(0);
    expect(rectGap(a, { x: 5, y: 5, w: 10, h: 10 })).toBe(0);
  });
  it("is the straight gap along one axis", () => {
    expect(rectGap(a, { x: 18, y: 0, w: 10, h: 10 })).toBe(8);
    expect(rectGap({ x: 0, y: 30, w: 10, h: 10 }, a)).toBe(20);
  });
  it("is the corner-to-corner distance for diagonal rects", () => {
    expect(rectGap(a, { x: 13, y: 14, w: 10, h: 10 })).toBe(5);
  });
  it("measures round shapes as circles: two circles use the centre distance minus both radii", () => {
    const c1: Rect = { x: 0, y: 0, w: 10, h: 10, round: true };
    // Centres (5, 5) and (18, 18): 13·√2 ≈ 18.4 apart, radii 5 + 5. (The boxes would be only
    // 3 px apart on each axis: a corner gap of 4.24.)
    const c2: Rect = { x: 13, y: 13, w: 10, h: 10, round: true };
    expect(rectGap(c1, c2)).toBeCloseTo(Math.hypot(13, 13) - 10, 9);
    expect(rectGap(c1, { x: 5, y: 5, w: 10, h: 10, round: true })).toBe(0); // overlapping circles
  });
  it("a circle against a box: the circle's centre to the box, minus the radius", () => {
    const circle: Rect = { x: 0, y: 0, w: 10, h: 10, round: true };
    const box: Rect = { x: 23, y: 0, w: 10, h: 10 };
    expect(rectGap(circle, box)).toBe(18 - 5);
    expect(rectGap(box, circle)).toBe(18 - 5);
    expect(rectGap(circle, { x: 8, y: 0, w: 10, h: 10 })).toBe(0); // the box reaches the circle
  });
  it("two fan-sized circles 78 px apart centre to centre are 8 px apart (the boxes would not be)", () => {
    const b = 70;
    const c1: Rect = { x: 0, y: 0, w: b, h: b, round: true };
    const c2: Rect = { x: 24, y: 74, w: b, h: b, round: true }; // centre distance hypot(24, 74) = 77.8
    expect(rectGap(c1, c2)).toBeCloseTo(Math.hypot(24, 74) - b, 9);
    expect(rectGap({ ...c1, round: false }, { ...c2, round: false })).toBeCloseTo(4, 9);
  });
});

/** Every pair of rects must be MIN_GAP_PX apart; returns the offending pairs. */
function crowded(rects: readonly Rect[]): string[] {
  const bad: string[] = [];
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++) {
      const g = rectGap(rects[i], rects[j]);
      if (g < MIN_GAP_PX - 1e-9) {
        bad.push(`#${i} ${JSON.stringify(rects[i])} vs #${j} ${JSON.stringify(rects[j])} gap ${g.toFixed(2)}`);
      }
    }
  return bad;
}

function inside(r: Rect, vw: number, vh: number, margin: number): boolean {
  const e = 1e-9;
  return r.x >= margin - e && r.y >= margin - e && r.x + r.w <= vw - margin + e && r.y + r.h <= vh - margin + e;
}

const VIEWPORTS: readonly { vw: number; vh: number }[] = [
  { vw: 320, vh: 568 },
  { vw: 360, vh: 640 },
  { vw: 375, vh: 812 },
  { vw: 390, vh: 844 },
  { vw: 412, vh: 915 },
  { vw: 479, vh: 900 },
  { vw: 480, vh: 800 },
  { vw: 568, vh: 320 },
  { vw: 667, vh: 375 },
  { vw: 812, vh: 375 },
  { vw: 844, vh: 390 },
  { vw: 932, vh: 430 },
  { vw: 1024, vh: 768 },
];

describe("touch HUD layout (375×812, buttonSize large — the tightest phone case)", () => {
  const layout = (): TouchHudLayout =>
    touchHudLayout({ vw: 375, vh: 812, safe: NO_INSETS, size: "large", leftHanded: false });

  it("stacks the bottom-right cluster in two rows: jump below, action + emoji above, chat left of the jump", () => {
    const l = layout();
    expect(l.narrow).toBe(true);
    // Sizes: jump 90, action 75, emoji 70, chat 70, top buttons 60 (72/60/56/56/48 × 1.25).
    expect([l.jump.w, l.action.w, l.emoji.w, l.chat.w, l.topButtons[0].w]).toEqual([90, 75, 70, 70, 60]);
    // Jump hugs the bottom-right edge (16 px).
    expect(l.jump.x + l.jump.w).toBe(375 - 16);
    expect(l.jump.y + l.jump.h).toBe(812 - 16);
    // Action is centred right above the jump, 12 px apart.
    expect(l.action.y + l.action.h).toBe(l.jump.y - 12);
    expect(l.action.x + l.action.w / 2).toBeCloseTo(l.jump.x + l.jump.w / 2, 9);
    // Emoji sits on the action's row, to its left.
    expect(l.emoji.y + l.emoji.h).toBe(l.action.y + l.action.h);
    expect(l.emoji.x + l.emoji.w + MIN_GAP_PX).toBe(l.action.x);
    // Chat is on the jump's row, directly left of it, in the right half (the stick owns the left half).
    expect(l.chat.y + l.chat.h).toBe(l.jump.y + l.jump.h);
    expect(l.chat.x + l.chat.w + MIN_GAP_PX).toBe(l.jump.x);
    expect(l.chat.x).toBeGreaterThanOrEqual(375 / 2);
  });

  it("keeps every touch button at least 8 px apart", () => {
    expect(crowded(restRects(layout()))).toEqual([]);
  });

  it("keeps the fan open state (jump, action and chat are hidden) at least 8 px apart too", () => {
    expect(crowded(fanOpenRects(layout()))).toEqual([]);
  });

  it("every button is at least 48 px and at least 8 px inside the screen", () => {
    const l = layout();
    for (const r of [...restRects(l), ...fanOpenRects(l)]) {
      expect(r.w).toBeGreaterThanOrEqual(MIN_TOUCH_PX);
      expect(r.h).toBeGreaterThanOrEqual(MIN_TOUCH_PX);
      expect(inside(r, 375, 812, MIN_GAP_PX)).toBe(true);
    }
  });

  it("the top-right group is four 60 px buttons 8 px apart, 12 px from the corner", () => {
    const l = layout();
    expect(l.topButtons).toHaveLength(4);
    expect(l.topButtons[3].x + l.topButtons[3].w).toBe(375 - 12);
    expect(l.topButtons[0].y).toBe(12);
    for (let i = 1; i < 4; i++) {
      expect(l.topButtons[i].x - (l.topButtons[i - 1].x + l.topButtons[i - 1].w)).toBe(8);
    }
    // The left column (space name chip, 👥, chat log toggle) fits left of the group with a gap.
    expect(rectGap(l.roster, l.topButtons[0])).toBeGreaterThanOrEqual(MIN_GAP_PX);
  });

  it("a 360 px or 320 px screen shrinks the top row (never under 48 px) instead of touching the column", () => {
    const at = (vw: number) =>
      touchHudLayout({ vw, vh: 800, safe: NO_INSETS, size: "large", leftHanded: false });
    expect(at(375).topPx).toBe(60);
    expect(at(360).topPx).toBe(58);
    expect(at(320).topPx).toBe(48);
    for (const vw of [320, 360]) {
      const l = at(vw);
      expect(rectGap(l.roster, l.topButtons[0])).toBeGreaterThanOrEqual(MIN_GAP_PX);
      expect(l.topButtons.every((r) => r.w === l.topPx && r.h === l.topPx)).toBe(true);
    }
    // Wide screens keep the chosen size.
    expect(at(812).topPx).toBe(60);
  });

  it("left-handed mirrors the whole HUD, top and bottom", () => {
    const right = layout();
    const left = touchHudLayout({ vw: 375, vh: 812, safe: NO_INSETS, size: "large", leftHanded: true });
    const mirror = (r: Rect): Rect => ({ ...r, x: 375 - r.x - r.w });
    expect(left.jump).toEqual(mirror(right.jump));
    expect(left.action).toEqual(mirror(right.action));
    expect(left.emoji).toEqual(mirror(right.emoji));
    expect(left.chat).toEqual(mirror(right.chat));
    expect(left.roster).toEqual(mirror(right.roster));
    expect(left.chatLog).toEqual(mirror(right.chatLog));
    // Strict mirror: button i keeps its meaning, so the menu button ends up in the top-left corner.
    expect(left.topButtons).toEqual(right.topButtons.map(mirror));
    expect(left.jump.x).toBe(16);
    expect(left.topButtons[3].x).toBe(12);
    expect(crowded(restRects(left))).toEqual([]);
    expect(crowded(fanOpenRects(left))).toEqual([]);
  });
});

describe("touch HUD layout across sizes, hands and phone screens", () => {
  for (const { vw, vh } of VIEWPORTS) {
    for (const size of SIZES) {
      for (const leftHanded of [false, true]) {
        const name = `${vw}×${vh} ${size} ${leftHanded ? "left" : "right"}-handed`;
        it(`${name}: every button is >= 48 px, >= 8 px apart and on screen`, () => {
          const l = touchHudLayout({ vw, vh, safe: NO_INSETS, size, leftHanded });
          expect(crowded(restRects(l))).toEqual([]);
          for (const r of restRects(l)) {
            expect(r.w).toBeGreaterThanOrEqual(MIN_TOUCH_PX);
            expect(r.h).toBeGreaterThanOrEqual(MIN_TOUCH_PX);
            expect(inside(r, vw, vh, MIN_GAP_PX)).toBe(true);
          }
        });
        it(`${name}: the open emoji fan fits and stays 8 px from the buttons that stay`, () => {
          const l = touchHudLayout({ vw, vh, safe: NO_INSETS, size, leftHanded });
          expect(l.fan).toHaveLength(EMOJIS.length);
          expect(crowded(fanOpenRects(l))).toEqual([]);
          for (const r of l.fan) expect(inside(r, vw, vh, MIN_GAP_PX)).toBe(true);
        });
      }
    }
  }

  it("two rows below HUD_NARROW_BELOW_PX, one row (emoji left of the jump, chat centred) from it", () => {
    expect(HUD_NARROW_BELOW_PX).toBe(480);
    const narrow = touchHudLayout({ vw: 479, vh: 900, safe: NO_INSETS, size: "large", leftHanded: false });
    const wide = touchHudLayout({ vw: 480, vh: 900, safe: NO_INSETS, size: "large", leftHanded: false });
    expect(narrow.narrow).toBe(true);
    expect(wide.narrow).toBe(false);
    expect(wide.emoji.y + wide.emoji.h).toBe(wide.jump.y + wide.jump.h);
    expect(wide.emoji.x + wide.emoji.w + MIN_GAP_PX).toBe(wide.jump.x);
    expect(wide.chat.x + wide.chat.w / 2).toBeCloseTo(480 / 2, 9);
    expect(wide.action.y + wide.action.h).toBe(wide.jump.y - 12);
  });

  it("safe-area insets move the HUD in from the notch and the home bar", () => {
    const safe: SafeInsets = { top: 47, right: 0, bottom: 34, left: 0 };
    const a = touchHudLayout({ vw: 375, vh: 812, safe: NO_INSETS, size: "medium", leftHanded: false });
    const b = touchHudLayout({ vw: 375, vh: 812, safe, size: "medium", leftHanded: false });
    expect(b.jump.y).toBe(a.jump.y - 34);
    expect(b.topButtons[0].y).toBe(a.topButtons[0].y + 47);
    expect(b.roster.y).toBe(a.roster.y + 47);
    expect(crowded(restRects(b))).toEqual([]);

    const side: SafeInsets = { top: 0, right: 47, bottom: 21, left: 47 };
    const landscape = touchHudLayout({ vw: 812, vh: 375, safe: side, size: "large", leftHanded: false });
    expect(landscape.jump.x + landscape.jump.w).toBe(812 - 47 - 16);
    expect(landscape.topButtons[3].x + landscape.topButtons[3].w).toBe(812 - 47 - 12);
    expect(landscape.roster.x).toBe(47 + 12);
    expect(crowded(restRects(landscape))).toEqual([]);
    expect(crowded(fanOpenRects(landscape))).toEqual([]);
  });

  it("the left column hangs from the corner opposite the top group (side + offsets)", () => {
    const r = touchHudLayout({ vw: 375, vh: 812, safe: NO_INSETS, size: "medium", leftHanded: false });
    expect(r.column).toMatchObject({ side: "left", inset: 12, top: 12 });
    const l = touchHudLayout({ vw: 375, vh: 812, safe: NO_INSETS, size: "medium", leftHanded: true });
    expect(l.column).toMatchObject({ side: "right", inset: 12, top: 12 });
  });

  it("the column's height cap keeps it 8 px above every bottom button it could meet, and on screen", () => {
    const SAFE: SafeInsets = { top: 0, right: 0, bottom: 0, left: 0 };
    for (const { vw, vh } of VIEWPORTS) {
      for (const size of SIZES) {
        for (const leftHanded of [false, true]) {
          const l = touchHudLayout({ vw, vh, safe: SAFE, size, leftHanded });
          const { side, inset, top, maxHeight } = l.column;
          const colW = Math.min(300, vw - 24);
          const x0 = side === "left" ? inset : vw - inset - colW;
          const col: Rect = { x: x0, y: top, w: colW, h: maxHeight };
          const where = `${vw}×${vh} ${size} ${leftHanded ? "left" : "right"}`;
          expect(maxHeight, where).toBeGreaterThan(0);
          expect(top + maxHeight, where).toBeLessThanOrEqual(vh - MIN_GAP_PX + 1e-9);
          for (const r of [l.jump, l.action, l.emoji, l.chat]) {
            expect(rectGap(col, r), `${where} column vs ${JSON.stringify(r)}`).toBeGreaterThanOrEqual(MIN_GAP_PX - 1e-9);
          }
        }
      }
    }
  });

  it("375×812 large: the column may use most of the height above the cluster; a landscape phone has the whole left side", () => {
    const SAFE: SafeInsets = { top: 0, right: 0, bottom: 0, left: 0 };
    const portrait = touchHudLayout({ vw: 375, vh: 812, safe: SAFE, size: "large", leftHanded: false });
    // The cluster's top is the action button (y = 619; the emoji row is at 624): 619 - 8 - 12 = 599 px.
    expect(portrait.column.maxHeight).toBe(Math.min(portrait.emoji.y, portrait.action.y) - MIN_GAP_PX - portrait.column.top);
    expect(portrait.column.maxHeight).toBe(599);
    const landscape = touchHudLayout({ vw: 812, vh: 375, safe: SAFE, size: "large", leftHanded: false });
    expect(landscape.column.maxHeight).toBe(375 - MIN_GAP_PX - landscape.column.top);
    const withInsets = touchHudLayout({ vw: 812, vh: 375, safe: { top: 0, right: 47, bottom: 21, left: 47 }, size: "large", leftHanded: false });
    expect(withInsets.column.maxHeight).toBe(375 - 21 - MIN_GAP_PX - withInsets.column.top);
  });
});

import { describe, it, expect } from "vitest";
import { MIN_GAP_PX, type ButtonSize } from "./settings";
import { rectGap, touchHudLayout, type Rect, type SafeInsets } from "./hud";
import {
  COACH_CARD_H_GUESS_PX,
  COACH_CARD_MAX_W_PX,
  COACH_EDGE_PX,
  COACH_LOOK_RAD,
  COACH_ZONE_LIFT_PX,
  COACH_MOVE_M,
  COACH_POLL_MS,
  coachCardWidth,
  coachCopy,
  coachObstacles,
  createCoachPoller,
  createCoachProgress,
  detectCoachEvent,
  nextCoachStep,
  placeCoachCard,
  viewYawOf,
  type CoachEvent,
  type CoachStep,
} from "./coach";

const STEPS: readonly CoachStep[] = ["move", "look", "talk", "done"];
const EVENTS: readonly CoachEvent[] = ["moved", "looked", "talked", "skip", "restart"];

describe("the fixed numbers", () => {
  it("1.5 m of walking, 0.6 rad of looking, checked 5 times a second", () => {
    expect(COACH_MOVE_M).toBe(1.5);
    expect(COACH_LOOK_RAD).toBe(0.6);
    expect(COACH_POLL_MS).toBe(200);
  });
});

describe("nextCoachStep", () => {
  it("advances only on the matching real action", () => {
    expect(nextCoachStep("move", "moved")).toBe("look");
    expect(nextCoachStep("look", "looked")).toBe("talk");
    expect(nextCoachStep("talk", "talked")).toBe("done");
  });

  it("ignores out-of-order actions (talking during ① does not skip ahead)", () => {
    expect(nextCoachStep("move", "talked")).toBe("move");
    expect(nextCoachStep("move", "looked")).toBe("move");
    expect(nextCoachStep("look", "moved")).toBe("look");
    expect(nextCoachStep("look", "talked")).toBe("look");
    expect(nextCoachStep("talk", "moved")).toBe("talk");
    expect(nextCoachStep("talk", "looked")).toBe("talk");
  });

  it("skip ends from any step; restart returns to ①", () => {
    for (const s of STEPS) {
      expect(nextCoachStep(s, "skip")).toBe("done");
      expect(nextCoachStep(s, "restart")).toBe("move");
    }
    // …and walking through the whole guide then restarting starts it over.
    let step: CoachStep = "move";
    for (const ev of ["moved", "looked", "talked"] as const) step = nextCoachStep(step, ev);
    expect(step).toBe("done");
    expect(nextCoachStep(step, "restart")).toBe("move");
  });

  it("a finished guide stays finished for every real action", () => {
    for (const ev of ["moved", "looked", "talked"] as const) {
      expect(nextCoachStep("done", ev)).toBe("done");
    }
  });

  it("only restart and skip can change a step by themselves: the table has exactly three forward moves", () => {
    const forward: string[] = [];
    for (const s of STEPS)
      for (const ev of EVENTS) {
        const n = nextCoachStep(s, ev);
        if (n !== s && ev !== "skip" && ev !== "restart") forward.push(`${s}+${ev}=${n}`);
      }
    expect(forward).toEqual(["move+moved=look", "look+looked=talk", "talk+talked=done"]);
  });
});

describe("detectCoachEvent — ① move", () => {
  it("fires once the player is COACH_MOVE_M (straight line) from where the step began", () => {
    const p = createCoachProgress(10, -4, 0);
    expect(detectCoachEvent("move", p, 10, -4, 0)).toBeNull();
    expect(detectCoachEvent("move", p, 10, -4 - 1.49, 0)).toBeNull();
    expect(detectCoachEvent("move", p, 10, -4 - 1.5, 0)).toBe("moved");
    expect(detectCoachEvent("move", p, 10 + 1.0, -4 + 1.2, 0)).toBe("moved"); // hypot(1, 1.2) = 1.56
  });

  it("measures from the start spot, not step by step (a slow walk still adds up)", () => {
    const p = createCoachProgress(0, 0, 0);
    let ev: CoachEvent | null = null;
    for (let i = 1; i <= 20 && !ev; i++) ev = detectCoachEvent("move", p, 0.1 * i, 0, 0); // 0.1 m per poll
    expect(ev).toBe("moved");
    expect(p.startX).toBe(0); // the start spot is only ever replaced by createCoachProgress
  });

  it("a turn during ① does not count (and ① is not completed by looking)", () => {
    const p = createCoachProgress(0, 0, 0);
    expect(detectCoachEvent("move", p, 0, 0, 2)).toBeNull();
    expect(p.lookAccum).toBe(0);
    expect(p.lastYaw).toBe(2); // the baseline follows the view, so ② starts from where it is
  });
});

describe("detectCoachEvent — ② look", () => {
  it("fires after COACH_LOOK_RAD of accumulated turning, either direction", () => {
    const left = createCoachProgress(0, 0, 0);
    expect(detectCoachEvent("look", left, 0, 0, 0.3)).toBeNull();
    expect(detectCoachEvent("look", left, 0, 0, 0.59)).toBeNull();
    expect(detectCoachEvent("look", left, 0, 0, 0.6)).toBe("looked");

    const right = createCoachProgress(0, 0, 0);
    expect(detectCoachEvent("look", right, 0, 0, -0.61)).toBe("looked");
  });

  it("accumulates: back-and-forth turning adds up instead of cancelling", () => {
    const p = createCoachProgress(0, 0, 0);
    expect(detectCoachEvent("look", p, 0, 0, 0.25)).toBeNull();
    expect(detectCoachEvent("look", p, 0, 0, -0.05)).toBeNull(); // 0.25 + 0.30
    expect(p.lookAccum).toBeCloseTo(0.55, 9);
    expect(detectCoachEvent("look", p, 0, 0, 0.2)).toBe("looked"); // + 0.25
  });

  it("is wrap-safe across ±π: crossing the seam adds the short way round", () => {
    const p = createCoachProgress(0, 0, Math.PI - 0.1);
    // +0.1 + 0.1 rad of turning, yaw jumps from +3.04 to -3.04 (= 2π − 0.2 apart numerically).
    expect(detectCoachEvent("look", p, 0, 0, -Math.PI + 0.1)).toBeNull();
    expect(p.lookAccum).toBeCloseTo(0.2, 9);
    // …and the other way across it.
    expect(detectCoachEvent("look", p, 0, 0, Math.PI - 0.15)).toBeNull();
    expect(p.lookAccum).toBeCloseTo(0.45, 9);
    expect(detectCoachEvent("look", p, 0, 0, Math.PI - 0.45)).toBe("looked");
  });

  it("a yaw that never moves never fires, and a lone wrap does not fake a 2π turn", () => {
    const still = createCoachProgress(0, 0, Math.PI);
    for (let i = 0; i < 50; i++) expect(detectCoachEvent("look", still, 0, 0, Math.PI)).toBeNull();
    expect(still.lookAccum).toBe(0);

    const seam = createCoachProgress(0, 0, Math.PI - 0.01);
    expect(detectCoachEvent("look", seam, 0, 0, -Math.PI + 0.01)).toBeNull(); // 0.02 rad, not 6.26
    expect(seam.lookAccum).toBeCloseTo(0.02, 9);
  });

  it("a turn of more than π between two checks is the shorter way (the detector samples, it cannot see the path)", () => {
    const p = createCoachProgress(0, 0, 0);
    // π + 0.5 is −(π − 0.5): 2.64 rad the short way, not 3.64 the long way.
    expect(detectCoachEvent("look", p, 0, 0, Math.PI + 0.5)).toBe("looked");
    expect(p.lookAccum).toBeCloseTo(Math.PI - 0.5, 9);
  });

  it("walking during ② does not count, and the position is irrelevant", () => {
    const p = createCoachProgress(0, 0, 0);
    expect(detectCoachEvent("look", p, 50, 50, 0)).toBeNull();
    expect(p.lookAccum).toBe(0);
  });

  it("a NaN yaw is ignored and does not poison the later turns", () => {
    const p = createCoachProgress(0, 0, 0.1);
    expect(detectCoachEvent("look", p, 0, 0, Number.NaN)).toBeNull();
    expect(p.lookAccum).toBe(0);
    expect(p.lastYaw).toBe(0.1);
    expect(detectCoachEvent("look", p, 0, 0, 0.8)).toBe("looked");
  });
});

describe("detectCoachEvent — ③ and done", () => {
  it("measures nothing (a sent chat line reports talked)", () => {
    const p = createCoachProgress(0, 0, 0);
    expect(detectCoachEvent("talk", p, 99, 99, 3)).toBeNull();
    expect(detectCoachEvent("done", p, 99, 99, -3)).toBeNull();
  });
});

describe("coachCopy", () => {
  it("copy is Korean for both devices", () => {
    expect(coachCopy("move", true).title).toBe("① 움직이기");
    expect(coachCopy("move", false).title).toBe("① 움직이기");
    expect(coachCopy("look", true).title).toBe("② 둘러보기");
    expect(coachCopy("talk", false).title).toBe("③ 말하기");
  });

  it("is the fixed text, phone and PC", () => {
    expect(coachCopy("move", true).body).toBe("화면 왼쪽 아래를 누른 채 밀어 보세요. 끝까지 밀면 달려요.");
    expect(coachCopy("move", false).body).toBe("W A S D(또는 방향키)로 걸어 보세요. Shift를 누르면 달려요.");
    expect(coachCopy("look", true).body).toBe("화면 오른쪽을 한 손가락으로 끌어 보세요. 두 손가락으로 벌리면 확대돼요.");
    expect(coachCopy("look", false).body).toBe("마우스를 끌거나 Z·C 키로 둘러보세요. 휠로 확대해요.");
    expect(coachCopy("talk", true).body).toBe("아래 💬 버튼을 눌러 인사해 보세요.");
    expect(coachCopy("talk", false).body).toBe("Enter 또는 / 를 누르고 인사해 보세요.");
  });

  it("every card is Korean text with a Hangul title and body", () => {
    for (const step of ["move", "look", "talk"] as const)
      for (const touch of [true, false]) {
        const c = coachCopy(step, touch);
        expect(c.title).toMatch(/[가-힣]/);
        expect(c.body).toMatch(/[가-힣]/);
      }
  });

  it("a left-handed phone swaps 왼쪽 / 오른쪽 (the layout is mirrored); nothing else changes", () => {
    expect(coachCopy("move", true, true).body).toBe("화면 오른쪽 아래를 누른 채 밀어 보세요. 끝까지 밀면 달려요.");
    expect(coachCopy("look", true, true).body).toBe("화면 왼쪽을 한 손가락으로 끌어 보세요. 두 손가락으로 벌리면 확대돼요.");
    expect(coachCopy("talk", true, true)).toEqual(coachCopy("talk", true, false));
    for (const step of ["move", "look", "talk"] as const) {
      expect(coachCopy(step, false, true)).toEqual(coachCopy(step, false, false)); // a PC has no hands
      expect(coachCopy(step, true, true).title).toBe(coachCopy(step, true, false).title);
    }
  });
});

// ───────────────────────────── phone placement ─────────────────────────────

const SIZES: readonly ButtonSize[] = ["small", "medium", "large"];
const NO_INSETS: SafeInsets = { top: 0, right: 0, bottom: 0, left: 0 };
/** A portrait phone's notch + home bar, and a landscape phone's side notches + home bar. */
const NOTCH_PORTRAIT: SafeInsets = { top: 47, right: 0, bottom: 34, left: 0 };
const NOTCH_LANDSCAPE: SafeInsets = { top: 0, right: 47, bottom: 21, left: 47 };
interface Phone {
  vw: number;
  vh: number;
  /** The insets this screen really comes with (a notch only on the phones that have one). */
  safes: readonly SafeInsets[];
}
const BOTH = [false, true] as const;
const PHONES: readonly Phone[] = [
  { vw: 320, vh: 568, safes: [NO_INSETS] },
  { vw: 360, vh: 640, safes: [NO_INSETS] },
  { vw: 375, vh: 812, safes: [NO_INSETS, NOTCH_PORTRAIT] },
  { vw: 390, vh: 844, safes: [NO_INSETS, NOTCH_PORTRAIT] },
  { vw: 412, vh: 915, safes: [NO_INSETS] },
  { vw: 480, vh: 800, safes: [NO_INSETS] },
  { vw: 568, vh: 320, safes: [NO_INSETS] },
  { vw: 667, vh: 375, safes: [NO_INSETS] },
  { vw: 812, vh: 375, safes: [NO_INSETS, NOTCH_LANDSCAPE] },
  { vw: 844, vh: 390, safes: [NO_INSETS, NOTCH_LANDSCAPE] },
  { vw: 932, vh: 430, safes: [NO_INSETS, NOTCH_LANDSCAPE] },
  { vw: 1024, vh: 768, safes: [NO_INSETS] },
];
const PLACED: readonly ("move" | "look" | "talk")[] = ["move", "look", "talk"];

function placeAll(
  vw: number,
  vh: number,
  size: ButtonSize,
  leftHanded: boolean,
  safe: SafeInsets,
  h = COACH_CARD_H_GUESS_PX,
) {
  const layout = touchHudLayout({ vw, vh, safe, size, leftHanded });
  const w = coachCardWidth(vw, safe);
  const obstacles = coachObstacles(layout);
  return PLACED.map((step) => {
    const card = placeCoachCard(step, { vw, vh, safe, leftHanded, layout, w, h });
    return { step, card, layout, obstacles };
  });
}

describe("coachCardWidth", () => {
  it("is 300 px, or what fits between the edges on a narrow screen", () => {
    expect(coachCardWidth(375, NO_INSETS)).toBe(300);
    expect(coachCardWidth(320, NO_INSETS)).toBe(296);
    expect(coachCardWidth(375, { ...NO_INSETS, left: 40, right: 40 })).toBe(375 - 80 - 2 * COACH_EDGE_PX);
    expect(coachCardWidth(1024, NO_INSETS)).toBe(COACH_CARD_MAX_W_PX);
  });
});

/** The HUD buttons a card is too close to (gaps under 8 px), or [] when it keeps clear of all of them. */
function tooClose(card: Rect, obstacles: readonly Rect[]): number[] {
  return obstacles.map((o) => rectGap(card, o)).filter((g) => g < MIN_GAP_PX - 1e-6);
}

describe("placeCoachCard — keeps 8 px from every HUD button (the card never hides a control)", () => {
  for (const { vw, vh, safes } of PHONES) {
    for (const size of SIZES) {
      for (const leftHanded of BOTH) {
        {
          it(`${vw}×${vh} ${size} ${leftHanded ? "left" : "right"}-handed`, () => {
            for (const safe of safes) {
              for (const { step, card, obstacles } of placeAll(vw, vh, size, leftHanded, safe)) {
                const where = `${step} @ ${JSON.stringify(card)} insets ${JSON.stringify(safe)}`;
                // inside the screen's margins
                expect(card.x, where).toBeGreaterThanOrEqual(safe.left + COACH_EDGE_PX - 1e-9);
                expect(card.y, where).toBeGreaterThanOrEqual(safe.top + COACH_EDGE_PX - 1e-9);
                expect(card.x + card.w, where).toBeLessThanOrEqual(vw - safe.right - COACH_EDGE_PX + 1e-9);
                expect(card.y + card.h, where).toBeLessThanOrEqual(vh - safe.bottom - COACH_EDGE_PX + 1e-9);
                // 8 px from every obstacle
                expect(tooClose(card, obstacles), where).toEqual([]);
              }
            }
          });
        }
      }
    }
  }

  it("a taller card (4 lines of text) still finds a free spot on a normal portrait phone", () => {
    for (const { vw, vh } of PHONES.filter((v) => v.vh >= 640))
      for (const leftHanded of BOTH)
        for (const { step, card, obstacles } of placeAll(vw, vh, "large", leftHanded, NO_INSETS, 150)) {
          expect(tooClose(card, obstacles), `${vw}×${vh} ${step} ${leftHanded}`).toEqual([]);
        }
  });

  it("on a screen too small for the HUD plus a card (568×320, notched) it falls back to the least crowded spot, inside the margins", () => {
    const vw = 568;
    const vh = 320;
    const safe = NOTCH_LANDSCAPE;
    for (const { step, card, obstacles } of placeAll(vw, vh, "large", false, safe)) {
      expect(card.x, step).toBeGreaterThanOrEqual(safe.left + COACH_EDGE_PX - 1e-9);
      expect(card.y, step).toBeGreaterThanOrEqual(safe.top + COACH_EDGE_PX - 1e-9);
      expect(card.x + card.w, step).toBeLessThanOrEqual(vw - safe.right - COACH_EDGE_PX + 1e-9);
      expect(card.y + card.h, step).toBeLessThanOrEqual(vh - safe.bottom - COACH_EDGE_PX + 1e-9);
      // No other spot comes short by less in total: compare with the four corners and the centre.
      const shortfall = (c: Rect) => obstacles.reduce((t, o) => t + Math.max(0, MIN_GAP_PX - rectGap(c, o)), 0);
      const w = card.w;
      const h = card.h;
      const minX = safe.left + COACH_EDGE_PX;
      const maxX = vw - safe.right - COACH_EDGE_PX - w;
      const minY = safe.top + COACH_EDGE_PX;
      const maxY = vh - safe.bottom - COACH_EDGE_PX - h;
      for (const [x, y] of [[minX, minY], [maxX, minY], [minX, maxY], [maxX, maxY], [(minX + maxX) / 2, (minY + maxY) / 2]]) {
        expect(shortfall(card), `${step} vs (${x}, ${y})`).toBeLessThanOrEqual(shortfall({ x, y, w, h }) + 1e-6);
      }
    }
  });
});

describe("placeCoachCard — where each card goes", () => {
  const at = (vw: number, vh: number, leftHanded: boolean, size: ButtonSize = "medium") => {
    const [move, look, talk] = placeAll(vw, vh, size, leftHanded, NO_INSETS);
    return { move: move.card, look: look.card, talk: talk.card, layout: move.layout };
  };

  it("375×812 right-handed: ① hugs the left edge just above the stick zone, ② sits on the right under the top buttons, ③ is above the 💬 button", () => {
    const { move, look, talk, layout } = at(375, 812, false);
    // ①: flush left, bottom 8 px + the avatar-head lift above the zone (y = 406).
    expect(move.x).toBe(COACH_EDGE_PX);
    expect(move.y + move.h).toBeCloseTo(406 - MIN_GAP_PX - COACH_ZONE_LIFT_PX, 6);
    // ②: flush right, below the top button row.
    expect(look.x + look.w).toBe(375 - COACH_EDGE_PX);
    expect(look.y).toBeGreaterThanOrEqual(layout.topGroup.y + layout.topGroup.h + MIN_GAP_PX);
    // ③: entirely above the bottom cluster (emoji/action/jump/💬), over the 💬's side of the screen.
    expect(talk.y + talk.h).toBeLessThanOrEqual(Math.min(layout.emoji.y, layout.action.y, layout.chat.y) - MIN_GAP_PX + 1e-6);
    expect(talk.x + talk.w).toBe(375 - COACH_EDGE_PX);
  });

  it("left-handed mirrors ① and ② (the stick and the look half swap sides)", () => {
    const { move, look } = at(375, 812, true);
    expect(move.x + move.w).toBe(375 - COACH_EDGE_PX); // ① above the right-hand stick zone
    expect(move.y + move.h).toBeCloseTo(406 - MIN_GAP_PX - COACH_ZONE_LIFT_PX, 6);
    expect(look.x).toBe(COACH_EDGE_PX); // ② on the left, the look half
  });

  it("on a wide screen ③ is centred over the centred 💬 button", () => {
    const { talk, layout } = at(1024, 768, false);
    expect(talk.x + talk.w / 2).toBeCloseTo(layout.chat.x + layout.chat.w / 2, 0);
    expect(talk.y + talk.h).toBeCloseTo(layout.chat.y - MIN_GAP_PX, 6);
  });

  it("① on a short landscape phone stays out of the stick zone when there is room beside the top-left buttons", () => {
    const { move } = at(812, 375, false);
    expect(move.y + move.h).toBeLessThanOrEqual(375 / 2 + 1e-6);
  });

  it("① covers none of the stick zone's lower half on any portrait phone", () => {
    for (const { vw, vh } of PHONES.filter((v) => v.vh > v.vw && v.vh >= 640))
      for (const leftHanded of [false, true]) {
        const { move } = at(vw, vh, leftHanded);
        expect(move.y + move.h, `${vw}×${vh}`).toBeLessThanOrEqual(vh / 2 + 1e-6);
      }
  });

  it("is deterministic (same input, same card)", () => {
    expect(at(375, 812, false)).toEqual(at(375, 812, false));
  });
});

describe("coachObstacles", () => {
  it("covers every resting button plus the room-name chip", () => {
    const l = touchHudLayout({ vw: 375, vh: 812, safe: NO_INSETS, size: "medium", leftHanded: false });
    const obs = coachObstacles(l);
    expect(obs.length).toBe(4 + 4 + 2 + 1); // jump, action, emoji, 💬 · 4 top buttons · 👥, chat-log toggle · the chip
    const chip = obs[obs.length - 1];
    expect(chip.x).toBe(l.roster.x);
    expect(chip.y + chip.h + MIN_GAP_PX).toBe(l.roster.y); // the chip sits right above 👥
  });

  it("mirrors with the column when left-handed (the chip hangs from the right edge)", () => {
    const l = touchHudLayout({ vw: 375, vh: 812, safe: NO_INSETS, size: "medium", leftHanded: true });
    const obs = coachObstacles(l);
    const chip = obs[obs.length - 1];
    expect(chip.x + chip.w).toBe(l.roster.x + l.roster.w);
  });
});

describe("createCoachPoller — the first poll only takes the baseline", () => {
  it("never reports on its first poll, however far the player is from anywhere", () => {
    for (const step of ["move", "look"] as const) {
      const poller = createCoachPoller();
      expect(poller.poll(step, 40, -25, 2.9), step).toBeNull();
    }
  });

  it("measures walking from where the FIRST poll saw the player", () => {
    const poller = createCoachPoller();
    expect(poller.poll("move", 10, 10, 0)).toBeNull(); // baseline
    expect(poller.poll("move", 10 + COACH_MOVE_M - 0.1, 10, 0)).toBeNull();
    expect(poller.poll("move", 10 + COACH_MOVE_M, 10, 0)).toBe("moved");
  });

  it("a view that jumps between mount and the first poll (a reconnect remount leaving first person) fakes no turn", () => {
    // CoachMarks mounts while the old first-person state is still there (look yaw 2.0); the
    // world's own reset then puts the third-person orbit yaw (0.1) in charge — a 1.9 rad
    // "turn" nobody made. The old code seeded at mount and would call ② done on the next poll.
    const poller = createCoachPoller();
    expect(poller.poll("look", 0, 0, 0.1)).toBeNull(); // first poll: baseline = the settled yaw
    expect(poller.poll("look", 0, 0, 0.1)).toBeNull();
    expect(poller.poll("look", 0, 0, 0.1 + COACH_LOOK_RAD - 0.05)).toBeNull();
    expect(poller.poll("look", 0, 0, 0.1 + COACH_LOOK_RAD + 0.05)).toBe("looked");
  });

  it("a fresh poller (a restart or the next step) starts over: earlier walking and turning never count", () => {
    const first = createCoachPoller();
    first.poll("move", 0, 0, 0);
    expect(first.poll("move", 5, 0, 0)).toBe("moved");
    const second = createCoachPoller();
    expect(second.poll("look", 5, 0, 1)).toBeNull();
    expect(second.poll("look", 5, 0, 1)).toBeNull();
  });
});

describe("viewYawOf — which yaw the player is looking along", () => {
  const orbit = { yaw: 1.25 };

  it("third person: the orbit yaw", () => {
    expect(viewYawOf({ mode: "tp", prevMode: "tp", fpYaw: -2 }, orbit)).toBe(1.25);
  });

  it("first person: the look yaw", () => {
    expect(viewYawOf({ mode: "fp", prevMode: "tp", fpYaw: -2 }, orbit)).toBe(-2);
  });

  it("under the overview map the view underneath counts (prevMode), not the map", () => {
    expect(viewYawOf({ mode: "ov", prevMode: "tp", fpYaw: -2 }, orbit)).toBe(1.25);
    expect(viewYawOf({ mode: "ov", prevMode: "fp", fpYaw: -2 }, orbit)).toBe(-2);
  });
});

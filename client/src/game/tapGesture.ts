/**
 * Touch tap gestures for the look half of the screen (pure).
 *
 * On a phone the right half of the screen is the "look" side: dragging turns the
 * view, a single tap walks to that spot, and a DOUBLE tap swings the camera back
 * behind the character. A single tap is therefore held back for DOUBLE_TAP_MS to
 * see whether a second tap follows (CameraRig owns that timer).
 */

import type { ViewMode } from "./viewMode";

/** A second tap within this many ms of the first makes it a double tap. */
export const DOUBLE_TAP_MS = 300;

/** ...and within this many px of the first. */
export const DOUBLE_TAP_PX = 30;

/** A finished tap: when (ms, any steady clock) and where (screen px). */
export interface TapRecord {
  t: number;
  x: number;
  y: number;
}

/**
 * Whether `next` completes a double tap that began with `prev`: no later than
 * DOUBLE_TAP_MS after it and no farther than DOUBLE_TAP_PX from it (both limits
 * inclusive). With no previous tap it is never a double. CameraRig gives `prev` the
 * first tap's lift and `next` the second one's touch-down (the events' own times) —
 * the gap a phone's own double-tap rule measures (Android: first up to second down),
 * so neither the second press's own length nor a busy page's late handling counts
 * against it (round 4 review: a loaded phone's double tap ran past the window).
 */
export function isDoubleTap(prev: TapRecord | null, next: TapRecord): boolean {
  if (!prev) return false;
  const elapsed = next.t - prev.t;
  if (elapsed < 0 || elapsed > DOUBLE_TAP_MS) return false;
  return Math.hypot(next.x - prev.x, next.y - prev.y) <= DOUBLE_TAP_PX;
}

/**
 * Whether screen x (px) lies in the look half of a viewport `vw` px wide: the
 * right half for right-handed play (x >= vw/2), the left half when `leftHanded`
 * mirrors the layout. The two halves are exact complements; the joystick lives on
 * the other half.
 */
export function isLookHalf(x: number, vw: number, leftHanded: boolean = false): boolean {
  return leftHanded ? x < vw / 2 : x >= vw / 2;
}

/**
 * Whether the held-back single-tap walk may still start when its DOUBLE_TAP_MS timer
 * fires — the world can change during that wait, so it is decided again then:
 *   - the overview map opened (a tap on it is not a walk),
 *   - chat / a panel took the keyboard (`uiCaptured`; the Esc menu captures it while open),
 *   - the player SAT DOWN meanwhile (`seatedNow` but not `seatedAtTap`): a walk target
 *     would stand them straight back up.
 *   - its ring was DROPPED meanwhile (`dropped`: a key, the stick, Esc or a sit cleared it — the player took over):
 *     walking then would bring back a ring that had already gone (round 3 review).
 * A tap made while already seated keeps its meaning — "stand up and go there" — like
 * a mouse click does.
 */
export function canTapWalk(
  mode: ViewMode,
  uiCaptured: boolean,
  seatedAtTap: boolean,
  seatedNow: boolean,
  dropped = false,
): boolean {
  if (mode === "ov" || uiCaptured || dropped) return false;
  return seatedAtTap || !seatedNow;
}

/** The timers held-back work runs on (setTimeout by default; the tests pass fakes). */
export interface TapTimers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const WINDOW_TIMERS: TapTimers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/**
 * Work held back on timers — a tap's pick, its walk, the slices of a plan's way round — dropped all at once when the
 * player's next gesture makes it moot. `onDrop` runs for a piece dropped before it ran (its ring goes with it).
 */
export class HeldWork {
  private readonly held = new Map<unknown, (() => void) | undefined>();
  constructor(private readonly timers: TapTimers = WINDOW_TIMERS) {}

  /** Run `fn` in `ms` unless dropped first. */
  hold(fn: () => void, ms: number, onDrop?: () => void): void {
    const handle = this.timers.set(() => {
      this.held.delete(handle);
      fn();
    }, ms);
    this.held.set(handle, onDrop);
  }

  /** Whether anything is still held. */
  get busy(): boolean {
    return this.held.size > 0;
  }

  /** Drop everything still held (each piece's `onDrop` runs). */
  drop(): void {
    const dropped = [...this.held];
    this.held.clear();
    for (const [handle, onDrop] of dropped) {
      this.timers.clear(handle);
      onDrop?.();
    }
  }
}

/**
 * The look half's taps (CameraRig): one tap walks after DOUBLE_TAP_MS, two recenter the camera. A double tap is decided
 * when the SECOND touch goes DOWN — no later than DOUBLE_TAP_MS after the first one's lift, within DOUBLE_TAP_PX of it —
 * and at that moment everything the first tap was holding back (its pick, its walk, the slices of its plan) is dropped,
 * so the first tap's walk can never start once a second touch has begun, however long that touch is then held (round 5
 * review: a 250 ms gap and a 170 ms second press walked 1 m AND recentred — the decision was made at the second lift,
 * after the first tap's walk timer had fired). Should the second touch's down be handled late, after that walk did start
 * (a busy page), the walk is taken back (`walked`). The second touch's lift then recenters — unless it became a drag
 * (or was cancelled): then it was no double tap at all, and the first tap walks after all, at once (`dragged`; round 6
 * review: a tap and a look-drag begun right after it at the same spot did nothing, where it used to walk).
 */
export class LookTapGate {
  private last: TapRecord | null = null;
  private second: number | null = null;
  private undo: (() => void) | null = null;
  /** The last tap's walk, to run again at once (`tap`) should a second touch that dropped it turn into a drag. */
  private replay: (() => void) | null = null;
  /** The replay of the tap the second touch dropped (`down`), until that touch lifts as a tap or turns into a drag. */
  private dropped: (() => void) | null = null;
  readonly work: HeldWork;

  constructor(timers: TapTimers = WINDOW_TIMERS) {
    this.work = new HeldWork(timers);
  }

  /**
   * A touch went down on the look half (pointer `id`, its event time `t`, at x, y). True: it is the second touch of a
   * double tap — the first tap's held work is dropped now, a walk it already started taken back.
   */
  down(id: number, t: number, x: number, y: number): boolean {
    if (!isDoubleTap(this.last, { t, x, y })) return false;
    this.work.drop();
    const undo = this.undo;
    this.undo = null;
    this.last = null;
    this.second = id;
    this.dropped = this.replay;
    this.replay = null;
    undo?.();
    return true;
  }

  /**
   * The double tap's second touch `id` turned into a drag, or was cancelled: no double tap after all — the first tap's
   * walk (dropped at that touch's down) runs again at once. Once: the touch's lift then neither recenters nor walks.
   */
  dragged(id: number): void {
    if (this.second !== id) return;
    const walk = this.dropped;
    this.dropped = null;
    walk?.();
  }

  /** The touch `id` went up (or was cancelled): whether it was a double tap's second touch (it is no longer). */
  up(id: number): boolean {
    if (this.second !== id) return false;
    this.second = null;
    this.dropped = null;
    return true;
  }

  /**
   * A single look-half tap lifted (its event time `t`, at x, y): maybe a double tap's first. Earlier held work goes.
   * `replay`: its walk again, at once — run should a second touch that dropped it turn into a drag (`dragged`).
   */
  tap(t: number, x: number, y: number, replay?: () => void): void {
    this.work.drop();
    this.undo = null;
    this.last = { t, x, y };
    this.replay = replay ?? null;
    this.dropped = null;
  }

  /**
   * The tap's held walk started: `undo` takes it back should a second touch's down that came within DOUBLE_TAP_MS of
   * the tap's lift be handled only now (down). Kept until the next tap.
   */
  walked(undo: () => void): void {
    this.undo = undo;
  }

  /** A pinch (a second finger), the view going away: everything dropped, no double tap pending. */
  reset(): void {
    this.work.drop();
    this.undo = null;
    this.last = null;
    this.second = null;
    this.replay = null;
    this.dropped = null;
  }
}

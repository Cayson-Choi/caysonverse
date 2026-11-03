/**
 * Jump (controls-ux Task 11): a DISPLAY-ONLY hop. y is server-fixed (the schema has
 * no y), so a jump is a broadcast EVENT, never state: the pressing client plays it
 * at once (`localJump`) and tells the server; every other screen plays it when the
 * server relays the event (net/jumpSync.ts). Both feed ONE registry, which each
 * avatar's render loop reads every frame (LocalPlayer / RemotePlayer) to lift its
 * group and play the Jump_Full_Short clip. Nothing here touches React or three.
 *
 * Clock-free like bubbleRegistry / emojiRegistry: every method takes `now` (ms), so
 * it is testable with injected timestamps. The per-frame path (`get`) allocates
 * nothing; `snapshot` is for the dev/E2E hook only.
 */

import { JUMP_DURATION_MS, JUMP_RATE } from "@caysonverse/shared/constants";
import { isQuiet } from "./quiet";

/** Apex of the hop (m above the floor), reached at the midpoint. Display only. */
export const JUMP_HEIGHT_M = 1.0;

/**
 * Minimum gap (ms) between two jumps THIS client plays and sends: the server cap
 * plus 50 ms of network slack, so a jump the server would drop is never shown
 * locally (the sender would otherwise hop alone while nobody else sees it).
 */
export const JUMP_CLIENT_COOLDOWN_MS = JUMP_RATE.windowMs + 50;

/** Quick fade into the hop (s): a button press must read as instant (ANIM_FADE is 0.2 s). */
export const JUMP_FADE_IN_S = 0.08;

export interface JumpEntry {
  sid: string;
  /** Wall-clock ms at which this hop started (t = 0 of the parabola). */
  startedAt: number;
  /** Monotonic id, bumped on every set — lets an avatar detect a new hop. */
  seq: number;
}

export class JumpRegistry {
  private readonly entries = new Map<string, JumpEntry>();
  private counter = 0;

  /** Start (or restart) `sid`'s hop at `now`. A newer jump replaces the active one. */
  set(sid: string, now: number): void {
    this.entries.set(sid, { sid, startedAt: now, seq: ++this.counter });
  }

  /**
   * The active hop for `sid` at `now`, or null (none / expired). Returns the stored
   * entry itself and allocates nothing — safe to call per avatar per frame.
   */
  get(sid: string, now: number): JumpEntry | null {
    const entry = this.entries.get(sid);
    if (!entry) return null;
    if (now - entry.startedAt >= JUMP_DURATION_MS) {
      this.entries.delete(sid);
      return null;
    }
    return entry;
  }

  /** Drop `sid`'s hop immediately (the player left, or sat down mid-air). */
  remove(sid: string): void {
    this.entries.delete(sid);
  }

  /** Drop every hop (room teardown). */
  clear(): void {
    this.entries.clear();
  }

  /** Dev/E2E view: every hop still airborne at `now`. Allocates — never per frame. */
  snapshot(now: number): JumpEntry[] {
    const out: JumpEntry[] = [];
    for (const sid of [...this.entries.keys()]) {
      const entry = this.get(sid, now);
      if (entry) out.push(entry);
    }
    return out;
  }
}

/** Process-wide singleton: written by localJump + the jump broadcast, read by the avatars. */
export const jumpRegistry = new JumpRegistry();

/**
 * Height (m) above the floor `elapsedMs` after take-off: the parabola 4h·t(1 − t),
 * t = elapsed / JUMP_DURATION_MS — 0 on the ground, JUMP_HEIGHT_M at the midpoint,
 * and 0 outside [0, JUMP_DURATION_MS].
 */
export function jumpOffsetY(elapsedMs: number): number {
  if (elapsedMs <= 0 || elapsedMs >= JUMP_DURATION_MS) return 0;
  const t = elapsedMs / JUMP_DURATION_MS;
  return 4 * JUMP_HEIGHT_M * t * (1 - t);
}

/**
 * Playback speed that squeezes a jump clip of `clipSeconds` into JUMP_DURATION_MS
 * (Jump_Full_Short is 1.167 s, so ~1.46). A clip with no usable duration plays at 1.
 */
export function jumpTimeScale(clipSeconds: number): number {
  return clipSeconds > 0 ? clipSeconds / (JUMP_DURATION_MS / 1000) : 1;
}

/** What one avatar's frame should do about its hop (see `jumpPhase`). */
export type JumpPhase = "idle" | "takeoff" | "air" | "landed" | "dropped";

/**
 * The hop `sid` should show at `now`: its registry entry while the avatar can jump,
 * null otherwise. An avatar that cannot jump (seated, or in the sit / stand-up clip)
 * also DROPS any pending entry, so a hop pressed or broadcast then is never replayed
 * late once it can move again. Allocation-free (per-frame, per avatar).
 */
export function currentJump(sid: string, canJump: boolean, now: number): JumpEntry | null {
  if (!canJump) {
    jumpRegistry.remove(sid);
    return null;
  }
  return jumpRegistry.get(sid, now);
}

/**
 * The per-frame decision LocalPlayer and RemotePlayer share, pure and allocation-free:
 * `entry` is `currentJump`'s result, `canJump` whether the avatar may hop now, and
 * `playingSeq` the seq whose clip is currently playing (-1 = none).
 *  - "takeoff": a hop this avatar is not yet playing (new seq) — start the clip.
 *  - "air": the hop it is already playing — just lift.
 *  - "landed": the hop ended — fade the clip out and resume the gait loop.
 *  - "dropped": the avatar stopped being able to jump mid-air (sat down) — fade the
 *    clip out only; the sit / stand clip owns the body.
 *  - "idle": nothing playing, nothing to start.
 */
export function jumpPhase(entry: JumpEntry | null, canJump: boolean, playingSeq: number): JumpPhase {
  if (!canJump) return playingSeq !== -1 ? "dropped" : "idle";
  if (entry === null) return playingSeq !== -1 ? "landed" : "idle";
  return entry.seq !== playingSeq ? "takeoff" : "air";
}

/** Wall-clock ms of the last hop THIS client played (the cooldown anchor). */
let lastLocalJumpAt = Number.NEGATIVE_INFINITY;

/**
 * Whether a press may NOT hop right now, and the display lift (m) of our own avatar.
 * LocalPlayer writes both every frame (`publishLocalJump`) — the one place that knows
 * the avatar's seat / sit / stand-up state — and every consumer reads them: Space and
 * the touch button through `pressJump`, the first-person camera through
 * `getLocalLift`. Plain module values, so reading is allocation-free. Blocked until
 * LocalPlayer's first frame: with no avatar there is nothing to jump.
 */
let jumpBlocked = true;
let localLift = 0;

/** LocalPlayer, once per frame: our avatar's lift (m) and whether a press may not jump now. */
export function publishLocalJump(lift: number, blocked: boolean): void {
  localLift = lift;
  jumpBlocked = blocked;
}

/** Our own avatar's current hop height (m) — the first-person eye rises with it. */
export function getLocalLift(): number {
  return localLift;
}

/** True while a press must be refused (seated, sit / stand-up clip, reconnecting, no avatar yet). */
export function isJumpBlocked(): boolean {
  return jumpBlocked;
}

/**
 * Press → hop. Refused (returns false, nothing played or sent, no cooldown burnt)
 * while `blocked` — a chair holds the avatar — and inside JUMP_CLIENT_COOLDOWN_MS of
 * the previous hop, so a held or mashed key can never flood the server. Otherwise
 * the hop starts locally at once (no round trip) and `send` tells the server.
 */
export function localJump(sid: string, blocked: boolean, now: number, send: () => void): boolean {
  if (blocked) return false;
  if (now - lastLocalJumpAt < JUMP_CLIENT_COOLDOWN_MS) return false;
  lastLocalJumpAt = now;
  jumpRegistry.set(sid, now);
  send();
  return true;
}

/**
 * The ONE entry point for a jump press — Space and the touch button both call it, so
 * they can never disagree: `localJump` gated by the blocked flag LocalPlayer publishes.
 */
export function pressJump(sid: string, now: number, send: () => void): boolean {
  // The memorial hall is quiet: the server drops a jump there, so none is played here (quiet.ts).
  return localJump(sid, jumpBlocked || isQuiet(), now, send);
}

/** Forget the cooldown, the lift and the blocked flag — LocalPlayer calls this on mount and unmount (new world). */
export function resetLocalJump(): void {
  lastLocalJumpAt = Number.NEGATIVE_INFINITY;
  localLift = 0;
  jumpBlocked = true;
}

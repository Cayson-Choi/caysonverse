/**
 * The local player's recently SENT poses, keyed by their clock stamp (`MovePayload.t`), and the self-correction
 * that uses them (fix/remote-move-snapback).
 *
 * The server echoes the stamp of the last Move it accepted as `Player.moveT`. So when my own player's state
 * changes, I can compare the server's position with where I really was AT THAT STAMP — not with where I am now.
 * The old check compared it with where I am now, so the echo's age (round trip + patch wait) counted as
 * divergence: running at 6.4 m/s, an echo 0.5 s old (a phone's hiccup) is already 3 m behind, and I was yanked
 * back to it although the server had accepted everything I sent. Pure apart from the small module ring.
 */

import type { MovePayload } from "@caysonverse/shared/messages";
import { exceedsSnapDistance } from "./interpolation";
import { REFUSAL_HEAL_MS, REFUSED_SNAP_DISTANCE, SNAP_DISTANCE } from "./constants";

/** How many sent poses are kept: ~6 s of walking at 10 Hz — longer than any echo is late. */
const SENT_HISTORY = 64;

const sent: Array<{ t: number; x: number; z: number }> = [];

/** Remember a Move as it is sent (a stamp-less one is not kept: the server will echo 0 for it). */
export function recordSentMove(payload: MovePayload): void {
  if (payload.t === undefined || !(payload.t > 0)) return;
  sent.push({ t: payload.t, x: payload.x, z: payload.z });
  while (sent.length > SENT_HISTORY) sent.shift();
}

/** Where I was when I sent the Move stamped `t`, if it is still in the history. */
export function sentPoseAt(t: number): { x: number; z: number } | undefined {
  for (let i = sent.length - 1; i >= 0; i--) if (sent[i].t === t) return sent[i];
  return undefined;
}

/** Forget every sent pose (tests). */
export function clearSentMoves(): void {
  sent.length = 0;
}

/**
 * Has the server put me somewhere else than I put myself? `echoedT` is my own synced `moveT`: when it names a
 * Move I sent, the server's position is compared with my pose AT that Move (so the echo's age never counts);
 * a pose the server placed itself (a door, the maze portal) keeps the old stamp and is far from it → true.
 * With no usable stamp it falls back to the plain check against where I am now: at SNAP_DISTANCE for a server
 * that never echoed a stamp (an older one; nothing sent yet), at REFUSED_SNAP_DISTANCE when `refused` — the
 * server echoed my stamps before and now 0: it refused a Move, and will not catch up with me on its own.
 */
export function selfDiverged(
  current: { x: number; z: number },
  server: { x: number; z: number },
  echoedT: number,
  refused = false,
  sentAt: (t: number) => { x: number; z: number } | undefined = sentPoseAt,
): boolean {
  const mine = echoedT > 0 ? sentAt(echoedT) : undefined;
  if (mine) return exceedsSnapDistance(mine.x, mine.z, server.x, server.z);
  return exceedsSnapDistance(current.x, current.z, server.x, server.z, refused ? REFUSED_SNAP_DISTANCE : SNAP_DISTANCE);
}

/**
 * How the server is echoing my clock (`noteEcho`) and refusing my moves (`noteRefusal`): whether it ever echoed one, since
 * when it refuses, which echo was current then (`staleStamp`: a patch that still carries it is no news), and whether my pose
 * was sent once more to heal a small gap (`resent`).
 */
export interface EchoWatch {
  /** The server has echoed a stamp of mine (or refused a Move): an echoed 0 from then on means it refused a Move. */
  sawClock: boolean;
  /** Local time (ms) the refusal began (the echo went to 0, or a `MoveRefused` notice came); NaN while the server takes my moves. */
  refusedAt: number;
  /** The echo that was current when the refusal began: only a DIFFERENT (newer) stamp says the server took a Move since. */
  staleStamp: number;
  /** My pose has been sent once more for this refusal (`resolveRefusal`'s "resend"). */
  resent: boolean;
}

export function createEchoWatch(): EchoWatch {
  return { sawClock: false, refusedAt: Number.NaN, staleStamp: 0, resent: false };
}

/** The refusal is over (a newer stamp came, or I was put where the server has me). */
function clearRefusal(w: EchoWatch): void {
  w.refusedAt = Number.NaN;
  w.staleStamp = 0;
  w.resent = false;
}

/**
 * The server said it refused a Move (`MoveRefused`) or a door / stair / bench press for distance (`ActionRefused`). Unlike an
 * echo that went to 0 this comes even when no synced field changed — the first Move after a join or a door was refused while
 * the echo was 0 already — which left the client walking on, out of the server's reach for good (fix/net-sync). `echoedT` is
 * my synced `moveT` now: until it changes, the server has taken nothing since.
 */
export function noteRefusal(w: EchoWatch, echoedT: number, nowMs: number): void {
  w.sawClock = true;
  if (Number.isNaN(w.refusedAt)) {
    w.refusedAt = nowMs;
    w.staleStamp = echoedT;
  }
}

/**
 * What the self-correction should make of my echoed `moveT` at local time `nowMs`:
 *  - "ok": a NEW stamp of mine (or a server that never echoes one) — judge the divergence as usual (`selfDiverged`);
 *  - "healing": the server refused a Move less than REFUSAL_HEAL_MS ago and has taken none since. Its budget is
 *    still filling and it may well take the next ones (a short uplink stall): leave my pose alone and look again
 *    at the deadline (`healDeadline`);
 *  - "refused": it has refused for REFUSAL_HEAL_MS — it will not catch up by itself: `resolveRefusal`.
 */
export function noteEcho(w: EchoWatch, echoedT: number, nowMs: number): "ok" | "healing" | "refused" {
  if (echoedT > 0 && (Number.isNaN(w.refusedAt) || echoedT !== w.staleStamp)) {
    w.sawClock = true;
    clearRefusal(w);
    return "ok";
  }
  if (!w.sawClock) return "ok";
  if (Number.isNaN(w.refusedAt)) {
    w.refusedAt = nowMs;
    w.staleStamp = echoedT;
  }
  return nowMs - w.refusedAt >= REFUSAL_HEAL_MS ? "refused" : "healing";
}

/** When (local ms) a refusal still "healing" counts as one that will not heal. */
export function healDeadline(w: EchoWatch): number {
  return w.refusedAt + REFUSAL_HEAL_MS;
}

/** A gap (m) between my pose and the server's this small is no divergence (a rounding, a collider's skin): nothing to heal. */
export const RESYNC_EPS = 0.25;

/**
 * A refusal that did not heal by itself (`noteEcho` said "refused"): what to do about where I stand (`current`) and where the
 * server has me (`server`), at local time `nowMs`.
 *  - "none": no real gap — the refusal is over;
 *  - "resend": a small gap (up to REFUSED_SNAP_DISTANCE: typically the last Move of a walk refused in a bunch): send my pose
 *    once more — the server's budget has refilled by now and takes it, so nothing is seen — and look again a heal window later;
 *  - "snap": a large gap, or the resent pose was refused too: I am put where the server has me (the caller shows a short line).
 * Never a permanent silent divergence: every refusal ends in one of these within two heal windows.
 */
export function resolveRefusal(
  w: EchoWatch,
  current: { x: number; z: number },
  server: { x: number; z: number },
  nowMs: number,
): "none" | "resend" | "snap" {
  const gap = Math.hypot(current.x - server.x, current.z - server.z);
  if (gap <= RESYNC_EPS) {
    clearRefusal(w);
    return "none";
  }
  if (gap > REFUSED_SNAP_DISTANCE || w.resent) {
    clearRefusal(w);
    return "snap";
  }
  w.resent = true;
  w.refusedAt = nowMs; // a fresh heal window for the resent pose
  return "resend";
}

// ─────────────── the server's refusal notices → the self-correction; its "send my pose again" → LocalPlayer ───────────────

let refusalListener: (() => void) | null = null;

/** The self-correction (remoteSync.ts) listens for the server's refusal notices; returns the detach. */
export function onServerRefusal(listener: () => void): () => void {
  refusalListener = listener;
  return () => {
    if (refusalListener === listener) refusalListener = null;
  };
}

/** The server refused a Move or a press for distance (net/serverRefusals.ts). */
export function serverRefused(): void {
  refusalListener?.();
}

let resendWanted = false;

/** Ask LocalPlayer to send my current pose once more (on its next frame, stamped like any Move). */
export function requestPoseResend(): void {
  resendWanted = true;
}

/** LocalPlayer, each frame: was a resend asked for? (Clears the request.) */
export function takePoseResend(): boolean {
  const wanted = resendWanted;
  resendWanted = false;
  return wanted;
}

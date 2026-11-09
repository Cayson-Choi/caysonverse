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

/** How the server is echoing my clock (`noteEcho`): whether it ever did, and since when it echoes 0. */
export interface EchoWatch {
  /** The server has echoed a stamp of mine: an echoed 0 from then on means it refused a Move. */
  sawClock: boolean;
  /** Local time (ms) the echo went to 0 after a stamp of mine; NaN while the server takes my moves. */
  refusedAt: number;
}

export function createEchoWatch(): EchoWatch {
  return { sawClock: false, refusedAt: Number.NaN };
}

/**
 * What the self-correction should make of my echoed `moveT` at local time `nowMs`:
 *  - "ok": a stamp of mine (or a server that never echoes one) — judge the divergence as usual (`selfDiverged`);
 *  - "healing": the server refused a Move less than REFUSAL_HEAL_MS ago and has taken none since. Its budget is
 *    still filling and it may well take the next ones (a short uplink stall): leave my pose alone and look again
 *    at the deadline (`healDeadline`);
 *  - "refused": it has refused for REFUSAL_HEAL_MS — it will not catch up by itself: judge with `refused` true.
 */
export function noteEcho(w: EchoWatch, echoedT: number, nowMs: number): "ok" | "healing" | "refused" {
  if (echoedT > 0) {
    w.sawClock = true;
    w.refusedAt = Number.NaN;
    return "ok";
  }
  if (!w.sawClock) return "ok";
  if (Number.isNaN(w.refusedAt)) w.refusedAt = nowMs;
  return nowMs - w.refusedAt >= REFUSAL_HEAL_MS ? "refused" : "healing";
}

/** When (local ms) a refusal still "healing" counts as one that will not heal. */
export function healDeadline(w: EchoWatch): number {
  return w.refusedAt + REFUSAL_HEAL_MS;
}

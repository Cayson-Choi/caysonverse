/**
 * Remote-player store — the source of truth for OTHER players, living entirely
 * OUTSIDE React. Colyseus state callbacks (see remoteSync.ts) write here; the
 * per-frame render loop reads here. React only ever consumes the ROSTER (the set
 * of session ids) via `subscribeRoster`/`getRoster`, so it re-renders on join/
 * leave alone — never on movement. Positions never pass through React state.
 */

import type { Appearance } from "@caysonverse/shared/appearance";
import type { Snapshot } from "./interpolation";
import { receivePose, type Playout } from "./playout";
import { createSeatLine, pushSeatChange, type SeatLine } from "./remoteSeat";

/** Everything the renderer needs about one remote player. */
export interface RemotePlayerRecord {
  sessionId: string;
  /** Identity — set at add; `connected` may flip (Task 11 reconnection). */
  nickname: string;
  /**
   * The 15 synced appearance fields (`pickAppearance(player)` at add). The server
   * writes them once at join, so — like `role` — there is no setter and no listener.
   */
  appearance: Appearance;
  connected: boolean;
  /**
   * Seat (v2 Task 1): -1 = standing; >= 0 = the seat this remote occupies. Taken the moment the patch arrives (the
   * sit prompts and the occupancy need it now); the avatar sits down / gets up when its render time reaches the
   * change (`seatLine`).
   */
  seatIndex: number;
  /**
   * Synced `Player.role` (0 = student / 1 = teacher; ROLE_* in shared constants).
   * Read ONCE at add — the server fixes it for the whole session, so there is no
   * setter and no listener.
   */
  role: number;
  /** Position history ring buffer (on the remote's timeline), sampled by the interpolation layer. */
  snapshots: Snapshot[];
  /** When along `snapshots` this remote is drawn (playout.ts): its timeline, render time and lag. */
  playout: Playout;
  /**
   * The seat changes stamped on the remote's timeline, for the avatar to replay when its render time gets there
   * (remoteSeat.ts). Optional for a record built without one (tests): `addRemote` fills it in.
   */
  seatLine?: SeatLine;
  /**
   * Where RemotePlayer DREW this avatar on its latest frame (x, z), or null before its first frame. The body the
   * local player collides with (`forEachRemotePosition`) is the one on screen, not the newest snapshot (which is a
   * playout lag ahead of it). Mutated in place by RemotePlayer.
   */
  drawn?: { x: number; z: number } | null;
}

const records = new Map<string, RemotePlayerRecord>();

/**
 * React-facing roster: a sorted array of session ids, replaced by identity ONLY
 * on add/remove so `useSyncExternalStore` keeps the same reference (and skips
 * re-render) while positions stream in.
 */
let roster: string[] = [];
const rosterListeners = new Set<() => void>();

function refreshRoster(): void {
  roster = Array.from(records.keys()).sort();
  for (const listener of rosterListeners) listener();
}

/** Subscribe to roster (join/leave) changes. Returns an unsubscribe. */
export function subscribeRoster(listener: () => void): () => void {
  rosterListeners.add(listener);
  return () => {
    rosterListeners.delete(listener);
  };
}

/** Current roster snapshot (stable reference between changes). */
export function getRoster(): string[] {
  return roster;
}

/** The record for a session id, or undefined. Read by the render loop via ref. */
export function getRemoteRecord(sessionId: string): RemotePlayerRecord | undefined {
  return records.get(sessionId);
}

/** Add (or replace) a remote player and notify the roster. */
export function addRemote(record: RemotePlayerRecord): void {
  record.seatLine ??= createSeatLine(record.seatIndex);
  record.drawn ??= null;
  records.set(record.sessionId, record);
  refreshRoster();
}

/** Remove a remote player and notify the roster. No-op if absent. */
export function removeRemote(sessionId: string): void {
  if (records.delete(sessionId)) refreshRoster();
}

/** Update the connected flag (drives 50%-opacity ghost rendering). */
export function setRemoteConnected(sessionId: string, connected: boolean): void {
  const record = records.get(sessionId);
  if (record) record.connected = connected;
}


/**
 * Seats currently occupied by REMOTE players. Read by the throttled sit-prompt
 * loop (~5 Hz) to hide taken seats; the caller unions in its own seat. Allocates
 * a small array per call — fine off the per-frame path.
 */
export function getRemoteSeatIndices(): number[] {
  const out: number[] = [];
  for (const record of records.values()) {
    if (record.seatIndex >= 0) out.push(record.seatIndex);
  }
  return out;
}

/**
 * Take a received pose of a remote into its buffer: `arrivalMs` is the local receive time, `moverT` the synced
 * `Player.moveT` (the mover's clock at that pose; 0 = none). A no-op for an id not in the store.
 *
 * `seatIndex` (when given) is the remote's synced seat from the same patch. If it changed, the server put the
 * remote where this pose is (on the seat, or on its dismount spot): the pose is stored as placed, the record's
 * `seatIndex` changes at once, and the change is stamped with the pose's timeline time for the avatar to replay
 * when it is drawn there (remoteSeat.ts).
 */
export function receiveRemotePose(
  sessionId: string,
  arrivalMs: number,
  moverT: number,
  x: number,
  z: number,
  yaw: number,
  seatIndex?: number,
): void {
  const record = records.get(sessionId);
  if (!record) return;
  const seatChanged = seatIndex !== undefined && seatIndex !== record.seatIndex;
  receivePose(record.playout, record.snapshots, arrivalMs, moverT, x, z, yaw, seatChanged);
  if (!seatChanged) return;
  record.seatIndex = seatIndex;
  const placed = record.snapshots[record.snapshots.length - 1];
  pushSeatChange((record.seatLine ??= createSeatLine(-1)), placed.t, seatIndex);
}

/**
 * Drop all remotes (on room leave / teardown) and notify the roster once. This
 * is the first half of a reconnection RESYNC: `startRemoteSync`'s teardown calls
 * it, then the fresh room's `onAdd` replay re-adds every current player. Because
 * `addRemote` keys by sessionId, that clear→replay rebuild can never leave a
 * duplicate avatar behind (covered by remoteStore.test.ts).
 */
export function clearRemotes(): void {
  if (records.size === 0) return;
  records.clear();
  refreshRoster();
}

/** Note where a remote's avatar was drawn this frame (RemotePlayer, every frame; allocates only the first time). */
export function noteRemoteDrawn(record: RemotePlayerRecord, x: number, z: number): void {
  if (record.drawn) {
    record.drawn.x = x;
    record.drawn.z = z;
  } else record.drawn = { x, z };
}

/**
 * Allocation-free per-frame iteration over where each remote's body IS on screen
 * (design 33 — remote players are solid): the pose RemotePlayer drew it at on its
 * latest frame, or its newest known position before its first frame. The
 * collision layer builds its dynamic obstacle list from this every frame, so no
 * arrays are created here. (The newest snapshot is a playout lag AHEAD of the
 * drawn body: colliding with it blocked the local player on empty floor in front
 * of a walking remote and let it walk into the body it could see.)
 */
export function forEachRemotePosition(
  fn: (x: number, z: number, connected: boolean) => void,
): void {
  for (const record of records.values()) {
    const drawn = record.drawn;
    if (drawn) {
      fn(drawn.x, drawn.z, record.connected);
      continue;
    }
    const last = record.snapshots[record.snapshots.length - 1];
    if (last) fn(last.x, last.z, record.connected);
  }
}

/** One remote as the dev/E2E view reports it (see `getRemotes`). */
export interface RemoteSummary {
  sessionId: string;
  nickname: string;
  /** A copy of the record's appearance — the caller cannot reach into the live record. */
  appearance: Appearance;
  x: number;
  z: number;
  yaw: number;
  connected: boolean;
  seatIndex: number;
  role: number;
}

/** Dev/E2E view: each remote's appearance, newest known position + ghost flag + seat + role. */
export function getRemotes(): RemoteSummary[] {
  const out: RemoteSummary[] = [];
  for (const record of records.values()) {
    const last = record.snapshots[record.snapshots.length - 1];
    out.push({
      sessionId: record.sessionId,
      nickname: record.nickname,
      appearance: { ...record.appearance },
      x: last?.x ?? 0,
      z: last?.z ?? 0,
      yaw: last?.yaw ?? 0,
      connected: record.connected,
      seatIndex: record.seatIndex,
      role: record.role,
    });
  }
  return out;
}

/** One remote avatar as it was last DRAWN (DEV/E2E only): the render time and the pose written to the scene. */
export interface DrawnPose {
  /** `performance.now()` of the frame that drew it. */
  t: number;
  x: number;
  z: number;
  yaw: number;
  /** Height of the avatar group above the floor (a bench's lift, a hop). */
  y?: number;
  /** The seat motion's state (remoteSeat.ts): up / sitting / seated / standing. */
  mode?: string;
}

/**
 * DEV-only E2E probe: the pose each remote avatar was drawn at on its latest frame, keyed by session id —
 * what the viewer actually SEES, as opposed to `getRemotes` (the newest received snapshot). RemotePlayer
 * writes it only under `import.meta.env.DEV` (and removes its entry on unmount); `window.__cv.getRemoteDrawn()`
 * reads it. Always empty in production, where the DEV guard is dead-code-eliminated.
 */
export const remoteDrawnProbe = new Map<string, DrawnPose>();

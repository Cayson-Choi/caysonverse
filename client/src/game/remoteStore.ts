/**
 * Remote-player store — the source of truth for OTHER players, living entirely
 * OUTSIDE React. Colyseus state callbacks (see remoteSync.ts) write here; the
 * per-frame render loop reads here. React only ever consumes the ROSTER (the set
 * of session ids) via `subscribeRoster`/`getRoster`, so it re-renders on join/
 * leave alone — never on movement. Positions never pass through React state.
 */

import type { Appearance } from "@caysonverse/shared/appearance";
import { pushSnapshot, type Snapshot } from "./interpolation";

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
  /** Seat (v2 Task 1): -1 = standing; >= 0 = the seat this remote occupies. */
  seatIndex: number;
  /**
   * Synced `Player.role` (0 = student / 1 = teacher; ROLE_* in shared constants).
   * Read ONCE at add — the server fixes it for the whole session, so there is no
   * setter and no listener.
   */
  role: number;
  /** Position history ring buffer, sampled by the interpolation layer. */
  snapshots: Snapshot[];
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

/** Update a remote's seat (drives seated rendering + client-side occupancy). */
export function setRemoteSeat(sessionId: string, seatIndex: number): void {
  const record = records.get(sessionId);
  if (record) record.seatIndex = seatIndex;
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

/** Append a position snapshot to a remote player's ring buffer. */
export function pushRemoteSnapshot(sessionId: string, snapshot: Snapshot): void {
  const record = records.get(sessionId);
  if (record) pushSnapshot(record.snapshots, snapshot);
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

/**
 * Allocation-free per-frame iteration over each remote's NEWEST known position
 * (design 33 — remote players are solid): the collision layer builds its
 * dynamic obstacle list from this every frame, so no arrays are created here.
 */
export function forEachRemotePosition(
  fn: (x: number, z: number, connected: boolean) => void,
): void {
  for (const record of records.values()) {
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

/**
 * Remote-player store — the source of truth for OTHER players, living entirely
 * OUTSIDE React. Colyseus state callbacks (see remoteSync.ts) write here; the
 * per-frame render loop reads here. React only ever consumes the ROSTER (the set
 * of session ids) via `subscribeRoster`/`getRoster`, so it re-renders on join/
 * leave alone — never on movement. Positions never pass through React state.
 */

import { pushSnapshot, type Snapshot } from "./interpolation";

/** Everything the renderer needs about one remote player. */
export interface RemotePlayerRecord {
  sessionId: string;
  /** Identity — set at add; `connected` may flip (Task 11 reconnection). */
  nickname: string;
  character: number;
  tint: number;
  connected: boolean;
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

/** Append a position snapshot to a remote player's ring buffer. */
export function pushRemoteSnapshot(sessionId: string, snapshot: Snapshot): void {
  const record = records.get(sessionId);
  if (record) pushSnapshot(record.snapshots, snapshot);
}

/** Drop all remotes (on room leave / teardown) and notify the roster once. */
export function clearRemotes(): void {
  if (records.size === 0) return;
  records.clear();
  refreshRoster();
}

/** Dev/E2E view: each remote's newest known position. */
export function getRemotes(): Array<{ sessionId: string; nickname: string; x: number; z: number }> {
  const out: Array<{ sessionId: string; nickname: string; x: number; z: number }> = [];
  for (const record of records.values()) {
    const last = record.snapshots[record.snapshots.length - 1];
    out.push({
      sessionId: record.sessionId,
      nickname: record.nickname,
      x: last?.x ?? 0,
      z: last?.z ?? 0,
    });
  }
  return out;
}

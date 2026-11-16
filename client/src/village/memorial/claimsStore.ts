import { useSyncExternalStore } from "react";
import { MemorialServerMsg } from "@caysonverse/shared/memorial/messages";
import type { ClaimMine, ClaimPublic, ClaimUpdatedPayload, DeviceView } from "@caysonverse/shared/memorial/types";
import { memorialApi, MemorialApiError } from "./memorialApi";

/**
 * The hall's claimed cubbies as this client knows them (memorial stage B): every public claim (the 3D frames and props, the
 * close-up card) and this device's family claims (with pending photos). Fetched when the hall opens, refetched per cubby on
 * `MemClaimUpdated` and after this device changes something. Plain module state + a version number for React.
 */

export interface ClaimsSnapshot {
  version: number;
  /** "loading" before the first answer, "off" when the server has no memorial store (the hall still works). */
  status: "idle" | "loading" | "ready" | "off";
  claims: ReadonlyMap<string, ClaimPublic>;
  mine: ReadonlyMap<string, ClaimMine>;
  /** Free cubbies this device's family may still take (1 for a newcomer). */
  freeLeft: number;
  devices: readonly DeviceView[];
}

let snap: ClaimsSnapshot = { version: 0, status: "idle", claims: new Map(), mine: new Map(), freeLeft: 1, devices: [] };
const listeners = new Set<() => void>();

function set(patch: Partial<Omit<ClaimsSnapshot, "version">>): void {
  snap = { ...snap, ...patch, version: snap.version + 1 };
  for (const l of [...listeners]) l();
}

export function claimsSnapshot(): ClaimsSnapshot {
  return snap;
}

export function subscribeClaims(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useClaims(): ClaimsSnapshot {
  return useSyncExternalStore(subscribeClaims, claimsSnapshot, claimsSnapshot);
}

/** The claim shown for a cubby: this family's view if it is ours, else the public one. */
export function claimFor(slotId: string | null, s: ClaimsSnapshot = snap): ClaimPublic | ClaimMine | undefined {
  if (!slotId) return undefined;
  return s.mine.get(slotId) ?? s.claims.get(slotId);
}

export function isMine(c: ClaimPublic | ClaimMine | undefined): c is ClaimMine {
  return Boolean(c && (c as ClaimMine).mine);
}

let inflight: Promise<void> | null = null;

/** Everything: the hall's public claims, mine, and my free allowance + devices. */
export function refreshHall(): Promise<void> {
  if (inflight) return inflight;
  if (snap.status === "idle") set({ status: "loading" });
  inflight = (async () => {
    try {
      const [hall, me] = await Promise.all([memorialApi.hall(), memorialApi.me()]);
      set({
        status: "ready",
        claims: new Map(hall.claims.map((c) => [c.slotId, c])),
        mine: new Map(hall.mine.map((c) => [c.slotId, c])),
        freeLeft: me.owner ? me.owner.freeLeft : 1,
        devices: me.owner?.devices ?? [],
      });
    } catch (err) {
      if (err instanceof MemorialApiError && (err.status === 503 || err.status === 404 || err.status === 0)) set({ status: "off" });
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** One cubby (after `MemClaimUpdated`, or opening its card): replace or drop it. */
export async function refreshSlot(slotId: string): Promise<void> {
  try {
    const { claim } = await memorialApi.claimBySlot(slotId);
    const claims = new Map(snap.claims);
    claims.set(slotId, claim);
    const mine = new Map(snap.mine);
    if (isMine(claim)) mine.set(slotId, claim);
    else mine.delete(slotId);
    set({ claims, mine });
  } catch (err) {
    if (err instanceof MemorialApiError && err.status === 404) {
      const claims = new Map(snap.claims);
      const mine = new Map(snap.mine);
      claims.delete(slotId);
      mine.delete(slotId);
      set({ claims, mine });
    }
  }
}

/** Put a claim this device just created / changed straight in (no round trip). */
export function noteMyClaim(c: ClaimMine): void {
  const claims = new Map(snap.claims);
  const mine = new Map(snap.mine);
  claims.set(c.slotId, c);
  mine.set(c.slotId, c);
  set({ claims, mine, freeLeft: Math.max(0, snap.freeLeft - (snap.mine.has(c.slotId) ? 0 : 1)) });
}

interface ClaimRoom {
  onMessage<T>(type: string, cb: (m: T) => void): () => void;
}

/** Bind `MemClaimUpdated` on a (re)joined room: refetch that cubby, once per burst. */
export function bindClaimUpdates(room: ClaimRoom): () => void {
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  const off = room.onMessage<ClaimUpdatedPayload>(MemorialServerMsg.ClaimUpdated, (m) => {
    if (!m || typeof m.slotId !== "string" || snap.status === "idle") return;
    clearTimeout(pending.get(m.slotId));
    pending.set(
      m.slotId,
      setTimeout(() => {
        pending.delete(m.slotId);
        void refreshSlot(m.slotId);
      }, 150),
    );
  });
  return () => {
    off();
    for (const t of pending.values()) clearTimeout(t);
  };
}

/** Tests only. */
export function resetClaimsForTest(): void {
  snap = { version: 0, status: "idle", claims: new Map(), mine: new Map(), freeLeft: 1, devices: [] };
}

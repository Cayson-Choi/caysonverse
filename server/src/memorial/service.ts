import crypto from "node:crypto";
import fs from "node:fs";
import { ALBUM_FREE, DEVICE_KEY_PATTERN } from "@caysonverse/shared/memorial/constants";
import type { ClaimMine, ClaimPublic, ClaimUpdatedPayload, DeviceView, PhotoView } from "@caysonverse/shared/memorial/types";
import { VILLAGE_LAYOUT, cubbyAnchors } from "@caysonverse/shared/village/villageLayout";
import { SAMPLE_FILLED_IDS } from "@caysonverse/shared/village/sampleFill";
import { serverNow } from "../clock";
import { openDb } from "../db/sqlite";
import { RateWindow } from "../rooms/rateLimit";
import { memorialConfigFromEnv, type MemorialConfig } from "./config";
import { publicUrls, signedUrls } from "./media";
import { MemorialStore, sha256Hex, type ClaimRow, type KeyRow, type PhotoRow } from "./store";

/**
 * The memorial service (stage B): the store, the config, the views the API returns, and the events rooms listen to.
 * One per process (`initMemorial` at boot); `memorial()` is null when persistence is off or the data folder is unusable —
 * the hall keeps working (sample cubby, candles), only claiming answers "잠시 뒤에 다시 해 주세요".
 */

/** Per-key sliding windows (IP hashes, owners), pruned as they go. */
export class KeyedRate {
  private readonly map = new Map<string, RateWindow>();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}
  tryAccept(key: string, now: number): boolean {
    let w = this.map.get(key);
    if (!w) {
      if (this.map.size > 50_000) this.map.clear(); // a flood of distinct keys must not grow memory without bound
      w = new RateWindow(this.limit, this.windowMs);
      this.map.set(key, w);
    }
    return w.tryAccept(now);
  }
}

export class Memorial {
  readonly store: MemorialStore;
  private readonly listeners = new Set<(p: ClaimUpdatedPayload) => void>();
  /** Slots holding an active claim (the room's "filled" set for candles), kept in step with the DB. */
  private readonly claimed = new Set<string>();

  constructor(
    readonly config: MemorialConfig,
    readonly now: () => number = serverNow,
  ) {
    fs.mkdirSync(config.mediaDir, { recursive: true, mode: 0o750 });
    this.store = new MemorialStore(openDb(config.dbPath), now);
    this.store.seedSlots(cubbyAnchors(VILLAGE_LAYOUT), SAMPLE_FILLED_IDS);
    for (const c of this.store.activeClaims()) this.claimed.add(c.slot_id);
  }

  close(): void {
    this.store.db.close();
  }

  // ─── identity ───

  static keyHash(deviceKey: string): string | null {
    return DEVICE_KEY_PATTERN.test(deviceKey) ? sha256Hex(deviceKey) : null;
  }

  /** The IP hash used only for rate limits (random salt per boot, never stored). */
  ipHash(ip: string): string {
    return crypto.createHmac("sha256", this.config.ipSalt).update(ip).digest("base64url").slice(0, 16);
  }

  ownerOf(keyHash: string | null): { ownerId: string; keyId: string } | null {
    return keyHash ? this.store.ownerByKeyHash(keyHash) : null;
  }

  // ─── claims & events ───

  isClaimed(slotId: string): boolean {
    return this.claimed.has(slotId);
  }

  onClaimUpdated(cb: (p: ClaimUpdatedPayload) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  emit(slotId: string, fields: string[]): void {
    const c = this.store.liveClaimBySlot(slotId);
    if (c?.status === "active") this.claimed.add(slotId);
    else this.claimed.delete(slotId);
    for (const l of [...this.listeners]) l({ slotId, fields });
  }

  // ─── views ───

  /** Approved photos of a public claim use the long-cached public URL; everything else a 10-minute signed one. */
  private photoView(p: PhotoRow, privacy: "public" | "family"): PhotoView {
    const pub = p.moderation === "approved" && p.visibility === "public" && privacy === "public";
    return {
      id: p.id,
      moderation: p.moderation,
      urls: p.moderation === "rejected" ? null : pub ? publicUrls(p.id) : signedUrls(this.config.mediaSecret, p.id, this.now()),
      isCover: p.is_cover === 1,
      caption: p.caption,
      w: p.w,
      h: p.h,
      createdAt: p.created_at,
    };
  }

  /** The newest approved photo, cover first. */
  publicCover(claimId: string): PhotoRow | undefined {
    const live = this.store.livePhotos(claimId).filter((p) => p.moderation === "approved" && p.visibility === "public");
    return live.find((p) => p.is_cover === 1) ?? live[0];
  }

  publicView(c: ClaimRow): ClaimPublic {
    const cover = c.privacy === "public" ? this.publicCover(c.id) : undefined;
    return {
      claimId: c.id,
      slotId: c.slot_id,
      petName: c.pet_name,
      species: c.species,
      born: c.born,
      bornPrec: c.born_prec,
      passed: c.passed,
      passedPrec: c.passed_prec,
      line: c.line,
      photo: cover ? publicUrls(cover.id) : null,
      createdAt: c.created_at,
    };
  }

  mineView(c: ClaimRow): ClaimMine {
    const all = this.store.livePhotos(c.id);
    const newest = all[0];
    const visible = all.filter((p) => p.moderation !== "rejected");
    const cover = visible.find((p) => p.is_cover === 1) ?? visible[0];
    return {
      ...this.publicView(c),
      mine: true,
      privacy: c.privacy,
      photos: visible.map((p) => this.photoView(p, c.privacy)),
      familyCover: cover ? this.photoView(cover, c.privacy) : null,
      lastRejected: newest?.moderation === "rejected",
      albumFree: ALBUM_FREE,
    };
  }

  deviceViews(ownerId: string, currentKeyId: string): DeviceView[] {
    return this.store.devicesOf(ownerId).map((k: KeyRow) => ({
      id: k.id,
      label: k.label,
      createdAt: k.created_at,
      lastSeenAt: k.last_seen_at,
      current: k.id === currentKeyId,
    }));
  }

  /** Public claims of the hall (family-only claims show nothing but the name). */
  hallClaims(): ClaimPublic[] {
    return this.store.activeClaims().map((c) => this.publicView(c));
  }
}

let instance: Memorial | null = null;

/** The process's memorial, or null (off / failed to open). */
export function memorial(): Memorial | null {
  return instance;
}

/** Open the data store once at boot. Never throws: a failure leaves the game running without persistence (logged once). */
export function initMemorial(config: MemorialConfig = memorialConfigFromEnv()): Memorial | null {
  if (instance) return instance;
  if (config.off) return null;
  try {
    instance = new Memorial(config);
    console.log(`[memorial] data store ready (${instance.store.activeClaims().length} claims)`);
  } catch (err) {
    console.error(`[memorial] persistence unavailable: ${(err as Error).message}`);
    instance = null;
  }
  return instance;
}

/** Tests: swap the process instance. */
export function setMemorialForTest(m: Memorial | null): void {
  instance = m;
}

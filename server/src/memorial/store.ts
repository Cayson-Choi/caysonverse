import crypto from "node:crypto";
import { crockfordFromBytes, normalizeCode } from "@caysonverse/shared/memorial/codes";
import {
  ALBUM_FREE,
  FREE_CLAIMS_PER_OWNER,
  INVITE_CODE_LENGTH,
  INVITE_TTL_MS,
  MAX_DEVICE_KEYS,
  RECOVERY_CODE_LENGTH,
  SKU_SLOT_BETA,
} from "@caysonverse/shared/memorial/constants";
import type { ClaimFields } from "@caysonverse/shared/memorial/validate";
import type { Moderation } from "@caysonverse/shared/memorial/types";
import { tx, type Db } from "../db/sqlite";

/**
 * The memorial's SQL (stage B): owners and their keys, invites, claims, photos, entitlements. Synchronous (node:sqlite), every
 * method one short statement or one transaction. Knows nothing about HTTP; the clock is injected (CV_FAKE_NOW in tests).
 *
 * Ownership is by `owner`, never by key: a device key, an invited family device, a recovery code and (later) an account are all
 * rows of `owner_key` pointing at the same owner (memorial-2 §4-1). Raw keys are never stored — device keys as SHA-256 (they are
 * 256-bit random), user-held codes (invite: SHA-256 + single use + 24 h; recovery: scrypt with a fixed salt so it is indexable).
 */

export interface ClaimRow {
  id: string;
  slot_id: string;
  owner_id: string;
  pet_name: string;
  species: "dog" | "cat" | "other";
  born: string | null;
  born_prec: "day" | "md" | "unknown";
  passed: string | null;
  passed_prec: "day" | "md" | "unknown";
  line: string;
  privacy: "public" | "family";
  status: "active" | "hidden" | "expired" | "released";
  created_at: number;
  updated_at: number;
}

export interface PhotoRow {
  id: string;
  claim_id: string;
  sha256: string;
  w: number;
  h: number;
  bytes: number;
  moderation: Moderation;
  reviewed_at: number | null;
  reject_reason: string | null;
  is_cover: number;
  caption: string;
  visibility: "public" | "family";
  created_at: number;
  deleted_at: number | null;
}

export interface KeyRow {
  id: string;
  owner_id: string;
  kind: "device" | "recovery" | "account";
  label: string;
  created_at: number;
  last_seen_at: number | null;
}

export type StoreError =
  | "slot_unavailable"
  | "slot_taken"
  | "claim_limit"
  | "invite_invalid"
  | "device_limit"
  | "device_owned"
  | "album_full"
  | "duplicate_photo"
  | "not_found";

export class StoreFail extends Error {
  constructor(readonly code: StoreError) {
    super(code);
  }
}

export function sha256Hex(s: string | Buffer): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

/** Recovery codes are user-held, so a slow KDF; the fixed salt keeps it a lookup key (60 random bits make that safe). */
export function recoveryHash(code: string): string {
  return crypto.scryptSync(code, "caysonverse-recovery-v1", 32, { N: 16384, r: 8, p: 1 }).toString("hex");
}

/** A random id: 22 base64url chars (128 bits). */
export function randomId(): string {
  return crypto.randomBytes(16).toString("base64url");
}

export function randomCode(length: number): string {
  return crockfordFromBytes(crypto.randomBytes(Math.ceil((length * 5) / 8)), length);
}

const CLAIM_COLS =
  "id, slot_id, owner_id, pet_name, species, born, born_prec, passed, passed_prec, line, privacy, status, created_at, updated_at";
const PHOTO_COLS =
  "id, claim_id, sha256, w, h, bytes, moderation, reviewed_at, reject_reason, is_cover, caption, visibility, created_at, deleted_at";

export class MemorialStore {
  constructor(
    readonly db: Db,
    private readonly now: () => number,
  ) {}

  // ─── slots ───

  /** Make sure every cubby of the layout has its stable `slot` row (idempotent; ids are never renumbered). */
  seedSlots(slots: readonly { id: string; bank: string; row: number; col: number }[], sampleIds: ReadonlySet<string>): void {
    const ins = this.db.prepare("INSERT OR IGNORE INTO slot (id, hall, bank, row, col, sample) VALUES (?, 'M1', ?, ?, ?, ?)");
    const flag = this.db.prepare("UPDATE slot SET sample = ? WHERE id = ?");
    tx(this.db, () => {
      for (const s of slots) {
        ins.run(s.id, s.bank, s.row, s.col, sampleIds.has(s.id) ? 1 : 0);
        flag.run(sampleIds.has(s.id) ? 1 : 0, s.id);
      }
    });
  }

  slot(id: string): { id: string; sample: number } | undefined {
    return this.db.prepare("SELECT id, sample FROM slot WHERE id = ?").get(id) as { id: string; sample: number } | undefined;
  }

  // ─── owners & keys ───

  /** The live key (device or account) with this hash, its owner resolved through merges. Touches `last_seen_at`. */
  ownerByKeyHash(keyHash: string, kind: "device" | "account" = "device"): { ownerId: string; keyId: string } | null {
    const row = this.db
      .prepare("SELECT id, owner_id FROM owner_key WHERE kind = ? AND key_hash = ? AND revoked_at IS NULL")
      .get(kind, keyHash) as { id: string; owner_id: string } | undefined;
    if (!row) return null;
    this.db.prepare("UPDATE owner_key SET last_seen_at = ? WHERE id = ?").run(this.now(), row.id);
    return { ownerId: this.resolveOwner(row.owner_id), keyId: row.id };
  }

  /** Follow `merged_into` (accounts later). */
  resolveOwner(id: string): string {
    let cur = id;
    for (let i = 0; i < 8; i += 1) {
      const r = this.db.prepare("SELECT merged_into FROM owner WHERE id = ?").get(cur) as { merged_into: string | null } | undefined;
      if (!r?.merged_into) return cur;
      cur = r.merged_into;
    }
    return cur;
  }

  /** A new owner holding this device key plus a recovery code (returned once, stored hashed). */
  createOwner(deviceKeyHash: string, label = ""): { ownerId: string; keyId: string; recoveryCode: string } {
    const now = this.now();
    const ownerId = crypto.randomUUID();
    const keyId = randomId();
    const recoveryCode = randomCode(RECOVERY_CODE_LENGTH);
    this.db.prepare("INSERT INTO owner (id, created_at) VALUES (?, ?)").run(ownerId, now);
    this.db
      .prepare("INSERT INTO owner_key (id, owner_id, kind, key_hash, label, created_at, last_seen_at) VALUES (?, ?, 'device', ?, ?, ?, ?)")
      .run(keyId, ownerId, deviceKeyHash, label, now, now);
    this.db
      .prepare("INSERT INTO owner_key (id, owner_id, kind, key_hash, label, created_at) VALUES (?, ?, 'recovery', ?, '', ?)")
      .run(randomId(), ownerId, recoveryHash(recoveryCode), now);
    return { ownerId, keyId, recoveryCode };
  }

  devicesOf(ownerId: string): KeyRow[] {
    return this.db
      .prepare(
        "SELECT id, owner_id, kind, label, created_at, last_seen_at FROM owner_key WHERE owner_id = ? AND kind = 'device' AND revoked_at IS NULL ORDER BY created_at",
      )
      .all(ownerId) as unknown as KeyRow[];
  }

  revokeDevice(ownerId: string, keyId: string): boolean {
    const r = this.db
      .prepare("UPDATE owner_key SET revoked_at = ? WHERE id = ? AND owner_id = ? AND kind = 'device' AND revoked_at IS NULL")
      .run(this.now(), keyId, ownerId);
    return Number(r.changes) > 0;
  }

  /** Attach a device key to `ownerId` (family invite / recovery). A key that already belongs to an owner with claims is refused. */
  private attachDevice(ownerId: string, deviceKeyHash: string, label: string): string {
    const existing = this.db
      .prepare("SELECT id, owner_id FROM owner_key WHERE kind = 'device' AND key_hash = ? AND revoked_at IS NULL")
      .get(deviceKeyHash) as { id: string; owner_id: string } | undefined;
    if (existing) {
      const owner = this.resolveOwner(existing.owner_id);
      if (owner === ownerId) return existing.id;
      if (this.liveClaimsOf(owner).length > 0) throw new StoreFail("device_owned");
      this.db.prepare("UPDATE owner_key SET revoked_at = ? WHERE id = ?").run(this.now(), existing.id);
    }
    if (this.devicesOf(ownerId).length >= MAX_DEVICE_KEYS) throw new StoreFail("device_limit");
    const keyId = randomId();
    const now = this.now();
    this.db
      .prepare("INSERT INTO owner_key (id, owner_id, kind, key_hash, label, created_at, last_seen_at) VALUES (?, ?, 'device', ?, ?, ?, ?)")
      .run(keyId, ownerId, deviceKeyHash, label, now, now);
    return keyId;
  }

  createInvite(ownerId: string): { code: string; expiresAt: number } {
    const code = randomCode(INVITE_CODE_LENGTH);
    const now = this.now();
    const expiresAt = now + INVITE_TTL_MS;
    this.db.prepare("INSERT INTO invite (code_hash, owner_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(sha256Hex(code), ownerId, now, expiresAt);
    return { code, expiresAt };
  }

  /** Use an invite once, within 24 h: the device joins the inviting owner. */
  joinInvite(rawCode: unknown, deviceKeyHash: string, label = ""): { ownerId: string; keyId: string } {
    const code = normalizeCode(rawCode, INVITE_CODE_LENGTH);
    if (!code) throw new StoreFail("invite_invalid");
    return tx(this.db, () => {
      const inv = this.db.prepare("SELECT owner_id, expires_at, used_at FROM invite WHERE code_hash = ?").get(sha256Hex(code)) as
        | { owner_id: string; expires_at: number; used_at: number | null }
        | undefined;
      if (!inv || inv.used_at !== null || inv.expires_at <= this.now()) throw new StoreFail("invite_invalid");
      const ownerId = this.resolveOwner(inv.owner_id);
      const keyId = this.attachDevice(ownerId, deviceKeyHash, label);
      this.db.prepare("UPDATE invite SET used_at = ?, used_by_key = ? WHERE code_hash = ?").run(this.now(), keyId, sha256Hex(code));
      return { ownerId, keyId };
    });
  }

  /** The recovery code brings a new device back to its owner (the code stays valid; a lost phone can be removed in the list). */
  recover(rawCode: unknown, deviceKeyHash: string, label = ""): { ownerId: string; keyId: string } {
    const code = normalizeCode(rawCode, RECOVERY_CODE_LENGTH);
    if (!code) throw new StoreFail("invite_invalid");
    return tx(this.db, () => {
      const row = this.db
        .prepare("SELECT owner_id FROM owner_key WHERE kind = 'recovery' AND key_hash = ? AND revoked_at IS NULL")
        .get(recoveryHash(code)) as { owner_id: string } | undefined;
      if (!row) throw new StoreFail("invite_invalid");
      const ownerId = this.resolveOwner(row.owner_id);
      return { ownerId, keyId: this.attachDevice(ownerId, deviceKeyHash, label) };
    });
  }

  /**
   * Fold owner `from` into `to` (later: the same person logs in on two devices). One transaction: claims, entitlements, keys move;
   * `from.merged_into = to` so old references still resolve. Photos and share links hang off claims, so they follow. (§9 #30)
   */
  mergeOwners(from: string, to: string): void {
    if (from === to) return;
    tx(this.db, () => {
      this.db.prepare("UPDATE claim SET owner_id = ? WHERE owner_id = ?").run(to, from);
      this.db.prepare("UPDATE entitlement SET owner_id = ? WHERE owner_id = ?").run(to, from);
      this.db.prepare("UPDATE owner_key SET owner_id = ? WHERE owner_id = ?").run(to, from);
      this.db.prepare("UPDATE owner SET merged_into = ? WHERE id = ?").run(to, from);
    });
  }

  // ─── claims ───

  liveClaimsOf(ownerId: string): ClaimRow[] {
    return this.db
      .prepare(`SELECT ${CLAIM_COLS} FROM claim WHERE owner_id = ? AND status IN ('active','hidden') ORDER BY created_at`)
      .all(ownerId) as unknown as ClaimRow[];
  }

  /** How many more cubbies this owner may take: the free beta one, plus slot entitlements not yet used (paid later). */
  claimAllowance(ownerId: string): number {
    const live = this.liveClaimsOf(ownerId).length;
    const extra = (
      this.db
        .prepare("SELECT COUNT(*) AS n FROM entitlement WHERE owner_id = ? AND sku LIKE 'slot_%' AND sku <> ? AND claim_id IS NULL AND (ends_at IS NULL OR ends_at > ?)")
        .get(ownerId, SKU_SLOT_BETA, this.now()) as { n: number }
    ).n;
    return Math.max(0, FREE_CLAIMS_PER_OWNER + Number(extra) - live);
  }

  liveClaimBySlot(slotId: string): ClaimRow | undefined {
    return this.db.prepare(`SELECT ${CLAIM_COLS} FROM claim WHERE slot_id = ? AND status IN ('active','hidden')`).get(slotId) as
      | ClaimRow
      | undefined;
  }

  claimById(id: string): ClaimRow | undefined {
    return this.db.prepare(`SELECT ${CLAIM_COLS} FROM claim WHERE id = ?`).get(id) as ClaimRow | undefined;
  }

  /** Every active claim (the hall's 3D props, the room's "filled" set). */
  activeClaims(): ClaimRow[] {
    return this.db.prepare(`SELECT ${CLAIM_COLS} FROM claim WHERE status = 'active' ORDER BY created_at`).all() as unknown as ClaimRow[];
  }

  /** Claim a free cubby for `ownerId`, granting the beta entitlement, in one transaction. */
  createClaim(ownerId: string, slotId: string, f: ClaimFields, byKeyHash: string): ClaimRow {
    return tx(this.db, () => {
      const slot = this.slot(slotId);
      if (!slot || slot.sample) throw new StoreFail("slot_unavailable");
      if (this.liveClaimBySlot(slotId)) throw new StoreFail("slot_taken");
      if (this.claimAllowance(ownerId) <= 0) throw new StoreFail("claim_limit");
      const id = crypto.randomUUID();
      const now = this.now();
      this.db
        .prepare(
          `INSERT INTO claim (id, slot_id, owner_id, pet_name, species, born, born_prec, passed, passed_prec, line, created_by_key, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, slotId, ownerId, f.petName, f.species, f.born, f.bornPrec, f.passed, f.passedPrec, f.line, byKeyHash, now, now);
      this.db
        .prepare("INSERT INTO entitlement (id, owner_id, claim_id, sku, source, starts_at, created_at) VALUES (?, ?, ?, ?, 'beta', ?, ?)")
        .run(randomId(), ownerId, id, SKU_SLOT_BETA, now, now);
      return this.claimById(id)!;
    });
  }

  updateClaim(id: string, f: ClaimFields, privacy?: "public" | "family"): ClaimRow {
    this.db
      .prepare(
        `UPDATE claim SET pet_name = ?, species = ?, born = ?, born_prec = ?, passed = ?, passed_prec = ?, line = ?,
         privacy = COALESCE(?, privacy), updated_at = ? WHERE id = ?`,
      )
      .run(f.petName, f.species, f.born, f.bornPrec, f.passed, f.passedPrec, f.line, privacy ?? null, this.now(), id);
    return this.claimById(id)!;
  }

  entitlementsOf(ownerId: string): { sku: string; source: string; claim_id: string | null }[] {
    return this.db.prepare("SELECT sku, source, claim_id FROM entitlement WHERE owner_id = ? ORDER BY created_at").all(ownerId) as unknown as {
      sku: string;
      source: string;
      claim_id: string | null;
    }[];
  }

  // ─── photos ───

  livePhotos(claimId: string): PhotoRow[] {
    return this.db
      .prepare(`SELECT ${PHOTO_COLS} FROM photo WHERE claim_id = ? AND deleted_at IS NULL ORDER BY created_at DESC, rowid DESC`)
      .all(claimId) as unknown as PhotoRow[];
  }

  photo(id: string): PhotoRow | undefined {
    return this.db.prepare(`SELECT ${PHOTO_COLS} FROM photo WHERE id = ?`).get(id) as PhotoRow | undefined;
  }

  /** Album size limit: the free 5 (album_ext later via entitlement). Rejected photos do not count. */
  albumLimit(_claimId: string): number {
    return ALBUM_FREE;
  }

  /** Photos uploaded by any key of this owner since `since` (the 30-a-day cap survives restarts). */
  uploadsSince(ownerId: string, since: number): number {
    return Number(
      (
        this.db
          .prepare("SELECT COUNT(*) AS n FROM photo p JOIN claim c ON c.id = p.claim_id WHERE c.owner_id = ? AND p.created_at >= ?")
          .get(ownerId, since) as { n: number }
      ).n,
    );
  }

  /** Record a processed upload as the claim's new cover (earlier covers stay in the album). */
  addPhoto(p: { id: string; claimId: string; sha256: string; w: number; h: number; bytes: number; byKeyHash: string }): PhotoRow {
    return tx(this.db, () => {
      const live = this.livePhotos(p.claimId).filter((x) => x.moderation !== "rejected");
      if (live.some((x) => x.sha256 === p.sha256)) throw new StoreFail("duplicate_photo");
      if (live.length >= this.albumLimit(p.claimId)) throw new StoreFail("album_full");
      // A rejected photo with the same bytes is soft-deleted so the unique index lets the family try it again after an appeal.
      this.db.prepare("UPDATE photo SET deleted_at = ? WHERE claim_id = ? AND sha256 = ? AND deleted_at IS NULL").run(this.now(), p.claimId, p.sha256);
      this.db.prepare("UPDATE photo SET is_cover = 0 WHERE claim_id = ?").run(p.claimId);
      this.db
        .prepare(
          `INSERT INTO photo (id, claim_id, sha256, w, h, bytes, moderation, is_cover, uploaded_by_key, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'pending', 1, ?, ?)`,
        )
        .run(p.id, p.claimId, p.sha256, p.w, p.h, p.bytes, p.byKeyHash, this.now());
      return this.photo(p.id)!;
    });
  }

  reviewQueue(limit = 100): (PhotoRow & { slot_id: string; pet_name: string })[] {
    return this.db
      .prepare(
        `SELECT p.id, p.claim_id, p.sha256, p.w, p.h, p.bytes, p.moderation, p.reviewed_at, p.reject_reason, p.is_cover, p.caption,
                p.visibility, p.created_at, p.deleted_at, c.slot_id, c.pet_name
         FROM photo p JOIN claim c ON c.id = p.claim_id
         WHERE p.moderation = 'pending' AND p.deleted_at IS NULL AND c.status IN ('active','hidden')
         ORDER BY p.created_at LIMIT ?`,
      )
      .all(limit) as unknown as (PhotoRow & { slot_id: string; pet_name: string })[];
  }

  setModeration(photoId: string, decision: "approved" | "rejected", reason: string | null): PhotoRow | null {
    const r = this.db
      .prepare("UPDATE photo SET moderation = ?, reviewed_at = ?, reject_reason = ? WHERE id = ? AND deleted_at IS NULL")
      .run(decision, this.now(), reason, photoId);
    return Number(r.changes) > 0 ? this.photo(photoId)! : null;
  }
}

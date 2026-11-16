import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { INVITE_TTL_MS } from "@caysonverse/shared/memorial/constants";
import { backupTo, migrate, openDb } from "../db/sqlite";
import { MIGRATIONS } from "../db/migrations";
import { fakeShift } from "../clock";
import { Memorial } from "./service";
import { sha256Hex, StoreFail } from "./store";
import { deviceKey, tempDir, testConfig } from "./testUtil";

const FIELDS = { petName: "콩이", species: "dog" as const, born: "2014-05-17", bornPrec: "day" as const, passed: "2026-11-01", passedPrec: "day" as const, line: "고마웠어요" };
const SLOT = "M1-A-r3-c10";
const SLOT2 = "M1-B-r2-c04";

const open: Memorial[] = [];
function make(t = { t: Date.UTC(2026, 10, 16) }, dir = tempDir("store")) {
  const m = new Memorial(testConfig(dir), () => t.t);
  open.push(m);
  return { m, t, dir };
}
afterEach(() => {
  for (const m of open.splice(0)) {
    try {
      m.close();
    } catch {
      /* closed */
    }
  }
});

const fail = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof StoreFail ? e.code : String(e);
  }
  return "ok";
};

describe("database", () => {
  it("migrates once, in WAL, seeds the catalog with FREE prices only and every cubby slot", () => {
    const { m } = make();
    const db = m.store.db;
    expect((db.prepare("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode).toBe("wal");
    expect((db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number }).foreign_keys).toBe(1);
    expect(db.prepare("SELECT version FROM schema_migrations ORDER BY version").all().map((r) => (r as { version: number }).version)).toEqual([1, 2]);
    expect(migrate(db, MIGRATIONS)).toEqual([]); // idempotent
    const prices = db.prepare("SELECT DISTINCT currency FROM price").all() as { currency: string }[];
    expect(prices.map((p) => p.currency)).toEqual(["FREE"]);
    expect((db.prepare("SELECT COUNT(*) n FROM slot").get() as { n: number }).n).toBe(368);
    expect((db.prepare("SELECT id FROM slot WHERE sample = 1").all() as { id: string }[]).map((r) => r.id)).toEqual(["M1-A-r3-c11"]);
    expect((db.prepare("SELECT COUNT(*) n FROM garden_spot").get() as { n: number }).n).toBe(16);
    for (const t of ["owner_key", "invite", "claim", "photo", "entitlement", "catalog", "price", "guestbook", "report", "block", "share_link", "ceremony", "claim_stats"]) {
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(t), t).toBeTruthy();
    }
  });

  it("keeps everything across a restart and makes an online backup", () => {
    const { m, dir } = make();
    const kh = sha256Hex(deviceKey());
    const o = m.store.createOwner(kh);
    m.store.createClaim(o.ownerId, SLOT, FIELDS, kh);
    m.close();
    open.length = 0;
    const again = make(undefined, dir).m;
    expect(again.isClaimed(SLOT)).toBe(true);
    expect(again.store.ownerByKeyHash(kh)?.ownerId).toBe(o.ownerId);
    const bak = path.join(dir, "backup.db");
    backupTo(again.store.db, bak);
    const copy = openDb(bak);
    expect((copy.prepare("SELECT COUNT(*) n FROM claim").get() as { n: number }).n).toBe(1);
    copy.close();
    expect(fs.existsSync(bak)).toBe(true);
  });
});

describe("owners and claims", () => {
  it("one free cubby per owner; taken, sample and unknown slots refused", () => {
    const { m } = make();
    const kh = sha256Hex(deviceKey());
    const o = m.store.createOwner(kh);
    expect(o.recoveryCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{12}$/);
    expect(m.store.claimAllowance(o.ownerId)).toBe(1);
    const c = m.store.createClaim(o.ownerId, SLOT, FIELDS, kh);
    expect(c.status).toBe("active");
    expect(m.store.entitlementsOf(o.ownerId)).toEqual([{ sku: "slot_beta", source: "beta", claim_id: c.id }]);
    expect(m.store.claimAllowance(o.ownerId)).toBe(0);
    expect(fail(() => m.store.createClaim(o.ownerId, SLOT2, FIELDS, kh))).toBe("claim_limit");
    const kh2 = sha256Hex(deviceKey());
    const o2 = m.store.createOwner(kh2);
    expect(fail(() => m.store.createClaim(o2.ownerId, SLOT, FIELDS, kh2))).toBe("slot_taken");
    expect(fail(() => m.store.createClaim(o2.ownerId, "M1-A-r3-c11", FIELDS, kh2))).toBe("slot_unavailable");
    expect(fail(() => m.store.createClaim(o2.ownerId, "M9-Z-r0-c00", FIELDS, kh2))).toBe("slot_unavailable");
    expect(fail(() => m.store.createClaim(o2.ownerId, SLOT2, FIELDS, kh2))).toBe("ok");
  });

  it("a paid slot entitlement (later) adds an allowance without code changes", () => {
    const { m } = make();
    const kh = sha256Hex(deviceKey());
    const o = m.store.createOwner(kh);
    m.store.db.prepare("INSERT INTO catalog (sku, kind, title, active) VALUES ('slot_year', 'slot', 't', 1)").run();
    m.store.db
      .prepare("INSERT INTO entitlement (id, owner_id, sku, source, starts_at, created_at) VALUES ('e1', ?, 'slot_year', 'krw', 0, 0)")
      .run(o.ownerId);
    expect(m.store.claimAllowance(o.ownerId)).toBe(2);
  });
});

describe("family devices (test matrix #29)", () => {
  it("an invite joins a second device once, within 24 hours", () => {
    const { m, t } = make();
    const kh = sha256Hex(deviceKey());
    const o = m.store.createOwner(kh);
    m.store.createClaim(o.ownerId, SLOT, FIELDS, kh);
    const inv = m.store.createInvite(o.ownerId);
    expect(inv.expiresAt - t.t).toBe(INVITE_TTL_MS);
    const kh2 = sha256Hex(deviceKey());
    expect(m.store.joinInvite(inv.code.toLowerCase().replace(/(.{4})/g, "$1-"), kh2, "엄마 폰").ownerId).toBe(o.ownerId);
    expect(m.store.ownerByKeyHash(kh2)?.ownerId).toBe(o.ownerId);
    expect(fail(() => m.store.joinInvite(inv.code, sha256Hex(deviceKey())))).toBe("invite_invalid"); // used
    const late = m.store.createInvite(o.ownerId);
    t.t += INVITE_TTL_MS + 1;
    expect(fail(() => m.store.joinInvite(late.code, sha256Hex(deviceKey())))).toBe("invite_invalid"); // expired
    expect(fail(() => m.store.joinInvite("nonsense", sha256Hex(deviceKey())))).toBe("invite_invalid");
    expect(m.store.devicesOf(o.ownerId).map((d) => d.label)).toEqual(["", "엄마 폰"]);
  });

  it("at most 6 devices; a device holding another family's cubby is refused; removing a device", () => {
    const { m } = make();
    const kh = sha256Hex(deviceKey());
    const o = m.store.createOwner(kh);
    for (let i = 0; i < 5; i += 1) m.store.joinInvite(m.store.createInvite(o.ownerId).code, sha256Hex(deviceKey()));
    expect(m.store.devicesOf(o.ownerId)).toHaveLength(6);
    expect(fail(() => m.store.joinInvite(m.store.createInvite(o.ownerId).code, sha256Hex(deviceKey())))).toBe("device_limit");
    const other = sha256Hex(deviceKey());
    const o2 = m.store.createOwner(other);
    m.store.createClaim(o2.ownerId, SLOT2, FIELDS, other);
    const keyId = m.store.devicesOf(o.ownerId)[5]!.id;
    expect(m.store.revokeDevice(o.ownerId, keyId)).toBe(true);
    expect(fail(() => m.store.joinInvite(m.store.createInvite(o.ownerId).code, other))).toBe("device_owned");
  });

  it("the recovery code brings a new device back", () => {
    const { m } = make();
    const kh = sha256Hex(deviceKey());
    const o = m.store.createOwner(kh);
    const fresh = sha256Hex(deviceKey());
    expect(m.store.recover(o.recoveryCode, fresh).ownerId).toBe(o.ownerId);
    expect(fail(() => m.store.recover("AAAAAAAAAAAA", sha256Hex(deviceKey())))).toBe("invite_invalid");
  });

  it("merging owners keeps claims, photos, entitlements and keys together (test matrix #30)", () => {
    const { m } = make();
    const a = sha256Hex(deviceKey());
    const b = sha256Hex(deviceKey());
    const oa = m.store.createOwner(a);
    const ob = m.store.createOwner(b);
    const c = m.store.createClaim(oa.ownerId, SLOT, FIELDS, a);
    m.store.addPhoto({ id: "p".repeat(22), claimId: c.id, sha256: "x", w: 100, h: 100, bytes: 1, byKeyHash: a });
    m.store.mergeOwners(oa.ownerId, ob.ownerId);
    expect(m.store.ownerByKeyHash(a)?.ownerId).toBe(ob.ownerId);
    expect(m.store.liveClaimsOf(ob.ownerId).map((x) => x.id)).toEqual([c.id]);
    expect(m.store.livePhotos(c.id)).toHaveLength(1);
    expect(m.store.entitlementsOf(ob.ownerId)).toHaveLength(1);
    expect(m.store.resolveOwner(oa.ownerId)).toBe(ob.ownerId);
  });
});

describe("photos in the store", () => {
  it("album of 5 (rejected ones do not count), duplicates refused, newest is the cover", () => {
    const { m } = make();
    const kh = sha256Hex(deviceKey());
    const o = m.store.createOwner(kh);
    const c = m.store.createClaim(o.ownerId, SLOT, FIELDS, kh);
    const add = (i: number, sha = `s${i}`) => m.store.addPhoto({ id: String(i).padStart(22, "0"), claimId: c.id, sha256: sha, w: 1, h: 1, bytes: 1, byKeyHash: kh });
    add(1);
    expect(fail(() => add(2, "s1"))).toBe("duplicate_photo");
    m.store.setModeration(String(1).padStart(22, "0"), "rejected", null);
    for (let i = 3; i <= 7; i += 1) add(i);
    expect(fail(() => add(8))).toBe("album_full");
    const live = m.store.livePhotos(c.id);
    expect(live.filter((p) => p.is_cover === 1).map((p) => p.id)).toEqual([String(7).padStart(22, "0")]);
    expect(m.store.reviewQueue().length).toBe(5);
  });
});

describe("test clock CV_FAKE_NOW", () => {
  it("reads ISO instants and offsets, ignores nonsense", () => {
    const real = Date.UTC(2026, 10, 16);
    expect(fakeShift("+3d", real)).toBe(3 * 86_400_000);
    expect(fakeShift("-2h+30m", real)).toBe(-2 * 3_600_000 + 30 * 60_000);
    expect(fakeShift("2026-11-15T19:54:00+09:00", real)).toBe(Date.UTC(2026, 10, 15, 10, 54) - real);
    expect(fakeShift("tomorrow", real)).toBeNull();
    expect(fakeShift(undefined, real)).toBeNull();
  });
});

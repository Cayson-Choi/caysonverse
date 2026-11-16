import { CATALOG_SEED } from "@caysonverse/shared/memorial/constants";
import type { Migration } from "./index";

/**
 * 001 — memorial stage B core (memorial design §4-4 + memorial-2 §4-1/§4-2 shapes adopted up front so accounts, a shop and
 * game money can attach later without moving data):
 *   owner ← owner_key (device | recovery | account), invite; slot (every cubby, stable ids) + slot_moves; claim (one per active
 *   slot) carrying the memorial-2 day / ceremony / guestbook / album columns; photo (moderation + album columns); decor; tribute;
 *   catalog + price (FREE rows only now); "order" (empty until payments); entitlement (what an owner has, whatever the source).
 * Timestamps are epoch ms (INTEGER). Ids are random text (uuid or base64url).
 */
export const m001: Migration = {
  version: 1,
  name: "core_owner_claim_photo_catalog",
  up(db) {
    db.exec(`
CREATE TABLE owner (
  id TEXT PRIMARY KEY,
  nickname TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  merged_into TEXT NULL REFERENCES owner(id)
);
CREATE TABLE owner_key (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES owner(id),
  kind TEXT NOT NULL CHECK (kind IN ('device','recovery','account')),
  key_hash TEXT NOT NULL,
  provider TEXT NULL,
  label TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NULL,
  revoked_at INTEGER NULL
);
CREATE UNIQUE INDEX owner_key_live ON owner_key(kind, key_hash) WHERE revoked_at IS NULL;
CREATE INDEX owner_key_owner ON owner_key(owner_id);
CREATE TABLE invite (
  code_hash TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES owner(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER NULL,
  used_by_key TEXT NULL
);
CREATE TABLE slot (
  id TEXT PRIMARY KEY,
  hall TEXT NOT NULL,
  bank TEXT NOT NULL,
  row INTEGER NOT NULL,
  col INTEGER NOT NULL,
  tier TEXT NOT NULL DEFAULT 'standard',
  sample INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE slot_moves (
  old_id TEXT NOT NULL,
  new_id TEXT NOT NULL REFERENCES slot(id),
  moved_at INTEGER NOT NULL,
  PRIMARY KEY (old_id, moved_at)
);
CREATE TABLE claim (
  id TEXT PRIMARY KEY,
  slot_id TEXT NOT NULL REFERENCES slot(id),
  owner_id TEXT NOT NULL REFERENCES owner(id),
  pet_name TEXT NOT NULL,
  species TEXT NOT NULL CHECK (species IN ('dog','cat','other')),
  born TEXT NULL,
  born_prec TEXT NOT NULL DEFAULT 'unknown' CHECK (born_prec IN ('day','md','unknown')),
  passed TEXT NULL,
  passed_prec TEXT NOT NULL DEFAULT 'unknown' CHECK (passed_prec IN ('day','md','unknown')),
  line TEXT NOT NULL DEFAULT '',
  privacy TEXT NOT NULL DEFAULT 'public' CHECK (privacy IN ('public','family')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','hidden','expired','released')),
  plan TEXT NOT NULL DEFAULT 'beta_free' CHECK (plan IN ('beta_free','paid')),
  days_json TEXT NOT NULL DEFAULT '{}',
  ceremony_optin TEXT NOT NULL DEFAULT 'anniv_week' CHECK (ceremony_optin IN ('off','anniv_week','this_week')),
  guestbook_mode TEXT NOT NULL DEFAULT 'open' CHECK (guestbook_mode IN ('open','closed')),
  album_visibility TEXT NOT NULL DEFAULT 'public' CHECK (album_visibility IN ('public','family')),
  created_by_key TEXT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX claim_slot_live ON claim(slot_id) WHERE status IN ('active','hidden');
CREATE INDEX claim_owner ON claim(owner_id);
CREATE TABLE photo (
  id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL REFERENCES claim(id),
  sha256 TEXT NOT NULL,
  w INTEGER NOT NULL,
  h INTEGER NOT NULL,
  bytes INTEGER NOT NULL,
  moderation TEXT NOT NULL DEFAULT 'pending' CHECK (moderation IN ('pending','approved','rejected')),
  reviewed_at INTEGER NULL,
  reject_reason TEXT NULL,
  album_order INTEGER NOT NULL DEFAULT 0,
  caption TEXT NOT NULL DEFAULT '',
  taken_on TEXT NULL,
  is_cover INTEGER NOT NULL DEFAULT 0,
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','family')),
  uploaded_by_key TEXT NULL,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER NULL
);
CREATE UNIQUE INDEX photo_claim_sha ON photo(claim_id, sha256) WHERE deleted_at IS NULL;
CREATE INDEX photo_claim ON photo(claim_id);
CREATE INDEX photo_pending ON photo(moderation) WHERE moderation = 'pending' AND deleted_at IS NULL;
CREATE TABLE decor (
  claim_id TEXT NOT NULL REFERENCES claim(id),
  pos TEXT NOT NULL,
  sku TEXT NOT NULL,
  variant TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (claim_id, pos)
);
CREATE TABLE tribute (
  id TEXT PRIMARY KEY,
  target TEXT NOT NULL CHECK (target IN ('slot','garden','hall')),
  target_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('flower','candle','letter')),
  sku TEXT NULL,
  by_owner_id TEXT NULL REFERENCES owner(id),
  by_key_hash TEXT NOT NULL,
  nickname TEXT NOT NULL DEFAULT '',
  text TEXT NULL,
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','family','hidden')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NULL
);
CREATE INDEX tribute_target ON tribute(target, target_id, created_at);
CREATE TABLE catalog (
  sku TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('slot','decor','album_ext','frame','garden_tree','bench_plaque','flower','occasion_theme')),
  title TEXT NOT NULL,
  art_id TEXT NULL,
  active INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE price (
  sku TEXT NOT NULL REFERENCES catalog(sku),
  currency TEXT NOT NULL CHECK (currency IN ('FREE','KRW','COIN')),
  amount INTEGER NOT NULL CHECK (amount >= 0),
  term TEXT NOT NULL DEFAULT 'once' CHECK (term IN ('once','year')),
  valid_from INTEGER NOT NULL,
  valid_to INTEGER NULL,
  PRIMARY KEY (sku, currency, valid_from)
);
CREATE TABLE "order" (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES owner(id),
  provider TEXT NOT NULL,
  provider_ref TEXT NULL,
  sku TEXT NOT NULL REFERENCES catalog(sku),
  currency TEXT NOT NULL,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE entitlement (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES owner(id),
  claim_id TEXT NULL REFERENCES claim(id),
  sku TEXT NOT NULL REFERENCES catalog(sku),
  source TEXT NOT NULL CHECK (source IN ('free','beta','krw','coin','grant')),
  order_id TEXT NULL REFERENCES "order"(id),
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX entitlement_owner ON entitlement(owner_id);
CREATE INDEX entitlement_claim ON entitlement(claim_id);
`);
    const now = Date.now();
    const cat = db.prepare("INSERT INTO catalog (sku, kind, title, active) VALUES (?, ?, ?, ?)");
    const price = db.prepare("INSERT INTO price (sku, currency, amount, term, valid_from) VALUES (?, 'FREE', 0, 'once', ?)");
    for (const c of CATALOG_SEED) {
      cat.run(c.sku, c.kind, c.title, c.active ? 1 : 0);
      if (c.free) price.run(c.sku, now);
    }
  },
};

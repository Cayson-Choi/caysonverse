import type { Migration } from "./index";

/**
 * 002 — memorial-2 (B14) tables, created now so W1–W5 build on a fixed schema (W0 contract; design memorial-2 §4-2):
 * claim_stats (running totals the card reads), guestbook, report, block, share_link, ceremony, garden_spot (12 fixed tree spots).
 * No code writes them yet. Later columns go in a NEW migration file (003_…), never by editing this one.
 */
export const m002: Migration = {
  version: 2,
  name: "memorial2_guestbook_share_ceremony_garden",
  up(db) {
    db.exec(`
CREATE TABLE claim_stats (
  claim_id TEXT PRIMARY KEY REFERENCES claim(id),
  flowers INTEGER NOT NULL DEFAULT 0,
  candles INTEGER NOT NULL DEFAULT 0,
  guestbook INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE guestbook (
  id TEXT PRIMARY KEY,
  target TEXT NOT NULL CHECK (target IN ('slot','hall')),
  target_id TEXT NOT NULL,
  by_owner_id TEXT NULL REFERENCES owner(id),
  by_key_hash TEXT NOT NULL,
  nickname TEXT NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible','hidden_owner','hidden_reports','removed_admin')),
  ip_hash TEXT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX guestbook_target ON guestbook(target, target_id, created_at);
CREATE INDEX guestbook_by_key ON guestbook(by_key_hash, created_at);
CREATE TABLE report (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('guestbook','photo','claim')),
  target_id TEXT NOT NULL,
  by_key_hash TEXT NOT NULL,
  by_family INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  resolved_at INTEGER NULL
);
CREATE UNIQUE INDEX report_once ON report(kind, target_id, by_key_hash);
CREATE TABLE block (
  claim_id TEXT NOT NULL REFERENCES claim(id),
  key_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (claim_id, key_hash)
);
CREATE TABLE share_link (
  code TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL REFERENCES claim(id),
  preview_photo INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER NULL
);
CREATE UNIQUE INDEX share_link_live ON share_link(claim_id) WHERE revoked_at IS NULL;
CREATE TABLE ceremony (
  id TEXT PRIMARY KEY,
  starts_at INTEGER NOT NULL,
  participants INTEGER NOT NULL DEFAULT 0,
  lit INTEGER NOT NULL DEFAULT 0,
  names_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);
CREATE TABLE garden_spot (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('tree','bench_plaque')),
  claim_id TEXT NULL REFERENCES claim(id),
  entitlement_id TEXT NULL REFERENCES entitlement(id),
  plaque_text TEXT NOT NULL DEFAULT ''
);
`);
    const spot = db.prepare("INSERT INTO garden_spot (id, kind) VALUES (?, ?)");
    for (let i = 1; i <= 12; i += 1) spot.run(`G1-T${String(i).padStart(2, "0")}`, "tree");
    for (let i = 1; i <= 4; i += 1) spot.run(`G1-B${String(i).padStart(2, "0")}`, "bench_plaque");
  },
};

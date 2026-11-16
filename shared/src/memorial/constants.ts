/**
 * Memorial (추모관) stage B + memorial-2 (B14) contract — constants shared by the server and the client. Browser-safe: values
 * only, no I/O. Design: docs/handoff/designs/memorial/design.md §4-4 (stage B) and docs/designs/memorial-2/design.md §3–§5, §9.
 *
 * Every limit a server check enforces lives here, so the client can show the same number ("남은 글자 12자") and a test can pin it.
 */

/** The time zone of every date rule (occasions, the ceremony, "today"): the server's KST clock, never the device's. */
export const MEMORIAL_TZ = "Asia/Seoul";
/** KST is UTC+9 all year (no daylight saving). */
export const KST_OFFSET_MS = 9 * 60 * 60_000;

// ─── Identity: owner + keys (design memorial-2 §4-1) ───────────────────────────────────────────

/** A device key: 32 random bytes, base64url without padding (43 chars). Made in the browser, only its SHA-256 reaches the DB. */
export const DEVICE_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;
/** The HTTP header scheme: `Authorization: Device <key>`. */
export const DEVICE_AUTH_SCHEME = "Device";
/** At most this many live device keys per owner (family devices). */
export const MAX_DEVICE_KEYS = 6;
/** Family invite: 12 Crockford base32 chars, single use, 24 h. */
export const INVITE_CODE_LENGTH = 12;
export const INVITE_TTL_MS = 24 * 60 * 60_000;
/** Recovery code: 12 Crockford base32 chars (60 bits), shown once at the first claim. */
export const RECOVERY_CODE_LENGTH = 12;
/** A device label ("엄마 폰"), shown in the family-device list. */
export const DEVICE_LABEL_MAX = 12;

/** Crockford base32 (no I, L, O, U): share codes, invite codes, recovery codes. */
export const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

// ─── Claims (모시기) ──────────────────────────────────────────────────────────────────────────

/** Cubbies an owner may hold for free during the beta (owner 2026-11-16: one free cubby per owner now). */
export const FREE_CLAIMS_PER_OWNER = 1;
export const PET_NAME_MIN = 1;
export const PET_NAME_MAX = 12;
/** The family's one line on the card. */
export const CLAIM_LINE_MAX = 40;
/** Species chips of the claim form (stored as the key). */
export const SPECIES = ["dog", "cat", "other"] as const;
export type Species = (typeof SPECIES)[number];
export const SPECIES_LABEL: Readonly<Record<Species, string>> = { dog: "강아지", cat: "고양이", other: "그 밖의 아이" };
/** Earliest date a birth / memorial day may carry. */
export const CLAIM_DATE_MIN = "1980-01-01";

// ─── Photos (design memorial-2 §4-3) ─────────────────────────────────────────────────────────────

/** The client shrinks to this long edge (JPEG 0.85) before uploading. */
export const PHOTO_UPLOAD_EDGE = 1600;
/** A picked file larger than this is refused before resizing (iPhone originals are well under it). */
export const PHOTO_SOURCE_MAX_BYTES = 20 * 1024 * 1024;
/** The uploaded (already resized) body may be at most this big. */
export const PHOTO_UPLOAD_MAX_BYTES = 2 * 1024 * 1024;
/** Decoded pixel size bounds of an upload (each side). */
export const PHOTO_MIN_PX = 64;
export const PHOTO_MAX_PX = 8000;
/** The three stored sizes (long edge, WebP): close-up viewer, card, cubby atlas tile. */
export const PHOTO_SIZES = [1600, 512, 128] as const;
export type PhotoSize = (typeof PHOTO_SIZES)[number];
/** Accepted upload content types (checked against the magic bytes too). */
export const PHOTO_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
/** Free album size per claim, cover included (design memorial-2 F3; more is the paid `album_ext_30`). */
export const ALBUM_FREE = 5;
/** Photo uploads per owner per 24 h. */
export const PHOTO_UPLOADS_PER_DAY = 30;
/** Signed URLs for pending / family-only photos live this long. */
export const SIGNED_URL_TTL_MS = 10 * 60_000;
export const PHOTO_CAPTION_MAX = 40;

// ─── Abuse limits (design memorial-2 §5-2; stage B ones first) ───────────────────────────────────

/** New owners (first claims) per IP per 24 h — a fresh device key is free, so the IP caps how many free cubbies one person takes. */
export const NEW_OWNERS_PER_IP_PER_DAY = 3;
/** Claim edits per owner per hour. */
export const CLAIM_EDITS_PER_HOUR = 30;
/** Invite / join / recover attempts per IP per hour. */
export const KEY_ATTEMPTS_PER_IP_PER_HOUR = 20;
/** Admin key failures per IP per 10 minutes. */
export const ADMIN_FAILS_PER_IP = 10;

// memorial-2 limits (W1 implements; the numbers are the contract)
export const GUESTBOOK_MAX = 80;
export const GUESTBOOK_PER_TARGET_PER_DAY = 1;
export const GUESTBOOK_PER_DAY = 10;
export const GUESTBOOK_PER_IP_PER_DAY = 30;
/** A device key younger than this may not write in a guestbook. */
export const GUESTBOOK_NEW_KEY_WAIT_MS = 10 * 60_000;
export const GUESTBOOK_PAGE = 20;
export const FLOWERS_PER_TARGET_PER_DAY = 1;
export const FLOWERS_PER_DAY = 20;
export const SHARE_FLOWERS_PER_IP_PER_DAY = 10;
/** Flowers stay this long; at most this many bouquets per cubby (oldest leave first). */
export const FLOWER_TTL_MS = 24 * 60 * 60_000;
export const FLOWERS_PER_CUBBY = 5;
export const REPORTS_PER_DAY = 20;
/** Distinct reporters that auto-hide a guestbook line or photo (a family report hides at once). */
export const REPORTS_TO_HIDE = 3;
/** Unknown share codes per IP per minute before a 10-minute block. */
export const SHARE_LOOKUPS_PER_MIN = 30;
export const SHARE_BLOCK_MS = 10 * 60_000;
/** Share code: 8 Crockford chars (40 bits). */
export const SHARE_CODE_LENGTH = 8;

// ─── Catalog (design memorial-2 §4-2, §6) — FREE now, KRW / COIN rows later ──────────────────────

export const CURRENCIES = ["FREE", "KRW", "COIN"] as const;
export type Currency = (typeof CURRENCIES)[number];
export const CATALOG_KINDS = ["slot", "decor", "album_ext", "frame", "garden_tree", "bench_plaque", "flower", "occasion_theme"] as const;
export type CatalogKind = (typeof CATALOG_KINDS)[number];
export const ENTITLEMENT_SOURCES = ["free", "beta", "krw", "coin", "grant"] as const;
export type EntitlementSource = (typeof ENTITLEMENT_SOURCES)[number];

/** The SKU every beta claim is granted (source `beta`). */
export const SKU_SLOT_BETA = "slot_beta";
/** The three free visitor flowers (F2). */
export const FLOWER_SKUS = ["flower_chrysanthemum", "flower_babys_breath", "flower_freesia"] as const;
export type FlowerSku = (typeof FLOWER_SKUS)[number];

export interface CatalogSeed {
  sku: string;
  kind: CatalogKind;
  title: string;
  /** Sold / granted now. Paid candidates are listed inactive with no price row (design §6: "catalog에 자리만"). */
  active: boolean;
  /** FREE price row (amount 0) — only active free items carry one now. */
  free: boolean;
}

/** The catalog the first migration seeds. Paid candidates are inactive: no prices exist yet. */
export const CATALOG_SEED: readonly CatalogSeed[] = Object.freeze([
  { sku: SKU_SLOT_BETA, kind: "slot", title: "추모 칸 (베타 무료)", active: true, free: true },
  { sku: "flower_chrysanthemum", kind: "flower", title: "흰 국화", active: true, free: true },
  { sku: "flower_babys_breath", kind: "flower", title: "안개꽃 다발", active: true, free: true },
  { sku: "flower_freesia", kind: "flower", title: "노란 프리지어", active: true, free: true },
  { sku: "album_ext_30", kind: "album_ext", title: "앨범 30장으로 늘리기", active: false, free: false },
  { sku: "frame_digital", kind: "frame", title: "디지털 액자", active: false, free: false },
  { sku: "occasion_theme_peony", kind: "occasion_theme", title: "그날 장식 특별판 (작약 화환)", active: false, free: false },
  { sku: "occasion_theme_cake", kind: "occasion_theme", title: "그날 장식 특별판 (수제 케이크)", active: false, free: false },
  { sku: "occasion_theme_starlight", kind: "occasion_theme", title: "그날 장식 특별판 (별빛 가랜드)", active: false, free: false },
  { sku: "garden_tree_year", kind: "garden_tree", title: "정원 기억 나무 (1년)", active: false, free: false },
  { sku: "bench_plaque_year", kind: "bench_plaque", title: "정원 벤치 명패 (1년)", active: false, free: false },
  { sku: "decor_roof_color", kind: "decor", title: "칸 꾸미기: 지붕 색", active: false, free: false },
  { sku: "decor_urn", kind: "decor", title: "칸 꾸미기: 유골함", active: false, free: false },
  { sku: "decor_toy", kind: "decor", title: "칸 꾸미기: 장난감", active: false, free: false },
  { sku: "decor_frame", kind: "decor", title: "칸 꾸미기: 액자 테두리", active: false, free: false },
] satisfies CatalogSeed[]);

// ─── Ceremony (F4; owner 2026-11-16: every Sunday 20:00 KST, about 10 minutes) ──────────────────

/** 0 = Sunday (JS getUTCDay on the KST-shifted clock). */
export const CEREMONY_WEEKDAY = 0;
export const CEREMONY_HOUR = 20;
export const CEREMONY_MINUTE = 0;
/** Phase lengths (ms). `names` is 4 s per name, at most `CEREMONY_NAMES_MAX` names. */
export const CEREMONY_PHASE_MS = {
  gather: 5 * 60_000,
  open: 30_000,
  namePer: 4_000,
  light: 60_000,
  silence: 60_000,
  close: 20_000,
  afterglow: 60 * 60_000,
} as const;
export const CEREMONY_NAMES_MAX = 40;
/** The quiet one-time banner opens this long before the start (19:30). */
export const CEREMONY_BANNER_LEAD_MS = 30 * 60_000;
/** The bell rings this long before the start (19:55). */
export const CEREMONY_BELL_LEAD_MS = 5 * 60_000;

// ─── Occasions (F1) ────────────────────────────────────────────────────────────────────────────

/** The "coming up" banner on entering the village shows within this many days of a day (±3). */
export const OCCASION_BANNER_DAYS = 3;

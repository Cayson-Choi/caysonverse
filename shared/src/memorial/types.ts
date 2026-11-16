/**
 * Memorial wire types — the HTTPS API bodies (Express, `/api/memorial/...`) and the room payloads. Browser-safe (types only).
 *
 * Stage B (built now): claims, photos + review, owners + device keys + family invites + recovery.
 * memorial-2 W1–W5 (contract only, see messages.ts and docs/designs/memorial-2/design.md §3): occasions, flowers, guestbook,
 * album, ceremony, share links. The shapes here are the contract the parallel builders code against.
 */
import type { FlowerSku, PhotoSize, Species } from "./constants";

/** How exact a stored date is: full date, month-day only (year unknown), or not known at all. */
export type DatePrecision = "day" | "md" | "unknown";

/** `YYYY-MM-DD` (for `md` the year is stored as 0000: `0000-05-17`). */
export type IsoDate = string;

export type Moderation = "pending" | "approved" | "rejected";

/** Media URLs of one photo, relative to the server origin (`/media/p/...` public or `/media/s/...?exp=&sig=` signed). */
export type PhotoUrls = Record<`s${PhotoSize}`, string>;

/** A photo as its family sees it. */
export interface PhotoView {
  id: string;
  moderation: Moderation;
  /** Present unless rejected. */
  urls: PhotoUrls | null;
  isCover: boolean;
  caption: string;
  w: number;
  h: number;
  createdAt: number;
}

/** What anyone may see of a claimed cubby. */
export interface ClaimPublic {
  claimId: string;
  slotId: string;
  petName: string;
  species: Species;
  born: IsoDate | null;
  bornPrec: DatePrecision;
  passed: IsoDate | null;
  passedPrec: DatePrecision;
  line: string;
  /** The newest approved cover, or null (no photo yet, or still in review). */
  photo: PhotoUrls | null;
  createdAt: number;
}

/** A claim of the asking device's owner: the public view plus what only the family sees. */
export interface ClaimMine extends ClaimPublic {
  mine: true;
  privacy: "public" | "family";
  /** Every live photo, newest first, with its review state (pending ones through signed URLs). */
  photos: PhotoView[];
  /** The photo the family sees in the frame now: the newest non-rejected one (pending included). */
  familyCover: PhotoView | null;
  /** The newest upload was rejected (and nothing newer): the card asks for another photo. */
  lastRejected: boolean;
  albumFree: number;
}

export interface DeviceView {
  id: string;
  label: string;
  createdAt: number;
  lastSeenAt: number | null;
  /** The key making this request. */
  current: boolean;
}

/** `GET /api/memorial/me` */
export interface MeResponse {
  owner: {
    id: string;
    devices: DeviceView[];
    claims: ClaimMine[];
    /** Free cubbies still available to this owner (beta: 1 − active claims). */
    freeLeft: number;
  } | null;
}

/** `GET /api/memorial/hall` — every public claim in the hall (the 3D props and frames), plus mine with Device auth. */
export interface HallResponse {
  claims: ClaimPublic[];
  mine: ClaimMine[];
  serverNow: number;
}

/** `POST /api/memorial/claims` */
export interface ClaimCreateBody {
  slotId: string;
  petName: string;
  species: Species;
  born?: IsoDate | null;
  bornPrec?: DatePrecision;
  passed?: IsoDate | null;
  passedPrec?: DatePrecision;
  line?: string;
}
export interface ClaimCreateResponse {
  claim: ClaimMine;
  /** Only when this request created the owner: shown once, "꼭 적어 두세요". */
  recoveryCode?: string;
}

/** `PATCH /api/memorial/claims/:id` (any subset). */
export type ClaimPatchBody = Partial<Omit<ClaimCreateBody, "slotId">> & { privacy?: "public" | "family" };

/** `POST /api/memorial/owners/invite` */
export interface InviteResponse {
  code: string;
  expiresAt: number;
}
/** `POST /api/memorial/owners/join` / `.../recover` */
export interface JoinOwnerBody {
  code: string;
  label?: string;
}
export interface JoinOwnerResponse {
  ownerId: string;
}

/** Every error body: a stable code and a Korean, user-facing line (gentle "~요", never "!"). */
export interface ApiError {
  error: ApiErrorCode;
  message: string;
}
export type ApiErrorCode =
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "slot_taken"
  | "slot_unavailable"
  | "claim_limit"
  | "not_nice"
  | "rate_limited"
  | "too_large"
  | "bad_image"
  | "duplicate_photo"
  | "album_full"
  | "invite_invalid"
  | "device_limit"
  | "device_owned"
  | "unavailable";

/** Admin review queue (`GET /api/memorial/admin/review`, header `X-Admin-Key`). */
export interface AdminReviewItem {
  photoId: string;
  claimId: string;
  slotId: string;
  petName: string;
  createdAt: number;
  urls: PhotoUrls;
}

// ─── memorial-2 (B14) — contract for W1–W5 ─────────────────────────────────────────────────────

/** F1: which day a cubby remembers today. `years` = N주기 for anniversaries, the age for birthdays when the year is known. */
export type OccasionKind = "birthday" | "anniv" | "d49" | "d100";
export interface Occasion {
  kind: OccasionKind;
  years?: number;
}
/** F1: the family's "기억하고 싶은 날" settings (`claim.days_json`, `PATCH /claims/:id/days`). */
export interface DaysSettings {
  birthday: boolean;
  anniv: boolean;
  d49: boolean;
  d100: boolean;
  /** Show the day's decoration to visitors (false = "조용히": family devices only). */
  publicDecor: boolean;
  ceremony: "off" | "anniv_week" | "this_week";
}
export const DEFAULT_DAYS: Readonly<DaysSettings> = Object.freeze({
  birthday: true,
  anniv: true,
  d49: false,
  d100: false,
  publicDecor: true,
  ceremony: "anniv_week",
});

/** Room: `MemorialTodayState` (server → everyone; public cubbies only). */
export interface MemorialTodayPayload {
  /** KST date `YYYY-MM-DD`. */
  date: IsoDate;
  items: { slotId: string; kind: OccasionKind; years?: number }[];
}

/** F2 flower targets: a cubby id, the garden stone, or a garden tree spot. */
export type FlowerTarget = string; // slotId | "garden:stone" | `garden:${string}`
export interface PlaceFlowerPayload {
  target: FlowerTarget;
  sku: FlowerSku;
}
export interface FlowerPlacedPayload {
  target: FlowerTarget;
  sku: FlowerSku;
  by: string;
  agoMs: number;
}
export interface FlowerStatePayload {
  flowers: FlowerPlacedPayload[];
}

/** F2 guestbook. */
export type GuestbookStatus = "visible" | "hidden_owner" | "hidden_reports" | "removed_admin";
export interface GuestbookEntry {
  id: string;
  nickname: string;
  text: string;
  createdAt: number;
  /** Family view only. */
  status?: GuestbookStatus;
}
export interface GuestbookPage {
  entries: GuestbookEntry[];
  /** Pass as `?before=` for the next page; null at the end. */
  next: number | null;
  mode: "open" | "closed";
}
export type ReportKind = "guestbook" | "photo" | "claim";
export interface ReportBody {
  kind: ReportKind;
  targetId: string;
  reason?: string;
}

/** F4 ceremony. */
export type CeremonyPhase = "idle" | "gather" | "open" | "names" | "light" | "silence" | "close" | "afterglow";
export interface CeremonyName {
  slotId: string;
  petName: string;
  species: Species;
  /** Approved public cover only. */
  photo: PhotoUrls | null;
}
export interface CeremonyStatePayload {
  ceremonyId: string;
  phase: CeremonyPhase;
  /** Server ms when this phase ends (clients interpolate with `serverNow`). */
  phaseEndsAt: number;
  serverNow: number;
  /** Sent with `names`. */
  names?: CeremonyName[];
  /** "그리고 함께 기억하는 아이들 N마리". */
  moreNames?: number;
  /** Distinct sessions in any hall of the server during names..close. */
  participants: number;
}
export interface CeremonyLitPayload {
  by: string;
  total: number;
}

/** Room: `ClaimUpdated` (server → every hall of every room): refetch `GET /claims/:slotId`. */
export interface ClaimUpdatedPayload {
  slotId: string;
  /** What changed, so a client can skip work (`photo`, `text`, `released`, `stats`, `claimed`). */
  fields: string[];
}

/** F6 share page data (`GET /api/memorial/share/:code`). */
export interface ShareView {
  status: "open" | "closed";
  claim?: ClaimPublic & { where: string; flowers: number; candles: number; guestbook: number };
  guestbook?: GuestbookEntry[];
  today?: Occasion[];
}

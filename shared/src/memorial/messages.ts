/**
 * Memorial room messages (memorial-2 contract, W0). Browser-safe. VillageRoom registers each handler with ONE line; the bodies
 * live in their own files (W1 flowers / occasions in server/src/memorial/*, W3 ceremony in server/src/rooms/ceremony.ts).
 *
 * Every name is prefixed `Mem` so it can never collide with MessageType / VillageMsg / VillageServerMsg (a test pins it).
 * Payload types: ./types.ts.
 */

/** Client → server. */
export const MemorialMsg = {
  /** `PlaceFlowerPayload` — F2. In the hall (candle reach) or garden area; FLOWERS_* limits. */
  PlaceFlower: "MemPlaceFlower",
  /** `{}` — F4, once per ceremony, only in the `light` phase, only in a hall. */
  CeremonyLight: "MemCeremonyLight",
} as const;
export type MemorialMsg = (typeof MemorialMsg)[keyof typeof MemorialMsg];

/** Server → client. */
export const MemorialServerMsg = {
  /** `FlowerPlacedPayload` → the hall (and garden) of every room. */
  FlowerPlaced: "MemFlowerPlaced",
  /** `FlowerStatePayload` → one client entering the hall / garden. */
  FlowerState: "MemFlowerState",
  /** `MemorialTodayPayload` → everyone, at KST midnight, at boot and on join. */
  MemorialTodayState: "MemTodayState",
  /** `CeremonyStatePayload` → everyone on every phase change and on join. */
  CeremonyState: "MemCeremonyState",
  /** `CeremonyLitPayload` → the halls. */
  CeremonyLit: "MemCeremonyLit",
  /** `ClaimUpdatedPayload` → the hall of every room (stage B: claimed / text / photo approved). */
  ClaimUpdated: "MemClaimUpdated",
} as const;
export type MemorialServerMsg = (typeof MemorialServerMsg)[keyof typeof MemorialServerMsg];

/** HTTPS routes (Express), relative to the server origin. `:slotId` = `M1-A-r3-c11`; `:id` = a claim uuid. */
export const MEMORIAL_API = {
  base: "/api/memorial",
  // stage B (built)
  hall: "/api/memorial/hall",
  me: "/api/memorial/me",
  claims: "/api/memorial/claims",
  claimBySlot: (slotId: string) => `/api/memorial/claims/${encodeURIComponent(slotId)}`,
  claim: (id: string) => `/api/memorial/claims/${encodeURIComponent(id)}`,
  photos: (claimId: string) => `/api/memorial/claims/${encodeURIComponent(claimId)}/photos`,
  invite: "/api/memorial/owners/invite",
  join: "/api/memorial/owners/join",
  recover: "/api/memorial/owners/recover",
  device: (keyId: string) => `/api/memorial/owners/devices/${encodeURIComponent(keyId)}`,
  adminReview: "/api/memorial/admin/review",
  adminPhoto: (photoId: string) => `/api/memorial/admin/photos/${encodeURIComponent(photoId)}`,
  // memorial-2 (W1 / W5 build these; shapes in types.ts)
  album: (slotId: string) => `/api/memorial/claims/${encodeURIComponent(slotId)}/album`,
  photo: (claimId: string, pid: string) => `/api/memorial/claims/${encodeURIComponent(claimId)}/photos/${encodeURIComponent(pid)}`,
  days: (claimId: string) => `/api/memorial/claims/${encodeURIComponent(claimId)}/days`,
  guestbook: (slotId: string) => `/api/memorial/claims/${encodeURIComponent(slotId)}/guestbook`,
  guestbookEntry: (gid: string) => `/api/memorial/guestbook/${encodeURIComponent(gid)}`,
  blocks: (claimId: string) => `/api/memorial/claims/${encodeURIComponent(claimId)}/blocks`,
  reports: "/api/memorial/reports",
  share: (claimId: string) => `/api/memorial/claims/${encodeURIComponent(claimId)}/share`,
  shareView: (code: string) => `/api/memorial/share/${encodeURIComponent(code)}`,
  shareFlower: (code: string) => `/api/memorial/share/${encodeURIComponent(code)}/flower`,
} as const;

/** The family invite link's query key: `https://<client>/?f=<code>` (works on Vercel without a rewrite). */
export const INVITE_QUERY_KEY = "f";
/** The share link opens the village with `/?m=<code>` (F6). */
export const SHARE_QUERY_KEY = "m";

import crypto from "node:crypto";
import { PHOTO_SIZES, SIGNED_URL_TTL_MS, type PhotoSize } from "@caysonverse/shared/memorial/constants";
import type { PhotoUrls } from "@caysonverse/shared/memorial/types";

/**
 * Photo URLs (memorial-2 §4-3):
 *   public (approved, claim public): `/media/p/<id>_<size>.webp` — the id is 128 random bits, and the server still checks the
 *     photo is approved on every request (a later rejection or hiding takes effect at once);
 *   signed (pending, family-only): `/media/s/<id>_<size>.webp?exp=<ms>&sig=<hmac>` — 10 minutes, issued only to a family device.
 */

export const MEDIA_FILE = /^([A-Za-z0-9_-]{22})_(1600|512|128)\.webp$/;

export function parseMediaFile(name: string): { id: string; size: PhotoSize } | null {
  const m = MEDIA_FILE.exec(name);
  return m ? { id: m[1]!, size: Number(m[2]) as PhotoSize } : null;
}

export function sign(secret: Buffer, id: string, size: number, exp: number): string {
  return crypto.createHmac("sha256", secret).update(`${id}:${size}:${exp}`).digest("base64url").slice(0, 32);
}

export function verifySig(secret: Buffer, id: string, size: number, exp: unknown, sig: unknown, now: number): boolean {
  if (typeof exp !== "string" || typeof sig !== "string" || !/^\d{1,16}$/.test(exp)) return false;
  const e = Number(exp);
  if (e <= now) return false;
  const want = Buffer.from(sign(secret, id, size, e));
  const got = Buffer.from(sig);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

export function publicUrls(id: string): PhotoUrls {
  const out = {} as PhotoUrls;
  for (const s of PHOTO_SIZES) out[`s${s}`] = `/media/p/${id}_${s}.webp`;
  return out;
}

export function signedUrls(secret: Buffer, id: string, now: number): PhotoUrls {
  const exp = now + SIGNED_URL_TTL_MS;
  const out = {} as PhotoUrls;
  for (const s of PHOTO_SIZES) out[`s${s}`] = `/media/s/${id}_${s}.webp?exp=${exp}&sig=${sign(secret, id, s, exp)}`;
  return out;
}

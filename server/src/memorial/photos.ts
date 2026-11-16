import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { PHOTO_MAX_PX, PHOTO_MIN_PX, PHOTO_SIZES, PHOTO_UPLOAD_MAX_BYTES, type PhotoSize } from "@caysonverse/shared/memorial/constants";

/**
 * Photo processing (memorial-2 §4-3): check the bytes really are a JPEG / PNG / WebP (magic bytes, not the header the client
 * claims), decode with a pixel cap, apply the EXIF orientation, then re-encode to three WebP sizes WITHOUT any metadata (sharp
 * drops EXIF / XMP / ICC-with-location by default — the GPS position of a phone photo never reaches the disk).
 *
 * The VM has 1 GB of RAM: sharp runs one job at a time with its cache off, and uploads are queued (`processQueued`).
 */

sharp.cache(false);
sharp.concurrency(1);

export type ImageKind = "jpeg" | "png" | "webp";

/** The real type of `buf` from its first bytes, or null. */
export function sniffImage(buf: Buffer): ImageKind | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.length >= 12 && buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP") return "webp";
  return null;
}

export type ProcessFail = "too_large" | "bad_image";

export interface Processed {
  sha256: string;
  /** Oriented size of the source. */
  w: number;
  h: number;
  variants: Map<PhotoSize, Buffer>;
}

const QUALITY: Record<PhotoSize, number> = { 1600: 82, 512: 80, 128: 75 };

export async function processPhoto(buf: Buffer): Promise<Processed | ProcessFail> {
  if (buf.length === 0) return "bad_image";
  if (buf.length > PHOTO_UPLOAD_MAX_BYTES) return "too_large";
  if (!sniffImage(buf)) return "bad_image";
  let meta: sharp.Metadata;
  try {
    meta = await sharp(buf, { limitInputPixels: PHOTO_MAX_PX * PHOTO_MAX_PX, failOn: "error" }).metadata();
  } catch {
    return "bad_image";
  }
  const swap = (meta.orientation ?? 1) >= 5;
  const w = (swap ? meta.height : meta.width) ?? 0;
  const h = (swap ? meta.width : meta.height) ?? 0;
  if (w < PHOTO_MIN_PX || h < PHOTO_MIN_PX || w > PHOTO_MAX_PX || h > PHOTO_MAX_PX) return "bad_image";
  if ((meta.pages ?? 1) > 1) return "bad_image"; // animated WebP / multi-page
  const variants = new Map<PhotoSize, Buffer>();
  try {
    for (const size of PHOTO_SIZES) {
      const out = await sharp(buf, { limitInputPixels: PHOTO_MAX_PX * PHOTO_MAX_PX, failOn: "error" })
        .rotate()
        .resize({ width: size, height: size, fit: "inside", withoutEnlargement: true })
        .webp({ quality: QUALITY[size] })
        .toBuffer();
      variants.set(size, out);
    }
  } catch {
    return "bad_image";
  }
  return { sha256: crypto.createHash("sha256").update(buf).digest("hex"), w, h, variants };
}

let chain: Promise<unknown> = Promise.resolve();
/** One photo at a time across the whole server (memory). */
export function processQueued(buf: Buffer): Promise<Processed | ProcessFail> {
  const job = chain.then(() => processPhoto(buf));
  chain = job.catch(() => undefined);
  return job;
}

/** `<media>/<aa>/<id>_<size>.webp` (two-char fan-out keeps folders small). */
export function photoPath(mediaDir: string, id: string, size: PhotoSize): string {
  return path.join(mediaDir, id.slice(0, 2), `${id}_${size}.webp`);
}

/** Write all sizes (temp file + rename, so a reader never sees half a file). Files are 0640. */
export function writeVariants(mediaDir: string, id: string, variants: Map<PhotoSize, Buffer>): void {
  fs.mkdirSync(path.join(mediaDir, id.slice(0, 2)), { recursive: true, mode: 0o750 });
  for (const [size, data] of variants) {
    const file = photoPath(mediaDir, id, size);
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, data, { mode: 0o640 });
    fs.renameSync(tmp, file);
  }
}

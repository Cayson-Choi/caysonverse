import { PHOTO_SOURCE_MAX_BYTES, PHOTO_UPLOAD_EDGE, PHOTO_UPLOAD_MAX_BYTES } from "@caysonverse/shared/memorial/constants";

/**
 * Shrink a picked photo in the browser before it is sent (memorial-2 §4-3): centre-crop to the frame's 4:5 portrait, long edge
 * at most 1600 px, JPEG 0.85 (0.7 if still over 2 MB). The orientation is applied from EXIF while decoding, and the canvas
 * re-encode carries no metadata at all, so the phone's GPS never leaves the device (the server strips again anyway).
 * iPhone Safari hands HEIC library photos over as JPEG already.
 */

export const PHOTO_ASPECT = 4 / 5;

export type ResizeFail = "too_big" | "not_image";

/** The centre crop of a w × h image to `aspect` (width / height) and the output size with the long edge ≤ `edge`. Pure. */
export function cropPlan(w: number, h: number, aspect = PHOTO_ASPECT, edge = PHOTO_UPLOAD_EDGE) {
  let cw = w;
  let ch = h;
  if (w / h > aspect) cw = Math.round(h * aspect);
  else ch = Math.round(w / aspect);
  const sx = Math.round((w - cw) / 2);
  const sy = Math.round((h - ch) / 2);
  const scale = Math.min(1, edge / Math.max(cw, ch));
  return { sx, sy, sw: cw, sh: ch, dw: Math.max(1, Math.round(cw * scale)), dh: Math.max(1, Math.round(ch * scale)) };
}

async function decode(file: Blob): Promise<{ src: CanvasImageSource; w: number; h: number; close(): void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { src: bmp, w: bmp.width, h: bmp.height, close: () => bmp.close() };
    } catch {
      /* fall through to <img> (older Safari) */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return { src: img, w: img.naturalWidth, h: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

function toJpeg(canvas: HTMLCanvasElement, q: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", q));
}

/** The upload-ready JPEG of `file`, or why not. */
export async function prepareUpload(file: Blob): Promise<Blob | ResizeFail> {
  if (file.size > PHOTO_SOURCE_MAX_BYTES) return "too_big";
  if (file.type && !file.type.startsWith("image/")) return "not_image";
  let img: Awaited<ReturnType<typeof decode>>;
  try {
    img = await decode(file);
  } catch {
    return "not_image";
  }
  try {
    const p = cropPlan(img.w, img.h);
    const canvas = document.createElement("canvas");
    canvas.width = p.dw;
    canvas.height = p.dh;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "not_image";
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img.src, p.sx, p.sy, p.sw, p.sh, 0, 0, p.dw, p.dh);
    for (const q of [0.85, 0.7, 0.55]) {
      const blob = await toJpeg(canvas, q);
      if (blob && blob.size <= PHOTO_UPLOAD_MAX_BYTES) return blob;
    }
    return "too_big";
  } finally {
    img.close();
  }
}

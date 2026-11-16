import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { processPhoto, sniffImage } from "./photos";
import { jpegWithGps } from "./testUtil";

describe("photo processing (test matrix #13)", () => {
  it("strips EXIF incl. GPS and makes 1600 / 512 / 128 WebP", async () => {
    const src = await jpegWithGps(2400, 3000);
    expect((await sharp(src).metadata()).exif).toBeTruthy(); // the source really carries EXIF
    const p = await processPhoto(src);
    if (typeof p === "string") throw new Error(p);
    expect([...p.variants.keys()]).toEqual([1600, 512, 128]);
    for (const [size, buf] of p.variants) {
      const meta = await sharp(buf).metadata();
      expect(meta.format).toBe("webp");
      expect(Math.max(meta.width!, meta.height!)).toBe(size);
      expect(meta.exif).toBeUndefined();
      expect(meta.xmp).toBeUndefined();
      expect(buf.includes(Buffer.from("TestPhone"))).toBe(false);
    }
    expect(p.w).toBe(2400);
    expect(p.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does not enlarge a small photo, and accepts PNG and WebP", async () => {
    const png = await sharp({ create: { width: 300, height: 200, channels: 4, background: "#fff" } }).png().toBuffer();
    const p = await processPhoto(png);
    if (typeof p === "string") throw new Error(p);
    expect((await sharp(p.variants.get(1600)!).metadata()).width).toBe(300);
    const webp = await sharp({ create: { width: 200, height: 200, channels: 3, background: "#000" } }).webp().toBuffer();
    expect(typeof (await processPhoto(webp))).toBe("object");
  });

  it("refuses what is not an image, too small, too big, or mislabelled", async () => {
    expect(await processPhoto(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBe("bad_image");
    expect(await processPhoto(Buffer.from("GIF89a......"))).toBe("bad_image");
    expect(await processPhoto(Buffer.alloc(0))).toBe("bad_image");
    const tiny = await sharp({ create: { width: 40, height: 40, channels: 3, background: "#000" } }).jpeg().toBuffer();
    expect(await processPhoto(tiny)).toBe("bad_image");
    expect(await processPhoto(Buffer.alloc(2 * 1024 * 1024 + 1, 0xff))).toBe("too_large");
    const broken = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(500, 7)]);
    expect(await processPhoto(broken)).toBe("bad_image");
    expect(sniffImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("png");
  });
});

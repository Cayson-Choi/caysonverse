import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import express from "express";
import sharp from "sharp";
import type { MemorialConfig } from "./config";
import { mountMemorialApi } from "./api";
import { Memorial } from "./service";

/** Test helpers (not shipped: only *.test.ts import this). */

export function tempDir(tag: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `cv-${tag}-`));
}

export function testConfig(dir: string, adminKey: string | null = null): MemorialConfig {
  return {
    dataDir: dir,
    dbPath: path.join(dir, "test.db"),
    mediaDir: path.join(dir, "media"),
    adminKeySha256: adminKey ? crypto.createHash("sha256").update(adminKey).digest("hex") : null,
    mediaSecret: crypto.randomBytes(32),
    ipSalt: crypto.randomBytes(16),
    off: false,
  };
}

export function deviceKey(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/** A small JPEG carrying EXIF with a GPS position (what a phone photo looks like). */
export async function jpegWithGps(w = 900, h = 1200, color = "#c8a27a"): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: color } })
    .jpeg({ quality: 85 })
    .withExif({
      IFD0: { Make: "TestPhone", Model: "Cam", Copyright: "family" },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "37/1 33/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "126/1 58/1 0/1" },
    })
    .toBuffer();
}

export interface ApiHarness {
  base: string;
  m: Memorial;
  clock: { t: number };
  close(): Promise<void>;
}

/** An Express app with only the memorial API, on a random port, over a fresh data dir and a controllable clock. */
export async function startApi(opts: { adminKey?: string; dir?: string; t?: number } = {}): Promise<ApiHarness> {
  const dir = opts.dir ?? tempDir("api");
  const clock = { t: opts.t ?? Date.UTC(2026, 10, 16, 3) };
  const m = new Memorial(testConfig(dir, opts.adminKey ?? null), () => clock.t);
  const app = express();
  mountMemorialApi(app, { get: () => m });
  const srv = await new Promise<import("node:http").Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = (srv.address() as AddressInfo).port;
  return {
    base: `http://127.0.0.1:${port}`,
    m,
    clock,
    close: () =>
      new Promise((resolve) => {
        srv.close(() => {
          m.close();
          resolve();
        });
      }),
  };
}

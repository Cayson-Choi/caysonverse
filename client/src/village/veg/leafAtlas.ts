import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RGBAFormat, SRGBColorSpace, UnsignedByteType } from "three";
import { mulberry32 } from "./vegRandom";

/**
 * The alpha-card pictures of the lake forest, the temple pines, the willows and the reeds (owner audit 2026-11-18: "white/grey stick
 * cards", "crowns floating on top"). Two atlases, painted in code (the repo's own work, like vegAtlas.ts / vegPlantAtlas.ts):
 *
 *  - crowns (1024 x 256): four SQUARE cells, each one a spray of leaves (or needles) on a small twig that starts at the middle of
 *    the cell's bottom edge, so a card stood on a branch tip reads as the branch carrying its leaves:
 *    birch (small pointed heart-shaped leaves), oak (lobed), beech (oval, parallel veins), pine (needle clusters);
 *  - tall (1280 x 512): five PORTRAIT cells (256 x 512) standing on the cell's bottom edge: reed (green blades with a tan plume and
 *    a few dry brown ones), grass (a tuft of green-brown blades), tall grass, cattail (stalk, blades and the brown head), and a
 *    willow strand (a thin hanging stem with narrow lance leaves).
 * Alpha is the outline (alpha-tested by the material: the picture keeps a hard edge at a distance, Golus' fix in vegMaterial). The
 * pixels under the transparent part carry the cell's own mean colour (no dark fringe where mip levels blend the edge in).
 * Texture rows: row 0 is the BOTTOM of the picture (a DataTexture), so a cell's v runs up the picture.
 */

export const CROWN_W = 1024;
export const CROWN_H = 256;
export const TALL_W = 1280;
export const TALL_H = 512;
export const CROWN_CELL = { birch: 0, oak: 1, beech: 2, pine: 3 } as const;
export const TALL_CELL = { reed: 0, grass: 1, grassTall: 2, cattail: 3, willow: 4 } as const;
export type CrownCell = keyof typeof CROWN_CELL;
export type TallCell = keyof typeof TALL_CELL;

/** A cell's uv window (u0, v0 = bottom edge, u1, v1 = top edge) with a small inset against bleeding from the next cell. */
export function crownUv(cell: CrownCell): [number, number, number, number] {
  const i = CROWN_CELL[cell];
  const e = 1.5;
  return [(i * 256 + e) / CROWN_W, e / CROWN_H, ((i + 1) * 256 - e) / CROWN_W, 1 - e / CROWN_H];
}
export function tallUv(cell: TallCell): [number, number, number, number] {
  const i = TALL_CELL[cell];
  const e = 1.5;
  return [(i * 256 + e) / TALL_W, e / TALL_H, ((i + 1) * 256 - e) / TALL_W, 1 - e / TALL_H];
}

type Ctx = CanvasRenderingContext2D;
const TAU = Math.PI * 2;

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

/** One leaf (origin at its base, pointing up -y), outline by `shape`, a lighter midrib and darker edge. */
function leaf(g: Ctx, x: number, y: number, ang: number, len: number, wid: number, col: string, shape: "pointed" | "lobed" | "oval", rand: () => number): void {
  g.save();
  g.translate(x, y);
  g.rotate(ang);
  g.beginPath();
  if (shape === "lobed") {
    // five rounded lobes down each side
    const steps = 26;
    for (let side = 0; side < 2; side++) {
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const s = side === 0 ? t : 1 - t;
        const lobe = 0.55 + 0.45 * Math.abs(Math.sin(s * Math.PI * 2.5 + 0.3));
        const w = wid * 0.5 * Math.sin(Math.PI * Math.pow(s, 0.8)) * lobe * (side === 0 ? 1 : -1);
        const px = w;
        const py = -len * s;
        if (side === 0 && i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
    }
  } else {
    const tip = shape === "pointed" ? 0.34 : 0.2;
    g.moveTo(0, 0);
    g.bezierCurveTo(wid * 0.62, -len * 0.18, wid * 0.55, -len * (0.7 - tip * 0.2), 0, -len);
    g.bezierCurveTo(-wid * 0.55, -len * (0.7 - tip * 0.2), -wid * 0.62, -len * 0.18, 0, 0);
  }
  g.closePath();
  const grad = g.createLinearGradient(-wid * 0.5, 0, wid * 0.5, 0);
  grad.addColorStop(0, shade(col, 0.82 + rand() * 0.08));
  grad.addColorStop(0.5, shade(col, 1.08));
  grad.addColorStop(1, shade(col, 0.78 + rand() * 0.08));
  g.fillStyle = grad;
  g.fill();
  g.lineWidth = 1.1;
  g.strokeStyle = shade(col, 0.62);
  g.stroke();
  g.beginPath();
  g.moveTo(0, -len * 0.04);
  g.lineTo(0, -len * 0.92);
  g.strokeStyle = shade(col, 1.3);
  g.globalAlpha = 0.55;
  g.lineWidth = 1.2;
  g.stroke();
  if (shape !== "lobed") {
    // side veins
    g.lineWidth = 0.8;
    g.globalAlpha = 0.28;
    for (let k = 1; k < 5; k++) {
      const yy = -len * (0.15 + k * 0.17);
      g.beginPath();
      g.moveTo(0, yy);
      g.lineTo(wid * 0.38, yy - len * 0.1);
      g.moveTo(0, yy);
      g.lineTo(-wid * 0.38, yy - len * 0.1);
      g.stroke();
    }
  }
  g.restore();
}

/** A twig from the cell's bottom middle with leaves along it and a few side twigs: a leaf spray that "grows" from the card's foot. */
function spray(g: Ctx, x0: number, y0: number, o: { n: number; len: [number, number]; wid: [number, number]; cols: string[]; shape: "pointed" | "lobed" | "oval"; twig: string; spread: number; seed: number }): void {
  const rand = mulberry32(o.seed);
  const stems: Array<{ x: number; y: number; a: number; l: number; w: number }> = [{ x: x0, y: y0, a: 0, l: 215, w: 3.4 }];
  const leaves: Array<[number, number, number]> = [];
  const drawStem = (s: { x: number; y: number; a: number; l: number; w: number }, depth: number) => {
    g.beginPath();
    g.moveTo(s.x, s.y);
    let x = s.x;
    let y = s.y;
    let a = s.a;
    const segs = 8;
    for (let i = 1; i <= segs; i++) {
      a += (rand() - 0.5) * 0.18;
      x += Math.sin(a) * (s.l / segs);
      y -= Math.cos(a) * (s.l / segs);
      g.lineTo(x, y);
      if (i >= 2 && rand() < 0.75) leaves.push([x, y, a + (rand() < 0.5 ? -1 : 1) * (0.7 + rand() * 0.8)]);
      if (depth < 1 && i >= 2 && i < segs && rand() < 0.5) stems.push({ x, y, a: a + (rand() < 0.5 ? -1 : 1) * (0.5 + rand() * 0.45), l: s.l * (0.36 + rand() * 0.22), w: s.w * 0.6 });
    }
    leaves.push([x, y, a + (rand() - 0.5) * 0.3]);
    g.lineWidth = s.w * (depth ? 0.7 : 1);
    g.strokeStyle = o.twig;
    g.lineCap = "round";
    g.stroke();
    return depth;
  };
  // stems first (their side stems are added while drawing), then the leaves over them
  for (let i = 0; i < stems.length; i++) drawStem(stems[i]!, i === 0 ? 0 : 1);
  const order = leaves.map((l, i) => ({ l, i, r: rand() })).sort((p, q) => p.r - q.r);
  for (const { l } of order) {
    const col = o.cols[Math.floor(rand() * o.cols.length)]!;
    const len = o.len[0] + rand() * (o.len[1] - o.len[0]);
    const wid = o.wid[0] + rand() * (o.wid[1] - o.wid[0]);
    leaf(g, l[0], l[1], l[2], len, wid, col, o.shape, rand);
  }
  // extra leaves round the middle of the spray so it reads full, not a bare twig
  for (let i = 0; i < o.n; i++) {
    const t = rand();
    const a = (rand() - 0.5) * o.spread;
    const x = x0 + Math.sin(a) * 180 * t * 0.6 + (rand() - 0.5) * 70;
    const y = y0 - 30 - t * 170;
    const col = o.cols[Math.floor(rand() * o.cols.length)]!;
    leaf(g, x, y, a + (rand() - 0.5) * 2.2, o.len[0] + rand() * (o.len[1] - o.len[0]), o.wid[0] + rand() * (o.wid[1] - o.wid[0]), col, o.shape, rand);
  }
}

function pineNeedles(g: Ctx, x0: number, y0: number): void {
  const rand = mulberry32(77);
  // a short woody shoot, then fans of needle pairs (a red pine's: 10-14 cm, in dense tufts at the shoot tips)
  const tufts: Array<[number, number, number]> = [];
  const stem = (x: number, y: number, a: number, l: number, w: number, depth: number) => {
    g.beginPath();
    g.moveTo(x, y);
    const segs = 6;
    let px = x;
    let py = y;
    let pa = a;
    for (let i = 1; i <= segs; i++) {
      pa += (rand() - 0.5) * 0.25;
      px += Math.sin(pa) * (l / segs);
      py -= Math.cos(pa) * (l / segs);
      g.lineTo(px, py);
      if (depth < 2 && i > 1 && i < segs && rand() < 0.5) stem(px, py, pa + (rand() < 0.5 ? -1 : 1) * (0.7 + rand() * 0.5), l * 0.5, w * 0.7, depth + 1);
    }
    g.lineWidth = w;
    g.strokeStyle = "#6b4a33";
    g.lineCap = "round";
    g.stroke();
    tufts.push([px, py, pa]);
  };
  stem(x0, y0, 0, 120, 5, 0);
  stem(x0, y0 - 20, -0.75, 64, 3.5, 1);
  stem(x0, y0 - 30, 0.8, 66, 3.5, 1);
  const cols = ["#2f5a30", "#3b6a36", "#27502e", "#4a7a3a", "#356339"];
  for (const [x, y, a] of tufts) {
    for (let i = 0; i < 38; i++) {
      const aa = a + (rand() - 0.5) * 2.3;
      const l = 34 + rand() * 30;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + Math.sin(aa) * l * 0.5 + (rand() - 0.5) * 8, y - Math.cos(aa) * l * 0.5, x + Math.sin(aa + (rand() - 0.5) * 0.3) * l, y - Math.cos(aa) * l);
      g.lineWidth = 1.7 + rand() * 0.8;
      g.strokeStyle = cols[Math.floor(rand() * cols.length)]!;
      g.stroke();
    }
  }
}

/** A blade (tapered polygon) from (x, y) up to its tip, curving by `bend`. */
function blade(g: Ctx, x: number, y: number, h: number, w: number, bend: number, col: string, tipCol: string | null = null): void {
  const tx = x + bend;
  const ty = y - h;
  const midx = x + bend * 0.25;
  const midy = y - h * 0.55;
  g.beginPath();
  g.moveTo(x - w * 0.5, y);
  g.quadraticCurveTo(midx - w * 0.42, midy, tx, ty);
  g.quadraticCurveTo(midx + w * 0.42, midy, x + w * 0.5, y);
  g.closePath();
  if (tipCol) {
    const gr = g.createLinearGradient(0, y, 0, ty);
    gr.addColorStop(0, col);
    gr.addColorStop(0.7, col);
    gr.addColorStop(1, tipCol);
    g.fillStyle = gr;
  } else g.fillStyle = col;
  g.fill();
  g.lineWidth = 0.8;
  g.strokeStyle = shade(col.startsWith("#") ? col : "#506a30", 0.7);
  g.stroke();
}

function blades(g: Ctx, cx: number, base: number, n: number, hMin: number, hMax: number, wMin: number, wMax: number, spread: number, cols: string[], tips: Array<string | null>, rand: () => number): void {
  const items = Array.from({ length: n }, () => ({ x: cx + (rand() - 0.5) * spread, h: hMin + rand() * (hMax - hMin), w: wMin + rand() * (wMax - wMin), c: Math.floor(rand() * cols.length), r: rand() }));
  items.sort((a, b) => a.h - b.h);
  for (const it of items) {
    const lean = ((it.x - cx) / Math.max(spread, 1)) * it.h * 0.24 + (rand() - 0.5) * it.h * 0.1;
    blade(g, it.x, base, it.h, it.w, lean, cols[it.c]!, tips[it.c] ?? null);
  }
}

function paintCrown(g: Ctx): void {
  g.clearRect(0, 0, CROWN_W, CROWN_H);
  const cell = (i: number, fn: () => void) => {
    g.save();
    g.beginPath();
    g.rect(i * 256, 0, 256, 256);
    g.clip();
    fn();
    g.restore();
  };
  cell(CROWN_CELL.birch, () =>
    spray(g, 128, 252, { n: 26, len: [34, 50], wid: [24, 36], cols: ["#9bbf4a", "#86ad3f", "#a8c85a", "#7aa23a", "#b5cf68"], shape: "pointed", twig: "#7a6a52", spread: 1.9, seed: 11 }),
  );
  cell(CROWN_CELL.oak, () =>
    spray(g, 128 + 256, 252, { n: 17, len: [46, 62], wid: [28, 40], cols: ["#4a7a2c", "#3d6a26", "#5a8a34", "#35601f", "#678f3a"], shape: "lobed", twig: "#5a4636", spread: 1.8, seed: 23 }),
  );
  cell(CROWN_CELL.beech, () =>
    spray(g, 128 + 512, 252, { n: 24, len: [38, 52], wid: [22, 30], cols: ["#6a9a36", "#5b8a2e", "#779f3e", "#52802a", "#86ac48"], shape: "oval", twig: "#6b5a48", spread: 1.8, seed: 37 }),
  );
  cell(CROWN_CELL.pine, () => pineNeedles(g, 128 + 768, 252));
}

function paintTall(g: Ctx): void {
  g.clearRect(0, 0, TALL_W, TALL_H);
  const cell = (i: number, fn: (cx: number) => void) => {
    g.save();
    g.beginPath();
    g.rect(i * 256, 0, 256, 512);
    g.clip();
    fn(i * 256 + 128);
    g.restore();
  };
  const rand = mulberry32(901);
  const greens = ["#6f8a3a", "#7f9a45", "#5e7a31", "#8a9f4c", "#a09a52", "#677e35"];
  cell(TALL_CELL.reed, (cx) => {
    // reeds: tall straight green blades (some drying to tan), the odd plume
    blades(g, cx, 510, 26, 330, 495, 11, 17, 120, ["#6f8a3a", "#7f9a45", "#5e7a31", "#a09a52", "#8a8a46", "#b2a560"], [null, null, "#8aa04c", "#c2b26a", null, "#cdbf84"], rand);
    for (let i = 0; i < 3; i++) {
      const x = cx + (rand() - 0.5) * 70;
      const h = 380 + rand() * 90;
      g.beginPath();
      g.moveTo(x, 510);
      g.lineTo(x + (rand() - 0.5) * 20, 510 - h);
      g.lineWidth = 3;
      g.strokeStyle = "#8a7a46";
      g.stroke();
      const px = x + (rand() - 0.5) * 20;
      for (let k = 0; k < 30; k++) {
        g.beginPath();
        g.moveTo(px, 510 - h + 4);
        g.quadraticCurveTo(px + (rand() - 0.5) * 30, 510 - h - 30, px + (rand() - 0.5) * 34, 510 - h - 50 - rand() * 35);
        g.lineWidth = 1.5;
        g.strokeStyle = rand() < 0.5 ? "#c9b98a" : "#a98f62";
        g.stroke();
      }
    }
  });
  cell(TALL_CELL.grass, (cx) => blades(g, cx, 510, 30, 120, 290, 10, 16, 190, greens, [null, null, null, "#b8aa5c", null, null], rand));
  cell(TALL_CELL.grassTall, (cx) => blades(g, cx, 510, 24, 250, 450, 9, 14, 150, greens, [null, null, "#9aa850", "#c0b060", null, null], rand));
  cell(TALL_CELL.cattail, (cx) => {
    blades(g, cx, 510, 16, 300, 440, 14, 19, 110, ["#6a8a38", "#789a42", "#5a7a30"], [null, null, null], rand);
    for (let i = 0; i < 2; i++) {
      const x = cx + (i - 0.5) * 34 + (rand() - 0.5) * 12;
      const top = 150 + rand() * 80;
      g.beginPath();
      g.moveTo(x, 510);
      g.lineTo(x + (i - 0.5) * 8, top);
      g.lineWidth = 4.5;
      g.strokeStyle = "#7a8a45";
      g.stroke();
      const hx = x + (i - 0.5) * 8;
      g.beginPath();
      g.ellipse(hx, top - 18, 6.5, 27, 0, 0, TAU);
      const gr = g.createLinearGradient(hx - 7, 0, hx + 7, 0);
      gr.addColorStop(0, "#3d2615");
      gr.addColorStop(0.5, "#6a4326");
      gr.addColorStop(1, "#3a2414");
      g.fillStyle = gr;
      g.fill();
      g.beginPath();
      g.moveTo(hx, top - 44);
      g.lineTo(hx, top - 74);
      g.lineWidth = 2.2;
      g.strokeStyle = "#8a7a50";
      g.stroke();
    }
  });
  cell(TALL_CELL.willow, (cx) => {
    // a hanging strand: the stem runs down the middle (the card's TOP is the branch end), narrow lance leaves on both sides
    const top = 4;
    g.beginPath();
    g.moveTo(cx, top);
    let x = cx;
    for (let y = top; y < 508; y += 16) {
      x = cx + Math.sin(y * 0.021) * 9;
      g.lineTo(x, y);
    }
    g.lineWidth = 2.6;
    g.strokeStyle = "#8a7a46";
    g.stroke();
    const cols = ["#9aae52", "#86a244", "#a8ba5e", "#7a9a3e", "#b4c26c"];
    for (let y = 22; y < 506; y += 6.5) {
      for (const side of [-1, 1]) {
        const sx = cx + Math.sin(y * 0.021) * 9;
        const len = 52 + rand() * 44 - (y / 512) * 12;
        const ang = side * (0.3 + rand() * 0.5) + (rand() - 0.5) * 0.2;
        g.save();
        g.translate(sx, y);
        g.rotate(Math.PI + ang * 0.6 + (side > 0 ? 0.35 : -0.35));
        g.beginPath();
        g.moveTo(0, 0);
        g.quadraticCurveTo(4.8, -len * 0.4, 0, -len);
        g.quadraticCurveTo(-4.8, -len * 0.4, 0, 0);
        g.fillStyle = cols[Math.floor(rand() * cols.length)]!;
        g.fill();
        g.lineWidth = 0.7;
        g.strokeStyle = "rgba(60,80,30,0.7)";
        g.stroke();
        g.restore();
      }
    }
  });
}

/** Paint one atlas on a canvas and make its texture: dilated transparent pixels, premultiplied-free, mipmapped, sRGB. */
function toTexture(w: number, h: number, paint: (g: Ctx) => void, name: string): DataTexture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d", { willReadFrequently: true });
  if (!g) return null;
  paint(g);
  const src = g.getImageData(0, 0, w, h).data;
  // the mean colour of the opaque pixels, per 256-wide cell, for the pixels that are transparent
  const cells = Math.round(w / 256);
  const mean = Array.from({ length: cells }, () => [0, 0, 0, 0]);
  for (let y = 0; y < h; y += 2)
    for (let x = 0; x < w; x += 2) {
      const i = (y * w + x) * 4;
      if (src[i + 3]! > 200) {
        const m = mean[Math.floor(x / 256)]!;
        m[0]! += src[i]!;
        m[1]! += src[i + 1]!;
        m[2]! += src[i + 2]!;
        m[3]! += 1;
      }
    }
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const dstRow = h - 1 - y; // row 0 of the texture = the picture's bottom
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const o = (dstRow * w + x) * 4;
      const a = src[i + 3]!;
      const m = mean[Math.floor(x / 256)]!;
      if (a < 250 && m[3]! > 0) {
        // partly covered pixels: the canvas stored them premultiplied, so un-premultiply (a = 0 takes the cell's mean)
        const k = a > 0 ? 255 / a : 0;
        const r = a > 0 ? Math.min(255, src[i]! * k) : m[0]! / m[3]!;
        const gg = a > 0 ? Math.min(255, src[i + 1]! * k) : m[1]! / m[3]!;
        const b = a > 0 ? Math.min(255, src[i + 2]! * k) : m[2]! / m[3]!;
        out[o] = r;
        out[o + 1] = gg;
        out[o + 2] = b;
      } else {
        out[o] = src[i]!;
        out[o + 1] = src[i + 1]!;
        out[o + 2] = src[i + 2]!;
      }
      out[o + 3] = a;
    }
  }
  const t = new DataTexture(out, w, h, RGBAFormat, UnsignedByteType);
  t.colorSpace = SRGBColorSpace;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.name = name;
  t.needsUpdate = true;
  return t;
}

export function makeCrownAtlas(): DataTexture | null {
  return toTexture(CROWN_W, CROWN_H, paintCrown, "T_lake_crowns");
}
export function makeTallAtlas(): DataTexture | null {
  return toTexture(TALL_W, TALL_H, paintTall, "T_lake_tall");
}

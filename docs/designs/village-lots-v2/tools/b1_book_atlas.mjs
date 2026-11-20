/**
 * 열람실 책·깔개 아틀라스 (owner 2026-11-20: "도서관안에 책들이 너무 허접해 … 실제와 같이 … 고해상도로 선명하게") — procedural, no
 * photos, no cover art, no real titles: every spine is drawn here from noise and rules (leather grain, book-cloth weave, vellum,
 * paper jackets; raised bands, gilt rules and fleurons, lettering-piece labels with gilt glyph-like marks that spell nothing,
 * paper labels, worn heads and tails, hinge creases), plus the page edges, the side boards and an open spread; and two
 * Persian-style rugs (medallion, borders, field motifs, wool pile, fringe ends).
 *
 *   node docs/designs/village-lots-v2/tools/b1_book_atlas.mjs [--png <dir for the PNG twins (Blender renders)>]
 *
 * Writes client/public/models/village/lots/library/lot_library_reading_books{,_normal,_orm}.ktx2 (albedo 2048 UASTC sRGB; normal and
 * ORM 1024 UASTC linear: G roughness, B metal — the gilt), lot_library_reading_rugs.ktx2 (2048 UASTC sRGB) and the cell table
 * docs/designs/village-lots-v2/tools/library_book_atlas.json that library_books.py maps the books with.
 * Layout (pixels, top-left origin, 2048 x 2048): 96 spine cells 64 x 512 in three rows (y 0, 512, 1024); below them (y 1536) the
 * page edges (4 cells 256 x 256: plain, gilt, aged, sprinkled), the side boards (cloth 512 x 256 at x 512, leather 512 x 256 at
 * x 512 y 1792: neutral, tinted by the book's vertex colour), the open spread 1024 x 512 at x 1024.
 * Rugs atlas: the hearth rug 2048 x 1072 (4.4 x 2.3 m) at the top, the runner 2048 x 488 (4.2 x 1.0 m, lengthwise) at y 1100,
 * the bay mat 2048 x 448 at y 1600 (not used yet: room for a later mat).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

const { values: a } = parseArgs({ options: { png: { type: "string" }, only: { type: "string" } } });
const REPO = resolve(import.meta.dirname, "..", "..", "..", "..");
const OUT = join(REPO, "client", "public", "models", "village", "lots", "library");
const TOOLS = join(REPO, "art", "materials", "tools", "node_modules");
const tool = async (name) => {
  const dir = join(TOOLS, name);
  if (!existsSync(dir)) throw new Error(`missing ${name}: npm --prefix art/materials/tools ci`);
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const exp = pkg.exports?.["."] ?? pkg.exports;
  let entry = typeof exp === "string" ? exp : exp?.node?.import ?? exp?.import?.default ?? exp?.import ?? exp?.default?.import ?? exp?.default;
  if (typeof entry !== "string") entry = pkg.module ?? pkg.main ?? "index.js";
  return import(pathToFileURL(join(dir, entry)).href);
};
const sharp = (await tool("sharp")).default;
const { encodeToKTX2 } = await tool("ktx2-encoder");

// ------------------------------------------------------------------------------------------------ noise --
function mulberry(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(x, y, s) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a00 = hash(xi, yi, s), a10 = hash(xi + 1, yi, s), a01 = hash(xi, yi + 1, s), a11 = hash(xi + 1, yi + 1, s);
  return a00 + (a10 - a00) * ux + (a01 - a00) * uy + (a00 - a10 - a01 + a11) * ux * uy;
}
function fbm(x, y, s, oct = 4) {
  let v = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) {
    v += amp * vnoise(x * f, y * f, s + i * 17);
    amp *= 0.5;
    f *= 2.03;
  }
  return v / (1 - Math.pow(0.5, oct));
}
const clamp = (v, lo = 0, hi = 255) => (v < lo ? lo : v > hi ? hi : v);
const hex = (h) => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
const mix = (c, d, t) => [c[0] + (d[0] - c[0]) * t, c[1] + (d[1] - c[1]) * t, c[2] + (d[2] - c[2]) * t];
const scale = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

// ------------------------------------------------------------------------------------------------ canvas --
class Canvas {
  constructor(w, h, bg = [0, 0, 0]) {
    this.w = w;
    this.h = h;
    this.c = new Float32Array(w * h * 3);
    this.hgt = new Float32Array(w * h);
    this.rough = new Float32Array(w * h).fill(0.8);
    this.metal = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) this.c.set(bg, i * 3);
  }
  set(x, y, col, h, r, m) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = y * this.w + x;
    this.c[i * 3] = col[0];
    this.c[i * 3 + 1] = col[1];
    this.c[i * 3 + 2] = col[2];
    if (h !== undefined) this.hgt[i] = h;
    if (r !== undefined) this.rough[i] = r;
    if (m !== undefined) this.metal[i] = m;
  }
  get(x, y) {
    const i = y * this.w + x;
    return [this.c[i * 3], this.c[i * 3 + 1], this.c[i * 3 + 2]];
  }
  rgba() {
    const o = new Uint8Array(this.w * this.h * 4);
    for (let i = 0; i < this.w * this.h; i++) {
      o[i * 4] = clamp(Math.round(this.c[i * 3]));
      o[i * 4 + 1] = clamp(Math.round(this.c[i * 3 + 1]));
      o[i * 4 + 2] = clamp(Math.round(this.c[i * 3 + 2]));
      o[i * 4 + 3] = 255;
    }
    return o;
  }
  /** Tangent-space normal map from the height field (`k`: strength; y up in the image = +v), downsampled by `down`. */
  normal(k, down = 2) {
    const W = this.w / down, H = this.h / down;
    const o = new Uint8Array(W * H * 4);
    const hh = (x, y) => this.hgt[Math.min(this.h - 1, Math.max(0, y)) * this.w + Math.min(this.w - 1, Math.max(0, x))];
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let dx = 0, dy = 0;
        for (let j = 0; j < down; j++)
          for (let i = 0; i < down; i++) {
            const X = x * down + i, Y = y * down + j;
            dx += hh(X + 1, Y) - hh(X - 1, Y);
            dy += hh(X, Y + 1) - hh(X, Y - 1);
          }
        dx /= down * down;
        dy /= down * down;
        // image y runs down; the texture's v (and the tangent frame's bitangent) runs up
        let nx = -dx * k, ny = dy * k, nz = 1;
        const L = Math.hypot(nx, ny, nz);
        nx /= L; ny /= L; nz /= L;
        const p = (y * W + x) * 4;
        o[p] = Math.round((nx * 0.5 + 0.5) * 255);
        o[p + 1] = Math.round((ny * 0.5 + 0.5) * 255);
        o[p + 2] = Math.round((nz * 0.5 + 0.5) * 255);
        o[p + 3] = 255;
      }
    return { data: o, w: W, h: H };
  }
  orm(down = 2) {
    const W = this.w / down, H = this.h / down;
    const o = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let r = 0, m = 0;
        for (let j = 0; j < down; j++)
          for (let i = 0; i < down; i++) {
            const q = (y * down + j) * this.w + x * down + i;
            r += this.rough[q];
            m += this.metal[q];
          }
        const p = (y * W + x) * 4;
        o[p] = 255;
        o[p + 1] = Math.round(clamp((r / (down * down)) * 255));
        o[p + 2] = Math.round(clamp((m / (down * down)) * 255));
        o[p + 3] = 255;
      }
    return { data: o, w: W, h: H };
  }
}

// ------------------------------------------------------------------------------------------------ book materials --
const LEATHER = ["6E1E1E", "5A2A1A", "7A3A22", "4A2A1C", "8B5A2B", "A0652F", "3E2418", "234A33", "1F3A2A", "1F2F4F", "2A2420", "5C1A2B", "7B4A2A", "9A6A3A"];
const CLOTH = ["7A2E2E", "8E2F25", "2F5D3A", "2E3F5C", "1E4D52", "B8892E", "5B5F2E", "6B6B66", "A0522D", "B8A27A", "5C1A2B", "3D3D52", "2B4A6E", "7D5A44", "C24A3A", "8C7A4E", "4E6B5A", "9C8A6A", "BFAE8A", "35505E"];
const VELLUM = ["DCCDA8", "D2C09A", "E2D3B2", "CDBA90"];
const JACKET = ["A84436", "2E4F72", "C49A52", "3E7B5A", "D9CCB0", "1F2F4F", "8E3B5A", "B8783A", "5A7FA0", "D8CDB4", "9E3A2E", "4A4A4A", "6E8B3D", "B8963E"];
const GILT = hex("E2BC62");
const INK = hex("2A2018");

function material(kind, base, u, v, seed) {
  // the surface: colour factor, height, roughness
  if (kind === "leather") {
    const n = fbm(u * 0.55, v * 0.55, seed, 3);
    const cells = vnoise(u * 1.4, v * 1.4, seed + 5);
    const pit = cells < 0.18 ? -0.25 : 0;
    const blot = fbm(u * 0.03, v * 0.03, seed + 9, 3);
    const k = 0.78 + 0.32 * n + pit * 0.6 + (blot - 0.5) * 0.25;
    return { col: scale(base, k), h: n * 0.6 + pit, r: 0.5 + 0.15 * n };
  }
  if (kind === "cloth") {
    const weave = ((u + (v >> 1)) & 1) * 0.5 + ((v + (u >> 1)) & 1) * 0.5;
    const thread = vnoise(u * 0.5, v * 4.0, seed) * 0.5 + vnoise(u * 4.0, v * 0.5, seed + 3) * 0.5;
    const blot = fbm(u * 0.04, v * 0.02, seed + 7, 3);
    const k = 0.84 + 0.1 * weave + 0.12 * (thread - 0.5) + (blot - 0.5) * 0.2;
    return { col: scale(base, k), h: weave * 0.3 + thread * 0.3, r: 0.88 };
  }
  if (kind === "vellum") {
    const blot = fbm(u * 0.06, v * 0.03, seed, 4);
    const fine = vnoise(u * 0.9, v * 0.9, seed + 2);
    const k = 0.9 + (blot - 0.5) * 0.22 + (fine - 0.5) * 0.05;
    return { col: mix(scale(base, k), hex("C8A870"), Math.max(0, blot - 0.6) * 0.6), h: blot * 0.2, r: 0.62 };
  }
  // a paper jacket: smooth, faint mottling
  const fine = vnoise(u * 0.7, v * 0.7, seed);
  return { col: scale(base, 0.95 + (fine - 0.5) * 0.06), h: 0, r: 0.55 };
}

// glyph-like marks that spell nothing: each "letter" 2-4 strokes on a 3 x 5 grid
function glyph(rg) {
  const strokes = [];
  const n = 2 + Math.floor(rg() * 3);
  const pts = [[0, 0], [1, 0], [2, 0], [0, 2], [1, 2], [2, 2], [0, 4], [1, 4], [2, 4]];
  for (let i = 0; i < n; i++) {
    const p = pts[Math.floor(rg() * pts.length)];
    let q = pts[Math.floor(rg() * pts.length)];
    if (q === p) q = pts[(pts.indexOf(p) + 4) % pts.length];
    strokes.push([p, q]);
  }
  if (rg() < 0.7) strokes.push([[0, 0], [0, 4]].map((pp) => [pp[0] + (rg() < 0.5 ? 0 : 2), pp[1]]));
  return strokes;
}

class Spine {
  constructor(cv, x0, y0, w, h, spec) {
    Object.assign(this, { cv, x0, y0, w, h, spec });
    this.rg = mulberry(spec.seed);
  }
  base() {
    const { cv, x0, y0, w, h, spec } = this;
    for (let v = 0; v < h; v++)
      for (let u = 0; u < w; u++) {
        const m = material(spec.kind, spec.base, u + x0, v + y0, spec.seed);
        let col = m.col;
        let hh = m.h;
        // worn head and tail: the cloth frays light, the leather rubs to a paler brown
        const edge = Math.min(v, h - 1 - v);
        if (edge < 10) {
          const t = (10 - edge) / 10;
          const wear = fbm((u + x0) * 0.3, (v + y0) * 0.3, spec.seed + 11, 2);
          const amt = t * (0.25 + 0.5 * wear) * spec.wear;
          col = spec.kind === "leather" ? mix(col, hex("B08A62"), amt * 0.8) : mix(col, mix(col, [235, 225, 200], 0.5), amt);
        }
        // scuffs and fading
        const sc = fbm((u + x0) * 0.08, (v + y0) * 0.05, spec.seed + 23, 3);
        if (sc > 0.72) col = mix(col, spec.kind === "leather" ? hex("A07A50") : mix(col, [220, 210, 190], 0.6), (sc - 0.72) * 1.2 * spec.wear);
        // hinge creases where the spine meets the boards (the joints)
        const j = Math.min(u, w - 1 - u);
        if (j < 3) {
          col = scale(col, 0.62 + j * 0.12);
          hh -= (3 - j) * 0.35;
        }
        cv.set(x0 + u, y0 + v, col, hh, m.r, 0);
      }
  }
  rect(u0, v0, u1, v1, col, opt = {}) {
    // v from the BOTTOM of the cell (0 = tail, h = head), u from the left
    const { cv, x0, y0, h } = this;
    for (let v = Math.max(0, Math.floor(v0)); v < Math.min(h, Math.ceil(v1)); v++)
      for (let u = Math.max(0, Math.floor(u0)); u < Math.min(this.w, Math.ceil(u1)); u++) {
        const X = x0 + u, Y = y0 + (h - 1 - v);
        const prev = cv.get(X, Y);
        let c = typeof col === "function" ? col(u, v, prev) : col;
        if (opt.blend !== undefined) c = mix(prev, c, opt.blend);
        const i = Y * cv.w + X;
        cv.set(X, Y, c, opt.h !== undefined ? cv.hgt[i] + opt.h : undefined, opt.r, opt.m);
      }
  }
  gilt(u0, v0, u1, v1, deboss = -0.5) {
    const s = this.spec.seed;
    this.rect(u0, v0, u1, v1, (u, v) => {
      const n = vnoise((u + this.x0) * 0.7, (v + this.y0) * 0.7, s + 31);
      const rub = fbm((u + this.x0) * 0.2, (v + this.y0) * 0.2, s + 37, 2);
      const g = scale(GILT, 0.82 + 0.3 * n);
      return rub > 0.78 ? mix(g, this.cv.get(this.x0 + u, this.y0 + this.h - 1 - v), 0.6) : g;
    }, { h: deboss, r: 0.28, m: 1 });
  }
  ink(u0, v0, u1, v1, col = INK) {
    this.rect(u0, v0, u1, v1, col, { r: 0.6 });
  }
  /** glyph-like letters across the spine (horizontal), centred in u, baseline v */
  textH(v, size, count, draw) {
    const rg = this.rg;
    const gw = size * 0.6, gap = size * 0.25;
    const total = count * gw + (count - 1) * gap;
    let u = (this.w - total) / 2;
    const t = Math.max(1, Math.round(size / 6));
    for (let k = 0; k < count; k++) {
      for (const [p, q] of glyph(rg)) this.stroke(u + (p[0] / 2) * gw, v + (p[1] / 4) * size, u + (q[0] / 2) * gw, v + (q[1] / 4) * size, t, draw);
      u += gw + gap;
    }
  }
  /** glyph-like letters running up the spine (vertical title, read with the head tilted) */
  textV(v0, size, count, draw, uc) {
    const rg = this.rg;
    const gw = size * 0.6, gap = size * 0.25;
    let v = v0;
    const t = Math.max(1, Math.round(size / 6));
    const cu = uc ?? this.w / 2;
    for (let k = 0; k < count; k++) {
      if (rg() < 0.12) {
        v += gw * 1.2;
        continue; // a word space
      }
      for (const [p, q] of glyph(rg)) this.stroke(cu - size / 2 + (p[1] / 4) * size, v + (p[0] / 2) * gw, cu - size / 2 + (q[1] / 4) * size, v + (q[0] / 2) * gw, t, draw);
      v += gw + gap;
    }
    return v;
  }
  stroke(ua, va, ub, vb, t, draw) {
    const n = Math.max(1, Math.ceil(Math.hypot(ub - ua, vb - va)));
    for (let i = 0; i <= n; i++) {
      const u = ua + ((ub - ua) * i) / n, v = va + ((vb - va) * i) / n;
      draw(u - t / 2, v - t / 2, u + t / 2, v + t / 2);
    }
  }
  fleuron(uc, vc, r) {
    // a small tooled ornament: a lozenge with four dots
    for (let dv = -r; dv <= r; dv++) {
      const half = r - Math.abs(dv);
      this.gilt(uc - half * 0.6, vc + dv, uc + half * 0.6 + 1, vc + dv + 1);
    }
    for (const [du, dv] of [[-r, 0], [r, 0], [0, -r - 2], [0, r + 2]]) this.gilt(uc + du - 1, vc + dv - 1, uc + du + 1, vc + dv + 1);
  }
  band(vc, bh) {
    // a raised band (a cord under the leather): highlight on top, shadow under, gilt rules either side
    const base = this.spec.base;
    this.rect(3, vc - bh / 2, this.w - 3, vc + bh / 2, (u, v, prev) => {
      const t = (v - (vc - bh / 2)) / bh; // 0 bottom .. 1 top
      const shade = 0.65 + 0.55 * Math.sin(Math.PI * t) + (t > 0.55 ? 0.15 : -0.1);
      return scale(mix(prev, base, 0.3), shade);
    }, { h: 1.6 });
    this.gilt(4, vc + bh / 2 + 2, this.w - 4, vc + bh / 2 + 4);
    this.gilt(4, vc - bh / 2 - 4, this.w - 4, vc - bh / 2 - 2);
  }
  label(v0, v1, col, lines) {
    const draw = (a, b, c, d) => this.gilt(a, b, c, d, -0.3);
    this.rect(5, v0, this.w - 5, v1, (u, v) => scale(col, 0.85 + 0.25 * vnoise((u + this.x0) * 0.6, (v + this.y0) * 0.6, this.spec.seed + 41)), { h: 0.5, r: 0.45, m: 0 });
    this.gilt(6, v0 + 1, this.w - 6, v0 + 2);
    this.gilt(6, v1 - 2, this.w - 6, v1 - 1);
    const lh = (v1 - v0 - 8) / lines;
    for (let i = 0; i < lines; i++) this.textH(v1 - 6 - (i + 1) * lh + lh * 0.15, Math.min(lh * 0.75, 14), 3 + Math.floor(this.rg() * 3), draw);
  }
}

function drawSpine(cv, x0, y0, spec) {
  const s = new Spine(cv, x0, y0, 64, 512, spec);
  const rg = s.rg;
  s.base();
  const giltDraw = (a, b, c, d) => s.gilt(a, b, c, d);
  const inkDraw = (a, b, c, d) => s.ink(a, b, c, d);
  if (spec.style === "bands") {
    // five raised bands, panels with fleurons, a red / black lettering piece in the second panel, sometimes a second label
    const vs = [70, 150, 230, 310, 390, 455];
    for (const v of vs.slice(0, 5)) s.band(v, 12);
    const lab = ["8E2A20", "1E1A18", "2F4A30", "B8892E"].map(hex)[Math.floor(rg() * 4)];
    s.label(318, 384, lab, 2);
    if (rg() < 0.5) s.label(240, 302, hex(rg() < 0.5 ? "1E1A18" : "6E1E1E"), 1);
    for (const [a, b] of [[76, 144], [156, 224], ...(rg() < 0.5 ? [] : [[236, 304]])]) s.fleuron(32, (a + b) / 2, 6);
    s.gilt(4, 470, 60, 472);
    s.gilt(4, 34, 60, 36);
    if (rg() < 0.6) s.textH(40, 10, 2, giltDraw); // a volume number at the tail
  } else if (spec.style === "classic") {
    // book cloth: double gilt rules at head and tail, a gilt title across (two lines) or up the spine, an ornament, the imprint
    for (const v of [478, 486, 26, 34]) s.gilt(4, v, 60, v + 2);
    if (rg() < 0.5) {
      s.textH(400, 13, 4, giltDraw);
      s.textH(378, 13, 3 + Math.floor(rg() * 3), giltDraw);
      s.gilt(14, 360, 50, 362);
      s.textH(330, 9, 4, giltDraw);
      s.fleuron(32, 230, 7);
    } else {
      s.textV(120, 17, 16 + Math.floor(rg() * 6), giltDraw);
    }
    s.textH(52, 8, 4, giltDraw);
  } else if (spec.style === "paperlabel") {
    // cloth with a printed paper label near the head
    for (const v of [470, 30]) s.gilt(6, v, 58, v + 1);
    s.rect(7, 360, 57, 440, (u, v) => scale(hex("EFE4C8"), 0.9 + 0.15 * fbm((u + x0) * 0.2, (v + y0) * 0.2, spec.seed + 51, 2)), { h: 0.3, r: 0.75, m: 0 });
    s.rect(9, 362, 55, 363, scale(INK, 1.4), {});
    s.rect(9, 437, 55, 438, scale(INK, 1.4), {});
    s.textH(408, 11, 4, inkDraw);
    s.textH(386, 11, 3, inkDraw);
    s.textH(368, 7, 5, inkDraw);
    if (rg() < 0.5) {
      s.rect(16, 60, 48, 92, (u, v) => scale(hex("EFE4C8"), 0.92), { r: 0.75 });
      s.textH(70, 12, 2, inkDraw);
    }
  } else if (spec.style === "vellum") {
    // limp vellum: a title in brown ink up the spine, a shelf mark at the foot, ties' stubs
    const brown = hex("4A3424");
    s.textV(150, 15, 14 + Math.floor(rg() * 6), (a, b, c, d) => s.ink(a, b, c, d, brown));
    s.textH(60, 10, 3, (a, b, c, d) => s.ink(a, b, c, d, brown));
  } else {
    // a modern jacket: colour blocks, a title up the spine, the author, a publisher's mark at the foot
    const acc = hex(JACKET[Math.floor(rg() * JACKET.length)]);
    const light = (spec.base[0] + spec.base[1] + spec.base[2]) / 3 > 150;
    const tcol = light ? INK : hex("F4EEE0");
    if (rg() < 0.6) s.rect(0, 440, 64, 512, acc, { r: 0.5 });
    if (rg() < 0.5) s.rect(0, 0, 64, 70, acc, { r: 0.5 });
    const draw = (a, b, c, d) => s.rect(a, b, c, d, tcol, { r: 0.5 });
    const end = s.textV(110, 17, 12 + Math.floor(rg() * 5), draw);
    s.textV(Math.min(420, end + 30), 11, 6, draw);
    s.rect(22, 20, 42, 40, tcol, { r: 0.5 });
  }
}

// ------------------------------------------------------------------------------------------------ the books atlas --
const SZ = 2048;
const books = new Canvas(SZ, SZ, [40, 30, 22]);
const cells = [];
const rgAll = mulberry(20261120);
for (let i = 0; i < 96; i++) {
  const col = i % 32, row = Math.floor(i / 32);
  let kind, base, style;
  if (i < 34) {
    kind = "leather";
    base = hex(LEATHER[i % LEATHER.length]);
    style = i % 5 === 4 ? "classic" : "bands";
  } else if (i < 72) {
    kind = "cloth";
    base = hex(CLOTH[(i - 34) % CLOTH.length]);
    style = (i - 34) % 3 === 2 ? "paperlabel" : "classic";
  } else if (i < 80) {
    kind = "vellum";
    base = hex(VELLUM[(i - 72) % VELLUM.length]);
    style = "vellum";
  } else {
    kind = "jacket";
    base = hex(JACKET[(i - 80) % JACKET.length]);
    style = "jacket";
  }
  // each cell's own shade of its colour
  base = scale(base, 0.88 + rgAll() * 0.24);
  const spec = { kind, base, style, seed: 1000 + i * 77, wear: kind === "jacket" ? 0.4 : 0.7 + rgAll() * 0.5 };
  drawSpine(books, col * 64, row * 512, spec);
  cells.push({ i, x: col * 64, y: row * 512, w: 64, h: 512, kind, style, base: base.map((v) => Math.round(clamp(v))) });
}

// page edges: fine leaves along the depth (stripes vary across u), a headband at the spine end (v top)
function pageEdge(x0, y0, w, h, tone, seed, opts = {}) {
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const leaf = vnoise(x * 1.7, y * 0.02, seed) * 0.6 + vnoise(x * 3.1, y * 0.05, seed + 1) * 0.4;
      let c = scale(tone, 0.86 + 0.16 * leaf);
      // the fore-edge end darker (handling), the spine end with the headband
      const t = y / h;
      c = scale(c, 1 - 0.12 * Math.max(0, t - 0.85) / 0.15);
      let hh = leaf * 0.8, r = 0.85, m = 0;
      if (opts.gilt) {
        c = scale(GILT, 0.8 + 0.25 * leaf);
        r = 0.35;
        m = 0.9;
      }
      if (opts.sprinkle && hash(x, y, seed + 9) > 0.93) c = mix(c, hex("A8402E"), 0.8);
      if (y < 10) {
        // headband: little stitched beads of silk in two colours
        const bead = (Math.floor(x / 4) % 2 === 0) ? hex("8E2A20") : hex("E8DCC0");
        c = scale(bead, 0.8 + 0.3 * Math.sin(((x % 4) / 4) * Math.PI));
        hh = 1.5;
        r = 0.6;
        m = 0;
      }
      books.set(x0 + x, y0 + y, c, hh, r, m);
    }
}
pageEdge(0, 1536, 256, 256, hex("F2E8D0"), 7);
pageEdge(256, 1536, 256, 256, hex("F2E8D0"), 8, { gilt: true });
pageEdge(0, 1792, 256, 256, hex("E4D2A8"), 9);
pageEdge(256, 1792, 256, 256, hex("EDE0C4"), 10, { sprinkle: true });

// side boards (neutral: the vertex colour tints them): cloth weave / leather grain, a worn edge along the spine side (v top)
function sideBoard(x0, y0, w, h, kind, seed) {
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const m = material(kind, [236, 236, 236], x0 + x, y0 + y, seed);
      let c = m.col;
      const edge = Math.min(x, w - 1 - x, y, h - 1 - y);
      if (edge < 6) c = scale(c, 0.85 + edge * 0.025);
      // the joint groove along the spine (left edge of the cell: u = 0 at the spine)
      if (x > 10 && x < 15) c = scale(c, 0.82);
      books.set(x0 + x, y0 + y, c, m.h + (x > 10 && x < 15 ? -0.6 : 0), m.r, 0);
    }
}
sideBoard(512, 1536, 512, 256, "cloth", 61);
sideBoard(512, 1792, 512, 256, "leather", 62);

// the open spread (two pages with lines of glyph-like text, a woodcut-ish vignette, the gutter's shade)
{
  const x0 = 1024, y0 = 1536, w = 1024, h = 512;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const g = Math.abs(x - w / 2) / (w / 2);
      const gutter = 0.72 + 0.28 * Math.min(1, g * 6);
      const paper = 0.95 + 0.05 * fbm(x * 0.05, y * 0.05, 71, 3);
      books.set(x0 + x, y0 + y, scale(hex("F6EEDC"), gutter * paper), 0, 0.85, 0);
    }
  const rg = mulberry(99);
  for (const side of [0, 1]) {
    const px0 = x0 + side * 512 + 60, px1 = x0 + side * 512 + 452;
    let y = y0 + 50;
    if (side === 1) {
      // a vignette
      for (let yy = 0; yy < 120; yy++)
        for (let xx = 0; xx < 220; xx++) {
          const n = fbm(xx * 0.08, yy * 0.08, 81, 3);
          const hatch = ((xx + yy) % 5 === 0) && n > 0.45;
          if (hatch || (yy < 2 || yy > 117 || xx < 2 || xx > 217)) books.set(px0 + 86 + xx, y + yy, scale(INK, 1.3), 0, 0.7, 0);
        }
      y += 150;
    }
    while (y < y0 + h - 60) {
      let x = px0 + (rg() < 0.12 ? 24 : 0);
      const end = rg() < 0.1 ? px0 + 120 + rg() * 200 : px1;
      while (x < end) {
        const wl = 6 + Math.floor(rg() * 26);
        for (let k = 0; k < wl && x + k < end; k++) {
          const hgt = 6 + (rg() < 0.2 ? 3 : 0);
          if (rg() < 0.75) for (let t = 0; t < hgt; t++) if (rg() < 0.7) books.set(Math.floor(x + k), y + 9 - t, scale(INK, 1.2 + rg() * 0.4), 0, 0.7, 0);
        }
        x += wl + 6;
      }
      y += 16;
    }
  }
}

// ------------------------------------------------------------------------------------------------ the rugs atlas --
const rugs = new Canvas(SZ, SZ, [120, 40, 30]);
/**
 * A Persian-style rug: a polar medallion with petals and pendants, quarter medallions in the field's corners, a field of curling
 * vines (contours of noise) and eight-petal flowers on a half-drop lattice, a main border of cartouches and rosettes between guard
 * stripes with reciprocal teeth; then the wool — the design softened by a knot's width, per-knot colour jitter, abrash (dye lots)
 * in bands along the length, a lighter worn path down the middle, a fine pile grain.
 */
function rug(x0, y0, w, h, pal, seed) {
  const [field, border, accent, ivory, navy, gold] = pal.map(hex);
  const green = hex("5E7A4E");
  const cx = w / 2, cy = h / 2;
  const B = Math.round(h * 0.17);
  const lat = Math.round(h * 0.1);
  const design = new Float32Array(w * h * 3);
  const polar = (dx, dy, R, petals, amp) => Math.hypot(dx, dy) / (R * (1 + amp * Math.cos(petals * Math.atan2(dy, dx))));
  const aspect = w / h;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let c = field;
      const ex = Math.min(x, w - 1 - x), ey = Math.min(y, h - 1 - y), e = Math.min(ex, ey);
      if (e < B) {
        const t = e / B;
        const along = ex < ey ? y : x;
        if (t < 0.05) c = navy;
        else if (t < 0.15) {
          // the outer guard: reciprocal teeth
          const k = (along % 24) / 24, q = (t - 0.05) / 0.1;
          c = (k < 0.5 ? q < k * 2 : q < (1 - k) * 2) ? ivory : accent;
        } else if (t < 0.18) c = gold;
        else if (t > 0.92) c = navy;
        else if (t > 0.89) c = gold;
        else {
          // the main band: cartouches alternating with rosettes, a vine running through
          const q = (t - 0.18) / 0.71;
          const P = B * 1.6;
          const k = ((along % P) + P) % P;
          const inCart = Math.abs(k - P * 0.3) < P * 0.22 && Math.abs(q - 0.5) < 0.3;
          const rd = polar(k - P * 0.78, (q - 0.5) * B * 0.71, B * 0.22, 8, 0.25);
          c = border;
          if (inCart) {
            c = ivory;
            const n = fbm(along * 0.05, q * 6, seed + 3, 3);
            if (Math.abs(n - 0.5) < 0.05) c = navy;
            if (Math.abs(k - P * 0.3) > P * 0.2 || Math.abs(q - 0.5) > 0.27) c = gold;
          } else if (rd < 1) c = rd < 0.45 ? gold : rd < 0.75 ? accent : ivory;
          else if (Math.abs(q - 0.5 - 0.28 * Math.sin((along / P) * Math.PI * 2)) < 0.035) c = gold;
        }
      } else {
        // the field: vines (noise contours), flowers on a half-drop lattice with a pair of leaves
        const n = fbm(x / (h * 0.18), y / (h * 0.18), seed, 4);
        if (Math.abs(n - 0.5) < 0.012 || Math.abs(n - 0.33) < 0.008 || Math.abs(n - 0.67) < 0.008) c = n > 0.6 ? gold : ivory;
        const row = Math.floor((y - B) / lat);
        const fx = ((x - B + (row % 2 ? lat / 2 : 0)) % lat + lat) % lat, fy = ((y - B) % lat + lat) % lat;
        const fl = polar(fx - lat / 2, fy - lat / 2, lat * 0.2, 8, 0.35);
        if (fl < 1) c = fl < 0.35 ? gold : fl < 0.7 ? accent : ivory;
        const leaf = polar(fx - lat / 2, fy - lat * 0.12, lat * 0.08, 2, 0.6);
        if (leaf < 1 && fl >= 1) c = green;
        // the quarter medallions in the field's corners
        const qx = Math.min(x - B, w - B - x), qy = Math.min(y - B, h - B - y);
        const qd = polar(qx / aspect * 1.6, qy, h * 0.34, 6, 0.12);
        if (qd < 1) {
          c = qd > 0.94 ? gold : qd > 0.88 ? navy : ivory;
          if (qd < 0.88) {
            const m = fbm(qx * 0.02, qy * 0.02, seed + 7, 3);
            if (Math.abs(m - 0.5) < 0.025) c = accent;
            const f2 = polar(((qx % 60) + 60) % 60 - 30, ((qy % 60) + 60) % 60 - 30, 9, 6, 0.3);
            if (f2 < 1) c = f2 < 0.5 ? field : navy;
          }
        }
        // the medallion: rings of petals, a star at the heart; pendants along the length
        const mx = (x - cx) / (aspect * 0.62);
        const md = polar(mx, y - cy, h * 0.3, 12, 0.09);
        if (md < 1) {
          c = md > 0.95 ? gold : md > 0.9 ? navy : md > 0.72 ? ivory : md > 0.67 ? accent : md > 0.4 ? navy : md > 0.34 ? gold : field;
          if (md > 0.72 && md < 0.9) {
            const m = fbm((x - cx) * 0.025, (y - cy) * 0.025, seed + 13, 3);
            if (Math.abs(m - 0.5) < 0.03) c = accent;
          }
          if (md > 0.4 && md < 0.67) {
            const m = fbm((x - cx) * 0.03, (y - cy) * 0.03, seed + 11, 3);
            c = Math.abs(m - 0.5) < 0.03 ? gold : navy;
            const pet = polar(mx, y - cy, h * 0.17, 8, 0.45);
            if (pet < 1) c = pet > 0.85 ? gold : accent;
          }
          const star = polar(mx, y - cy, h * 0.08, 8, 0.5);
          if (star < 1) c = star < 0.5 ? ivory : gold;
        }
        for (const sgn of [-1, 1]) {
          const pd = polar(x - cx - sgn * w * 0.3, (y - cy) * 2.2, h * 0.07, 4, 0.3);
          if (pd < 1) c = pd < 0.5 ? accent : pd < 0.8 ? ivory : navy;
        }
      }
      design.set(c, (y * w + x) * 3);
    }
  // the wool
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const X = Math.min(w - 1, Math.max(0, x + dx)), Y = Math.min(h - 1, Math.max(0, y + dy));
          const i = (Y * w + X) * 3;
          const k = dx === 0 && dy === 0 ? 4 : 1;
          r += design[i] * k; g += design[i + 1] * k; b += design[i + 2] * k; n += k;
        }
      let c = [r / n, g / n, b / n];
      const knot = (hash(x >> 1, y >> 1, seed) - 0.5) * 0.12;
      const abrash = (fbm(x * 0.002, y * 0.06, seed + 3, 2) - 0.5) * 0.18;
      const worn = Math.exp(-Math.pow((y - h / 2) / (h * 0.3), 2)) * Math.exp(-Math.pow((x - w / 2) / (w * 0.45), 2)) * 0.08;
      const pile = (vnoise(x * 0.9, y * 0.25, seed + 5) - 0.5) * 0.1;
      c = mix(scale(c, 0.92 + knot + abrash + pile), [225, 215, 195], worn);
      rugs.set(x0 + x, y0 + y, c, pile * 4 + knot * 3, 0.95, 0);
    }
}
// (field, border, accent, ivory, navy, gold)
rug(0, 0, 2048, 1072, ["8A2E24", "1F2A44", "C0603C", "EADBB8", "1A2236", "D0A850"], 11);
rug(0, 1100, 2048, 488, ["1F2A44", "8A2E24", "C0603C", "EADBB8", "141B2C", "D0A850"], 12);
rug(0, 1600, 2048, 448, ["5E6E4A", "7E2E24", "C9A24A", "E6D6B4", "2A3249", "B8563A"], 13);

// ------------------------------------------------------------------------------------------------ write --
async function ktx(data, w, h, srgb, out) {
  const buf = await encodeToKTX2(new Uint8Array(1), {
    isUASTC: true, uastcLDRQualityLevel: 2, needSupercompression: true, enableRDO: false,
    isPerceptual: srgb, isSetKTX2SRGBTransferFunc: srgb, isNormalMap: !srgb && out.includes("normal"),
    generateMipmap: true, isKTX2File: true, isYFlip: false,
    imageDecoder: async () => ({ width: w, height: h, data }),
  });
  writeFileSync(out, buf);
  console.log("wrote", out, w + "x" + h, buf.length, "bytes");
}
async function png(data, w, h, file) {
  if (!a.png) return;
  mkdirSync(a.png, { recursive: true });
  await sharp(Buffer.from(data), { raw: { width: w, height: h, channels: 4 } }).png().toFile(join(a.png, file));
}
const albedo = books.rgba();
const nrm = books.normal(5, 2);
const orm = books.orm(2);
const rugsRGBA = rugs.rgba();
// (--only=rugs / --only=books: encode one atlas; the UASTC encoder is the slow part)
if (a.only !== "rugs") {
  await ktx(albedo, SZ, SZ, true, join(OUT, "lot_library_reading_books.ktx2"));
  await ktx(nrm.data, nrm.w, nrm.h, false, join(OUT, "lot_library_reading_books_normal.ktx2"));
  await ktx(orm.data, orm.w, orm.h, false, join(OUT, "lot_library_reading_books_orm.ktx2"));
}
if (a.only !== "books") await ktx(rugsRGBA, SZ, SZ, true, join(OUT, "lot_library_reading_rugs.ktx2"));
await png(albedo, SZ, SZ, "lot_library_reading_books.png");
await png(nrm.data, nrm.w, nrm.h, "lot_library_reading_books_normal.png");
await png(orm.data, orm.w, orm.h, "lot_library_reading_books_orm.png");
await png(rugsRGBA, SZ, SZ, "lot_library_reading_rugs.png");
const table = {
  note: "b1_book_atlas.mjs: the books atlas cells (pixels, top-left origin, 2048 x 2048). base = the spine's mean colour (sRGB 0..255).",
  size: SZ,
  spines: cells,
  pages: { plain: [0, 1536, 256, 256], gilt: [256, 1536, 256, 256], aged: [0, 1792, 256, 256], sprinkled: [256, 1792, 256, 256] },
  sides: { cloth: [512, 1536, 512, 256], leather: [512, 1792, 512, 256], vellum: [512, 1536, 512, 256], jacket: [512, 1536, 512, 256] },
  sideMean: 214,
  spread: [1024, 1536, 1024, 512],
  rugs: { size: SZ, hearth: [0, 0, 2048, 1072], runner: [0, 1100, 2048, 488], mat: [0, 1600, 2048, 448] },
};
writeFileSync(join(import.meta.dirname, "library_book_atlas.json"), JSON.stringify(table, null, 1) + "\n");
console.log("cells", cells.length);

import type { BufferGeometry } from "three";
import { barkTube, type BarkStyle } from "./barkGeometry";
import { crownUv, tallUv, type CrownCell, type TallCell } from "./leafAtlas";
import { GeoBuilder, type Rgba } from "./vegGeometry";
import { mulberry32 } from "./vegRandom";

/**
 * Whole trees and plant bunches as ONE geometry each, grown in code (owner audit 2026-11-18: the lake forest's trunks were bare sticks
 * with the crowns floating on top, the temple pines flat plates, the reeds white sticks). A tree here is a real branching skeleton:
 * a leader, main branches off it, side branches off those, each a barkTube (the village's own bark: photo texture, normal map,
 * `BarkStyle`), and at the end of every branch a small leaf (or needle) spray CARD standing on the branch tip, so the foliage hangs on
 * wood you can follow from the trunk. Cards are cut-out pictures (leafAtlas.ts), folded down the middle so they have a little depth.
 *
 * Two parts per tree (two materials): `bark` and `leaves`. Two levels of detail: 0 (near: all the branches, many cards) and 1 (far:
 * the leader and main branches only, a third of the cards, each larger) so a far crown is the same silhouette for a tenth of the cost.
 * Pure and seeded: the same tree every load. Sizes are metres of the NOMINAL tree (`TreeDef.H`, `R`); an instance scales it.
 */

export type TreeSpecies = "birch" | "oak" | "beech" | "willow" | "pine";
type V3 = [number, number, number];

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export interface TreeDef {
  bark: BarkStyle;
  /** Nominal height and crown radius (m). */
  H: number;
  R: number;
  /** Trunk radius at the foot (m). */
  r0: number;
  /** The leader's top as a share of H (the crown's top above it). */
  leaderTop: number;
  /** Sideways wobble of the leader (m) and a spiral twist (pine). */
  wobble: number;
  twist: number;
  /** Branches start at this share of the leader and run to `end`; `count` of them. */
  start: number;
  end: number;
  count: number;
  /** Polar angle off straight up at the first and the last branch (deg). */
  angle: [number, number];
  /** Main branch length as a share of R at the lowest / the highest branch. */
  reach: [number, number];
  /** Upward curl of branches (share of their length). */
  rise: number;
  /** Side branches per main branch. */
  sub: number;
  /** The leaf picture, card size (m, side), cards per anchor. */
  cell: CrownCell;
  card: number;
  cards: number;
  /** Leaf colour variation (multiplies the picture): base rgb (linear-ish 0..1.2) and spread. */
  leafK: [number, number, number];
  /** The crown's centre as a share of H, for the inner shade. */
  crownC: number;
}

const bark = (pattern: BarkStyle["pattern"], old: string, young: string): BarkStyle => ({ pattern, old, young });

export const TREE_DEFS: Readonly<Record<Exclude<TreeSpecies, "willow">, TreeDef>> = {
  // a slender white trunk, fine branches rising at 35-50 degrees, a narrow airy oval crown of small bright leaves
  birch: { bark: bark("smooth", "#CFC8B8", "#6E5A48"), H: 10, R: 2.9, r0: 0.17, leaderTop: 0.97, wobble: 0.35, twist: 0, start: 0.28, end: 0.94, count: 13, angle: [58, 24], reach: [0.95, 0.4], rise: 0.28, sub: 3, cell: "birch", card: 1.15, cards: 3, leafK: [1.0, 1.04, 0.96], crownC: 0.62 },
  // a thick dark trunk that forks low, big limbs reaching wide and level then lifting at the tip: a broad dome of lobed leaves
  oak: { bark: bark("plates", "#5E4F42", "#6A5642"), H: 9, R: 4.4, r0: 0.4, leaderTop: 0.62, wobble: 0.5, twist: 0.4, start: 0.3, end: 0.98, count: 9, angle: [72, 38], reach: [1.0, 0.55], rise: 0.38, sub: 3, cell: "oak", card: 1.5, cards: 3, leafK: [0.95, 0.98, 0.92], crownC: 0.66 },
  // a smooth grey straight trunk, the branches arching up and out: a dense tall oval crown of oval leaves
  beech: { bark: bark("smooth", "#8D897E", "#6A5A48"), H: 11, R: 3.7, r0: 0.28, leaderTop: 0.94, wobble: 0.2, twist: 0, start: 0.24, end: 0.95, count: 12, angle: [62, 30], reach: [1.0, 0.5], rise: 0.34, sub: 3, cell: "beech", card: 1.35, cards: 3, leafK: [1.0, 1.02, 0.95], crownC: 0.6 },
  // Korean red pine: a twisted reddish scaly trunk, a few long limbs, the needles in flat clouds at the limb ends
  pine: { bark: bark("plates", "#6A4434", "#78503C"), H: 9, R: 2.5, r0: 0.28, leaderTop: 0.86, wobble: 0.75, twist: 1.4, start: 0.32, end: 0.95, count: 9, angle: [86, 62], reach: [1.0, 0.55], rise: 0.22, sub: 3, cell: "pine", card: 1.5, cards: 3, leafK: [1.0, 1.0, 0.95], crownC: 0.74 },
};

export interface TreeGeo {
  bark: BufferGeometry;
  leaves: BufferGeometry;
  /** Height of the nominal tree and the crown's reach (m): for the bounds. */
  H: number;
  R: number;
  tris: number;
}

interface Branch {
  pts: V3[];
  radii: number[];
}
interface Anchor {
  p: V3;
  dir: V3;
  /** 0 = tip, 1 = along a branch (side card). */
  kind: number;
}

/** A path from `start` along `dir` for `length`, bending by `curl` (up) and noise. */
function path(rnd: () => number, start: V3, dir: V3, length: number, n: number, curl: number, wob: number): V3[] {
  const pts: V3[] = [start];
  let d = norm(dir);
  for (let i = 1; i <= n; i++) {
    d = norm(add(d, add(mul([0, 1, 0], curl / n), [(rnd() - 0.5) * wob, (rnd() - 0.5) * wob * 0.5, (rnd() - 0.5) * wob])));
    pts.push(add(pts[i - 1]!, mul(d, length / n)));
  }
  return pts;
}

function radiiOf(n: number, r0: number, rEnd: number, shape = 0.8): number[] {
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    return rEnd + (r0 - rEnd) * Math.pow(1 - t, shape);
  });
}

function pointAt(b: Branch, t: number): { p: V3; dir: V3; r: number } {
  const f = clamp(t, 0, 1) * (b.pts.length - 1);
  const i = Math.min(b.pts.length - 2, Math.floor(f));
  const u = f - i;
  const a = b.pts[i]!;
  const c = b.pts[i + 1]!;
  return { p: add(a, mul(sub(c, a), u)), dir: norm(sub(c, a)), r: lerp(b.radii[i]!, b.radii[i + 1]!, u) };
}

/** The whole nominal tree's skeleton and card anchors. */
function skeleton(def: TreeDef, seed: number, lod: 0 | 1): { branches: Branch[]; anchors: Anchor[]; top: V3 } {
  const rnd = mulberry32(seed * 7919 + 13);
  const branches: Branch[] = [];
  const anchors: Anchor[] = [];
  const nLead = 9;
  const leadLen = def.H * def.leaderTop;
  // the leader: wobbles (a pine's winds round as it rises), thins toward the top
  const lead: V3[] = [];
  const ph = rnd() * 6.28;
  const lean: V3 = [(rnd() - 0.5) * 0.7, 0, (rnd() - 0.5) * 0.7];
  for (let i = 0; i <= nLead; i++) {
    const t = i / nLead;
    const w = def.wobble * Math.sin(t * 3.1 + ph) * t * 0.6;
    const tw = def.twist * t;
    lead.push([Math.sin(tw * 3 + ph) * def.wobble * 0.35 * t + w * 0.3 + lean[0] * t * leadLen * 0.06, t * leadLen, Math.cos(tw * 3 + ph) * def.wobble * 0.35 * t + w * 0.2 + lean[2] * t * leadLen * 0.06]);
  }
  const leader: Branch = { pts: lead, radii: radiiOf(lead.length, def.r0, Math.max(0.025, def.r0 * 0.12), 0.9) };
  branches.push(leader);
  const top = lead[lead.length - 1]!;
  anchors.push({ p: top, dir: [0, 1, 0], kind: 0 });
  const count = def.count;
  for (let k = 0; k < count; k++) {
    const u = (k + 0.3 + rnd() * 0.4) / count;
    const t = lerp(def.start, def.end, u);
    const at = pointAt(leader, t);
    const az = k * 2.39996 + rnd() * 0.5;
    const polar = (lerp(def.angle[0], def.angle[1], u) * Math.PI) / 180 + (rnd() - 0.5) * 0.15;
    const dir: V3 = norm([Math.sin(polar) * Math.cos(az), Math.cos(polar), Math.sin(polar) * Math.sin(az)]);
    const L = def.R * lerp(def.reach[0], def.reach[1], Math.pow(u, 0.9)) * (0.85 + rnd() * 0.3);
    const segs = 5;
    const pts = path(rnd, at.p, dir, L, segs, def.rise * (1 - u * 0.4), 0.28);
    const rb = Math.max(0.03, at.r * 0.52);
    const main: Branch = { pts, radii: radiiOf(pts.length, rb, 0.014, 0.85) };
    branches.push(main);
    const tip = pts[pts.length - 1]!;
    anchors.push({ p: tip, dir: norm(sub(tip, pts[pts.length - 2]!)), kind: 0 });
    const nSub = def.sub;
    for (let s = 0; s < nSub; s++) {
      const tt = lerp(0.35, 0.92, (s + rnd() * 0.5) / nSub);
      const sa = pointAt(main, tt);
      const side = (s % 2 ? 1 : -1) * (0.7 + rnd() * 0.6);
      const perp = norm(cross(sa.dir, [0, 1, 0]));
      const sd = norm(add(add(mul(sa.dir, 0.9), mul(perp, side)), [0, 0.35 + rnd() * 0.3, 0]));
      const sL = L * (1 - tt) * (0.7 + rnd() * 0.4) + 0.5;
      const sp = path(rnd, sa.p, sd, sL, 3, def.rise * 0.5, 0.34);
      const sBr: Branch = { pts: sp, radii: radiiOf(sp.length, Math.max(0.012, sa.r * 0.5), 0.008, 0.9) };
      if (!lod) branches.push(sBr);
      const stip = sp[sp.length - 1]!;
      anchors.push({ p: stip, dir: norm(sub(stip, sp[sp.length - 2]!)), kind: 0 });
      const mid = pointAt(sBr, 0.55);
      anchors.push({ p: mid.p, dir: norm(add(mid.dir, [0, 0.4, 0])), kind: 1 });
    }
    const m = pointAt(main, 0.62);
    anchors.push({ p: m.p, dir: norm(add(m.dir, [0, 0.4, 0])), kind: 1 });
  }
  return { branches, anchors, top };
}

/** A folded card (4 triangles) standing on `base`, its up axis `up`, width axis `side`, size w x h, the picture's uv window. */
function card(b: GeoBuilder, base: V3, up: V3, side: V3, w: number, h: number, uv: readonly [number, number, number, number], normalHint: V3, hintK: number, col: Rgba, light: number, windBase: number, windTop: number, fold = 0.1): void {
  const n0 = norm(cross(side, up));
  const nrm = (sgn: number): V3 => norm(add(mul(n0, sgn * (1 - hintK)), mul(normalHint, hintK)));
  const half = mul(side, w * 0.5);
  const top = add(base, mul(up, h));
  const bump = mul(n0, w * fold);
  const [u0, v0, u1, v1] = uv;
  const um = (u0 + u1) / 2;
  const bl = b.v(sub(base, half), nrm(-1), col, [u0, v0], windBase, light * 0.9);
  const bm = b.v(add(base, bump), nrm(1), col, [um, v0], windBase, light * 0.9);
  const br = b.v(add(base, half), nrm(-1), col, [u1, v0], windBase, light * 0.9);
  const tl = b.v(add(sub(top, half), mul(bump, 0.2)), nrm(-1), col, [u0, v1], windTop, light);
  const tm = b.v(add(top, bump), nrm(1), col, [um, v1], windTop, light);
  const tr = b.v(add(add(top, half), mul(bump, 0.2)), nrm(-1), col, [u1, v1], windTop, light);
  b.tri(bl, bm, tm);
  b.tri(bl, tm, tl);
  b.tri(bm, br, tr);
  b.tri(bm, tr, tm);
}

/** The deterministic leaf colour of one card: the species' base with a lightness and a hue wobble. */
function leafColour(def: TreeDef, rnd: () => number): Rgba {
  const k = 0.84 + rnd() * 0.3;
  const hue = (rnd() - 0.5) * 0.14;
  return [clamp(def.leafK[0] * k * (1 + hue), 0, 1.4), clamp(def.leafK[1] * k, 0, 1.4), clamp(def.leafK[2] * k * (1 - hue), 0, 1.4), 0];
}

export interface TreeOptions {
  lod: 0 | 1;
  /** The phone's tier: fewer cards, fewer bark sides. */
  low: boolean;
}

/** Build one tree of `species` (not the willow: `willowGeo`) from `seed`. */
export function treeGeo(species: Exclude<TreeSpecies, "willow">, seed: number, o: TreeOptions): TreeGeo {
  const def = TREE_DEFS[species];
  const rnd = mulberry32(seed * 104729 + 7);
  const { branches, anchors } = skeleton(def, seed, o.lod);
  const bb = new GeoBuilder();
  bb.surface = true;
  const light = (p: V3, _n: V3) => 0.82 + 0.18 * clamp(p[1] / 2.5, 0, 1);
  const sidesOf = (r: number) => (o.lod ? 4 : r > 0.12 ? (o.low ? 8 : 12) : r > 0.04 ? (o.low ? 5 : 7) : 4);
  branches.forEach((br, i) => {
    const r = br.radii[0]!;
    if (o.lod && i > 0 && r < 0.03) return;
    barkTube(bb, br.pts, br.radii, sidesOf(r), def.bark, light, i === 0 ? { irregular: { k: 0.05, seed: seed + 3 }, flare: { k: 0.35, top: 0.7, seed: seed * 1.3, groundY: 0 }, wraps: Math.max(1, Math.round(r / 0.17)) } : { wraps: r > 0.1 ? 2 : 1 });
  });
  // leaf cards on the anchors
  const lb = new GeoBuilder();
  const uv = crownUv(def.cell);
  const cc: V3 = [0, def.H * def.crownC, 0];
  const lowK = o.low ? 0.7 : 1;
  const cardsPer = o.lod ? 2 : Math.max(2, Math.round(def.cards * lowK));
  const size = def.card * (o.lod ? 1.45 : 1);
  anchors.forEach((a, ai) => {
    // the phone's far level: a third of the side-cards go (the tips keep the silhouette)
    if (o.lod && o.low && a.kind && ai % 3 === 2) return;
    const outward = norm(sub(a.p, cc));
    const d = dot(a.dir, [0, 1, 0]);
    for (let c = 0; c < cardsPer; c++) {
      let up = norm(add(add(mul(a.dir, a.kind ? 0.35 : 0.7), mul(outward, 0.35)), [(rnd() - 0.5) * 0.7, 0.12 + (rnd() - 0.3) * 0.4, (rnd() - 0.5) * 0.7]));
      if (species === "pine") up = norm(add(mul(up, 0.55), [0, 0.65, 0]));
      let side = norm(cross(up, c === 0 ? [0.31, 0.2, 0.93] : [0.95 - c * 0.5, 0.1, -0.31 + c * 0.7]));
      if (len(side) < 0.2) side = [1, 0, 0];
      side = norm(sub(side, mul(up, dot(side, up))));
      // pine: the cards lie as a flat-ish cloud (the picture's top toward the sky, its width spread along the limb)
      const sz = size * (0.8 + rnd() * 0.45) * (a.kind ? 0.85 : 1);
      const dd = len(sub(a.p, cc)) / Math.max(def.R, 0.5);
      const shadeK = lerp(0.64, 1.08, clamp(dd / 1.05, 0, 1)) * (0.95 + 0.1 * clamp((a.p[1] - cc[1]) / (def.H * 0.4) + 0.5, 0, 1));
      const col = leafColour(def, rnd);
      // the card's foot a little inside the branch tip so the twig in the picture meets the wood
      const base = sub(a.p, mul(up, 0.12 * sz));
      card(lb, base, up, side, sz * 0.95, sz, uv, norm(add(mul(outward, 0.7), [0, 0.3 + d * 0.1, 0])), 0.55, col, shadeK, 0.25, 0.85);
    }
  });
  const barkG = bb.build();
  const leafG = lb.build();
  return { bark: barkG, leaves: leafG, H: def.H, R: def.R, tris: bb.triangleCount + lb.triangleCount };
}

/**
 * A weeping willow: a short thick trunk, a few big limbs up and out, arching branches that droop, and from along them dozens of
 * hanging strand cards (the willow strand picture, 2-3.5 m long, two crossed per hanging point) so the crown is a curtain, not
 * wires. `bark` the trunk and limbs, `leaves` the strands.
 */
export function willowGeo(seed: number, o: TreeOptions): TreeGeo {
  const H = 9.5;
  const R = 4.6;
  const rnd = mulberry32(seed * 2753 + 11);
  const bb = new GeoBuilder();
  bb.surface = true;
  const lb = new GeoBuilder();
  const style: BarkStyle = { pattern: "willow", old: "#4E4236", young: "#857A4E" };
  const light = (p: V3) => 0.8 + 0.2 * clamp(p[1] / 2, 0, 1);
  const trunk = path(rnd, [0, 0, 0], [0.12, 1, 0.05], 3.4, o.lod ? 3 : 5, 0.05, 0.35);
  barkTube(bb, trunk, radiiOf(trunk.length, 0.46, 0.2, 0.9), o.lod ? 6 : o.low ? 8 : 12, style, light, { irregular: { k: 0.06, seed }, flare: { k: 0.4, top: 0.8, seed, groundY: 0 }, wraps: 3 });
  const uv = tallUv("willow");
  const limbs = o.lod ? 4 : 6;
  const hangs = o.lod ? 12 : o.low ? 20 : 30;
  const cardsAt = (p: V3, out: V3, hlen: number, k: number) => {
    const sideA = norm([-out[2], 0, out[0]]);
    const sideB = norm(add(mul(out, 1), mul(sideA, 0.15)));
    const w = hlen * 0.2 + 0.55;
    const col: Rgba = [0.9 + rnd() * 0.2, 0.95 + rnd() * 0.15, 0.82 + rnd() * 0.15, 0];
    // a strand card: its top (v1) at the branch, hanging down; the card base (v0) is its lower end, so `base` is the lower end
    const lower = add(p, [0, -hlen, 0]);
    const dd = clamp(Math.hypot(p[0], p[2]) / R, 0, 1.1);
    const lightK = lerp(0.7, 1.05, dd) * (0.92 + k * 0.1);
    card(lb, lower, [0, 1, 0], sideA, w, hlen, uv, norm(add(out, [0, 0.2, 0])), 0.5, col, lightK, 0.9, 0.15, 0.06);
    card(lb, lower, [0, 1, 0], sideB, w * 0.9, hlen, uv, norm(add(out, [0, 0.2, 0])), 0.5, col, lightK * 0.96, 0.9, 0.15, 0.06);
  };
  for (let k = 0; k < limbs; k++) {
    const az = (k / limbs) * Math.PI * 2 + rnd() * 0.6;
    const out: V3 = [Math.cos(az), 0, Math.sin(az)];
    const start = pointAt({ pts: trunk, radii: radiiOf(trunk.length, 0.46, 0.2) }, 0.72 + rnd() * 0.28);
    const dir = norm(add(mul(out, 0.8), [0, 0.9 + rnd() * 0.3, 0]));
    const limb = path(rnd, start.p, dir, 3.4 + rnd() * 1.6, o.lod ? 3 : 5, -0.05, 0.3);
    barkTube(bb, limb, radiiOf(limb.length, 0.15, 0.03, 0.85), o.lod ? 4 : 6, style, light);
    // arching branches off the limb's outer half, drooping, with strands hung along each
    const nArch = o.lod ? 2 : 4;
    for (let a = 0; a < nArch; a++) {
      const at = pointAt({ pts: limb, radii: radiiOf(limb.length, 0.15, 0.03) }, lerp(0.45, 1, (a + rnd() * 0.4) / nArch));
      const aaz = az + (rnd() - 0.5) * 1.6;
      const ad: V3 = norm([Math.cos(aaz) * 0.9, 0.55, Math.sin(aaz) * 0.9]);
      const arch = path(rnd, at.p, ad, 1.5 + rnd() * 1.1, 4, -0.55, 0.18);
      if (!o.lod) barkTube(bb, arch, radiiOf(arch.length, 0.035, 0.008, 0.9), 4, style, light);
      const per = Math.ceil(hangs / (limbs * nArch));
      for (let h = 0; h < per; h++) {
        const hp = pointAt({ pts: arch, radii: radiiOf(arch.length, 0.04, 0.01) }, lerp(0.35, 1, h / Math.max(1, per - 1)));
        const hlen = clamp(hp.p[1] - (0.5 + rnd() * 1.1), 1.2, 4.2) * (o.lod ? 1 : 0.92);
        const outv = norm([hp.p[0] + 1e-3, 0, hp.p[2] + 1e-3]);
        cardsAt(hp.p, outv, hlen, rnd());
      }
    }
  }
  return { bark: bb.build(), leaves: lb.build(), H, R, tris: bb.triangleCount + lb.triangleCount };
}

/** What a bunch of blade cards is (reeds, cattails, grass tufts). */
export interface BunchDef {
  cell: TallCell;
  /** Cards (crossed round the middle), their width and height (m). */
  cards: number;
  w: number;
  h: number;
  /** Lean of each card off vertical (rad, max). */
  lean: number;
  /** Radius the cards' feet are spread over (m). */
  spread: number;
}

export const BUNCHES: Readonly<Record<"reed" | "cattail" | "grass" | "grassTall", BunchDef>> = {
  reed: { cell: "reed", cards: 7, w: 1.05, h: 2.05, lean: 0.2, spread: 0.32 },
  cattail: { cell: "cattail", cards: 5, w: 0.8, h: 1.9, lean: 0.14, spread: 0.24 },
  grass: { cell: "grass", cards: 4, w: 0.6, h: 0.42, lean: 0.3, spread: 0.18 },
  grassTall: { cell: "grassTall", cards: 5, w: 0.75, h: 0.78, lean: 0.28, spread: 0.24 },
};

/** One bunch of crossed blade cards standing on y = 0: variants differ by `seed`. */
export function bunchGeo(kind: keyof typeof BUNCHES, seed: number): BufferGeometry {
  const def = BUNCHES[kind];
  const rnd = mulberry32(seed * 40503 + 5);
  const b = new GeoBuilder();
  b.windHeight = def.h;
  const uv = tallUv(def.cell);
  for (let i = 0; i < def.cards; i++) {
    const yaw = (i / def.cards) * Math.PI + (rnd() - 0.5) * 0.5;
    const side: V3 = [Math.cos(yaw), 0, Math.sin(yaw)];
    const ang = rnd() * Math.PI * 2;
    const lean = rnd() * def.lean;
    const up = norm([Math.cos(ang) * Math.sin(lean), Math.cos(lean), Math.sin(ang) * Math.sin(lean)]);
    const sideOrtho = norm(sub(side, mul(up, dot(side, up))));
    const sc = 0.78 + rnd() * 0.42;
    const cw = def.w * sc;
    // a tilted card's low edge would dip under the ground: lift the foot by what its width swings down
    const base: V3 = [(rnd() - 0.5) * def.spread * 2, Math.abs(sideOrtho[1]) * cw * 0.5 - 0.03, (rnd() - 0.5) * def.spread * 2];
    const col: Rgba = [0.86 + rnd() * 0.24, 0.88 + rnd() * 0.18, 0.76 + rnd() * 0.2, 0];
    card(b, base, up, sideOrtho, cw, def.h * sc * (0.85 + rnd() * 0.3), uv, [0, 1, 0], 0.55, col, 0.8, 0, 1, 0.04);
  }
  return b.build();
}

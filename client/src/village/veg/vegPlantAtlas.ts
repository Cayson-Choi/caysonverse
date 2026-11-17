import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RGBAFormat, SRGBColorSpace, UnsignedByteType, type Texture } from "three";
import { PLANT_CELL, PLANT_GRID } from "./plantCells";
import { mulberry32 } from "./vegRandom";

/**
 * The plant atlas (veg3d, 2026-11-16 plants rebuild): the leaves, petals and mulch of the bushes and bedding plants,
 * drawn at runtime on a canvas from the reference photos' measurements (art/village/refs/plants: boxwood, azalea,
 * pansy, petunia, grape hyacinth, marigold), so nothing here is a photo or a third-party texture. 4 x 4 cells of 256 px
 * (plantCells.ts). The petals are drawn white and shaded (the plant's colour multiplies them: one picture serves every
 * colour), the leaves and the mulch in their own colours. Alpha is the outline (the material cuts it); the colour of
 * the cut-away texels is bled out from the drawn ones (no dark fringe when mipmapped).
 */

const CELL = 256;
type Ctx = CanvasRenderingContext2D;
type Rand = () => number;

const rgb = (r: number, g: number, b: number, a = 1) => `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`;
const shade = (c: readonly [number, number, number], k: number, a = 1) => rgb(Math.min(255, c[0] * k), Math.min(255, c[1] * k), Math.min(255, c[2] * k), a);
const lerp3 = (a: readonly number[], b: readonly number[], t: number): [number, number, number] => [a[0]! + (b[0]! - a[0]!) * t, a[1]! + (b[1]! - a[1]!) * t, a[2]! + (b[2]! - a[2]!) * t];

// ─────────────────────────────────────────── leaves on sprigs ───────────────────────────────────────────

/**
 * One small leaf at (x, y) pointing along `ang`, length L, width W: an obovate blade (narrow base, rounded tip), shaded
 * across (lit side lighter), a paler midrib, a glossy streak, a thin dark rim. `fore` < 1 foreshortens it (a leaf seen
 * edge-on: a decussate pair turned away from the eye).
 */
function smallLeaf(g: Ctx, x: number, y: number, ang: number, L: number, W: number, col: readonly [number, number, number], k: number, gloss: number, rand: Rand, opts: { fore?: number; elliptic?: boolean; hair?: boolean } = {}): void {
  g.save();
  g.translate(x, y);
  g.rotate(ang);
  g.scale(1, opts.fore ?? 1);
  const w = W / 2;
  g.beginPath();
  g.moveTo(0, 0);
  if (opts.elliptic) {
    g.bezierCurveTo(L * 0.15, -w * 1.05, L * 0.75, -w * 1.1, L, -w * 0.05);
    g.bezierCurveTo(L * 0.75, w * 1.1, L * 0.15, w * 1.05, 0, 0);
  } else {
    // obovate: widest two thirds out, a broad round tip with a tiny notch
    g.bezierCurveTo(L * 0.18, -w * 0.62, L * 0.55, -w * 1.08, L * 0.86, -w * 0.82);
    g.quadraticCurveTo(L * 1.02, -w * 0.45, L * 0.98, 0);
    g.quadraticCurveTo(L * 1.02, w * 0.45, L * 0.86, w * 0.82);
    g.bezierCurveTo(L * 0.55, w * 1.08, L * 0.18, w * 0.62, 0, 0);
  }
  g.closePath();
  const gr = g.createLinearGradient(0, -w, 0, w);
  gr.addColorStop(0, shade(col, k * 1.18));
  gr.addColorStop(0.45, shade(col, k * 1.02));
  gr.addColorStop(0.55, shade(col, k * 0.9));
  gr.addColorStop(1, shade(col, k * 0.72));
  g.fillStyle = gr;
  g.fill();
  // a darker base (the leaf's stalk end is in the shade of the next pair)
  const gb = g.createLinearGradient(0, 0, L, 0);
  gb.addColorStop(0, rgb(10, 25, 5, 0.35));
  gb.addColorStop(0.35, rgb(10, 25, 5, 0));
  g.fillStyle = gb;
  g.fill();
  if (gloss > 0) {
    g.fillStyle = rgb(235, 245, 215, 0.22 * gloss);
    g.beginPath();
    g.ellipse(L * 0.6, -w * 0.35, L * 0.24, w * 0.22, -0.15, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = shade(lerp3(col, [230, 240, 180], 0.35), k * 1.05, 0.55);
  g.lineWidth = Math.max(0.6, W * 0.06);
  g.beginPath();
  g.moveTo(L * 0.04, 0);
  g.quadraticCurveTo(L * 0.5, -w * 0.04, L * 0.9, 0);
  g.stroke();
  g.strokeStyle = opts.hair ? rgb(215, 225, 190, 0.35) : rgb(15, 30, 8, 0.45);
  g.lineWidth = Math.max(0.5, W * 0.045);
  g.beginPath();
  if (opts.elliptic) {
    g.moveTo(0, 0);
    g.bezierCurveTo(L * 0.15, -w * 1.05, L * 0.75, -w * 1.1, L, -w * 0.05);
    g.bezierCurveTo(L * 0.75, w * 1.1, L * 0.15, w * 1.05, 0, 0);
  } else {
    g.moveTo(0, 0);
    g.bezierCurveTo(L * 0.18, -w * 0.62, L * 0.55, -w * 1.08, L * 0.86, -w * 0.82);
    g.quadraticCurveTo(L * 1.02, -w * 0.45, L * 0.98, 0);
    g.quadraticCurveTo(L * 1.02, w * 0.45, L * 0.86, w * 0.82);
    g.bezierCurveTo(L * 0.55, w * 1.08, L * 0.18, w * 0.62, 0, 0);
  }
  g.stroke();
  void rand;
  g.restore();
}

interface Stem {
  pts: Array<[number, number]>;
  width: number;
}

/** A branching sprig skeleton growing from (x0, y0) up the cell (angles in canvas radians: -pi/2 is up). */
function sprigStems(rand: Rand, x0: number, y0: number, len: number, ang: number, depth: number, out: Stem[], width: number): void {
  const pts: Array<[number, number]> = [[x0, y0]];
  let x = x0;
  let y = y0;
  let a = ang;
  const n = 8;
  for (let i = 1; i <= n; i++) {
    a += (rand() - 0.5) * 0.25;
    x += Math.cos(a) * (len / n);
    y += Math.sin(a) * (len / n);
    pts.push([x, y]);
  }
  out.push({ pts, width });
  if (depth <= 0) return;
  const kids = depth === 2 ? 3 : 2;
  for (let k = 0; k < kids; k++) {
    const t = 0.28 + (k / kids) * 0.5 + rand() * 0.1;
    const i = Math.min(n - 1, Math.floor(t * n));
    const [bx, by] = pts[i]!;
    const side = k % 2 ? 1 : -1;
    sprigStems(rand, bx, by, len * (0.42 + rand() * 0.2), ang + side * (0.55 + rand() * 0.4), depth - 1, out, width * 0.7);
  }
}

/** Points every `step` px along a stem, with the stem's direction there. */
function along(st: Stem, step: number, from = 0): Array<{ x: number; y: number; a: number; t: number }> {
  const out: Array<{ x: number; y: number; a: number; t: number }> = [];
  let total = 0;
  const seg: number[] = [];
  for (let i = 1; i < st.pts.length; i++) {
    const d = Math.hypot(st.pts[i]![0] - st.pts[i - 1]![0], st.pts[i]![1] - st.pts[i - 1]![1]);
    seg.push(d);
    total += d;
  }
  for (let s = from; s <= total; s += step) {
    let acc = 0;
    for (let i = 0; i < seg.length; i++) {
      if (acc + seg[i]! >= s || i === seg.length - 1) {
        const t = Math.min(1, (s - acc) / seg[i]!);
        const [ax, ay] = st.pts[i]!;
        const [bx, by] = st.pts[i + 1]!;
        out.push({ x: ax + (bx - ax) * t, y: ay + (by - ay) * t, a: Math.atan2(by - ay, bx - ax), t: s / total });
        break;
      }
      acc += seg[i]!;
    }
  }
  return out;
}

function drawStems(g: Ctx, stems: readonly Stem[], col: string): void {
  g.lineCap = "round";
  g.lineJoin = "round";
  g.strokeStyle = col;
  for (const st of stems) {
    g.lineWidth = st.width;
    g.beginPath();
    g.moveTo(st.pts[0]![0], st.pts[0]![1]);
    for (const p of st.pts.slice(1)) g.lineTo(p[0], p[1]);
    g.stroke();
  }
}

const BOX_GREENS: ReadonlyArray<readonly [number, number, number]> = [
  [70, 116, 42],
  [62, 106, 38],
  [82, 128, 48],
  [56, 96, 34],
];
const BOX_YOUNG: readonly [number, number, number] = [104, 146, 58];

/**
 * A boxwood sprig: a forked twig with opposite pairs of leaves 1.6-2.2 cm long (24-32 px on the 16 cm card), the pairs
 * decussate (every other pair turned, foreshortened), younger paler leaves at the tips; behind it, a few darker leaves
 * of the twigs further in. `inner`: the bush's inside (darker, older, more twig showing, no gloss).
 */
function drawBoxwood(g: Ctx, ox: number, oy: number, seed: number, inner: boolean): void {
  const rand = mulberry32(seed);
  g.save();
  g.beginPath();
  g.rect(ox + 3, oy + 3, CELL - 6, CELL - 6);
  g.clip();
  // the back: leaves of the twigs behind, darker
  const backN = inner ? 220 : 130;
  for (let i = 0; i < backN; i++) {
    const r = Math.sqrt(rand()) * CELL * 0.44;
    const a = rand() * Math.PI * 2;
    const x = ox + CELL / 2 + Math.cos(a) * r;
    const y = oy + CELL * 0.47 + Math.sin(a) * r * 0.95;
    const col = BOX_GREENS[Math.floor(rand() * BOX_GREENS.length)]!;
    smallLeaf(g, x, y, rand() * Math.PI * 2, 22 + rand() * 8, 12 + rand() * 3, col, (inner ? 0.38 : 0.5) + rand() * 0.15, 0, rand, { fore: 0.6 + rand() * 0.4 });
  }
  const stems: Stem[] = [];
  sprigStems(rand, ox + CELL / 2 + (rand() - 0.5) * 20, oy + CELL - 6, CELL * 0.82, -Math.PI / 2 + (rand() - 0.5) * 0.3, 2, stems, inner ? 4 : 3.2);
  drawStems(g, stems, inner ? rgb(92, 76, 50) : rgb(110, 112, 60));
  // the leaf pairs along every stem, base to tip
  for (const st of stems) {
    const pts = along(st, 15 + rand() * 3, 8);
    pts.forEach((p, i) => {
      const tip = p.t > 0.82;
      const L = (tip ? 17 : 26) + rand() * 6;
      const W = L * (0.5 + rand() * 0.08);
      const turned = i % 2 === 1;
      const col = tip && !inner ? BOX_YOUNG : BOX_GREENS[Math.floor(rand() * BOX_GREENS.length)]!;
      const k = (inner ? 0.62 : 0.86) + rand() * 0.2;
      for (const side of [-1, 1]) {
        const ang = p.a + side * (turned ? 0.35 + rand() * 0.2 : 0.95 + rand() * 0.35);
        smallLeaf(g, p.x, p.y, ang, L * (turned ? 0.8 : 1), W, col, k * (turned ? 0.85 : 1), inner ? 0.2 : 0.9, rand, { fore: turned ? 0.55 : 1 });
      }
    });
    // the terminal bud's little rosette
    const end = st.pts[st.pts.length - 1]!;
    const a0 = Math.atan2(end[1] - st.pts[st.pts.length - 2]![1], end[0] - st.pts[st.pts.length - 2]![0]);
    for (const da of [-0.4, 0.4, 0]) smallLeaf(g, end[0], end[1], a0 + da, 13 + rand() * 4, 7, inner ? BOX_GREENS[1]! : BOX_YOUNG, inner ? 0.7 : 1.0, 0.6, rand);
  }
  g.restore();
}

/** An azalea shoot card: three woody shoots ending in whorls of 5-7 elliptic leaves (3-5 cm: 45-70 px on 18 cm). */
function drawAzaleaSprig(g: Ctx, ox: number, oy: number, seed: number): void {
  const rand = mulberry32(seed);
  g.save();
  g.beginPath();
  g.rect(ox + 3, oy + 3, CELL - 6, CELL - 6);
  g.clip();
  const greens: Array<[number, number, number]> = [
    [52, 92, 34],
    [44, 80, 30],
    [64, 104, 40],
  ];
  // back leaves
  for (let i = 0; i < 40; i++) {
    const r = Math.sqrt(rand()) * CELL * 0.4;
    const a = rand() * Math.PI * 2;
    smallLeaf(g, ox + CELL / 2 + Math.cos(a) * r, oy + CELL / 2 + Math.sin(a) * r, rand() * 6.28, 40 + rand() * 14, 16 + rand() * 4, greens[i % 3]!, 0.5 + rand() * 0.15, 0, rand, { elliptic: true, fore: 0.5 + rand() * 0.5 });
  }
  const tips: Array<[number, number, number]> = [];
  for (let s = 0; s < 3; s++) {
    const stems: Stem[] = [];
    const x0 = ox + CELL / 2 + (s - 1) * 40 + (rand() - 0.5) * 20;
    sprigStems(rand, x0, oy + CELL - 6, CELL * (0.55 + rand() * 0.2), -Math.PI / 2 + (s - 1) * 0.45 + (rand() - 0.5) * 0.2, 0, stems, 3.6);
    drawStems(g, stems, rgb(96, 70, 52));
    for (const st of stems) {
      // scattered leaves along the shoot, the whorl at its end
      for (const p of along(st, 26, 30)) smallLeaf(g, p.x, p.y, p.a + (rand() < 0.5 ? -1 : 1) * (0.8 + rand() * 0.4), 30 + rand() * 10, 16, greens[Math.floor(rand() * 3)]!, 0.7 + rand() * 0.15, 0.6, rand, { elliptic: true, hair: true });
      const e = st.pts[st.pts.length - 1]!;
      tips.push([e[0], e[1], Math.atan2(e[1] - st.pts[st.pts.length - 2]![1], e[0] - st.pts[st.pts.length - 2]![0])]);
    }
  }
  for (const [x, y, a] of tips) {
    const n = 5 + Math.floor(rand() * 3);
    for (let k = 0; k < n; k++) {
      const ang = a + (k / n) * Math.PI * 2 + rand() * 0.3;
      const fore = 0.55 + 0.45 * Math.abs(Math.sin(ang - a + 1.2));
      smallLeaf(g, x, y, ang, 40 + rand() * 14, 20 + rand() * 6, greens[Math.floor(rand() * 3)]!, 0.78 + rand() * 0.22, 1, rand, { elliptic: true, hair: true, fore });
    }
  }
  g.restore();
}

/** An azalea truss: three funnel flowers (5 cm), five wavy lobes, the top lobe freckled, long curved stamens. White. */
function drawAzaleaFlowers(g: Ctx, ox: number, oy: number, seed: number): void {
  const rand = mulberry32(seed);
  const spots: Array<[number, number, number, number]> = [
    [ox + 92, oy + 100, 74, 0.2],
    [ox + 168, oy + 118, 70, 1.5],
    [ox + 124, oy + 172, 72, 3.2],
  ];
  for (const [cx, cy, R, rot] of spots) {
    g.save();
    g.translate(cx, cy);
    g.rotate(rot);
    // the lobes, back to front
    for (let k = 0; k < 5; k++) {
      g.save();
      g.rotate((k / 5) * Math.PI * 2);
      const w = R * 0.52;
      g.beginPath();
      g.moveTo(0, 0);
      g.bezierCurveTo(R * 0.3, -w * 0.9, R * 0.85, -w * 1.05, R * 0.98, -w * 0.25);
      g.quadraticCurveTo(R * 1.04, 0, R * 0.98, w * 0.25);
      g.bezierCurveTo(R * 0.85, w * 1.05, R * 0.3, w * 0.9, 0, 0);
      const gr = g.createRadialGradient(0, 0, R * 0.05, 0, 0, R);
      gr.addColorStop(0, rgb(170, 160, 168));
      gr.addColorStop(0.3, rgb(226, 222, 226));
      gr.addColorStop(1, rgb(252, 250, 252));
      g.fillStyle = gr;
      g.fill();
      g.strokeStyle = rgb(196, 190, 196, 0.8);
      g.lineWidth = 1.2;
      g.stroke();
      g.strokeStyle = rgb(200, 192, 200, 0.45);
      g.lineWidth = 0.8;
      for (let v = -2; v <= 2; v++) {
        g.beginPath();
        g.moveTo(R * 0.15, 0);
        g.quadraticCurveTo(R * 0.55, v * w * 0.2, R * 0.92, v * w * 0.32);
        g.stroke();
      }
      if (k === 0) {
        // the blotch of freckles on the upper lobe
        for (let i = 0; i < 26; i++) {
          g.fillStyle = rgb(96, 40, 70, 0.55 + rand() * 0.3);
          g.beginPath();
          g.arc(R * (0.18 + rand() * 0.38), (rand() - 0.5) * w * 0.7, 1.2 + rand() * 1.6, 0, Math.PI * 2);
          g.fill();
        }
      }
      g.restore();
    }
    // stamens
    for (let i = 0; i < 7; i++) {
      const a = 0.4 + (i / 6) * 0.9 + rand() * 0.1;
      const l = R * (0.7 + rand() * 0.25);
      g.strokeStyle = rgb(236, 228, 232);
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(0, 0);
      g.quadraticCurveTo(Math.cos(a) * l * 0.6, Math.sin(a) * l * 0.4, Math.cos(a) * l, Math.sin(a) * l);
      g.stroke();
      g.fillStyle = rgb(120, 70, 50);
      g.beginPath();
      g.ellipse(Math.cos(a) * l, Math.sin(a) * l, 2.6, 1.6, a, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }
}

// ─────────────────────────────────────────── flower faces ───────────────────────────────────────────

/** A petal of length R and half width w from the origin along +x: narrow claw, broad, ruffled round blade. */
function bladePath(g: Ctx, R: number, w: number, rand: Rand, ruffle = 0.04): void {
  g.beginPath();
  g.moveTo(0, -w * 0.18);
  g.bezierCurveTo(R * 0.3, -w * 0.5, R * 0.45, -w * 1.05, R * 0.78, -w * 0.98);
  const n = 7;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = -Math.PI / 2 + t * Math.PI;
    const rr = 1 + (rand() - 0.5) * ruffle * 2;
    g.lineTo(R * 0.78 + Math.cos(a) * R * 0.22 * rr, Math.sin(a) * w * 0.98 * rr);
  }
  g.bezierCurveTo(R * 0.45, w * 1.05, R * 0.3, w * 0.5, 0, w * 0.18);
  g.closePath();
}

/**
 * A pansy face (6-7 cm): two upper petals behind, two side petals, the broad lower petal in front, all white (the
 * plant's colour tints them), each darker toward its base; a dark velvety blotch on the lower three feathering out
 * into whiskers, a yellow eye with a white beard.
 */
function drawPansy(g: Ctx, cx: number, cy: number, R: number, rand: Rand): void {
  g.save();
  g.translate(cx, cy);
  const petals: Array<[number, number, number, boolean]> = [
    [-Math.PI / 2 - 0.5, R * 0.96, R * 0.52, false],
    [-Math.PI / 2 + 0.5, R * 0.96, R * 0.52, false],
    [Math.PI + 0.32, R * 0.86, R * 0.44, true],
    [-0.32, R * 0.86, R * 0.44, true],
    [Math.PI / 2, R * 0.9, R * 0.6, true],
  ];
  for (const [a, L, w, blotch] of petals) {
    g.save();
    g.rotate(a);
    bladePath(g, L, w, rand, 0.035);
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, L);
    gr.addColorStop(0, rgb(205, 205, 205));
    gr.addColorStop(0.45, rgb(244, 244, 244));
    gr.addColorStop(0.9, rgb(252, 252, 252));
    gr.addColorStop(1, rgb(236, 236, 236));
    g.fillStyle = gr;
    g.fill();
    // fine lengthwise texture (velvet)
    g.save();
    g.clip();
    g.strokeStyle = rgb(210, 210, 210, 0.35);
    g.lineWidth = 0.7;
    for (let v = -8; v <= 8; v++) {
      g.beginPath();
      g.moveTo(L * 0.1, 0);
      g.quadraticCurveTo(L * 0.5, (v / 8) * w * 0.6, L, (v / 8) * w * 1.1);
      g.stroke();
    }
    if (blotch) {
      const gb = g.createRadialGradient(0, 0, 0, 0, 0, L * 0.62);
      gb.addColorStop(0, rgb(28, 14, 34, 0.98));
      gb.addColorStop(0.55, rgb(36, 18, 44, 0.92));
      gb.addColorStop(0.85, rgb(50, 26, 60, 0.35));
      gb.addColorStop(1, rgb(60, 30, 70, 0));
      g.fillStyle = gb;
      g.fillRect(0, -w * 1.2, L, w * 2.4);
      // whiskers past the blotch
      g.strokeStyle = rgb(40, 20, 50, 0.75);
      g.lineWidth = 1.1;
      for (let v = -3; v <= 3; v++) {
        g.beginPath();
        g.moveTo(L * 0.3, v * w * 0.1);
        g.quadraticCurveTo(L * 0.55, v * w * 0.2, L * (0.66 + rand() * 0.1), v * w * 0.3);
        g.stroke();
      }
    }
    g.restore();
    g.strokeStyle = rgb(196, 196, 196, 0.7);
    g.lineWidth = 1;
    bladePath(g, L, w, mulberry32(1), 0);
    g.stroke();
    g.restore();
  }
  // the eye: a yellow wedge on the lower petal, white beard hairs either side
  g.fillStyle = rgb(246, 196, 30);
  g.beginPath();
  g.moveTo(-R * 0.07, -R * 0.02);
  g.lineTo(R * 0.07, -R * 0.02);
  g.lineTo(0, R * 0.12);
  g.closePath();
  g.fill();
  g.fillStyle = rgb(250, 250, 240);
  for (const sx of [-1, 1]) {
    g.beginPath();
    g.ellipse(sx * R * 0.1, R * 0.01, R * 0.05, R * 0.03, sx * 0.4, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = rgb(60, 110, 40);
  g.beginPath();
  g.arc(0, -R * 0.02, R * 0.025, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

/**
 * A petunia trumpet from the front (6-7 cm): five fused lobes (a rounded pentagon, each lobe with a small point),
 * a softly ruffled rim, white shading to grey down into the throat; the veins net-like and strongest in the throat
 * (the dark star there), fading out over the lobes; a yellowish throat.
 */
function drawPetunia(g: Ctx, cx: number, cy: number, R: number, rand: Rand): void {
  g.save();
  g.translate(cx, cy);
  const outline = () => {
    g.beginPath();
    const n = 160;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const lobe = Math.cos(5 * a);
      const r = R * (0.9 + 0.075 * lobe + 0.03 * Math.max(0, lobe) ** 16 + 0.01 * Math.sin(29 * a));
      if (i === 0) g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.closePath();
  };
  outline();
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, R);
  gr.addColorStop(0, rgb(110, 104, 60));
  gr.addColorStop(0.08, rgb(150, 144, 110));
  gr.addColorStop(0.2, rgb(205, 202, 206));
  gr.addColorStop(0.45, rgb(242, 242, 244));
  gr.addColorStop(0.9, rgb(252, 252, 252));
  gr.addColorStop(1, rgb(238, 238, 240));
  g.fillStyle = gr;
  g.fill();
  g.save();
  g.clip();
  // the veins: main ones to the lobe tips and between them, a fine net branching off, all fading outward
  const vein = (x0: number, y0: number, a0: number, len: number, w: number, alpha: number, depth: number) => {
    let x = x0;
    let y = y0;
    let a = a0;
    const steps = 14;
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      const nx = x + Math.cos(a) * (len / steps);
      const ny = y + Math.sin(a) * (len / steps);
      const r = Math.hypot(nx, ny) / R;
      g.strokeStyle = rgb(70, 40, 80, alpha * Math.max(0, 1 - r * 1.15));
      g.lineWidth = w * (1 - t * 0.6);
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(nx, ny);
      g.stroke();
      x = nx;
      y = ny;
      a += (rand() - 0.5) * 0.16;
      if (depth > 0 && rand() < 0.22) vein(x, y, a + (rand() < 0.5 ? -1 : 1) * (0.45 + rand() * 0.3), len * (1 - t) * 0.5, w * 0.55, alpha * 0.8, depth - 1);
    }
  };
  for (let k = 0; k < 10; k++) vein(0, 0, (k / 10) * Math.PI * 2 + (rand() - 0.5) * 0.05, R * (k % 2 ? 0.75 : 0.9), k % 2 ? 1.6 : 2.6, k % 2 ? 0.45 : 0.75, 2);
  // the throat's dark star
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    const gs = g.createLinearGradient(0, 0, Math.cos(a) * R * 0.35, Math.sin(a) * R * 0.35);
    gs.addColorStop(0, rgb(60, 30, 70, 0.55));
    gs.addColorStop(1, rgb(60, 30, 70, 0));
    g.fillStyle = gs;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(Math.cos(a - 0.22) * R * 0.35, Math.sin(a - 0.22) * R * 0.35);
    g.lineTo(Math.cos(a + 0.22) * R * 0.35, Math.sin(a + 0.22) * R * 0.35);
    g.closePath();
    g.fill();
  }
  // soft ruffles at the rim
  for (let i = 0; i < 60; i++) {
    const a = rand() * Math.PI * 2;
    const gw = g.createLinearGradient(Math.cos(a) * R * 0.6, Math.sin(a) * R * 0.6, Math.cos(a) * R, Math.sin(a) * R);
    const light = rand() < 0.5;
    const c = light ? 255 : 120;
    gw.addColorStop(0, rgb(c, c, c + (light ? 0 : 10), 0));
    gw.addColorStop(1, rgb(c, c, c + (light ? 0 : 10), light ? 0.3 : 0.14));
    g.strokeStyle = gw;
    g.lineWidth = 4 + rand() * 5;
    g.beginPath();
    g.moveTo(Math.cos(a) * R * 0.6, Math.sin(a) * R * 0.6);
    g.lineTo(Math.cos(a) * R, Math.sin(a) * R);
    g.stroke();
  }
  g.restore();
  const gt = g.createRadialGradient(0, 0, 0, 0, 0, R * 0.1);
  gt.addColorStop(0, rgb(80, 74, 30));
  gt.addColorStop(1, rgb(150, 140, 90, 0));
  g.fillStyle = gt;
  g.beginPath();
  g.arc(0, 0, R * 0.1, 0, Math.PI * 2);
  g.fill();
  outline();
  g.strokeStyle = rgb(205, 205, 210, 0.85);
  g.lineWidth = 1.2;
  g.stroke();
  g.restore();
}

/**
 * A marigold head from above (4-6 cm): seven rings of broad, crinkled ray florets overlapping like a pompom, each
 * fanning out to a wavy rounded edge, shaded into the folds between them (white: the plant's yellow or orange tints
 * them), the inner rings smaller and darker, a few disc florets at the heart.
 */
function drawMarigold(g: Ctx, cx: number, cy: number, R: number, rand: Rand): void {
  g.save();
  g.translate(cx, cy);
  g.fillStyle = rgb(150, 140, 120);
  g.beginPath();
  g.arc(0, 0, R * 0.9, 0, Math.PI * 2);
  g.fill();
  const rings: Array<[number, number, number]> = [
    [1.0, 15, 0.34],
    [0.86, 14, 0.3],
    [0.72, 13, 0.27],
    [0.58, 11, 0.24],
    [0.44, 9, 0.2],
    [0.3, 7, 0.17],
    [0.17, 5, 0.13],
  ];
  rings.forEach(([rr, n, len], ri) => {
    const off = rand() * 6.28;
    const k = 1 - ri * 0.045;
    for (let i = 0; i < n; i++) {
      const a = off + (i / n) * Math.PI * 2 + (rand() - 0.5) * 0.18;
      const L = R * len * (0.9 + rand() * 0.2);
      const w = ((R * rr * Math.PI) / n) * 0.78;
      g.save();
      g.rotate(a);
      g.translate(R * rr - L, 0);
      g.beginPath();
      g.moveTo(0, -w * 0.3);
      g.quadraticCurveTo(L * 0.45, -w * 1.1, L * 0.86, -w * 0.95);
      const m = 9;
      for (let j = 0; j <= m; j++) {
        const t = j / m;
        const ang = -Math.PI / 2 + t * Math.PI;
        const wav = 1 + 0.07 * Math.sin(t * Math.PI * 4 + rand());
        g.lineTo(L * 0.86 + Math.cos(ang) * L * 0.14 * wav, Math.sin(ang) * w * 0.95 * wav);
      }
      g.quadraticCurveTo(L * 0.45, w * 1.1, 0, w * 0.3);
      g.closePath();
      const gr = g.createLinearGradient(0, 0, L, 0);
      gr.addColorStop(0, shade([160, 150, 135], k));
      gr.addColorStop(0.45, shade([232, 230, 226], k));
      gr.addColorStop(0.85, shade([252, 252, 250], k));
      gr.addColorStop(1, shade([236, 234, 230], k));
      g.fillStyle = gr;
      g.fill();
      // crinkles: light and dark creases fanning out
      for (let c = -2; c <= 2; c++) {
        g.strokeStyle = c % 2 ? rgb(255, 255, 255, 0.35) : rgb(140, 130, 120, 0.32);
        g.lineWidth = 1.1;
        g.beginPath();
        g.moveTo(L * 0.35, c * w * 0.15);
        g.quadraticCurveTo(L * 0.7, c * w * 0.3 + (rand() - 0.5) * 3, L * 0.97, c * w * 0.42);
        g.stroke();
      }
      g.strokeStyle = rgb(170, 160, 150, 0.55);
      g.lineWidth = 0.9;
      g.beginPath();
      g.moveTo(0, -w * 0.3);
      g.quadraticCurveTo(L * 0.45, -w * 1.1, L * 0.86, -w * 0.95);
      g.stroke();
      g.restore();
    }
  });
  for (let i = 0; i < 14; i++) {
    const r = Math.sqrt(rand()) * R * 0.07;
    const a = rand() * 6.28;
    g.fillStyle = rgb(200, 185, 130);
    g.beginPath();
    g.arc(Math.cos(a) * r, Math.sin(a) * r, R * 0.02, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

/**
 * Grape-hyacinth bells, tiling across (u wraps round the spike): rows of urn-shaped bells hanging down, packed, each
 * shaded round with a pale constricted mouth; the top rows (v 0: the spike's tip) smaller and paler (the sterile
 * buds). Opaque: the spike's tube is behind every texel.
 */
function drawMuscari(g: Ctx, ox: number, oy: number, rand: Rand): void {
  g.save();
  g.beginPath();
  g.rect(ox, oy, CELL, CELL);
  g.clip();
  g.fillStyle = rgb(60, 60, 82);
  g.fillRect(ox, oy, CELL, CELL);
  const rows = 11;
  const cols = 5;
  for (let r = 0; r < rows; r++) {
    const t = r / (rows - 1); // 0 tip .. 1 base
    const size = 0.6 + 0.4 * Math.min(1, t * 1.6);
    const pale = 1 - Math.min(1, t * 2.4);
    for (let c = -1; c <= cols; c++) {
      const x = ox + ((c + (r % 2) * 0.5 + (rand() - 0.5) * 0.1) / cols) * CELL;
      const y = oy + 10 + t * (CELL - 26);
      const w = (CELL / cols) * 0.46 * size;
      const h = (CELL / rows) * 0.95 * size;
      const top = lerp3([222, 222, 232], [252, 252, 255], pale);
      // the urn: round shoulders, narrowing to the mouth
      g.beginPath();
      g.moveTo(x - w * 0.55, y - h * 0.55);
      g.bezierCurveTo(x - w * 1.1, y - h * 0.1, x - w * 0.9, y + h * 0.55, x - w * 0.35, y + h * 0.62);
      g.lineTo(x + w * 0.35, y + h * 0.62);
      g.bezierCurveTo(x + w * 0.9, y + h * 0.55, x + w * 1.1, y - h * 0.1, x + w * 0.55, y - h * 0.55);
      g.quadraticCurveTo(x, y - h * 0.8, x - w * 0.55, y - h * 0.55);
      g.closePath();
      const gr = g.createRadialGradient(x - w * 0.35, y - h * 0.2, w * 0.1, x, y, w * 1.15);
      gr.addColorStop(0, rgb(Math.min(255, top[0] + 12), Math.min(255, top[1] + 12), Math.min(255, top[2] + 12)));
      gr.addColorStop(0.55, rgb(top[0] * 0.84, top[1] * 0.84, top[2] * 0.87));
      gr.addColorStop(1, rgb(top[0] * 0.5, top[1] * 0.5, top[2] * 0.56));
      g.fillStyle = gr;
      g.fill();
      g.fillStyle = rgb(250, 250, 252, 0.85 - pale * 0.4);
      g.beginPath();
      g.ellipse(x, y + h * 0.62, w * 0.36, h * 0.12, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.restore();
}

// ─────────────────────────────────────────── leaves ───────────────────────────────────────────

/**
 * A big leaf filling the cell, base at the bottom middle, tip at the top: `scallop` > 0 crenate margin (pansy), the
 * midrib and pinnate side veins paler, the margin a little darker, fine speckle (no flat colour).
 */
function drawBigLeaf(g: Ctx, ox: number, oy: number, base: readonly [number, number, number], scallop: number, widthK: number, rand: Rand, fuzzy: boolean): void {
  const L = CELL - 24;
  const bx = ox + CELL / 2;
  const by = oy + CELL - 8;
  const half = (t: number) => (CELL * widthK) * Math.sin(Math.PI * Math.min(1, t ** 0.85)) ** 0.8;
  const path = () => {
    g.beginPath();
    g.moveTo(bx, by);
    const n = 60;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const s = scallop * Math.abs(Math.sin(t * Math.PI * 7));
      g.lineTo(bx - half(t) * (1 - s), by - L * t);
    }
    for (let i = n; i >= 0; i--) {
      const t = i / n;
      const s = scallop * Math.abs(Math.sin(t * Math.PI * 7 + 0.4));
      g.lineTo(bx + half(t) * (1 - s), by - L * t);
    }
    g.closePath();
  };
  g.save();
  path();
  const gr = g.createLinearGradient(bx - CELL * widthK, 0, bx + CELL * widthK, 0);
  gr.addColorStop(0, shade(base, 1.12));
  gr.addColorStop(0.48, shade(base, 1.0));
  gr.addColorStop(0.52, shade(base, 0.88));
  gr.addColorStop(1, shade(base, 0.78));
  g.fillStyle = gr;
  g.fill();
  g.clip();
  const gl = g.createLinearGradient(0, by, 0, by - L);
  gl.addColorStop(0, rgb(15, 30, 8, 0.35));
  gl.addColorStop(0.3, rgb(15, 30, 8, 0));
  gl.addColorStop(1, rgb(220, 235, 180, 0.12));
  g.fillStyle = gl;
  g.fillRect(ox, oy, CELL, CELL);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = rand() < 0.5 ? rgb(255, 255, 220, 0.06) : rgb(0, 20, 0, 0.08);
    g.fillRect(ox + rand() * CELL, oy + rand() * CELL, 2, 2);
  }
  // veins
  g.strokeStyle = shade(lerp3(base, [235, 245, 200], 0.45), 1, 0.75);
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(bx, by);
  g.quadraticCurveTo(bx + 4, by - L * 0.5, bx, by - L * 0.97);
  g.stroke();
  g.lineWidth = 1.4;
  for (let k = 1; k <= 6; k++) {
    const t = k / 7.5;
    for (const side of [-1, 1]) {
      g.beginPath();
      g.moveTo(bx, by - L * t);
      g.quadraticCurveTo(bx + side * half(t) * 0.5, by - L * (t + 0.05), bx + side * half(t + 0.08) * 0.92, by - L * (t + 0.13));
      g.stroke();
    }
  }
  g.restore();
  path();
  g.strokeStyle = fuzzy ? shade(lerp3(base, [220, 230, 200], 0.5), 1, 0.6) : shade(base, 0.6, 0.8);
  g.lineWidth = fuzzy ? 2.5 : 1.5;
  g.stroke();
}

/** A marigold frond: a rachis with 7 pairs of narrow toothed leaflets, dark green, base at the bottom middle. */
function drawFrond(g: Ctx, ox: number, oy: number, rand: Rand): void {
  const bx = ox + CELL / 2;
  const by = oy + CELL - 8;
  const L = CELL - 20;
  const col: [number, number, number] = [52, 92, 36];
  g.strokeStyle = rgb(70, 110, 50);
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(bx, by);
  g.quadraticCurveTo(bx + 6, by - L * 0.5, bx, by - L);
  g.stroke();
  for (let k = 0; k < 8; k++) {
    const t = 0.12 + k * 0.11;
    const ll = (k === 7 ? 0.24 : 0.38 - k * 0.025) * CELL;
    for (const side of k === 7 ? [0] : [-1, 1]) {
      g.save();
      g.translate(bx + (side ? 0 : 0), by - L * t);
      g.rotate(side === 0 ? -Math.PI / 2 : -Math.PI / 2 + side * (1.0 - k * 0.05));
      const w = ll * 0.17;
      g.beginPath();
      g.moveTo(0, 0);
      const n = 10;
      for (let i = 1; i <= n; i++) {
        const tt = i / n;
        const tooth = i % 2 ? 1 : 0.55;
        g.lineTo(ll * tt, -w * Math.sin(Math.PI * Math.min(1, tt * 1.05)) * tooth);
      }
      for (let i = n; i >= 0; i--) {
        const tt = i / n;
        const tooth = i % 2 ? 1 : 0.55;
        g.lineTo(ll * tt, w * Math.sin(Math.PI * Math.min(1, tt * 1.05)) * tooth);
      }
      g.closePath();
      const gr = g.createLinearGradient(0, -w, 0, w);
      gr.addColorStop(0, shade(col, 1.15 + rand() * 0.1));
      gr.addColorStop(1, shade(col, 0.75));
      g.fillStyle = gr;
      g.fill();
      g.strokeStyle = shade(col, 1.5, 0.5);
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(ll * 0.9, 0);
      g.stroke();
      g.restore();
    }
  }
}

/**
 * Bark-chip mulch: an irregular patch (alpha), dark soil showing between 120-odd chips of shredded pine bark (2-4 cm:
 * 12-24 px on a 42 cm patch), each a flat splinter with a lit upper edge and a shadow below.
 */
function drawMulch(g: Ctx, ox: number, oy: number, rand: Rand): void {
  const cx = ox + CELL / 2;
  const cy = oy + CELL / 2;
  const R = CELL * 0.47;
  const rim: number[] = [];
  for (let i = 0; i < 48; i++) rim.push(0.82 + rand() * 0.18);
  const blob = () => {
    g.beginPath();
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const r = R * rim[i % 48]!;
      if (i === 0) g.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      else g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    g.closePath();
  };
  g.save();
  blob();
  g.fillStyle = rgb(48, 34, 24);
  g.fill();
  g.clip();
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = rand() < 0.5 ? rgb(70, 52, 38, 0.5) : rgb(30, 22, 16, 0.5);
    g.fillRect(ox + rand() * CELL, oy + rand() * CELL, 2, 2);
  }
  const browns: Array<[number, number, number]> = [
    [112, 76, 48],
    [128, 92, 60],
    [96, 64, 40],
    [140, 104, 70],
    [84, 56, 36],
    [150, 116, 82],
  ];
  for (let i = 0; i < 150; i++) {
    const x = cx + (rand() - 0.5) * CELL * 0.95;
    const y = cy + (rand() - 0.5) * CELL * 0.95;
    const L = 10 + rand() * 16;
    const W = 4 + rand() * 6;
    const a = rand() * Math.PI;
    const c = browns[Math.floor(rand() * browns.length)]!;
    g.save();
    g.translate(x, y);
    g.rotate(a);
    // shadow, chip, lit edge
    g.fillStyle = rgb(20, 14, 10, 0.55);
    g.beginPath();
    g.ellipse(1.5, 2, L / 2, W / 2, 0, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.moveTo(-L / 2, -W * 0.3);
    g.lineTo(-L * 0.2, -W / 2);
    g.lineTo(L / 2, -W * 0.2);
    g.lineTo(L * 0.4, W / 2);
    g.lineTo(-L * 0.45, W * 0.35);
    g.closePath();
    g.fillStyle = shade(c, 0.85 + rand() * 0.3);
    g.fill();
    g.strokeStyle = shade(c, 1.35, 0.6);
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(-L / 2, -W * 0.3);
    g.lineTo(-L * 0.2, -W / 2);
    g.lineTo(L / 2, -W * 0.2);
    g.stroke();
    g.restore();
  }
  g.restore();
}

/** A tulip petal (opaque): white with faint streaks, a greenish-yellow base. v 0 is the tip, v 1 the base. */
function drawTulip(g: Ctx, ox: number, oy: number, rand: Rand): void {
  const gr = g.createLinearGradient(0, oy + CELL, 0, oy);
  gr.addColorStop(0, rgb(170, 175, 110));
  gr.addColorStop(0.25, rgb(225, 225, 205));
  gr.addColorStop(0.6, rgb(250, 250, 250));
  gr.addColorStop(1, rgb(240, 240, 240));
  g.fillStyle = gr;
  g.fillRect(ox, oy, CELL, CELL);
  for (let i = 0; i < 70; i++) {
    const x = ox + rand() * CELL;
    g.strokeStyle = rand() < 0.5 ? rgb(255, 255, 255, 0.35) : rgb(190, 190, 195, 0.3);
    g.lineWidth = 1 + rand() * 2;
    g.beginPath();
    g.moveTo(x, oy + CELL);
    g.quadraticCurveTo(x + (rand() - 0.5) * 20, oy + CELL / 2, x + (rand() - 0.5) * 30, oy);
    g.stroke();
  }
}

/** A strap leaf (opaque): parallel veins, darker base, a faint bloom. */
function drawStrap(g: Ctx, ox: number, oy: number, rand: Rand): void {
  const gr = g.createLinearGradient(0, oy + CELL, 0, oy);
  gr.addColorStop(0, rgb(150, 160, 150));
  gr.addColorStop(0.3, rgb(225, 235, 220));
  gr.addColorStop(1, rgb(250, 255, 245));
  g.fillStyle = gr;
  g.fillRect(ox, oy, CELL, CELL);
  for (let i = 0; i < 26; i++) {
    const x = ox + (i / 26) * CELL + rand() * 4;
    g.strokeStyle = i % 2 ? rgb(200, 210, 195, 0.6) : rgb(255, 255, 250, 0.5);
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x, oy);
    g.lineTo(x, oy + CELL);
    g.stroke();
  }
  // the keel: darker in the middle of the strap
  const gk = g.createLinearGradient(ox, 0, ox + CELL, 0);
  gk.addColorStop(0, rgb(0, 0, 0, 0.12));
  gk.addColorStop(0.5, rgb(0, 0, 0, 0));
  gk.addColorStop(1, rgb(0, 0, 0, 0.2));
  g.fillStyle = gk;
  g.fillRect(ox, oy, CELL, CELL);
}

// ─────────────────────────────────────────── the atlas ───────────────────────────────────────────

/** Draw the atlas on a canvas (1024 x 1024). */
export function drawPlantAtlas(canvas: HTMLCanvasElement | OffscreenCanvas): void {
  const size = CELL * PLANT_GRID;
  canvas.width = size;
  canvas.height = size;
  // the same 2D calls on a page canvas and an OffscreenCanvas
  const g = canvas.getContext("2d") as CanvasRenderingContext2D | null;
  if (!g) return;
  g.clearRect(0, 0, size, size);
  const at = (cell: number) => [(cell % PLANT_GRID) * CELL, Math.floor(cell / PLANT_GRID) * CELL] as const;
  const rand = mulberry32(20261116);
  const cellDo = (cell: number, f: (ox: number, oy: number) => void) => {
    const [ox, oy] = at(cell);
    g.save();
    g.beginPath();
    g.rect(ox, oy, CELL, CELL);
    g.clip();
    f(ox, oy);
    g.restore();
  };
  cellDo(PLANT_CELL.boxA, (x, y) => drawBoxwood(g, x, y, 101, false));
  cellDo(PLANT_CELL.boxB, (x, y) => drawBoxwood(g, x, y, 202, false));
  cellDo(PLANT_CELL.boxIn, (x, y) => drawBoxwood(g, x, y, 303, true));
  cellDo(PLANT_CELL.azSprig, (x, y) => drawAzaleaSprig(g, x, y, 404));
  cellDo(PLANT_CELL.azFlower, (x, y) => drawAzaleaFlowers(g, x, y, 505));
  cellDo(PLANT_CELL.pansy, (x, y) => drawPansy(g, x + CELL / 2, y + CELL * 0.5, CELL * 0.45, rand));
  cellDo(PLANT_CELL.petunia, (x, y) => drawPetunia(g, x + CELL / 2, y + CELL / 2, CELL * 0.48, rand));
  cellDo(PLANT_CELL.marigold, (x, y) => drawMarigold(g, x + CELL / 2, y + CELL / 2, CELL * 0.48, rand));
  cellDo(PLANT_CELL.muscari, (x, y) => drawMuscari(g, x, y, rand));
  cellDo(PLANT_CELL.leafPansy, (x, y) => drawBigLeaf(g, x, y, [62, 110, 40], 0.07, 0.36, rand, false));
  cellDo(PLANT_CELL.leafPetunia, (x, y) => drawBigLeaf(g, x, y, [84, 128, 52], 0, 0.3, rand, true));
  cellDo(PLANT_CELL.leafMarigold, (x, y) => drawFrond(g, x, y, rand));
  cellDo(PLANT_CELL.mulch, (x, y) => drawMulch(g, x, y, rand));
  cellDo(PLANT_CELL.solid, (x, y) => {
    g.fillStyle = "#ffffff";
    g.fillRect(x, y, CELL, CELL);
  });
  cellDo(PLANT_CELL.tulip, (x, y) => drawTulip(g, x, y, rand));
  cellDo(PLANT_CELL.strap, (x, y) => drawStrap(g, x, y, rand));
}

/**
 * Bleed the colour of the drawn texels into the cut-away ones (alpha kept): `passes` rounds of a 3 x 3 dilation, the
 * rest filled with the cell's mean colour, so a mipmapped edge fades into its own colour, not black.
 */
export function bleedColour(px: Uint8ClampedArray | Uint8Array, w: number, h: number, passes = 8): void {
  const solid = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) solid[i] = px[i * 4 + 3]! > 16 ? 1 : 0;
  for (let p = 0; p < passes; p++) {
    const next = solid.slice();
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (solid[i]) continue;
        let r = 0;
        let gg = 0;
        let b = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            const j = yy * w + xx;
            if (!solid[j]) continue;
            r += px[j * 4]!;
            gg += px[j * 4 + 1]!;
            b += px[j * 4 + 2]!;
            n++;
          }
        if (n) {
          px[i * 4] = r / n;
          px[i * 4 + 1] = gg / n;
          px[i * 4 + 2] = b / n;
          next[i] = 1;
        }
      }
    solid.set(next);
  }
}

/** The atlas as a texture (sRGB, mipmapped). Null where there is no DOM (tests). */
/**
 * The atlas's pixels (drawn and colour-bled), on a page canvas or an OffscreenCanvas (the vegetation worker draws it
 * there while the page lays the village out: perf/no-hitch, about a second of a slow phone's arrival), or null.
 */
export function plantAtlasPixels(): { data: Uint8Array; width: number; height: number } | null {
  const canvas: HTMLCanvasElement | OffscreenCanvas | null =
    typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(1, 1) : typeof document !== "undefined" ? document.createElement("canvas") : null;
  if (!canvas) return null;
  drawPlantAtlas(canvas);
  const g = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!g) return null;
  const img = g.getImageData(0, 0, canvas.width, canvas.height);
  bleedColour(img.data, canvas.width, canvas.height);
  return { data: new Uint8Array(img.data.buffer), width: canvas.width, height: canvas.height };
}

/** The atlas as a texture, from pixels made here or (`pixels`) by the worker. */
export function makePlantAtlas(pixels: { data: Uint8Array; width: number; height: number } | null = typeof document === "undefined" ? null : plantAtlasPixels()): Texture | null {
  if (!pixels) return null;
  const t = new DataTexture(pixels.data, pixels.width, pixels.height, RGBAFormat, UnsignedByteType);
  t.colorSpace = SRGBColorSpace;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.flipY = false;
  t.needsUpdate = true;
  return t;
}

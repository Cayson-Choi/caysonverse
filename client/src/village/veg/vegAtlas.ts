import { CanvasTexture, LinearMipmapLinearFilter, SRGBColorSpace, type Texture } from "three";
import { ATLAS_CELL, ATLAS_GRID } from "./vegGeometry";
import { mulberry32 } from "./vegRandom";

/**
 * The blossom atlas (veg3d): drawn at runtime on a canvas, so it is ours (no photo, no third-party texture, nothing to
 * license). 4 x 4 cells of 128 px:
 *  - two open cherry flowers (Somei-yoshino: five white petals with a notch at the tip, flushed pale pink at the
 *    base, a red-pink eye, a ring of stamens with yellow anthers), drawn face on: the bunch mesh cups them;
 *  - a pink bud; a solid white cell (pedicels and anything untextured);
 *  - two bunch pictures (20-odd flowers at many angles round a spur, the back ones darker), for the far sprites.
 * Alpha is the flower's outline: the material cuts it (alpha test; there is no MSAA in the post chain, so no
 * alpha-to-coverage).
 */

const CELL = 128;

type Ctx = CanvasRenderingContext2D;

function petalPath(g: Ctx, R: number, w: number): void {
  g.beginPath();
  g.moveTo(0, 0);
  g.bezierCurveTo(R * 0.25, -w * 0.95, R * 0.72, -w * 1.2, R * 0.97, -w * 0.38);
  g.quadraticCurveTo(R * 0.93, -w * 0.08, R * 0.84, 0);
  g.quadraticCurveTo(R * 0.93, w * 0.08, R * 0.97, w * 0.38);
  g.bezierCurveTo(R * 0.72, w * 1.2, R * 0.25, w * 0.95, 0, 0);
  g.closePath();
}

/**
 * One open cherry flower at (cx, cy), radius R, rotated by `rot`, squashed by `squash` along one axis (a flower seen
 * at an angle), `shade` darkening it (the back of a bunch), `pink` how pink its base flush is.
 */
export function drawCherryFlower(g: Ctx, cx: number, cy: number, R: number, rot: number, squash: number, shade: number, pink: number, rand: () => number): void {
  g.save();
  g.translate(cx, cy);
  g.rotate(rot);
  g.scale(1, squash);
  const sh = (r: number, gg: number, b: number, a = 1) => `rgba(${Math.round(r * shade)},${Math.round(gg * shade)},${Math.round(b * shade)},${a})`;
  for (let k = 0; k < 5; k++) {
    g.save();
    g.rotate(-Math.PI / 2 + (k * 2 * Math.PI) / 5 + (rand() - 0.5) * 0.12);
    const w = R * (0.36 + rand() * 0.05);
    petalPath(g, R, w);
    const grad = g.createRadialGradient(0, 0, R * 0.05, 0, 0, R);
    grad.addColorStop(0, sh(232, 150 + 40 * (1 - pink), 178 + 30 * (1 - pink)));
    grad.addColorStop(0.32, sh(250, 222, 230));
    grad.addColorStop(0.7, sh(255, 248, 250));
    grad.addColorStop(1, sh(255, 252, 252));
    g.fillStyle = grad;
    g.fill();
    g.lineWidth = Math.max(0.6, R * 0.025);
    g.strokeStyle = sh(226, 196, 206, 0.9);
    g.stroke();
    // faint veins
    g.strokeStyle = sh(228, 182, 198, 0.35);
    g.lineWidth = Math.max(0.4, R * 0.012);
    for (let v = -2; v <= 2; v++) {
      g.beginPath();
      g.moveTo(R * 0.12, 0);
      g.quadraticCurveTo(R * 0.5, v * w * 0.18, R * 0.85, v * w * 0.3);
      g.stroke();
    }
    g.restore();
  }
  // the eye and the stamens
  g.fillStyle = sh(196, 70, 98);
  g.beginPath();
  g.arc(0, 0, R * 0.13, 0, Math.PI * 2);
  g.fill();
  const n = 18;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rand() * 0.2;
    const l = R * (0.26 + rand() * 0.1);
    g.strokeStyle = sh(246, 236, 214, 0.95);
    g.lineWidth = Math.max(0.5, R * 0.018);
    g.beginPath();
    g.moveTo(Math.cos(a) * R * 0.06, Math.sin(a) * R * 0.06);
    g.lineTo(Math.cos(a) * l, Math.sin(a) * l);
    g.stroke();
    g.fillStyle = sh(232, 168, 52);
    g.beginPath();
    g.arc(Math.cos(a) * l, Math.sin(a) * l, Math.max(0.8, R * 0.035), 0, Math.PI * 2);
    g.fill();
  }
  // the style
  g.fillStyle = sh(214, 226, 160);
  g.beginPath();
  g.arc(0, 0, R * 0.045, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

function drawBud(g: Ctx, cx: number, cy: number, R: number): void {
  g.save();
  g.translate(cx, cy);
  const grad = g.createRadialGradient(-R * 0.2, -R * 0.3, R * 0.1, 0, 0, R);
  grad.addColorStop(0, "rgb(250,196,212)");
  grad.addColorStop(0.7, "rgb(232,128,160)");
  grad.addColorStop(1, "rgb(196,88,120)");
  g.fillStyle = grad;
  g.beginPath();
  g.ellipse(0, -R * 0.1, R * 0.62, R * 0.85, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "rgb(120,74,52)";
  g.beginPath();
  g.ellipse(0, R * 0.62, R * 0.36, R * 0.28, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

function drawBunch(g: Ctx, cx: number, cy: number, S: number, seed: number): void {
  const rand = mulberry32(seed);
  // a few dark twig pieces first
  g.strokeStyle = "rgba(70,52,44,0.95)";
  g.lineCap = "round";
  for (let i = 0; i < 3; i++) {
    g.lineWidth = 2 + rand() * 1.5;
    g.beginPath();
    const a = rand() * Math.PI * 2;
    g.moveTo(cx + Math.cos(a) * S * 0.45, cy + Math.sin(a) * S * 0.45);
    g.quadraticCurveTo(cx + (rand() - 0.5) * S * 0.2, cy + (rand() - 0.5) * S * 0.2, cx + Math.cos(a + 2.6) * S * 0.2, cy + Math.sin(a + 2.6) * S * 0.2);
    g.stroke();
  }
  // flowers from back (dark, small) to front (bright)
  const n = 24;
  const fl: Array<[number, number, number, number, number, number]> = [];
  for (let i = 0; i < n; i++) {
    const r = Math.sqrt(rand()) * S * 0.36;
    const a = rand() * Math.PI * 2;
    const depth = rand();
    fl.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.92, S * (0.1 + 0.035 * depth + rand() * 0.02), depth, rand() * 6.28, 0.5 + 0.5 * rand()]);
  }
  fl.sort((p, q) => p[3] - q[3]);
  for (const [x, y, R, depth, rot, squash] of fl) drawCherryFlower(g, x, y, R, rot, squash, 0.72 + 0.28 * depth, 0.5 + 0.5 * rand(), rand);
  // two buds peeking out
  for (let i = 0; i < 2; i++) {
    const a = rand() * Math.PI * 2;
    drawBud(g, cx + Math.cos(a) * S * 0.38, cy + Math.sin(a) * S * 0.38, S * 0.05);
  }
}

/** Draw the atlas on a canvas (512 x 512). */
export function drawBlossomAtlas(canvas: HTMLCanvasElement): void {
  const size = CELL * ATLAS_GRID;
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext("2d");
  if (!g) return;
  g.clearRect(0, 0, size, size);
  const origin = (cell: number) => [(cell % ATLAS_GRID) * CELL, Math.floor(cell / ATLAS_GRID) * CELL] as const;
  const rand = mulberry32(424242);
  {
    const [x, y] = origin(ATLAS_CELL.flowerA);
    drawCherryFlower(g, x + CELL / 2, y + CELL / 2, CELL * 0.44, 0.1, 1, 1, 0.45, rand);
  }
  {
    const [x, y] = origin(ATLAS_CELL.flowerB);
    drawCherryFlower(g, x + CELL / 2, y + CELL / 2, CELL * 0.44, 0.7, 1, 0.97, 1, rand);
  }
  {
    const [x, y] = origin(ATLAS_CELL.bud);
    drawBud(g, x + CELL / 2, y + CELL / 2, CELL * 0.4);
  }
  {
    const [x, y] = origin(ATLAS_CELL.solid);
    g.fillStyle = "#ffffff";
    g.fillRect(x, y, CELL, CELL);
  }
  for (const [cell, seed] of [
    [ATLAS_CELL.bunchA, 11],
    [ATLAS_CELL.bunchB, 23],
  ] as const) {
    const [x, y] = origin(cell);
    g.save();
    g.beginPath();
    g.rect(x + 3, y + 3, CELL - 6, CELL - 6);
    g.clip();
    drawBunch(g, x + CELL / 2, y + CELL / 2, CELL, seed);
    g.restore();
  }
}

/** The atlas as a texture (sRGB, mipmapped). Null where there is no DOM (tests). */
export function makeBlossomAtlas(): Texture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  drawBlossomAtlas(canvas);
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.minFilter = LinearMipmapLinearFilter;
  t.anisotropy = 4;
  t.flipY = false;
  t.needsUpdate = true;
  return t;
}

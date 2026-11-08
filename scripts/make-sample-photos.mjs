/**
 * scripts/make-sample-photos.mjs — the memorial hall's placeholder pet portraits (케이슨 마을 1단계 Task 9).
 *
 *   node scripts/make-sample-photos.mjs
 *
 * Draws 16 soft illustrated portraits (dogs and cats of different coats, on warm pastel backdrops) on a canvas in
 * headless Chrome and saves them as ONE atlas: client/public/village/sample-photos/atlas.webp, 4 x 4 tiles of
 * 128 x 160 px (the photo frame is 12 x 15 cm). No external image: every shape is drawn here, from a fixed seed, so a
 * re-run gives the same picture. These stand in until the owner OKs real CC0 photos.
 *
 * The game reads the atlas through `SAMPLE_PHOTO_ATLAS` (client/src/village/sampleCubbies.ts): the photo frames take
 * a per-instance tile offset and the close-up card a CSS background position.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(REPO, "client", "public", "village", "sample-photos", "atlas.webp");

async function launch() {
  try {
    return await chromium.launch({ headless: true });
  } catch {
    return chromium.launch({ headless: true, channel: "chrome" });
  }
}

/** Runs in the page: draws the atlas and returns it as a webp data URL. */
function draw({ cols, rows, w, h }) {
  const canvas = document.createElement("canvas");
  canvas.width = cols * w;
  canvas.height = rows * h;
  const ctx = canvas.getContext("2d");

  let seed = 20261103;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const pick = (list) => list[Math.floor(rnd() * list.length)];

  // Coats: base, shade, light (muzzle / chest), optional blaze.
  const COATS = [
    { base: "#C98B4F", shade: "#8E5A2C", light: "#F1D9B5", name: "fawn" },
    { base: "#F2E6D3", shade: "#C9B79C", light: "#FFFFFF", name: "cream" },
    { base: "#5B4636", shade: "#33251B", light: "#D9C3A8", name: "brown" },
    { base: "#3E3B3A", shade: "#1F1D1C", light: "#E8E2DA", name: "tuxedo" },
    { base: "#E0A15A", shade: "#B06E2E", light: "#FBE8CF", name: "ginger" },
    { base: "#A9A39C", shade: "#6F6A64", light: "#ECE8E3", name: "grey" },
    { base: "#D8B98C", shade: "#A88559", light: "#FBF1E0", name: "golden" },
    { base: "#8A6248", shade: "#5A3D2B", light: "#E7D2BC", name: "chocolate" },
  ];
  const BACKS = [
    ["#F6E7D8", "#E9C9A9"],
    ["#E6EEF2", "#BFD3DD"],
    ["#EFE9F6", "#D3C6E6"],
    ["#EEF3E3", "#CADBB2"],
    ["#F8EBDD", "#EBC7B5"],
    ["#F2F0E9", "#D8D2C3"],
  ];

  const ell = (x, y, rx, ry, rot = 0) => {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  };
  /** A fill lit from the upper left: light at the top-left, the shade at the lower right. */
  const shaded = (x, y, r, base, shade, light) => {
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.45, r * 0.1, x, y, r * 1.25);
    g.addColorStop(0, light);
    g.addColorStop(0.45, base);
    g.addColorStop(1, shade);
    return g;
  };

  function portrait(ox, oy, i) {
    const cat = i % 3 === 1 || i % 5 === 4;
    const coat = COATS[(i * 5 + 3) % COATS.length];
    const [b0, b1] = BACKS[i % BACKS.length];
    ctx.save();
    ctx.beginPath();
    ctx.rect(ox, oy, w, h);
    ctx.clip();
    // the backdrop: a soft studio gradient with a pale halo behind the head
    const bg = ctx.createLinearGradient(ox, oy, ox, oy + h);
    bg.addColorStop(0, b0);
    bg.addColorStop(1, b1);
    ctx.fillStyle = bg;
    ctx.fillRect(ox, oy, w, h);
    const cx = ox + w * (0.47 + rnd() * 0.06);
    const cy = oy + h * (0.44 + rnd() * 0.04);
    const halo = ctx.createRadialGradient(cx, cy, 4, cx, cy, w * 0.75);
    halo.addColorStop(0, "rgba(255,255,255,0.55)");
    halo.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = halo;
    ctx.fillRect(ox, oy, w, h);

    ctx.filter = "blur(0.7px)";
    const s = w / 128;
    const headR = (cat ? 30 : 33) * s;
    const tilt = (rnd() - 0.5) * 0.25;
    const eyeColour = cat ? pick(["#7B8F3A", "#C9962E", "#5E8DA0"]) : "#2A1E17";

    // shoulders and chest
    ctx.fillStyle = shaded(cx, oy + h * 0.98, w * 0.5, coat.base, coat.shade, coat.light);
    ell(cx, oy + h * 1.0, w * 0.42, h * 0.38);
    ctx.fill();
    // the neck joins the head to the shoulders
    ctx.fillStyle = shaded(cx, oy + h * 0.66, w * 0.2, coat.base, coat.shade, coat.light);
    ell(cx, oy + h * 0.66, w * 0.19, h * 0.13);
    ctx.fill();
    ctx.fillStyle = coat.light;
    ctx.globalAlpha = 0.45;
    ell(cx, oy + h * 0.9, w * 0.12, h * 0.13);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(tilt);
    // ears behind the head
    if (cat) {
      for (const side of [-1, 1]) {
        ctx.fillStyle = shaded(side * 20 * s, -30 * s, 18 * s, coat.base, coat.shade, coat.light);
        ctx.beginPath();
        ctx.moveTo(side * 6 * s, -22 * s);
        ctx.quadraticCurveTo(side * 22 * s, -58 * s, side * 30 * s, -44 * s);
        ctx.quadraticCurveTo(side * 34 * s, -26 * s, side * 28 * s, -10 * s);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#E8A9A0";
        ctx.beginPath();
        ctx.moveTo(side * 12 * s, -24 * s);
        ctx.quadraticCurveTo(side * 22 * s, -48 * s, side * 26 * s, -40 * s);
        ctx.quadraticCurveTo(side * 28 * s, -28 * s, side * 24 * s, -18 * s);
        ctx.closePath();
        ctx.fill();
      }
    } else if (i % 2 === 0) {
      // floppy ears
      for (const side of [-1, 1]) {
        ctx.fillStyle = shaded(side * 30 * s, 2 * s, 22 * s, coat.shade, coat.shade, coat.base);
        ell(side * 31 * s, 4 * s, 11 * s, 25 * s, side * -0.35);
        ctx.fill();
      }
    } else {
      // pricked ears
      for (const side of [-1, 1]) {
        ctx.fillStyle = shaded(side * 22 * s, -32 * s, 18 * s, coat.base, coat.shade, coat.light);
        ctx.beginPath();
        ctx.moveTo(side * 8 * s, -24 * s);
        ctx.quadraticCurveTo(side * 20 * s, -62 * s, side * 30 * s, -50 * s);
        ctx.quadraticCurveTo(side * 34 * s, -30 * s, side * 30 * s, -14 * s);
        ctx.closePath();
        ctx.fill();
      }
    }
    // head
    ctx.fillStyle = shaded(0, 0, headR, coat.base, coat.shade, coat.light);
    ell(0, 0, headR, headR * (cat ? 0.9 : 0.95));
    ctx.fill();
    // a blaze or a mask on some coats
    if (coat.name === "tuxedo" || coat.name === "brown" || i % 4 === 3) {
      ctx.fillStyle = coat.light;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.moveTo(-4 * s, -headR * 0.85);
      ctx.quadraticCurveTo(0, -headR * 0.95, 4 * s, -headR * 0.85);
      ctx.lineTo(10 * s, 6 * s);
      ctx.lineTo(-10 * s, 6 * s);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    // muzzle
    const mY = (cat ? 9 : 12) * s;
    ctx.fillStyle = shaded(0, mY, 16 * s, coat.light, coat.base, "#FFFFFF");
    if (cat) {
      ell(-6 * s, mY, 8 * s, 6.5 * s);
      ctx.fill();
      ell(6 * s, mY, 8 * s, 6.5 * s);
      ctx.fill();
    } else {
      ell(0, mY, 15 * s, 12 * s);
      ctx.fill();
    }
    // eyes: dark, with a catch light
    ctx.filter = "blur(0.35px)";
    const eyeY = -6 * s;
    const eyeX = (cat ? 12 : 12) * s;
    for (const side of [-1, 1]) {
      ctx.fillStyle = eyeColour;
      ell(side * eyeX, eyeY, (cat ? 5.2 : 4.6) * s, (cat ? 5.6 : 4.6) * s);
      ctx.fill();
      if (cat) {
        ctx.fillStyle = "#1A1411";
        ell(side * eyeX, eyeY, 1.6 * s, 4.6 * s);
        ctx.fill();
      }
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ell(side * eyeX - 1.4 * s, eyeY - 1.6 * s, 1.3 * s, 1.3 * s);
      ctx.fill();
    }
    // nose and mouth
    ctx.fillStyle = cat ? "#D98C8C" : "#2B201B";
    ctx.beginPath();
    const nY = mY - (cat ? 4 : 6) * s;
    ctx.moveTo(-(cat ? 3.5 : 6) * s, nY);
    ctx.quadraticCurveTo(0, nY - 2 * s, (cat ? 3.5 : 6) * s, nY);
    ctx.quadraticCurveTo(0, nY + (cat ? 5 : 7) * s, -(cat ? 3.5 : 6) * s, nY);
    ctx.fill();
    ctx.strokeStyle = "rgba(60,40,30,0.55)";
    ctx.lineWidth = 1.1 * s;
    ctx.beginPath();
    ctx.moveTo(0, nY + 3 * s);
    ctx.lineTo(0, nY + 7 * s);
    ctx.quadraticCurveTo(-4 * s, nY + 10 * s, -7 * s, nY + 8 * s);
    ctx.moveTo(0, nY + 7 * s);
    ctx.quadraticCurveTo(4 * s, nY + 10 * s, 7 * s, nY + 8 * s);
    ctx.stroke();
    if (cat) {
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = 0.7 * s;
      for (const side of [-1, 1]) {
        for (let k = 0; k < 3; k++) {
          ctx.beginPath();
          ctx.moveTo(side * 9 * s, mY + (k - 1) * 2 * s);
          ctx.lineTo(side * 26 * s, mY + (k - 1) * 4.5 * s - 2 * s);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
    ctx.filter = "none";
    // a soft vignette and a little film grain, like a printed photo
    const v = ctx.createRadialGradient(ox + w / 2, oy + h / 2, w * 0.35, ox + w / 2, oy + h / 2, w * 0.85);
    v.addColorStop(0, "rgba(0,0,0,0)");
    v.addColorStop(1, "rgba(60,40,30,0.22)");
    ctx.fillStyle = v;
    ctx.fillRect(ox, oy, w, h);
    const img = ctx.getImageData(ox, oy, w, h);
    for (let p = 0; p < img.data.length; p += 4) {
      const n = (rnd() - 0.5) * 8;
      img.data[p] += n;
      img.data[p + 1] += n;
      img.data[p + 2] += n;
    }
    ctx.putImageData(img, ox, oy);
    ctx.restore();
  }

  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) portrait(c * w, r * h, r * cols + c);
  return canvas.toDataURL("image/webp", 0.86);
}

const browser = await launch();
try {
  const page = await browser.newPage();
  const url = await page.evaluate(draw, { cols: 4, rows: 4, w: 128, h: 160 });
  if (!url.startsWith("data:image/webp")) throw new Error("이 브라우저는 webp로 저장하지 못해요");
  mkdirSync(dirname(OUT), { recursive: true });
  const bytes = Buffer.from(url.split(",")[1], "base64");
  writeFileSync(OUT, bytes);
  console.log(`${OUT} (${bytes.length} bytes, 512 x 640, 16 portraits)`);
} finally {
  await browser.close();
}

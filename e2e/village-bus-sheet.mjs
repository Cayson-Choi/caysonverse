/**
 * e2e/village-bus-sheet.mjs — 접촉 시트: village-bus-motion.mjs --sheet 가 0.5초마다 저장한 고정 카메라(위에서 본 마을) 프레임에서
 * 구간마다 버스 둘레를 같은 자리로 잘라 격자로 놓는다(카메라는 안 움직이고, 버스가 움직이는 것이 보여야 함).
 *
 *   node e2e/village-bus-sheet.mjs --dir=<label>-frames --rec=<label>.json --out=<접두사>
 *   구간: A 출발(0-20초) B 첫 빨간불(28-48초) C 도착(끝에서 24초 전부터)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchBrowser } from "./lib/common.mjs";

const args = process.argv.slice(2);
const opt = (n, fallback) => (args.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${fallback}`).slice(n.length + 3);
const dir = opt("dir", "");
const rec = JSON.parse(readFileSync(opt("rec", ""), "utf8"));
const out = opt("out", "sheet");
const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"));
const startMs = rec.serverMs[rec.status.indexOf("inTransit")];
const endMs = rec.serverMs[rec.status.lastIndexOf("inTransit")];
const rel = meta.map((m) => ({ ...m, s: (m.ms - startMs) / 1000 }));

// the fixed camera: 120 m up, 38 degree fov, 640 px square -> half-height 120 * tan(19 deg) m
const M = 640 / (2 * 120 * Math.tan((19 * Math.PI) / 180)); // px per metre
const windows = [
  { name: "A-departure", from: 0, to: 20, cx: 28, cz: -16 },
  { name: "B-red-light", from: 28, to: 48, cx: 8, cz: -24 },
  { name: "C-arrival", from: (endMs - startMs) / 1000 - 24, to: (endMs - startMs) / 1000, cx: 27, cz: -6 },
];

const browser = await launchBrowser();
const page = await browser.newPage();
for (const w of windows) {
  const frames = rel.filter((f) => f.s >= w.from && f.s <= w.to + 0.01);
  const tiles = frames.map((f) => ({ s: f.s, url: "data:image/jpeg;base64," + readFileSync(join(dir, `f${String(f.i).padStart(4, "0")}.jpg`)).toString("base64") }));
  const cols = 7;
  const tile = 230;
  const rows = Math.ceil(tiles.length / cols);
  await page.setViewportSize({ width: cols * tile, height: rows * tile });
  await page.setContent(`<body style="margin:0;background:#222"><canvas id=c width=${cols * tile} height=${rows * tile}></canvas></body>`);
  await page.evaluate(
    async ({ tiles, cols, tile, cx, cz, M }) => {
      const g = document.getElementById("c").getContext("2d");
      const half = tile / 2;
      let i = 0;
      for (const t of tiles) {
        const img = new Image();
        img.src = t.url;
        await img.decode();
        const x = (i % cols) * tile;
        const y = Math.floor(i / cols) * tile;
        // the same crop in every tile: the window's centre (cx, cz) in metres -> pixels of the 640 px frame
        g.drawImage(img, 320 + cx * M - half, 320 + cz * M - half, tile, tile, x, y, tile, tile);
        g.fillStyle = "rgba(0,0,0,.6)";
        g.fillRect(x, y, 64, 18);
        g.fillStyle = "#fff";
        g.font = "13px sans-serif";
        g.fillText(t.s.toFixed(1) + " s", x + 4, y + 13);
        g.strokeStyle = "#222";
        g.strokeRect(x, y, tile, tile);
        i++;
      }
    },
    { tiles, cols, tile, cx: w.cx, cz: w.cz, M },
  );
  await page.locator("canvas").screenshot({ path: `${out}-${w.name}.png` });
  console.log("wrote", `${out}-${w.name}.png`, tiles.length, "frames");
}
await browser.close();

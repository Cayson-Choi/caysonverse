/**
 * e2e/village-bus-plot.mjs — village-bus-motion.mjs가 기록한 JSON들로 속도·방향 변화 그림(PNG)과 수치 요약을 만든다.
 *
 *   node e2e/village-bus-plot.mjs --in=before-60.json,after-60.json --labels="before,after" --out=speed-heading.png
 *
 * 위: 프레임마다의 속도(m/s). 아래: 방향 변화율(도/초). 가로는 출발(inTransit)부터의 초. 같은 눈금으로 줄지어 놓는다.
 * 수치: 움직이는 동안(속도 > 0.3 m/s) 속도의 변동계수, 한 프레임도 안 움직인 프레임 수, 프레임 시간 p99.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { launchBrowser } from "./lib/common.mjs";

const args = process.argv.slice(2);
const opt = (n, fallback) => (args.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${fallback}`).slice(n.length + 3);
const files = opt("in", "").split(",").filter(Boolean);
const labels = opt("labels", files.join(",")).split(",");
const out = opt("out", "speed-heading.png");

const wrap = (d) => {
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
};

function analyse(file) {
  const d = JSON.parse(readFileSync(file, "utf8"));
  const start = d.status.indexOf("inTransit");
  const rows = [];
  for (let i = Math.max(1, start); i < d.t.length; i++) {
    if (d.status[i] !== "inTransit") continue;
    const dt = (d.t[i] - d.t[i - 1]) / 1000;
    if (dt <= 0 || dt > 0.1) continue;
    rows.push({
      s: (d.t[i] - d.t[start]) / 1000,
      v: Math.hypot(d.x[i] - d.x[i - 1], d.z[i] - d.z[i - 1]) / dt,
      w: (wrap(d.yaw[i] - d.yaw[i - 1]) * 180) / Math.PI / dt,
      dt,
    });
  }
  const moving = rows.filter((r) => r.v > 0.3).map((r) => r.v);
  const mean = moving.reduce((a, b) => a + b, 0) / Math.max(1, moving.length);
  const sd = Math.sqrt(moving.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, moving.length));
  const dts = rows.map((r) => r.dt).sort((a, b) => a - b);
  // acceleration: speed over 6-frame windows (0.1 s; a lone rAF timestamp that is a few ms off shows as a one-frame spike
  // in the raw per-frame speed, which is the measurement's, not the bus's), compared 6 frames apart
  const v6 = rows.map((r, i) => {
    if (i < 6) return 0;
    const dist = rows.slice(i - 5, i + 1).reduce((a, q) => a + q.v * q.dt, 0);
    return dist / rows.slice(i - 5, i + 1).reduce((a, q) => a + q.dt, 0);
  });
  let maxAcc = 0;
  for (let i = 12; i < rows.length; i++) maxAcc = Math.max(maxAcc, Math.abs(v6[i] - v6[i - 6]) / (rows[i].s - rows[i - 6].s));
  return {
    rows,
    stats: {
      frames: rows.length,
      fps: +(rows.length / rows.at(-1).s).toFixed(1),
      frameP99Ms: +(dts[Math.floor(dts.length * 0.99)] * 1000).toFixed(1),
      meanMovingSpeed: +mean.toFixed(3),
      speedCv: +(sd / mean).toFixed(3),
      frozenFrames: rows.filter((r) => r.v < 1e-6).length,
      maxAccelMps2: +maxAcc.toFixed(3),
      maxTurnRateDegPerS: +Math.max(...rows.map((r) => Math.abs(r.w))).toFixed(1),
    },
  };
}

const sets = files.map(analyse);
for (let i = 0; i < sets.length; i++) console.log(labels[i], JSON.stringify(sets[i].stats));
writeFileSync(out.replace(/\.png$/, ".json"), JSON.stringify(Object.fromEntries(sets.map((s, i) => [labels[i], s.stats])), null, 2));

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1500, height: 330 * sets.length + 40 } });
await page.setContent(`<body style="margin:0;background:#fff;font:14px sans-serif"><canvas id=c width=1500 height=${330 * sets.length + 40}></canvas></body>`);
await page.evaluate(
  ({ sets, labels }) => {
    const cv = document.getElementById("c");
    const g = cv.getContext("2d");
    g.fillStyle = "#fff";
    g.fillRect(0, 0, cv.width, cv.height);
    const tMax = Math.max(...sets.map((s) => s.rows.at(-1).s));
    const panel = (y0, h, rows, key, ymin, ymax, color, title, unit) => {
      const x0 = 70, w = 1400;
      g.strokeStyle = "#ccc";
      g.lineWidth = 1;
      g.strokeRect(x0, y0, w, h);
      g.fillStyle = "#333";
      g.font = "13px sans-serif";
      g.fillText(title, x0 + 6, y0 + 16);
      for (let k = 0; k <= 4; k++) {
        const v = ymin + ((ymax - ymin) * k) / 4;
        const y = y0 + h - ((v - ymin) / (ymax - ymin)) * h;
        g.fillStyle = "#666";
        g.fillText(v.toFixed(1) + unit, 4, y + 4);
        g.strokeStyle = "#eee";
        g.beginPath();
        g.moveTo(x0, y);
        g.lineTo(x0 + w, y);
        g.stroke();
      }
      for (let s = 0; s <= tMax; s += 20) {
        const x = x0 + (s / tMax) * w;
        g.fillStyle = "#666";
        g.fillText(s + "s", x - 8, y0 + h + 14);
      }
      g.strokeStyle = color;
      g.lineWidth = 1;
      g.beginPath();
      rows.forEach((r, i) => {
        const x = x0 + (r.s / tMax) * w;
        const v = Math.max(ymin, Math.min(ymax, r[key]));
        const y = y0 + h - ((v - ymin) / (ymax - ymin)) * h;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      });
      g.stroke();
    };
    sets.forEach((s, i) => {
      const y = 10 + i * 330;
      g.fillStyle = "#000";
      g.font = "bold 15px sans-serif";
      g.fillText(`${labels[i]}  (speed CV ${s.stats.speedCv}, frozen frames ${s.stats.frozenFrames}, ${s.stats.fps} fps)`, 70, y + 12);
      panel(y + 20, 150, s.rows, "v", 0, 3, "#d33", "speed (m/s), per rendered frame", " m/s");
      panel(y + 195, 100, s.rows, "w", -8, 8, "#36c", "turn rate (deg/s), per rendered frame", "");
    });
  },
  { sets: sets.map((s) => ({ rows: s.rows.map((r) => ({ s: r.s, v: r.v, w: r.w })), stats: s.stats })), labels },
);
await page.locator("canvas").screenshot({ path: out });
await browser.close();
console.log("wrote", out);

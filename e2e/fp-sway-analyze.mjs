/** Reads the fp-sway.mjs output files and prints each camera component's oscillation (trend removed). node e2e/fp-sway-analyze.mjs file.json... */
import { readFileSync } from "node:fs";
const NAMES = ["x", "y(up)", "z", "yaw", "pitch", "roll", "fov"];
const DEG = 180 / Math.PI;
function detrend(t, v, win = 0.9) {
  // subtract a centred moving average over `win` seconds (long against a step, short against the walk's own path)
  const out = [];
  let lo = 0;
  let hi = 0;
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    while (hi < v.length && t[hi] <= t[i] + win / 2) sum += v[hi++];
    while (t[lo] < t[i] - win / 2) sum -= v[lo++];
    out.push(v[i] - sum / (hi - lo));
  }
  return out;
}
function dominant(t, d) {
  // brute-force DFT on the uneven samples, 0.5..6 Hz
  let best = 0;
  let bf = 0;
  for (let f = 0.5; f <= 6; f += 0.05) {
    let c = 0;
    let s = 0;
    for (let i = 0; i < d.length; i++) {
      c += d[i] * Math.cos(2 * Math.PI * f * t[i]);
      s += d[i] * Math.sin(2 * Math.PI * f * t[i]);
    }
    const a = (2 * Math.hypot(c, s)) / d.length;
    if (a > best) ((best = a), (bf = f));
  }
  return { f: bf, amp: best };
}
for (const file of process.argv.slice(2)) {
  const data = JSON.parse(readFileSync(file, "utf8"));
  console.log("==", file);
  for (const [name, sc] of Object.entries(data)) {
    const rows = sc.rows.slice(Math.floor(sc.rows.length * 0.3), Math.floor(sc.rows.length * 0.85)); // skip the start-up
    if (rows.length < 20) { console.log(name, "too few frames", rows.length); continue; }
    const t = rows.map((r) => (r[0] - rows[0][0]) / 1000);
    const fps = (rows.length / t.at(-1)).toFixed(1);
    // heading frame: the walk is along one axis, so the lateral / forward split is x / z
    const cols = [1, 2, 3, 4, 5, 6, 7];
    const line = [];
    for (const [k, c] of cols.entries()) {
      let v = rows.map((r) => r[c]);
      if (c === 4 || c === 5 || c === 6) v = v.map((x) => x * DEG);
      if (c === 1 || c === 2 || c === 3) v = v.map((x) => x * 100); // cm
      const d = detrend(t, v);
      const p2p = Math.max(...d) - Math.min(...d);
      const rms = Math.sqrt(d.reduce((a, x) => a + x * x, 0) / d.length);
      const dom = dominant(t, d);
      line.push(`${NAMES[k]} p2p ${p2p.toFixed(2)}${k < 3 ? "cm" : k < 6 ? "deg" : ""} rms ${rms.toFixed(2)} dom ${dom.f.toFixed(2)}Hz@${dom.amp.toFixed(2)}`);
    }
    console.log(`${name} (${rows.length} fr, ${fps} fps)\n  ` + line.join("\n  "));
  }
}

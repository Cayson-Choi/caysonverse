/**
 * e2e/sfx-render.mjs -- renders the park's and the plaza's sound to WAV files with an OfflineAudioContext, running the game's own
 * mixes (the same build/update code the live driver runs), and checks the levels: no clipping, a peak under -1 dBFS, and the
 * loudness of every ride against the coaster's reference.
 *
 *   CV_CLIENT_URL=http://localhost:5971 node e2e/sfx-render.mjs [--out=D:/ClaudeCode/tmpshots/sfx]
 *
 * Needs only the Vite client (the modules are imported straight from it); the page it opens is a plain static file.
 * Files: fountain_near / fountain_mid / fountain_far, wheel_ride (+ _spectator), carousel_cycle (+ _spectator), droptower_ride
 * (+ _spectator), moonboat_ride (+ _spectator), coaster_reference. Writes levels.json next to them; exit code 1 on a failed check.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLIENT_URL, launchBrowser } from "./lib/common.mjs";

const outArg = process.argv.find((a) => a.startsWith("--out="));
const OUT = outArg ? outArg.slice("--out=".length) : "D:/ClaudeCode/tmpshots/sfx";
mkdirSync(OUT, { recursive: true });
const SR = 44100;

function wavBytes(left, right, sr) {
  const n = left.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 4, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(left[i] * 32767))), 44 + i * 4);
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(right[i] * 32767))), 46 + i * 4);
  }
  return buf;
}

const db = (x) => (x > 0 ? 20 * Math.log10(x) : -200);
function stats(l, r, sr) {
  let peak = 0;
  let sum = 0;
  for (let i = 0; i < l.length; i++) {
    peak = Math.max(peak, Math.abs(l[i]), Math.abs(r[i]));
    sum += (l[i] * l[i] + r[i] * r[i]) / 2;
  }
  // loudest 1 s window (RMS) and the median 1 s window: how loud it gets and how loud it usually is
  const win = Math.floor(sr);
  const wins = [];
  for (let s = 0; s + win <= l.length; s += win >> 1) {
    let a = 0;
    for (let i = s; i < s + win; i++) a += (l[i] * l[i] + r[i] * r[i]) / 2;
    wins.push(Math.sqrt(a / win));
  }
  wins.sort((a, b) => a - b);
  return {
    peakDb: +db(peak).toFixed(2),
    rmsDb: +db(Math.sqrt(sum / l.length)).toFixed(2),
    loudestSecDb: +db(wins[wins.length - 1] ?? 0).toFixed(2),
    medianSecDb: +db(wins[Math.floor(wins.length / 2)] ?? 0).toFixed(2),
    seconds: +(l.length / sr).toFixed(1),
  };
}

const browser = await launchBrowser();
const page = await (await browser.newContext()).newPage();
const problems = [];
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") problems.push(`${m.type()}: ${m.text()}`);
});
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
await page.goto(`${CLIENT_URL}/audio/LICENSE.md`, { waitUntil: "domcontentloaded" });

// the page-side renderer: one function, a job description in, two Float32 channels (as base64 of the raw bytes) out
const render = (job) =>
  page.evaluate(
    async ({ job, SR }) => {
      const kit = await import("/src/land/sfx/sfxKit.ts");
      const toB64 = (f32) => {
        const u8 = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);
        let s = "";
        for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
        return btoa(s);
      };
      const ctx = new OfflineAudioContext(2, Math.ceil(job.seconds * SR), SR);
      const bus = kit.createSfxBus(ctx);
      let tickFn = null;
      if (job.kind === "fountain") {
        const f = await import("/src/village/fountainAudio.ts");
        const sp = kit.createSpatial(ctx, bus.input);
        const level = f.fountainLevel(job.distance, f.VILLAGE_FOUNTAIN.rim);
        sp.set(0, f.FOUNTAIN_PEAK * level, job.pan ?? 0, kit.airCutoff(level), 0.001);
        f.buildFountainGraph(ctx, sp.input);
      } else if (job.kind === "coaster") {
        // coasterAudio.ts's graph, copied parameter for parameter (it owns its AudioContext, so it cannot be rendered offline as is)
        const master = kit.gain(ctx, 0.9);
        master.connect(ctx.destination); // the reference goes out raw, as the game plays it (no limiter)
        const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const d = buf.getChannelData(0);
        const rnd = kit.seededRandom(3);
        for (let i = 0; i < d.length; i++) d[i] = rnd() * 2 - 1;
        const noise = ctx.createBufferSource();
        noise.buffer = buf;
        noise.loop = true;
        const windFilter = kit.filter(ctx, "bandpass", 600, 0.7);
        const wind = kit.gain(ctx, 0);
        const rumbleFilter = kit.filter(ctx, "lowpass", 160, 0.7);
        const rumble = kit.gain(ctx, 0);
        noise.connect(windFilter).connect(wind).connect(master);
        noise.connect(rumbleFilter).connect(rumble).connect(master);
        noise.start();
        const clackBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.09), ctx.sampleRate);
        const c = clackBuf.getChannelData(0);
        for (let i = 0; i < c.length; i++) c[i] = (rnd() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.012));
        // a ride profile: the lift at 3.4 m/s (0-14 s), the first drop up to 26 m/s, then 14-26 m/s through the circuit
        const speedAt = (t) => (t < 1 ? 0.2 : t < 14 ? 3.4 : t < 20 ? 3.4 + ((t - 14) / 6) * 22 : t < 40 ? 26 - 8 * Math.abs(Math.sin((t - 20) * 0.5)) : t < 46 ? 20 * (1 - (t - 40) / 6) + 0.3 : 0);
        let lastClack = -1;
        tickFn = {
          coaster: (t) => {
            const sp = speedAt(t);
            const k = Math.min(1, sp / 26);
            wind.gain.setTargetAtTime(0.05 + 0.5 * k * k, t, 0.12);
            windFilter.frequency.setTargetAtTime(350 + 1500 * k, t, 0.12);
            rumble.gain.setTargetAtTime(sp > 0.5 ? 0.06 + 0.4 * k : 0, t, 0.1);
            rumbleFilter.frequency.setTargetAtTime(110 + 140 * k, t, 0.1);
            if (t > 1 && t < 14 && t - lastClack > 0.23) {
              lastClack = t;
              const src = ctx.createBufferSource();
              src.buffer = clackBuf;
              src.playbackRate.value = 0.85 + rnd() * 0.3;
              const g = ctx.createGain();
              g.gain.value = 0.55;
              src.connect(g).connect(master);
              src.start(t);
            }
          },
        };
      }
      if (tickFn?.coaster) {
        tickFn.coaster(0);
        for (let t = 0.1; t < job.seconds; t += 0.1) {
          ctx.suspend(t).then(() => {
            tickFn.coaster(ctx.currentTime);
            ctx.resume();
          });
        }
      }
      const out = await ctx.startRendering();
      return { l: toB64(out.getChannelData(0)), r: toB64(out.getChannelData(1)) };
    },
    { job, SR },
  );

// ride jobs: each says which module, and (as source strings evaluated page-side) how to turn a wall-clock time into the mix's input
const fromB64 = (b64) => {
  const b = Buffer.from(b64, "base64");
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
};
const results = {};
async function save(name, job) {
  const t0 = Date.now();
  const { l, r } = await render(job);
  const L = fromB64(l);
  const R = fromB64(r);
  writeFileSync(join(OUT, `${name}.wav`), wavBytes(L, R, SR));
  results[name] = stats(L, R, SR);
  console.log(name.padEnd(26), JSON.stringify(results[name]), `${Date.now() - t0} ms`);
}

// the page-side input builders, by ride (functions can not cross evaluate(): they are rebuilt there from these sources)
const INPUT_SRC = {
  wheel: `(m, wall) => m.wheelInput(wall, ARGS.rider ? 0 : -1)`,
  carousel: `(m, wall) => m.carouselInput(wall, ARGS.rider, 1)`,
  droptower: `(m, wall) => m.dropInput(wall, ARGS.rider)`,
  moonboat: `(m, wall) => m.moonBoatInput(wall, ARGS.rider)`,
};

/** Page-side: find the wall-clock start (ms) of a ride's excerpt. */
const findStart = (key, rider, excerptStartRule) =>
  page.evaluate(
    async ({ key, rider, rule }) => {
      const mods = {
        wheel: await import("/src/land/wheelAudio.ts"),
        carousel: await import("/src/land/carouselAudio.ts"),
        droptower: await import("/src/land/dropTowerAudio.ts"),
        moonboat: await import("/src/land/moonBoatAudio.ts"),
      };
      const m = mods[key];
      const base = 40_000_000; // a wall-clock time far from zero
      if (key === "wheel") {
        // the moment the rider's gondola (seat 0) arrives at the platform
        let prev = false;
        for (let t = base; t < base + 400_000; t += 100) {
          const inp = m.wheelInput(t, 0);
          if (inp.mine && !prev) return t - 500;
          prev = inp.mine;
        }
      }
      // the others are cycle-periodic: the start of a cycle plus `rule` ms
      const cyc = { carousel: 150_000, droptower: 60_000, moonboat: 130_000 }[key];
      return Math.ceil(base / cyc) * cyc + rule;
    },
    { key, rider, rule: excerptStartRule },
  );

const JOBS = [
  { name: "fountain_near", job: { kind: "fountain", distance: 5.2, seconds: 14 } },
  { name: "fountain_mid", job: { kind: "fountain", distance: 12, pan: 0.4, seconds: 14 } },
  { name: "fountain_far", job: { kind: "fountain", distance: 21, pan: 0.7, seconds: 14 } },
  { name: "coaster_reference", job: { kind: "coaster", seconds: 50 } },
];
for (const { name, job } of JOBS) await save(name, job);

const RIDES = [
  { file: "wheel_ride", key: "wheel", module: "/src/land/wheelAudio.ts", build: "buildWheelMix", rule: 0, seconds: 100, spec: { seconds: 40, distance: 32 } },
  { file: "carousel_cycle", key: "carousel", module: "/src/land/carouselAudio.ts", build: "buildCarouselMix", rule: 30_000, seconds: 128, spec: { seconds: 60, distance: 22 } },
  { file: "droptower_ride", key: "droptower", module: "/src/land/dropTowerAudio.ts", build: "buildDropMix", rule: 33_000, seconds: 30, spec: { seconds: 30, distance: 26 } },
  { file: "moonboat_ride", key: "moonboat", module: "/src/land/moonBoatAudio.ts", build: "buildMoonBoatMix", rule: 34_000, seconds: 96, spec: { seconds: 60, distance: 24 } },
];
for (const R of RIDES) {
  for (const rider of [true, false]) {
    const wall0 = await findStart(R.key, rider, R.rule);
    const seconds = rider ? R.seconds : R.spec.seconds;
    const wallOffset = rider ? 0 : R.key === "wheel" ? 0 : R.key === "carousel" ? 8_000 : 0;
    const job = {
      kind: "ride",
      key: R.key,
      module: R.module,
      build: R.build,
      rider,
      distance: rider ? 0 : R.spec.distance,
      seconds,
      wall0: wall0 + wallOffset,
      inputSrc: INPUT_SRC[R.key].replace(/ARGS\.rider/g, String(rider)),
    };
    // the input builder is made page-side from its source
    await saveRide(`${R.file}${rider ? "" : "_spectator"}`, job);
  }
}

async function saveRide(name, job) {
  const t0 = Date.now();
  const res = await page.evaluate(
    async ({ job, SR }) => {
      const kit = await import("/src/land/sfx/sfxKit.ts");
      const rideSfx = await import("/src/land/rideSfx.ts");
      const m = await import(job.module);
      const inputAt = eval(job.inputSrc);
      const toB64 = (f32) => {
        const u8 = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);
        let s = "";
        for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
        return btoa(s);
      };
      const ctx = new OfflineAudioContext(2, Math.ceil(job.seconds * SR), SR);
      const bus = kit.createSfxBus(ctx);
      const site = rideSfx.RIDE_SFX_SITES.find((s) => s.key === job.key);
      const sp = kit.createSpatial(ctx, bus.input);
      const level = rideSfx.rideLevel(job.rider, job.distance, site.near, site.far, true, site.trim);
      const rel = job.rider ? 1 : level / (rideSfx.SPECTATOR_PEAK * site.trim);
      sp.set(0, level, 0, job.rider ? 20000 : kit.airCutoff(rel, 15000, 1600), 0.001);
      const mix = m[job.build](ctx, sp.input);
      const run = (t) => mix.update(t, inputAt(m, job.wall0 + t * 1000));
      run(0);
      for (let t = 0.1; t < job.seconds; t += 0.1) {
        ctx.suspend(t).then(() => {
          run(ctx.currentTime);
          ctx.resume();
        });
      }
      const out = await ctx.startRendering();
      return { l: toB64(out.getChannelData(0)), r: toB64(out.getChannelData(1)), level };
    },
    { job, SR },
  );
  const L = fromB64(res.l);
  const R2 = fromB64(res.r);
  writeFileSync(join(OUT, `${name}.wav`), wavBytes(L, R2, SR));
  results[name] = { ...stats(L, R2, SR), level: +res.level.toFixed(3) };
  console.log(name.padEnd(26), JSON.stringify(results[name]), `${Date.now() - t0} ms`);
}

// ───────────────────────── the checks ─────────────────────────
const checks = [];
const check = (label, ok, detail) => {
  checks.push({ label, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
};
const ref = results.coaster_reference;
for (const [name, s] of Object.entries(results)) {
  if (name === "coaster_reference") continue; // the reference is the game's existing sound, reported not judged
  check(`${name}: no clipping, peak <= -1 dBFS`, s.peakDb <= -1, `${s.peakDb} dBFS`);
}
for (const name of ["wheel_ride", "carousel_cycle", "droptower_ride", "moonboat_ride"]) {
  const s = results[name];
  const delta = s.loudestSecDb - ref.loudestSecDb;
  check(`${name}: loudest second within 9 dB of the coaster's (${ref.loudestSecDb} dB)`, Math.abs(delta) <= 9, `${delta.toFixed(1)} dB`);
  const sp = results[`${name}_spectator`];
  check(`${name}_spectator is quieter than the rider's`, sp.loudestSecDb < s.loudestSecDb - 3, `${sp.loudestSecDb} vs ${s.loudestSecDb}`);
}
check("fountain: louder near than mid than far", results.fountain_near.rmsDb > results.fountain_mid.rmsDb && results.fountain_mid.rmsDb > results.fountain_far.rmsDb, `${results.fountain_near.rmsDb} / ${results.fountain_mid.rmsDb} / ${results.fountain_far.rmsDb}`);
check("no console errors or warnings in the harness page", problems.length === 0, problems.join(" | "));

writeFileSync(join(OUT, "levels.json"), JSON.stringify({ results, checks, reference: "coaster_reference" }, null, 2));
await browser.close();
process.exit(checks.every((c) => c.ok) ? 0 : 1);

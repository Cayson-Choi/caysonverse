import { VILLAGE_LAYOUT } from "@caysonverse/shared/village/villageLayout";
import { villageLoad } from "../ui/villageLoad";
import { PARK_PLAZA } from "@caysonverse/shared/village/parkArea";
import { useSoundStore } from "../stores/soundStore";
import { useMusicStore } from "../stores/musicStore";
import { resumeVillageAudio, villageAudioContext } from "./villageAudio";
import { FOUNTAIN } from "./fountainLayout";
import {
  airCutoff,
  bakedBuffer,
  createSpatial,
  disconnectAll,
  distanceLevel,
  filter,
  gain,
  lfo,
  loopSource,
  noiseBuffer,
  seededRandom,
  soundAllowed,
  stopQuiet,
  type Spatial,
} from "../land/sfx/sfxKit";

/**
 * The plaza fountains' water (the village's and the park's star fountain): a layered, continuous texture made with Web Audio on the
 * village's one AudioContext, no file. Four layers, so it reads as water thrown up and falling back, not as a noise bed:
 *   1. the pour: pink noise in a wide band around 1.3 kHz, breathing slowly (two LFOs) -- the jets' steady "쏴";
 *   2. the basin wash: brown noise under 700 Hz -- the weight of the water landing in the pool;
 *   3. the patter: a baked loop of tiny droplet "plinks" and ticks on the stone and the surface, two copies at different speeds;
 *   4. the bubbling: a baked loop of rising-pitch bubbles in the basin, soft and low.
 * (The falls are a deep brown roar; this one is brighter, wetter and more tonal on purpose.)
 *
 * It is placed: the level follows the distance to the basin's centre (`fountainLevel`: full at the rim, a smooth fall to nothing at
 * 25 m), the air takes the highs off with distance, and a stereo pan follows the bearing. The menu's 소리 switch silences it, a hidden
 * tab does too, and the nodes are torn down a few seconds after it falls silent (nothing idles in the village's far corners).
 */

/** The audible range (m) from the basin's centre. */
export const FOUNTAIN_RANGE_M = 25;
/** The level at the rim (0..1 of the context's output; the BGM plays around 0.35, the falls at 0.2). */
export const FOUNTAIN_PEAK = 0.12; // owner 11-27 "분수 물소리가 너무 크게": 0.52 → 0.3, then "아직도 너무 크게" → 0.12 (−13 dB in all)
/** Seconds a silent state lasts before the nodes are stopped. */
export const FOUNTAIN_IDLE_STOP_S = 3;
const GLIDE_S = 0.3;

export interface FountainSite {
  readonly x: number;
  readonly z: number;
  /** the basin's outer radius (m): inside it the sound is at full level */
  readonly rim: number;
}
export const VILLAGE_FOUNTAIN: FountainSite = { x: VILLAGE_LAYOUT.plaza.fountain.centre.x, z: VILLAGE_LAYOUT.plaza.fountain.centre.z, rim: FOUNTAIN.pool.r };
/** The park's star fountain (its marble basin's rim is at r 4.6). */
export const PARK_FOUNTAIN: FountainSite = { x: PARK_PLAZA.x, z: PARK_PLAZA.z, rim: 4.6 };

/** 0..1: how much of the fountain is heard `distanceM` from its centre. */
export function fountainLevel(distanceM: number, rim: number): number {
  return distanceLevel(distanceM, rim, FOUNTAIN_RANGE_M, 1.8);
}

/** The gain the sound should have (pure; the unit test drives it). */
export function fountainGain(distanceM: number, rim: number, allowed: boolean): number {
  return allowed ? FOUNTAIN_PEAK * fountainLevel(distanceM, rim) : 0;
}

/** Whether the nodes are worth having (the listener is in range). */
export function fountainNear(distanceM: number): boolean {
  return distanceM < FOUNTAIN_RANGE_M;
}

// ───────────────────────────────────────── the baked loops ─────────────────────────────────────────

/** Tiny droplets landing: ~`perSec` short sine "plinks" (1.8-5.5 kHz, 8-30 ms) and ticks, wrapped round the loop's end so it is seamless. */
export function patterData(sampleRate: number, seconds: number, perSec = 70, seed = 11): Float32Array {
  const n = Math.floor(sampleRate * seconds);
  const out = new Float32Array(n);
  const rnd = seededRandom(seed);
  const events = Math.floor(seconds * perSec);
  for (let e = 0; e < events; e++) {
    const start = Math.floor(rnd() * n);
    const f = 1800 + rnd() * 3700;
    const amp = 0.15 + rnd() * rnd() * 0.85;
    const len = Math.floor(sampleRate * (0.008 + rnd() * 0.022));
    const tick = rnd() < 0.5;
    for (let i = 0; i < len; i++) {
      const env = Math.exp((-6 * i) / len);
      const v = tick ? (rnd() * 2 - 1) * env * 0.8 : Math.sin((2 * Math.PI * f * i) / sampleRate) * env;
      out[(start + i) % n]! += v * amp;
    }
  }
  return out;
}

/** Bubbles in the basin: a sine that rises in pitch as it rings out (a real bubble's chirp), 250-900 Hz, 30-90 ms. */
export function bubbleData(sampleRate: number, seconds: number, perSec = 7, seed = 23): Float32Array {
  const n = Math.floor(sampleRate * seconds);
  const out = new Float32Array(n);
  const rnd = seededRandom(seed);
  const events = Math.floor(seconds * perSec);
  for (let e = 0; e < events; e++) {
    const start = Math.floor(rnd() * n);
    const f0 = 250 + rnd() * 650;
    const dur = 0.03 + rnd() * 0.06;
    const len = Math.floor(sampleRate * dur * 2.4);
    const amp = 0.25 + rnd() * 0.75;
    let phase = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sampleRate;
      phase += (2 * Math.PI * f0 * (1 + 2.2 * (t / dur))) / sampleRate;
      const env = Math.min(1, i / 40) * Math.exp(-t / (dur * 0.55));
      out[(start + i) % n]! += Math.sin(phase) * env * amp;
    }
  }
  return out;
}

function normalise(data: Float32Array, peak: number): void {
  let m = 0;
  for (let i = 0; i < data.length; i++) m = Math.max(m, Math.abs(data[i]!));
  const k = m > 0 ? peak / m : 1;
  for (let i = 0; i < data.length; i++) data[i]! *= k;
}

// ───────────────────────────────────────── the graph ─────────────────────────────────────────

export interface FountainGraph {
  stop(): void;
}

/** Build the four layers into `out` (the placed chain's input). Runs live and in an OfflineAudioContext (e2e/sfx-render.mjs). */
export function buildFountainGraph(ctx: BaseAudioContext, out: AudioNode): FountainGraph {
  const nodes: AudioNode[] = [];
  const sources: AudioBufferSourceNode[] = [];
  const oscs: OscillatorNode[] = [];
  const mix = gain(ctx, 1);
  mix.connect(out);
  nodes.push(mix);

  // 1. the pour
  const pour = loopSource(ctx, noiseBuffer(ctx, 4, "pink", 5));
  const pourBand = filter(ctx, "bandpass", 1300, 0.45);
  const pourHp = filter(ctx, "highpass", 240, 0.7);
  const pourG = gain(ctx, 0.5);
  pour.connect(pourHp).connect(pourBand).connect(pourG).connect(mix);
  oscs.push(lfo(ctx, 0.19, 0.1, pourG.gain), lfo(ctx, 0.43, 0.06, pourG.gain), lfo(ctx, 0.11, 260, pourBand.frequency));
  sources.push(pour);
  nodes.push(pourBand, pourHp, pourG);

  // 2. the basin wash
  const wash = loopSource(ctx, noiseBuffer(ctx, 4, "brown", 9), 1, 1.3);
  const washLp = filter(ctx, "lowpass", 700, 0.6);
  const washG = gain(ctx, 0.5);
  wash.connect(washLp).connect(washG).connect(mix);
  oscs.push(lfo(ctx, 0.13, 0.08, washG.gain));
  sources.push(wash);
  nodes.push(washLp, washG);

  // 2b. the sheet of water on the stone: a bright hiss
  const sheet = loopSource(ctx, noiseBuffer(ctx, 3, "white", 13), 1, 0.7);
  const sheetBand = filter(ctx, "bandpass", 3400, 0.7);
  const sheetG = gain(ctx, 0.07);
  sheet.connect(sheetBand).connect(sheetG).connect(mix);
  oscs.push(lfo(ctx, 0.31, 0.03, sheetG.gain));
  sources.push(sheet);
  nodes.push(sheetBand, sheetG);

  // 3. the patter (two copies, a little apart in speed, so the loop does not show)
  const patter = bakedBuffer(ctx, "fountain-patter", 5, (d, sr) => {
    d.set(patterData(sr, 5));
    normalise(d, 0.9);
  });
  for (const [rate, off, level] of [[1, 0, 0.3], [0.93, 2.1, 0.22]] as const) {
    const s = loopSource(ctx, patter, rate, off);
    const hp = filter(ctx, "highpass", 1500, 0.7);
    const g = gain(ctx, level);
    s.connect(hp).connect(g).connect(mix);
    sources.push(s);
    nodes.push(hp, g);
  }

  // 4. the bubbling
  const bubbles = bakedBuffer(ctx, "fountain-bubbles", 7, (d, sr) => {
    d.set(bubbleData(sr, 7));
    normalise(d, 0.9);
  });
  const bub = loopSource(ctx, bubbles, 1, 1.9);
  const bubLp = filter(ctx, "lowpass", 2400, 0.5);
  const bubG = gain(ctx, 0.24);
  bub.connect(bubLp).connect(bubG).connect(mix);
  sources.push(bub);
  nodes.push(bubLp, bubG);

  return {
    stop() {
      for (const n of [...sources, ...oscs]) stopQuiet(n);
      disconnectAll([...sources, ...oscs, ...nodes]);
    },
  };
}

// ───────────────────────────────────────── the live sound ─────────────────────────────────────────

export interface FountainAudio {
  /** Per frame: the distance (m) to the basin's centre and the stereo bearing (-1..1). */
  update(distanceM: number, pan: number): void;
  readonly target: number;
  readonly running: boolean;
  dispose(): void;
}

export function createFountainAudio(site: FountainSite): FountainAudio {
  let graph: FountainGraph | null = null;
  let spatial: Spatial | null = null;
  let target = 0;
  let silentFor = 0;
  let last = typeof performance !== "undefined" ? performance.now() : 0;
  const teardown = (): void => {
    graph?.stop();
    spatial?.dispose();
    graph = null;
    spatial = null;
  };
  const onVisibility = (): void => {
    if (typeof document === "undefined" || document.visibilityState !== "hidden" || !spatial) return;
    target = 0;
    try {
      spatial.set(0, 0, 0, 800, 0.01);
    } catch {
      // a context in a bad state: the next update tears it down
    }
  };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
  return {
    get target() {
      return target;
    },
    get running() {
      return graph !== null;
    },
    update(distanceM, pan) {
      const now = typeof performance !== "undefined" ? performance.now() : last;
      const dt = Math.min(1, Math.max(0, (now - last) / 1000));
      last = now;
      const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
      // silent under the "케이슨 마을로 가는 중" screen (owner 11-27: the water was heard for a moment while entering)
      const allowed = soundAllowed(useSoundStore.getState().muted, false, hidden) && !villageLoad.get().open;
      const level = allowed ? fountainLevel(distanceM, site.rim) : 0;
      // the menu's 소리 크기 slider scales it too (owner 2026-11-27: "메뉴 소리 크기 조절에 분수 소리도 따르게")
      target = FOUNTAIN_PEAK * level * useMusicStore.getState().volume;
      const ctx = villageAudioContext();
      if (!ctx) return;
      if (level > 0) {
        silentFor = 0;
        if (ctx.state !== "running") {
          resumeVillageAudio();
          if ((ctx.state as string) !== "running") return;
        }
        if (!graph) {
          try {
            spatial = createSpatial(ctx, ctx.destination);
            graph = buildFountainGraph(ctx, spatial.input);
          } catch {
            teardown();
            return;
          }
        }
      } else if (graph) {
        silentFor += dt;
      }
      if (graph && spatial) {
        try {
          spatial.set(ctx.currentTime, target, pan, airCutoff(level), GLIDE_S);
        } catch {
          // ignore: the next frame tries again
        }
        if (level === 0 && silentFor > FOUNTAIN_IDLE_STOP_S) teardown();
      }
    },
    dispose() {
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
      // fade out (a door closing behind you is not a click), then free the nodes
      const g = graph;
      const sp = spatial;
      graph = null;
      spatial = null;
      if (!g || !sp) return;
      const c = villageAudioContext();
      try {
        sp.set(c?.currentTime ?? 0, 0, 0, 800, 0.05);
      } catch {
        // a context in a bad state: the nodes go below
      }
      setTimeout(() => {
        g.stop();
        sp.dispose();
      }, 300);
    },
  };
}

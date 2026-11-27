import { useSoundStore } from "../../stores/soundStore";
import { useMusicStore } from "../../stores/musicStore";
import { resumeVillageAudio, villageAudioContext } from "../villageAudio";
import { fallsNear, soundLevelAt } from "./fallsConfig";

/**
 * The falls' sound (design 5.2.6): "쏴아", made with Web Audio on the village's one AudioContext (villageAudio.ts), no
 * file. Brown noise, low-passed, with two band-passed bodies breathing slowly (two LFOs) so it never sounds like a
 * loop. Its level follows the distance to the landing point (`soundLevelAt`: 1.0 at the pool, 0.35 at 30 m, 0.08 at
 * 80 m, 0 from the plaza) times `FALLS_PEAK`.
 *
 * It obeys the game's sound switch (the menu's 소리, `useSoundStore.muted`), is silent in a hidden tab and before the
 * context may run (a browser needs a gesture; the BGM and the guides resume the context from theirs), and when the
 * listener is far its nodes are torn down after a few seconds (no idle noise source running in the plaza).
 */

/** The gain at level 1 (the BGM plays around 0.35, the bus horn 0.1). */
export const FALLS_PEAK = 0.2;
/** The seconds a silent state lasts before the noise source is stopped. */
export const IDLE_STOP_S = 3;
/** The level glides to its target with this time constant (s): a step across the pool is not a click. */
const GLIDE_S = 0.3;

/** What the sound should do this frame (pure; the test drives it). */
export function fallsGain(distanceM: number, muted: boolean, hidden: boolean): number {
  if (muted || hidden || !fallsNear(distanceM)) return 0;
  return FALLS_PEAK * soundLevelAt(distanceM);
}

/** One looping buffer of brown noise, its seam cross-faded so the loop is clickless. */
export function brownNoise(length: number, seed = 1): Float32Array {
  const out = new Float32Array(length);
  let s = seed >>> 0 || 1;
  let last = 0;
  for (let i = 0; i < length; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const white = (s / 4294967296) * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    out[i] = last * 3.5;
  }
  const fade = Math.min(Math.floor(length / 8), 4800);
  for (let i = 0; i < fade; i++) {
    const w = i / fade;
    out[i] = out[i]! * w + out[length - fade + i]! * (1 - w);
  }
  return out.subarray(0, length - fade);
}

export interface FallsAudio {
  /** Per frame: the camera's distance to the landing point. */
  update(distanceM: number): void;
  /** The gain it is moving toward (a test and the DEV probe read it). */
  readonly target: number;
  readonly running: boolean;
  dispose(): void;
}

interface Graph {
  nodes: AudioNode[];
  master: GainNode;
  stop(): void;
}

function buildGraph(ctx: AudioContext): Graph {
  const nodes: AudioNode[] = [];
  const len = Math.floor(ctx.sampleRate * 4);
  const data = brownNoise(len);
  const buffer = ctx.createBuffer(1, data.length, ctx.sampleRate);
  buffer.getChannelData(0).set(data);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);

  const low = ctx.createBiquadFilter();
  low.type = "lowpass";
  low.frequency.value = 900;
  const lowGain = ctx.createGain();
  lowGain.gain.value = 0.7;
  src.connect(low);
  low.connect(lowGain);
  lowGain.connect(master);
  nodes.push(src, master, low, lowGain);

  const lfos: OscillatorNode[] = [];
  for (const [freq, q, lfoHz] of [
    [420, 0.6, 0.13],
    [1700, 0.8, 0.21],
  ] as const) {
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = freq;
    band.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = 0.45;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = lfoHz;
    const depth = ctx.createGain();
    depth.gain.value = 0.2;
    lfo.connect(depth);
    depth.connect(g.gain);
    src.connect(band);
    band.connect(g);
    g.connect(master);
    lfos.push(lfo);
    nodes.push(band, g, lfo, depth);
  }
  src.start();
  for (const l of lfos) l.start();
  return {
    nodes,
    master,
    stop() {
      for (const n of [src, ...lfos]) {
        try {
          n.stop();
        } catch {
          // already stopped
        }
      }
      for (const n of nodes) {
        try {
          n.disconnect();
        } catch {
          // already gone
        }
      }
    },
  };
}

export function createFallsAudio(): FallsAudio {
  let graph: Graph | null = null;
  let target = 0;
  let silentFor = 0;
  let last = typeof performance !== "undefined" ? performance.now() : 0;
  // A hidden tab runs no frames, so `update` would never silence it: the page's own event does (and the sound resumes
  // with the next frame once the tab is back).
  const onVisibility = (): void => {
    if (typeof document === "undefined" || document.visibilityState !== "hidden" || !graph) return;
    target = 0;
    try {
      graph.master.gain.cancelScheduledValues(0);
      graph.master.gain.value = 0;
    } catch {
      // a context in a bad state: the nodes go with the next update
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
    update(distanceM) {
      const now = typeof performance !== "undefined" ? performance.now() : last;
      const dt = Math.min(1, Math.max(0, (now - last) / 1000));
      last = now;
      const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
      target = fallsGain(distanceM, useSoundStore.getState().muted, hidden) * useMusicStore.getState().volume; // the menu's 소리 크기 (owner 11-27)
      const ctx = villageAudioContext();
      if (!ctx) return;
      if (target > 0) {
        silentFor = 0;
        if (ctx.state !== "running") {
          resumeVillageAudio(); // inside a gesture this takes; elsewhere the browser refuses harmlessly
          if ((ctx.state as string) !== "running") return;
        }
        if (!graph) {
          try {
            graph = buildGraph(ctx);
          } catch {
            graph = null;
            return;
          }
        }
      } else if (graph) {
        silentFor += dt;
      }
      if (graph) {
        try {
          graph.master.gain.setTargetAtTime(target, ctx.currentTime, GLIDE_S);
        } catch {
          graph.master.gain.value = target;
        }
        if (target === 0 && silentFor > IDLE_STOP_S) {
          graph.stop();
          graph = null;
        }
      }
    },
    dispose() {
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
      graph?.stop();
      graph = null;
    },
  };
}

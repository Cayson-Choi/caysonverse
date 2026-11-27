/**
 * Shared building blocks of the park's and the plaza's sound (Web Audio, synthesised: no files): seamless noise loops, a few
 * persistent voices (bells, a creak, an echo), one-shot thuds and hisses, the distance curves and the safety bus. Everything here
 * takes the AudioContext as an argument, so the same code runs live (the village's shared context) and in an OfflineAudioContext
 * (e2e/sfx-render.mjs renders the WAV files that way).
 *
 * Cost rules: a mix builds its nodes once; a tick only moves parameters; the only nodes made later are the handful of one-shots
 * (a thud, a hiss, a door) at an event, never per frame.
 */

export const hz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;
export const smoothstep = (u: number): number => {
  const t = clamp01(u);
  return t * t * (3 - 2 * t);
};

/** A small seeded generator (mulberry32): the harness and a test get the same randomness every run. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ───────────────────────────────────────── the levels: distance, toggles ─────────────────────────────────────────

/** Whether a sound may play at all: the menu's 소리 switch or the ride panel's mute silences it. */
export function soundAllowed(menuMuted: boolean, rideMutedFlag: boolean, hidden: boolean): boolean {
  return !menuMuted && !rideMutedFlag && !hidden;
}

/**
 * The level (0..1) of a sound `distanceM` from its source: 1 up to `nearM`, 0 from `farM`, a smooth fall between (power curve:
 * steep at first, a long quiet tail).
 */
export function distanceLevel(distanceM: number, nearM: number, farM: number, power = 2): number {
  if (!(distanceM < farM)) return 0;
  if (distanceM <= nearM) return 1;
  const u = (distanceM - nearM) / (farM - nearM);
  return Math.pow(1 - smoothstep(u), power);
}

/** The air's high-frequency loss: a lowpass cutoff (Hz) for a level (1 close = open, 0 far = dull). */
export function airCutoff(level: number, openHz = 16000, farHz = 1400): number {
  return farHz + (openHz - farHz) * Math.pow(clamp01(level), 0.6);
}

/** The stereo position (-1..1) of a source at (dx, dz) from the listener whose right-hand vector on the ground is (rx, rz); close sources centre. */
export function panFor(dx: number, dz: number, rx: number, rz: number): number {
  const d = Math.hypot(dx, dz);
  if (d < 1e-6) return 0;
  const side = (dx * rx + dz * rz) / d;
  return Math.max(-0.85, Math.min(0.85, side * Math.min(1, d / 6)));
}

/** Where the listener (the camera) is, for the ground sounds: written every frame by the area's sound component. */
export const sfxListener = { x: 0, z: 0, rx: 1, rz: 0, valid: false };

// ───────────────────────────────────────── noise loops ─────────────────────────────────────────

export type NoiseKind = "white" | "pink" | "brown";

/** `length` samples of noise, its seam cross-faded so the loop does not click; the result is a little shorter than `length`. */
export function noiseData(length: number, kind: NoiseKind, seed = 1): Float32Array {
  const rnd = seededRandom(seed);
  const out = new Float32Array(length);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;
  let last = 0;
  for (let i = 0; i < length; i++) {
    const w = rnd() * 2 - 1;
    if (kind === "white") out[i] = w;
    else if (kind === "pink") {
      // Paul Kellet's economy filter
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    } else {
      last = (last + 0.02 * w) / 1.02;
      out[i] = last * 3.5;
    }
  }
  const fade = Math.min(Math.floor(length / 8), 4800);
  for (let i = 0; i < fade; i++) {
    const u = i / fade;
    out[i] = out[i]! * u + out[length - fade + i]! * (1 - u);
  }
  return out.subarray(0, length - fade);
}

const bufferCache = new WeakMap<BaseAudioContext, Map<string, AudioBuffer>>();

/** A cached looping noise buffer (one per context, kind and length): a whole mix shares it. */
export function noiseBuffer(ctx: BaseAudioContext, seconds: number, kind: NoiseKind, seed = 1): AudioBuffer {
  let m = bufferCache.get(ctx);
  if (!m) {
    m = new Map();
    bufferCache.set(ctx, m);
  }
  const key = `${kind}:${seconds}:${seed}`;
  let b = m.get(key);
  if (!b) {
    const data = noiseData(Math.floor(ctx.sampleRate * seconds), kind, seed);
    b = ctx.createBuffer(1, data.length, ctx.sampleRate);
    b.getChannelData(0).set(data);
    m.set(key, b);
  }
  return b;
}

/** A cached custom buffer (a baked loop): `fill` writes it once per context. */
export function bakedBuffer(ctx: BaseAudioContext, key: string, seconds: number, fill: (data: Float32Array, sampleRate: number) => void): AudioBuffer {
  let m = bufferCache.get(ctx);
  if (!m) {
    m = new Map();
    bufferCache.set(ctx, m);
  }
  let b = m.get(key);
  if (!b) {
    b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    fill(b.getChannelData(0), ctx.sampleRate);
    m.set(key, b);
  }
  return b;
}

/** A started looping noise source. */
export function loopSource(ctx: BaseAudioContext, buffer: AudioBuffer, rate = 1, offset = 0): AudioBufferSourceNode {
  const s = ctx.createBufferSource();
  s.buffer = buffer;
  s.loop = true;
  s.playbackRate.value = rate;
  s.start(0, offset % buffer.duration);
  return s;
}

export function filter(ctx: BaseAudioContext, type: BiquadFilterType, freq: number, q = 0.7): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

export function gain(ctx: BaseAudioContext, value = 0): GainNode {
  const g = ctx.createGain();
  g.gain.value = value;
  return g;
}

/** A slow oscillator that modulates `target` by +-`depth` (a breathing level, a drifting cutoff). */
export function lfo(ctx: BaseAudioContext, hzRate: number, depth: number, target: AudioParam, type: OscillatorType = "sine"): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = hzRate;
  const d = ctx.createGain();
  d.gain.value = depth;
  lfoDepth.set(o, d);
  o.connect(d).connect(target);
  o.start();
  return o;
}

/**
 * A gain that breathes around 1 (a slow LFO of +-`depth`): put it IN SERIES with a controlled gain. (An LFO added straight onto
 * a controlled gain's own parameter keeps sounding when that gain is eased to 0.)
 */
export function breath(ctx: BaseAudioContext, hzRate: number, depth: number): { node: GainNode; osc: OscillatorNode } {
  const node = gain(ctx, 1);
  return { node, osc: lfo(ctx, hzRate, depth, node.gain) };
}

/** Smooth a parameter toward `v` (a time constant in s). */
export function ease(p: AudioParam, v: number, t: number, tc: number): void {
  p.setTargetAtTime(v, t, tc);
}

// ───────────────────────────────────────── the safety bus ─────────────────────────────────────────

export interface SfxBus {
  input: GainNode;
  dispose(): void;
}

/** gain -> a soft limiter -> destination: whatever the mixes add up to, the output stays under 0 dBFS. */
export function createSfxBus(ctx: BaseAudioContext, dest: AudioNode = ctx.destination, level = 1): SfxBus {
  const input = gain(ctx, level);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -9;
  comp.knee.value = 8;
  comp.ratio.value = 10;
  comp.attack.value = 0.004;
  comp.release.value = 0.2;
  input.connect(comp).connect(dest);
  return {
    input,
    dispose() {
      try {
        input.disconnect();
        comp.disconnect();
      } catch {
        // gone already
      }
    },
  };
}

// ───────────────────────────────────────── persistent voices ─────────────────────────────────────────

/** A pooled bell: inharmonic sine partials, built once; ringing one only reschedules pitch and envelope. */
export class BellPool {
  private readonly osc: OscillatorNode[][] = [];
  private readonly env: GainNode[][] = [];
  private next = 0;
  constructor(
    ctx: BaseAudioContext,
    out: AudioNode,
    private readonly partials: readonly (readonly [number, number])[] = [[1, 1], [2.76, 0.35], [5.4, 0.12]],
    voices = 3,
  ) {
    for (let v = 0; v < voices; v++) {
      const os: OscillatorNode[] = [];
      const en: GainNode[] = [];
      for (let k = 0; k < partials.length; k++) {
        const o = ctx.createOscillator();
        o.type = "sine";
        const g = ctx.createGain();
        g.gain.value = 0;
        o.connect(g).connect(out);
        o.start();
        os.push(o);
        en.push(g);
      }
      this.osc.push(os);
      this.env.push(en);
    }
  }
  /** Ring a note: `freq` Hz at time `t`, peak `peak`, ringing `dur` s. */
  ring(freq: number, t: number, peak: number, dur = 2.2, attack = 0.004): void {
    const v = this.next++ % this.osc.length;
    for (let k = 0; k < this.partials.length; k++) {
      const [mul, w] = this.partials[k]!;
      this.osc[v]![k]!.frequency.setValueAtTime(freq * mul, t);
      const gp = this.env[v]![k]!.gain;
      gp.cancelScheduledValues(t);
      gp.setValueAtTime(0, t);
      gp.linearRampToValueAtTime(peak * w, t + attack);
      gp.exponentialRampToValueAtTime(0.0001, t + dur / Math.pow(mul, 0.3));
    }
  }
  dispose(): void {
    for (const o of this.osc) for (const n of o) stopQuiet(n);
  }
}

/**
 * A creak: a stick-slip sawtooth (a pitch that slides, a 30-45 Hz flutter) through a narrow band. One voice, built once;
 * `fire` schedules one creak at time `t`.
 */
export class CreakVoice {
  private readonly osc: OscillatorNode;
  private readonly band: BiquadFilterNode;
  private readonly env: GainNode;
  private readonly flutter: OscillatorNode;
  constructor(ctx: BaseAudioContext, out: AudioNode) {
    this.osc = ctx.createOscillator();
    this.osc.type = "sawtooth";
    this.osc.frequency.value = 120;
    this.band = filter(ctx, "bandpass", 900, 5);
    const am = gain(ctx, 0.5);
    this.env = gain(ctx, 0);
    this.flutter = ctx.createOscillator();
    this.flutter.type = "triangle";
    this.flutter.frequency.value = 36;
    const depth = gain(ctx, 0.5);
    this.flutter.connect(depth).connect(am.gain);
    this.osc.connect(this.band).connect(am).connect(this.env).connect(out);
    this.osc.start();
    this.flutter.start();
  }
  /** `f0` -> `f1` Hz over `dur` s (the pitch of the sliding wood), peak level `peak`. */
  fire(t: number, f0: number, f1: number, dur: number, peak: number, brightHz = 900): void {
    this.osc.frequency.cancelScheduledValues(t);
    this.osc.frequency.setValueAtTime(f0, t);
    this.osc.frequency.linearRampToValueAtTime(f1, t + dur);
    this.flutter.frequency.cancelScheduledValues(t);
    this.flutter.frequency.setValueAtTime(30 + (f0 % 11), t);
    this.flutter.frequency.linearRampToValueAtTime(46, t + dur);
    this.band.frequency.cancelScheduledValues(t);
    this.band.frequency.setValueAtTime(brightHz, t);
    this.band.frequency.linearRampToValueAtTime(brightHz * 1.4, t + dur);
    const g = this.env.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(peak, t + dur * 0.3);
    g.linearRampToValueAtTime(peak * 0.6, t + dur * 0.7);
    g.linearRampToValueAtTime(0, t + dur);
  }
  dispose(): void {
    stopQuiet(this.osc);
    stopQuiet(this.flutter);
  }
}

/** A feedback echo (a cheap, dreamy room): send into `input`; the wet goes to `out`. */
export function createEcho(ctx: BaseAudioContext, out: AudioNode, delaySec = 0.4, feedback = 0.36, tone = 2600, wet = 0.5): { input: GainNode; nodes: AudioNode[] } {
  const input = gain(ctx, 1);
  const delay = ctx.createDelay(1.5);
  delay.delayTime.value = delaySec;
  const fb = gain(ctx, feedback);
  const lp = filter(ctx, "lowpass", tone, 0.5);
  const w = gain(ctx, wet);
  input.connect(delay);
  delay.connect(lp);
  lp.connect(fb);
  fb.connect(delay);
  lp.connect(w).connect(out);
  input.connect(out);
  return { input, nodes: [input, delay, fb, lp, w] };
}

/** A pitch bend shared by every oscillator that connects to `.offset` (cents): winding a music box down is one parameter. */
export function createBend(ctx: BaseAudioContext): ConstantSourceNode {
  const c = ctx.createConstantSource();
  c.offset.value = 0;
  c.start();
  return c;
}

export function stopQuiet(n: { stop(when?: number): void }): void {
  try {
    n.stop();
  } catch {
    // already stopped
  }
}

/** Each LFO's depth gain (lfo): it hangs off the oscillator, so a graph's teardown finds it there. */
const lfoDepth = new WeakMap<AudioNode, GainNode>();

/** A gain left at 0 (its scheduled ramps dropped): a torn-down graph holds no level at all, even unplugged. */
function silence(n: AudioNode): void {
  if (typeof GainNode === "undefined" || !(n instanceof GainNode)) return;
  try {
    n.gain.cancelScheduledValues(0);
    n.gain.value = 0;
  } catch {
    // a closed context: nothing to hold
  }
}

/**
 * Unplug a torn-down graph: every node disconnected, and every gain in it (an LFO's depth too) set to 0 — owner 2026-11-27,
 * the menu check found the fountain's twelve gains still above 0 after 소리 끄기 (silent, being unplugged, but left holding a level).
 */
export function disconnectAll(nodes: readonly AudioNode[]): void {
  for (const n of nodes) {
    silence(n);
    const depth = lfoDepth.get(n);
    if (depth) {
      silence(depth);
      try {
        depth.disconnect();
      } catch {
        // gone already
      }
    }
    try {
      n.disconnect();
    } catch {
      // gone already
    }
  }
}

// ───────────────────────────────────────── one-shots (events, never per frame) ─────────────────────────────────────────

/** A low thump: a sine falling from `f0` to `f1` Hz with a quick decay (and a soft click on top). */
export function thud(ctx: BaseAudioContext, out: AudioNode, t: number, peak: number, f0 = 95, f1 = 38, dur = 0.32): void {
  const o = ctx.createOscillator();
  o.type = "sine";
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.05);
  burst(ctx, out, t, 0.05, peak * 0.5, "lowpass", 900, 0.7);
}

/** A noise burst through one filter with a fast attack and an exponential decay. */
export function burst(ctx: BaseAudioContext, out: AudioNode, t: number, dur: number, peak: number, type: BiquadFilterType, freq: number, q = 1, attack = 0.004): void {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuffer(ctx, 1, "white", 7);
  s.loop = true;
  const f = filter(ctx, type, freq, q);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(out);
  s.start(t, (t * 0.37) % 0.9);
  s.stop(t + dur + 0.05);
}

/** A metal clank: a few inharmonic sines with fast decay plus a burst. */
export function clank(ctx: BaseAudioContext, out: AudioNode, t: number, peak: number, base = 310): void {
  for (const [m, w, d] of [[1, 1, 0.22], [2.32, 0.6, 0.14], [3.87, 0.35, 0.09]] as const) {
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = base * m;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak * w, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + d + 0.05);
  }
  burst(ctx, out, t, 0.04, peak * 0.7, "bandpass", 2400, 1.2, 0.002);
}

/** A swell of filtered noise (air released, a door sliding, a brake): rises over `rise`, falls by `dur`. */
export function swish(ctx: BaseAudioContext, out: AudioNode, t: number, dur: number, peak: number, f0: number, f1: number, q = 0.8, rise = 0.3): void {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuffer(ctx, 1, "pink", 3);
  s.loop = true;
  const f = filter(ctx, "bandpass", f0, q);
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + dur * rise);
  g.gain.linearRampToValueAtTime(0, t + dur);
  s.connect(f).connect(g).connect(out);
  s.start(t, (t * 0.51) % 0.9);
  s.stop(t + dur + 0.05);
}

// ───────────────────────────────────────── a placed source: lowpass -> pan -> level ─────────────────────────────────────────

export interface Spatial {
  /** Connect the sound here. */
  input: AudioNode;
  /** Move toward a level (0..1), a stereo position (-1..1) and an air cutoff (Hz); `tc` is the glide's time constant (s). */
  set(t: number, level: number, pan: number, cutoffHz: number, tc?: number): void;
  readonly level: number;
  dispose(): void;
}

export function createSpatial(ctx: BaseAudioContext, out: AudioNode): Spatial {
  const lp = filter(ctx, "lowpass", 16000, 0.5);
  const panner = typeof ctx.createStereoPanner === "function" ? ctx.createStereoPanner() : null;
  const lvl = gain(ctx, 0);
  if (panner) lp.connect(panner).connect(lvl);
  else lp.connect(lvl);
  lvl.connect(out);
  let level = 0;
  return {
    input: lp,
    get level() {
      return level;
    },
    set(t, l, pan, cutoffHz, tc = 0.25) {
      level = l;
      lvl.gain.setTargetAtTime(l, t, tc);
      lp.frequency.setTargetAtTime(cutoffHz, t, tc);
      panner?.pan.setTargetAtTime(pan, t, tc);
    },
    dispose() {
      disconnectAll([lp, panner ?? lp, lvl]);
    },
  };
}

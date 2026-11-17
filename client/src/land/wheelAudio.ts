/** The wheel's sound (WebAudio, synthesised): soft bell chimes drifting by, a low hum of the turning wheel, the wind rising with the height. Shares the ride mute switch. */
import { rideMuted } from "./coasterAudio";
import { wheelAt, wheelSeatPose } from "@caysonverse/shared/land/wheel";
import { villageClock } from "../village/villageClock";
import { selfRide } from "./coasterRide";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let hum: GainNode | null = null;
let wind: GainNode | null = null;
let windFilter: BiquadFilterNode | null = null;
let noise: AudioBufferSourceNode | null = null;
let timer = 0;
let beat = 0;
const BELLS = [76, 79, 81, 84, 88]; // an airy pentatonic
const hz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

interface BellVoice {
  osc: OscillatorNode[];
  gain: GainNode[];
}
/** A pool of three bell voices, built once: each is three sine partials with a gain each; ringing a bell only reschedules their pitch and envelope (no node is created while riding). */
let voices: BellVoice[] = [];
let nextVoice = 0;
const PARTIALS: readonly (readonly [number, number])[] = [[1, 1], [2.76, 0.35], [5.4, 0.12]];

function makeVoices(c: AudioContext, out: AudioNode): BellVoice[] {
  const list: BellVoice[] = [];
  for (let v = 0; v < 3; v++) {
    const voice: BellVoice = { osc: [], gain: [] };
    for (let k = 0; k < PARTIALS.length; k++) {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = "sine";
      g.gain.value = 0;
      o.connect(g).connect(out);
      o.start();
      voice.osc.push(o);
      voice.gain.push(g);
    }
    list.push(voice);
  }
  return list;
}

function bell(freq: number, t: number, dur: number, gain: number): void {
  if (!ctx || voices.length === 0) return;
  const v = voices[nextVoice++ % voices.length]!;
  PARTIALS.forEach(([mul, g], k) => {
    v.osc[k]!.frequency.setValueAtTime(freq * mul, t);
    const gp = v.gain[k]!.gain;
    gp.cancelScheduledValues(t);
    gp.setValueAtTime(0, t);
    gp.linearRampToValueAtTime(gain * g, t + 0.005);
    gp.exponentialRampToValueAtTime(0.0001, t + dur / mul ** 0.3);
  });
}

export function startWheelAudio(): void {
  if (ctx || typeof AudioContext === "undefined") return;
  try {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    windFilter = ctx.createBiquadFilter();
    windFilter.type = "bandpass";
    windFilter.frequency.value = 500;
    wind = ctx.createGain();
    wind.gain.value = 0;
    noise.connect(windFilter).connect(wind).connect(master);
    noise.start();
    const h = ctx.createOscillator();
    h.type = "sawtooth";
    h.frequency.value = 48;
    const hf = ctx.createBiquadFilter();
    hf.type = "lowpass";
    hf.frequency.value = 120;
    hum = ctx.createGain();
    hum.gain.value = 0;
    h.connect(hf).connect(hum).connect(master);
    h.start();
    voices = makeVoices(ctx, master);
    beat = 0;
    timer = window.setInterval(() => {
      if (!ctx || !master || !hum || !wind || !windFilter) return;
      const wall = villageClock.liveMs();
      const st = wheelAt(wall);
      const alt = selfRide.slot >= 0 ? wheelSeatPose(selfRide.slot, wall).y : 0;
      const t = ctx.currentTime;
      master.gain.setTargetAtTime(rideMuted() ? 0 : 0.5, t, 0.3);
      hum.gain.setTargetAtTime(Math.min(1, st.omega * 14) * 0.06, t, 0.3);
      wind.gain.setTargetAtTime(Math.min(1, alt / 50) * 0.05, t, 0.6);
      windFilter.frequency.setTargetAtTime(300 + alt * 12, t, 0.6);
      beat++;
      if (beat % 9 === 0) bell(hz(BELLS[(beat / 9) % BELLS.length | 0]!), t + 0.02, 2.4, 0.06);
    }, 400);
  } catch {
    ctx = null;
  }
}

export function stopWheelAudio(): void {
  window.clearInterval(timer);
  const c = ctx;
  const m = master;
  ctx = null;
  master = null;
  voices = [];
  if (!c || !m) return;
  try {
    m.gain.setTargetAtTime(0, c.currentTime, 0.2);
    window.setTimeout(() => {
      try {
        noise?.stop();
      } catch {
        /* stopped */
      }
      void c.close().catch(() => undefined);
    }, 800);
  } catch {
    /* ignore */
  }
}

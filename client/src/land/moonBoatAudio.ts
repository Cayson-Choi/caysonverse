/**
 * The moon boat's sound (WebAudio, synthesised, shares the ride mute switch): the wind rising with the swing's speed, a slow creak-like hum that follows the
 * height, and a soft celesta bell at each turning point (a lullaby pentatonic). Everything is built once at the start (a noise loop, a hum, a pool of three
 * bell voices); the 150 ms timer only retunes gains and reschedules a bell's pitch and envelope: no node is created while riding.
 */
import { rideMuted } from "./coasterAudio";
import { moonBoatAt, type MoonBoatState } from "@caysonverse/shared/land/moonBoat";
import { villageClock } from "../village/villageClock";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let wind: GainNode | null = null;
let windFilter: BiquadFilterNode | null = null;
let hum: GainNode | null = null;
let humOsc: OscillatorNode | null = null;
let noise: AudioBufferSourceNode | null = null;
let timer = 0;
let lastSign = 0;
let note = 0;
const ST: MoonBoatState = { cycle: 0, phase: 0, status: "boarding", angle: 0, omega: 0, alpha: 0, rideT: 0, departsInMs: 0 };
const BELLS = [72, 76, 79, 81, 84];
const hz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
const PARTIALS: readonly (readonly [number, number])[] = [[1, 1], [2.76, 0.3], [5.4, 0.1]];

interface Voice {
  osc: OscillatorNode[];
  gain: GainNode[];
}
let voices: Voice[] = [];
let nextVoice = 0;

function ring(freq: number, t: number, gain: number): void {
  if (!ctx || voices.length === 0) return;
  const v = voices[nextVoice++ % voices.length]!;
  for (let k = 0; k < PARTIALS.length; k++) {
    const [mul, g] = PARTIALS[k]!;
    v.osc[k]!.frequency.setValueAtTime(freq * mul, t);
    const gp = v.gain[k]!.gain;
    gp.cancelScheduledValues(t);
    gp.setValueAtTime(0, t);
    gp.linearRampToValueAtTime(gain * g, t + 0.005);
    gp.exponentialRampToValueAtTime(0.0001, t + 1.8 / mul ** 0.3);
  }
}

export function startMoonBoatAudio(): void {
  if (ctx || typeof AudioContext === "undefined") return;
  try {
    const c = new AudioContext();
    ctx = c;
    master = c.createGain();
    master.gain.value = 0;
    master.connect(c.destination);
    const buf = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noise = c.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    windFilter = c.createBiquadFilter();
    windFilter.type = "bandpass";
    windFilter.frequency.value = 400;
    wind = c.createGain();
    wind.gain.value = 0;
    noise.connect(windFilter).connect(wind).connect(master);
    noise.start();
    humOsc = c.createOscillator();
    humOsc.type = "triangle";
    humOsc.frequency.value = 62;
    const hf = c.createBiquadFilter();
    hf.type = "lowpass";
    hf.frequency.value = 160;
    hum = c.createGain();
    hum.gain.value = 0;
    humOsc.connect(hf).connect(hum).connect(master);
    humOsc.start();
    voices = [];
    for (let v = 0; v < 3; v++) {
      const voice: Voice = { osc: [], gain: [] };
      for (let k = 0; k < PARTIALS.length; k++) {
        const o = c.createOscillator();
        const g = c.createGain();
        o.type = "sine";
        g.gain.value = 0;
        o.connect(g).connect(master);
        o.start();
        voice.osc.push(o);
        voice.gain.push(g);
      }
      voices.push(voice);
    }
    lastSign = 0;
    timer = window.setInterval(() => {
      if (!ctx || !master || !wind || !windFilter || !hum || !humOsc) return;
      const st = moonBoatAt(villageClock.liveMs(), ST);
      const t = ctx.currentTime;
      const speed = Math.min(1, Math.abs(st.omega) / 0.9);
      const height = Math.max(0, Math.min(1, (st.angle === 0 ? 0 : Math.abs(st.angle)) / 0.96));
      master.gain.setTargetAtTime(rideMuted() ? 0 : 0.5, t, 0.3);
      wind.gain.setTargetAtTime(speed * 0.09, t, 0.25);
      windFilter.frequency.setTargetAtTime(280 + speed * 900, t, 0.25);
      hum.gain.setTargetAtTime(0.03 + height * 0.04, t, 0.4);
      humOsc.frequency.setTargetAtTime(58 + height * 18, t, 0.4);
      const sign = st.omega > 0.02 ? 1 : st.omega < -0.02 ? -1 : lastSign;
      // a bell at each turning point once the swing is big enough to feel
      if (lastSign !== 0 && sign !== lastSign && Math.abs(st.angle) > 0.3) ring(hz(BELLS[note++ % BELLS.length]!), t + 0.02, 0.05 + Math.abs(st.angle) * 0.05);
      lastSign = sign;
    }, 150);
  } catch {
    ctx = null;
  }
}

export function stopMoonBoatAudio(): void {
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
        humOsc?.stop();
      } catch {
        /* stopped */
      }
      void c.close().catch(() => undefined);
    }, 800);
  } catch {
    /* ignore */
  }
}


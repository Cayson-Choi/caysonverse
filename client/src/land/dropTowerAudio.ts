/**
 * The cloud drop tower's sound (WebAudio, synthesised, shares the ride mute switch): the slow lift's soft motor hum rising with the height, a held breath of
 * wind at the top, the free fall's rushing wind (speed), a low magnetic thrum in the brakes, and a soft celesta chime when the car sets down. Everything is
 * built once at the start (a noise loop, two oscillators, a pool of three bell voices); the 120 ms timer only retunes gains and reschedules a bell: no node
 * is created while riding.
 */
import { rideMuted } from "./coasterAudio";
import { DROP_FALL_V, DROP_TOP_Y, dropAt, type DropState } from "@caysonverse/shared/land/dropTower";
import { villageClock } from "../village/villageClock";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let wind: GainNode | null = null;
let windFilter: BiquadFilterNode | null = null;
let motor: GainNode | null = null;
let motorOsc: OscillatorNode | null = null;
let thrum: GainNode | null = null;
let thrumOsc: OscillatorNode | null = null;
let noise: AudioBufferSourceNode | null = null;
let timer = 0;
let lastStage = "idle";
const ST: DropState = { cycle: 0, phase: 0, status: "boarding", stage: "idle", y: 0, v: 0, a: 0, rideT: 0, departsInMs: 0 };
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
    gp.exponentialRampToValueAtTime(0.0001, t + 2.2 / mul ** 0.3);
  }
}

export function startDropAudio(): void {
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
    const lp = (f: number): BiquadFilterNode => {
      const b = c.createBiquadFilter();
      b.type = "lowpass";
      b.frequency.value = f;
      return b;
    };
    motorOsc = c.createOscillator();
    motorOsc.type = "sawtooth";
    motorOsc.frequency.value = 55;
    motor = c.createGain();
    motor.gain.value = 0;
    motorOsc.connect(lp(180)).connect(motor).connect(master);
    motorOsc.start();
    thrumOsc = c.createOscillator();
    thrumOsc.type = "triangle";
    thrumOsc.frequency.value = 38;
    thrum = c.createGain();
    thrum.gain.value = 0;
    thrumOsc.connect(lp(120)).connect(thrum).connect(master);
    thrumOsc.start();
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
    lastStage = "idle";
    timer = window.setInterval(() => {
      if (!ctx || !master || !wind || !windFilter || !motor || !motorOsc || !thrum || !thrumOsc) return;
      const st = dropAt(villageClock.liveMs(), ST);
      const t = ctx.currentTime;
      const speed = Math.min(1, Math.abs(st.v) / DROP_FALL_V);
      const height = Math.max(0, Math.min(1, st.y / DROP_TOP_Y));
      master.gain.setTargetAtTime(rideMuted() ? 0 : 0.5, t, 0.3);
      motor.gain.setTargetAtTime(st.stage === "lift" ? 0.05 : 0, t, 0.3);
      motorOsc.frequency.setTargetAtTime(52 + height * 26, t, 0.4);
      wind.gain.setTargetAtTime(0.012 * height + speed * 0.14, t, 0.15);
      windFilter.frequency.setTargetAtTime(260 + speed * 1500, t, 0.15);
      thrum.gain.setTargetAtTime(st.stage === "brake" ? 0.1 : 0, t, 0.08);
      thrumOsc.frequency.setTargetAtTime(34 + speed * 22, t, 0.1);
      if (st.stage !== lastStage) {
        if (st.stage === "hold") ring(660, t + 0.02, 0.05);
        if (st.stage === "rest") ring(880, t + 0.05, 0.06);
        lastStage = st.stage;
      }
    }, 120);
  } catch {
    ctx = null;
  }
}

export function stopDropAudio(): void {
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
        motorOsc?.stop();
        thrumOsc?.stop();
      } catch {
        /* stopped */
      }
      void c.close().catch(() => undefined);
    }, 800);
  } catch {
    /* ignore */
  }
}

/** Music box for the carousel (WebAudio, synthesised): a waltz that plays while someone rides, loudest while it turns. Shares the mute switch. */
import { rideMuted } from "./coasterAudio";
import { carouselAt } from "@caysonverse/shared/land/carousel";
import { villageClock } from "../village/villageClock";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let timer = 0;
let step = 0;
const MEL = [76, 72, 69, 72, 74, 71, 67, 71, 72, 69, 64, 69, 71, 68, 64, 68]; // a gentle waltz figure in A minor
const BASS = [45, 52, 52, 40, 47, 54, 54, 43];

const hz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

interface Voice {
  osc: OscillatorNode;
  gain: GainNode;
}
/** Three persistent voices (the comb's tine, its octave, the bass): playing a note only reschedules pitch and envelope, no node is created while riding. */
let tine: Voice | null = null;
let octave: Voice | null = null;
let bass: Voice | null = null;

function makeVoice(c: AudioContext, out: AudioNode, type: OscillatorType): Voice {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  gain.gain.value = 0;
  osc.connect(gain).connect(out);
  osc.start();
  return { osc, gain };
}

function note(v: Voice | null, freq: number, t: number, dur: number, gain: number): void {
  if (!ctx || !v) return;
  v.osc.frequency.setValueAtTime(freq, t);
  const g = v.gain.gain;
  g.cancelScheduledValues(t);
  g.setValueAtTime(0, t);
  g.linearRampToValueAtTime(gain, t + 0.01);
  g.exponentialRampToValueAtTime(0.0001, t + dur);
}

export function startCarouselMusic(): void {
  if (ctx || typeof AudioContext === "undefined") return;
  try {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    tine = makeVoice(ctx, master, "triangle");
    octave = makeVoice(ctx, master, "sine");
    bass = makeVoice(ctx, master, "sine");
    step = 0;
    timer = window.setInterval(() => {
      if (!ctx || !master) return;
      const st = carouselAt(villageClock.liveMs());
      const on = st.status === "riding" ? Math.min(1, 0.35 + st.omega * 8) : 0.25;
      master.gain.setTargetAtTime(rideMuted() ? 0 : 0.14 * on, ctx.currentTime, 0.2);
      const t = ctx.currentTime + 0.02;
      const beat = 0.34 / Math.max(0.6, 0.6 + st.omega * 4); // slightly quicker as it speeds up
      note(tine, hz(MEL[step % MEL.length]!), t, beat * 1.6, 0.5); // the comb's tine
      note(octave, hz(MEL[step % MEL.length]! + 12), t, beat * 0.9, 0.12);
      if (step % 3 === 0) note(bass, hz(BASS[Math.floor(step / 3) % BASS.length]!), t, beat * 2.5, 0.35);
      step++;
    }, 340);
  } catch {
    ctx = null;
  }
}

export function stopCarouselMusic(): void {
  window.clearInterval(timer);
  const c = ctx;
  const m = master;
  ctx = null;
  master = null;
  tine = octave = bass = null;
  if (!c || !m) return;
  try {
    m.gain.setTargetAtTime(0, c.currentTime, 0.15);
    window.setTimeout(() => void c.close().catch(() => undefined), 600);
  } catch {
    /* ignore */
  }
}

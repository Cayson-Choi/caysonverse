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

function note(freq: number, t: number, dur: number, gain: number, type: OscillatorType): void {
  if (!ctx || !master) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

export function startCarouselMusic(): void {
  if (ctx || typeof AudioContext === "undefined") return;
  try {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    step = 0;
    timer = window.setInterval(() => {
      if (!ctx || !master) return;
      const st = carouselAt(villageClock.liveMs());
      const on = st.status === "riding" ? Math.min(1, 0.35 + st.omega * 8) : 0.25;
      master.gain.setTargetAtTime(rideMuted() ? 0 : 0.14 * on, ctx.currentTime, 0.2);
      const t = ctx.currentTime + 0.02;
      const beat = 0.34 / Math.max(0.6, 0.6 + st.omega * 4); // slightly quicker as it speeds up
      note(hz(MEL[step % MEL.length]!), t, beat * 1.6, 0.5, "triangle"); // the comb's tine
      note(hz(MEL[step % MEL.length]! + 12), t, beat * 0.9, 0.12, "sine");
      if (step % 3 === 0) note(hz(BASS[Math.floor(step / 3) % BASS.length]!), t, beat * 2.5, 0.35, "sine");
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
  if (!c || !m) return;
  try {
    m.gain.setTargetAtTime(0, c.currentTime, 0.15);
    window.setTimeout(() => void c.close().catch(() => undefined), 600);
  } catch {
    /* ignore */
  }
}

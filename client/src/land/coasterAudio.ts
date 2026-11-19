/**
 * The ride's sound (WebAudio, synthesised: no files): wind that rises with speed, the track's rumble, the chain lift's clack.
 * Started by the boarding press (a user gesture), driven every frame from the camera's probe, stopped on getting off.
 * A mute switch lives in the ride panel. Nothing here touches the village's own music.
 */
import { rideProbe } from "./coasterRide";
import { useSoundStore } from "../stores/soundStore";

interface Voices {
  ctx: AudioContext;
  master: GainNode;
  wind: GainNode;
  windFilter: BiquadFilterNode;
  rumble: GainNode;
  rumbleFilter: BiquadFilterNode;
  noise: AudioBufferSourceNode;
  clackBuf: AudioBuffer;
  lastClack: number;
}

let voices: Voices | null = null;
let muted = false;
const KEY = "cv.rideMuted";
try {
  muted = window.localStorage.getItem(KEY) === "1";
} catch {
  /* default */
}

export function rideMuted(): boolean {
  return muted;
}
export function setRideMuted(m: boolean): void {
  muted = m;
  try {
    window.localStorage.setItem(KEY, m ? "1" : "0");
  } catch {
    /* ignore */
  }
  if (voices) voices.master.gain.value = m ? 0 : 0.9;
}

export function startRideAudio(): void {
  if (voices || typeof AudioContext === "undefined") return;
  try {
    const ctx = new AudioContext();
    const master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.9;
    master.connect(ctx.destination);
    // one second of white noise, looped, shared by the wind and the rumble
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = "bandpass";
    windFilter.frequency.value = 600;
    windFilter.Q.value = 0.7;
    const wind = ctx.createGain();
    wind.gain.value = 0;
    const rumbleFilter = ctx.createBiquadFilter();
    rumbleFilter.type = "lowpass";
    rumbleFilter.frequency.value = 160;
    const rumble = ctx.createGain();
    rumble.gain.value = 0;
    noise.connect(windFilter).connect(wind).connect(master);
    noise.connect(rumbleFilter).connect(rumble).connect(master);
    noise.start();
    // the clack: a short burst of noise with a fast decay
    const clackBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.09), ctx.sampleRate);
    const c = clackBuf.getChannelData(0);
    for (let i = 0; i < c.length; i++) c[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.012));
    voices = { ctx, master, wind, windFilter, rumble, rumbleFilter, noise, clackBuf, lastClack: 0 };
  } catch {
    voices = null;
  }
}

export function stopRideAudio(): void {
  const v = voices;
  voices = null;
  if (!v) return;
  try {
    v.master.gain.setTargetAtTime(0, v.ctx.currentTime, 0.15);
    window.setTimeout(() => {
      try {
        v.noise.stop();
        void v.ctx.close();
      } catch {
        /* closed already */
      }
    }, 600);
  } catch {
    /* ignore */
  }
}

/** Per frame while riding. */
export function stepRideAudio(nowMs: number): void {
  const v = voices;
  if (!v) return;
  const t = v.ctx.currentTime;
  // the menu's 소리 switch silences the ride as well as the panel's own mute
  v.master.gain.setTargetAtTime(muted || useSoundStore.getState().muted ? 0 : 0.9, t, 0.1);
  const sp = rideProbe.speed;
  const k = Math.min(1, sp / 26);
  v.wind.gain.setTargetAtTime(0.05 + 0.5 * k * k, t, 0.12);
  v.windFilter.frequency.setTargetAtTime(350 + 1500 * k, t, 0.12);
  v.rumble.gain.setTargetAtTime(sp > 0.5 ? 0.06 + 0.4 * k : 0, t, 0.1);
  v.rumbleFilter.frequency.setTargetAtTime(110 + 140 * k, t, 0.1);
  // the chain lift: about 4 clacks a second at 3.4 m/s while on the lift (slow and steep)
  if (rideProbe.status === "riding" && sp > 2.5 && sp < 4.2 && rideProbe.carPitch > 0.25) {
    if (nowMs - v.lastClack > 230) {
      v.lastClack = nowMs;
      const src = v.ctx.createBufferSource();
      src.buffer = v.clackBuf;
      src.playbackRate.value = 0.85 + Math.random() * 0.3;
      const g = v.ctx.createGain();
      g.gain.value = 0.55;
      src.connect(g).connect(v.master);
      src.start();
    }
  }
}

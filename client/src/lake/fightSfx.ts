// The fight's cues, made with Web Audio on the village's one AudioContext (villageAudio.ts): no sound file. Silent when 소리 is off or the
// context has not been allowed to run yet. `pull` = a short rising blip (reel in), `run` = a falling zip (the line runs out), `danger` = two
// quick low beeps (the line is about to snap), `snap` = a short noise burst.

import { useSoundStore } from "../stores/soundStore";
import { resumeVillageAudio, villageAudioContext } from "../village/villageAudio";

export type FightCue = "pull" | "run" | "danger" | "snap";

export function playFightCue(cue: FightCue): void {
  if (useSoundStore.getState().muted) return;
  const ctx = villageAudioContext();
  if (!ctx) return;
  if (ctx.state !== "running") {
    resumeVillageAudio();
    if ((ctx.state as string) !== "running") return;
  }
  try {
    const t0 = ctx.currentTime + 0.01;
    const tone = (from: number, to: number, at: number, dur: number, level: number, type: OscillatorType = "triangle"): void => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(from, at);
      osc.frequency.exponentialRampToValueAtTime(to, at + dur);
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(level, at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + dur + 0.03);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
    };
    if (cue === "pull") tone(520, 880, t0, 0.14, 0.1);
    else if (cue === "run") tone(900, 360, t0, 0.26, 0.1, "sawtooth");
    else if (cue === "danger") {
      tone(300, 300, t0, 0.09, 0.11, "square");
      tone(300, 300, t0 + 0.14, 0.09, 0.11, "square");
    } else {
      const len = Math.floor(ctx.sampleRate * 0.12);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = ctx.createBufferSource();
      const gain = ctx.createGain();
      src.buffer = buf;
      gain.gain.value = 0.16;
      src.connect(gain).connect(ctx.destination);
      src.start(t0);
      src.onended = () => {
        src.disconnect();
        gain.disconnect();
      };
    }
  } catch {
    // a context in a bad state: no cue, nothing else breaks
  }
}

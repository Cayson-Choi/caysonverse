/**
 * The finder's "found it" sound: a short two-note chime made with Web Audio on the village's one AudioContext
 * (villageAudio.ts) — no sound file. Silent when the game's 🔊 is off, when the context has never been allowed to run
 * (no gesture yet) or where there is no Web Audio.
 */

import { useSoundStore } from "../../stores/soundStore";
import { resumeVillageAudio, villageAudioContext } from "../villageAudio";

/** The two notes (Hz): E6 then B6, a fifth up. */
export const CHIME_NOTES = [1318.5, 1975.5] as const;
/** Seconds between the notes, and each note's ring. */
export const CHIME_GAP = 0.13;
export const CHIME_RING = 0.9;
/** Peak level of a note (the BGM plays around 0.35). */
export const CHIME_LEVEL = 0.12;

export function playFoundChime(): void {
  if (useSoundStore.getState().muted) return;
  const ctx = villageAudioContext();
  if (!ctx) return;
  if (ctx.state !== "running") {
    resumeVillageAudio();
    if ((ctx.state as string) !== "running") return;
  }
  try {
    const t0 = ctx.currentTime + 0.02;
    CHIME_NOTES.forEach((hz, i) => {
      const t = t0 + i * CHIME_GAP;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = hz;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(CHIME_LEVEL, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + CHIME_RING);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + CHIME_RING + 0.05);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
    });
  } catch {
    // A context in a bad state: no chime, nothing else breaks.
  }
}

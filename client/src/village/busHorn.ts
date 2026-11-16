/**
 * The village bus's horn: two short toots of a two-tone horn made with Web Audio on the village's one AudioContext
 * (villageAudio.ts), no sound file. Played when the server's driver has stood a while for someone on the road
 * (shared busDrive.ts); quieter with distance. Silent when the game's sound is off, before the context may run, or where
 * there is no Web Audio.
 */

import { useSoundStore } from "../stores/soundStore";
import { resumeVillageAudio, villageAudioContext } from "./villageAudio";

/** Beyond this (m, camera to bus) the horn is not played. */
export const BUS_HORN_HEAR_M = 45;
/** The two tones (Hz) of a vehicle horn (a major third apart), each toot's length and the gap between toots (s). */
export const BUS_HORN_TONES = [392, 494] as const;
export const BUS_HORN_TOOT_S = 0.22;
export const BUS_HORN_GAP_S = 0.12;
/** Peak level at the bus (the BGM plays around 0.35). */
export const BUS_HORN_LEVEL = 0.1;

/** The level at `distanceM` from the bus: full within 8 m, fading to a quarter at the hearing limit. */
export function busHornLevel(distanceM: number): number {
  const d = Math.max(0, distanceM);
  if (d >= BUS_HORN_HEAR_M) return 0;
  const t = Math.max(0, (d - 8) / (BUS_HORN_HEAR_M - 8));
  return BUS_HORN_LEVEL * (1 - 0.75 * t);
}

export function playBusHorn(distanceM: number): void {
  const level = busHornLevel(distanceM);
  if (level <= 0 || useSoundStore.getState().muted) return;
  const ctx = villageAudioContext();
  if (!ctx) return;
  if (ctx.state !== "running") {
    resumeVillageAudio();
    if ((ctx.state as string) !== "running") return;
  }
  try {
    const t0 = ctx.currentTime + 0.02;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1800;
    filter.connect(ctx.destination);
    const nodes: AudioNode[] = [filter];
    for (let toot = 0; toot < 2; toot++) {
      const t = t0 + toot * (BUS_HORN_TOOT_S + BUS_HORN_GAP_S);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(level, t + 0.015);
      gain.gain.setValueAtTime(level, t + BUS_HORN_TOOT_S - 0.03);
      gain.gain.linearRampToValueAtTime(0, t + BUS_HORN_TOOT_S);
      gain.connect(filter);
      nodes.push(gain);
      for (const hz of BUS_HORN_TONES) {
        const osc = ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.value = hz;
        osc.connect(gain);
        osc.start(t);
        osc.stop(t + BUS_HORN_TOOT_S + 0.02);
        nodes.push(osc);
      }
    }
    const end = t0 + 2 * (BUS_HORN_TOOT_S + BUS_HORN_GAP_S) + 0.1;
    setTimeout(() => {
      for (const n of nodes) {
        try {
          n.disconnect();
        } catch {
          // already gone
        }
      }
    }, Math.ceil((end - ctx.currentTime) * 1000) + 50);
  } catch {
    // A context in a bad state: no horn, nothing else breaks.
  }
}

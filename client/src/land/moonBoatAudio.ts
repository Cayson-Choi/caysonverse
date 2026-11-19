/**
 * 달배's sound (Web Audio, synthesised: no files). One mix; the rider hears all of it, someone near the boat hears it quieter and
 * duller, without the wind and the pad (land/rideSfx.ts sets the level and the air).
 *
 *   - the swing's whoosh: a swept band that opens with the boat's speed, so it swells at the bottom of every pass and dies away at
 *     the ends, growing as the amplitude builds; under it the low breath of the moved air;
 *   - the frame: at each end of the swing a creak of the A-frame and a soft knock, louder for a bigger swing, and now and then a
 *     groan of the hangers;
 *   - the wind: a gusting band, the rider's;
 *   - the dream: a lullaby motif ("달배 자장가", original: eight soft bell notes in D, one at each end of the swing, through a long
 *     echo) over a slow pad of two sines (rider), a rising chime as the boat sets off and a falling one as it stops.
 * Built once; a tick moves parameters and schedules the events at the swing's turns.
 */
import { MOON_MAX_ANGLE, MOON_PERIOD_S, moonBoatAt, type MoonBoatState } from "@caysonverse/shared/land/moonBoat";
import {
  BellPool,
  CreakVoice,
  breath,
  burst,
  clamp01,
  createEcho,
  disconnectAll,
  ease,
  filter,
  gain,
  hz,
  lfo,
  loopSource,
  noiseBuffer,
  seededRandom,
  stopQuiet,
  thud,
} from "./sfx/sfxKit";
import type { RideMix } from "./sfx/rideMix";

export interface MoonBoatInput {
  rider: boolean;
  status: "unloading" | "boarding" | "gate" | "riding";
  /** the swing angle (rad) and its angular speed (rad/s) */
  angle: number;
  omega: number;
}

/** The lullaby: MIDI notes, one at each turn of the swing, round and round (D major). */
export const MOON_MOTIF: readonly number[] = [78, 81, 83, 81, 78, 76, 74, 76];
/** The swing's top angular speed (rad/s): amplitude x angular frequency. */
const OMEGA_TOP = MOON_MAX_ANGLE * ((2 * Math.PI) / MOON_PERIOD_S);

export function buildMoonBoatMix(ctx: BaseAudioContext, out: AudioNode): RideMix<MoonBoatInput> {
  const rnd = seededRandom(0x400b);
  const nodes: AudioNode[] = [];
  const stops: { stop(): void }[] = [];
  const keep = <T extends AudioNode>(n: T): T => {
    nodes.push(n);
    return n;
  };
  const master = keep(gain(ctx, 1));
  master.connect(out);
  const echo = createEcho(ctx, master, 0.46, 0.44, 2600, 0.55);
  nodes.push(...echo.nodes);

  // the swing's whoosh and the breath of air
  const whooshSrc = loopSource(ctx, noiseBuffer(ctx, 4, "pink", 61));
  stops.push(whooshSrc);
  const whooshBand = keep(filter(ctx, "bandpass", 300, 0.6));
  const whooshG = keep(gain(ctx, 0));
  whooshSrc.connect(whooshBand).connect(whooshG).connect(master);
  const airSrc = loopSource(ctx, noiseBuffer(ctx, 4, "brown", 67), 1, 1.2);
  stops.push(airSrc);
  const airLp = keep(filter(ctx, "lowpass", 340, 0.6));
  const airG = keep(gain(ctx, 0));
  airSrc.connect(airLp).connect(airG).connect(master);
  // the wind (rider)
  const windSrc = loopSource(ctx, noiseBuffer(ctx, 4, "pink", 71), 1, 0.6);
  stops.push(windSrc);
  const windBand = keep(filter(ctx, "bandpass", 1500, 0.6));
  const windG = keep(gain(ctx, 0));
  const gust = breath(ctx, 0.17, 0.3);
  windSrc.connect(windBand).connect(gust.node).connect(windG).connect(master);
  stops.push(gust.osc, lfo(ctx, 0.31, 260, windBand.frequency));
  // the pad: D and A, a slow shimmer (rider)
  const padG = keep(gain(ctx, 0));
  padG.connect(echo.input);
  for (const [f, lfoHz] of [[hz(50), 0.23], [hz(57), 0.31], [hz(62), 0.19]] as const) {
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = f;
    const tg = keep(gain(ctx, 0.5));
    o.connect(tg).connect(padG);
    o.start();
    stops.push(o, lfo(ctx, lfoHz, 0.4, tg.gain));
  }

  const creaks = [new CreakVoice(ctx, master), new CreakVoice(ctx, master)];
  const chime = new BellPool(ctx, echo.input, [[1, 1], [2.0, 0.3], [3.0, 0.12], [4.2, 0.05]], 4);

  let prevStatus: MoonBoatInput["status"] | null = null;
  let lastSign = 0;
  let motif = 0;
  let creakN = 0;
  let nextGroan = 4;
  return {
    update(t, inp) {
      const rv = inp.rider ? 1 : 0;
      const riding = inp.status === "riding";
      const sp = clamp01(Math.abs(inp.omega) / OMEGA_TOP);
      const amp = clamp01(Math.abs(inp.angle) / MOON_MAX_ANGLE);
      // whoosh: opens with the speed (strongest at the bottom of a pass)
      ease(whooshG.gain, riding ? 0.03 + 0.36 * Math.pow(sp, 1.4) : 0, t, 0.09);
      ease(whooshBand.frequency, 230 + 1500 * Math.pow(sp, 1.2), t, 0.1);
      ease(airG.gain, riding ? 0.26 * sp : 0, t, 0.12);
      ease(windG.gain, riding ? rv * (0.01 + 0.1 * sp) : 0, t, 0.3);
      ease(padG.gain, riding ? rv * 0.03 * (0.4 + 0.6 * amp) : 0, t, 0.8);

      // the swing's turns: a creak, a knock and the next note of the lullaby
      const sign = inp.omega > 0.02 ? 1 : inp.omega < -0.02 ? -1 : lastSign;
      if (riding && lastSign !== 0 && sign !== lastSign && Math.abs(inp.angle) > 0.18) {
        const k = 0.35 + 0.65 * amp;
        const f = 95 + rnd() * 50;
        creaks[creakN++ % creaks.length]!.fire(t + 0.02, f * (sign > 0 ? 0.85 : 1.2), f * (sign > 0 ? 1.25 : 0.8), 0.4 + 0.3 * amp, (0.05 + 0.07 * amp) * (inp.rider ? 1 : 0.7), 600 + rnd() * 400);
        thud(ctx, master, t + 0.03, 0.07 * k, 75, 40, 0.22);
        burst(ctx, master, t + 0.03, 0.06, 0.03 * k, "bandpass", 900, 1.2);
        chime.ring(hz(MOON_MOTIF[motif++ % MOON_MOTIF.length]!), t + 0.06, 0.09 + 0.05 * amp, 2.8);
      }
      lastSign = sign;
      // now and then a groan of the hangers while it swings high
      if (riding && amp > 0.4 && t >= nextGroan) {
        const f = 70 + rnd() * 40;
        creaks[creakN++ % creaks.length]!.fire(t + 0.05, f, f * 1.18, 0.6, 0.03 * (inp.rider ? 1 : 0.6), 500);
        nextGroan = t + 3 + rnd() * 4;
      }

      // setting off and stopping
      if (riding && prevStatus !== null && prevStatus !== "riding") {
        for (const [i, m] of [74, 78, 81, 86].entries()) chime.ring(hz(m), t + 0.05 + i * 0.22, 0.11, 2.6);
        thud(ctx, master, t + 0.02, 0.1, 90, 45, 0.22);
      } else if (!riding && prevStatus === "riding") {
        for (const [i, m] of [86, 81, 78, 74].entries()) chime.ring(hz(m), t + 0.1 + i * 0.3, 0.09, 3.0);
        thud(ctx, master, t + 0.05, 0.09, 80, 38, 0.3);
      }
      prevStatus = inp.status;
    },
    dispose() {
      for (const s of stops) stopQuiet(s);
      for (const c of creaks) c.dispose();
      chime.dispose();
      disconnectAll(nodes);
    },
  };
}

const ST: MoonBoatState = { cycle: 0, phase: 0, status: "boarding", angle: 0, omega: 0, alpha: 0, rideT: 0, departsInMs: 0 };

/** The boat's state as the mix needs it. */
export function moonBoatInput(nowMs: number, rider: boolean, out: MoonBoatInput = { rider: false, status: "boarding", angle: 0, omega: 0 }): MoonBoatInput {
  moonBoatAt(nowMs, ST);
  out.rider = rider;
  out.status = ST.status;
  out.angle = ST.angle;
  out.omega = ST.omega;
  return out;
}

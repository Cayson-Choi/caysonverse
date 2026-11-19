/**
 * 하늘 등불 바퀴's sound (Web Audio, synthesised: no files). One mix, heard in two ways: the rider hears all of it, someone
 * standing near the wheel hears it quieter, duller and without the wind (the driver, land/rideSfx.ts, sets the level and the air).
 *
 *   - the drive: a soft, low motor hum with a slow gear whirr and a ratchet's tick, steady (the wheel never stops);
 *   - the gondolas: now and then a soft creak of wood and hanger;
 *   - the wind: rises with the height, gusting (rider only);
 *   - the platform: when a gondola comes level with the platform a two-note bell (ding-dong); for the rider's own gondola the door
 *     slides and latches, and it clunks shut as the wheel carries on;
 *   - the fair below: a murmur and a sparse music-box twinkle, fading as the wheel climbs.
 * Built once; a tick only moves parameters and schedules the odd event.
 */
import { wheelAt, wheelSeatAtPlatform, wheelSeatPose, type WheelSeatPose, type WheelState } from "@caysonverse/shared/land/wheel";
import {
  BellPool,
  CreakVoice,
  bakedBuffer,
  breath,
  burst,
  clamp01,
  clank,
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
  smoothstep,
  stopQuiet,
  swish,
  thud,
} from "./sfx/sfxKit";
import type { RideMix } from "./sfx/rideMix";

export interface WheelInput {
  /** the listener is in a gondola (the full mix, the wind) */
  rider: boolean;
  /** "boarding" while a gondola is level with the platform */
  status: "boarding" | "riding";
  /** the listener's height above the ground (m): the rider's seat; 0 on the ground */
  alt: number;
  /** the rider's own gondola is the one at the platform */
  mine: boolean;
}

const FAIR_BELLS = [76, 79, 81, 84, 88]; // an airy pentatonic

export function buildWheelMix(ctx: BaseAudioContext, out: AudioNode): RideMix<WheelInput> {
  const rnd = seededRandom(0x57e1);
  const nodes: AudioNode[] = [];
  const keep = <T extends AudioNode>(n: T): T => {
    nodes.push(n);
    return n;
  };
  const master = keep(gain(ctx, 1));
  master.connect(out);

  // the drive: a low saw hum, a slow gear whirr (a triangle breathing at the tooth rate) and a ratchet's tick
  const humOsc = ctx.createOscillator();
  humOsc.type = "sawtooth";
  humOsc.frequency.value = 46;
  const humLp = keep(filter(ctx, "lowpass", 150, 0.6));
  const humG = keep(gain(ctx, 0));
  humOsc.connect(humLp).connect(humG).connect(master);
  humOsc.start();
  const whirrOsc = ctx.createOscillator();
  whirrOsc.type = "triangle";
  whirrOsc.frequency.value = 188;
  const whirrBand = keep(filter(ctx, "bandpass", 190, 2.2));
  const whirrG = keep(gain(ctx, 0));
  whirrOsc.connect(whirrBand).connect(whirrG).connect(master);
  whirrOsc.start();
  const whirrLfo = lfo(ctx, 6.4, 0.012, whirrG.gain);
  const ratchet = bakedBuffer(ctx, "wheel-ratchet", 3.2, (d, sr) => {
    // eight soft pawl ticks (a click and a tiny thump), a little irregular, in a loop
    const r = seededRandom(5);
    for (let k = 0; k < 8; k++) {
      const at = Math.floor(sr * (k * 0.4 + (r() - 0.5) * 0.03));
      const len = Math.floor(sr * 0.022);
      for (let i = 0; i < len; i++) {
        const env = Math.exp((-7 * i) / len);
        d[(at + i) % d.length]! += ((r() * 2 - 1) * 0.55 + Math.sin((2 * Math.PI * 140 * i) / sr) * 0.7) * env;
      }
    }
  });
  const tick = loopSource(ctx, ratchet);
  const tickLp = keep(filter(ctx, "lowpass", 1800, 0.6));
  const tickG = keep(gain(ctx, 0));
  tick.connect(tickLp).connect(tickG).connect(master);

  // the wind (rider only): a band that opens with the height, gusting
  const windSrc = loopSource(ctx, noiseBuffer(ctx, 4, "pink", 17));
  const windBand = keep(filter(ctx, "bandpass", 500, 0.5));
  const windG = keep(gain(ctx, 0));
  const gust = breath(ctx, 0.11, 0.35);
  windSrc.connect(windBand).connect(gust.node).connect(windG).connect(master);
  const windLfos = [gust.osc, lfo(ctx, 0.27, 140, windBand.frequency)];

  // the fair below: a murmur and a twinkle of bells
  const murmurSrc = loopSource(ctx, noiseBuffer(ctx, 4, "pink", 29), 1, 1.7);
  const murmurBand = keep(filter(ctx, "bandpass", 520, 0.9));
  const murmurLp = keep(filter(ctx, "lowpass", 1500, 0.5));
  const murmurG = keep(gain(ctx, 0));
  const swell = breath(ctx, 0.17, 0.25);
  murmurSrc.connect(murmurBand).connect(murmurLp).connect(swell.node).connect(murmurG).connect(master);
  const murmurLfo = swell.osc;
  const echo = createEcho(ctx, master, 0.34, 0.3, 2800, 0.45);
  nodes.push(...echo.nodes);
  const bells = new BellPool(ctx, echo.input, [[1, 1], [2.0, 0.25], [3.01, 0.08]], 3);
  const chime = new BellPool(ctx, master, [[1, 1], [2.76, 0.4], [5.4, 0.14]], 3);
  const creaks = [new CreakVoice(ctx, master), new CreakVoice(ctx, master)];

  let prevStatus: WheelInput["status"] | null = null;
  let nextCreak = 1.5;
  let nextBell = 3;
  let creakN = 0;
  let bellN = 0;
  return {
    update(t, inp) {
      const alt01 = clamp01(inp.alt / 48);
      const below = 1 - smoothstep(inp.alt / 26);
      const rv = inp.rider ? 1 : 0;
      ease(humG.gain, 0.085, t, 0.4);
      ease(whirrG.gain, 0.02, t, 0.4);
      ease(tickG.gain, 0.2, t, 0.4);
      ease(windG.gain, rv * (0.015 + 0.11 * alt01), t, 0.7);
      ease(windBand.frequency, 320 + alt01 * 900, t, 0.7);
      ease(murmurG.gain, 0.045 * (inp.rider ? below : 1), t, 0.8);

      // a gondola creaks now and then (every 2.5-7 s), a little louder for the rider
      if (t >= nextCreak) {
        const v = creaks[creakN++ % creaks.length]!;
        const f = 85 + rnd() * 60;
        v.fire(t + 0.05, f, f * (rnd() < 0.5 ? 0.8 : 1.3), 0.35 + rnd() * 0.4, (inp.rider ? 0.09 : 0.06) * (0.6 + rnd() * 0.6), 700 + rnd() * 500);
        nextCreak = t + 2.5 + rnd() * 4.5;
      }
      // a music-box twinkle from the fair, mostly heard on the ground
      if (t >= nextBell) {
        bells.ring(hz(FAIR_BELLS[bellN++ % FAIR_BELLS.length]!), t + 0.02, 0.05 * (inp.rider ? below : 1), 2.6);
        nextBell = t + 2.2 + rnd() * 3.4;
      }

      // the platform: a bell as a gondola comes level, the door for the rider's own
      if (inp.status === "boarding" && prevStatus === "riding") {
        const k = inp.rider ? (inp.mine ? 1 : 0.4) : 0.8;
        chime.ring(hz(84), t + 0.03, 0.22 * k, 2.2);
        chime.ring(hz(79), t + 0.58, 0.2 * k, 2.6);
        if (inp.rider && inp.mine) {
          swish(ctx, master, t + 1.1, 0.7, 0.07, 650, 330, 1.1, 0.4); // the door slides
          thud(ctx, master, t + 1.85, 0.16, 130, 60, 0.18); // the latch
          clank(ctx, master, t + 1.85, 0.05, 520);
        }
      } else if (inp.status === "riding" && prevStatus === "boarding" && inp.rider && inp.mine) {
        thud(ctx, master, t + 0.05, 0.12, 120, 55, 0.16);
        burst(ctx, master, t + 0.05, 0.05, 0.05, "bandpass", 1400, 1.5);
        chime.ring(hz(88), t + 0.35, 0.1, 1.8);
      }
      prevStatus = inp.status;
    },
    dispose() {
      for (const s of [humOsc, whirrOsc, tick, windSrc, murmurSrc, whirrLfo, murmurLfo, ...windLfos]) stopQuiet(s);
      for (const c of creaks) c.dispose();
      bells.dispose();
      chime.dispose();
      disconnectAll(nodes);
    },
  };
}

const ST: WheelState = { cycle: 0, phase: 0, status: "boarding", angle: 0, omega: 0, alpha: 0, departsInMs: 0 };
const POSE: WheelSeatPose = { x: 0, y: 0, z: 0, fx: 0, fz: 1, sway: 0, gondola: 0, pivotX: 0, pivotY: 0 };

/** The wheel's state as the mix needs it, for a listener (`slot` >= 0: a rider's seat; -1: on the ground). */
export function wheelInput(nowMs: number, slot: number, out: WheelInput = { rider: false, status: "riding", alt: 0, mine: false }): WheelInput {
  wheelAt(nowMs, ST);
  out.rider = slot >= 0;
  out.status = ST.status;
  out.alt = slot >= 0 ? wheelSeatPose(slot, nowMs, POSE).y : 0;
  out.mine = slot >= 0 && wheelSeatAtPlatform(slot, nowMs);
  return out;
}

/**
 * 구름 낙하탑's sound (Web Audio, synthesised: no files). One mix; the rider hears all of it, someone near the tower hears it
 * quieter, duller and without the rider-only layers (the wind, the scream). The ride's stages drive it:
 *
 *   lift   a strong motor whose pitch and brightness climb with the car, a chain's clack that quickens with the speed, a thin
 *          whine rising above it, the gusting wind thickening with height;
 *   hold   the motor stops and the car locks with a thud, a creak or two of the frame, the wind alone: the tense quiet;
 *   fall   a clank of the release, then a big whoosh that opens with the speed (a swept band plus a bright rush), and for the rider
 *          a soft, breathy group "ahh" (SCREAM_GAIN: gentle on purpose, band-limited, never shrill);
 *   brake  the magnetic brakes' flutter-hiss over a low thrum, falling with the speed; at the station a thud, a puff of released air
 *          and a two-note chime.
 * Built once; a tick moves parameters and schedules the events on the stage's edges.
 */
import { DROP_FALL_V, DROP_TOP_Y, dropAt, type DropStage, type DropState } from "@caysonverse/shared/land/dropTower";
import {
  BellPool,
  CreakVoice,
  bakedBuffer,
  breath,
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
  stopQuiet,
  swish,
  thud,
} from "./sfx/sfxKit";
import type { RideMix } from "./sfx/rideMix";

/** The group "ahh" in the fall, at its peak (a gentle level: the rest of the mix peaks around 0.5). */
export const SCREAM_GAIN = 0.05;
/** The lift's top speed (m/s) for the chain's rate: (42 - 1.4) * 1.5 / 14 s. */
const LIFT_V_MAX = 4.35;

export interface DropInput {
  rider: boolean;
  stage: DropStage;
  /** the car's height (m) and vertical speed (m/s, + up) */
  y: number;
  v: number;
}

export function buildDropMix(ctx: BaseAudioContext, out: AudioNode): RideMix<DropInput> {
  const rnd = seededRandom(0xd209);
  const nodes: AudioNode[] = [];
  const stops: { stop(): void }[] = [];
  const keep = <T extends AudioNode>(n: T): T => {
    nodes.push(n);
    return n;
  };
  const osc = (type: OscillatorType, f: number): OscillatorNode => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    o.start();
    stops.push(o);
    return o;
  };
  const master = keep(gain(ctx, 1));
  master.connect(out);
  const echo = createEcho(ctx, master, 0.31, 0.22, 2400, 0.25);
  nodes.push(...echo.nodes);

  // the lift: motor, its octave, the whine, the chain
  const motor = osc("sawtooth", 52);
  const motorLp = keep(filter(ctx, "lowpass", 220, 0.8));
  const motorG = keep(gain(ctx, 0));
  motor.connect(motorLp).connect(motorG).connect(master);
  const motor2 = osc("sine", 104);
  const motor2G = keep(gain(ctx, 0));
  motor2.connect(motor2G).connect(master);
  const whine = osc("triangle", 420);
  const whineBand = keep(filter(ctx, "bandpass", 700, 3));
  const whineG = keep(gain(ctx, 0));
  whine.connect(whineBand).connect(whineG).connect(master);
  stops.push(lfo(ctx, 5, 8, whine.detune));
  const clackBuf = bakedBuffer(ctx, "drop-clack", 1, (d, sr) => {
    // four chain clacks a second: a short band-limited click with a ring
    const r = seededRandom(9);
    for (let k = 0; k < 4; k++) {
      const at = Math.floor(sr * (k * 0.25));
      const len = Math.floor(sr * 0.05);
      for (let i = 0; i < len; i++) {
        const env = Math.exp((-6 * i) / len);
        d[at + i]! += ((r() * 2 - 1) * 0.5 + Math.sin((2 * Math.PI * (880 + k * 40) * i) / sr) * 0.6) * env * (k === 0 ? 1 : 0.8);
      }
    }
  });
  const clack = loopSource(ctx, clackBuf);
  stops.push(clack);
  const clackLp = keep(filter(ctx, "lowpass", 3400, 0.6));
  const clackG = keep(gain(ctx, 0));
  clack.connect(clackLp).connect(clackG).connect(master);

  // the wind (rider only) and the whoosh / rush
  const windSrc = loopSource(ctx, noiseBuffer(ctx, 4, "pink", 41));
  stops.push(windSrc);
  const windBand = keep(filter(ctx, "bandpass", 420, 0.5));
  const windG = keep(gain(ctx, 0));
  const gust = breath(ctx, 0.13, 0.3);
  windSrc.connect(windBand).connect(gust.node).connect(windG).connect(master);
  stops.push(gust.osc, lfo(ctx, 0.29, 120, windBand.frequency));
  const whooshSrc = loopSource(ctx, noiseBuffer(ctx, 4, "pink", 43), 1, 1.1);
  stops.push(whooshSrc);
  const whooshBand = keep(filter(ctx, "bandpass", 300, 0.7));
  const whooshG = keep(gain(ctx, 0));
  whooshSrc.connect(whooshBand).connect(whooshG).connect(master);
  const rushSrc = loopSource(ctx, noiseBuffer(ctx, 3, "white", 47), 1, 0.4);
  stops.push(rushSrc);
  const rushHp = keep(filter(ctx, "highpass", 2300, 0.6));
  const rushLp = keep(filter(ctx, "lowpass", 5200, 0.5));
  const rushG = keep(gain(ctx, 0));
  rushSrc.connect(rushHp).connect(rushLp).connect(rushG).connect(master);

  // the brakes: a fluttering hiss over a thrum
  const brakeSrc = loopSource(ctx, noiseBuffer(ctx, 3, "white", 53), 1, 0.9);
  stops.push(brakeSrc);
  const brakeHp = keep(filter(ctx, "highpass", 2400, 0.7));
  const brakeLp = keep(filter(ctx, "lowpass", 6500, 0.5));
  const flutter = keep(gain(ctx, 0.5));
  stops.push(lfo(ctx, 38, 0.5, flutter.gain, "triangle"));
  const brakeG = keep(gain(ctx, 0));
  brakeSrc.connect(brakeHp).connect(brakeLp).connect(flutter).connect(brakeG).connect(master);
  const thrum = osc("triangle", 36);
  const thrumLp = keep(filter(ctx, "lowpass", 130, 0.7));
  const thrumG = keep(gain(ctx, 0));
  thrum.connect(thrumLp).connect(thrumG).connect(master);

  // the group "ahh": two detuned saw voices through two formant bands, softly low-passed
  const scL = osc("sawtooth", 560);
  const scH = osc("sawtooth", 700);
  stops.push(lfo(ctx, 5.6, 22, scL.detune), lfo(ctx, 6.1, 26, scH.detune));
  const scF1 = keep(filter(ctx, "bandpass", 850, 3));
  const scF2 = keep(filter(ctx, "bandpass", 1650, 4));
  const scLp = keep(filter(ctx, "lowpass", 3000, 0.5));
  const scG = keep(gain(ctx, 0));
  const scIn = keep(gain(ctx, 1));
  scL.connect(scIn);
  scH.connect(scIn);
  scIn.connect(scF1).connect(scLp);
  scIn.connect(scF2).connect(scLp);
  scLp.connect(scG).connect(echo.input);

  const creaks = [new CreakVoice(ctx, master), new CreakVoice(ctx, master)];
  const bells = new BellPool(ctx, master, [[1, 1], [2.76, 0.3], [5.4, 0.1]], 3);

  let prev: DropStage = "idle";
  return {
    update(t, inp) {
      const rv = inp.rider ? 1 : 0;
      const h = clamp01(inp.y / DROP_TOP_Y);
      const sp = clamp01(Math.abs(inp.v) / DROP_FALL_V);
      const lift = inp.stage === "lift" ? 1 : 0;
      const hold = inp.stage === "hold" ? 1 : 0;
      const fall = inp.stage === "fall" ? 1 : 0;
      const brake = inp.stage === "brake" ? 1 : 0;
      const aloft = lift || hold || fall ? 1 : 0;
      const liftSpeed = clamp01(inp.v / LIFT_V_MAX);

      // the lift
      ease(motorG.gain, lift * (0.16 + 0.1 * h), t, 0.35);
      ease(motor.frequency, 50 + h * 46, t, 0.3);
      ease(motorLp.frequency, 200 + h * 700, t, 0.3);
      ease(motor2G.gain, lift * 0.05, t, 0.35);
      ease(motor2.frequency, 100 + h * 92, t, 0.3);
      ease(whineG.gain, lift * (0.012 + 0.03 * h), t, 0.4);
      ease(whine.frequency, 360 + h * 1500, t, 0.3);
      ease(whineBand.frequency, 500 + h * 1700, t, 0.3);
      ease(clackG.gain, lift * 0.2 * (0.4 + 0.6 * liftSpeed), t, 0.12);
      clack.playbackRate.setTargetAtTime(0.85 + 1.15 * liftSpeed, t, 0.15);
      // the wind: gusting, thicker aloft and in the fall (the rider's)
      ease(windG.gain, rv * aloft * (0.02 + 0.12 * h * (hold ? 1.15 : 1)), t, 0.5);
      ease(windBand.frequency, 300 + h * 500, t, 0.5);
      // the fall: whoosh and rush open with the speed
      const sw = (inp.rider ? 1 : 0.55) * sp;
      ease(whooshG.gain, fall || brake ? sw * sw * 0.55 + sw * 0.05 : 0, t, 0.1);
      ease(whooshBand.frequency, 240 + 2000 * Math.pow(sp, 1.3), t, 0.12);
      ease(rushG.gain, (fall || brake) && inp.rider ? 0.07 * sp * sp * sp : 0, t, 0.1);
      // the brakes
      ease(brakeG.gain, brake * (inp.rider ? 0.11 : 0.08) * (0.25 + sp), t, 0.1);
      ease(thrumG.gain, brake * 0.22, t, 0.1);
      ease(thrum.frequency, 34 + sp * 24, t, 0.1);
      ease(brakeHp.frequency, 1800 + 1500 * sp, t, 0.1);

      // the stages' edges
      if (inp.stage !== prev) {
        if (inp.stage === "lift") {
          clank(ctx, master, t + 0.05, 0.06 * (0.5 + rv), 260);
          thud(ctx, master, t + 0.02, 0.1, 90, 48, 0.22);
        } else if (inp.stage === "hold") {
          thud(ctx, master, t + 0.05, 0.16, 105, 42, 0.3); // the car locks
          for (let k = 0; k < 3; k++) {
            const f = 90 + rnd() * 70;
            creaks[k % 2]!.fire(t + 0.5 + k * 1.3 + rnd() * 0.4, f, f * (rnd() < 0.5 ? 0.8 : 1.35), 0.4 + rnd() * 0.4, (inp.rider ? 0.07 : 0.045) * (0.7 + rnd() * 0.5), 650 + rnd() * 500);
          }
        } else if (inp.stage === "fall") {
          // the release: a clank and a hiss of air, then the group "ahh"
          clank(ctx, master, t + 0.02, 0.14 * (0.5 + rv * 0.5), 280);
          swish(ctx, master, t + 0.02, 0.5, 0.08, 4200, 1800, 0.7, 0.2);
          if (inp.rider) {
            const g = scG.gain;
            g.cancelScheduledValues(t);
            g.setValueAtTime(0, t + 0.2);
            g.linearRampToValueAtTime(SCREAM_GAIN, t + 0.7);
            g.setValueAtTime(SCREAM_GAIN, t + 1.5);
            g.linearRampToValueAtTime(0, t + 2.9);
            for (const [o, f0, f1] of [[scL, 540, 880], [scH, 690, 1090]] as const) {
              o.frequency.cancelScheduledValues(t);
              o.frequency.setValueAtTime(f0, t + 0.2);
              o.frequency.linearRampToValueAtTime(f1, t + 1.4);
              o.frequency.linearRampToValueAtTime(f1 * 0.82, t + 2.9);
            }
          }
        } else if (inp.stage === "brake") {
          thud(ctx, master, t + 0.02, 0.1, 85, 45, 0.25);
        } else if (inp.stage === "rest" && prev === "brake") {
          // the station: a thud, the air released, a two-note chime
          thud(ctx, master, t + 0.03, 0.3 * (0.6 + rv * 0.4), 80, 34, 0.35);
          clank(ctx, master, t + 0.03, 0.08, 230);
          swish(ctx, master, t + 0.15, 0.9, 0.09, 2600, 900, 0.8, 0.15);
          bells.ring(hz(81), t + 0.6, 0.13, 2.2);
          bells.ring(hz(88), t + 1.05, 0.12, 2.6);
        }
        prev = inp.stage;
      }
    },
    dispose() {
      for (const s of stops) stopQuiet(s);
      for (const c of creaks) c.dispose();
      bells.dispose();
      disconnectAll(nodes);
    },
  };
}

const ST: DropState = { cycle: 0, phase: 0, status: "boarding", stage: "idle", y: 0, v: 0, a: 0, rideT: 0, departsInMs: 0 };

/** The tower's state as the mix needs it. */
export function dropInput(nowMs: number, rider: boolean, out: DropInput = { rider: false, stage: "idle", y: 0, v: 0 }): DropInput {
  dropAt(nowMs, ST);
  out.rider = rider;
  out.stage = ST.stage;
  out.y = ST.y;
  out.v = ST.v;
  return out;
}

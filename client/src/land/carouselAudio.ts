/**
 * 달빛 회전목마's sound (Web Audio, synthesised: no files): a band-organ waltz, the platform's rumble, the horses' poles creaking and
 * a bell as it sets off. One mix; the rider hears all of it, someone near the ride hears it quieter and duller (land/rideSfx.ts).
 *
 *   - the tune: "달빛 왈츠", an ORIGINAL 16-bar waltz in C (written for this ride, no borrowed melody): a reedy pipe melody with a
 *     little vibrato, a music-box counter-sparkle an octave up, an "oom-pah-pah" of bass and chords and a brushed snare. It starts as
 *     the ride starts, WINDS UP in pitch and tempo while the platform speeds up and WINDS DOWN as it brakes (one shared pitch bend);
 *   - the platform: a low rumble and a bearing's roll that follow the speed; the poles' creak, more often the faster it turns;
 *   - the bell: three bright dings as the ride sets off, a soft two-note chime as it ends.
 * The tune is music, so it follows the menu's 배경음악 switch and 음악 크기; the machinery follows 소리 only (input.music).
 * Built once; a tick schedules the next beats ahead on the audio clock (so the tempo holds however the timer jitters).
 */
import { CAROUSEL_OMEGA_MAX, carouselAt, type CarouselState } from "@caysonverse/shared/land/carousel";
import {
  BellPool,
  CreakVoice,
  burst,
  createBend,
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
  thud,
} from "./sfx/sfxKit";
import type { RideMix } from "./sfx/rideMix";

export interface CarouselInput {
  rider: boolean;
  status: "unloading" | "boarding" | "gate" | "riding";
  /** the platform's speed as a fraction of its top speed (0..1) */
  speed: number;
  /** the music's level from the menu: 0 when 배경음악 is off, else 음악 크기 (0..1) */
  music: number;
}

// ───────────────────────────────────────── "달빛 왈츠": the tune ─────────────────────────────────────────

/** [midi pitch, beats] per bar (3 beats a bar), 16 bars; 0 = a rest. Bars 1-8 the first strain, 9-16 the second. */
export const WALTZ_MELODY: readonly (readonly (readonly [number, number])[])[] = [
  [[76, 1], [79, 0.5], [76, 0.5], [72, 1]], // 1  C
  [[74, 1], [76, 1], [79, 1]], //            2  C
  [[77, 1], [76, 0.5], [74, 0.5], [72, 1]], // 3  F
  [[76, 2], [72, 1]], //                     4  C
  [[79, 1], [77, 0.5], [76, 0.5], [74, 1]], // 5  G
  [[71, 1], [74, 1], [77, 1]], //            6  G
  [[76, 1], [74, 0.5], [72, 0.5], [67, 1]], // 7  C
  [[72, 2], [0, 1]], //                      8  C
  [[69, 1], [72, 1], [76, 1]], //            9  Am
  [[81, 2], [79, 1]], //                    10  Am
  [[77, 1], [74, 1], [77, 1]], //            11 Dm
  [[79, 2], [71, 1]], //                    12  G
  [[72, 1], [76, 1], [79, 1]], //            13 C
  [[84, 2], [81, 1]], //                    14  F
  [[83, 1], [81, 0.5], [79, 0.5], [77, 1]], // 15 G
  [[76, 1], [72, 2]], //                    16  C
];
/** The chord of each bar: the bass note and the three notes above it. */
const CHORDS = {
  C: { bass: 48, up: [60, 64, 67] },
  F: { bass: 41, up: [60, 65, 69] },
  G: { bass: 43, up: [59, 62, 67] },
  Am: { bass: 45, up: [60, 64, 69] },
  Dm: { bass: 50, up: [62, 65, 69] },
} as const;
export const WALTZ_BARS: readonly (keyof typeof CHORDS)[] = ["C", "C", "F", "C", "G", "G", "C", "C", "Am", "Am", "Dm", "G", "C", "F", "G", "C"];
export const WALTZ_BEATS = WALTZ_BARS.length * 3;
/** Quarter notes a minute at full speed. */
export const WALTZ_BPM = 128;

/** The notes that start inside beat `b` (0..47): {midi, at: offset in beats (0..1), beats: length}. */
export function waltzNotesInBeat(b: number): { midi: number; at: number; beats: number }[] {
  const bar = Math.floor(b / 3) % WALTZ_MELODY.length;
  const inBar = b % 3;
  const out: { midi: number; at: number; beats: number }[] = [];
  let pos = 0;
  for (const [midi, beats] of WALTZ_MELODY[bar]!) {
    if (pos >= inBar && pos < inBar + 1 && midi > 0) out.push({ midi, at: pos - inBar, beats });
    pos += beats;
  }
  return out;
}

/** The bend (cents) a platform at `speed` (0..1) puts on the organ: the winding up and down of a real one. */
export function windBendCents(speed: number): number {
  return -1100 * (1 - smoothstep(speed / 0.55));
}

// ───────────────────────────────────────── the mix ─────────────────────────────────────────

export function buildCarouselMix(ctx: BaseAudioContext, out: AudioNode): RideMix<CarouselInput> {
  const rnd = seededRandom(0xca12);
  const nodes: AudioNode[] = [];
  const stops: { stop(): void }[] = [];
  const keep = <T extends AudioNode>(n: T): T => {
    nodes.push(n);
    return n;
  };
  const master = keep(gain(ctx, 1));
  master.connect(out);
  const bend = createBend(ctx);
  stops.push(bend);
  const osc = (type: OscillatorType, f = 440): OscillatorNode => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    bend.connect(o.detune);
    o.start();
    stops.push(o);
    return o;
  };

  // the music bus: everything of the tune goes through one level (the menu's music switch and volume)
  const music = keep(gain(ctx, 0));
  music.connect(master);
  const echo = createEcho(ctx, music, 0.27, 0.22, 3200, 0.3);
  nodes.push(...echo.nodes);

  // the melody: a reedy pipe (saw + square + an octave sine) through a lowpass, a little vibrato
  const melSaw = osc("sawtooth");
  const melSq = osc("square");
  const melOct = osc("sine");
  const melLp = keep(filter(ctx, "lowpass", 2300, 0.7));
  const melG = keep(gain(ctx, 0));
  const sawG = keep(gain(ctx, 0.5));
  const sqG = keep(gain(ctx, 0.32));
  const octG = keep(gain(ctx, 0.2));
  melSaw.connect(sawG).connect(melLp);
  melSq.connect(sqG).connect(melLp);
  melOct.connect(octG).connect(melLp);
  melLp.connect(melG).connect(echo.input);
  stops.push(lfo(ctx, 5.3, 9, melSaw.detune), lfo(ctx, 5.3, 9, melSq.detune), lfo(ctx, 5.3, 9, melOct.detune));
  // the chords: three square voices through a lowpass, short and bouncy
  const chordG = keep(gain(ctx, 1));
  const chordLp = keep(filter(ctx, "lowpass", 1250, 0.6));
  chordLp.connect(chordG).connect(echo.input);
  const chordOsc = [osc("square"), osc("square"), osc("square")];
  const chordVoiceG = chordOsc.map((o) => {
    const g = keep(gain(ctx, 0));
    o.connect(g).connect(chordLp);
    return g;
  });
  // the bass
  const bassOsc = osc("triangle");
  const bassLp = keep(filter(ctx, "lowpass", 520, 0.6));
  const bassG = keep(gain(ctx, 0));
  bassOsc.connect(bassLp).connect(bassG).connect(music);
  // the snare brush
  const brushSrc = loopSource(ctx, noiseBuffer(ctx, 1, "white", 31));
  stops.push(brushSrc);
  const brushBand = keep(filter(ctx, "bandpass", 3600, 0.9));
  const brushG = keep(gain(ctx, 0));
  brushSrc.connect(brushBand).connect(brushG).connect(music);
  // the music-box sparkle
  const sparkle = new BellPool(ctx, echo.input, [[1, 1], [2.0, 0.3], [4.1, 0.09]], 4);

  // the machinery
  const rumbleSrc = loopSource(ctx, noiseBuffer(ctx, 4, "pink", 37));
  stops.push(rumbleSrc);
  const rumbleLp = keep(filter(ctx, "lowpass", 105, 0.7));
  const rumbleG = keep(gain(ctx, 0));
  rumbleSrc.connect(rumbleLp).connect(rumbleG).connect(master);
  const rollBand = keep(filter(ctx, "bandpass", 260, 1.1));
  const rollG = keep(gain(ctx, 0));
  rumbleSrc.connect(rollBand).connect(rollG).connect(master);
  const creaks = [new CreakVoice(ctx, master), new CreakVoice(ctx, master)];
  const bell = new BellPool(ctx, master, [[1, 1], [2.4, 0.5], [4.2, 0.25], [6.1, 0.1]], 3);

  let prevStatus: CarouselInput["status"] | null = null;
  let playing = false;
  let beatIdx = 0;
  let nextBeat = 0;
  let nextCreak = 0;
  let creakN = 0;
  return {
    update(t, inp) {
      const sp = inp.speed;
      const rv = inp.rider ? 1 : 0.7;
      const bendC = windBendCents(sp);
      ease(bend.offset, bendC, t, 0.15);
      ease(music.gain, 0.16 * inp.music, t, 0.2);
      // the machinery
      ease(rumbleG.gain, 0.22 * sp, t, 0.4);
      ease(rollG.gain, 0.05 * sp, t, 0.4);
      ease(rollBand.frequency, 200 + 160 * sp, t, 0.4);

      const riding = inp.status === "riding";
      // the bell: three dings at the start, a soft two-note chime at the end
      if (riding && prevStatus !== "riding") {
        for (let k = 0; k < 3; k++) bell.ring(hz(88), t + 0.05 + k * 0.33, 0.12 * rv, 1.3);
        thud(ctx, master, t + 0.02, 0.1 * rv, 110, 50, 0.2);
      } else if (!riding && prevStatus === "riding") {
        bell.ring(hz(84), t + 0.2, 0.09 * rv, 1.6);
        bell.ring(hz(79), t + 0.7, 0.08 * rv, 2.0);
        thud(ctx, master, t + 0.1, 0.1 * rv, 100, 45, 0.25);
        burst(ctx, master, t + 0.1, 0.5, 0.025 * rv, "bandpass", 5200, 0.8, 0.05);
      }
      prevStatus = inp.status;

      // the poles' creak
      if (sp > 0.12 && t >= nextCreak) {
        const v = creaks[creakN++ % creaks.length]!;
        const f = 170 + rnd() * 150;
        v.fire(t + 0.03, f, f * (rnd() < 0.5 ? 1.25 : 0.8), 0.22 + rnd() * 0.3, (0.04 + 0.04 * sp) * rv * (0.6 + rnd() * 0.7), 800 + rnd() * 600);
        nextCreak = t + (1.1 - 0.7 * sp) * (0.6 + rnd() * 0.8);
      }

      // the tune: scheduled a little ahead on the audio clock; it begins when the platform stirs and ends when the ride does
      const want = riding && sp > 0.04;
      if (want && !playing) {
        playing = true;
        beatIdx = 0;
        nextBeat = t + 0.08;
      } else if (!want && playing) {
        playing = false;
        for (const g of [melG.gain, bassG.gain, ...chordVoiceG.map((v) => v.gain)]) {
          g.cancelScheduledValues(t);
          g.setTargetAtTime(0, t, 0.06);
        }
      }
      if (playing) {
        const beatDur = 60 / (WALTZ_BPM * Math.pow(2, bendC / 1200));
        let guard = 0;
        while (nextBeat < t + 0.32 && guard++ < 6) {
          scheduleBeat(beatIdx, nextBeat, beatDur);
          beatIdx = (beatIdx + 1) % WALTZ_BEATS;
          nextBeat += beatDur;
        }
      }
    },
    dispose() {
      for (const s of stops) stopQuiet(s);
      for (const c of creaks) c.dispose();
      sparkle.dispose();
      bell.dispose();
      disconnectAll(nodes);
    },
  };

  function scheduleBeat(b: number, at: number, beatDur: number): void {
    const bar = Math.floor(b / 3) % WALTZ_BARS.length;
    const inBar = b % 3;
    const chord = CHORDS[WALTZ_BARS[bar]!];
    // melody notes starting in this beat
    for (const n of waltzNotesInBeat(b)) {
      const t0 = at + n.at * beatDur;
      const f = hz(n.midi);
      const len = n.beats * beatDur;
      for (const o of [melSaw, melSq]) o.frequency.setValueAtTime(f, t0);
      melOct.frequency.setValueAtTime(f * 2, t0);
      const g = melG.gain;
      g.cancelScheduledValues(t0);
      g.setValueAtTime(0.0001, t0);
      g.linearRampToValueAtTime(0.55, t0 + 0.014);
      g.setValueAtTime(0.5, t0 + len * 0.82);
      g.linearRampToValueAtTime(0.0001, t0 + len * 0.95);
      if (n.beats >= 1) sparkle.ring(f * 2, t0, 0.16, 1.4);
    }
    if (inBar === 0) {
      // oom: the bass and a soft kick
      bassOsc.frequency.setValueAtTime(hz(chord.bass), at);
      const g = bassG.gain;
      g.cancelScheduledValues(at);
      g.setValueAtTime(0.0001, at);
      g.linearRampToValueAtTime(0.5, at + 0.012);
      g.setValueAtTime(0.4, at + beatDur * 0.55);
      g.linearRampToValueAtTime(0.0001, at + beatDur * 0.9);
    } else {
      // pah-pah: the chord, short, and the brush
      for (let k = 0; k < 3; k++) {
        chordOsc[k]!.frequency.setValueAtTime(hz(chord.up[k]!), at);
        const g = chordVoiceG[k]!.gain;
        g.cancelScheduledValues(at);
        g.setValueAtTime(0.0001, at);
        g.linearRampToValueAtTime(0.16, at + 0.008);
        g.exponentialRampToValueAtTime(0.0001, at + beatDur * 0.5);
      }
      const bg = brushG.gain;
      bg.cancelScheduledValues(at);
      bg.setValueAtTime(0.0001, at);
      bg.linearRampToValueAtTime(0.09, at + 0.005);
      bg.exponentialRampToValueAtTime(0.0001, at + beatDur * 0.28);
    }
  }
}

const ST: CarouselState = { cycle: 0, phase: 0, status: "boarding", angle: 0, omega: 0, rideT: 0, departsInMs: 0 };

/** The carousel's state as the mix needs it. `music` is the menu's music level (0 off .. 1). */
export function carouselInput(nowMs: number, rider: boolean, music: number, out: CarouselInput = { rider: false, status: "boarding", speed: 0, music: 0 }): CarouselInput {
  carouselAt(nowMs, ST);
  out.rider = rider;
  out.status = ST.status;
  out.speed = Math.min(1, ST.omega / CAROUSEL_OMEGA_MAX);
  out.music = music;
  return out;
}

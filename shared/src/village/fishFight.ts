/**
 * The big fish's fight as a rhythm (owner 2026-11-19: "당기세요 놓으세요 당기세요 놓으세요를 시키는대로 잘 하면 낚이도록"): pure rules, driven
 * by the server clock (fishing.ts calls `stepFight`); the client uses the same `fightSchedule` to show the prompt.
 *
 * The fish alternates between TIRING (`pull`: "당기세요", the angler holds the button and reels it in) and RUNNING (`run`: "놓아주세요",
 * the angler lets go and the line runs out). The schedule is public and seeded (the cast seed), so every screen can show the same
 * command with no extra message; what is private to the rules is the line tension and the distance:
 *   - pull, held     the fish comes closer (progress +), the line gets a little tauter (tension + slowly)
 *   - pull, let go   the fish gains distance (progress -), the line slackens
 *   - run, held      the line is torn against the fish: the tension climbs fast toward the snap (1.0): the line breaks
 *   - run, let go    the line runs out, the tension falls
 * Right after every switch the first `graceMs` are free (a human needs time to react, a phone adds latency): nothing counts either way.
 * The fish is landed when the distance reaches 1; it escapes when the distance falls to 0 (the angler never pulls); the line snaps
 * when the tension reaches 1 (the angler never lets go). Following the commands brings the fish closer each cycle; a bigger fish
 * has more cycles and slightly faster switches.
 */
/** mulberry32 (the same generator as fishing.ts `seededRandom`; copied so this file has no imports): uint32 seed -> [0, 1). */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type FightKind = "pull" | "run";

export const FIGHT = {
  /** Right after a switch nothing counts for this long (ms). */
  graceMs: 500,
  /** The fish is this far in when the fight begins (0 = far, 1 = landed). */
  startProgress: 0.1,
  /** Pulling through a pull stage from the end of the grace brings in 15 % more than the stage's share. */
  slack: 1.15,
  /** Letting go in a pull stage loses 90 % of the stage's share over the whole stage. */
  lossShare: 0.9,
  /** Per second: tension while pulling in a pull stage / letting go (any stage) / holding in a run stage. */
  tensionPull: 0.12,
  tensionFall: 0.9,
  tensionRun: 1.1,
  /** Stage lengths at the base (ms), scaled by `fightPace` and a seeded +-10 %; never shorter than the minimum. */
  pullBaseMs: 2300,
  runBaseMs: 1900,
  firstPullMs: 2800,
  pullMinMs: 1200,
  runMinMs: 1300,
  /** A big fish needs `floor(cm / 15)` cycles, 1..6 (a 35 cm carp: 2; 60 cm: 4; 90 cm: 6). */
  cmPerCycle: 15,
  maxCycles: 6,
} as const;

/** How many run + pull cycles a big fish of `cm` takes (the first pull comes before the first run). */
export function fightCycles(cm: number): number {
  return Math.max(1, Math.min(FIGHT.maxCycles, Math.floor(cm / FIGHT.cmPerCycle)));
}

/** Bigger fish switch a little faster (1 for one cycle, down to 0.78 at six). */
export function fightPace(cycles: number): number {
  return Math.max(0.78, 1 - 0.044 * (cycles - 1));
}

export interface FightSeg {
  kind: FightKind;
  /** ms after the fight began. The last stage (a pull) never ends by itself. */
  startMs: number;
  endMs: number;
  /** Distance gained per second by pulling / lost per second by letting go (pull stages; fractions of the whole). */
  gain: number;
  loss: number;
}

/** The public schedule of a fight: pull, run, pull, run ... pull. `seed` is the cast's public seed (fishing.ts `fishSeed`). */
export function fightSchedule(cm: number, seed: number): FightSeg[] {
  const cycles = fightCycles(cm);
  const pace = fightPace(cycles);
  const rnd = seededRandom((seed ^ 0x6f1d3a7b) >>> 0);
  const share = (1 - FIGHT.startProgress) / (cycles + 1);
  const out: FightSeg[] = [];
  let t = 0;
  for (let i = 0; i <= cycles * 2; i++) {
    const kind: FightKind = i % 2 === 0 ? "pull" : "run";
    const last = i === cycles * 2;
    const jitter = 0.9 + 0.2 * rnd();
    let ms: number;
    if (kind === "pull") ms = Math.max(FIGHT.pullMinMs, Math.round((i === 0 ? FIGHT.firstPullMs : FIGHT.pullBaseMs) * pace * jitter));
    else ms = Math.max(FIGHT.runMinMs, Math.round(FIGHT.runBaseMs * pace * jitter));
    const live = Math.max(300, ms - FIGHT.graceMs) / 1000;
    out.push({
      kind,
      startMs: t,
      endMs: last ? Infinity : t + ms,
      gain: kind === "pull" ? (share * FIGHT.slack) / live : 0,
      loss: kind === "pull" ? (share * FIGHT.lossShare) / (ms / 1000) : 0,
    });
    t += ms;
  }
  return out;
}

/** Which stage `tMs` after the fight began is in: its index, the stage, and whether it is still in its grace. */
export function fightSegAt(sched: readonly FightSeg[], tMs: number): { index: number; seg: FightSeg; inGrace: boolean } {
  let index = 0;
  for (let i = 0; i < sched.length; i++) if (tMs >= sched[i]!.startMs) index = i;
  const seg = sched[index]!;
  return { index, seg, inGrace: tMs - seg.startMs < FIGHT.graceMs };
}

export type FightEvent = "landed" | "snap" | "escape";

export interface FightRun {
  progress: number;
  tension: number;
}

/**
 * Advance the fight from `fromMs` to `toMs` (both ms after it began). `press` is the span [from, to) in which the button counts as
 * held (the last Hold message and its grace), or null. Returns the new values and the first event inside, with its time.
 */
export function stepFight(
  sched: readonly FightSeg[],
  run: FightRun,
  fromMs: number,
  toMs: number,
  press: { from: number; to: number } | null,
): { run: FightRun; event: FightEvent | null; atMs: number } {
  let { progress, tension } = run;
  let t = fromMs;
  const marks = new Set<number>();
  for (const s of sched) {
    marks.add(s.startMs);
    marks.add(s.startMs + FIGHT.graceMs);
  }
  if (press) {
    marks.add(press.from);
    marks.add(press.to);
  }
  const cuts = [...marks].filter((m) => m > fromMs && m < toMs).sort((a, b) => a - b);
  cuts.push(toMs);
  for (const next of cuts) {
    const dt = (next - t) / 1000;
    if (dt <= 0) continue;
    const pressed = press !== null && t >= press.from && t < press.to;
    const { seg, inGrace } = fightSegAt(sched, t);
    let dP = 0;
    let dT = 0;
    if (inGrace) {
      dT = pressed ? 0 : -FIGHT.tensionFall * 0.5;
    } else if (seg.kind === "pull") {
      dP = pressed ? seg.gain : -seg.loss;
      dT = pressed ? FIGHT.tensionPull : -FIGHT.tensionFall;
    } else {
      dT = pressed ? FIGHT.tensionRun : -FIGHT.tensionFall;
    }
    let frac = 1; // the part of this slice that happens before an event
    let event: FightEvent | null = null;
    const p1 = progress + dP * dt;
    const t1 = tension + dT * dt;
    if (t1 >= 1) {
      frac = Math.min(frac, (1 - tension) / (dT * dt));
      event = "snap";
    }
    if (p1 >= 1) {
      const f = (1 - progress) / (dP * dt);
      if (f <= frac) {
        frac = f;
        event = "landed";
      }
    }
    if (p1 <= 0) {
      const f = progress / (-dP * dt);
      if (f < frac) {
        frac = f;
        event = "escape";
      }
    }
    if (event) {
      const at = t + frac * (next - t);
      return { run: { progress: Math.max(0, Math.min(1, progress + dP * dt * frac)), tension: Math.max(0, Math.min(1, tension + dT * dt * frac)) }, event, atMs: at };
    }
    progress = Math.max(0, Math.min(1, p1));
    tension = Math.max(0, Math.min(1, t1));
    t = next;
  }
  return { run: { progress, tension }, event: null, atMs: toMs };
}

/** What a client shows `sinceFightMs` after the fight began: the stage's command, its grace, its number. */
export function fightCommand(sched: readonly FightSeg[], sinceFightMs: number): { kind: FightKind; inGrace: boolean; index: number; last: boolean } {
  const { index, seg, inGrace } = fightSegAt(sched, Math.max(0, sinceFightMs));
  return { kind: seg.kind, inGrace, index, last: index === sched.length - 1 };
}

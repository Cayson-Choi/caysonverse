import { describe, expect, it } from "vitest";
import { FIGHT, fightCommand, fightCycles, fightPace, fightSchedule, stepFight, type FightEvent, type FightKind, type FightRun } from "./fishFight";

/** Play a fight in 50 ms steps with a policy: `press(tMs, kind, inGrace)` = whether the button is held in that step. */
function play(cm: number, seed: number, press: (t: number, kind: FightKind, inGrace: boolean) => boolean, maxMs = 60000) {
  const sched = fightSchedule(cm, seed);
  let run: FightRun = { progress: FIGHT.startProgress, tension: 0 };
  let peakTension = 0;
  const kinds: FightKind[] = [];
  for (let t = 0; t < maxMs; t += 50) {
    const c = fightCommand(sched, t);
    if (kinds[kinds.length - 1] !== c.kind) kinds.push(c.kind);
    const pressed = press(t, c.kind, c.inGrace);
    const r = stepFight(sched, run, t, t + 50, pressed ? { from: t, to: t + 50 } : null);
    run = r.run;
    peakTension = Math.max(peakTension, run.tension);
    if (r.event) return { event: r.event as FightEvent, atMs: r.atMs, run, peakTension, kinds, sched };
  }
  return { event: null, atMs: maxMs, run, peakTension, kinds, sched };
}

/** A human: reacts `lagMs` after the switch (keeps doing the old thing till then), then does what the prompt says. */
const follower = (lagMs: number, cm: number, seed: number) => {
  const sched = fightSchedule(cm, seed);
  return (t: number): boolean => {
    const c = fightCommand(sched, Math.max(0, t - lagMs));
    return c.kind === "pull";
  };
};

describe("the schedule", () => {
  it("is pull, run, pull ... pull: one more pull than runs, `cycles` runs", () => {
    for (const cm of [35, 45, 60, 75, 90, 120]) {
      const s = fightSchedule(cm, 1234);
      const c = fightCycles(cm);
      expect(s.length).toBe(2 * c + 1);
      expect(s[0]!.kind).toBe("pull");
      expect(s.at(-1)!.kind).toBe("pull");
      expect(s.filter((x) => x.kind === "run").length).toBe(c);
      expect(s.at(-1)!.endMs).toBe(Infinity);
    }
  });

  it("bigger fish: more cycles (35 cm: 2, 60 cm: 4, 90 cm: 6) and faster switches", () => {
    expect([30, 35, 45, 60, 75, 90, 200].map(fightCycles)).toEqual([2, 2, 3, 4, 5, 6, 6]);
    expect(fightPace(2)).toBeGreaterThan(fightPace(6));
    const len = (cm: number) => {
      const s = fightSchedule(cm, 7);
      const stages = s.slice(0, -1);
      return stages.reduce((a, x) => a + (x.endMs - x.startMs), 0) / stages.length;
    };
    expect(len(35)).toBeGreaterThan(len(90));
  });

  it("is the same for the same seed (every screen shows the same command) and differs across seeds", () => {
    expect(fightSchedule(60, 99)).toEqual(fightSchedule(60, 99));
    expect(fightSchedule(60, 99).map((x) => x.endMs)).not.toEqual(fightSchedule(60, 100).map((x) => x.endMs));
  });

  it("stages are never shorter than the minimum and the grace is shorter than every stage", () => {
    for (let seed = 0; seed < 50; seed++) {
      for (const cm of [35, 60, 90, 130]) {
        for (const s of fightSchedule(cm, seed).slice(0, -1)) {
          const len = s.endMs - s.startMs;
          expect(len).toBeGreaterThanOrEqual(s.kind === "pull" ? FIGHT.pullMinMs : FIGHT.runMinMs);
          expect(len).toBeGreaterThan(FIGHT.graceMs + 500);
        }
      }
    }
  });
});

describe("the fight", () => {
  it("following the commands lands the fish, at every size, human reaction time 0.1..0.45 s included", () => {
    for (const cm of [35, 45, 60, 75, 90, 130]) {
      for (const lag of [100, 250, 450]) {
        for (let seed = 1; seed <= 12; seed++) {
          const r = play(cm, seed, follower(lag, cm, seed));
          expect(r.event, `${cm} cm lag ${lag} seed ${seed}`).toBe("landed");
          expect(r.peakTension).toBeLessThan(0.9);
        }
      }
    }
  });

  it("a slow phone still lands it: a late reaction of up to 0.9 s (a slow frame + the network + a human) lands every size (owner 2026-11-19: frame rate and timing)", () => {
    for (const cm of [35, 60, 90, 130]) {
      for (const lag of [600, 750, 900]) {
        for (let seed = 1; seed <= 20; seed++) {
          const r = play(cm, seed, follower(lag, cm, seed));
          expect(r.event, `${cm} cm lag ${lag} seed ${seed}`).toBe("landed");
        }
      }
    }
  }, 60000);

  it("the FIRST pull is the most forgiving: the first command is answered up to 1.3 s late (the page just opened it, a slow phone) and the fish still lands, every size", () => {
    for (const cm of [35, 60, 90, 130]) {
      for (let seed = 1; seed <= 20; seed++) {
        const sched = fightSchedule(cm, seed);
        const r = play(cm, seed, (t, kind) => {
          // the first stage is answered 1.3 s late (nothing held before), every later one a normal 0.25 s
          if (fightCommand(sched, t).index === 0) return t >= 1300;
          return fightCommand(sched, t - 250).kind === "pull";
        });
        expect(r.event, `${cm} cm seed ${seed}`).toBe("landed");
      }
    }
  }, 60000);

  it("the outcome does not depend on how often the server steps: 20 ms, 100 ms and 400 ms steps give the same end", () => {
    for (const cm of [35, 90]) {
      for (let seed = 1; seed <= 6; seed++) {
        const sched = fightSchedule(cm, seed);
        const ends = [20, 100, 400].map((step) => {
          let run: FightRun = { progress: FIGHT.startProgress, tension: 0 };
          const press = follower(300, cm, seed);
          for (let t = 0; t < 60000; t += step) {
            // the button state is the same whatever the step (it is read at the start of each stretch)
            const r = stepFight(sched, run, t, t + step, press(t) ? { from: t, to: t + step } : null);
            run = r.run;
            if (r.event) return r.event;
          }
          return "none";
        });
        expect(ends, `${cm} cm seed ${seed}`).toEqual(["landed", "landed", "landed"]);
      }
    }
  }, 60000);

  it("each cycle brings the fish closer: after every pull the distance is larger than after the one before", () => {
    const cm = 75;
    const seed = 5;
    const sched = fightSchedule(cm, seed);
    const press = follower(150, cm, seed);
    let run: FightRun = { progress: FIGHT.startProgress, tension: 0 };
    const afterPull: number[] = [];
    for (let t = 0; t < 60000; t += 50) {
      const r = stepFight(sched, run, t, t + 50, press(t) ? { from: t, to: t + 50 } : null);
      run = r.run;
      for (const s of sched) if (s.kind === "pull" && Math.abs(t + 50 - s.endMs) < 25) afterPull.push(run.progress);
      if (r.event) break;
    }
    expect(afterPull.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < afterPull.length; i++) expect(afterPull[i]).toBeGreaterThan(afterPull[i - 1]!);
  });

  it("holding the button all the time snaps the line, at every size and in the first run at the latest", () => {
    for (const cm of [35, 60, 90, 130]) {
      for (let seed = 1; seed <= 12; seed++) {
        const r = play(cm, seed, () => true);
        expect(r.event, `${cm} cm seed ${seed}`).toBe("snap");
        const firstRun = r.sched.find((s) => s.kind === "run")!;
        expect(r.atMs).toBeGreaterThan(firstRun.startMs);
        expect(r.atMs).toBeLessThan(firstRun.endMs);
      }
    }
  });

  it("never pulling loses the fish (it escapes) by the end of the second pull stage (a few seconds), at every size", () => {
    for (const cm of [35, 60, 90, 130]) {
      for (let seed = 1; seed <= 12; seed++) {
        const r = play(cm, seed, () => false);
        expect(r.event, `${cm} cm seed ${seed}`).toBe("escape");
        expect(r.atMs).toBeLessThan(fightSchedule(cm, seed)[2]!.endMs);
        expect(r.atMs).toBeLessThan(8000);
      }
    }
  });

  it("letting go during a pull stage lets the fish gain distance; pulling during a run stage only raises the tension", () => {
    const cm = 60;
    const seed = 3;
    const sched = fightSchedule(cm, seed);
    // the first pull followed to its end, then the run: pulling raises tension, letting go lowers it
    const t0 = sched[1]!.startMs + FIGHT.graceMs + 50;
    const held = stepFight(sched, { progress: 0.4, tension: 0.2 }, t0, t0 + 300, { from: t0, to: t0 + 300 });
    expect(held.run.tension).toBeGreaterThan(0.2);
    expect(held.run.progress).toBe(0.4);
    const let_go = stepFight(sched, { progress: 0.4, tension: 0.5 }, t0, t0 + 300, null);
    expect(let_go.run.tension).toBeLessThan(0.5);
    expect(let_go.run.progress).toBe(0.4);
    // in a pull stage (after the grace): letting go loses distance, pulling gains it
    const t1 = sched[2]!.startMs + FIGHT.graceMs + 50;
    const gain = stepFight(sched, { progress: 0.4, tension: 0 }, t1, t1 + 300, { from: t1, to: t1 + 300 });
    expect(gain.run.progress).toBeGreaterThan(0.4);
    const loss = stepFight(sched, { progress: 0.4, tension: 0 }, t1, t1 + 300, null);
    expect(loss.run.progress).toBeLessThan(0.4);
  });

  it("the first 0.5 s after every switch are free: neither pulling nor letting go changes the distance or snaps the line", () => {
    const sched = fightSchedule(60, 9);
    for (const s of sched.slice(1)) {
      for (const pressed of [true, false]) {
        const from = s.startMs;
        const to = s.startMs + FIGHT.graceMs - 10;
        const r = stepFight(sched, { progress: 0.5, tension: 0.6 }, from, to, pressed ? { from, to } : null);
        expect(r.event).toBeNull();
        expect(r.run.progress).toBe(0.5);
        expect(r.run.tension).toBeLessThanOrEqual(0.6);
      }
    }
  });

  it("a button already held when the fight starts (pressed to strike and never let go) counts as pulling the first stage", () => {
    // the first stage is a pull: holding from t = 0 gains distance from the end of the grace on
    const r = play(60, 4, (t, kind) => (kind === "pull" ? true : t < 0));
    expect(r.run.progress).toBeGreaterThan(FIGHT.startProgress);
  });

  it("a lapsed hold (the press window ends) counts as letting go: the server keeps a hold only holdGapMs after its last message", () => {
    const sched = fightSchedule(60, 2);
    const t0 = FIGHT.graceMs + 100; // in the first pull stage, after the grace
    const r = stepFight(sched, { progress: 0.3, tension: 0.1 }, t0, t0 + 400, { from: t0, to: t0 + 100 }); // pressed for the first 100 ms only
    const allHeld = stepFight(sched, { progress: 0.3, tension: 0.1 }, t0, t0 + 400, { from: t0, to: t0 + 400 });
    expect(allHeld.run.progress).toBeGreaterThan(r.run.progress);
  });
});

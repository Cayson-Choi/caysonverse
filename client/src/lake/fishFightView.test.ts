import { describe, expect, it } from "vitest";
import { FIGHT, fightSchedule } from "@caysonverse/shared/village/fishFight";
import { fishSeed } from "@caysonverse/shared/village/fishing";
import { FISH_PHASE, emptyFishView } from "./lakeProtocol";
import { fightHint, fightPromptOf, fightWords, reelDistance, reelTension, tensionLevel } from "./fishFightView";
import { lakeButton, lakeCaption, type LakeContext } from "./lakeHudModel";

const view = (patch: object = {}) => ({ ...emptyFishView(), rod: 1, spot: 4, phase: FISH_PHASE.fighting, seq: 3, kind: 6, cm: 60, at: 1000, reel: 0, ...patch });

describe("the fight prompt", () => {
  it("is the public schedule: the same command the server's rules use, at every time", () => {
    const v = view();
    const sched = fightSchedule(60, fishSeed(4, 3));
    for (const seg of sched.slice(0, -1)) {
      const p = fightPromptOf(v, seg.startMs + FIGHT.graceMs + 10)!;
      expect(p.kind).toBe(seg.kind);
      expect(p.inGrace).toBe(false);
      expect(fightPromptOf(v, seg.startMs + 10)!.inGrace).toBe(true);
    }
    expect(fightPromptOf(v, 60_000)!.kind).toBe("pull"); // the last stage has no end
    expect(fightPromptOf(v, 60_000)!.leftMs).toBeNull();
  });

  it("only while fighting, and for a known fish", () => {
    expect(fightPromptOf(view({ phase: FISH_PHASE.lifting }), 100)).toBeNull();
    expect(fightPromptOf(view({ cm: 0 }), 100)).toBeNull();
  });

  it("reads the tension, the distance and the held bit from the wire's fishReel", () => {
    const reel = 128 | 42 | (77 << 8);
    expect(reelDistance(reel)).toBeCloseTo(0.42, 6);
    expect(reelTension(reel)).toBeCloseTo(0.77, 6);
    const p = fightPromptOf(view({ reel }), 100)!;
    expect(p).toMatchObject({ held: true, progress: 0.42, tension: 0.77 });
    expect(tensionLevel(0.2)).toBe("calm");
    expect(tensionLevel(0.5)).toBe("tight");
    expect(tensionLevel(0.8)).toBe("danger");
  });

  it("the words: 당기세요 ⬆ to pull, 놓아주세요 ⬇ to let go; the button says the same and stays one button", () => {
    expect(fightWords("pull")).toEqual({ text: "당기세요", arrow: "⬆" });
    expect(fightWords("run")).toEqual({ text: "놓아주세요", arrow: "⬇" });
    const ctx = (kind: "pull" | "run"): LakeContext => ({ view: view(), nearRental: false, nearChair: -1, seatedAtSpot: true, seatedNoRod: false, fight: { kind, inGrace: false, index: 0, stages: 5, tension: 0, progress: 0.1, held: false, leftMs: 1000 } });
    const pull = lakeButton(ctx("pull"))!;
    const run = lakeButton(ctx("run"))!;
    expect([pull.label, pull.hold, pull.enabled, pull.id]).toEqual(["당기세요", true, true, "cast"]);
    expect([run.label, run.hold, run.enabled, run.id]).toEqual(["놓아주세요", true, true, "cast"]);
    expect(run.tone).toBe("release");
    expect(lakeCaption(ctx("pull"), false)).toBe(""); // the prompt (LakeFight) speaks, not the caption
  });

  it("the hint: the first fight gets the whole rule in one line; later, what to do now; a warning near the snap", () => {
    const p = fightPromptOf(view(), 100)!;
    expect(fightHint(p, false, true)).toContain("꾹 누르면");
    expect(fightHint(p, false, true)).toContain("시키는 대로");
    expect(fightHint(p, true, true)).toContain("버튼을");
    expect(fightHint({ ...p, kind: "run", tension: 0.9 }, false, false)).toContain("지금 놓아요");
    expect(fightHint({ ...p, kind: "pull", tension: 0.1 }, false, false)).toContain("당겨요");
  });

  it("a lost fight says why", () => {
    const c: LakeContext = { view: view({ phase: FISH_PHASE.missed }), nearRental: false, nearChair: -1, seatedAtSpot: true, seatedNoRod: false };
    expect(lakeCaption({ ...c, lostWhy: "snap" }, false)).toContain("끊어졌어요");
    expect(lakeCaption({ ...c, lostWhy: "escape" }, false)).toContain("도망갔어요");
  });
});

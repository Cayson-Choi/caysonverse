import { describe, it, expect } from "vitest";
import { lakeButton, lakeCaption, showReturnButton, showStandButton, type LakeContext } from "./lakeHudModel";
import { FISH_PHASE, FISH_SIG, emptyFishView } from "./lakeProtocol";

type ViewPatch = Partial<ReturnType<typeof emptyFishView>>;
const ctx = (over: Partial<Omit<LakeContext, "view">> & { view?: ViewPatch } = {}): LakeContext => {
  const { view, ...rest } = over;
  return { nearRental: false, nearChair: -1, seatedAtSpot: false, seatedNoRod: false, ...rest, view: { ...emptyFishView(), ...(view ?? {}) } };
};
const seated = (phase: number, extra: ViewPatch = {}) => ctx({ view: { rod: 1, spot: 3, phase, ...extra }, seatedAtSpot: true });

describe("the one big button (design 7.2)", () => {
  it("rent at the pad; nothing elsewhere without a rod", () => {
    expect(lakeButton(ctx({ nearRental: true }))?.label).toBe("낚싯대 빌리기");
    expect(lakeButton(ctx({ nearRental: true }))?.action).toEqual({ kind: "rent" });
    expect(lakeButton(ctx())).toBeNull();
  });
  it("with a rod: sit at a free chair nearby (E), nothing in between, and never the big button for returning the rod", () => {
    const c = ctx({ view: { rod: 1, phase: FISH_PHASE.carry }, nearChair: 7 });
    expect(lakeButton(c)).toMatchObject({ label: "앉아서 낚시", key: "E", action: { kind: "sit", spot: 7 } });
    expect(lakeButton(ctx({ view: { rod: 1, phase: FISH_PHASE.carry }, nearRental: true }))).toBeNull();
    expect(lakeButton(ctx({ view: { rod: 1, phase: FISH_PHASE.carry } }))).toBeNull();
  });
  it("already seated on a fishing chair with a rod (the room's seat, not yet fishing): the button starts the fishing there", () => {
    const b = lakeButton({ ...ctx({ view: { rod: 1, phase: FISH_PHASE.carry }, nearChair: 5 }), onChair: true });
    expect(b).toMatchObject({ label: "여기서 낚시", action: { kind: "sit", spot: 5 } });
  });
  it("returning the rod is a small button on the rental pad only (the thumb that just rented does not give it back)", () => {
    expect(showReturnButton(ctx({ view: { rod: 1, phase: FISH_PHASE.carry }, nearRental: true }))).toBe(true);
    expect(showReturnButton(ctx({ view: { rod: 1, phase: FISH_PHASE.carry } }))).toBe(false);
    expect(showReturnButton(ctx({ nearRental: true }))).toBe(false);
    expect(showReturnButton(ctx({ view: { rod: 1, spot: 2, phase: FISH_PHASE.ready }, nearRental: true, seatedAtSpot: true }))).toBe(false);
  });
  it("seated without a rod: the way to the rental, not a cast", () => {
    const b = lakeButton(ctx({ seatedNoRod: true }));
    expect(b?.action).toEqual({ kind: "goRental" });
    expect(b?.label).toBe("낚싯대 빌리러 가기");
  });
  it("the label of each phase, and only the bite is red and pulls", () => {
    const rows: Array<[number, string, string, boolean]> = [
      [FISH_PHASE.ready, "던지기", "go", true],
      [FISH_PHASE.casting, "던지는 중…", "wait", false],
      [FISH_PHASE.settling, "찌가 서요…", "wait", false],
      [FISH_PHASE.waiting, "기다리는 중…", "wait", false],
      [FISH_PHASE.nibble, "살짝… 아직!", "soft", true],
      [FISH_PHASE.bite, "당겨요!", "alert", true],
      [FISH_PHASE.hooked, "올리는 중…", "wait", false],
      [FISH_PHASE.lifting, "올리는 중…", "wait", false],
      [FISH_PHASE.fighting, "당기세요", "hold", true],
      [FISH_PHASE.landed, "잡았어요!", "done", false],
      [FISH_PHASE.releasing, "놓아주는 중…", "wait", false],
      [FISH_PHASE.missed, "놓쳤어요…", "wait", false],
    ];
    for (const [phase, label, tone, enabled] of rows) {
      const b = lakeButton(seated(phase));
      expect(b?.label, `phase ${phase}`).toBe(label);
      expect(b?.tone, `phase ${phase}`).toBe(tone);
      expect(b?.enabled, `phase ${phase}`).toBe(enabled);
    }
    const strikes = Object.values(FISH_PHASE).filter((p) => lakeButton(seated(p))?.action.kind === "strike");
    expect(strikes).toEqual([FISH_PHASE.bite]);
    const holds = Object.values(FISH_PHASE).filter((p) => lakeButton(seated(p))?.hold);
    expect(holds).toEqual([FISH_PHASE.fighting]);
    // 12.7: no "당겨요!" while waiting, and no other phase says it
    for (const p of Object.values(FISH_PHASE)) if (p !== FISH_PHASE.bite) expect(lakeButton(seated(p))?.label ?? "").not.toContain("당겨요");
  });
  it("a press at the nibble is too early, never a strike (no penalty)", () => {
    expect(lakeButton(seated(FISH_PHASE.nibble))?.action).toEqual({ kind: "tooEarly" });
  });
  it("Space drives the fishing, E the rent, sit and return", () => {
    expect(lakeButton(seated(FISH_PHASE.ready))?.key).toBe("Space");
    expect(lakeButton(ctx({ nearRental: true }))?.key).toBe("E");
  });
});

describe("the words under the top bar", () => {
  it("the first-time words only while waiting", () => {
    expect(lakeCaption(seated(FISH_PHASE.waiting), true)).toBe("찌가 쑥 잠기거나 솟으면 그때 눌러요.");
    expect(lakeCaption(seated(FISH_PHASE.waiting), false)).toBe("찌를 지켜봐요.");
    expect(lakeCaption(seated(FISH_PHASE.ready), true)).not.toContain("솟으면");
  });
  it("the bite names what the float did", () => {
    expect(lakeCaption(seated(FISH_PHASE.bite, { sig: FISH_SIG.rise }), false)).toContain("솟았어요");
    expect(lakeCaption(seated(FISH_PHASE.bite, { sig: FISH_SIG.sink }), false)).toContain("잠겼어요");
  });
  it("a missed bite explains the next time (design 7.1)", () => {
    expect(lakeCaption(seated(FISH_PHASE.missed), false)).toBe("찌가 다시 올라왔어요. 다음엔 빨간 버튼일 때!");
  });
  it("the stand button shows while seated at a spot or on a lake chair without a rod", () => {
    expect(showStandButton(seated(FISH_PHASE.ready))).toBe(true);
    expect(showStandButton(ctx({ seatedNoRod: true }))).toBe(true);
    expect(showStandButton(ctx({ nearRental: true }))).toBe(false);
  });
});

describe("UX 2026-11-16: no rod on a fishing chair", () => {
  it("says to borrow one at the office first (never 던지기)", () => {
    const c = ctx({ seatedNoRod: true });
    expect(lakeCaption(c, false)).toBe("관리소에서 낚싯대를 먼저 빌려요.");
    expect(lakeButton(c)?.label).not.toBe("던지기");
  });
});

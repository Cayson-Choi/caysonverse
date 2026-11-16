import { describe, expect, it, beforeEach, vi } from "vitest";

vi.mock("../net/connection", () => ({ getRoom: () => null }));
vi.mock("../net/transitSync", () => ({ transitNowMs: () => Date.now() }));
import { Bone, Object3D, Vector3 } from "three";
import { FISHING } from "@caysonverse/shared/village/fishing";
import { LAKE_FISH_IDS } from "@caysonverse/shared/village/lakeGear";
import { HANG_END_S, LET_GO_S, NET_SCOOP_S, REEL_S, TO_HAND_S, DROP_S, catchState, lineOnFish, releasePoint, underPos } from "./fishCatch";
import { FISH_PHASE, FISH_SPECIES, emptyFishView } from "./lakeProtocol";
import { clipForPhase, rodBend, stowHandItem } from "./fishingRig";
import { recordCatch } from "./lakeDex";
import { useLakeStore } from "./lakeStore";
import { waveData, WAVE_TILE } from "./lakeWaves";
import { FISH_NOTES, fishCardStyle, CARD_CELL } from "./fishCards";

const view = (phase: number, seq = 3) => ({ ...emptyFishView(), rod: 1, spot: 4, phase, seq, kind: 1, cm: 24 });

describe("the catch's stages (lake v2) fit the server's phases", () => {
  it("lifting: reeled in under the water, out and hanging on the line, into the hand — all inside liftMs", () => {
    const v = view(FISH_PHASE.lifting);
    expect(catchState(v, 0.2).stage).toBe("under");
    expect(catchState(v, REEL_S + 0.05).stage).toBe("surface");
    expect(catchState(v, REEL_S + 0.4).stage).toBe("line");
    expect(catchState(v, HANG_END_S + 0.1).stage).toBe("toHand");
    expect(catchState(v, HANG_END_S + TO_HAND_S + 0.05).stage).toBe("hand");
    expect(HANG_END_S + TO_HAND_S).toBeLessThan(FISHING.liftMs / 1000);
  });
  it("netting: thrashing at the surface, then in the net, inside netMs; release lets go and drops inside releaseMs", () => {
    expect(catchState(view(FISH_PHASE.netting), 0.3).stage).toBe("surface");
    expect(catchState(view(FISH_PHASE.netting), NET_SCOOP_S + 0.2).stage).toBe("net");
    expect(NET_SCOOP_S).toBeLessThan(FISHING.netMs / 1000);
    expect(catchState(view(FISH_PHASE.releasing), 0.2).stage).toBe("show");
    expect(catchState(view(FISH_PHASE.releasing), LET_GO_S + 0.1).stage).toBe("drop");
    expect(LET_GO_S + DROP_S).toBeLessThanOrEqual(FISHING.releaseMs / 1000);
    expect(catchState(view(FISH_PHASE.landed), 1).stage).toBe("show");
    expect(catchState(view(FISH_PHASE.waiting), 1).stage).toBe("none");
  });
  it("the fish under the water starts near the float and comes in under the rod; the line is on it only while hooked", () => {
    const a = { x: 0, y: 0, z: 0, yaw: 0 };
    const b = { x: 0, y: 0, z: 0, yaw: 0 };
    expect(underPos(view(FISH_PHASE.lifting), 0, a)).toBe(true);
    expect(underPos(view(FISH_PHASE.lifting), REEL_S, b)).toBe(true);
    expect(a.y).toBeLessThan(-0.6);
    const r = { x: 0, y: 0, z: 0 };
    expect(releasePoint(4, r)).toBe(true);
    expect(Math.hypot(b.x - r.x, b.z - r.z)).toBeLessThan(Math.hypot(a.x - r.x, a.z - r.z));
    expect(lineOnFish(FISH_PHASE.lifting)).toBe(true);
    expect(lineOnFish(FISH_PHASE.landed)).toBe(false);
  });
  it("the same inputs give the same story on every screen (pure)", () => {
    const p = { x: 0, y: 0, z: 0, yaw: 0 };
    const q = { x: 0, y: 0, z: 0, yaw: 0 };
    underPos(view(FISH_PHASE.fighting, 9), 3.3, p);
    underPos(view(FISH_PHASE.fighting, 9), 3.3, q);
    expect(p).toEqual(q);
  });
  it("the clips: the reel-in before the lift, the fight before the net; the rod bends hard while reeling", () => {
    expect(clipForPhase(FISH_PHASE.lifting, 0.5)).toBe("Fish_Sit_Fight");
    expect(clipForPhase(FISH_PHASE.lifting, REEL_S + 0.1)).toBe("Fish_Sit_Lift");
    expect(clipForPhase(FISH_PHASE.netting, 0.1)).toBe("Fish_Sit_Fight");
    expect(clipForPhase(FISH_PHASE.netting, NET_SCOOP_S)).toBe("Fish_Net");
    expect(rodBend(view(FISH_PHASE.lifting), 0.5)).toBeGreaterThan(0.45);
    expect(rodBend(view(FISH_PHASE.lifting), 2.9)).toBeLessThan(0.3);
  });
});

describe("the held item goes to the shop while the rod is held", () => {
  it("the hand slot is shrunk (the item folds away), the rod's proxy keeps the slot's pose, and it all comes back", () => {
    const hand = new Bone();
    const slot = new Bone();
    hand.add(slot);
    slot.position.set(0, 0.1, 0.02);
    const { proxy, restore } = stowHandItem(slot);
    hand.updateMatrixWorld(true);
    const s = new Vector3().setFromMatrixScale(slot.matrixWorld);
    expect(s.x).toBeLessThan(1e-3);
    const p = new Vector3().setFromMatrixPosition(proxy.matrixWorld);
    expect(p.distanceTo(new Vector3(0, 0.1, 0.02))).toBeLessThan(1e-6);
    expect(new Vector3().setFromMatrixScale(proxy.matrixWorld).x).toBeCloseTo(1, 6);
    restore();
    hand.updateMatrixWorld(true);
    expect(new Vector3().setFromMatrixScale(slot.matrixWorld).x).toBeCloseTo(1, 6);
    expect(proxy.parent).toBeNull();
    expect(hand.children).toEqual([slot]);
    void Object3D;
  });
});

describe("the dex records every species caught (owner 2026-11-16: 4 caught, 1 shown)", () => {
  beforeEach(() => useLakeStore.setState({ dex: {}, card: null }));
  it("four species in a row are all in the dex with their sizes and counts", () => {
    const st = useLakeStore.getState();
    st.landed(4, 29, Date.now()); // 떡붕어
    st.landed(1, 28, Date.now()); // 붕어
    st.landed(2, 9, Date.now()); // 블루길
    st.landed(3, 9, Date.now()); // 피라미
    st.landed(1, 31, Date.now());
    const d = useLakeStore.getState().dex;
    expect(Object.keys(d).sort()).toEqual(["bluegill", "crucian_carp", "minnow", "prussian_carp"]);
    expect(d.crucian_carp).toMatchObject({ best: 31, count: 2 });
    expect(d.prussian_carp).toMatchObject({ best: 29, count: 1 });
  });
  it("recordCatch keeps the other species", () => {
    let dex = {};
    for (const k of [1, 2, 3, 4, 5, 6]) dex = recordCatch(dex, k, 20, 0).dex;
    expect(Object.keys(dex)).toHaveLength(6);
  });
});

describe("the field guide's pictures", () => {
  it("every species has its own cell and a real-world note", () => {
    const seen = new Set<string>();
    for (const id of LAKE_FISH_IDS) {
      const st = fishCardStyle(id, CARD_CELL.w);
      seen.add(st.backgroundPosition);
      expect(FISH_NOTES[id].length).toBeGreaterThan(10);
    }
    expect(seen.size).toBe(LAKE_FISH_IDS.length);
    expect(FISH_SPECIES.map((s) => s.id)).toEqual([...LAKE_FISH_IDS]);
  });
});

describe("the water's wave tile", () => {
  it("tiles seamlessly (the first column continues the last) and the gust noise spans 0..255", () => {
    const d = waveData(64);
    let edge = 0;
    for (let j = 0; j < 64; j++) {
      const a = (j * 64 + 63) * 4;
      const b = (j * 64 + 0) * 4;
      const c = (j * 64 + 62) * 4;
      // the step across the seam is like any other step
      edge = Math.max(edge, Math.abs(d[a]! - d[b]!) - Math.abs(d[a]! - d[c]!) * 3 - 12);
    }
    expect(edge).toBeLessThanOrEqual(0);
    let lo = 255;
    let hi = 0;
    for (let k = 3; k < d.length; k += 4) {
      lo = Math.min(lo, d[k]!);
      hi = Math.max(hi, d[k]!);
    }
    expect(lo).toBe(0);
    expect(hi).toBe(255);
    expect(WAVE_TILE).toBeGreaterThanOrEqual(64);
  });
});

describe("the reel-in (owner 2026-11-17: the fish dragged in as the line is pulled)", () => {
  const v = (reel: number) => ({ ...emptyFishView(), rod: 1, spot: 4, phase: FISH_PHASE.fighting, seq: 5, kind: 6, cm: 55, reel });
  it("held: the fish comes in along the line (nearer the chair the further the fight has gone), at the surface", async () => {
    const { reelHeld, reelProgress, skimming, underPos } = await import("./fishCatch");
    const a = { x: 0, y: 0, z: 0, yaw: 0 };
    const b = { x: 0, y: 0, z: 0, yaw: 0 };
    underPos(v(128 | 10), 3, a, 0.1);
    underPos(v(128 | 90), 3, b, 0.9);
    const r = { x: 0, y: 0, z: 0 };
    releasePoint(4, r);
    expect(Math.hypot(b.x - r.x, b.z - r.z)).toBeLessThan(Math.hypot(a.x - r.x, a.z - r.z) - 1);
    expect(reelHeld(v(128 | 40))).toBe(true);
    expect(reelProgress(v(128 | 40))).toBeCloseTo(0.4);
    expect(skimming(v(128 | 40), 3)).toBe(true);
    expect(skimming(v(40), 3)).toBe(false);
  });
  it("let go: the line slackens (the rod straightens) and the fish runs deeper and wider", async () => {
    const { underPos } = await import("./fishCatch");
    expect(rodBend(v(40), 1)).toBeLessThan(rodBend(v(128 | 40), 1));
    const held = { x: 0, y: 0, z: 0, yaw: 0 };
    const free = { x: 0, y: 0, z: 0, yaw: 0 };
    underPos(v(128 | 40), 3, held, 0.4);
    underPos(v(40), 3, free, 0.4);
    expect(free.y).toBeLessThan(held.y);
  });
  it("the wire carries the fight: fishReel is the hold bit and the progress, only while fighting", async () => {
    const { fishingSync, createFishingState } = await import("@caysonverse/shared/village/fishing");
    const s = { ...createFishingState(), phase: "fighting" as const, holdMs: 1500, holdNeedMs: 3000, holdDown: true };
    expect(fishingSync(s).fishReel).toBe(128 | 50);
    expect(fishingSync({ ...s, holdDown: false }).fishReel).toBe(50);
    expect(fishingSync({ ...s, phase: "lifting" as const }).fishReel).toBe(0);
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";

// lakeNet reaches the room through net/connection (it builds the SDK client on import) and the room clock through transitSync
vi.mock("../net/connection", () => ({ getRoom: () => null }));
vi.mock("../net/transitSync", () => ({ transitNowMs: () => Date.now() }));
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { AnimationClip, BufferAttribute, BufferGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, VectorKeyframeTrack, QuaternionKeyframeTrack } from "three";
import { LAKE_AREA, LAKE_FISHING_SPOTS, LAKE_RENTAL_PAD, lakeSeats } from "@caysonverse/shared/village/lakeLayout";
import { LAKE_SEAT_BASE } from "@caysonverse/shared/village/benchSeats";
import { VILLAGE_SEATS } from "@caysonverse/shared/village/benchSeats";
import { FISHING_CLIPS, RIGHT_ARM_BONES } from "@caysonverse/shared/village/fishingAnims";
import { LAKE_PRESENT, LAKE_URLS } from "./lakeAssets";
import { isRightArmTrack, withoutRightArm } from "./fishAnims";
import { FISHING_CHAIRS, chairSpotOfSeat, inLakeZone, nearestFreeChair, onRentalPad } from "./lakeNearby";
import { patchVillage, trimGeometry } from "./lakeVillagePatch";
import { catchBadge, FISH_PHASE } from "./lakeProtocol";
import { clipForPhase, rodBend } from "./fishingRig";
import { createRod, ROD_FOLDED_M, ROD_OPEN_M } from "./lakeProps";
import { fishingYaw, FISHING_VIEW } from "./lakeCamera";
import { koreaDay, recordCatch } from "./lakeDex";
import { expireLakeUi, useLakeStore, CARD_MS } from "./lakeStore";
import { elapsedSince } from "./lakeNet";

describe("the files the client may ask for (a 404 is a console error)", () => {
  it("the flags equal what is in public/models/lake", () => {
    for (const [name, present] of Object.entries(LAKE_PRESENT)) {
      const file = (LAKE_URLS as Record<string, string>)[name]!.split("?")[0]!;
      expect(existsSync(resolve(__dirname, "../../public", "." + file)), `${name} (${file})`).toBe(present);
    }
  });
});

describe("the seats of the room", () => {
  it("the village list keeps its indexes and the lake follows: the 30 chairs first", () => {
    expect(lakeSeats().length).toBe(56);
    expect(VILLAGE_SEATS.slice(0, LAKE_SEAT_BASE).every((s) => s.lake === undefined)).toBe(true);
    expect(VILLAGE_SEATS.slice(LAKE_SEAT_BASE).every((s) => s.lake !== undefined)).toBe(true);
    for (let i = 0; i < 30; i++) expect((VILLAGE_SEATS[LAKE_SEAT_BASE + i] as unknown as { spot: string }).spot).toBe(LAKE_FISHING_SPOTS[i]!.id);
    expect(FISHING_CHAIRS).toHaveLength(30);
  });
  it("a seat index maps back to its spot", () => {
    expect(chairSpotOfSeat(LAKE_SEAT_BASE)).toBe(0);
    expect(chairSpotOfSeat(LAKE_SEAT_BASE + 29)).toBe(29);
    expect(chairSpotOfSeat(LAKE_SEAT_BASE + 30)).toBe(-1);
    expect(chairSpotOfSeat(3)).toBe(-1);
  });
});

describe("where the angler stands", () => {
  it("the rental pad is the yellow circle", () => {
    expect(onRentalPad(LAKE_RENTAL_PAD.x, LAKE_RENTAL_PAD.z)).toBe(true);
    expect(onRentalPad(LAKE_RENTAL_PAD.x + LAKE_RENTAL_PAD.radius + 0.1, LAKE_RENTAL_PAD.z)).toBe(false);
  });
  it("the zone", () => {
    expect(inLakeZone(100, -10)).toBe(true);
    expect(inLakeZone(60, 0)).toBe(false);
    expect(inLakeZone(150, LAKE_AREA.maxZ + 1)).toBe(false);
  });
  it("beside each of the 30 chairs it is offered (free), and not when taken", () => {
    for (let i = 0; i < 30; i++) {
      const c = FISHING_CHAIRS[i]!;
      const got = nearestFreeChair(c.standX, c.standZ, new Set());
      expect(got, `chair ${i} from its get-up spot`).toBe(i);
      expect(nearestFreeChair(c.standX, c.standZ, new Set([i]))).not.toBe(i);
    }
  });
});

describe("the fishing clips and the rod carrier's arm", () => {
  it("right-arm tracks are found by node name, with or without the dots", () => {
    for (const b of RIGHT_ARM_BONES) {
      expect(isRightArmTrack(`${b}.quaternion`)).toBe(true);
      expect(isRightArmTrack(`${b.replace(".", "")}.quaternion`)).toBe(true);
    }
    expect(isRightArmTrack("upperarm.l.quaternion")).toBe(false);
    expect(isRightArmTrack("upperarml.quaternion")).toBe(false);
    expect(isRightArmTrack("hips.position")).toBe(false);
  });
  it("withoutRightArm keeps every other track and the clip's name and length", () => {
    const q = (n: string) => new QuaternionKeyframeTrack(`${n}.quaternion`, [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]);
    const clip = new AnimationClip("Walking_A", 1, [q("upperarmr"), q("lowerarmr"), q("handslotr"), q("upperarml"), q("hips"), new VectorKeyframeTrack("hips.position", [0, 1], [0, 0, 0, 0, 1, 0])]);
    const out = withoutRightArm(clip);
    expect(out.name).toBe("Walking_A");
    expect(out.duration).toBe(1);
    expect(out.tracks.map((t) => t.name)).toEqual(["upperarml.quaternion", "hips.quaternion", "hips.position"]);
    expect(clip.tracks).toHaveLength(6);
  });
  it("each phase names its clip (or leaves the body to the held sit)", () => {
    const names = Object.keys(FISHING_CLIPS);
    for (const p of Object.values(FISH_PHASE)) {
      const c = clipForPhase(p);
      if (c) expect(names).toContain(c);
    }
    expect(clipForPhase(FISH_PHASE.casting)).toBe("Fish_Sit_Cast");
    expect(clipForPhase(FISH_PHASE.hooked)).toBe("Fish_Sit_Strike");
    expect(clipForPhase(FISH_PHASE.fighting)).toBe("Fish_Sit_Fight");
    expect(clipForPhase(FISH_PHASE.lifting)).toBe("Fish_Sit_Lift");
    expect(clipForPhase(FISH_PHASE.netting)).toBe("Fish_Net");
    expect(clipForPhase(FISH_PHASE.landed)).toBe("Fish_Stand_Show");
    expect(clipForPhase(FISH_PHASE.releasing)).toBe("Fish_Release");
    expect(clipForPhase(FISH_PHASE.none)).toBeNull();
    expect(clipForPhase(FISH_PHASE.carry)).toBeNull();
  });
  it("the rod bends only for a bite, a fight and a lift, within 0..1", () => {
    const v = { rod: 1, spot: 1, phase: 0, seq: 1, sig: 1, kind: 0, cm: 20, at: 0 };
    for (const p of Object.values(FISH_PHASE)) for (let t = 0; t < 4; t += 0.1) {
      const b = rodBend({ ...v, phase: p }, t);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(1);
    }
    expect(rodBend({ ...v, phase: FISH_PHASE.waiting }, 1)).toBe(0);
    expect(rodBend({ ...v, phase: FISH_PHASE.fighting }, 1)).toBeGreaterThan(0.5);
  });
  it("the rod folds to 1.15 m and opens to 3.6 m", () => {
    const rod = createRod();
    const length = () => {
      rod.root.updateMatrixWorld(true);
      return rod.tip.getWorldPosition(new (rod.tip.position.constructor as typeof import("three").Vector3)()).length();
    };
    rod.setUnfold(0);
    expect(length()).toBeCloseTo(ROD_FOLDED_M, 1);
    rod.setUnfold(1);
    expect(length()).toBeCloseTo(ROD_OPEN_M, 1);
    rod.dispose();
  });
});

describe("the fishing camera and the room clock", () => {
  it("over the shoulder, behind the body", () => {
    const y = fishingYaw(0);
    expect(Math.cos(y)).toBeLessThan(-0.9);
    expect(Math.abs(Math.abs(y) - Math.PI)).toBeCloseTo(FISHING_VIEW.shoulder, 5);
  });
  it("a phase stamp of 0 has no elapsed time, and a stamp in the future none either", () => {
    expect(elapsedSince(0)).toBe(0);
    expect(elapsedSince((Date.now() + 100000) >>> 0)).toBe(0);
    const past = elapsedSince((Date.now() - 2000) >>> 0);
    expect(past).toBeGreaterThan(1500);
    expect(past).toBeLessThan(4000);
  });
});

describe("the dex (kept on this device) and the card", () => {
  beforeEach(() => {
    useLakeStore.setState({ dex: {}, card: null, notice: null, toasts: [] });
  });
  it("the first catch of a species is new, a bigger one a record", () => {
    const a = recordCatch({}, 0, 24, Date.UTC(2026, 10, 16, 20));
    expect(a.first).toBe(true);
    expect(a.dex.crucian).toEqual({ best: 24, count: 1, first: "2026-11-17" }); // Korea time is +9
    const b = recordCatch(a.dex, 0, 31, 0);
    expect(b).toMatchObject({ first: false, record: true });
    expect(b.dex.crucian).toMatchObject({ best: 31, count: 2 });
    const c = recordCatch(b.dex, 0, 20, 0);
    expect(c.record).toBe(false);
    expect(recordCatch({}, 99, 1, 0).dex).toEqual({});
    expect(koreaDay(0)).toBe("1970-01-01");
  });
  it("landing a fish shows the card with the badge and fills the dex", () => {
    useLakeStore.getState().landed(0, 31, Date.now());
    const s = useLakeStore.getState();
    expect(s.card).toMatchObject({ kind: 0, cm: 31, first: true, badge: catchBadge(0, 31) });
    expect(s.dex.crucian?.best).toBe(31);
  });
  it("cards and notices time out", () => {
    useLakeStore.getState().landed(1, 12, Date.now());
    useLakeStore.getState().say("테스트", 1);
    expect(useLakeStore.getState().card).not.toBeNull();
    const t0 = performance.now();
    while (performance.now() - t0 < 5) {
      /* wait out the 1 ms notice */
    }
    expect(expireLakeUi()).toBe(true);
    expect(useLakeStore.getState().notice).toBeNull();
    expect(CARD_MS).toBeGreaterThan(3000);
  });
  it("a trophy toast names the angler, the species and the length", () => {
    useLakeStore.getState().trophy({ name: "가나", kind: 5, cm: 72.4 });
    expect(useLakeStore.getState().toasts[0]!.text).toBe("가나님이 잉어 72cm를 낚았어요!");
  });
});

describe("the village patch (design 11.1) works on positions inside the lake zone, never on names", () => {
  const tri = (x: number, z: number, s = 1): number[] => [x, 0, z, x + s, 0, z, x, 0, z + s];
  const geo = (positions: number[]) => {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
    g.setIndex(Array.from({ length: positions.length / 3 }, (_, i) => i));
    return g;
  };
  it("trimGeometry drops only the triangles wholly inside the zone", () => {
    const g = geo([...tri(120, 0), ...tri(LAKE_AREA.minX - 0.5, 0, 1), ...tri(50, 0), ...tri(185, 0, 2)]);
    const t = trimGeometry(g, 0, 0, "wholly");
    expect(t?.removed).toBe(1);
    expect(t!.geometry.index!.count).toBe(9);
    expect(g.index!.count).toBe(12); // the original is not touched
    expect(trimGeometry(geo(tri(50, 0)), 0, 0, "wholly")).toBeNull();
  });
  it("the old water quads are cut by the triangle centre", () => {
    const quad = geo([...tri(90, -10, 30)]); // reaches in from outside: centre (100, -0), in the zone
    expect(trimGeometry(quad, 0, 0, "wholly")).toBeNull();
    expect(trimGeometry(quad, 0, 0, "centre")?.removed).toBe(1);
  });
  it("patchVillage trims meshes and forest instances inside the zone, skips the sky, and restore gives everything back", () => {
    const root = new Group();
    const mat = new MeshBasicMaterial();
    const lake = new Mesh(geo([...tri(120, 0), ...tri(50, 0)]), mat);
    lake.name = "village_lm_21";
    const water = new Mesh(geo(tri(90, -10, 30)), mat);
    water.name = "village_water_20";
    const sky = new Mesh(geo([...tri(120, 0)]), mat);
    sky.name = "village_sky";
    const forest = new InstancedMesh(new BufferGeometry(), mat, 3);
    forest.name = "inst__far_0_0";
    [[50, 0], [120, 0], [150, -20]].forEach(([x, z], i) => forest.setMatrixAt(i, new Matrix4().makeTranslation(x!, 0, z!)));
    root.add(lake, water, sky, forest);
    const original = lake.geometry;
    const patch = patchVillage(root);
    expect(patch.stats.meshes).toBe(2);
    expect(patch.stats.trianglesRemoved).toBe(2);
    expect(patch.stats.instancesRemoved).toBe(2);
    expect(lake.geometry).not.toBe(original);
    expect(lake.geometry.index!.count).toBe(3);
    expect(sky.geometry.index!.count).toBe(3);
    const m = new Matrix4();
    forest.getMatrixAt(0, m);
    expect(m.elements[12]).toBe(50);
    forest.getMatrixAt(1, m);
    expect(m.elements[0]).toBe(0); // scaled to nothing
    // a second patch of the same clone finds nothing more to take out
    expect(patchVillage(root).stats.trianglesRemoved).toBe(0);
    patch.restore();
    expect(lake.geometry).toBe(original);
    forest.getMatrixAt(1, m);
    expect(m.elements[12]).toBe(120);
    expect(m.elements[0]).toBe(1);
  });
});

describe("a tap on a fishing chair means that chair (seatTap)", () => {
  it("the tap lands on the chair's footprint: the walk goes to its own approach spot, from where it is offered", async () => {
    const { seatUnderTap, seatApproachGoal } = await import("../game/seatTap");
    const { villageGeometry, VILLAGE_LAYOUT } = await import("@caysonverse/shared/village/villageLayout");
    const { approachesSeat, SEAT_REACH } = await import("@caysonverse/shared/worldMap");
    const bad: string[] = [];
    for (let i = 0; i < 30; i++) {
      const idx = LAKE_SEAT_BASE + i;
      const s = VILLAGE_SEATS[idx]!;
      const f = { x: s.x - Math.sin(s.yaw) * 0.4, z: s.z - Math.cos(s.yaw) * 0.4 };
      const hit = seatUnderTap(VILLAGE_SEATS, f.x, 0.4, f.z);
      if (hit !== idx) bad.push(`${i}: tap -> ${hit}`);
      const goal = seatApproachGoal(VILLAGE_SEATS, idx, villageGeometry.obstacles, VILLAGE_LAYOUT.areas.village);
      if (!goal || !approachesSeat(s, goal.x, goal.z) || Math.hypot(goal.x - s.x, goal.z - s.z) > SEAT_REACH) bad.push(`${i}: goal ${JSON.stringify(goal)}`);
    }
    expect(bad).toEqual([]);
  }, 120_000);
});

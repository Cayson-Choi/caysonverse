import { describe, expect, it } from "vitest";
import { VILLAGE_ACTIVE_MAP, mapBounds } from "../game/activeMap";
import { planClickMove, simulateWalk } from "../game/clickPlan";
import { GUIDES } from "@caysonverse/shared/village/guides";
import { VILLAGE_LAYOUT } from "@caysonverse/shared/village/villageLayout";
import { FOUNTAIN_SPOT, GUIDE_TOPICS, guideTopic, nearestHousePlace, resolveGuidePlace } from "./guideTopics";
import { MAP_PLACES, mapPlace, wayTo } from "./villagePlaces";

const obstacles = VILLAGE_ACTIVE_MAP.geometry.obstacles;
const bounds = mapBounds(VILLAGE_ACTIVE_MAP);
const furniture = VILLAGE_ACTIVE_MAP.furniture;

/** Walk the legs as mapWalk does (each planned like a click from where the last ended); where it stopped and why. */
function walkWay(fromX: number, fromZ: number, way: readonly { x: number; z: number }[]) {
  let x = fromX;
  let z = fromZ;
  for (let i = 0; i < way.length; i++) {
    const w = way[i]!;
    if (Math.hypot(w.x - x, w.z - z) < 0.6) continue;
    const plan = planClickMove(x, z, { x: w.x, y: 0, z: w.z, ny: 1 }, obstacles, bounds, false, { furniture });
    if (!plan.ok) return { ok: false, leg: i, at: { x, z }, why: plan.reason };
    const walk = simulateWalk(x, z, plan.x, plan.z, obstacles, bounds, undefined, plan.via ?? []);
    x = walk.x;
    z = walk.z;
    if (Math.hypot(w.x - x, w.z - z) > 1.5) return { ok: false, leg: i, at: { x, z }, why: `stopped ${plan.adjusted}` };
  }
  return { ok: true, leg: way.length, at: { x, z }, why: "" };
}

/** Where a player asking the plaza guide stands: 1.3 m in front of it (the e2e's spot) and a few more round it. */
const guide = GUIDES[0]!;
const ASKING_SPOTS = [
  { x: guide.pos.x, z: guide.pos.z + 1.3 },
  { x: guide.pos.x - 1.6, z: guide.pos.z + 0.6 },
  { x: guide.pos.x + 1.5, z: guide.pos.z + 1 },
  { x: guide.pos.x, z: guide.pos.z - 1.4 },
];

describe("the guide's topic pages (2026-11-20)", () => {
  it("has the nine approved topics in order, each with an icon, a title, a summary, 3+ steps and 2+ Q&As", () => {
    expect(GUIDE_TOPICS.map((t) => t.title)).toEqual([
      "처음 왔어요",
      "마을 둘러보기",
      "추모관",
      "집",
      "케이슨랜드 놀이기구",
      "낚시",
      "별 찾기",
      "버스",
      "조작법",
    ]);
    for (const t of GUIDE_TOPICS) {
      expect(guideTopic(t.id)).toBe(t);
      expect(t.summary.length).toBeGreaterThan(8);
      expect(t.steps.length).toBeGreaterThanOrEqual(3);
      expect(t.steps.length).toBeLessThanOrEqual(8);
      expect(t.qas.length).toBeGreaterThanOrEqual(2);
    }
    expect(new Set(GUIDE_TOPICS.map((t) => t.id)).size).toBe(GUIDE_TOPICS.length);
  });

  it("keeps the earlier six Q&As, each under its topic", () => {
    const where = (qa: string) => GUIDE_TOPICS.find((t) => t.qas.some((q) => q.id === qa))?.id;
    expect(where("plaza_guide_1")).toBe("first");
    expect(where("plaza_guide_2")).toBe("memorial");
    expect(where("plaza_guide_lots")).toBe("tour");
    expect(where("plaza_guide_4")).toBe("stars");
    expect(where("plaza_guide_5")).toBe("fishing");
    expect(where("plaza_guide_6")).toBe("house");
    // the house code and the limit, as the owner allowed the guide to tell (HOUSE_POLICY.guideTellsCode)
    expect(guideTopic("house")!.qas.find((q) => q.id === "plaza_guide_6")!.answer).toContain("1004");
    // 케이슨랜드 is open now: the old "곧 열려요" is gone
    for (const t of GUIDE_TOPICS) for (const q of t.qas) expect(q.answer).not.toContain("곧 열려요");
  });

  it("Q&A ids are unique; every line is gentle '~요' Korean with no '!' and no prices", () => {
    const ids = GUIDE_TOPICS.flatMap((t) => t.qas.map((q) => q.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of GUIDE_TOPICS) {
      const lines = [t.summary, ...t.steps.map((s) => s.text), ...t.qas.map((q) => q.answer)];
      for (const l of lines) {
        expect(l, l).not.toContain("!");
        expect(l, l).toMatch(/요\.$/);
        expect(l, l).not.toMatch(/\d+\s*원|만 원/);
      }
      for (const q of t.qas) {
        expect(q.question).not.toContain("!");
        const sentences = q.answer.split(/(?<=[.?])\s+/).filter(Boolean);
        expect(sentences.length).toBeLessThanOrEqual(3);
      }
    }
  });

  it("names the five rides of 케이슨랜드", () => {
    const text = JSON.stringify(guideTopic("park"));
    for (const r of ["별똥별 급행", "하늘 등불 바퀴", "달빛 회전목마", "구름 낙하탑", "달배"]) expect(text).toContain(r);
  });

  it("the star finder and the controls have no place (no 같이 가요, no map); the others have both", () => {
    for (const t of GUIDE_TOPICS) {
      if (t.id === "stars" || t.id === "controls") {
        expect(t.go, t.id).toBeUndefined();
        expect(t.map, t.id).toBeUndefined();
      } else expect(t.map, t.id).toBeDefined();
    }
    expect(GUIDE_TOPICS.filter((t) => t.go).map((t) => t.id)).toEqual(["tour", "memorial", "house", "park", "fishing", "bus"]);
  });

  it("every 지도에서 보기 place is a map place with a label inside the village", () => {
    const b = VILLAGE_LAYOUT.areas.village;
    for (const t of GUIDE_TOPICS) {
      if (!t.map) continue;
      for (const s of ASKING_SPOTS) {
        const place = resolveGuidePlace(t.map, s.x, s.z)!;
        expect(place, t.id).not.toBeNull();
        if (t.map.kind !== "spot") expect(mapPlace(place.id), t.id).toBe(place);
        expect(place.label.x).toBeGreaterThanOrEqual(b.minX);
        expect(place.label.x).toBeLessThanOrEqual(b.maxX);
        expect(place.label.z).toBeGreaterThanOrEqual(b.minZ);
        expect(place.label.z).toBeLessThanOrEqual(b.maxZ);
      }
    }
  });

  it("every 같이 가요 target is a free, walkable spot in the village, reached from where one asks the guide", () => {
    const fails: string[] = [];
    for (const t of GUIDE_TOPICS) {
      if (!t.go) continue;
      for (const s of ASKING_SPOTS) {
        const place = resolveGuidePlace(t.go, s.x, s.z)!;
        const end = place.route[place.route.length - 1]!;
        // the end is free ground (a click there plans as "here" or a walk of a few cm)
        const stand = planClickMove(end.x, end.z + 0.01, { x: end.x, y: 0, z: end.z, ny: 1 }, obstacles, bounds, false, { furniture });
        if (!(stand.ok || stand.reason === "here")) fails.push(`${t.id}: end ${JSON.stringify(stand)}`);
        const r = walkWay(s.x, s.z, wayTo(place, s.x, s.z));
        if (!r.ok) fails.push(`${t.id} from ${s.x},${s.z}: leg ${r.leg} at ${r.at.x.toFixed(1)},${r.at.z.toFixed(1)} (${r.why})`);
        else if (Math.hypot(r.at.x - end.x, r.at.z - end.z) > 1.5) fails.push(`${t.id}: ended ${r.at.x.toFixed(1)},${r.at.z.toFixed(1)}`);
        // the walk goes somewhere (not "already here"): at least a few metres from the guide
        if (Math.hypot(end.x - s.x, end.z - s.z) < 2.5) fails.push(`${t.id}: target too close to the guide`);
      }
    }
    expect(fails).toEqual([]);
  });

  it("the fountain spot is on the plaza, at the basin's south rim, in front of the guide", () => {
    const f = VILLAGE_LAYOUT.plaza.fountain;
    const d = Math.hypot(FOUNTAIN_SPOT.x - f.centre.x, FOUNTAIN_SPOT.z - f.centre.z);
    expect(d).toBeGreaterThan(f.basinDiameter / 2);
    expect(d).toBeLessThan(11); // inside the benches' ring (11 m)
  });

  it("the house page goes to the nearest house's door", () => {
    const houses = MAP_PLACES.filter((m) => m.id.startsWith("house_"));
    expect(houses).toHaveLength(10);
    for (const h of houses) {
      const end = h.route[h.route.length - 1]!;
      expect(nearestHousePlace(end.x, end.z).id).toBe(h.id);
    }
  });
});

import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isBlocked, type AABB } from "../collision";
import { validateAppearance } from "../appearance";
import { PLAYER_RADIUS } from "../worldMap";
import { VILLAGE_COLLIDERS } from "./generated/villageColliders";
import {
  GUIDES,
  GUIDE_COLLIDER_HALF,
  GUIDE_REACH_M,
  guideById,
  guideColliders,
  guideVoiceUrl,
  nearestGuide,
} from "./guides";
import { VILLAGE_LAYOUT, villageGeometry } from "./villageLayout";

// Run from shared/ (like characterManifest.test.ts).
const VOICE_DIR = resolve(process.cwd(), "../client/public/village/voice");
const L = VILLAGE_LAYOUT;
const overlaps = (a: AABB, b: AABB) => a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ;

describe("guides (Task 9A)", () => {
  it("has the plaza guide only (the hall's desk guide was removed, owner 2026-11-17), 3-5 questions, unique voice ids", () => {
    expect(GUIDES.map((g) => g.id)).toEqual(["plaza_guide"]);
    expect(guideById("hall_desk")).toBeNull();
    const voices = GUIDES.flatMap((g) => g.qas.map((q) => q.voice));
    expect(new Set(voices).size).toBe(voices.length);
    for (const g of GUIDES) {
      expect(g.qas.length).toBeGreaterThanOrEqual(3);
      expect(g.qas.length).toBeLessThanOrEqual(6) // the plaza guide: 6 with the houses' code (집 실내 G);
      expect(g.tag).toBe("안내원");
      expect(validateAppearance(g.appearance)).toEqual(g.appearance);
      expect(guideById(g.id)).toBe(g);
    }
    expect(guideById("nobody")).toBeNull();
  });

  it("answers are short, gentle '~요' Korean with no '!'", () => {
    for (const g of GUIDES)
      for (const q of g.qas) {
        expect(q.answer).not.toContain("!");
        expect(q.question).not.toContain("!");
        const sentences = q.answer.split(/(?<=[.?])\s+/).filter(Boolean);
        expect(sentences.length).toBeGreaterThanOrEqual(1);
        expect(sentences.length).toBeLessThanOrEqual(3);
        expect(q.answer).toMatch(/요\.$/);
        expect(q.answer).not.toMatch(/\d+\s*원|만 원/); // no prices
      }
  });

  it("every answer's voice clip exists in client/public/village/voice as a small .m4a", () => {
    for (const g of GUIDES)
      for (const q of g.qas) {
        expect(guideVoiceUrl(q.voice)).toBe(`/village/voice/${q.voice}.m4a`);
        if (q.textOnly) {
          // words only (the lake's way, 2026-11-16): never asked for, so no 404
          expect(existsSync(resolve(VOICE_DIR, `${q.voice}.m4a`))).toBe(false);
          continue;
        }
        const file = resolve(VOICE_DIR, `${q.voice}.m4a`);
        expect(existsSync(file), file).toBe(true);
        expect(statSync(file).size).toBeLessThanOrEqual(60 * 1024);
        expect(statSync(file).size).toBeGreaterThan(4 * 1024);
      }
  });

  it("plaza_guide stands at (5, 12) facing the spawn, clear of the spawn jitter and the plaza's colliders", () => {
    const g = guideById("plaza_guide")!;
    expect(g.pos).toEqual({ x: 5, z: 12 });
    expect(g.area).toBe("village");
    const { spawn } = L;
    const toSpawn = Math.atan2(spawn.x - g.pos.x, spawn.z - g.pos.z);
    expect(g.yaw).toBeCloseTo(toSpawn, 9);
    // a spawn anywhere in the jitter disc is still a free spot beside the guide's collider
    expect(Math.hypot(g.pos.x - spawn.x, g.pos.z - spawn.z)).toBeGreaterThan(spawn.jitter + GUIDE_COLLIDER_HALF * Math.SQRT2 + PLAYER_RADIUS);
    const box = guideColliders([g])[0]!;
    for (const c of VILLAGE_COLLIDERS) expect(overlaps(box, c), JSON.stringify(c)).toBe(false);
  });

  it("nobody stands in the memorial hall any more: no guide, no collider there", () => {
    expect(GUIDES.some((g) => g.area === "hall")).toBe(false);
    const room = L.memorial.interior.room;
    for (const box of guideColliders()) expect(overlaps(box, room)).toBe(false);
  });

  it("each guide has a collider in the walk geometry, so players do not walk through them", () => {
    for (const box of guideColliders()) expect(villageGeometry.obstacles).toContainEqual(box);
    for (const g of GUIDES) expect(isBlocked(g.pos.x, g.pos.z, PLAYER_RADIUS, villageGeometry.obstacles)).toBe(true);
  });

  it("nearestGuide offers a guide of the player's area within the reach only", () => {
    expect(nearestGuide("village", 5, 12 + 1.5)?.guide.id).toBe("plaza_guide");
    expect(nearestGuide("village", 5, 12 + GUIDE_REACH_M + 0.01)).toBeNull();
    expect(nearestGuide("hall", 5, 13)).toBeNull();
    expect(nearestGuide("hall", 305.0, 4.6)).toBeNull();
    expect(nearestGuide("hall", 303.0, 4.0)).toBeNull();
    expect(nearestGuide("village", 301.5, 3.0)).toBeNull();
    expect(nearestGuide("village", Number.NaN, 0)).toBeNull();
  });
});

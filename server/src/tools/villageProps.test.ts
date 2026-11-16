/**
 * Street lamps are solid (owner 2026-11-15). Their colliders come from shared streetPoles.ts, computed the way the art
 * script (art/village/tools/parts_props.py lamp_positions()) places them; village.glb holds one light node per lamp at
 * the lamp's (x, z) (`light__lamp_<n>`). This reads the real file and checks every computed spot has its light there,
 * so the collider cannot drift from the model.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { VILLAGE_LAYOUT } from "@caysonverse/shared/village/villageLayout";
import { lampSpots, bannerSpots, streetPoleColliders } from "@caysonverse/shared/village/streetPoles";
import { villageGeometry } from "@caysonverse/shared/village/villageLayout";
import { isBlocked } from "@caysonverse/shared/collision";
import { PLAYER_RADIUS } from "@caysonverse/shared/worldMap";
import { parseGlb, type Gltf } from "../../../scripts/lib/schoolGlb";

const FILE = path.resolve(__dirname, "../../../client/public/models/village/village.glb");

function lightNodes(): Array<{ x: number; z: number }> {
  const gltf: Gltf = parseGlb(new Uint8Array(fs.readFileSync(FILE))).gltf;
  return (gltf.nodes ?? [])
    .filter((n) => /^light__lamp_\d+$/.test(n.name ?? "") && Array.isArray(n.translation))
    .map((n) => ({ x: n.translation![0]!, z: n.translation![2]! }));
}

describe("village street lamps and banner poles (owner 2026-11-15: the avatar walked through them)", () => {
  it("every computed lamp spot has its light node in village.glb, and the lamp is a collider", () => {
    const lights = lightNodes();
    expect(lights.length).toBeGreaterThanOrEqual(lampSpots(VILLAGE_LAYOUT).length);
    for (const s of lampSpots(VILLAGE_LAYOUT)) {
      expect(lights.some((l) => Math.hypot(l.x - s.x, l.z - s.z) < 0.05), `lamp at ${s.x.toFixed(2)},${s.z.toFixed(2)}`).toBe(true);
      expect(isBlocked(s.x, s.z, PLAYER_RADIUS, villageGeometry.obstacles)).toBe(true);
    }
    for (const s of bannerSpots()) expect(isBlocked(s.x, s.z, PLAYER_RADIUS, villageGeometry.obstacles)).toBe(true);
    expect(streetPoleColliders(VILLAGE_LAYOUT).length).toBe(lampSpots(VILLAGE_LAYOUT).length + bannerSpots().length);
  });
});

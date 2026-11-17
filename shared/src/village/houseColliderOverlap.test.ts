import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HOUSE_NUMBERS, STAIR_PLANS, HOUSE_STAIR_TYPE, houseFloorBounds, localToWorld, type HouseFloor, type HouseNumber } from "./houseAreas";

/**
 * Realism pass 2026-11-17 — nothing may clip (owner: "자동문이 주위의 물체와 겹치잖아 제발 좀 꼼꼼하게 확인해"). A numeric check of every house's
 * generated collision boxes (generated/houses/house_N_colliders.ts, named by their `col__` node in the line comment):
 *  - a furniture box stays inside its floor's room (the walls are outside the room rectangle);
 *  - on floor 2 nothing stands in the stairwell hole; no furniture box overlaps a partition, the 중문 or another furniture box, except
 *    a chair / stool / bench tucked under a table / desk / island, and the wall cabinets / hoods that hang over a counter.
 * The builders' own mesh-level audit (house_common.py `clip_audit`: walls, ceiling, the stair's underside, the stairwell) runs before the bake.
 */

interface NamedBox {
  name: string;
  floor: HouseFloor;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

const LINE = /\{ minX: (-?[\d.]+), maxX: (-?[\d.]+), minZ: (-?[\d.]+), maxZ: (-?[\d.]+) \}, \/\/ col__h(\d+)_(\d)_([a-z0-9_]+)/;

function boxesOf(n: HouseNumber): NamedBox[] {
  const file = path.join(__dirname, "generated", "houses", `house_${n}_colliders.ts`);
  const out: NamedBox[] = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = LINE.exec(line);
    if (!m) continue;
    out.push({ name: m[7], floor: Number(m[6]) as HouseFloor, minX: +m[1], maxX: +m[2], minZ: +m[3], maxZ: +m[4] });
  }
  return out;
}

const isStructure = (b: NamedBox) => /^(wall|stair|part|middoor)/.test(b.name);
const overlap = (a: NamedBox, b: { minX: number; maxX: number; minZ: number; maxZ: number }) =>
  [Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX), Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ)] as const;
const allowedPair = (a: string, b: string) => {
  const p = `${a} ${b}`;
  const tucked = /chair|stool|bench/.test(p) && /table|desk|island/.test(p);
  return tucked || /upper|hood/.test(p);
};

describe("house colliders: nothing clips (realism pass)", () => {
  for (const n of HOUSE_NUMBERS) {
    it(`house ${n}: furniture inside the room, off the stairwell, partitions and each other`, () => {
      const boxes = boxesOf(n);
      expect(boxes.length).toBeGreaterThan(20);
      const problems: string[] = [];
      for (const floor of [1, 2] as const) {
        const room = houseFloorBounds(n, floor);
        const onFloor = boxes.filter((b) => b.floor === floor);
        const furniture = onFloor.filter((b) => !isStructure(b));
        const parts = onFloor.filter((b) => /^(part|middoor)/.test(b.name));
        for (const b of furniture) {
          if (b.minX < room.minX - 0.02 || b.maxX > room.maxX + 0.02 || b.minZ < room.minZ - 0.02 || b.maxZ > room.maxZ + 0.02)
            problems.push(`${floor}F ${b.name} leaves the room`);
          for (const p of parts) {
            const [dx, dz] = overlap(b, p);
            if (dx > 0.01 && dz > 0.01) problems.push(`${floor}F ${b.name} runs into ${p.name}`);
          }
        }
        if (floor === 2) {
          const f = STAIR_PLANS[HOUSE_STAIR_TYPE[n]].footprint;
          const a = localToWorld(n, 2, f.minX, f.minZ);
          const c = localToWorld(n, 2, f.maxX, f.maxZ);
          const hole = { minX: Math.min(a.x, c.x), maxX: Math.max(a.x, c.x), minZ: Math.min(a.z, c.z), maxZ: Math.max(a.z, c.z) };
          for (const b of furniture) {
            const [dx, dz] = overlap(b, hole);
            if (dx > 0.02 && dz > 0.02) problems.push(`2F ${b.name} stands in the stairwell`);
          }
        }
        for (let i = 0; i < furniture.length; i++)
          for (let j = i + 1; j < furniture.length; j++) {
            const [dx, dz] = overlap(furniture[i], furniture[j]);
            if (dx > 0.03 && dz > 0.03 && !allowedPair(furniture[i].name, furniture[j].name))
              problems.push(`${floor}F ${furniture[i].name} x ${furniture[j].name} overlap ${dx.toFixed(2)} x ${dz.toFixed(2)} m`);
          }
      }
      expect(problems).toEqual([]);
    });
  }
});

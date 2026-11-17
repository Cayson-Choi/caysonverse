import { describe, expect, it } from "vitest";
import { VILLAGE_SEATS } from "@caysonverse/shared/village/benchSeats";
import { GENERATED_HOUSES, GENERATED_HOUSE_NUMBERS } from "@caysonverse/shared/village/generated/houses";
import { furnitureClick } from "./furnitureClick";

/*
 * Release 4 regression (houses-real layered pass): a house sofa deeper than a seat's click volume (0.67 m behind the seat, 0.25 m slack
 * round it) let a tap on its backrest from behind fall outside every seat; the ray then entered the neighbours' volumes at the same
 * plane and the float tie went to the next seat (h7_1_1 sat the visitor on h7_1_2). For every backed house seat on a sofa or an
 * armchair: a tap on the top of its own backrest, from behind and above, a little off its middle toward either neighbour, picks it.
 */
type S = (typeof VILLAGE_SEATS)[number] & { id: string; area?: string; furn?: string };

describe("house sofas: a tap on a seat's backrest from behind sits on that seat", () => {
  const seats = VILLAGE_SEATS as readonly S[];
  const furn = new Map<string, string>();
  for (const n of GENERATED_HOUSE_NUMBERS) for (const m of GENERATED_HOUSES[n]!.seats) furn.set(m.id, m.furn);
  const sofaSeats = seats
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => /^h\d+_\d_\d+$/.test(s.id) && ["sofa", "armchair"].includes(furn.get(s.id) ?? "") && (s.lean ?? 0) > 0);

  it("has sofa seats to test", () => expect(sofaSeats.length).toBeGreaterThan(10));

  for (const { s } of sofaSeats) {
    it(`${s.id}`, () => {
      const n = Number(s.id.slice(1, s.id.indexOf("_")));
      const fx = Math.sin(s.yaw);
      const fz = Math.cos(s.yaw);
      // the furniture's box: the collider holding the point just behind the seat
      const bx = s.x - fx * 0.3;
      const bz = s.z - fz * 0.3;
      const box = GENERATED_HOUSES[n as 1]!.colliders.find((c) => bx >= c.minX && bx <= c.maxX && bz >= c.minZ && bz <= c.maxZ);
      expect(box, "the sofa's collider").toBeDefined();
      // how far behind the seat its back face is
      let back = 0;
      for (const x of [box!.minX, box!.maxX]) for (const z of [box!.minZ, box!.maxZ]) back = Math.max(back, -((x - s.x) * fx + (z - s.z) * fz));
      for (const off of [-0.12, 0.12]) {
        const ax = Math.cos(s.yaw) * off;
        const az = -Math.sin(s.yaw) * off;
        const pick = { x: s.x - fx * (back - 0.03) + ax, y: (s.seatY ?? 0.46) + 0.36, z: s.z - fz * (back - 0.03) + az };
        const cam = { x: pick.x - fx * 2.4, y: pick.y + 1.5, z: pick.z - fz * 2.4 };
        const d = { x: pick.x - cam.x, y: pick.y - cam.y, z: pick.z - cam.z };
        const L = Math.hypot(d.x, d.y, d.z);
        const ray = { o: cam, d: { x: d.x / L, y: d.y / L, z: d.z / L } };
        const r = furnitureClick({ ...pick, distance: L }, ray, seats, s.area, () => false, { x: cam.x, z: cam.z }, 0, false);
        expect(r && seats[r.seatIndex!]?.id, `back ${back.toFixed(2)} m, off ${off}`).toBe(s.id);
      }
    });
  }
});

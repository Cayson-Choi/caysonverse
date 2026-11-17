import { describe, expect, it } from "vitest";
import { isBlocked } from "../collision";
import { PLAYER_RADIUS } from "../worldMap";
import { HOUSE_NUMBERS } from "./houseAreas";
import { houseFloorGeometry } from "./housesGeometry";
import { GENERATED_HOUSES } from "./generated/houses";

/**
 * Owner 2026-11-17 ("실제처럼 의자 앞에 가서 앉고 일어서면 의자 앞에 서고 이래야 돼 등받이 있는 의자의 경우에는"): every BACKED house seat — dining and
 * desk chairs, armchairs, sofas — has room to be sat on and stood up from IN FRONT of it (the art pulls each chair out from its table):
 *  - a standing body (PLAYER_RADIUS) a little past the seat's front edge touches no collider but the seat's own furniture;
 *  - the strip from the front edge to that spot is clear (nothing blocks the approach).
 * The game's own get-up spot for each seat is checked by standSpot.test.ts (fix/seat-front).
 */
const FRONT_GAP = 0.44;

describe("house backed seats: a clear stand spot in front", () => {
  const markers = HOUSE_NUMBERS.flatMap((n) => GENERATED_HOUSES[n]?.seats ?? []).filter((m) => m.kind === "backed");
  it("there are backed house seats to check", () => {
    expect(markers.length).toBeGreaterThan(40);
  });
  for (const m of markers) {
    it(`${m.id} (${m.furn})`, () => {
      const g = houseFloorGeometry(m.n, m.floor);
      const fx = Math.sin(m.yaw);
      const fz = Math.cos(m.yaw);
      // the seat's own furniture: the boxes holding its seat point
      const own = (b: { minX: number; maxX: number; minZ: number; maxZ: number }) =>
        m.x >= b.minX - 0.01 && m.x <= b.maxX + 0.01 && m.z >= b.minZ - 0.01 && m.z <= b.maxZ + 0.01;
      const others = g.obstacles.filter((b) => !own(b));
      const t = m.edge + FRONT_GAP;
      const front = { x: m.x + fx * t, z: m.z + fz * t };
      expect(isBlocked(front.x, front.z, PLAYER_RADIUS, others, 0), `front stand point ${front.x.toFixed(2)},${front.z.toFixed(2)}`).toBe(false);
      for (let k = 1; k <= 3; k++) {
        const d = m.edge + (FRONT_GAP * k) / 4;
        expect(isBlocked(m.x + fx * d, m.z + fz * d, 0.2, others, 0), `approach strip at ${d.toFixed(2)} m`).toBe(false);
      }
    });
  }
});

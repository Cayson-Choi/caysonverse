import { describe, expect, it } from "vitest";
import { isBlocked } from "../collision";
import { VILLAGE_SEAT_MARKERS } from "./generated/villageSeatMarkers";
import { villageGeometry } from "./villageLayout";

// vrb2 (seat-front audit, fix/seat-front 6149033): every café terrace chair has 0.6 m of clear floor in front of its seat's
// front edge (toward its table), so a seated player can stand up even with another player beside the chair.
const FWD: Record<string, [number, number]> = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };

describe("café terrace chairs: clear floor in front", () => {
  const cafe = VILLAGE_SEAT_MARKERS.filter((m) => m.id.startsWith("cafe_terrace_"));
  it("finds the 12 chairs", () => {
    expect(cafe).toHaveLength(12);
  });
  it("from the seat's front edge, 0.6 m ahead is open floor (a 5 cm probe every 10 cm, clear of the chair's own 0.22 m box)", () => {
    for (const m of cafe) {
      const [fx, fz] = FWD[m.facing]!;
      for (let d = m.frontEdge + 0.1; d <= m.frontEdge + 0.6 - 0.06 + 1e-9; d += 0.1) {
        expect(isBlocked(m.x + fx * d, m.z + fz * d, 0.05, villageGeometry.obstacles), `${m.id} at ${d.toFixed(2)}`).toBe(false);
      }
    }
  });
});

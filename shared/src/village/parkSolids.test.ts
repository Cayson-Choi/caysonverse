import { describe, expect, it } from "vitest";
import { isBlocked } from "../collision";
import { PLAYER_RADIUS } from "../worldMap";
import { CAROUSEL_PAD, COASTER_PAD, DROP_PAD, MOON_BOAT_PAD, PARK_ARRIVAL, PARK_EXIT_PAD, WHEEL_PAD, PARK_BINS, PARK_LAMPS, PARK_PLANTERS, PARK_SOLIDS, PARK_TROUGHS, parkGeometry } from "./parkArea";
import { PARK_BENCHES } from "./parkBenches";
import { PARK_ISLANDS, islandPoint } from "./parkIslands";

// owner 2026-11-21: the avatar walked through Caysonland's lamp posts, benches and planted islands. Every street prop is a solid now:
// from each of four sides the walker is stopped at it (and slides along), and the paved walks stay open.
const o = parkGeometry.obstacles;
const R = PLAYER_RADIUS;
const blocked = (x: number, z: number): boolean => isBlocked(x, z, R, o);

describe("Caysonland street furniture is solid", () => {
  it("every lamp post stops a walker at its base", () => {
    expect(PARK_LAMPS.length).toBeGreaterThan(40);
    for (const l of PARK_LAMPS) {
      expect(blocked(l.x, l.z), `lamp ${l.x},${l.z}`).toBe(true);
      // from the four sides: a body 0.5 m from the base (its edge 0.1 m off the 0.2 m box) is stopped
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) expect(blocked(l.x + dx * 0.55, l.z + dz * 0.55), `lamp ${l.x},${l.z} ${dx},${dz}`).toBe(true);
    }
  });

  it("every bench is solid along its whole length, free 0.5 m beside it", () => {
    expect(PARK_BENCHES.length).toBe(17);
    for (const [x, z] of PARK_BENCHES) {
      for (const dz of [-0.9, 0, 0.9]) expect(blocked(x, z + dz), `bench ${x},${z}+${dz}`).toBe(true);
      expect(blocked(x + 0.36 + R + 0.1, z), `bench ${x},${z} side`).toBe(false);
      expect(blocked(x - 0.36 - R - 0.1, z), `bench ${x},${z} other side`).toBe(false);
      expect(blocked(x, z + 1 + R + 0.1), `bench ${x},${z} end`).toBe(false);
    }
  });

  it("every bin, planter and plaza trough is solid", () => {
    for (const b of PARK_BINS) expect(blocked(b.x, b.z)).toBe(true);
    for (const p of PARK_PLANTERS) expect(blocked(p.x, p.z)).toBe(true);
    for (const t of PARK_TROUGHS) expect(blocked((t.x0 + t.x1) / 2, (t.z0 + t.z1) / 2)).toBe(true);
  });

  it("the planted islands can't be entered: from four sides each stops at the kerb", () => {
    expect(PARK_ISLANDS).toHaveLength(12);
    for (const island of PARK_ISLANDS) {
      // the bed's middle, and points a third of the way in from each of its four edges, are solid
      for (const [u, v] of [[0, 0], [-0.6, 0], [0.6, 0], [0, 0.45], [0, -0.45]] as const) {
        const p = islandPoint(island, u, v);
        expect(blocked(p.x, p.z), `island ${island[0]},${island[1]} at u${u} v${v}`).toBe(true);
      }
      // 0.6 m off the outline (centre line's far ends and sides) is open lawn or path
      for (const [u, v] of [[-1, 0], [1, 0]] as const) {
        const p = islandPoint(island, u * 1.18, v);
        expect(blocked(p.x, p.z), `island ${island[0]},${island[1]} past its end`).toBe(false);
      }
    }
  });

  it("the promenade, the avenue and the plaza ring stay open", () => {
    for (let z = -176; z <= -122; z += 2) for (const x of [38, 40, 42]) expect(blocked(x, z), `promenade ${x},${z}`).toBe(false);
    for (let x = 75; x <= 325; x += 5) expect(blocked(x, -112.5), `avenue ${x}`).toBe(false);
    for (let z = -100; z <= -30; z += 5) expect(blocked(2, z), `west approach ${z}`).toBe(false);
  });

  it("no new solid sits on a ride's boarding pad, the exit pad or the arrival spot", () => {
    for (const p of [PARK_EXIT_PAD, COASTER_PAD, CAROUSEL_PAD, WHEEL_PAD, MOON_BOAT_PAD, DROP_PAD]) {
      expect(isBlocked(p.x, p.z, 0.3, o), `pad ${p.x},${p.z}`).toBe(false);
    }
    expect(blocked(PARK_ARRIVAL.x, PARK_ARRIVAL.z)).toBe(false);
  });

  it("solids count", () => {
    expect(PARK_SOLIDS.length).toBeGreaterThan(150);
  });
});

// The lake's railings are walls (owner 2026-11-17: "낚시터에 난간을 그냥 통과해버려"): from every rail run, walking straight at it
// from the deck stops short of the rail; the ways in (the pier mouth, the T-end, both walkways, both 좌대) stay open.
import { describe, expect, it } from "vitest";
import { resolveCollision } from "../collision";
import { PLAYER_RADIUS } from "../constants";
import { LAKE_DECKS, LAKE_FISHING_SPOTS, RAIL_THICK, lakeCameraBoxes, lakeRailSegments, lakeSeats } from "./lakeLayout";
import { villageGeometry } from "./villageLayout";

const obstacles = villageGeometry.obstacles;

/** Walk from (x, z) toward (tx, tz) in 5 cm steps (as the game's moves are resolved), return where the body ends. */
function walk(x: number, z: number, tx: number, tz: number): { x: number; z: number } {
  let p = { x, z };
  for (let i = 0; i < 800; i++) {
    const dx = tx - p.x;
    const dz = tz - p.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-3) break;
    const s = Math.min(0.05, d);
    const n = resolveCollision(p.x, p.z, (dx / d) * s, (dz / d) * s, PLAYER_RADIUS, obstacles);
    if (Math.hypot(n.x - p.x, n.z - p.z) < 1e-6) break;
    p = n;
  }
  return p;
}

const deckOf = (id: string) => LAKE_DECKS.find((d) => d.id === id)!.box;

describe("the lake's railings", () => {
  const rails = lakeRailSegments();

  it("every deck's rail runs are there (pier entrance, T-end, both walkways, both 좌대)", () => {
    const decks = new Set(rails.map((r) => r.deck));
    for (const d of ["pier", "pier_t", "walkway_a", "walkway_b", "jwadae_a", "jwadae_b"]) expect(decks.has(d), d).toBe(true);
    expect(rails.length).toBeGreaterThanOrEqual(20);
    for (const r of rails) for (const b of [r.box]) expect(obstacles).toContainEqual(b);
  });

  it("walking straight at any rail from its deck stops on the deck's side (every 0.25 m of every run)", () => {
    const bad: string[] = [];
    for (const r of rails) {
      const box = deckOf(r.deck);
      const cx = (box.minX + box.maxX) / 2;
      const cz = (box.minZ + box.maxZ) / 2;
      const alongX = Math.abs(r.b.x - r.a.x) > Math.abs(r.b.z - r.a.z);
      const len = alongX ? r.b.x - r.a.x : r.b.z - r.a.z;
      for (let s = 0.05; s <= len - 0.05 + 1e-9; s += 0.25) {
        const rx = alongX ? r.a.x + s : r.a.x;
        const rz = alongX ? r.a.z : r.a.z + s;
        // the deck's side of the rail and the far side
        const nx = alongX ? 0 : Math.sign(cx - rx);
        const nz = alongX ? Math.sign(cz - rz) : 0;
        const from = { x: rx + nx * 0.7, z: rz + nz * 0.7 };
        const end = walk(from.x, from.z, rx - nx * 1.5, rz - nz * 1.5);
        const side = (end.x - rx) * nx + (end.z - rz) * nz;
        if (side < PLAYER_RADIUS + RAIL_THICK / 2 - 0.02) bad.push(`${r.deck} rail at (${rx.toFixed(2)}, ${rz.toFixed(2)}): crossed to ${side.toFixed(2)} m`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("the ways in stay open: from the shore along the pier, onto the T-end, down both walkways onto both 좌대", () => {
    const legs: Array<[number, number, number, number]> = [
      [104, -12, 139, -12],
      [139, -12, 143, -12],
      [143, -12, 143, -26.8],
      [143, -12, 143, 2.8],
    ];
    for (const [x, z, tx, tz] of legs) {
      const e = walk(x, z, tx, tz);
      expect(Math.hypot(e.x - tx, e.z - tz), `(${x}, ${z}) -> (${tx}, ${tz}) stopped at (${e.x.toFixed(2)}, ${e.z.toFixed(2)})`).toBeLessThan(0.1);
    }
  });

  it("every fishing chair on a deck keeps its opening (no rail in front of it) and its seat's stand spot", () => {
    for (const s of LAKE_FISHING_SPOTS) {
      for (const r of rails) {
        const alongX = Math.abs(r.b.x - r.a.x) > Math.abs(r.b.z - r.a.z);
        const inRun = alongX ? s.anchor.x > r.a.x + 0.3 && s.anchor.x < r.b.x - 0.3 && Math.abs(s.anchor.z - r.a.z) < 0.5 : s.anchor.z > r.a.z + 0.3 && s.anchor.z < r.b.z - 0.3 && Math.abs(s.anchor.x - r.a.x) < 0.5;
        expect(inRun, `${s.id} behind ${r.deck}'s rail`).toBe(false);
      }
    }
    expect(lakeSeats().filter((s) => s.kind === "fishing_chair")).toHaveLength(30);
  });

  it("rails are props for the camera: they never shorten the camera arm", () => {
    const cams = lakeCameraBoxes();
    for (const r of rails) expect(cams).not.toContainEqual(expect.objectContaining(r.box));
  });
});

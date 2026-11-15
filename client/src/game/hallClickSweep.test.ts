/**
 * Round 9 review (2026-11-15): up from the north letter chairs, a click on the exit or the hall's centre was "unreachable" and
 * nothing happened; from the aisle a tap on letter_n1 went round the east cubby wall. The hall's 1.3 m central aisle had no
 * cell of the way-round grid (0.5 m with the clearance), and a body squeezed between two chairs had no open cell it saw.
 * Swept here over the real hall colliders: from every seat's dismount/approach spot, the spots the reviewer stood on, and
 * every free point of a 0.5 m grid round the letter table and the north strip behind it, a click on the exit, the hall's
 * centre and every seat's approach (what a click on a seat walks to: furnitureClick.ts) takes a walk the game walks to the
 * end — and no longer than the shortest way a body has there (a fine grid's), give or take.
 */
import { describe, expect, it } from "vitest";
import { PLAYER_RADIUS } from "@caysonverse/shared/worldMap";
import { VILLAGE_LAYOUT } from "@caysonverse/shared/village/villageLayout";
import { VILLAGE_SEATS } from "@caysonverse/shared/village/benchSeats";
import { HALL_ACTIVE_MAP } from "./activeMap";
import { isFreeSpot, planClickMove, walkThere, wayLength, type GroundPoint } from "./clickPlan";

const map = HALL_ACTIVE_MAP;
const obstacles = map.geometry.obstacles;
const bounds = VILLAGE_LAYOUT.areas.hall;
const hallSeats = VILLAGE_SEATS.filter((s) => s.area === "hall");
const pad = VILLAGE_LAYOUT.memorial.interior.doorPad.centre;

/** The shortest way a body has from (x, z) to every point (a 0.1 m grid of free spots, eight neighbours, no corner cut). */
function geodesic(fx: number, fz: number): (x: number, z: number) => number {
  const c = 0.1;
  const x0 = bounds.minX;
  const z0 = bounds.minZ;
  const nx = Math.ceil((bounds.maxX - x0) / c);
  const nz = Math.ceil((bounds.maxZ - z0) / c);
  const free = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) free[j * nx + i] = isFreeSpot(x0 + (i + 0.5) * c, z0 + (j + 0.5) * c, obstacles, bounds) ? 1 : 0;
  const d = new Float64Array(nx * nz).fill(Infinity);
  const cellOf = (x: number, z: number) => Math.min(nz - 1, Math.max(0, Math.floor((z - z0) / c))) * nx + Math.min(nx - 1, Math.max(0, Math.floor((x - x0) / c)));
  // the start may lie in a gap narrower than a cell: its cell counts as free
  const s = cellOf(fx, fz);
  free[s] = 1;
  d[s] = 0;
  // Dijkstra on a binary heap would be quicker; a bucketed sweep is enough for 18k cells
  const queue: number[] = [s];
  const inQ = new Uint8Array(nx * nz);
  inQ[s] = 1;
  while (queue.length) {
    const k = queue.shift()!;
    inQ[k] = 0;
    const ki = k % nx;
    const kj = Math.floor(k / nx);
    for (let dj = -1; dj <= 1; dj++)
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const i = ki + di;
        const j = kj + dj;
        if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
        const n = j * nx + i;
        if (!free[n] || (di && dj && (!free[kj * nx + i] || !free[j * nx + ki]))) continue;
        const t = d[k] + (di && dj ? Math.SQRT2 : 1) * c;
        if (t < d[n] - 1e-9) {
          d[n] = t;
          if (!inQ[n]) {
            inQ[n] = 1;
            queue.push(n);
          }
        }
      }
  }
  return (x, z) => {
    // the nearest free cell's distance (a target may lie a hair inside a cell that is not free)
    let best = d[cellOf(x, z)];
    for (const [dx, dz] of [[c, 0], [-c, 0], [0, c], [0, -c]]) best = Math.min(best, d[cellOf(x + dx, z + dz)]);
    return best + Math.hypot(x - (x0 + ((cellOf(x, z) % nx) + 0.5) * c), z - (z0 + (Math.floor(cellOf(x, z) / nx) + 0.5) * c));
  };
}

const targets: Array<{ k: string; x: number; z: number }> = [
  { k: "exit", x: pad.x, z: pad.z - 0.8 },
  { k: "centre", x: 300, z: 0.8 },
  ...hallSeats.map((s) => ({ k: s.id, x: s.standX, z: s.standZ })),
];

const starts: Array<{ k: string; x: number; z: number }> = [
  ...hallSeats.map((s) => ({ k: `${s.id} stand`, x: s.standX, z: s.standZ })),
  // the reviewer's: up from letter_n1 / letter_n0, and squeezed between the north chairs at the table's edge
  { k: "rev n1", x: 295.88, z: -3.17 },
  { k: "rev n0", x: 293.12, z: -3.75 },
  { k: "rev gap", x: 294.42, z: -3.75 },
];
for (let x = 292.9; x <= 299.6; x += 0.5)
  for (let z = -5.2; z <= -1.4; z += 0.5) if (isFreeSpot(x, z, obstacles, bounds)) starts.push({ k: `grid ${x.toFixed(1)},${z.toFixed(1)}`, x, z });

describe("a click anywhere in the memorial hall walks there (round 9 review: trapped behind the letter table)", () => {
  it(
    "from every seat's approach and every spot round the letter table: the exit, the centre, every seat — walked to the end, no long way round",
    () => {
      const bad: string[] = [];
      for (const st of starts) {
        const geo = geodesic(st.x, st.z);
        for (const t of targets) {
          if (Math.hypot(t.x - st.x, t.z - st.z) < 0.3) continue;
          const plan = planClickMove(st.x, st.z, { x: t.x, y: 0.01, z: t.z, ny: 1 }, obstacles, bounds, false, { furniture: map.furniture });
          if (!plan.ok) {
            if (plan.reason !== "here") bad.push(`${st.k} -> ${t.k}: ${plan.reason}`);
            continue;
          }
          const via: readonly GroundPoint[] = plan.via ?? [];
          if (!walkThere(st.x, st.z, plan.x, plan.z, obstacles, bounds, via).arrived) bad.push(`${st.k} -> ${t.k}: walk stops`);
          if (Math.hypot(plan.x - t.x, plan.z - t.z) > 0.3) bad.push(`${st.k} -> ${t.k}: ends ${plan.x.toFixed(2)},${plan.z.toFixed(2)}`);
          const len = wayLength(st.x, st.z, via, plan.x, plan.z);
          const g = geo(plan.x, plan.z);
          if (len > g * 1.35 + 1.5) bad.push(`${st.k} -> ${t.k}: ${len.toFixed(1)} m, shortest ${g.toFixed(1)} m`);
        }
      }
      expect(bad, bad.slice(0, 40).join("\n")).toEqual([]);
    },
    240_000,
  );

  it("from the spots behind the letter table: every reachable point of the hall's floor (a 0.75 m grid) takes a walk there", () => {
    const from = starts.filter((s) => /^(rev|letter_n)/.test(s.k));
    const bad: string[] = [];
    let n = 0;
    for (const st of from) {
      const geo = geodesic(st.x, st.z);
      for (let x = bounds.minX + 0.45; x < bounds.maxX - 0.4; x += 0.75)
        for (let z = bounds.minZ + 0.45; z < bounds.maxZ - 0.4; z += 0.75) {
          // (a free point no body gets to — behind the desk's counter — is no reachable floor: its click shows the hint)
          if (!isFreeSpot(x, z, obstacles, bounds) || Math.hypot(x - st.x, z - st.z) < 0.4 || !Number.isFinite(geo(x, z))) continue;
          n++;
          const plan = planClickMove(st.x, st.z, { x, y: 0.01, z, ny: 1 }, obstacles, bounds, false, { furniture: map.furniture });
          if (!plan.ok) bad.push(`${st.k} -> ${x.toFixed(2)},${z.toFixed(2)}: ${plan.reason}`);
          else if (!walkThere(st.x, st.z, plan.x, plan.z, obstacles, bounds, plan.via ?? []).arrived) bad.push(`${st.k} -> ${x.toFixed(2)},${z.toFixed(2)}: walk stops`);
        }
    }
    expect(n).toBeGreaterThan(600);
    expect(bad, bad.slice(0, 40).join(String.fromCharCode(10))).toEqual([]);
  }, 240_000);

  it("the floor seen under the letter table's edge, between its chairs, walks next to the table (in the hall every collider is furniture)", () => {
    // round 9 in-game (phone, up from letter_n0): this tap was "unreachable" — no free spot within MAX_PUSH
    for (const [fx, fz] of [[293.05, -3.81], [293.05, -2.09], [300, 0.8]]) {
      for (const [x, z] of [[294.94, -3.03], [294.4, -2.95], [293.75, -3.75], [297.5, -2.7]]) {
        const plan = planClickMove(fx, fz, { x, y: 0, z, ny: 1 }, obstacles, bounds, false, { furniture: obstacles });
        // (the nearest spot to stand may be where the avatar already stands: "here", a stop)
        expect(plan.ok || plan.reason === "here", `${fx},${fz} -> ${x},${z}: ${JSON.stringify(plan)}`).toBe(true);
        if (plan.ok) expect(Math.hypot(plan.x - x, plan.z - z)).toBeLessThan(1.6);
      }
    }
  });

  it("the body's radius is the walk's (a guard: the sweep's free spots are LocalPlayer's)", () => {
    expect(PLAYER_RADIUS).toBe(0.4);
  });
});

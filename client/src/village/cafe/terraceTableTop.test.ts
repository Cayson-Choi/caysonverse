import { BufferGeometry, Float32BufferAttribute } from "three";
import { describe, expect, it } from "vitest";
import { TERRACE_TOP_SIDES, terraceTableTop } from "./terraceTableTop";

/** An octagonal slab's top and bottom rings (as the baked terrace table: r 0.41 at 0.755 .. 0.775), triangles as a fan. */
function octagonSlab(cx: number, cz: number, r: number, y0: number, y1: number): BufferGeometry {
  const P: number[] = [];
  for (const y of [y0, y1])
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2, b = ((k + 1) / 8) * Math.PI * 2;
      P.push(cx, y, cz, cx + r * Math.cos(a), y, cz + r * Math.sin(a), cx + r * Math.cos(b), y, cz + r * Math.sin(b));
    }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(P, 3));
  return g;
}

describe("terraceTableTop", () => {
  const g = terraceTableTop(octagonSlab(42.3, -17.6, 0.41, 0.755, 0.775), 2);
  const pos = g.getAttribute("position");
  const nor = g.getAttribute("normal");

  it("keeps the slab's centre, radius and thickness, round (48 sides)", () => {
    let rMax = 0, y0 = 9, y1 = -9;
    for (let i = 0; i < pos.count; i++) {
      rMax = Math.max(rMax, Math.hypot(pos.getX(i) - 42.3, pos.getZ(i) + 17.6));
      y0 = Math.min(y0, pos.getY(i));
      y1 = Math.max(y1, pos.getY(i));
    }
    expect(rMax).toBeCloseTo(0.41, 3);
    expect(y0).toBeCloseTo(0.755, 4);
    expect(y1).toBeCloseTo(0.775, 4);
    expect(pos.count % (TERRACE_TOP_SIDES + 1)).toBe(0);
  });

  it("faces out of the disc: the top up, the rim out, the underside down", () => {
    const idx = g.getIndex()!;
    let up = 0, down = 0, out = 0;
    for (let i = 0; i < idx.count; i += 3) {
      const [a, b, c] = [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)];
      const ax = pos.getX(a), ay = pos.getY(a), az = pos.getZ(a);
      const ux = pos.getX(b) - ax, uy = pos.getY(b) - ay, uz = pos.getZ(b) - az;
      const vx = pos.getX(c) - ax, vy = pos.getY(c) - ay, vz = pos.getZ(c) - az;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if (Math.hypot(nx, ny, nz) < 1e-12) continue;
      // the face normal agrees with the stored normal of its first corner
      expect(nx * nor.getX(a) + ny * nor.getY(a) + nz * nor.getZ(a)).toBeGreaterThan(-1e-9);
      if (ny > 0 && Math.abs(ny) > Math.hypot(nx, nz)) up++;
      else if (ny < 0 && Math.abs(ny) > Math.hypot(nx, nz)) down++;
      else if ((pos.getX(a) - 42.3) * nx + (pos.getZ(a) + 17.6) * nz > 0) out++;
    }
    expect(up).toBeGreaterThan(TERRACE_TOP_SIDES);
    expect(down).toBeGreaterThan(TERRACE_TOP_SIDES);
    expect(out).toBeGreaterThan(TERRACE_TOP_SIDES);
  });
});

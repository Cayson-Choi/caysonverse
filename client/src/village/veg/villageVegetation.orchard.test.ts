import { describe, expect, it } from "vitest";
import { Matrix4, Quaternion, Vector3 } from "three";
import { varyOrchard } from "./villageVegetation";

/** A 5 x 4 grid of identical trees 5.5 m apart, as the village file had the orchard. */
function grid(): Matrix4[] {
  const out: Matrix4[] = [];
  for (let i = 0; i < 5; i++) for (let j = 0; j < 4; j++) out.push(new Matrix4().compose(new Vector3(60 + i * 5.5, 0, 40 + j * 5.5), new Quaternion(), new Vector3(1, 1, 1)));
  return out;
}

describe("varyOrchard", () => {
  it("is deterministic and keeps most trees, dropping a few as gaps", () => {
    const a = varyOrchard(grid());
    const b = varyOrchard(grid());
    expect(a.map((m) => m.elements.join())).toEqual(b.map((m) => m.elements.join()));
    expect(a.length).toBeLessThan(20);
    expect(a.length).toBeGreaterThanOrEqual(14);
  });
  it("gives each tree its own size, turn and a nudge off the grid (no two alike)", () => {
    const out = varyOrchard(grid());
    const p = new Vector3();
    const q = new Quaternion();
    const s = new Vector3();
    const sizes = new Set<number>();
    const yaws = new Set<number>();
    for (const m of out) {
      m.decompose(p, q, s);
      expect(s.x).toBeGreaterThanOrEqual(0.79);
      expect(s.x).toBeLessThanOrEqual(1.23);
      sizes.add(Math.round(s.x * 1000));
      yaws.add(Math.round(q.y * 1000));
      // within a metre of its grid point
      const gx = 60 + Math.round((p.x - 60) / 5.5) * 5.5;
      const gz = 40 + Math.round((p.z - 40) / 5.5) * 5.5;
      expect(Math.hypot(p.x - gx, p.z - gz)).toBeLessThan(1.3);
    }
    expect(sizes.size).toBeGreaterThan(out.length * 0.8);
    expect(yaws.size).toBeGreaterThan(out.length * 0.8);
  });
});

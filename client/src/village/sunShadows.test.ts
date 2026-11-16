import { describe, expect, it } from "vitest";
import { Matrix4, OrthographicCamera, Vector3 } from "three";
import {
  BAKE_SUN,
  SHADOW_MIN_ELEVATION,
  SS_DAY_FUNCTION,
  SS_FRAGMENT_PARS,
  SUN_DIRECT_K,
  angleDeg,
  lightBasis,
  nearBoxFor,
  orthoBoxFor,
  shadowDirection,
  snapToTexels,
  sunShadowUniforms,
} from "./sunShadows";
import { directionFrom, type Vec3 } from "./dayNightBlend";
import { maskTiles } from "./bakedSunMask";

const RAD = 180 / Math.PI;
const elevation = (d: Vec3) => Math.asin(d[1]) * RAD;
const azimuth = (d: Vec3) => ((Math.atan2(d[0], -d[2]) * RAD) % 360 + 360) % 360;
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

describe("shadowDirection: the live shadows' light", () => {
  it("keeps a sun that is up as it is (unit)", () => {
    const d = directionFrom(135, 30);
    const s = shadowDirection(d);
    for (let i = 0; i < 3; i++) expect(s[i]).toBeCloseTo(d[i]!, 12);
  });
  it("holds a low sun at the minimum elevation, on the same azimuth", () => {
    const s = shadowDirection(directionFrom(250, 0.5));
    expect(elevation(s)).toBeCloseTo(SHADOW_MIN_ELEVATION, 9);
    expect(azimuth(s)).toBeCloseTo(250, 9);
    expect(Math.hypot(...s)).toBeCloseTo(1, 12);
  });
});

describe("lightBasis: three's lookAt frame for a light", () => {
  it("matches a camera looking from the light toward its target", () => {
    for (const [az, el] of [
      [70, 20],
      [180, 76],
      [250, 3],
      [10, 45],
    ] as const) {
      const dir = directionFrom(az, el);
      const cam = new OrthographicCamera();
      cam.position.set(dir[0] * 100, dir[1] * 100, dir[2] * 100);
      cam.lookAt(0, 0, 0);
      cam.updateMatrixWorld(true);
      const e = cam.matrixWorld.elements;
      const { right, up } = lightBasis(dir);
      expect(dot(right, [e[0]!, e[1]!, e[2]!])).toBeCloseTo(1, 9);
      expect(dot(up, [e[4]!, e[5]!, e[6]!])).toBeCloseTo(1, 9);
      expect(dot(right, dir)).toBeCloseTo(0, 12);
      expect(dot(up, dir)).toBeCloseTo(0, 12);
    }
  });
});

describe("snapToTexels: a box that slides with the player moves by whole texels", () => {
  it("lands on the texel grid in the light's frame, never more than half a texel away", () => {
    const dir = directionFrom(200, 35);
    const { right, up } = lightBasis(dir);
    const tx = 0.031;
    const ty = 0.047;
    for (const p of [
      [3.21, 0, -7.7],
      [-40.05, 0, 12.9],
      [100.5, 0, 33.3],
    ] as Vec3[]) {
      const q = snapToTexels([...p], dir, tx, ty);
      const u = dot(q, right) / tx;
      const v = dot(q, up) / ty;
      expect(Math.abs(u - Math.round(u))).toBeLessThan(1e-6);
      expect(Math.abs(v - Math.round(v))).toBeLessThan(1e-6);
      expect(Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2])).toBeLessThanOrEqual(Math.hypot(tx, ty) / 2 + 1e-9);
      // the move is across the light only: along it nothing changes
      expect(dot([q[0] - p[0], q[1] - p[1], q[2] - p[2]], dir)).toBeCloseTo(0, 9);
    }
  });
  it("two spots a whole texel apart snap a whole texel apart (no crawl)", () => {
    const dir = directionFrom(160, 50);
    const { right } = lightBasis(dir);
    const a = snapToTexels([1.234, 0, 5.678], dir, 0.03, 0.03);
    const b = snapToTexels([1.234 + right[0] * 0.03, right[1] * 0.03, 5.678 + right[2] * 0.03], dir, 0.03, 0.03);
    expect(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])).toBeCloseTo(0.03, 9);
  });
});

describe("orthoBoxFor: the shadow camera's box", () => {
  it("holds every corner of the world box (projected through a real shadow camera)", () => {
    const dir = directionFrom(230, 12);
    const centre: Vec3 = [10, 0, -5];
    const box = { minX: -30, maxX: 50, minZ: -45, maxZ: 35, top: 26 };
    const o = orthoBoxFor(dir, centre, box, 400);
    const cam = new OrthographicCamera(o.left, o.right, o.top, o.bottom, o.near, o.far);
    cam.position.set(centre[0] + dir[0] * 400, centre[1] + dir[1] * 400, centre[2] + dir[2] * 400);
    cam.lookAt(centre[0], centre[1], centre[2]);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    const m = new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    for (const x of [box.minX, box.maxX]) {
      for (const y of [0, box.top]) {
        for (const z of [box.minZ, box.maxZ]) {
          const c = new Vector3(x, y, z).applyMatrix4(m);
          expect(Math.abs(c.x)).toBeLessThanOrEqual(1 + 1e-9);
          expect(Math.abs(c.y)).toBeLessThanOrEqual(1 + 1e-9);
          expect(Math.abs(c.z)).toBeLessThanOrEqual(1 + 1e-9);
        }
      }
    }
  });
  it("reaches toward the sun: a 20 m mast 300 m sunward of a low sun is inside the depth range", () => {
    const dir = directionFrom(250, 4);
    const o = nearBoxFor(dir, 32);
    const mastTop: Vec3 = [dir[0] * 300, 20, dir[2] * 300];
    const depth = 400 - dot(mastTop, dir);
    expect(depth).toBeGreaterThan(o.near);
    expect(depth).toBeLessThan(o.far);
  });
  it("the near box keeps its size wherever it goes (texels stay the same)", () => {
    const dir = directionFrom(120, 40);
    const a = nearBoxFor(dir, 32);
    const b = orthoBoxFor(dir, [77, 0, -12], { minX: 77 - 32, maxX: 77 + 32, minZ: -12 - 32, maxZ: -12 + 32, top: 26 });
    expect(b.right - b.left).toBeCloseTo(a.right - a.left, 9);
    expect(b.top - b.bottom).toBeCloseTo(a.top - a.bottom, 9);
  });
});

describe("the light's constants and shader", () => {
  it("the baked sun is the bake's (look.json: azimuth 70, elevation 20) and its direct light the measured one", () => {
    expect(BAKE_SUN).toMatchObject({ azimuthDeg: 70, elevationDeg: 20 });
    expect(SUN_DIRECT_K).toBeGreaterThan(0.6);
    expect(SUN_DIRECT_K).toBeLessThan(0.85);
  });
  it("every uniform the GLSL reads is shared", () => {
    for (const name of SS_FRAGMENT_PARS.match(/uniform \w+ (uSs\w+)/g)!.map((l) => l.split(" ")[2]!)) {
      expect(sunShadowUniforms, name).toHaveProperty(name);
    }
    expect(SS_DAY_FUNCTION).toContain("ssDay(");
    expect(angleDeg(directionFrom(0, 30), directionFrom(0, 31))).toBeCloseTo(1, 9);
  });
});

describe("maskTiles", () => {
  it("covers the area exactly once", () => {
    const area = { minX: -135, maxX: 353, minZ: -135, maxZ: 135 };
    const tiles = maskTiles(area, 64);
    let sum = 0;
    for (const t of tiles) {
      expect(t.maxX).toBeGreaterThan(t.minX);
      expect(t.maxZ).toBeGreaterThan(t.minZ);
      sum += (t.maxX - t.minX) * (t.maxZ - t.minZ);
    }
    expect(sum).toBeCloseTo((area.maxX - area.minX) * (area.maxZ - area.minZ), 6);
  });
});

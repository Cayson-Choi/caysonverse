import { describe, it, expect } from "vitest";
import {
  OV_MIN_HEIGHT,
  OV_MAX_HEIGHT_FACTOR,
  OV_FIT_MARGIN,
  overviewFitHeight,
  clampOverviewHeight,
  clampOverviewCenter,
  overviewPanDelta,
} from "./overview";
import { worldDirection } from "./input";
import { WORLD_BOUNDS } from "@caysonverse/shared/constants";

// The REAL map bounds, imported so these tests keep validating the actual world
// as it grows (maze west, gallery north — a hardcoded copy silently went stale
// once already: review v2-11 M2).
const BOUNDS = WORLD_BOUNDS;
const MAP_W = BOUNDS.maxX - BOUNDS.minX;
const MAP_D = BOUNDS.maxZ - BOUNDS.minZ;
const FOV = (55 * Math.PI) / 180; // WorldScene camera vertical fov

describe("overview — fit height (whole map in frame, no hardcode)", () => {
  it("lands high enough that the map (with margin) fits at a landscape aspect", () => {
    const aspect = 1280 / 800; // 1.6
    const h = overviewFitHeight(MAP_W, MAP_D, FOV, aspect);
    // Visible half-extents on the ground at this height:
    const t = Math.tan(FOV / 2);
    const halfZ = h * t; // screen-vertical → world Z
    const halfX = h * t * aspect; // screen-horizontal → world X
    // Both map half-dims (with 5% margin) must fit.
    expect(halfZ).toBeGreaterThanOrEqual((MAP_D / 2) * OV_FIT_MARGIN - 1e-6);
    expect(halfX).toBeGreaterThanOrEqual((MAP_W / 2) * OV_FIT_MARGIN - 1e-6);
  });

  it("is width-bound on the wide map and grows as the viewport narrows", () => {
    const wide = overviewFitHeight(MAP_W, MAP_D, FOV, 1.6);
    const narrow = overviewFitHeight(MAP_W, MAP_D, FOV, 0.5); // portrait phone
    // The map is wider than deep (96 m vs current depth), and a narrower
    // viewport must back FURTHER away to still fit that width.
    expect(narrow).toBeGreaterThan(wide);
  });

  it("fits at a square aspect too (whole map, both axes)", () => {
    const h = overviewFitHeight(MAP_W, MAP_D, FOV, 1);
    const t = Math.tan(FOV / 2);
    expect(h * t).toBeGreaterThanOrEqual((MAP_D / 2) * OV_FIT_MARGIN - 1e-6);
    expect(h * t * 1).toBeGreaterThanOrEqual((MAP_W / 2) * OV_FIT_MARGIN - 1e-6);
  });
});

describe("overview — zoom (height) clamp", () => {
  it("clamps to the floor (never dive below OV_MIN_HEIGHT)", () => {
    const fit = 60;
    expect(clampOverviewHeight(5, fit)).toBe(OV_MIN_HEIGHT);
    expect(clampOverviewHeight(OV_MIN_HEIGHT - 100, fit)).toBe(OV_MIN_HEIGHT);
  });

  it("clamps to the ceiling (fit × factor — a touch above full-map view)", () => {
    const fit = 60;
    const ceil = fit * OV_MAX_HEIGHT_FACTOR;
    expect(clampOverviewHeight(fit * 5, fit)).toBeCloseTo(ceil, 6);
  });

  it("passes a mid-range height through untouched", () => {
    expect(clampOverviewHeight(40, 60)).toBe(40);
  });
});

describe("overview — pan centre clamp (centre stays inside world bounds)", () => {
  it("clamps the centre to the world rectangle on every side", () => {
    expect(clampOverviewCenter(-999, 0, BOUNDS)).toEqual({ x: BOUNDS.minX, z: 0 });
    expect(clampOverviewCenter(999, 0, BOUNDS)).toEqual({ x: BOUNDS.maxX, z: 0 });
    expect(clampOverviewCenter(-18, -999, BOUNDS)).toEqual({ x: -18, z: BOUNDS.minZ });
    expect(clampOverviewCenter(-18, 999, BOUNDS)).toEqual({ x: -18, z: BOUNDS.maxZ });
  });

  it("passes an in-bounds centre through", () => {
    expect(clampOverviewCenter(-18, 0, BOUNDS)).toEqual({ x: -18, z: 0 });
  });
});

describe("overview — pan delta (pixels → world, height-scaled, grab-style)", () => {
  it("scales with height: the same drag pans further when zoomed out", () => {
    const near = overviewPanDelta(100, 0, 20, FOV, 800);
    const far = overviewPanDelta(100, 0, 60, FOV, 800);
    expect(Math.abs(far.dx)).toBeGreaterThan(Math.abs(near.dx));
    // 3× the height ⇒ 3× the world pan for the same pixel drag.
    expect(Math.abs(far.dx) / Math.abs(near.dx)).toBeCloseTo(3, 5);
  });

  it("is grab-style: dragging right moves the centre toward -X (world slides right)", () => {
    const p = overviewPanDelta(100, 0, 60, FOV, 800);
    expect(p.dx).toBeLessThan(0);
    expect(p.dz).toBeCloseTo(0, 6);
  });

  it("maps a full-viewport vertical drag to the on-ground world height at that camera height", () => {
    // A drag spanning the whole viewport height should pan by the full visible
    // world depth (2·h·tan(fov/2)).
    const h = 50;
    const p = overviewPanDelta(0, 800, h, FOV, 800);
    const worldSpan = 2 * h * Math.tan(FOV / 2);
    expect(Math.abs(p.dz)).toBeCloseTo(worldSpan, 5);
  });
});

describe("overview — screen-relative movement uses a fixed yaw of 0 (W = north/-Z)", () => {
  it("W drives -Z, S drives +Z, D drives +X, A drives -X (screen basis, yaw 0)", () => {
    const near = (v: { x: number; z: number }, x: number, z: number) => {
      expect(v.x).toBeCloseTo(x, 9);
      expect(v.z).toBeCloseTo(z, 9);
    };
    near(worldDirection({ forward: 1, right: 0 }, 0), 0, -1); // W north
    near(worldDirection({ forward: -1, right: 0 }, 0), 0, 1); // S south
    near(worldDirection({ forward: 0, right: 1 }, 0), 1, 0); // D east
    near(worldDirection({ forward: 0, right: -1 }, 0), -1, 0); // A west
  });
});

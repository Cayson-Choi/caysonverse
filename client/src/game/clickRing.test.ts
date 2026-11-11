import { describe, it, expect } from "vitest";
import {
  RING_GHOST_DASHES,
  RING_GHOST_DUTY,
  RING_GHOST_FRAGMENT,
  RING_GHOST_INNER,
  RING_GHOST_OPACITY,
  RING_GHOST_OUTER,
  RING_INNER as GHOST_RING_INNER,
  RING_OUTER as GHOST_RING_OUTER,
} from "./clickRing";
import { GROUND_LAYER_OFFSET, VILLAGE_GROUND_DECAL } from "../village/villageModelPrep";
import { DEFAULT_DECAL_Y } from "./groundDecal";
import {
  RING_MAX_SCALE,
  RING_MIN_HEIGHT_PX,
  RING_MIN_WIDTH_PX,
  RING_OUTER,
  RING_POLYGON_OFFSET,
  RING_RENDER_ORDER,
  RING_SEE_OVER,
  RING_VERTEX_BIAS,
  ringDepthBias,
  ringLift,
  ringScreenScale,
  ringY,
} from "./clickRing";

describe("clickRing — the destination ring on the ground", () => {
  it("its polygon offset beats every village ground layer on both terms (the layers use factor -1)", () => {
    for (const units of Object.values(GROUND_LAYER_OFFSET)) expect(RING_POLYGON_OFFSET.units).toBeLessThan(units);
    expect(RING_POLYGON_OFFSET.factor).toBeLessThan(-1);
    // the same recipe as the village's other ground decals (blob shadows, shadow floor)
    expect(RING_POLYGON_OFFSET.factor).toBe(VILLAGE_GROUND_DECAL.polygonOffsetFactor);
    expect(RING_POLYGON_OFFSET.units).toBe(VILLAGE_GROUND_DECAL.polygonOffsetUnits);
  });

  it("it draws after the shadow floor, the decals and the world's see-through effects, before the name tags", () => {
    expect(RING_RENDER_ORDER).toBeGreaterThan(2); // shadow floor, blob shadows, plot markers, door pads
    // LightShafts.tsx 3, MemorialHall candles 3 / 4, Gate.tsx strip 4, EscapeFx sun 4 / sparkles 5, ProgressBoard 5
    expect(RING_RENDER_ORDER).toBeGreaterThan(5);
    expect(RING_RENDER_ORDER).toBeLessThan(999); // nametag.ts 999, bubbles 1000, emoji 1001
  });

  it("it lies on the clicked surface plus the scene's decal lift", () => {
    expect(ringLift(null)).toBe(DEFAULT_DECAL_Y);
    expect(ringLift(VILLAGE_GROUND_DECAL)).toBe(0.05);
    expect(ringY(0.03, VILLAGE_GROUND_DECAL)).toBeCloseTo(0.08, 9); // the forecourt: above it, not under it
    expect(ringY(0.036, null)).toBeCloseTo(0.066, 9); // the escape hall's rug
    expect(ringY(0, null)).toBeCloseTo(DEFAULT_DECAL_Y, 9);
  });
});

/** The view ray from a camera at height `camH` above the ring's plane, `back` m back from the ring's point: its sin elevation and length. */
function view(camH: number, back: number) {
  const dist = Math.hypot(camH, back);
  return { dist, sin: camH / dist };
}

describe("clickRing — the ring sees over the ground right around it (round 2 review: an 11 cm curb cut it)", () => {
  it("the ring's depth is taken RING_SEE_OVER up the view ray: ground lower than that in front of it never covers it", () => {
    // a ring on the road (plane 6 cm), the curb's top 11 cm (5 cm above the plane), 0.3 m nearer the camera, seen from
    // the default camera 3.3 m up and 14 m back
    const { dist, sin } = view(3.3 - 0.06, 14);
    const bias = ringDepthBias(dist, sin, 1, 0.2);
    const curbAlong = 0.05 / sin; // where the ray from the camera to the ring point crosses 5 cm above its plane
    expect(bias).toBeGreaterThan(curbAlong); // the curb lies behind the biased depth: drawn under the ring
    // a bench seat 0.4 m above the plane (in front of the ring) still hides it
    expect(bias).toBeLessThan(0.4 / sin);
    expect(bias).toBeCloseTo(RING_SEE_OVER / sin, 9);
  });

  it("at a grazing view the bias stops at the ring's own size (what is farther in front is a real occluder)", () => {
    const { dist, sin } = view(1.6, 40);
    expect(ringDepthBias(dist, sin, 1, 0.2)).toBeCloseTo(2 * RING_OUTER, 9);
    expect(ringDepthBias(dist, sin, 3, 0.2)).toBeCloseTo(2 * RING_OUTER * 3, 9); // a ring drawn larger: its larger size
  });

  it("never brings the ring nearer the camera than its near plane allows, never pushes it away", () => {
    expect(ringDepthBias(0.4, 0.9, 1, 0.2)).toBeCloseTo(0.4 - 0.3, 9);
    expect(ringDepthBias(0.25, 0.9, 1, 0.2)).toBe(0);
  });

  it("the vertex shader does the same sum (one place for the numbers)", () => {
    for (const name of ["uRingSeeOver", "uRingBiasCap", "uRingNear", "cameraPosition", "#include <project_vertex>"]) expect(RING_VERTEX_BIAS).toContain(name);
  });
});

describe("clickRing — the ring stays readable on the screen (round 2 review: a 2 px line far away and in first person)", () => {
  it("near, the ring keeps its size", () => {
    const { dist, sin } = view(3.3, 12);
    expect(ringScreenScale(dist, sin, 50, 800)).toBe(1);
  });

  it("far or seen edge-on (first person, 22 m ahead), it grows until it is RING_MIN_HEIGHT_PX tall or as large as allowed", () => {
    const { dist, sin } = view(1.6, 22);
    const s = ringScreenScale(dist, sin, 50, 800);
    expect(s).toBeGreaterThan(1);
    expect(s).toBeLessThanOrEqual(RING_MAX_SCALE);
    const pxPerM = 800 / (2 * dist * Math.tan((50 * Math.PI) / 360));
    const tall = 2 * RING_OUTER * s * pxPerM * sin;
    const wide = 2 * RING_OUTER * s * pxPerM;
    expect(tall >= RING_MIN_HEIGHT_PX - 1e-9 || s === RING_MAX_SCALE).toBe(true);
    expect(wide).toBeGreaterThanOrEqual(RING_MIN_WIDTH_PX - 1e-9);
  });

  it("never grows past RING_MAX_SCALE", () => {
    const { dist, sin } = view(1.6, 400);
    expect(ringScreenScale(dist, sin, 50, 800)).toBe(RING_MAX_SCALE);
  });
});

describe("clickRing — the covered part of the ring (round 5 review: a hair ornament on the player's own head)", () => {
  it("is drawn fainter than the ring (0.9), dashed and thinner, inside the ring's own band", () => {
    expect(RING_GHOST_OPACITY).toBeGreaterThanOrEqual(0.35);
    expect(RING_GHOST_OPACITY).toBeLessThanOrEqual(0.45);
    expect(RING_GHOST_DASHES).toBeGreaterThanOrEqual(8);
    expect(Number.isInteger(RING_GHOST_DASHES)).toBe(true); // a whole number of dashes: no seam where the angle wraps
    expect(RING_GHOST_DUTY).toBeGreaterThan(0.3);
    expect(RING_GHOST_DUTY).toBeLessThan(0.75);
    expect(RING_GHOST_INNER).toBeGreaterThan(GHOST_RING_INNER);
    expect(RING_GHOST_OUTER).toBeLessThan(GHOST_RING_OUTER);
    expect(RING_GHOST_OUTER - RING_GHOST_INNER).toBeLessThan(GHOST_RING_OUTER - GHOST_RING_INNER);
  });

  it("its fragment cut keeps three's alpha map, scales the alpha and drops what is left out", () => {
    expect(RING_GHOST_FRAGMENT.startsWith("#include <alphamap_fragment>")).toBe(true);
    expect(RING_GHOST_FRAGMENT).toContain("diffuseColor.a *=");
    expect(RING_GHOST_FRAGMENT).toContain("discard");
    expect(RING_GHOST_FRAGMENT).toContain(RING_GHOST_DASHES.toFixed(1));
  });
});

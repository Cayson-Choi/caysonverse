import { describe, it, expect } from "vitest";
import {
  NAMETAG_BASE_HEIGHT_M,
  NAMETAG_FADE_END,
  NAMETAG_FADE_RATE,
  NAMETAG_FADE_START,
  NAMETAG_FONT_PX,
  NAMETAG_PAD_Y_PX,
  NAMETAG_TEXT_FRACTION,
  NAMETAG_TEXT_PX,
} from "./constants";
import { Matrix4, PerspectiveCamera, Vector3 } from "three";
import {
  MIN_CAMERA_UP_Y,
  distanceFade,
  liftMetres,
  nametagWorldHeight,
  pixelsPerMetre,
  projectPoint,
  stepOpacity,
  viewDepth,
} from "./nametagLayout";

const FOV = (55 * Math.PI) / 180; // WorldScene camera vertical fov
const textPx = (h: number, d: number, vpH: number) =>
  (h * NAMETAG_TEXT_FRACTION * vpH) / (2 * Math.max(d, 0.5) * Math.tan(FOV / 2));
/** The distance at which the UNCLAMPED tag (NAMETAG_BASE_HEIGHT_M) shows `px` pixel text. */
const distanceForNaturalPx = (px: number, vpH: number) =>
  (NAMETAG_BASE_HEIGHT_M * NAMETAG_TEXT_FRACTION * vpH) / (2 * Math.tan(FOV / 2) * px);

describe("nametag constants", () => {
  it("pin the owner-facing numbers (spec §6): 25 → 30 m fade, 12–16 px text, 0.30 m tag", () => {
    expect(NAMETAG_FADE_START).toBe(25);
    expect(NAMETAG_FADE_END).toBe(30);
    expect(NAMETAG_TEXT_PX).toEqual({ min: 12, max: 16 });
    expect(NAMETAG_FADE_RATE).toBe(4);
    expect(NAMETAG_BASE_HEIGHT_M).toBe(0.3);
  });

  it("the text takes 48 of the canvas's 76 px height", () => {
    expect(NAMETAG_FONT_PX).toBe(48);
    expect(NAMETAG_PAD_Y_PX).toBe(14);
    expect(NAMETAG_TEXT_FRACTION).toBeCloseTo(48 / 76, 12);
  });
});

describe("nametagWorldHeight", () => {
  it("keeps projected text within 12–16 px at every distance (spec §6)", () => {
    for (const vpH of [812, 800]) {
      for (const d of [0.5, 1, 3, 8, 15, 25, 40]) {
        const px = textPx(nametagWorldHeight(d, FOV, vpH), d, vpH);
        expect(px).toBeGreaterThanOrEqual(12 - 1e-6);
        expect(px).toBeLessThanOrEqual(16 + 1e-6);
      }
    }
  });

  it("returns the natural size where it already fits the band", () => {
    for (const vpH of [812, 800, 640]) {
      // The band's middle and both of its edges, each as a distance.
      for (const px of [14, 12, 16]) {
        const d = distanceForNaturalPx(px, vpH);
        expect(nametagWorldHeight(d, FOV, vpH)).toBeCloseTo(NAMETAG_BASE_HEIGHT_M, 9);
      }
      // ...and everywhere between those edges.
      const near = distanceForNaturalPx(NAMETAG_TEXT_PX.max, vpH);
      const far = distanceForNaturalPx(NAMETAG_TEXT_PX.min, vpH);
      expect(near).toBeLessThan(far);
      for (let i = 0; i <= 10; i++) {
        const d = near + ((far - near) * i) / 10;
        expect(nametagWorldHeight(d, FOV, vpH)).toBeCloseTo(NAMETAG_BASE_HEIGHT_M, 9);
      }
    }
  });

  it("shrinks the tag up close until the text is exactly 16 px", () => {
    const near = distanceForNaturalPx(NAMETAG_TEXT_PX.max, 812);
    for (const d of [0.5, 1, 3, near * 0.9]) {
      const h = nametagWorldHeight(d, FOV, 812);
      expect(h).toBeLessThan(NAMETAG_BASE_HEIGHT_M);
      expect(textPx(h, d, 812)).toBeCloseTo(NAMETAG_TEXT_PX.max, 6);
    }
  });

  it("grows the tag far away until the text is exactly 12 px", () => {
    const far = distanceForNaturalPx(NAMETAG_TEXT_PX.min, 812);
    for (const d of [far * 1.1, 25, 30, 40]) {
      const h = nametagWorldHeight(d, FOV, 812);
      expect(h).toBeGreaterThan(NAMETAG_BASE_HEIGHT_M);
      expect(textPx(h, d, 812)).toBeCloseTo(NAMETAG_TEXT_PX.min, 6);
    }
  });

  it("never gets smaller as the camera moves away", () => {
    let prev = 0;
    for (let d = 0.5; d <= 40; d += 0.25) {
      const h = nametagWorldHeight(d, FOV, 812);
      expect(h).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = h;
    }
  });

  it("floors the distance at 0.5 m", () => {
    expect(nametagWorldHeight(0.1, FOV, 812)).toBe(nametagWorldHeight(0.5, FOV, 812));
    expect(nametagWorldHeight(0, FOV, 812)).toBe(nametagWorldHeight(0.5, FOV, 812));
    expect(nametagWorldHeight(-3, FOV, 812)).toBe(nametagWorldHeight(0.5, FOV, 812));
  });

  it("scales with the viewport: a taller screen needs a smaller tag for the same pixels", () => {
    const d = 3; // clamped at 16 px on both
    expect(nametagWorldHeight(d, FOV, 1600)).toBeLessThan(nametagWorldHeight(d, FOV, 800));
    expect(textPx(nametagWorldHeight(d, FOV, 1600), d, 1600)).toBeCloseTo(16, 6);
  });

  it("falls back to the base size for a degenerate camera or viewport (never NaN / Infinity)", () => {
    expect(nametagWorldHeight(10, FOV, 0)).toBe(NAMETAG_BASE_HEIGHT_M);
    expect(nametagWorldHeight(10, Number.NaN, 812)).toBe(NAMETAG_BASE_HEIGHT_M);
    expect(nametagWorldHeight(Number.NaN, FOV, 812)).toBe(NAMETAG_BASE_HEIGHT_M);
  });
});

describe("distanceFade", () => {
  it("1 up to 25 m, 0.5 at 27.5 m, 0 from 30 m", () => {
    expect(distanceFade(25)).toBe(1);
    expect(distanceFade(27.5)).toBeCloseTo(0.5, 6);
    expect(distanceFade(30)).toBe(0);
  });

  it("is 1 anywhere inside 25 m and 0 anywhere beyond 30 m", () => {
    for (const d of [0, 0.5, 5, 24.999]) expect(distanceFade(d)).toBe(1);
    for (const d of [30.001, 45, 1000]) expect(distanceFade(d)).toBe(0);
  });

  it("falls in a straight line between the two and never rises with distance", () => {
    expect(distanceFade(26)).toBeCloseTo(0.8, 6);
    expect(distanceFade(29)).toBeCloseTo(0.2, 6);
    let prev = 1;
    for (let d = 24; d <= 31; d += 0.1) {
      const f = distanceFade(d);
      expect(f).toBeLessThanOrEqual(prev + 1e-12);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
      prev = f;
    }
  });
});

describe("stepOpacity", () => {
  it("moves NAMETAG_FADE_RATE per second and never overshoots", () => {
    expect(stepOpacity(1, 0, 0.1)).toBeCloseTo(0.6, 6);
    expect(stepOpacity(0.1, 0, 0.1)).toBe(0);
  });

  it("rises as well as falls, and lands exactly on the target", () => {
    expect(stepOpacity(0, 1, 0.1)).toBeCloseTo(0.4, 6);
    expect(stepOpacity(0.8, 1, 0.1)).toBe(1);
    expect(stepOpacity(0.5, 0.5, 0.1)).toBe(0.5);
  });

  it("a huge frame (backgrounded tab) lands on the target, not past it", () => {
    expect(stepOpacity(1, 0, 60)).toBe(0);
    expect(stepOpacity(0, 0.7, 60)).toBe(0.7);
  });

  it("takes a custom rate, and a zero or negative dt changes nothing", () => {
    expect(stepOpacity(1, 0, 0.1, 1)).toBeCloseTo(0.9, 6);
    expect(stepOpacity(0.5, 1, 0, 4)).toBe(0.5);
    expect(stepOpacity(0.5, 1, -0.1)).toBe(0.5);
    expect(stepOpacity(0.5, 1, Number.NaN)).toBe(0.5);
  });

  it("a full fade takes 1 / NAMETAG_FADE_RATE seconds", () => {
    let o = 1;
    let t = 0;
    while (o > 0 && t < 5) {
      o = stepOpacity(o, 0, 1 / 60);
      t += 1 / 60;
    }
    expect(t).toBeCloseTo(1 / NAMETAG_FADE_RATE, 1);
  });
});

describe("viewDepth", () => {
  // A camera at (1, 2, 3) looking down -Z, as three lays out matrixWorld (column 2 = +Z axis).
  const identityAt = (x: number, y: number, z: number) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];

  it("is the distance along the camera's forward axis, not the straight-line distance", () => {
    const m = identityAt(1, 2, 3);
    expect(viewDepth(m, 1, 2, -7)).toBeCloseTo(10, 9); // dead ahead
    // Off to the side by 10: the straight-line distance is ~14.1, the depth is still 10.
    expect(viewDepth(m, 11, 2, -7)).toBeCloseTo(10, 9);
    expect(viewDepth(m, 1, 12, -7)).toBeCloseTo(10, 9);
  });

  it("is negative behind the camera", () => {
    expect(viewDepth(identityAt(0, 0, 0), 0, 0, 5)).toBeCloseTo(-5, 9);
  });

  it("follows a yawed camera (looking down +X)", () => {
    // Rotated -90° about Y: forward (-Z) becomes +X, so column 2 (the +Z axis) is (-1, 0, 0).
    const m = [0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1];
    expect(viewDepth(m, 8, 0, 0)).toBeCloseTo(8, 9);
    expect(viewDepth(m, 0, 0, 8)).toBeCloseTo(0, 9);
  });
});

describe("pixelsPerMetre", () => {
  it("is the inverse of the pinhole projection: vpH / (2 d tan(fov/2))", () => {
    expect(pixelsPerMetre(10, FOV, 800)).toBeCloseTo(800 / (2 * 10 * Math.tan(FOV / 2)), 9);
  });

  it("halves when the distance doubles", () => {
    expect(pixelsPerMetre(20, FOV, 800)).toBeCloseTo(pixelsPerMetre(10, FOV, 800) / 2, 9);
  });

  it("turns a tag height into the same px nametagWorldHeight aims for", () => {
    const d = 8;
    const h = nametagWorldHeight(d, FOV, 800);
    expect(h * pixelsPerMetre(d, FOV, 800) * NAMETAG_TEXT_FRACTION).toBeGreaterThanOrEqual(NAMETAG_TEXT_PX.min - 1e-9);
  });

  it("is 0 for a degenerate viewport or fov (callers guard on it)", () => {
    expect(pixelsPerMetre(10, FOV, 0)).toBe(0);
    expect(pixelsPerMetre(10, 0, 800)).toBe(0);
    expect(pixelsPerMetre(10, NaN, 800)).toBe(0);
  });
});

describe("projectPoint", () => {
  // A 55 deg camera at (0, 3, 10) looking down -Z (three"s default), on a 4:3 canvas.
  const camera = new PerspectiveCamera(55, 4 / 3, 0.1, 200);
  camera.position.set(0, 3, 10);
  camera.updateMatrixWorld();
  const m = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).elements;
  const out = { x: NaN, y: NaN };

  it("puts a point dead ahead at the screen centre and agrees with three", () => {
    expect(projectPoint(m, 0, 3, 0, 0, out)).toBe(true);
    expect(out.x).toBeCloseTo(0, 9);
    expect(out.y).toBeCloseTo(0, 9);
    const ref = new Vector3(2, 4, -5).project(camera);
    expect(projectPoint(m, 2, 4, -5, 0, out)).toBe(true);
    expect(out.x).toBeCloseTo(ref.x, 9);
    expect(out.y).toBeCloseTo(ref.y, 9);
  });

  it("is false behind the camera, past the far plane and off to the side", () => {
    expect(projectPoint(m, 0, 3, 20, 0, out)).toBe(false); // behind
    expect(projectPoint(m, 0, 3, -250, 0, out)).toBe(false); // beyond far = 200 (camera is at z = 10)
    expect(projectPoint(m, 50, 3, 0, 0, out)).toBe(false); // far to the right
  });

  it("a margin admits a point just outside the screen edge, and only then", () => {
    // 9 m ahead of the camera at x chosen so ndc.x is about 1.05.
    const halfW = 9 * Math.tan((55 * Math.PI) / 360) * (4 / 3);
    const x = halfW * 1.05;
    expect(projectPoint(m, x, 3, 1, 0, out)).toBe(false);
    expect(projectPoint(m, x, 3, 1, 0.1, out)).toBe(true);
    expect(out.x).toBeCloseTo(1.05, 6);
  });

  it("leaves out untouched when it returns false", () => {
    out.x = 7;
    out.y = 8;
    projectPoint(m, 0, 3, 20, 0, out);
    expect([out.x, out.y]).toEqual([7, 8]);
  });
});

describe("liftMetres — a stacking lift in screen px, back in world metres", () => {
  it("level camera (up axis straight up): px / pixelsPerMetre", () => {
    expect(liftMetres(30, 100, 1)).toBeCloseTo(0.3, 9);
  });

  it("a pitched camera needs MORE world height for the same screen px (a metre only spans up.y of it)", () => {
    // Looking 60 degrees down: the camera's up axis has world-Y of cos(60) = 0.5.
    expect(liftMetres(30, 100, 0.5)).toBeCloseTo(0.6, 9);
    expect(liftMetres(30, 100, 0.5)).toBeGreaterThan(liftMetres(30, 100, 1));
  });

  it("is clamped at MIN_CAMERA_UP_Y so a near-vertical view cannot fling a tag into the sky", () => {
    expect(MIN_CAMERA_UP_Y).toBe(0.25);
    expect(liftMetres(30, 100, 0)).toBeCloseTo(30 / (100 * MIN_CAMERA_UP_Y), 9);
    expect(liftMetres(30, 100, -0.7)).toBeCloseTo(30 / (100 * MIN_CAMERA_UP_Y), 9);
    expect(liftMetres(30, 100, 0.1)).toBeCloseTo(30 / (100 * MIN_CAMERA_UP_Y), 9);
    expect(liftMetres(30, 100, 0.25)).toBeCloseTo(30 / (100 * MIN_CAMERA_UP_Y), 9);
  });

  it("zero lift stays zero and a degenerate scale (ppm 0 / NaN) gives no lift instead of Infinity", () => {
    expect(liftMetres(0, 100, 0.5)).toBe(0);
    expect(liftMetres(30, 0, 1)).toBe(0);
    expect(liftMetres(30, NaN, 1)).toBe(0);
  });
});

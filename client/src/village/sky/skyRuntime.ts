/**
 * The live night sky, shared by the star layer (StarSky.tsx), the finder (finderRuntime.ts) and the DEV probe: the
 * catalogue once it is in, this frame's sky matrix and twilight, the planets (recomputed every minute) and each figure's
 * stars as catalogue indexes. Plain module state, no React; StarSky writes it once a frame (`updateSky`).
 */

import { SKY_FIGURES, figureStars, type SkyFigure } from "@caysonverse/shared/village/constellations";
import {
  altAzOf,
  applyMat3,
  limitingMagnitude,
  planetsAt,
  precessionMatrix,
  refract,
  skyMatrix,
  starLayerWeight,
  type Mat3,
  type PlanetPosition,
  type Vec3,
} from "@caysonverse/shared/village/skyMath";
import type { StarCatalog } from "./starCatalog";
import { angularRadiusDeg, aimAllowanceDeg, meanDirection } from "./finderRules";

/** A figure resolved against the catalogue. */
export interface FigureGeom {
  figure: SkyFigure;
  /** Catalogue index of each distinct star (first-use order). */
  stars: number[];
  /** Each line as a pair of catalogue indexes. */
  lines: [number, number][];
  /** The aim star's catalogue index, or -1: the mean direction of `stars`. */
  anchor: number;
  /** The figure's angular radius (°) around its mean direction (does not change with time). */
  radiusDeg: number;
  /** The aim allowance (°). */
  aimDeg: number;
}

export interface SkyRuntime {
  catalog: StarCatalog | null;
  figures: FigureGeom[];
  /** J2000 -> scene, this frame. */
  matrix: Mat3;
  utcMs: number;
  sunElevationDeg: number;
  /** The faintest magnitude shown now. */
  limit: number;
  /** The whole layer's weight now. */
  fade: number;
  planets: PlanetPosition[];
  planetsAtMs: number;
}

export const sky: SkyRuntime = {
  catalog: null,
  figures: [],
  matrix: new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]),
  utcMs: 0,
  sunElevationDeg: 90,
  limit: -10,
  fade: 0,
  planets: [],
  planetsAtMs: -Infinity,
};

/** The precession changes by a hair a minute: recomputed when the clock has moved a minute (or jumped). */
let precession: Mat3 = precessionMatrix(0);
let precessionAt = -Infinity;
/** How often the planets are recomputed (ms of village time). */
export const PLANET_REFRESH_MS = 60_000;

/** Resolve the figures against a catalogue (once, when it arrives). Figures whose stars are missing are left out. */
export function resolveFigures(cat: StarCatalog): FigureGeom[] {
  const out: FigureGeom[] = [];
  for (const f of SKY_FIGURES) {
    const hrs = figureStars(f);
    const stars = hrs.map((hr) => cat.indexOf(hr));
    if (stars.some((i) => i < 0)) continue;
    const at = new Map(hrs.map((hr, k) => [hr, stars[k]!]));
    const dirs = stars.map((i) => [cat.eq[i * 3]!, cat.eq[i * 3 + 1]!, cat.eq[i * 3 + 2]!] as Vec3);
    const radiusDeg = angularRadiusDeg(dirs, meanDirection(dirs));
    out.push({
      figure: f,
      stars,
      lines: f.lines.map(([a, b]) => [at.get(a)!, at.get(b)!]),
      anchor: f.anchorHr !== undefined ? cat.indexOf(f.anchorHr) : -1,
      radiusDeg,
      aimDeg: aimAllowanceDeg(radiusDeg),
    });
  }
  return out;
}

/** The catalogue is in (or gone, null). */
export function setSkyCatalog(cat: StarCatalog | null): void {
  sky.catalog = cat;
  sky.figures = cat ? resolveFigures(cat) : [];
}

/** This frame's sky: the matrix at `utcMs`, the twilight from the (eased) sun elevation, the planets each minute. */
export function updateSky(utcMs: number, sunElevationDeg: number, magCap: number): void {
  if (Math.abs(utcMs - precessionAt) > 60_000) {
    precession = precessionMatrix(utcMs, precession);
    precessionAt = utcMs;
  }
  skyMatrix(utcMs, sky.matrix, precession);
  sky.utcMs = utcMs;
  sky.sunElevationDeg = sunElevationDeg;
  sky.limit = limitingMagnitude(sunElevationDeg, magCap);
  sky.fade = starLayerWeight(sunElevationDeg);
  if (Math.abs(utcMs - sky.planetsAtMs) >= PLANET_REFRESH_MS) {
    sky.planets = planetsAt(utcMs);
    sky.planetsAtMs = utcMs;
  }
}

/** The apparent (refracted) scene direction of catalogue star `i` now, into `out`. */
export function starDirection(i: number, out: Vec3 = [0, 0, 0]): Vec3 {
  const eq = sky.catalog!.eq;
  applyMat3(sky.matrix, eq[i * 3]!, eq[i * 3 + 1]!, eq[i * 3 + 2]!, out);
  return refract(out);
}

/** The apparent scene direction of a J2000 unit vector now (a planet). */
export function eqDirection(eq: Readonly<Vec3>, out: Vec3 = [0, 0, 0]): Vec3 {
  applyMat3(sky.matrix, eq[0], eq[1], eq[2], out);
  return refract(out);
}

/** The figure's aim direction now: its anchor star, or the mean of its stars. */
export function anchorDirection(g: FigureGeom, out: Vec3 = [0, 0, 0]): Vec3 {
  if (g.anchor >= 0) return starDirection(g.anchor, out);
  const tmp: Vec3 = [0, 0, 0];
  let x = 0;
  let y = 0;
  let z = 0;
  for (const i of g.stars) {
    starDirection(i, tmp);
    x += tmp[0];
    y += tmp[1];
    z += tmp[2];
  }
  const len = Math.hypot(x, y, z) || 1;
  out[0] = x / len;
  out[1] = y / len;
  out[2] = z / len;
  return out;
}

/** Altitudes (°) of a figure's stars now. */
export function starAltitudes(g: FigureGeom): number[] {
  const tmp: Vec3 = [0, 0, 0];
  return g.stars.map((i) => altAzOf(starDirection(i, tmp)).altDeg);
}

/** Magnitude of a catalogue star by HR (Infinity when absent). */
export function magOfHr(hr: number): number {
  const cat = sky.catalog;
  if (!cat) return Infinity;
  const i = cat.indexOf(hr);
  return i < 0 ? Infinity : cat.mag[i]!;
}

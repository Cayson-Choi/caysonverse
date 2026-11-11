import { useEffect, useMemo, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  AdditiveBlending,
  BufferGeometry,
  Float32BufferAttribute,
  Points,
  Vector2,
  type PerspectiveCamera,
} from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { altAzOf, lstDeg, PLANET_IDS, type Vec3 } from "@caysonverse/shared/village/skyMath";
import type { QualityTier } from "../../game/quality";
import { renderScale } from "../../game/renderScale";
import { dayNight } from "../dayNightDriver";
import { useNightMapWanted } from "../nightLightmap";
import { villageClock } from "../villageClock";
import { randomStars } from "../villageModelPrep";
import { finderFrame, finderProbe, glow, GLOW_SECONDS, lineSpec, REVEAL_DRAW, REVEAL_STEP, resetFinderRuntime } from "./finderRuntime";
import { cachedStarCatalog, countUpTo, loadStarCatalog, type StarCatalog } from "./starCatalog";
import { patchFinder } from "./starFinderStore";
import { makeStarMaterial, planetColour, starColour, STAR_SPHERE, type StarUniforms } from "./starShader";
import { eqDirection, setSkyCatalog, sky, starDirection, updateSky, type FigureGeom } from "./skyRuntime";

declare global {
  interface Window {
    /** Dev-only: the night sky now (the matrix's sidereal time, the twilight, where the landmark stars stand, the finder). */
    __cvSky?: () => unknown;
  }
}

/** The faintest magnitude each tier draws (the file is brightest first: the light tier draws a prefix of it). */
export const TIER_MAG_CAP: Readonly<Record<QualityTier, number>> = { high: 5.5, low: 5.0 };
/** Brightness and size trims per tier (the rich tier's final pass tone-maps the frame at the night's exposure). */
export const TIER_LOOK: Readonly<Record<QualityTier, { gain: number; size: number }>> = {
  high: { gain: 1.25, size: 1.1 },
  low: { gain: 1.15, size: 1.1 },
};
/** How long a failed star-file request waits before the next try (ms). */
export const RETRY_MS = 60_000;
/** The planets take the first slots of the point list (so the light tier's prefix keeps them). */
const PLANET_SLOTS = PLANET_IDS.length;

/** Landmark stars for the DEV probe (HR -> name). */
const PROBE_STARS: Readonly<Record<string, number>> = {
  polaris: 424,
  dubhe: 4301,
  merak: 4295,
  alkaid: 5191,
  arcturus: 5340,
  spica: 5056,
  regulus: 3982,
  vega: 7001,
  deneb: 7924,
  altair: 7557,
  antares: 6134,
  markab: 8781,
  alpheratz: 15,
  schedar: 168,
  betelgeuse: 2061,
  rigel: 1713,
  sirius: 2491,
  procyon: 2943,
  capella: 1708,
};

function prefersReducedMotion(): boolean {
  try {
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** The star layer's points: the four planets first, then the catalogue (brightest first). */
function makeStarPoints(cat: StarCatalog): Points<BufferGeometry, ReturnType<typeof makeStarMaterial>> {
  const n = PLANET_SLOTS + cat.count;
  const pos = new Float32Array(n * 3);
  const mag = new Float32Array(n);
  const col = new Float32Array(n * 3);
  const seed = new Float32Array(n);
  const glowA = new Float32Array(n).fill(1);
  const c: [number, number, number] = [0, 0, 0];
  PLANET_IDS.forEach((id, i) => {
    pos[i * 3 + 2] = 1;
    mag[i] = 30; // hidden until the first planet update
    const pc = planetColour(id);
    col.set(pc, i * 3);
    seed[i] = -1; // planets do not twinkle
  });
  let s = 0x2f6e2b1;
  for (let k = 0; k < cat.count; k++) {
    const i = PLANET_SLOTS + k;
    pos[i * 3] = cat.eq[k * 3]!;
    pos[i * 3 + 1] = cat.eq[k * 3 + 1]!;
    pos[i * 3 + 2] = cat.eq[k * 3 + 2]!;
    mag[i] = cat.mag[k]!;
    starColour(cat.bv[k]!, cat.mag[k]!, c);
    col[i * 3] = c[0];
    col[i * 3 + 1] = c[1];
    col[i * 3 + 2] = c[2];
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    seed[i] = s / 4294967296;
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("aMag", new Float32BufferAttribute(mag, 1));
  g.setAttribute("aColor", new Float32BufferAttribute(col, 3));
  g.setAttribute("aSeed", new Float32BufferAttribute(seed, 1));
  g.setAttribute("aGlow", new Float32BufferAttribute(glowA, 1));
  const m = makeStarMaterial();
  const points = new Points(g, m);
  planetsWrittenAt = -Infinity; // a new list: write the planets into it on its first frame
  points.name = "village_star_sky";
  points.frustumCulled = false;
  points.renderOrder = -1; // after the opaque scene and the lines, before the water and the falls
  points.visible = false;
  return points;
}

/**
 * 케이슨 마을's real night sky (outside only): the Yale Bright Star Catalogue's stars to magnitude 5.5 and the four bright
 * planets where they really stand at the village clock's instant (the server's time; the DEV `?time=` pin), fading in
 * with the twilight brightest first; the found figures' lines; and the star finder's frame. The star file (20 KB) is
 * fetched only when night is near (nightLightmap.ts's rule); until it is in, or if it fails, the model's random stars
 * stay (villageModelPrep.ts `randomStars`).
 */
export function StarSky({ tier }: { tier: QualityTier }) {
  const wanted = useNightMapWanted();
  const [cat, setCat] = useState<StarCatalog | null>(() => cachedStarCatalog());
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!wanted || cat) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    loadStarCatalog()
      .then((c) => alive && setCat(c))
      .catch(() => {
        // keep the random stars; try again a minute later
        if (alive) timer = setTimeout(() => setRetry((r) => r + 1), RETRY_MS);
      });
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [wanted, cat, retry]);

  useEffect(() => {
    setSkyCatalog(cat);
    patchFinder({ catalogReady: !!cat });
    return () => setSkyCatalog(null);
  }, [cat]);

  const points = useMemo(() => (cat ? makeStarPoints(cat) : null), [cat]);
  useEffect(() => {
    if (!points) return;
    randomStars.hidden = true;
    return () => {
      randomStars.hidden = false;
      points.geometry.dispose();
      points.material.dispose();
    };
  }, [points]);

  const gl = useThree((s) => s.gl);
  useEffect(() => {
    if (!points) return;
    const u = points.material.uniforms as StarUniforms;
    // The size is in CSS pixels: drawn at the post chain's lower render scale and stretched (renderScale.ts), a star
    // shrinks by the same share so it comes out the same size.
    points.onBeforeRender = () => {
      u.uPixel.value = gl.getPixelRatio() * renderScale();
    };
  }, [points, gl]);

  useEffect(() => {
    resetFinderRuntime();
    if (import.meta.env.DEV) {
      window.__cvSky = () => {
        const d: Vec3 = [0, 0, 0];
        const stars: Record<string, { alt: number; az: number }> = {};
        if (sky.catalog)
          for (const [name, hr] of Object.entries(PROBE_STARS)) {
            const i = sky.catalog.indexOf(hr);
            if (i < 0) continue;
            const { altDeg, azDeg } = altAzOf(starDirection(i, d));
            stars[name] = { alt: altDeg, az: azDeg };
          }
        return {
          utcMs: sky.utcMs,
          lstHours: lstDeg(sky.utcMs) / 15,
          sunElevationDeg: sky.sunElevationDeg,
          limit: sky.limit,
          fade: sky.fade,
          loaded: !!sky.catalog,
          count: sky.catalog?.count ?? 0,
          drawn: points ? points.geometry.drawRange.count : 0,
          visible: points?.visible ?? false,
          pixel: points ? (points.material.uniforms as StarUniforms).uPixel.value : 0,
          randomStarsHidden: randomStars.hidden,
          stars,
          planets: sky.planets.map((p) => {
            const { altDeg, azDeg } = altAzOf(eqDirection(p.eq, d));
            return { id: p.id, name: p.name, mag: p.mag, alt: altDeg, az: azDeg };
          }),
          figures: sky.figures.length,
          finder: finderProbe(),
        };
      };
    }
    return () => {
      if (import.meta.env.DEV) delete window.__cvSky;
    };
  }, [points]);

  const reducedMotion = useMemo(prefersReducedMotion, []);
  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1);
    updateSky(villageClock.nowMs(), dayNight.outdoor.sunElevationDeg, TIER_MAG_CAP[tier]);
    if (points && sky.catalog) {
      const u = points.material.uniforms as StarUniforms;
      const m = sky.matrix;
      u.uSky.value.set(m[0]!, m[1]!, m[2]!, m[3]!, m[4]!, m[5]!, m[6]!, m[7]!, m[8]!);
      u.uLimit.value = sky.limit;
      u.uFade.value = sky.fade;
      u.uTime.value = state.clock.elapsedTime;
      u.uTwinkle.value = reducedMotion ? 0 : 1;
      u.uGain.value = TIER_LOOK[tier].gain;
      u.uSize.value = TIER_LOOK[tier].size;
      points.visible = sky.fade > 0.001;
      const want = PLANET_SLOTS + countUpTo(sky.catalog, TIER_MAG_CAP[tier]);
      if (points.geometry.drawRange.count !== want) points.geometry.setDrawRange(0, want);
      syncPlanets(points.geometry);
      syncGlow(points.geometry);
    }
    finderFrame(state.camera as PerspectiveCamera, dt, state.size.width, state.size.height);
  });

  return (
    <>
      {points && <primitive object={points} />}
      <SkyLines />
    </>
  );
}

let planetsWrittenAt = -Infinity;
/** The planets' J2000 directions and magnitudes into the first slots, when skyRuntime recomputed them. */
function syncPlanets(g: BufferGeometry): void {
  if (planetsWrittenAt === sky.planetsAtMs || sky.planets.length === 0) return;
  planetsWrittenAt = sky.planetsAtMs;
  const pos = g.getAttribute("position") as Float32BufferAttribute;
  const mag = g.getAttribute("aMag") as Float32BufferAttribute;
  sky.planets.forEach((p, i) => {
    pos.setXYZ(i, p.eq[0], p.eq[1], p.eq[2]);
    mag.setX(i, p.mag);
  });
  pos.clearUpdateRanges();
  pos.addUpdateRange(0, PLANET_SLOTS * 3);
  pos.needsUpdate = true;
  mag.clearUpdateRanges();
  mag.addUpdateRange(0, PLANET_SLOTS);
  mag.needsUpdate = true;
}

let glowing = false;
/** The reveal's pulse on the found figure's stars (1.5× for `GLOW_SECONDS`), then back to 1. */
function syncGlow(g: BufferGeometry): void {
  const age = glow.start < 0 ? Infinity : glow.now - glow.start;
  const active = age < GLOW_SECONDS;
  if (!active && !glowing) return;
  const a = g.getAttribute("aGlow") as Float32BufferAttribute;
  const v = active ? 1 + 0.5 * Math.sin((Math.PI * age) / GLOW_SECONDS) : 1;
  for (const k of glow.stars) a.setX(PLANET_SLOTS + k, v);
  a.needsUpdate = true;
  glowing = active;
  if (!active) glow.start = -1;
}

/** Most segments drawn at once (every figure, the pointer's dashes and the Pleiades' ring fit well inside). */
const LINE_CAPACITY = 640;
/** Lines stop this far (°) short of each star, so they never cover it. */
const LINE_GAP_DEG = 0.6;
/** The Polaris pointer's dashes (°). */
const DASH_DEG = 1.1;
const DASH_GAP_DEG = 0.8;
/** Colours (linear): pale blue for constellations, gold for asterisms. */
const LINE_BLUE: Vec3 = [0.38, 0.55, 1.0];
const LINE_GOLD: Vec3 = [1.0, 0.72, 0.3];
/** Line width (CSS px). */
const LINE_WIDTH = 2;

/** The found figures' lines (and the hint's ghost), on the stars' sphere along the camera's rays. One draw call. */
function SkyLines() {
  const gl = useThree((s) => s.gl);
  const obj = useMemo(() => {
    const geom = new LineSegmentsGeometry();
    geom.setPositions(new Float32Array(LINE_CAPACITY * 6));
    geom.setColors(new Float32Array(LINE_CAPACITY * 6));
    geom.instanceCount = 0;
    const mat = new LineMaterial({
      linewidth: LINE_WIDTH,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: AdditiveBlending,
      toneMapped: false,
    });
    mat.fog = false;
    const lines = new LineSegments2(geom, mat);
    lines.name = "village_star_lines";
    lines.frustumCulled = false;
    lines.renderOrder = -2;
    lines.visible = false;
    return lines;
  }, []);
  useEffect(() => {
    const size = new Vector2();
    obj.onBeforeRender = () => {
      gl.getDrawingBufferSize(size);
      const s = renderScale();
      obj.material.resolution.set(size.x * s, size.y * s);
      obj.material.linewidth = LINE_WIDTH * gl.getPixelRatio() * s;
    };
    return () => {
      obj.geometry.dispose();
      obj.material.dispose();
    };
  }, [obj, gl]);

  useFrame(({ camera }) => {
    const n = writeLines(obj.geometry, camera.position.x, camera.position.y, camera.position.z);
    obj.geometry.instanceCount = n;
    obj.visible = n > 0 && sky.fade > 0.01;
  });
  return <primitive object={obj} />;
}

const la: Vec3 = [0, 0, 0];
const lb: Vec3 = [0, 0, 0];
const lp: Vec3 = [0, 0, 0];
const lq: Vec3 = [0, 0, 0];

/** Fill the line buffers from `lineSpec`; returns the segment count. */
function writeLines(geom: LineSegmentsGeometry, cx: number, cy: number, cz: number): number {
  if (!sky.catalog || lineSpec.length === 0) return 0;
  const startAttr = geom.getAttribute("instanceStart") as unknown as { data: { array: Float32Array; needsUpdate: boolean } };
  const colourAttr = geom.getAttribute("instanceColorStart") as unknown as { data: { array: Float32Array; needsUpdate: boolean } };
  const P = startAttr.data.array;
  const C = colourAttr.data.array;
  let n = 0;
  const ox = cx - STAR_SPHERE.centre[0];
  const oy = cy - STAR_SPHERE.centre[1];
  const oz = cz - STAR_SPHERE.centre[2];
  const R2 = STAR_SPHERE.radius * STAR_SPHERE.radius;
  const cc = ox * ox + oy * oy + oz * oz - R2;
  /** A direction -> the point on the stars' sphere seen from the camera, written at P[o]. */
  const put = (d: Readonly<Vec3>, o: number) => {
    const b = ox * d[0] + oy * d[1] + oz * d[2];
    const t = -b + Math.sqrt(Math.max(b * b - cc, 0));
    P[o] = cx + d[0] * t;
    P[o + 1] = cy + d[1] * t;
    P[o + 2] = cz + d[2] * t;
  };
  const seg = (a: Readonly<Vec3>, b: Readonly<Vec3>, col: Readonly<Vec3>, k: number) => {
    if (n >= LINE_CAPACITY) return;
    if (a[1] < -0.02 && b[1] < -0.02) return; // under the horizon
    put(a, n * 6);
    put(b, n * 6 + 3);
    for (let j = 0; j < 2; j++) {
      C[n * 6 + j * 3] = col[0] * k;
      C[n * 6 + j * 3 + 1] = col[1] * k;
      C[n * 6 + j * 3 + 2] = col[2] * k;
    }
    n++;
  };
  /** Normalized mix of two unit vectors (a short arc: close enough to the great circle). */
  const mixDir = (a: Readonly<Vec3>, b: Readonly<Vec3>, t: number, out: Vec3) => {
    out[0] = a[0] + (b[0] - a[0]) * t;
    out[1] = a[1] + (b[1] - a[1]) * t;
    out[2] = a[2] + (b[2] - a[2]) * t;
    const l = Math.hypot(out[0], out[1], out[2]) || 1;
    out[0] /= l;
    out[1] /= l;
    out[2] /= l;
    return out;
  };
  for (const l of lineSpec) {
    const f = l.geom.figure;
    const col = f.kind === "asterism" ? LINE_GOLD : LINE_BLUE;
    const k = l.brightness;
    if (f.ring) {
      // the Pleiades: a small ring around the cluster's middle
      const grow = l.revealAge === Infinity ? 1 : Math.min(1, l.revealAge / 0.6);
      ringAround(l.geom, f.ring, grow, col, k, seg);
      continue;
    }
    const order = l.order ?? f.lines.map((_, i) => i);
    order.forEach((li, step) => {
      const frac = l.revealAge === Infinity ? 1 : Math.min(1, Math.max(0, (l.revealAge - step * REVEAL_STEP) / REVEAL_DRAW));
      if (frac <= 0) return;
      const [ia, ib] = l.geom.lines[li]!;
      starDirection(ia, la);
      starDirection(ib, lb);
      const theta = Math.acos(Math.min(1, la[0] * lb[0] + la[1] * lb[1] + la[2] * lb[2])) * (180 / Math.PI);
      if (theta < 2 * LINE_GAP_DEG + 0.3) return;
      const t0 = LINE_GAP_DEG / theta;
      const t1 = t0 + (1 - 2 * t0) * frac;
      if (f.dashed) {
        const period = (DASH_DEG + DASH_GAP_DEG) / theta;
        for (let t = t0; t < t1; t += period) {
          mixDir(la, lb, t, lp);
          mixDir(la, lb, Math.min(t1, t + DASH_DEG / theta), lq);
          seg(lp, lq, col, k);
        }
      } else {
        mixDir(la, lb, t0, lp);
        mixDir(la, lb, t1, lq);
        seg(lp, lq, col, k);
      }
    });
  }
  startAttr.data.needsUpdate = true;
  colourAttr.data.needsUpdate = true;
  return n;
}

const rc: Vec3 = [0, 0, 0];
const r1: Vec3 = [0, 0, 0];
const r2: Vec3 = [0, 0, 0];
/** A ring of `radiusDeg` around a figure's mean direction, `grow` (0..1) of it drawn. */
function ringAround(
  g: FigureGeom,
  radiusDeg: number,
  grow: number,
  col: Readonly<Vec3>,
  k: number,
  seg: (a: Readonly<Vec3>, b: Readonly<Vec3>, col: Readonly<Vec3>, k: number) => void,
): void {
  // centre = the mean of the cluster's stars
  rc[0] = rc[1] = rc[2] = 0;
  for (const i of g.stars) {
    starDirection(i, r1);
    rc[0] += r1[0];
    rc[1] += r1[1];
    rc[2] += r1[2];
  }
  const l = Math.hypot(rc[0], rc[1], rc[2]) || 1;
  rc[0] /= l;
  rc[1] /= l;
  rc[2] /= l;
  // a basis around it: u toward the zenith, v = c × u
  let ux = -rc[1] * rc[0];
  let uy = 1 - rc[1] * rc[1];
  let uz = -rc[1] * rc[2];
  const ul = Math.hypot(ux, uy, uz) || 1;
  ux /= ul;
  uy /= ul;
  uz /= ul;
  const vx = rc[1] * uz - rc[2] * uy;
  const vy = rc[2] * ux - rc[0] * uz;
  const vz = rc[0] * uy - rc[1] * ux;
  const r = Math.tan((radiusDeg * Math.PI) / 180);
  const N = 28;
  const at = (a: number, out: Vec3) => {
    out[0] = rc[0] + r * (Math.cos(a) * ux + Math.sin(a) * vx);
    out[1] = rc[1] + r * (Math.cos(a) * uy + Math.sin(a) * vy);
    out[2] = rc[2] + r * (Math.cos(a) * uz + Math.sin(a) * vz);
    const len = Math.hypot(out[0], out[1], out[2]);
    out[0] /= len;
    out[1] /= len;
    out[2] /= len;
  };
  const steps = Math.round(N * grow);
  for (let s = 0; s < steps; s++) {
    at((s / N) * 2 * Math.PI, r1);
    at(((s + 1) / N) * 2 * Math.PI, r2);
    seg(r1, r2, col, k);
  }
}

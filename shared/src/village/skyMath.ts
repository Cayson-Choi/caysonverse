/**
 * 케이슨 마을's night sky on real Korean time — pure and browser-safe (next to sunClock.ts, which does the sun).
 *
 * The owner: "한국 날짜를 보고 봄과 여름과 가을과 겨울에 따라서 하늘에 실제 별자리를 표시해 북극성도 보이고 북두칠성도 보이고".
 * Stars come with J2000.0 positions (the Yale Bright Star Catalogue, client/public/sky/stars.v1.bin). Where one stands in
 * the village's sky at an instant is ONE 3x3 matrix applied to its J2000 unit vector (`skyMatrix`):
 *
 *   scene = S(latitude) · Rz(-LST) · P(J2000 -> date) · e
 *
 *  - `P`: IAU 1976 precession (Meeus, "Astronomical Algorithms" ch. 21: zeta, z, theta). Without it the 2026 sky is off by up
 *    to 0.37°; with it the cost is the same one matrix.
 *  - `LST`: Greenwich mean sidereal time (IAU 1982, Meeus 12.4) + the village's longitude 127.8° E. UT1 - UTC (< 1 s) is
 *    ignored.
 *  - `S`: the hour-angle frame turned into the scene's: east +x, up +y, north -z (dayNightBlend.ts `directionFrom`).
 *
 * Nutation (≤ 0.005°), aberration (≤ 0.006°) and proper motion (≤ 0.02° over 26 years for these stars) are left out:
 * against the U.S. Naval Observatory's celestial-navigation API (independent code and data) the result is within 0.017°
 * for 109 star positions on four dates (skyMath.test.ts keeps a set of them).
 *
 * Also here: the refraction and extinction near the horizon, the faintest star the twilight lets through, the four bright
 * planets (JPL "Approximate Positions of the Planets", E. M. Standish, Table 1, 1800-2050), the next dusk, and the
 * Korean season of a date.
 */

import { KST_OFFSET_MS, VILLAGE_LATITUDE, VILLAGE_LONGITUDE, sunAt } from "./sunClock";

export type Vec3 = [number, number, number];
/** A row-major 3x3 matrix (m[0..2] the first row). */
export type Mat3 = Float64Array;

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const DAY_MS = 86_400_000;

const mod = (a: number, n: number): number => ((a % n) + n) % n;
const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);

/** Julian day of a Unix epoch instant (ms). */
export function julianDay(utcMs: number): number {
  return utcMs / DAY_MS + 2440587.5;
}

/** Greenwich mean sidereal time (degrees, 0..360) at `utcMs` — IAU 1982 (Meeus 12.4). */
export function gmstDeg(utcMs: number): number {
  const d = julianDay(utcMs) - 2451545.0;
  const t = d / 36525;
  return mod(280.46061837 + 360.98564736629 * d + 0.000387933 * t * t - (t * t * t) / 38710000, 360);
}

/** Local mean sidereal time (degrees, 0..360) at `longitudeDeg` (east positive; default: the village). */
export function lstDeg(utcMs: number, longitudeDeg = VILLAGE_LONGITUDE): number {
  return mod(gmstDeg(utcMs) + longitudeDeg, 360);
}

/** The IAU 1976 precession matrix J2000.0 -> mean equator and equinox of date (Meeus 21.2/21.3), row-major. */
export function precessionMatrix(utcMs: number, into: Mat3 = new Float64Array(9)): Mat3 {
  const t = (julianDay(utcMs) - 2451545.0) / 36525;
  const as = (x: number) => (x / 3600) * RAD;
  const zeta = as(2306.2181 * t + 0.30188 * t * t + 0.017998 * t * t * t);
  const z = as(2306.2181 * t + 1.09468 * t * t + 0.018203 * t * t * t);
  const th = as(2004.3109 * t - 0.42665 * t * t - 0.041833 * t * t * t);
  const cz = Math.cos(zeta), sz = Math.sin(zeta);
  const cZ = Math.cos(z), sZ = Math.sin(z);
  const ct = Math.cos(th), st = Math.sin(th);
  into[0] = cz * ct * cZ - sz * sZ;
  into[1] = -sz * ct * cZ - cz * sZ;
  into[2] = -st * cZ;
  into[3] = cz * ct * sZ + sz * cZ;
  into[4] = -sz * ct * sZ + cz * cZ;
  into[5] = -st * sZ;
  into[6] = cz * st;
  into[7] = -sz * st;
  into[8] = ct;
  return into;
}

/**
 * The one matrix of the sky at `utcMs`: a J2000 equatorial unit vector -> the scene's direction (x east, y up, z south,
 * i.e. north is -z). Pass `precession` (from `precessionMatrix`, which changes by a hair a minute) to skip recomputing it.
 */
export function skyMatrix(
  utcMs: number,
  into: Mat3 = new Float64Array(9),
  precession: Mat3 = precessionMatrix(utcMs),
  latitudeDeg = VILLAGE_LATITUDE,
  longitudeDeg = VILLAGE_LONGITUDE,
): Mat3 {
  const lst = lstDeg(utcMs, longitudeDeg) * RAD;
  const c = Math.cos(lst), s = Math.sin(lst);
  const p = latitudeDeg * RAD, cp = Math.cos(p), sp = Math.sin(p);
  // R = Rz(-LST): x toward the meridian (hour angle 0), y toward hour angle -6 h (east).
  // S: e' -> scene: x = e'y (east), y = cos φ e'x + sin φ e'z (up), z = sin φ e'x - cos φ e'z (south).
  // S·R, written out:
  const SR = [
    -s, c, 0,
    cp * c, cp * s, sp,
    sp * c, sp * s, -cp,
  ];
  const P = precession;
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) into[i * 3 + j] = SR[i * 3]! * P[j]! + SR[i * 3 + 1]! * P[3 + j]! + SR[i * 3 + 2]! * P[6 + j]!;
  return into;
}

/** The J2000 unit vector of a right ascension and declination (radians). */
export function equatorialUnit(raRad: number, decRad: number, into: Vec3 = [0, 0, 0]): Vec3 {
  const cd = Math.cos(decRad);
  into[0] = cd * Math.cos(raRad);
  into[1] = cd * Math.sin(raRad);
  into[2] = Math.sin(decRad);
  return into;
}

/** m · v (row-major m). */
export function applyMat3(m: Mat3, x: number, y: number, z: number, into: Vec3 = [0, 0, 0]): Vec3 {
  into[0] = m[0]! * x + m[1]! * y + m[2]! * z;
  into[1] = m[3]! * x + m[4]! * y + m[5]! * z;
  into[2] = m[6]! * x + m[7]! * y + m[8]! * z;
  return into;
}

/** Altitude (°, above the horizon) and compass azimuth (°, from north through east) of a scene direction. */
export function altAzOf(d: Readonly<Vec3>): { altDeg: number; azDeg: number } {
  const len = Math.hypot(d[0], d[1], d[2]) || 1;
  return { altDeg: Math.asin(clamp(d[1] / len, -1, 1)) * DEG, azDeg: mod(Math.atan2(d[0], -d[2]) * DEG, 360) };
}

/** Angle between two directions (°). */
export function angleDeg(a: Readonly<Vec3>, b: Readonly<Vec3>): number {
  const la = Math.hypot(a[0], a[1], a[2]) || 1;
  const lb = Math.hypot(b[0], b[1], b[2]) || 1;
  return Math.acos(clamp((a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (la * lb), -1, 1)) * DEG;
}

/** A star is drawn down to this TRUE altitude (°); below it is under the horizon (the shader sends it off screen). */
export const HORIZON_CUT_DEG = -1;

/**
 * Atmospheric refraction (°) for a TRUE altitude (°): Saemundsson's formula, standard pressure and temperature. About
 * 0.5° on the horizon, 5' at 10°, nothing at the zenith. 0 under `HORIZON_CUT_DEG`.
 */
export function refractionDeg(trueAltDeg: number): number {
  if (trueAltDeg < HORIZON_CUT_DEG) return 0;
  const h = Math.min(trueAltDeg, 89.9);
  return 1.02 / Math.tan((h + 10.3 / (h + 5.11)) * RAD) / 60;
}

/** The direction raised by the refraction (what an eye in the village sees), in place. */
export function refract(d: Vec3): Vec3 {
  const { altDeg } = altAzOf(d);
  const r = refractionDeg(altDeg);
  if (r === 0) return d;
  const hl = Math.hypot(d[0], d[2]);
  if (hl < 1e-9) return d;
  const h = (altDeg + r) * RAD;
  const len = Math.hypot(d[0], d[1], d[2]);
  const k = (Math.cos(h) * len) / hl;
  d[0] *= k;
  d[2] *= k;
  d[1] = Math.sin(h) * len;
  return d;
}

/** Air mass toward an (apparent) altitude (°): 1 at the zenith, about 5.6 at 10°, 40 on the horizon (Young-like fit). */
export function airMass(altDeg: number): number {
  const s = Math.max(0, Math.sin(altDeg * RAD));
  return 1 / (s + 0.025 * Math.exp(-11 * s));
}

/** Extinction coefficient (magnitudes per air mass) of a clear country sky. */
export const EXTINCTION_K = 0.25;

/** How much fainter (magnitudes) a star looks at an (apparent) altitude than at the zenith: ~1.2 at 10°, ~3.5 at 3°. */
export function extinctionMag(altDeg: number): number {
  return EXTINCTION_K * (airMass(altDeg) - 1);
}

/** The twilight's faintest visible magnitude by the sun's elevation (°): [elevation, magnitude], interpolated. */
export const TWILIGHT_LIMIT: readonly (readonly [number, number])[] = [
  [0, -1.5], // the sun just down: Venus alone
  [-3, 1.0],
  [-6, 3.0], // civil dusk: the bright stars
  [-9, 4.5],
  [-12, 5.5], // nautical dusk: the village's full sky
];

/** The faintest star (V magnitude) the sky lets through with the sun at `sunElevationDeg`, capped at `cap`. */
export function limitingMagnitude(sunElevationDeg: number, cap = 5.5): number {
  const t = TWILIGHT_LIMIT;
  let m: number;
  if (sunElevationDeg >= t[0]![0]) m = t[0]![1] - (sunElevationDeg - t[0]![0]);
  else if (sunElevationDeg <= t[t.length - 1]![0]) m = t[t.length - 1]![1];
  else {
    m = t[t.length - 1]![1];
    for (let i = 0; i < t.length - 1; i++) {
      const [e0, m0] = t[i]!;
      const [e1, m1] = t[i + 1]!;
      if (sunElevationDeg <= e0 && sunElevationDeg >= e1) {
        m = m0 + ((m1 - m0) * (sunElevationDeg - e0)) / (e1 - e0);
        break;
      }
    }
  }
  return Math.min(m, cap);
}

/** The whole star layer's weight by the sun's elevation (°): 0 with the sun up, 1 once its top is under the horizon. */
export function starLayerWeight(sunElevationDeg: number): number {
  const t = clamp((1 - sunElevationDeg) / 2, 0, 1); // 1° -> 0, -1° -> 1
  return t * t * (3 - 2 * t);
}

/** How much of a star shows for its (extinguished) magnitude against the limit: 1 a quarter magnitude brighter, 0 a quarter fainter. */
export function starVisibility(mag: number, limit: number): number {
  const t = clamp((limit + 0.25 - mag) / 0.5, 0, 1);
  return t * t * (3 - 2 * t);
}

// ------------------------------------------------------------------------------------------------------------------------
// Planets.

export type PlanetId = "venus" | "mars" | "jupiter" | "saturn";

export interface PlanetPosition {
  id: PlanetId;
  /** "금성" */
  name: string;
  /** Geocentric J2000 equatorial unit vector (light time included); the same `skyMatrix` places it. */
  eq: Vec3;
  /** Apparent V magnitude (approximate). */
  mag: number;
  /** Distance from the Earth (au). */
  distAu: number;
}

/** JPL Table 1 (1800-2050): a, e, I, L, long. peri., long. node, then their rates per Julian century. */
const ELEMENTS: Readonly<Record<PlanetId | "emb", readonly number[]>> = {
  emb: [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0, 0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0],
  venus: [0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255, 0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418],
  mars: [1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891, 0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343],
  jupiter: [5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909, -0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106],
  saturn: [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448, -0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794],
};

/** Magnitude: V(1,0) and the phase-angle terms (Explanatory Supplement style; rings and opposition surge ignored). */
const MAGNITUDE: Readonly<Record<PlanetId, readonly [number, number, number, number]>> = {
  venus: [-4.4, 0.0009, 0.000239, -0.00000065],
  mars: [-1.52, 0.016, 0, 0],
  jupiter: [-9.4, 0.005, 0, 0],
  saturn: [-8.88, 0.044, 0, 0],
};

export const PLANET_NAMES: Readonly<Record<PlanetId, string>> = { venus: "금성", mars: "화성", jupiter: "목성", saturn: "토성" };
export const PLANET_IDS: readonly PlanetId[] = ["venus", "mars", "jupiter", "saturn"];

/** J2000 obliquity of the ecliptic (°). */
const OBLIQUITY_J2000 = 23.43928;
/** Light time per au (s). */
const LIGHT_SECONDS_PER_AU = 499.005;

/** Heliocentric J2000 EQUATORIAL position (au) of a body from its JPL elements. */
function heliocentric(id: PlanetId | "emb", utcMs: number): Vec3 {
  const t = (julianDay(utcMs) - 2451545.0) / 36525;
  const e0 = ELEMENTS[id];
  const a = e0[0]! + e0[6]! * t;
  const e = e0[1]! + e0[7]! * t;
  const I = (e0[2]! + e0[8]! * t) * RAD;
  const L = e0[3]! + e0[9]! * t;
  const wbar = e0[4]! + e0[10]! * t;
  const Om = e0[5]! + e0[11]! * t;
  const w = (wbar - Om) * RAD;
  const O = Om * RAD;
  const M = (mod(L - wbar + 180, 360) - 180) * RAD;
  let E = M + e * Math.sin(M);
  for (let k = 0; k < 8; k++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(O), sO = Math.sin(O), ci = Math.cos(I), si = Math.sin(I);
  const x = (cw * cO - sw * sO * ci) * xp + (-sw * cO - cw * sO * ci) * yp;
  const y = (cw * sO + sw * cO * ci) * xp + (-sw * sO + cw * cO * ci) * yp;
  const z = sw * si * xp + cw * si * yp;
  const eps = OBLIQUITY_J2000 * RAD;
  return [x, Math.cos(eps) * y - Math.sin(eps) * z, Math.sin(eps) * y + Math.cos(eps) * z];
}

/** Where Venus, Mars, Jupiter and Saturn are at `utcMs` (geocentric, J2000 equatorial), with their magnitudes. */
export function planetsAt(utcMs: number): PlanetPosition[] {
  const earth = heliocentric("emb", utcMs);
  const R = Math.hypot(earth[0], earth[1], earth[2]);
  return PLANET_IDS.map((id) => {
    let p = heliocentric(id, utcMs);
    let g: Vec3 = [p[0] - earth[0], p[1] - earth[1], p[2] - earth[2]];
    let dist = Math.hypot(g[0], g[1], g[2]);
    for (let k = 0; k < 2; k++) {
      p = heliocentric(id, utcMs - dist * LIGHT_SECONDS_PER_AU * 1000);
      g = [p[0] - earth[0], p[1] - earth[1], p[2] - earth[2]];
      dist = Math.hypot(g[0], g[1], g[2]);
    }
    const r = Math.hypot(p[0], p[1], p[2]);
    const phase = Math.acos(clamp((r * r + dist * dist - R * R) / (2 * r * dist), -1, 1)) * DEG;
    const [m0, m1, m2, m3] = MAGNITUDE[id];
    const mag = m0 + 5 * Math.log10(r * dist) + m1 * phase + m2 * phase * phase + m3 * phase * phase * phase;
    return { id, name: PLANET_NAMES[id], eq: [g[0] / dist, g[1] / dist, g[2] / dist], mag, distAu: dist };
  });
}

// ------------------------------------------------------------------------------------------------------------------------
// Dusk and seasons.

/**
 * The next instant after `fromMs` when the sun sinks through `elevationDeg` (°, e.g. -6 = the end of civil dusk, when
 * the bright stars are out), within `maxHours`; null when it does not (it is already lower and stays so, a polar night).
 * 10-minute steps, then bisection to well under a second.
 */
export function nextSunset(fromMs: number, elevationDeg: number, maxHours = 36): number | null {
  const STEP = 600_000;
  let prev = sunAt(fromMs).elevationDeg;
  for (let t = fromMs + STEP; t <= fromMs + maxHours * 3_600_000; t += STEP) {
    const e = sunAt(t).elevationDeg;
    if (prev > elevationDeg && e <= elevationDeg) {
      let lo = t - STEP;
      let hi = t;
      for (let k = 0; k < 14; k++) {
        const mid = (lo + hi) / 2;
        if (sunAt(mid).elevationDeg > elevationDeg) lo = mid;
        else hi = mid;
      }
      return hi;
    }
    prev = e;
  }
  return null;
}

export type CalendarSeason = "spring" | "summer" | "autumn" | "winter";

/** The Korean season of a date (KST months: 3-5 봄, 6-8 여름, 9-11 가을, 12-2 겨울). */
export function seasonAt(utcMs: number): CalendarSeason {
  const month = new Date(utcMs + KST_OFFSET_MS).getUTCMonth() + 1;
  if (month >= 3 && month <= 5) return "spring";
  if (month >= 6 && month <= 8) return "summer";
  if (month >= 9 && month <= 11) return "autumn";
  return "winter";
}

/** The season that follows (the dawn sky shows the next season's figures). */
export function nextSeason(s: CalendarSeason): CalendarSeason {
  return s === "spring" ? "summer" : s === "summer" ? "autumn" : s === "autumn" ? "winter" : "spring";
}

// ── the moon ──

export interface MoonPosition {
  /** Geocentric J2000 equatorial unit vector (the same `skyMatrix` places it; add the parallax in the scene). */
  eq: Vec3;
  /** The sun's J2000 equatorial unit vector (to orient the lit side). */
  sunEq: Vec3;
  /** Horizontal parallax (°): a moon on the horizon stands this much lower than the Earth's centre sees it (~0.95°). */
  parallaxDeg: number;
  /** Sun-moon angle (°), 0 = new, 180 = full. */
  elongationDeg: number;
  /** Lit share of the disc, 0..1. */
  illuminated: number;
  /** Waxing (evening moon, lit on the west... toward the sun's side) or waning. */
  waxing: boolean;
}

/**
 * The moon (and the sun's longitude for its phase) from the Astronomical Almanac's low-precision lunar series
 * (Meeus-style, ~0.3° in longitude, ~0.2° in latitude; plenty for a sky seen with the eye). Ecliptic of date ->
 * equator of date (the obliquity of date) -> J2000 by the transposed precession matrix.
 */
export function moonAt(utcMs: number): MoonPosition {
  const t = (julianDay(utcMs) - 2451545.0) / 36525;
  const s = (a: number, b: number) => Math.sin((a + b * t) * RAD);
  const c = (a: number, b: number) => Math.cos((a + b * t) * RAD);
  const lon =
    218.32 + 481267.881 * t + 6.29 * s(135.0, 477198.87) - 1.27 * s(259.3, -413335.36) + 0.66 * s(235.7, 890534.22) +
    0.21 * s(269.9, 954397.74) - 0.19 * s(357.5, 35999.05) - 0.11 * s(186.5, 966404.03);
  const lat = 5.13 * s(93.3, 483202.02) + 0.28 * s(228.2, 960400.89) - 0.28 * s(318.3, 6003.15) - 0.17 * s(217.6, -407332.21);
  const par = 0.9508 + 0.0518 * c(135.0, 477198.87) + 0.0095 * c(259.3, -413335.36) + 0.0078 * c(235.7, 890534.22) + 0.0028 * c(269.9, 954397.74);
  const g = 357.529 + 35999.05 * t;
  const sunLon = 280.46 + 36000.77 * t + 1.915 * Math.sin(g * RAD) + 0.02 * Math.sin(2 * g * RAD);
  const eps = (23.439291 - 0.0130042 * t) * RAD;
  const P = precessionMatrix(utcMs);
  const toJ2000 = (lonDeg: number, latDeg: number): Vec3 => {
    const l = lonDeg * RAD, b = latDeg * RAD;
    const xe = Math.cos(b) * Math.cos(l);
    const ye = Math.cos(b) * Math.sin(l);
    const ze = Math.sin(b);
    // ecliptic -> equator of date
    const x = xe;
    const y = ye * Math.cos(eps) - ze * Math.sin(eps);
    const z = ye * Math.sin(eps) + ze * Math.cos(eps);
    // equator of date -> J2000: Pᵀ
    return [P[0]! * x + P[3]! * y + P[6]! * z, P[1]! * x + P[4]! * y + P[7]! * z, P[2]! * x + P[5]! * y + P[8]! * z];
  };
  const eq = toJ2000(lon, lat);
  const sunEq = toJ2000(sunLon, 0);
  const elongationDeg = angleDeg(eq, sunEq);
  const illuminated = (1 - Math.cos(elongationDeg * RAD)) / 2;
  const waxing = mod(lon - sunLon, 360) < 180;
  return { eq, sunEq, parallaxDeg: par, elongationDeg, illuminated, waxing };
}

/** Korean phase word for the album/HUD ("보름달", "초승달"...). */
export function moonPhaseName(m: Pick<MoonPosition, "illuminated" | "waxing">): string {
  const k = m.illuminated;
  if (k < 0.03) return "삭 (달이 안 보여요)";
  if (k > 0.97) return "보름달";
  if (k < 0.4) return m.waxing ? "초승달" : "그믐달";
  if (k < 0.6) return m.waxing ? "상현달" : "하현달";
  return m.waxing ? "차오르는 달" : "기우는 달";
}

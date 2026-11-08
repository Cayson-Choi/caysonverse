/**
 * 케이슨 마을's sun on real Korean time (Task 7A) — pure and browser-safe, shared by the client (and its tests).
 *
 * The owner: "시간에 따라서 해가 떴다가 지고 … 실제 한국 시간과 같게 해야지". The village stands at 36.5° N, 127.8° E
 * (central Korea), and the sun's place in its sky is computed from the ABSOLUTE instant (UTC milliseconds) with the
 * NOAA solar calculator's formulas (after Meeus, "Astronomical Algorithms": the sun's mean longitude and anomaly, the
 * equation of centre, nutation-corrected apparent longitude and obliquity, the equation of time; about ±1° in
 * elevation, well under a minute of time near the horizon). The elevation includes the NOAA atmospheric-refraction
 * correction, so it is the sun an observer in the village sees: 0° is the centre of the disc on the horizon.
 *
 * "Korean time" (KST, UTC+9, no daylight saving since 1988) only names an instant for people (`kstClock`, the DEV
 * override `parseKstTime`): the sun itself never needs a time-zone library.
 */

/** The village's place on Earth (degrees; east and north positive). */
export const VILLAGE_LATITUDE = 36.5;
export const VILLAGE_LONGITUDE = 127.8;

/** Korea Standard Time is UTC+9 all year. */
export const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export interface SunPosition {
  /** Apparent elevation of the sun's centre above the horizon (refraction included), degrees. */
  elevationDeg: number;
  /** Compass azimuth, degrees clockwise from north (90 = east, 180 = south). */
  azimuthDeg: number;
}

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const DAY_MS = 86_400_000;

const mod = (a: number, n: number): number => ((a % n) + n) % n;

/** NOAA's atmospheric refraction (degrees) for a true elevation (degrees). */
function refraction(elevationDeg: number): number {
  if (elevationDeg > 85) return 0;
  const te = Math.tan(elevationDeg * RAD);
  let arcsec: number;
  if (elevationDeg > 5) arcsec = 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5;
  else if (elevationDeg > -0.575) {
    const e = elevationDeg;
    arcsec = 1735 + e * (-518.2 + e * (103.4 + e * (-12.79 + e * 0.711)));
  } else arcsec = -20.772 / te;
  return arcsec / 3600;
}

/**
 * Where the sun stands in the sky at `utcMs` (Unix epoch milliseconds), seen from `latitude`/`longitude` (default:
 * the village). The date matters: sunrise and sunset move with the seasons.
 */
export function sunAt(utcMs: number, latitude = VILLAGE_LATITUDE, longitude = VILLAGE_LONGITUDE): SunPosition {
  const jd = utcMs / DAY_MS + 2440587.5;
  const t = (jd - 2451545) / 36525; // Julian centuries since J2000.0
  const l0 = mod(280.46646 + t * (36000.76983 + t * 0.0003032), 360); // geometric mean longitude
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t); // mean anomaly
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t); // orbit eccentricity
  const c =
    Math.sin(m * RAD) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * m * RAD) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * m * RAD) * 0.000289; // equation of centre
  const omega = 125.04 - 1934.136 * t;
  const lambda = l0 + c - 0.00569 - 0.00478 * Math.sin(omega * RAD); // apparent longitude
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * RAD); // corrected obliquity
  const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD));
  const y = Math.tan((eps / 2) * RAD) ** 2;
  const eqTimeMin =
    4 *
    DEG *
    (y * Math.sin(2 * l0 * RAD) -
      2 * e * Math.sin(m * RAD) +
      4 * e * y * Math.sin(m * RAD) * Math.cos(2 * l0 * RAD) -
      0.5 * y * y * Math.sin(4 * l0 * RAD) -
      1.25 * e * e * Math.sin(2 * m * RAD));
  const minutesUtc = mod(utcMs, DAY_MS) / 60_000;
  const trueSolarMin = mod(minutesUtc + eqTimeMin + 4 * longitude, 1440);
  const hourAngle = (trueSolarMin / 4 - 180) * RAD; // negative in the morning
  const lat = latitude * RAD;
  const cosZenith = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle);
  const zenith = Math.acos(Math.min(1, Math.max(-1, cosZenith)));
  const trueElevation = 90 - zenith * DEG;
  // From south, westward; +180 turns it into a compass bearing from north.
  const az = Math.atan2(Math.sin(hourAngle), Math.cos(hourAngle) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat)) * DEG;
  return { elevationDeg: trueElevation + refraction(trueElevation), azimuthDeg: mod(az + 180, 360) };
}

/** Day / night blend weights and the golden-hour tint (each 0..1) for a sun elevation. */
export interface DayPhase {
  /** 1 in full daylight (above +8°), 0 at night. */
  day: number;
  /** 1 - day: 1 below -8°. */
  night: number;
  /** The warm light of sunrise and sunset: 0 below -2° and above +12°, rising to 1 at +3°. */
  golden: number;
}

/** The phase ramps (degrees of sun elevation). */
export const PHASE = {
  /** Full day at and above this elevation. */
  dayFrom: 8,
  /** Full night at and below this elevation. */
  nightFrom: -8,
  /** The golden-hour tint: from, peak, to. */
  golden: [-2, 3, 12],
} as const;

/** Hermite smoothstep: 0 at `a`, 1 at `b`, smooth in between (clamped). */
export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** The blend weights for a sun elevation (degrees): dawn and dusk are the smooth ramp between -8° and +8°. */
export function phaseAt(elevationDeg: number): DayPhase {
  const day = smoothstep(PHASE.nightFrom, PHASE.dayFrom, elevationDeg);
  const [g0, g1, g2] = PHASE.golden;
  const golden = smoothstep(g0, g1, elevationDeg) * (1 - smoothstep(g1, g2, elevationDeg));
  return { day, night: 1 - day, golden };
}

/** The wall-clock reading in Korea at `utcMs` (for display and tests). */
export function kstClock(utcMs: number): { year: number; month: number; day: number; hour: number; minute: number } {
  const d = new Date(utcMs + KST_OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
  };
}

/**
 * An ISO-like date-time read as Korean time unless it names its own zone: "2026-06-21T20:30" is 20:30 KST
 * (= 11:30 UTC); "2026-06-21T11:30Z" or "...+09:00" are taken as written. Returns UTC milliseconds, or null when the
 * text is not a date-time.
 */
export function parseKstTime(text: string): number | null {
  const s = text.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(s);
  if (!m) return null;
  const [, y, mo, d, h = "00", mi = "00", sec = "00", zone] = m;
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${sec}${zone ? (zone === "Z" ? "Z" : zone.length === 5 ? `${zone.slice(0, 3)}:${zone.slice(3)}` : zone) : "+09:00"}`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

import { describe, expect, it } from "vitest";
import { kstClock, parseKstTime, VILLAGE_LATITUDE } from "./sunClock";
import {
  airMass,
  altAzOf,
  angleDeg,
  applyMat3,
  equatorialUnit,
  extinctionMag,
  gmstDeg,
  limitingMagnitude,
  lstDeg,
  nextSeason,
  nextSunset,
  planetsAt,
  precessionMatrix,
  refract,
  refractionDeg,
  seasonAt,
  skyMatrix,
  starLayerWeight,
  starVisibility,
  type Mat3,
  type Vec3,
} from "./skyMath";

const RAD = Math.PI / 180;

/** J2000 positions from the Yale Bright Star Catalogue 5th ed. (RA, Dec in degrees). */
const STAR: Record<string, [number, number]> = {
  polaris: [37.95292, 89.26417], // HR 424
  dubhe: [165.93208, 61.75083], // HR 4301
  alkaid: [206.885, 49.31333], // HR 5191
  arcturus: [213.91542, 19.1825], // HR 5340
  spica: [201.29833, -11.16139], // HR 5056
  regulus: [152.09292, 11.96722], // HR 3982
  vega: [279.23458, 38.78361], // HR 7001
  deneb: [310.35792, 45.28028], // HR 7924
  altair: [297.69583, 8.86833], // HR 7557
  antares: [247.35167, -26.43194], // HR 6134
  markab: [346.19042, 15.20528], // HR 8781
  alpheratz: [2.09708, 29.09056], // HR 15
  schedar: [10.12708, 56.53722], // HR 168
  betelgeuse: [88.79292, 7.40694], // HR 2061
  rigel: [78.63458, -8.20167], // HR 1713
  sirius: [101.28708, -16.71611], // HR 2491
  procyon: [114.82542, 5.225], // HR 2943
  capella: [79.1725, 45.99806], // HR 1708
};

/** Where a catalogue star stands (no refraction) at `utcMs`. */
function star(name: string, utcMs: number): { altDeg: number; azDeg: number } {
  const [ra, dec] = STAR[name]!;
  const e = equatorialUnit(ra * RAD, dec * RAD);
  return altAzOf(applyMat3(skyMatrix(utcMs), e[0], e[1], e[2]));
}

/** Azimuth difference folded into ±180, times cos(alt): the angle on the sky. */
const dAz = (a: number, b: number, alt: number) => ((((a - b + 540) % 360) - 180) * Math.cos(alt * RAD));

/**
 * U.S. Naval Observatory, celestial-navigation API (aa.usno.navy.mil/api/celnav, coords 36.5,127.8, 12:00 UT = 21:00 KST):
 * computed altitude Hc and azimuth Zn, without refraction. Retrieved 2026-11-10 for the star-sky design.
 */
const USNO: Array<[string, string, string, number, number]> = [
  ["spring", "2026-04-15T12:00:00Z", "polaris", 36.33, 359.25],
  ["spring", "2026-04-15T12:00:00Z", "dubhe", 63.21, 15.72],
  ["spring", "2026-04-15T12:00:00Z", "alkaid", 48.27, 54.22],
  ["spring", "2026-04-15T12:00:00Z", "arcturus", 32.81, 89.66],
  ["spring", "2026-04-15T12:00:00Z", "spica", 22.84, 125.18],
  ["spring", "2026-04-15T12:00:00Z", "regulus", 65.32, 177.69],
  ["summer", "2026-08-15T12:00:00Z", "vega", 83.44, 67.03],
  ["summer", "2026-08-15T12:00:00Z", "deneb", 59.65, 60.75],
  ["summer", "2026-08-15T12:00:00Z", "altair", 53.54, 132.53],
  ["summer", "2026-08-15T12:00:00Z", "antares", 23.09, 203.26],
  ["summer", "2026-08-15T12:00:00Z", "polaris", 36.05, 0.55],
  ["autumn", "2026-10-15T12:00:00Z", "markab", 65.14, 144.43],
  ["autumn", "2026-10-15T12:00:00Z", "alpheratz", 63.41, 96.93],
  ["autumn", "2026-10-15T12:00:00Z", "schedar", 57.32, 39.48],
  ["autumn", "2026-10-15T12:00:00Z", "dubhe", 8.81, 353.08],
  ["autumn", "2026-10-15T12:00:00Z", "polaris", 36.66, 0.75],
  ["winter", "2027-01-15T12:00:00Z", "betelgeuse", 52.11, 133.59],
  ["winter", "2027-01-15T12:00:00Z", "rigel", 42.73, 157.57],
  ["winter", "2027-01-15T12:00:00Z", "sirius", 25.22, 138.15],
  ["winter", "2027-01-15T12:00:00Z", "procyon", 32.61, 109.92],
  ["winter", "2027-01-15T12:00:00Z", "capella", 74.02, 48.1],
  ["winter", "2027-01-15T12:00:00Z", "polaris", 37.09, 359.79],
];

describe("sidereal time", () => {
  it("matches the USNO's Greenwich mean sidereal time (2026-04-15 12:00 UT = 01:34:38.6383)", () => {
    const want = (1 + 34 / 60 + 38.6383 / 3600) * 15;
    expect(gmstDeg(Date.parse("2026-04-15T12:00:00Z"))).toBeCloseTo(want, 3);
  });
  it("is J2000.0's 280.46° at noon on 2000-01-01 (Meeus 12.4)", () => {
    expect(gmstDeg(Date.parse("2000-01-01T12:00:00Z"))).toBeCloseTo(280.46061837, 6);
  });
  it("adds the village's longitude for the local sidereal time", () => {
    const t = Date.parse("2026-11-10T12:00:00Z");
    expect((lstDeg(t) - gmstDeg(t) + 360) % 360).toBeCloseTo(127.8, 9);
  });
  it("gains about 3 m 56 s a day on the clock", () => {
    const t = Date.parse("2026-11-10T12:00:00Z");
    const gain = ((gmstDeg(t + 86_400_000) - gmstDeg(t) + 360) % 360) / 15 * 3600;
    expect(gain).toBeCloseTo(236.555, 1);
  });
});

describe("the sky matrix against the USNO", () => {
  it.each(USNO)("%s %s: %s", (_season, iso, name, hc, zn) => {
    const { altDeg, azDeg } = star(name, Date.parse(iso));
    expect(Math.abs(altDeg - hc)).toBeLessThan(0.05);
    expect(Math.abs(dAz(azDeg, zn, altDeg))).toBeLessThan(0.05);
  });

  it("is a rotation (orthonormal, determinant +1)", () => {
    const m = skyMatrix(Date.parse("2026-11-10T12:00:00Z"));
    const row = (i: number): Vec3 => [m[i * 3]!, m[i * 3 + 1]!, m[i * 3 + 2]!];
    for (let i = 0; i < 3; i++) {
      const r = row(i);
      expect(Math.hypot(...r)).toBeCloseTo(1, 12);
      for (let j = i + 1; j < 3; j++) {
        const s = row(j);
        expect(r[0] * s[0] + r[1] * s[1] + r[2] * s[2]).toBeCloseTo(0, 12);
      }
    }
    const det =
      m[0]! * (m[4]! * m[8]! - m[5]! * m[7]!) - m[1]! * (m[3]! * m[8]! - m[5]! * m[6]!) + m[2]! * (m[3]! * m[7]! - m[4]! * m[6]!);
    expect(det).toBeCloseTo(1, 12);
  });

  it("needs the precession: J2000 as it is would put Regulus (on the ecliptic) 0.36° off in 2026", () => {
    const t = Date.parse("2026-04-15T12:00:00Z");
    const identity: Mat3 = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const [ra, dec] = STAR.regulus!;
    const e = equatorialUnit(ra * RAD, dec * RAD);
    const a = applyMat3(skyMatrix(t), e[0], e[1], e[2]);
    const b = applyMat3(skyMatrix(t, undefined, identity), e[0], e[1], e[2]);
    expect(angleDeg(a, b)).toBeGreaterThan(0.33);
    expect(angleDeg(a, b)).toBeLessThan(0.38);
    // and the matrix of a minute later is the same to well under a pixel (cached a minute in the client)
    const p0 = precessionMatrix(t);
    const p1 = precessionMatrix(t + 60_000);
    for (let i = 0; i < 9; i++) expect(Math.abs(p0[i]! - p1[i]!)).toBeLessThan(1e-9);
  });

  it("keeps Polaris at the village's latitude (±0.7°) all year, all night, due north", () => {
    const from = Date.parse("2026-01-01T00:00:00Z");
    for (let k = 0; k < 120; k++) {
      const t = from + k * 3.1 * 86_400_000 + (k % 24) * 3_600_000;
      const { altDeg, azDeg } = star("polaris", t);
      expect(Math.abs(altDeg - VILLAGE_LATITUDE)).toBeLessThan(0.7);
      expect(Math.min(azDeg, 360 - azDeg)).toBeLessThan(1.2);
    }
  });

  it("shows the seasons' landmarks at 21:00 KST", () => {
    // spring: the Dipper's bowl high in the north-north-east
    const spring = star("dubhe", parseKstTime("2026-04-15T21:00")!);
    expect(spring.altDeg).toBeGreaterThan(55);
    expect(spring.azDeg).toBeGreaterThan(0);
    expect(spring.azDeg).toBeLessThan(45);
    // summer: Vega almost overhead
    expect(star("vega", parseKstTime("2026-08-15T21:00")!).altDeg).toBeGreaterThan(80);
    // autumn: the Dipper low in the north (behind the hills)
    expect(star("dubhe", parseKstTime("2026-10-15T21:00")!).altDeg).toBeLessThan(12);
    // winter: Orion in the south-east
    const ori = star("betelgeuse", parseKstTime("2027-01-15T21:00")!);
    expect(ori.azDeg).toBeGreaterThan(110);
    expect(ori.azDeg).toBeLessThan(160);
  });

  it("puts the scene's north at -z and east at +x (dayNightBlend's directionFrom)", () => {
    expect(altAzOf([0, 0, -1]).azDeg).toBeCloseTo(0, 9);
    expect(altAzOf([1, 0, 0]).azDeg).toBeCloseTo(90, 9);
    expect(altAzOf([0, 0, 1]).azDeg).toBeCloseTo(180, 9);
    expect(altAzOf([0, 1, 0]).altDeg).toBeCloseTo(90, 9);
  });
});

describe("near the horizon", () => {
  it("refracts about half a degree on the horizon, 5' at 10°, nothing overhead (Saemundsson)", () => {
    expect(refractionDeg(0)).toBeCloseTo(0.483, 2);
    expect(refractionDeg(10) * 60).toBeCloseTo(5.4, 1);
    expect(refractionDeg(89.9)).toBeLessThan(0.001);
    expect(refractionDeg(-2)).toBe(0);
  });
  it("raises a direction by the refraction, keeping its azimuth", () => {
    const d: Vec3 = [Math.cos(5 * RAD), Math.sin(5 * RAD), 0];
    refract(d);
    const { altDeg, azDeg } = altAzOf(d);
    expect(altDeg).toBeCloseTo(5 + refractionDeg(5), 6);
    expect(azDeg).toBeCloseTo(90, 9);
    expect(Math.hypot(...d)).toBeCloseTo(1, 12);
  });
  it("dims low stars: ~1.2 mag at 10°, ~3.5 at 3°, none overhead", () => {
    expect(extinctionMag(90)).toBeCloseTo(0, 3);
    expect(extinctionMag(10)).toBeGreaterThan(1.0);
    expect(extinctionMag(10)).toBeLessThan(1.4);
    expect(extinctionMag(3)).toBeGreaterThan(3.0);
    expect(extinctionMag(3)).toBeLessThan(4.0);
    expect(airMass(0)).toBeCloseTo(40, 0);
  });
});

describe("the twilight", () => {
  it("lets the stars in by the sun's depth: Venus, then the first stars, then the full sky", () => {
    expect(limitingMagnitude(0)).toBeCloseTo(-1.5, 9);
    expect(limitingMagnitude(-3)).toBeCloseTo(1.0, 9);
    expect(limitingMagnitude(-6)).toBeCloseTo(3.0, 9);
    expect(limitingMagnitude(-9)).toBeCloseTo(4.5, 9);
    expect(limitingMagnitude(-12)).toBeCloseTo(5.5, 9);
    expect(limitingMagnitude(-30)).toBeCloseTo(5.5, 9);
    expect(limitingMagnitude(-4.5)).toBeCloseTo(2.0, 9);
    expect(limitingMagnitude(-20, 5.0)).toBe(5.0);
    expect(limitingMagnitude(10)).toBeLessThan(-4.6); // daytime: not even Venus
  });
  it("fades the whole layer in as the sun goes down", () => {
    expect(starLayerWeight(5)).toBe(0);
    expect(starLayerWeight(-5)).toBe(1);
    expect(starLayerWeight(0)).toBeCloseTo(0.5, 9);
  });
  it("shows a star a quarter magnitude brighter than the limit fully, a quarter fainter not at all", () => {
    expect(starVisibility(5.0, 5.5)).toBe(1);
    expect(starVisibility(5.75, 5.5)).toBe(0);
    expect(starVisibility(5.5, 5.5)).toBeCloseTo(0.5, 9);
  });
  it("knows tonight's civil dusk: 2026-11-10 about 17:51 KST", () => {
    const t = nextSunset(parseKstTime("2026-11-10T12:00")!, -6)!;
    const c = kstClock(t);
    expect(c.day).toBe(10);
    expect(c.hour * 60 + c.minute).toBeGreaterThanOrEqual(17 * 60 + 49);
    expect(c.hour * 60 + c.minute).toBeLessThanOrEqual(17 * 60 + 53);
    // after it, the next one is tomorrow's
    const next = kstClock(nextSunset(t + 60_000, -6)!);
    expect(next.day).toBe(11);
  });
});

describe("the planets against the USNO (21:00 KST)", () => {
  const cases: Array<[string, string, number, number]> = [
    ["2026-04-15T12:00:00Z", "jupiter", 50.57, 261.78],
    ["2026-08-15T12:00:00Z", "venus", 1.67, 262.89],
    ["2026-10-15T12:00:00Z", "saturn", 40.02, 125.08],
    ["2027-01-15T12:00:00Z", "jupiter", 11.96, 81.29],
    ["2027-01-15T12:00:00Z", "saturn", 29.68, 247.22],
  ];
  it.each(cases)("%s %s", (iso, id, hc, zn) => {
    const t = Date.parse(iso);
    const p = planetsAt(t).find((q) => q.id === id)!;
    const { altDeg, azDeg } = altAzOf(applyMat3(skyMatrix(t), p.eq[0], p.eq[1], p.eq[2]));
    expect(Math.abs(altDeg - hc)).toBeLessThan(0.15);
    expect(Math.abs(dAz(azDeg, zn, altDeg))).toBeLessThan(0.15);
  });
  it("gives plausible magnitudes: Venus near -4, Jupiter near -2, Saturn near +1", () => {
    const ps = planetsAt(Date.parse("2026-04-15T12:00:00Z"));
    const mag = (id: string) => ps.find((p) => p.id === id)!.mag;
    expect(mag("venus")).toBeLessThan(-3.5);
    expect(mag("jupiter")).toBeLessThan(-1.5);
    expect(mag("jupiter")).toBeGreaterThan(-3);
    expect(mag("saturn")).toBeGreaterThan(-0.5);
    expect(mag("saturn")).toBeLessThan(1.8);
    for (const p of ps) expect(Math.hypot(...p.eq)).toBeCloseTo(1, 12);
  });
});

describe("seasons", () => {
  it("follows the Korean calendar month", () => {
    expect(seasonAt(parseKstTime("2026-03-01T00:00")!)).toBe("spring");
    expect(seasonAt(parseKstTime("2026-05-31T23:59")!)).toBe("spring");
    expect(seasonAt(parseKstTime("2026-06-01T00:00")!)).toBe("summer");
    expect(seasonAt(parseKstTime("2026-11-10T21:00")!)).toBe("autumn");
    expect(seasonAt(parseKstTime("2026-12-01T00:30")!)).toBe("winter");
    expect(seasonAt(parseKstTime("2027-02-28T21:00")!)).toBe("winter");
    // 2026-11-30 23:30 KST is still November in Korea (UTC already says 14:30 on the 30th; the edge is KST's)
    expect(seasonAt(parseKstTime("2026-11-30T23:30")!)).toBe("autumn");
    expect(seasonAt(parseKstTime("2026-12-01T00:10")!)).toBe("winter");
    expect(nextSeason("autumn")).toBe("winter");
    expect(nextSeason("winter")).toBe("spring");
  });
});

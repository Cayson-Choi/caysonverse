import { describe, expect, it } from "vitest";
import {
  KST_OFFSET_MS,
  PHASE,
  VILLAGE_LATITUDE,
  VILLAGE_LONGITUDE,
  kstClock,
  parseKstTime,
  phaseAt,
  sunAt,
} from "./sunClock";

/**
 * Published sunrise and sunset in Seoul (KST), from 한국천문연구원 (KASI) 천문우주지식정보 "월별 천문현상"
 * (https://astro.kasi.re.kr/life/pageView/7?yyyy=2026&mm=06 and &mm=12, the Seoul table; read 2026-11-03):
 *   2026-06-21 (하지 17:25): 일출 05:11, 일몰 19:57
 *   2026-12-21:              일출 07:43, 일몰 17:17
 * KASI's sunrise/sunset is the moment the sun's UPPER LIMB touches the horizon (standard refraction included),
 * rounded to the minute. These are also the well-known solstice values for Seoul.
 */
const KASI_SEOUL = {
  "2026-06-21": { sunrise: "05:11", sunset: "19:57" },
  "2026-12-21": { sunrise: "07:43", sunset: "17:17" },
} as const;

/** KASI's Seoul reference point (서울특별시청). */
const SEOUL = { lat: 37.5665, lon: 126.978 } as const;
/** The sun's apparent semi-diameter (°): the upper limb is on the horizon when the centre is this far below it. */
const SEMI_DIAMETER = 0.2667;

const kst = (date: string, hhmm: string) => Date.parse(`${date}T${hhmm}:00+09:00`);

/**
 * The instant (UTC ms) the apparent elevation crosses `level` on that Korean day, rising or setting, found by a
 * 10-second scan and a bisection to the second.
 */
function crossing(date: string, rising: boolean, opts: { lat?: number; lon?: number; level?: number } = {}): number {
  const { lat = VILLAGE_LATITUDE, lon = VILLAGE_LONGITUDE, level = 0 } = opts;
  const f = (t: number) => sunAt(t, lat, lon).elevationDeg - level;
  const start = kst(date, "00:00");
  let prev = f(start);
  for (let t = start + 10_000; t <= start + 86_400_000; t += 10_000) {
    const e = f(t);
    if (rising ? prev < 0 && e >= 0 : prev > 0 && e <= 0) {
      let a = t - 10_000;
      let b = t;
      while (b - a > 1000) {
        const mid = (a + b) / 2;
        if ((f(mid) < 0) === rising) a = mid;
        else b = mid;
      }
      return b;
    }
    prev = e;
  }
  throw new Error(`no ${rising ? "rise" : "set"} on ${date}`);
}

const minutesApart = (a: number, b: number) => Math.abs(a - b) / 60_000;

describe("sunAt: the sun over the village on real time (NOAA / Meeus low-precision formulas)", () => {
  for (const [date, kasi] of Object.entries(KASI_SEOUL)) {
    it(`${date}: at KASI's Seoul point the upper limb meets the horizon at the published ${kasi.sunrise} / ${kasi.sunset} (±2 min)`, () => {
      const at = { lat: SEOUL.lat, lon: SEOUL.lon, level: -SEMI_DIAMETER };
      expect(minutesApart(crossing(date, true, at), kst(date, kasi.sunrise))).toBeLessThanOrEqual(2);
      expect(minutesApart(crossing(date, false, at), kst(date, kasi.sunset))).toBeLessThanOrEqual(2);
    });

    it(`${date}: in the village (36.5° N, 127.8° E) the elevation crosses 0 within ±10 min of Seoul's ${kasi.sunrise} / ${kasi.sunset}`, () => {
      // The village is 0.8° east of Seoul (everything about 3 min earlier) and 1° further south (a shorter summer and a
      // longer winter day), and 0° is the centre of the disc, not its upper limb: June's sunset lands about 8 min early.
      expect(minutesApart(crossing(date, true), kst(date, kasi.sunrise))).toBeLessThanOrEqual(10);
      expect(minutesApart(crossing(date, false), kst(date, kasi.sunset))).toBeLessThanOrEqual(10);
    });
  }

  it("the date matters: the June day is about 14 h 36 m long, the December day about 9 h 37 m", () => {
    const june = crossing("2026-06-21", false) - crossing("2026-06-21", true);
    const dec = crossing("2026-12-21", false) - crossing("2026-12-21", true);
    expect(june / 3_600_000).toBeGreaterThan(14.4);
    expect(june / 3_600_000).toBeLessThan(14.8);
    expect(dec / 3_600_000).toBeGreaterThan(9.4);
    expect(dec / 3_600_000).toBeLessThan(9.9);
  });

  it("midday is higher in June (about 90 - 36.5 + 23.4 = 77°) than in December (about 30°), due south both times", () => {
    const peak = (date: string) => {
      let best = { t: 0, el: -90 };
      for (let t = kst(date, "10:00"); t <= kst(date, "15:00"); t += 60_000) {
        const el = sunAt(t).elevationDeg;
        if (el > best.el) best = { t, el };
      }
      return best;
    };
    const june = peak("2026-06-21");
    const dec = peak("2026-12-21");
    expect(june.el).toBeGreaterThan(dec.el);
    expect(june.el).toBeCloseTo(76.9, 0);
    expect(dec.el).toBeCloseTo(30.1, 0);
    for (const p of [june, dec]) {
      expect(Math.abs(sunAt(p.t).azimuthDeg - 180)).toBeLessThan(2);
      // Solar noon at 127.8° E is about 12:29 KST (the zone's meridian is 135° E), give or take the equation of time.
      const { hour, minute } = kstClock(p.t);
      expect(hour * 60 + minute).toBeGreaterThan(12 * 60 + 15);
      expect(hour * 60 + minute).toBeLessThan(12 * 60 + 45);
    }
  });

  it("rises in the north-east in June and the south-east in December; it is night at midnight", () => {
    expect(sunAt(crossing("2026-06-21", true)).azimuthDeg).toBeGreaterThan(55);
    expect(sunAt(crossing("2026-06-21", true)).azimuthDeg).toBeLessThan(65);
    expect(sunAt(crossing("2026-12-21", true)).azimuthDeg).toBeGreaterThan(115);
    expect(sunAt(crossing("2026-12-21", true)).azimuthDeg).toBeLessThan(125);
    expect(sunAt(crossing("2026-06-21", false)).azimuthDeg).toBeGreaterThan(295);
    expect(sunAt(kst("2026-06-21", "00:00")).elevationDeg).toBeLessThan(-25);
    expect(sunAt(kst("2026-12-21", "00:00")).elevationDeg).toBeLessThan(-60);
  });

  it("depends only on the absolute instant: the same moment written in KST and in UTC is the same sun", () => {
    const a = sunAt(Date.parse("2026-06-21T20:30:00+09:00"));
    const b = sunAt(Date.parse("2026-06-21T11:30:00Z"));
    expect(a).toEqual(b);
  });
});

describe("phaseAt: the day/night blend weights and the golden-hour tint", () => {
  it("day = 1 at and above +8°, night = 1 at and below -8°, the two always add up to 1", () => {
    for (const el of [8, 12, 30, 77]) expect(phaseAt(el)).toMatchObject({ day: 1, night: 0 });
    for (const el of [-8, -12, -40]) expect(phaseAt(el)).toMatchObject({ day: 0, night: 1 });
    for (let el = -20; el <= 20; el += 0.5) {
      const p = phaseAt(el);
      expect(p.day + p.night).toBeCloseTo(1, 12);
    }
    expect(PHASE.dayFrom).toBe(8);
    expect(PHASE.nightFrom).toBe(-8);
  });

  it("dawn and dusk are a smooth ramp: half and half on the horizon, rising monotonically, flat at both ends", () => {
    expect(phaseAt(0).day).toBeCloseTo(0.5, 12);
    let prev = -1;
    for (let el = -9; el <= 9; el += 0.25) {
      const d = phaseAt(el).day;
      expect(d).toBeGreaterThanOrEqual(prev);
      prev = d;
    }
    expect(phaseAt(-4).day).toBeGreaterThan(0);
    expect(phaseAt(4).day).toBeLessThan(1);
    // Smooth ends: the first and last degree of the ramp move much less than its middle one.
    expect(phaseAt(-7).day - phaseAt(-8).day).toBeLessThan((phaseAt(0.5).day - phaseAt(-0.5).day) / 3);
    expect(phaseAt(8).day - phaseAt(7).day).toBeLessThan((phaseAt(0.5).day - phaseAt(-0.5).day) / 3);
  });

  it("the golden-hour tint lives between -2° and +12°, strongest a little above the horizon", () => {
    for (const el of [-30, -8, -2, 12, 20, 60]) expect(phaseAt(el).golden).toBe(0);
    for (const el of [-1, 0, 3, 6, 11]) expect(phaseAt(el).golden).toBeGreaterThan(0);
    expect(phaseAt(3).golden).toBe(1);
    expect(phaseAt(PHASE.golden[1]).golden).toBe(1);
    expect(phaseAt(1).golden).toBeGreaterThan(phaseAt(-1).golden);
    expect(phaseAt(6).golden).toBeGreaterThan(phaseAt(10).golden);
  });
});

describe("Korean time for people: kstClock and parseKstTime", () => {
  it("kstClock is UTC + 9 h (no daylight saving), across a date line", () => {
    expect(KST_OFFSET_MS).toBe(9 * 3_600_000);
    expect(kstClock(Date.parse("2026-12-31T16:30:00Z"))).toEqual({ year: 2027, month: 1, day: 1, hour: 1, minute: 30 });
    expect(kstClock(Date.parse("2026-06-21T11:30:00Z"))).toMatchObject({ hour: 20, minute: 30 });
  });

  it("parseKstTime reads a bare date-time as Korean time and honours an explicit zone", () => {
    expect(parseKstTime("2026-06-21T20:30")).toBe(Date.parse("2026-06-21T11:30:00Z"));
    expect(parseKstTime("2026-06-21 20:30")).toBe(Date.parse("2026-06-21T11:30:00Z"));
    expect(parseKstTime("2026-06-21")).toBe(Date.parse("2026-06-20T15:00:00Z"));
    expect(parseKstTime("2026-06-21T11:30Z")).toBe(Date.parse("2026-06-21T11:30:00Z"));
    expect(parseKstTime("2026-06-21T20:30+0900")).toBe(Date.parse("2026-06-21T11:30:00Z"));
    expect(parseKstTime("2026-06-21T05:30-06:00")).toBe(Date.parse("2026-06-21T11:30:00Z"));
    for (const bad of ["", "noon", "2026-6-21", "2026-06-21T25", "2026-13-01T10:00"]) expect(parseKstTime(bad), bad).toBeNull();
  });
});

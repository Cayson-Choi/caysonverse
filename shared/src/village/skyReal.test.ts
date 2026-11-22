import { describe, expect, it } from "vitest";
import { altAzOf, applyMat3, equatorialUnit, moonAt, moonPhaseName, skyMatrix } from "./skyMath";
import { parseKstTime, VILLAGE_LATITUDE, VILLAGE_LONGITUDE } from "./sunClock";

/**
 * B3 (2026-11-16): the star sky against the real one. Positions are Yale Bright Star Catalogue 5th ed. J2000 (HR numbers
 * given); the cross-check below uses a DIFFERENT way to the same answer than skyMath (the annual precession in RA/Dec and
 * the sidereal-time formula of the Astronomical Almanac), so a slip in one is caught by the other.
 */
const R = Math.PI / 180;
const D = 180 / Math.PI;
// [RA°, Dec°] J2000
const STAR: Record<string, [number, number]> = {
  polaris: [37.95456, 89.26411], // HR 424
  schedar: [10.12684, 56.53733], // HR 168 (Cassiopeia)
  caph: [2.29452, 59.14978], // HR 21
  dubhe: [165.93195, 61.75103], // HR 4301 (Big Dipper)
  alkaid: [206.88516, 49.31326], // HR 5191
  betelgeuse: [88.79293, 7.40706], // HR 2061
  rigel: [78.63447, -8.20164], // HR 1713
  sirius: [101.28716, -16.71612], // HR 2491
  vega: [279.23473, 38.78369], // HR 7001
  deneb: [310.35798, 45.28034], // HR 7924
  altair: [297.69583, 8.86832], // HR 7557
  antares: [247.35192, -26.43200], // HR 6134
  arcturus: [213.91530, 19.18241], // HR 5340
  capella: [79.17233, 45.99803], // HR 1708
};

/** Independent route: annual precession (Almanac m, n) to the date, hour angle from the Almanac's GMST. */
function altAzIndependent(raDeg: number, decDeg: number, utcMs: number): { alt: number; az: number } {
  const jd = utcMs / 86_400_000 + 2440587.5;
  const dJ = jd - 2451545.0;
  const years = dJ / 365.25;
  const ra0 = raDeg * R;
  const dec0 = decDeg * R;
  const m = 3.07496 / 3600 * 15; // deg/yr
  const n = 20.0431 / 3600; // deg/yr
  // integrate in 26 small steps (the rate depends on the position)
  let ra = ra0;
  let dec = dec0;
  const steps = 26;
  for (let i = 0; i < steps; i++) {
    const dy = years / steps;
    const dra = (m + n * Math.sin(ra) * Math.tan(dec)) * dy;
    const ddec = n * Math.cos(ra) * dy;
    ra += dra * R;
    dec += ddec * R;
  }
  const gmstHours = (18.697374558 + 24.06570982441908 * dJ) % 24;
  const lst = (((gmstHours * 15 + VILLAGE_LONGITUDE) % 360) + 360) % 360;
  const ha = (lst * R - ra);
  const lat = VILLAGE_LATITUDE * R;
  const sinAlt = Math.sin(dec) * Math.sin(lat) + Math.cos(dec) * Math.cos(lat) * Math.cos(ha);
  const alt = Math.asin(sinAlt);
  const az = Math.atan2(-Math.cos(dec) * Math.sin(ha), Math.sin(dec) * Math.cos(lat) - Math.cos(dec) * Math.sin(lat) * Math.cos(ha));
  return { alt: alt * D, az: (((az * D) % 360) + 360) % 360 };
}

function skyAt(name: string, kst: string): { altDeg: number; azDeg: number } {
  const [ra, dec] = STAR[name]!;
  const e = equatorialUnit(ra * R, dec * R);
  return altAzOf(applyMat3(skyMatrix(parseKstTime(kst)!), e[0], e[1], e[2]));
}

describe("the sky against an independent computation", () => {
  const times = ["2026-02-15T21:00", "2026-05-15T22:30", "2026-08-15T21:00", "2026-11-16T20:00", "2026-11-16T23:45", "2027-01-20T19:00"];
  it.each(times)("agrees to 0.1° at %s", (t) => {
    const u = parseKstTime(t)!;
    for (const [name, [ra, dec]] of Object.entries(STAR)) {
      const a = skyAt(name, t);
      const b = altAzIndependent(ra, dec, u);
      expect(Math.abs(a.altDeg - b.alt), `${name} alt`).toBeLessThan(0.1);
      const dAz = ((a.azDeg - b.az + 540) % 360) - 180;
      expect(Math.abs(dAz * Math.cos(a.altDeg * R)), `${name} az`).toBeLessThan(0.1);
    }
  });
});

describe("what a person sees (Korean evening sky)", () => {
  it("Polaris stands at the latitude, due north, any night", () => {
    for (const t of ["2026-03-01T21:00", "2026-07-01T23:00", "2026-11-16T20:30"]) {
      const p = skyAt("polaris", t);
      expect(Math.abs(p.altDeg - VILLAGE_LATITUDE)).toBeLessThan(1);
      expect(Math.min(p.azDeg, 360 - p.azDeg)).toBeLessThan(1.5);
    }
  });
  it("Orion rises in the east on a November evening (Betelgeuse E at 22:00, still under the horizon at 20:00)", () => {
    const early = skyAt("betelgeuse", "2026-11-16T20:00");
    expect(early.altDeg).toBeLessThan(0);
    const late = skyAt("betelgeuse", "2026-11-16T22:00");
    expect(late.altDeg).toBeGreaterThan(10);
    expect(late.altDeg).toBeLessThan(30);
    expect(late.azDeg).toBeGreaterThan(80);
    expect(late.azDeg).toBeLessThan(110);
  });
  it("Orion crosses the south around 21:00 in mid February, Sirius below-left of it", () => {
    const b = skyAt("betelgeuse", "2026-02-15T21:00");
    expect(b.azDeg).toBeGreaterThan(170);
    expect(b.azDeg).toBeLessThan(205);
    expect(b.altDeg).toBeGreaterThan(55);
    const s = skyAt("sirius", "2026-02-15T21:00");
    expect(s.altDeg).toBeLessThan(b.altDeg);
    expect(s.azDeg).toBeLessThan(b.azDeg); // east of the meridian
  });
  it("Cassiopeia is high in the north-north-east on a November evening, the Big Dipper low in the north", () => {
    const c = skyAt("schedar", "2026-11-16T20:00");
    expect(c.altDeg).toBeGreaterThan(55);
    expect(c.azDeg).toBeLessThan(45);
    const d = skyAt("dubhe", "2026-11-16T20:00");
    expect(d.altDeg).toBeLessThan(15);
    expect(Math.min(d.azDeg, 360 - d.azDeg)).toBeLessThan(20);
  });
  it("the Big Dipper stands high in the north-east in a spring evening, Cassiopeia low", () => {
    expect(skyAt("dubhe", "2026-04-15T21:00").altDeg).toBeGreaterThan(55);
    expect(skyAt("schedar", "2026-04-15T21:00").altDeg).toBeLessThan(35);
  });
  it("the Summer Triangle is overhead in August: Vega near the zenith, Deneb north-east, Altair south-east", () => {
    const t = "2026-08-15T21:00";
    expect(skyAt("vega", t).altDeg).toBeGreaterThan(80);
    const deneb = skyAt("deneb", t);
    expect(deneb.azDeg).toBeGreaterThan(30);
    expect(deneb.azDeg).toBeLessThan(90);
    const altair = skyAt("altair", t);
    expect(altair.azDeg).toBeGreaterThan(110);
    expect(altair.azDeg).toBeLessThan(160);
  });
  it("Arcturus is in the east in a spring evening, Antares low in the south in summer", () => {
    const a = skyAt("arcturus", "2026-04-15T21:00");
    expect(a.azDeg).toBeGreaterThan(70);
    expect(a.azDeg).toBeLessThan(110);
    const s = skyAt("antares", "2026-08-15T21:00");
    expect(s.azDeg).toBeGreaterThan(180);
    expect(s.azDeg).toBeLessThan(225);
    expect(s.altDeg).toBeLessThan(30);
  });
});

describe("the moon", () => {
  it("is new at the 2026-08-12 total solar eclipse (17:46 UT) and full at the 2026-03-03 total lunar eclipse (11:33 UT)", () => {
    expect(moonAt(Date.parse("2026-08-12T17:46:00Z")).elongationDeg).toBeLessThan(1.5);
    expect(180 - moonAt(Date.parse("2026-03-03T11:33:00Z")).elongationDeg).toBeLessThan(1);
  });
  it("is about a quarter on 2026-11-16 (new moon Nov 9, first quarter Nov 17) and waxing", () => {
    const m = moonAt(Date.parse("2026-11-16T12:00:00Z"));
    expect(m.waxing).toBe(true);
    expect(m.illuminated).toBeGreaterThan(0.3);
    expect(m.illuminated).toBeLessThan(0.55);
    expect(moonPhaseName(m)).toMatch(/달/);
  });
  it("the autumn full moons stand opposite the sun (a few degrees of latitude spare)", () => {
    for (const iso of ["2026-09-26T16:49:00Z", "2026-10-26T04:12:00Z", "2026-11-24T14:53:00Z"]) {
      expect(moonAt(Date.parse(iso)).elongationDeg).toBeGreaterThan(170);
    }
  });
  it("follows the real phases: the lit share and waxing/waning at known 2026 instants (astronomy-engine, run outside the repo)", () => {
    // [KST pin, lit share, waxing, Korean word]
    const known: [string, number, boolean, string][] = [
      ["2026-02-19T19:01", 0.0427, true, "초승달"], // 2 days after the 음력 1일 new moon of Seollal (2026-02-17)
      ["2026-02-24T18:58", 0.4893, true, "상현달"], // first quarter 2026-02-24 21:28 KST
      ["2026-02-27T21:28", 0.818, true, "차오르는 달"],
      ["2026-03-04T00:38", 0.9997, false, "보름달"], // full moon (total lunar eclipse) 2026-03-03
      ["2026-03-12T05:39", 0.4579, false, "하현달"], // last quarter 2026-03-11 18:39 KST
      ["2026-11-05T05:58", 0.194, false, "그믐달"],
      ["2026-11-17T18:18", 0.4912, true, "상현달"],
      ["2026-11-25T00:24", 0.9981, false, "보름달"],
    ];
    for (const [kst, lit, waxing, word] of known) {
      const m = moonAt(Date.parse(kst + ":00+09:00"));
      expect(Math.abs(m.illuminated - lit), kst).toBeLessThan(0.005);
      expect(m.waxing, kst).toBe(waxing);
      expect(moonPhaseName(m), kst).toBe(word);
    }
  });
});

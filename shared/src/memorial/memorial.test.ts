import { describe, expect, it } from "vitest";
import { MessageType } from "../messages";
import { VillageMsg, VillageServerMsg } from "../village/messages";
import { crockfordFromBytes, groupCode, normalizeCode } from "./codes";
import { ceremonyAt, ceremonyPhases, weekCeremonyStart } from "./ceremony";
import { CATALOG_SEED, CROCKFORD_ALPHABET, FLOWER_SKUS, SKU_SLOT_BETA } from "./constants";
import { kstDate, kstParts, kstTime } from "./kst";
import { MEMORIAL_API, MemorialMsg, MemorialServerMsg } from "./messages";
import { hasBatchim, occasionLine, occasionsOn, type OccasionDates } from "./occasions";
import { DEFAULT_DAYS } from "./types";
import { claimYears, cleanText, isCalendarDate, validateClaimFields } from "./validate";

const ALL_DAYS = { birthday: true, anniv: true, d49: true, d100: true };

describe("memorial messages", () => {
  it("never collide with any other room message name", () => {
    const mine = [...Object.values(MemorialMsg), ...Object.values(MemorialServerMsg)];
    expect(new Set(mine).size).toBe(mine.length);
    const others = new Set<string>([...Object.values(MessageType), ...Object.values(VillageMsg), ...Object.values(VillageServerMsg)]);
    for (const v of mine) expect(others.has(v), v).toBe(false);
    for (const v of mine) expect(v.startsWith("Mem")).toBe(true);
  });
  it("routes live under /api/memorial and encode their parameters", () => {
    expect(MEMORIAL_API.claimBySlot("M1-A-r3-c11")).toBe("/api/memorial/claims/M1-A-r3-c11");
    expect(MEMORIAL_API.photos("a/b")).toBe("/api/memorial/claims/a%2Fb/photos");
  });
});

describe("crockford codes", () => {
  it("encodes 5 bits per char from the alphabet only", () => {
    const code = crockfordFromBytes(new Uint8Array([0xff, 0x00, 0xaa, 0x55, 0x12, 0x34, 0x56, 0x78]), 12);
    expect(code).toHaveLength(12);
    for (const ch of code) expect(CROCKFORD_ALPHABET).toContain(ch);
    expect(crockfordFromBytes(new Uint8Array([0, 0, 0, 0, 0]), 8)).toBe("00000000");
    expect(() => crockfordFromBytes(new Uint8Array(4), 8)).toThrow();
  });
  it("normalises what a person types: case, hyphens, O→0, I/L→1", () => {
    expect(normalizeCode("7kq2-m9xd", 8)).toBe("7KQ2M9XD");
    expect(normalizeCode("o1il 2345", 8)).toBe("01112345");
    expect(normalizeCode("7KQ2M9XU", 8)).toBeNull(); // U is not in the alphabet
    expect(normalizeCode("7KQ2M9X", 8)).toBeNull();
    expect(normalizeCode(42, 8)).toBeNull();
    expect(groupCode("ABCDEFGHJKMN")).toBe("ABCD-EFGH-JKMN");
  });
});

describe("KST clock", () => {
  it("uses UTC+9 regardless of the machine's zone", () => {
    const t = Date.UTC(2026, 10, 15, 14, 59); // 23:59 KST, Sunday
    expect(kstDate(t)).toBe("2026-11-15");
    expect(kstDate(t + 60_000)).toBe("2026-11-16"); // midnight boundary (test matrix #5)
    expect(kstParts(t).weekday).toBe(0);
    expect(kstTime(2026, 11, 15, 20)).toBe(Date.UTC(2026, 10, 15, 11));
  });
});

describe("occasions (test matrix #2, #3)", () => {
  const d = (born: string | null, bornPrec: OccasionDates["bornPrec"], passed: string | null, passedPrec: OccasionDates["passedPrec"]) => ({
    born,
    bornPrec,
    passed,
    passedPrec,
  });
  it("birthday with age, anniversary N주기 from year 1", () => {
    const x = d("2014-05-17", "day", "2025-11-16", "day");
    expect(occasionsOn("2026-05-17", x, ALL_DAYS)).toEqual([{ kind: "birthday", years: 12 }]);
    expect(occasionsOn("2026-11-16", x, ALL_DAYS)).toEqual([{ kind: "anniv", years: 1 }]);
    expect(occasionsOn("2028-11-16", x, ALL_DAYS)).toEqual([{ kind: "anniv", years: 3 }]);
    expect(occasionsOn("2025-11-16", x, ALL_DAYS)).toEqual([]); // the day itself is not an anniversary
  });
  it("49일 and 100일 only when enabled, only once (Korean count)", () => {
    const x = d(null, "unknown", "2026-01-01", "day");
    expect(occasionsOn("2026-02-18", x, ALL_DAYS)).toEqual([{ kind: "d49" }]);
    expect(occasionsOn("2026-04-10", x, ALL_DAYS)).toEqual([{ kind: "d100" }]);
    expect(occasionsOn("2026-02-18", x, { ...ALL_DAYS, d49: false })).toEqual([]);
    expect(occasionsOn("2027-02-18", x, ALL_DAYS)).toEqual([]);
  });
  it("unknown dates, year-unknown (md) and Feb 29", () => {
    expect(occasionsOn("2026-05-17", d(null, "unknown", null, "unknown"), ALL_DAYS)).toEqual([]);
    expect(occasionsOn("2026-05-17", d("0000-05-17", "md", null, "unknown"), ALL_DAYS)).toEqual([{ kind: "birthday" }]);
    expect(occasionsOn("2026-07-01", d(null, "unknown", "0000-07-01", "md"), ALL_DAYS)).toEqual([{ kind: "anniv" }]);
    const leap = d("2016-02-29", "day", null, "unknown");
    expect(occasionsOn("2027-02-28", leap, ALL_DAYS)).toEqual([{ kind: "birthday", years: 11 }]);
    expect(occasionsOn("2028-02-28", leap, ALL_DAYS)).toEqual([]);
    expect(occasionsOn("2028-02-29", leap, ALL_DAYS)).toEqual([{ kind: "birthday", years: 12 }]);
  });
  it("respects the family's switches", () => {
    const x = d("2014-05-17", "day", "2025-11-16", "day");
    expect(occasionsOn("2026-05-17", x, { ...DEFAULT_DAYS, birthday: false })).toEqual([]);
  });
  it("speaks gently, with the right particle", () => {
    expect(hasBatchim("콩")).toBe(true);
    expect(hasBatchim("초코")).toBe(false);
    expect(occasionLine("콩", { kind: "anniv", years: 1 })).toBe("오늘은 콩이의 무지개다리 1주기예요");
    expect(occasionLine("초코", { kind: "birthday" })).toBe("오늘은 초코의 생일이에요. 함께 기억해 주세요");
    for (const k of ["birthday", "anniv", "d49", "d100"] as const) expect(occasionLine("보리", { kind: k })).not.toContain("!");
  });
});

describe("ceremony schedule (owner: Sundays 20:00 KST, ~10 min)", () => {
  const sunday = kstTime(2026, 11, 15, 20); // 2026-11-15 is a Sunday
  it("finds the week's Sunday 20:00", () => {
    expect(weekCeremonyStart(kstTime(2026, 11, 15, 10))).toBe(sunday);
    expect(weekCeremonyStart(kstTime(2026, 11, 21, 23))).toBe(sunday); // Saturday: last Sunday
  });
  it("runs gather → open → names → light → silence → close → afterglow", () => {
    const ph = ceremonyPhases(sunday, 3);
    expect(ph.map((p) => p.phase)).toEqual(["gather", "open", "names", "light", "silence", "close", "afterglow"]);
    expect(ph[0]!.from).toBe(sunday - 5 * 60_000);
    expect(ph[2]!.to - ph[2]!.from).toBe(12_000);
    expect(ceremonyPhases(sunday, 0).map((p) => p.phase)).not.toContain("names");
    expect(ceremonyPhases(sunday, 99)[2]!.to - ceremonyPhases(sunday, 99)[2]!.from).toBe(40 * 4000);
  });
  it("reports idle with the next gather outside the ceremony", () => {
    expect(ceremonyAt(sunday - 6 * 60_000, 0)).toMatchObject({ phase: "idle", startsAt: sunday, phaseEndsAt: sunday - 5 * 60_000 });
    expect(ceremonyAt(sunday + 1000, 2)).toMatchObject({ phase: "open", ceremonyId: "C-2026-11-15" });
    const monday = kstTime(2026, 11, 16, 9);
    expect(ceremonyAt(monday, 0)).toMatchObject({ phase: "idle", startsAt: sunday + 7 * 86_400_000, ceremonyId: "C-2026-11-22" });
  });
});

describe("claim fields", () => {
  const now = kstTime(2026, 11, 16, 12);
  it("accepts a full form and cleans text", () => {
    const r = validateClaimFields({ petName: " 콩이​ ", species: "dog", born: "2014-05-17", passed: "2026-11-01", line: "늘  고마웠어요" }, now);
    expect(r).toEqual({
      ok: true,
      value: { petName: "콩이", species: "dog", born: "2014-05-17", bornPrec: "day", passed: "2026-11-01", passedPrec: "day", line: "늘 고마웠어요" },
    });
  });
  it("refuses bad names, species, dates and long lines", () => {
    expect(validateClaimFields({ petName: "", species: "dog" }, now).ok).toBe(false);
    expect(validateClaimFields({ petName: "가".repeat(13), species: "dog" }, now).ok).toBe(false);
    expect(validateClaimFields({ petName: "<b>", species: "dog" }, now).ok).toBe(false);
    expect(validateClaimFields({ petName: "콩", species: "fish" }, now).ok).toBe(false);
    expect(validateClaimFields({ petName: "콩", species: "cat", born: "2026-02-30" }, now).ok).toBe(false);
    expect(validateClaimFields({ petName: "콩", species: "cat", passed: "2027-01-01" }, now).ok).toBe(false); // future
    expect(validateClaimFields({ petName: "콩", species: "cat", born: "2020-01-02", passed: "2020-01-01" }, now).ok).toBe(false);
    expect(validateClaimFields({ petName: "콩", species: "cat", line: "가".repeat(41) }, now).ok).toBe(false);
  });
  it("month-day only and unknown dates", () => {
    expect(isCalendarDate("0000-02-29", "md")).toBe(true);
    expect(isCalendarDate("2026-02-29", "day")).toBe(false);
    const r = validateClaimFields({ petName: "콩", species: "cat", born: "0000-05-17", bornPrec: "md" }, now);
    expect(r.ok && r.value.bornPrec).toBe("md");
    const u = validateClaimFields({ petName: "콩", species: "cat", born: null }, now);
    expect(u.ok && u.value.bornPrec).toBe("unknown");
  });
  it("patches only the given fields", () => {
    const base = { petName: "콩", species: "cat" as const, born: null, bornPrec: "unknown" as const, passed: null, passedPrec: "unknown" as const, line: "a" };
    const r = validateClaimFields({ line: "새 한 줄" }, now, base);
    expect(r).toEqual({ ok: true, value: { ...base, line: "새 한 줄" } });
  });
  it("years line and text cleaning", () => {
    expect(claimYears({ born: "2011-01-01", bornPrec: "day", passed: "2024-01-01", passedPrec: "day" })).toBe("2011 – 2024");
    expect(claimYears({ born: null, bornPrec: "unknown", passed: null, passedPrec: "unknown" })).toBe("");
    expect(cleanText("a\u0007b‮c")).toBe("abc");
  });
});

describe("catalog seed", () => {
  it("has the free slot and free flowers active, paid candidates inactive without prices", () => {
    const by = new Map(CATALOG_SEED.map((c) => [c.sku, c]));
    expect(by.get(SKU_SLOT_BETA)).toMatchObject({ active: true, free: true });
    for (const f of FLOWER_SKUS) expect(by.get(f)).toMatchObject({ active: true, free: true });
    for (const c of CATALOG_SEED) if (!c.free) expect(c.active).toBe(false);
    expect(new Set(CATALOG_SEED.map((c) => c.sku)).size).toBe(CATALOG_SEED.length);
  });
});

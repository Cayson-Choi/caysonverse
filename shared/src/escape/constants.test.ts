import { describe, it, expect } from "vitest";
import { KICK_CLOSE_CODE } from "../constants";
import * as EscapeConstants from "./constants";
import {
  CLASS_CLOSED_CODE,
  CLASS_END_GRACE_MS,
  CLASS_EMPTY_CLOSE_MS,
  COOP_WINDOW_MS,
  MAX_TEAMS,
  PHASE1_OPEN_ROOMS,
  PLACE_ESCAPE,
  PLACE_HUB,
  ROOM_IDS,
  ROOM_LABELS,
  SOLO_HOLD_MS,
  TEAM_COLORS,
  TEAM_COLOR_LABELS,
  TEAM_MAX,
  TEAM_MIN,
  TEAM_NAMES,
  TEAM_TARGET,
} from "./constants";

describe("CLASS_CLOSED_CODE (ruling E2)", () => {
  // Colyseus' own close codes (@colyseus/shared-types CloseCode):
  // CONSENTED 4000, SERVER_SHUTDOWN 4001, WITH_ERROR 4002, FAILED_TO_RECONNECT 4003,
  // MAY_TRY_RECONNECT 4010. Hard-coded: shared must not depend on the colyseus packages.
  const COLYSEUS_CLOSE_CODES = [4000, 4001, 4002, 4003, 4010];

  it("differs from every Colyseus close code (4000-4003, 4010)", () => {
    for (const code of COLYSEUS_CLOSE_CODES) expect(CLASS_CLOSED_CODE).not.toBe(code);
  });

  it("differs from the admin-kick close code", () => {
    expect(CLASS_CLOSED_CODE).not.toBe(KICK_CLOSE_CODE);
  });

  it("is a 4000-4999 application code, so the SDK delivers it verbatim to onLeave", () => {
    expect(Number.isInteger(CLASS_CLOSED_CODE)).toBe(true);
    expect(CLASS_CLOSED_CODE).toBeGreaterThanOrEqual(4000);
    expect(CLASS_CLOSED_CODE).toBeLessThanOrEqual(4999);
    expect(CLASS_CLOSED_CODE).toBe(4102);
  });
});

describe("team names, colours and sizes", () => {
  it("has 12 unique team names, each a short Hangul word", () => {
    expect(TEAM_NAMES).toHaveLength(12);
    expect(new Set(TEAM_NAMES).size).toBe(TEAM_NAMES.length);
    for (const n of TEAM_NAMES) expect(n, n).toMatch(/^[가-힣]{2,4}$/);
  });

  it("uses bright daytime words only (ruling E22: no night-sky names)", () => {
    for (const night of ["별빛", "반딧불", "달토끼", "은하수", "부엉이", "새벽별"]) {
      expect(TEAM_NAMES).not.toContain(night);
    }
    for (const day of ["햇살", "풍선", "새싹", "민들레", "바람개비", "꽃잎"]) {
      expect(TEAM_NAMES).toContain(day);
    }
  });

  it("has 8 unique hex colours with exactly one Korean label each", () => {
    expect(TEAM_COLORS).toHaveLength(8);
    expect(TEAM_COLOR_LABELS).toHaveLength(TEAM_COLORS.length);
    expect(new Set(TEAM_COLORS).size).toBe(TEAM_COLORS.length);
    expect(new Set(TEAM_COLOR_LABELS).size).toBe(TEAM_COLOR_LABELS.length);
    for (const c of TEAM_COLORS) expect(c).toMatch(/^#[0-9A-F]{6}$/);
  });

  it("offers enough name x colour combinations for MAX_TEAMS teams", () => {
    expect(TEAM_NAMES.length * TEAM_COLORS.length).toBeGreaterThanOrEqual(MAX_TEAMS);
    expect(MAX_TEAMS).toBe(50);
  });

  it("team size bounds are ordered: MIN <= TARGET <= MAX", () => {
    expect(TEAM_MIN).toBeLessThanOrEqual(TEAM_TARGET);
    expect(TEAM_TARGET).toBeLessThanOrEqual(TEAM_MAX);
    expect([TEAM_MIN, TEAM_TARGET, TEAM_MAX]).toEqual([2, 4, 6]);
  });
});

describe("rooms and places", () => {
  it("every room id has a non-empty Korean label and nothing else has one", () => {
    expect(Object.keys(ROOM_LABELS).sort()).toEqual([...ROOM_IDS].sort());
    for (const id of ROOM_IDS) expect(ROOM_LABELS[id], id).toMatch(/^[가-힣]+$/);
    expect(ROOM_LABELS.counsel).toBe("상담실");
  });

  it("phase 1 opens exactly the counselling room, which is a known room id", () => {
    expect([...PHASE1_OPEN_ROOMS]).toEqual(["counsel"]);
    for (const id of PHASE1_OPEN_ROOMS) expect(ROOM_IDS).toContain(id);
  });

  it("the hub and the escape room are different places", () => {
    expect(PLACE_HUB).not.toBe(PLACE_ESCAPE);
    expect([PLACE_HUB, PLACE_ESCAPE]).toEqual([0, 1]);
  });
});

describe("timing constants", () => {
  it("a class gets a short end grace and a longer empty-room wait", () => {
    expect(CLASS_END_GRACE_MS).toBeLessThan(CLASS_EMPTY_CLOSE_MS);
  });

  it("a simultaneous press window is shorter than the solo long-press", () => {
    expect(COOP_WINDOW_MS).toBeLessThan(SOLO_HOLD_MS);
  });
});

describe("exports kept out of this module (ruling E5)", () => {
  it("does not define APPEARANCE_KEYS: stage 3's APPEARANCE_FIELDS is the one list", () => {
    expect("APPEARANCE_KEYS" in EscapeConstants).toBe(false);
    expect(Object.keys(EscapeConstants).some((k) => /^APPEARANCE/.test(k))).toBe(false);
  });
});

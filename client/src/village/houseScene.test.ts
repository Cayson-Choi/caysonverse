import { afterEach, describe, expect, it } from "vitest";
import { VILLAGE_SEATS } from "@caysonverse/shared/village/benchSeats";
import { GENERATED_HOUSE_NUMBERS } from "@caysonverse/shared/village/generated/houses";
import { HOUSE_FLOOR_AREAS, HOUSE_LOW_CEILINGS, HOUSE_PLACES, HOUSE_ROOM, HOUSE_CAMERA, houseFloorBounds, houseFloorLabel, houseFloorArea, parseHouseFloorArea } from "@caysonverse/shared/village/houseAreas";
import { houseFloorGeometry, houseCeilingSlab } from "@caysonverse/shared/village/housesGeometry";
import { HOUSE_EXIT_TARGET_ID, HOUSE_STAIR_UP_TARGET_ID } from "@caysonverse/shared/village/houseTargets";
import { keypadEntries } from "@caysonverse/shared/village/buildingAccess";
import { VILLAGE_ACTIVE_MAP, setActiveMap, villageActiveMap, houseCameraLimit } from "../game/activeMap";
import { normalizeArea, showsInArea } from "../game/areaFilter";
import { overviewAllowed } from "../game/indoorCamera";
import { KEYPAD_TEXT, houseOpen, keypadTitle, lockoutText } from "./keypadText";
import { HOUSE_ENTRY_TIMEOUT_MS, beginHouseEntry, houseEntryFailed, houseEntryReady, houseEntryState, resetHouseEntry } from "./houseEntry";
import { villageAndHallTargets, villageTargets } from "./villageTargets";

afterEach(() => {
  setActiveMap(VILLAGE_ACTIVE_MAP);
  resetHouseEntry();
});

describe("a house floor's active map", () => {
  it("one prebuilt map per floor: the floor's geometry, its rectangle, the ceiling limit, no overview, the global seat list narrowed by area", () => {
    for (const area of HOUSE_FLOOR_AREAS) {
      const hit = parseHouseFloorArea(area)!;
      const m = villageActiveMap(area);
      expect(villageActiveMap(area)).toBe(m); // prebuilt: a re-render is never a switch
      expect(m.geometry).toBe(houseFloorGeometry(hit.n, hit.floor));
      expect(m.bounds).toEqual(houseFloorBounds(hit.n, hit.floor));
      expect(m.seatArea).toBe(area);
      expect(m.seats).toBe(VILLAGE_SEATS); // the ONE list: an index is the server's index
      expect(m.zoneLabel(0, 0)).toBe(houseFloorLabel(hit.n, hit.floor));
      expect(overviewAllowed(m.cameraLimit)).toBe(false);
    }
    expect(villageActiveMap(houseFloorArea(3, 2)).zoneLabel(0, 0)).toBe("3번 집 · 2층");
  });

  it("the camera stays under the ceiling less 0.25 m (3.45 m), lower in the attic floors (8 and 10, floor 2)", () => {
    expect(houseCameraLimit(1, 1).maxY).toBeCloseTo(HOUSE_ROOM.ceiling - HOUSE_CAMERA.ceilingPad, 6);
    for (const l of HOUSE_LOW_CEILINGS) expect(houseCameraLimit(l.n, l.floor).maxY).toBeCloseTo(l.lowest - HOUSE_CAMERA.ceilingPad, 6);
    expect(houseCameraLimit(8, 2).maxY).toBeLessThan(houseCameraLimit(8, 1).maxY);
    // under the slab's underside (3.6) less the spring arm's pad: the clamp never asks the arm for more than the slab allows
    expect(houseCameraLimit(1, 1).maxY).toBeLessThan(houseCeilingSlab(1, 1).minY!);
  });

  it("the furniture list holds the boxes under the seats of that floor only", () => {
    for (const n of GENERATED_HOUSE_NUMBERS) {
      for (const f of [1, 2] as const) {
        const m = villageActiveMap(houseFloorArea(n, f));
        expect(m.furniture!.length).toBeGreaterThan(0);
        for (const box of m.furniture!) expect(m.geometry.obstacles).toContain(box);
      }
    }
  });

  it("an unknown house area falls back to the village map (never a crash)", () => {
    expect(villageActiveMap("house:house_99:1" as never)).toBe(VILLAGE_ACTIVE_MAP);
  });
});

describe("areas on the client", () => {
  it("normalizeArea keeps a valid floor area, anything else is the village; a viewer sees only their own floor's avatars", () => {
    expect(normalizeArea("house:house_2:2")).toBe("house:house_2:2");
    expect(normalizeArea("house:house_2")).toBe("village");
    expect(normalizeArea("house:house_20:1")).toBe("village");
    expect(showsInArea("house:house_1:1", "house:house_1:1")).toBe(true);
    expect(showsInArea("house:house_1:2", "house:house_1:1")).toBe(false); // upstairs is another place
    expect(showsInArea("house:house_2:1", "house:house_1:1")).toBe(false);
    expect(showsInArea("village", "house:house_1:1")).toBe(false);
  });
});

describe("house targets in the context button", () => {
  it("floor 1 offers the way out and the stair at their pads; the memorial door is not offered inside a house", () => {
    const p = HOUSE_PLACES[1];
    const exit = villageTargets(houseFloorArea(1, 1), p.exitPad.x, p.exitPad.z);
    expect(exit).toHaveLength(1);
    expect(exit[0]).toMatchObject({ kind: "door", id: HOUSE_EXIT_TARGET_ID, label: "밖으로 나가기", short: "나가기" });
    const up = villageTargets(houseFloorArea(1, 1), p.upPad.x, p.upPad.z);
    expect(up[0]).toMatchObject({ kind: "door", id: HOUSE_STAIR_UP_TARGET_ID, label: "2층으로 올라가기", short: "⬆ 2층" });
    expect(villageTargets(houseFloorArea(1, 2), p.downPad.x, p.downPad.z)[0]).toMatchObject({ label: "1층으로 내려가기", short: "⬇ 1층" });
    // the way in (the arrival spot) offers nothing; no keypad and no guide inside
    expect(villageAndHallTargets(houseFloorArea(1, 1), p.spawnIn.x, p.spawnIn.z)).toHaveLength(0);
    expect(villageTargets(houseFloorArea(1, 1), keypadEntries()[0]!.pad.x, keypadEntries()[0]!.pad.z)).toHaveLength(0);
  });

  it("an open panel (the keypad) offers nothing", () => {
    const p = HOUSE_PLACES[1];
    expect(villageAndHallTargets(houseFloorArea(1, 1), p.exitPad.x, p.exitPad.z, true)).toHaveLength(0);
  });
});

describe("the keypad's words and house gate", () => {
  it("is open exactly for the houses that have their files; the title names the house", () => {
    expect(houseOpen("house_1")).toBe(true);
    expect(houseOpen("house_2")).toBe(GENERATED_HOUSE_NUMBERS.includes(2));
    expect(houseOpen("house_11")).toBe(false);
    expect(houseOpen("cafe_1")).toBe(false);
    expect(keypadTitle("house_7")).toBe("7번 집 번호키");
    expect(keypadTitle("cafe")).toBe("집 번호키");
  });

  it("the messages are short Korean, 'full' and 'not ready' included; the lock counts down in seconds, never below 1", () => {
    expect(KEYPAD_TEXT.wrong).toBe("번호가 맞지 않아요.");
    expect(KEYPAD_TEXT.full).toBe("집이 가득 찼어요.");
    expect(KEYPAD_TEXT.notReady).toContain("준비 중");
    expect(lockoutText(30)).toBe("잠시 뒤 다시 눌러 주세요 (30초)");
    expect(lockoutText(0.2)).toBe("잠시 뒤 다시 눌러 주세요 (1초)");
    for (const t of Object.values(KEYPAD_TEXT)) expect(t).not.toMatch(/[a-zA-Z]{4,}/);
  });
});

describe("house entry (the cover while the model loads)", () => {
  it("raised by the keypad's ok or the scene, ready once the floor is drawn, failed after 8 s; idle again after a reset", () => {
    expect(houseEntryState().phase).toBe("idle");
    houseEntryReady(); // nothing raised: nothing to open
    expect(houseEntryState().phase).toBe("idle");
    beginHouseEntry();
    beginHouseEntry();
    expect(houseEntryState().phase).toBe("loading");
    houseEntryReady();
    expect(houseEntryState().phase).toBe("ready");
    beginHouseEntry();
    houseEntryFailed();
    expect(houseEntryState().phase).toBe("failed");
    resetHouseEntry();
    expect(houseEntryState().phase).toBe("idle");
    expect(HOUSE_ENTRY_TIMEOUT_MS).toBe(8000);
  });
});

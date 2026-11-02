import { describe, expect, it } from "vitest";
import { EAST_CORRIDOR, HALL, HUB_DOORS, TEAM_ZONE, WEST_SEAL } from "@caysonverse/shared/school/hubMap";
import { HUB_PROP_COLLIDERS } from "@caysonverse/shared/school/generated/hubColliders";
import { ROOM_LABELS } from "@caysonverse/shared/escape/constants";
import {
  HUB_SIGNS,
  LABEL_GAP,
  LABEL_PX_PER_M,
  SEAL_TEXT,
  TEAM_SIGN_LINES,
  TITLE_TEXT,
  fitFontPx,
  labelCanvasSize,
  type SignSpec,
} from "./hubSignSpecs";

const sign = (id: string): SignSpec => HUB_SIGNS.find((s) => s.id === id)!;
/** The direction a label faces (a plane's +z turned by rotY). */
const facing = (s: SignSpec): [number, number] => [Math.sin(s.rotY), Math.cos(s.rotY)];

describe("HUB_SIGNS", () => {
  it("has a title, a sign for each of the four doors, both faces of the team sign, and the seal", () => {
    expect(HUB_SIGNS.map((s) => s.id).sort()).toEqual(
      ["door-broadcast", "door-career", "door-counsel", "door-library", "seal", "team-back", "team-front", "title"].sort(),
    );
    expect(new Set(HUB_SIGNS.map((s) => s.id)).size).toBe(HUB_SIGNS.length);
  });

  it("says the words the game promises, in Korean", () => {
    expect(sign("title").lines).toEqual(["AI 학교 탈출"]);
    expect(TITLE_TEXT).toBe("AI 학교 탈출");
    expect(TEAM_SIGN_LINES.join("")).toBe("팀만들기");
    expect(sign("seal").lines).toEqual([SEAL_TEXT]);
    expect(SEAL_TEXT).toBe("다음 업데이트");
    for (const d of HUB_DOORS) expect(sign(`door-${d.room}`).lines).toEqual([ROOM_LABELS[d.room]]);
    expect(sign("door-counsel").lines).toEqual(["상담실"]);
  });

  it("hangs each door label over its door, just inside the corridor wall and facing the corridor", () => {
    for (const d of HUB_DOORS) {
      const s = sign(`door-${d.room}`);
      expect(s.x, d.room).toBe(d.x);
      const wall = d.side === "n" ? EAST_CORRIDOR.minZ : EAST_CORRIDOR.maxZ;
      // The plate stands 7.5 cm out of the wall; the label hangs LABEL_GAP in front of it.
      expect(Math.abs(s.z - wall), d.room).toBeCloseTo(0.075 + LABEL_GAP, 9);
      // It looks toward the corridor's centre line, never into the wall.
      expect(Math.sign(facing(s)[1]), d.room).toBe(Math.sign(-wall));
      expect(Math.abs(facing(s)[0]), d.room).toBeLessThan(1e-9);
      expect(s.y).toBeCloseTo(3.5, 9);
    }
  });

  it("hangs the title in the hall in front of the progress board's pill, looking south into the hall", () => {
    const s = sign("title");
    expect(s.x).toBe(0);
    expect(s.z).toBeGreaterThan(HALL.minZ);
    expect(s.z).toBeLessThan(HALL.minZ + 1); // within a metre of the north wall
    expect(facing(s)[1]).toBe(1);
    expect(s.w / s.h).toBeCloseTo(3.6 / 0.44, 9);
  });

  it("puts the two team-sign faces back to back on the sign that stands just outside the team rug", () => {
    const f = sign("team-front");
    const b = sign("team-back");
    expect(f.x).toBe(b.x);
    expect(f.y).toBe(b.y);
    expect((f.z + b.z) / 2).toBeCloseTo(5, 9); // centred on the sign stand's z
    expect(facing(f)[1]).toBe(1);
    expect(facing(b)[1]).toBe(-1);
    expect(b.z).toBeLessThan(f.z);
    // The stand is one of the generated collision boxes, and it is outside the rug.
    expect(HUB_PROP_COLLIDERS.some((c) => f.x >= c.minX && f.x <= c.maxX && f.z >= c.minZ && f.z <= c.maxZ)).toBe(true);
    expect(f.x).toBeGreaterThan(TEAM_ZONE.maxX);
  });

  it("hangs the seal label in the sealed west doorway, looking east into the hall", () => {
    const s = sign("seal");
    expect(s.x).toBeGreaterThanOrEqual(WEST_SEAL.minX);
    expect(s.x).toBeLessThan(WEST_SEAL.maxX + 0.5);
    expect(s.z).toBe(0);
    expect(facing(s)[0]).toBeCloseTo(1, 9);
  });

  it("keeps every label inside the hall or the corridor", () => {
    for (const s of HUB_SIGNS) {
      const inHall = s.x >= HALL.minX && s.x <= HALL.maxX && s.z >= HALL.minZ && s.z <= HALL.maxZ;
      const inCorridor =
        s.x >= EAST_CORRIDOR.minX && s.x <= EAST_CORRIDOR.maxX && s.z >= EAST_CORRIDOR.minZ && s.z <= EAST_CORRIDOR.maxZ;
      expect(inHall || inCorridor, s.id).toBe(true);
    }
  });

  it("uses white words with an edge on the violet plates and indigo words on the white disc", () => {
    for (const id of ["title", "seal", "door-counsel"]) {
      expect(sign(id).color).toBe("#FFFFFF");
      expect(sign(id).outline).not.toBeNull();
    }
    expect(sign("team-front").color).toBe("#4B4FD8");
    expect(sign("team-front").outline).toBeNull();
  });
});

describe("labelCanvasSize", () => {
  it("is about 300 px per metre", () => {
    expect(LABEL_PX_PER_M).toBe(300);
    expect(labelCanvasSize({ w: 3.6, h: 0.44 })).toEqual({ width: 1080, height: 132 });
    expect(labelCanvasSize({ w: 0.8, h: 0.8 })).toEqual({ width: 240, height: 240 });
  });

  it("never goes below 32 px or above 2048 px a side", () => {
    expect(labelCanvasSize({ w: 0.01, h: 100 })).toEqual({ width: 32, height: 2048 });
  });
});

describe("fitFontPx", () => {
  /** A stub font: every character is `em` of the font size wide. */
  const stub = (em: number) => (text: string, px: number) => text.length * em * px;

  it("is limited by the height for a short word", () => {
    // 1 line, height 100 -> 78 px; "상담실" is 3 em wide = 234 at that size, far inside 88% of 1000.
    expect(fitFontPx(["상담실"], 1000, 100, stub(1))).toBeCloseTo(78, 9);
  });

  it("shrinks a long line until it fits 88% of the width", () => {
    const px = fitFontPx(["다음 업데이트"], 600, 200, stub(1)); // 7 chars: 7 em
    expect(px).toBeCloseTo((600 * 0.88) / 7, 9);
    expect(7 * px).toBeLessThanOrEqual(600 * 0.88 + 1e-9);
  });

  it("splits the height between lines (with a 12% gap) and fits the widest one", () => {
    const px = fitFontPx(["팀", "만들기"], 2000, 800, stub(1)); // wide canvas: the height decides
    expect(px).toBeCloseTo((800 * 0.78) / (2 + 0.12), 9);
    // A very narrow canvas makes the widest line (3 em) decide.
    expect(fitFontPx(["팀", "만들기"], 90, 800, stub(1))).toBeCloseTo((90 * 0.88) / 3, 9);
  });

  it("never returns less than 8 px, and ignores a line the canvas cannot measure", () => {
    expect(fitFontPx(["x"], 1, 1, stub(1))).toBe(8);
    expect(fitFontPx(["ab"], 500, 100, () => 0)).toBeCloseTo(78, 9);
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  CUBBY_COPY,
  EYE_ROW,
  closeCubbyCard,
  cubbyCardState,
  cubbyIdAt,
  defaultRow,
  litByLabel,
  moveCubbyRow,
  openCubbyCard,
  photoAlt,
  photoBackground,
  rowLabel,
  yearsLabel,
} from "./cubbyCard";
import { SAMPLE_BY_ID, type SampleCubby } from "./sampleCubbies";
import { cubbyColumns } from "./villageTargets";

afterEach(() => closeCubbyCard());

describe("CubbyView copy (Task 9): gentle, no '!'", () => {
  it("the empty cubby says exactly the brief's line", () => {
    expect(CUBBY_COPY.empty).toBe("곧 이 자리에 우리 아이를 모실 수 있어요");
    expect(CUBBY_COPY.light).toBe("촛불 켜기");
  });

  it("no string of the card holds '!', and the sentences end in ~요", () => {
    const all = [
      ...Object.values(CUBBY_COPY),
      rowLabel(3),
      yearsLabel({ born: 2010, passed: 2024 }),
      photoAlt("초코"),
      litByLabel("케이슨"),
      litByLabel(""),
    ];
    for (const t of all) expect(t, t).not.toContain("!");
    for (const t of [CUBBY_COPY.empty, CUBBY_COPY.lighting, CUBBY_COPY.burning, CUBBY_COPY.wait, litByLabel("케이슨")]) expect(t).toMatch(/요$/);
  });

  it("the component's own Korean text has no '!' either (read from CubbyView.tsx)", () => {
    const src = readFileSync(new URL("./CubbyView.tsx", import.meta.url), "utf8");
    const korean = [...src.matchAll(/"([^"\n]*[가-힣][^"\n]*)"|>([^<>{}\n]*[가-힣][^<>{}\n]*)</g)].map((m) => m[1] ?? m[2]);
    for (const t of korean) expect(t, t).not.toContain("!");
  });

  it("labels: the row from the bottom, the years, the portrait's name, who lit the candle", () => {
    expect(rowLabel(0)).toBe("아래에서 1번째 칸");
    expect(yearsLabel({ born: 2011, passed: 2024 })).toBe("2011 – 2024");
    expect(photoAlt("하늘이")).toBe("하늘이의 사진");
    expect(litByLabel("케이슨")).toBe("케이슨 님이 촛불을 켰어요");
  });

  it("the portrait is a tile of the atlas (CSS background on the 4 x 4 grid)", () => {
    expect(photoBackground(0)).toMatchObject({ backgroundSize: "400% 400%", backgroundPosition: "0% 0%" });
    expect(photoBackground(15).backgroundPosition).toBe("100% 100%");
    expect(photoBackground(6).backgroundPosition).toBe(`${(2 / 3) * 100}% ${(1 / 3) * 100}%`);
  });
});

describe("the card's cubby (Task 9)", () => {
  it("opens on the filled cubby nearest eye height, or eye height when the column is empty", () => {
    for (const c of cubbyColumns()) {
      const row = defaultRow(c.key);
      const filled = c.rows.filter((a) => SAMPLE_BY_ID.has(a.id)).map((a) => a.row);
      if (filled.length === 0) expect(row).toBe(EYE_ROW);
      else {
        expect(filled).toContain(row);
        const best = Math.min(...filled.map((r) => Math.abs(r - EYE_ROW)));
        expect(Math.abs(row - EYE_ROW)).toBe(best);
      }
    }
    const none = new Map<string, SampleCubby>();
    expect(defaultRow("n_0", none)).toBe(EYE_ROW);
  });

  it("open, step up and down within the column, close", () => {
    openCubbyCard("cubby:n_10");
    const start = cubbyCardState()!;
    expect(start.column).toBe("n_10");
    expect(cubbyIdAt("n_10", start.row)).toBe(`n_${start.row}_10`);
    for (let i = 0; i < 10; i += 1) moveCubbyRow(1);
    expect(cubbyCardState()!.row).toBe(6);
    for (let i = 0; i < 10; i += 1) moveCubbyRow(-1);
    expect(cubbyCardState()!.row).toBe(0);
    closeCubbyCard();
    expect(cubbyCardState()).toBeNull();
    openCubbyCard("cubby:x_1");
    expect(cubbyCardState()).toBeNull();
  });
});

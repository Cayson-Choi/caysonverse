import { describe, expect, it } from "vitest";
import { PRINCIPLES } from "@caysonverse/shared/escape/principles";
import type { EscapeResult } from "../escape/EscapeRoom";
import { buildResultsCsv } from "./resultsCsv";

/** One result row with sensible defaults (a counsel escape by 햇살(파랑)). */
function row(over: Partial<EscapeResult> = {}): EscapeResult {
  return {
    teamId: "team-1",
    teamName: "햇살(파랑)",
    roomId: "counsel",
    members: ["가람", "다온"],
    escaped: true,
    overtime: false,
    elapsedS: 512,
    remainingS: 388,
    hintsUsed: 2,
    wrongAttempts: 3,
    stars: 2,
    firstTry: {},
    ...over,
  };
}

const BOM = "\uFEFF";
const HEADER = "팀,팀원,교실,결과,걸린 시간(초),남은 시간(초),힌트,틀린 시도,별";

/** The CSV split into lines (BOM removed, the trailing CRLF's empty tail dropped). */
function lines(csv: string): string[] {
  expect(csv.startsWith(BOM)).toBe(true);
  const out = csv.slice(1).split("\r\n");
  expect(out.at(-1)).toBe(""); // every line ends with CRLF
  return out.slice(0, -1);
}

describe("buildResultsCsv", () => {
  it("BOM, CRLF and the principle column", () => {
    const csv = buildResultsCsv([row({ firstTry: { privacy: false } })]);
    expect(csv.startsWith("\uFEFF팀,팀원,교실,결과,걸린 시간(초),남은 시간(초),힌트,틀린 시도,별,프라이버시 보호 첫 시도\r\n")).toBe(true);
    expect(csv).toContain(",오답\r\n");
    // The whole row, in header order.
    expect(lines(csv)).toEqual([`${HEADER},프라이버시 보호 첫 시도`, "햇살(파랑),가람·다온,상담실,탈출,512,388,2,3,2,오답"]);
    // No bare LF anywhere: CRLF only.
    expect(csv.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });

  it("neutralizes formula injection in nicknames", () =>
    expect(buildResultsCsv([row({ members: ["-1+2", "가람"] })])).toContain("'-1+2·가람"));

  it("neutralizes every formula lead character (= + - @ tab CR) and only at the start of a cell", () => {
    const csv = buildResultsCsv([
      row({ teamName: "=HYPERLINK(1)", members: ["+a", "b"] }),
      row({ teamId: "t2", teamName: "@SUM", members: ["\tx", "y"] }),
      row({ teamId: "t3", teamName: "팀=1", members: ["가-람", "다@온"] }),
    ]);
    const [, r1, r2, r3] = lines(csv);
    expect(r1.startsWith("'=HYPERLINK(1),'+a·b,")).toBe(true);
    expect(r2.startsWith("'@SUM,'\tx·y,")).toBe(true);
    expect(r3.startsWith("팀=1,가-람·다@온,")).toBe(true);
    // A CR at the start: neutralized AND quoted (a line break inside a cell).
    const cr = buildResultsCsv([row({ members: ["\r1", "z"] })]);
    expect(cr).toContain(`,"'\r1·z",`);
  });

  it("quotes commas and quotes; '-' for an unreached principle", () => {
    const csv = buildResultsCsv([
      row({ teamName: 'a,b"c', members: ["가람", "다\n온"], firstTry: { privacy: true, safety: false } }),
      row({ teamId: "team-2", teamName: "풍선(빨강)", escaped: false, stars: 0, firstTry: {} }),
    ]);
    const all = csv.slice(1);
    // Commas and quotes: wrapped in quotes, inner quotes doubled; a line break inside a cell too.
    expect(all).toContain(`"a,b""c","가람·다\n온",상담실,탈출,`);
    // Columns only for the principles that appear, in PRINCIPLES order (privacy before safety).
    const privacy = PRINCIPLES.find((p) => p.id === "privacy")!.label;
    const safety = PRINCIPLES.find((p) => p.id === "safety")!.label;
    expect(all.startsWith(`${HEADER},${privacy} 첫 시도,${safety} 첫 시도\r\n`)).toBe(true);
    // The first row: 정답 / 오답; the second never reached the last door: '-' in both columns.
    expect(all).toContain(",정답,오답\r\n");
    expect(all).toContain("풍선(빨강),가람·다온,상담실,미탈출,512,388,2,3,0,-,-\r\n");
  });

  it("principle columns follow PRINCIPLES order whatever the key order; unknown ids get no column", () => {
    const csv = buildResultsCsv([
      row({ firstTry: { transparency: true, made_up: true, human_centered: false } as Record<string, boolean> }),
    ]);
    const [header, body] = lines(csv);
    expect(header).toBe(`${HEADER},인간중심성 첫 시도,투명성 첫 시도`);
    expect(body.endsWith(",오답,정답")).toBe(true);
    expect(csv).not.toContain("made_up");
  });

  it("no results: the header line alone; no principle column without a first try", () => {
    expect(buildResultsCsv([])).toBe(`${BOM}${HEADER}\r\n`);
    expect(lines(buildResultsCsv([row()]))).toEqual([HEADER, "햇살(파랑),가람·다온,상담실,탈출,512,388,2,3,2"]);
  });

  it("carries nicknames only: no team or session ids, no overtime column", () => {
    const csv = buildResultsCsv([row({ teamId: "team-77", members: ["가람"] })]);
    expect(csv).not.toContain("team-77");
    expect(csv).not.toContain("overtime");
    expect(lines(csv)[1]).toBe("햇살(파랑),가람,상담실,탈출,512,388,2,3,2");
  });
});

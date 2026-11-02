import { describe, expect, it } from "vitest";
import { OPENED_FLASH_MS, openedNow, phaseBannerText, pickStackLine } from "./phaseText";

describe("phaseBannerText", () => {
  it("lobby: students are told to make teams and wait", () => {
    expect(phaseBannerText({ phase: "lobby", opened: false, isTeacher: false })).toBe(
      "팀을 만들고 기다려 주세요. 선생님이 시작하면 복도 문이 열려요.",
    );
  });

  it("paused: students are told the teacher paused", () => {
    expect(phaseBannerText({ phase: "paused", opened: false, isTeacher: false })).toBe("선생님이 잠시 멈췄어요");
  });

  it("the moment the class starts the banner announces the open doors, to everyone", () => {
    expect(phaseBannerText({ phase: "running", opened: true, isTeacher: false })).toBe("복도 문이 열렸어요!");
    expect(phaseBannerText({ phase: "running", opened: true, isTeacher: true })).toBe("복도 문이 열렸어요!");
  });

  it("nothing in a running or ended class, and the teacher is not told to wait for themselves", () => {
    expect(phaseBannerText({ phase: "running", opened: false, isTeacher: false })).toBeNull();
    expect(phaseBannerText({ phase: "ended", opened: false, isTeacher: false })).toBeNull();
    expect(phaseBannerText({ phase: "lobby", opened: false, isTeacher: true })).toBeNull();
    expect(phaseBannerText({ phase: "paused", opened: false, isTeacher: true })).toBeNull();
  });

  it("the open-doors line lasts 3 seconds", () => {
    expect(OPENED_FLASH_MS).toBe(3000);
  });
});

describe("pickStackLine (one line under the toast)", () => {
  it("the banner wins: a pad line that repeats it is not shown next to it", () => {
    expect(pickStackLine("선생님이 잠시 멈췄어요", "선생님이 잠시 멈췄어요")).toBe("banner");
    expect(pickStackLine("복도 문이 열렸어요!", "팀원이 2명 이상 모이면 입장할 수 있어요")).toBe("banner");
  });
  it("without a banner the pad line shows; with neither there is nothing", () => {
    expect(pickStackLine(null, "팀장 다온님이 입장을 누르면 함께 들어가요")).toBe("hint");
    expect(pickStackLine(null, null)).toBeNull();
  });
  it("in a lobby or a paused class a student always has a banner, so never the repeated pad line", () => {
    for (const phase of ["lobby", "paused"] as const) {
      const banner = phaseBannerText({ phase, opened: false, isTeacher: false });
      expect(pickStackLine(banner, "선생님이 시작하면 문이 열려요")).toBe("banner");
    }
  });
});

describe("openedNow (a start the student SAW)", () => {
  it("only lobby to running counts; a resume, a late join and a pause do not", () => {
    expect(openedNow("lobby", "running")).toBe(true);
    expect(openedNow("paused", "running")).toBe(false);
    expect(openedNow("running", "running")).toBe(false);
    expect(openedNow("lobby", "lobby")).toBe(false);
    expect(openedNow("running", "paused")).toBe(false);
    expect(openedNow("running", "ended")).toBe(false);
  });
});

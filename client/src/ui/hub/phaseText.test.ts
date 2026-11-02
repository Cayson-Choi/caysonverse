import { describe, expect, it } from "vitest";
import { OPENED_FLASH_MS, openedNow, phaseBannerText } from "./phaseText";

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

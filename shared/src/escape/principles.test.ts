import { describe, it, expect } from "vitest";
import { PRINCIPLES, PRINCIPLE_SOURCE } from "./principles";

describe("AI ethics principles", () => {
  it("lists the 10 core requirements in the official order", () => {
    expect(PRINCIPLES.map((p) => p.id)).toEqual([
      "human_rights",
      "privacy",
      "diversity",
      "no_harm",
      "public_good",
      "solidarity",
      "data_management",
      "accountability",
      "safety",
      "transparency",
    ]);
    expect(PRINCIPLES.map((p) => p.label)).toEqual([
      "인권 보장",
      "프라이버시 보호",
      "다양성 존중",
      "침해금지",
      "공공성",
      "연대성",
      "데이터 관리",
      "책임성",
      "안전성",
      "투명성",
    ]);
  });

  it("has unique ids and unique non-empty labels", () => {
    expect(new Set(PRINCIPLES.map((p) => p.id)).size).toBe(PRINCIPLES.length);
    expect(new Set(PRINCIPLES.map((p) => p.label)).size).toBe(PRINCIPLES.length);
    for (const p of PRINCIPLES) expect(p.label.trim().length, p.id).toBeGreaterThan(0);
  });

  it("names the ministry guideline as the source", () => {
    expect(PRINCIPLE_SOURCE).toBe("과학기술정보통신부 「인공지능(AI) 윤리기준」(2020)");
  });
});

import { describe, it, expect } from "vitest";
import { PRINCIPLES, PRINCIPLE_SOURCE } from "./principles";

describe("AI ethics principles", () => {
  it("lists the 7 principles of 「대한민국 인공지능 윤리원칙」 in the official order", () => {
    expect(PRINCIPLES.map((p) => p.id)).toEqual([
      "human_centered",
      "privacy",
      "fairness",
      "accountability",
      "safety",
      "reliability",
      "transparency",
    ]);
    expect(PRINCIPLES.map((p) => p.label)).toEqual([
      "인간중심성",
      "프라이버시 보호",
      "공정성·포용성",
      "책임성",
      "안전성",
      "신뢰성",
      "투명성",
    ]);
  });

  it("has unique ids and unique non-empty labels", () => {
    expect(new Set(PRINCIPLES.map((p) => p.id)).size).toBe(PRINCIPLES.length);
    expect(new Set(PRINCIPLES.map((p) => p.label)).size).toBe(PRINCIPLES.length);
    for (const p of PRINCIPLES) expect(p.label.trim().length, p.id).toBeGreaterThan(0);
  });

  it("names the 2026 national AI ethics principles as the source", () => {
    expect(PRINCIPLE_SOURCE).toBe("과학기술정보통신부 「대한민국 인공지능 윤리원칙」(2026)");
  });
});

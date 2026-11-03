import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_APPEARANCE } from "@caysonverse/shared/appearance";
import { BuilderPanel } from "./BuilderPanel";

// 조립실 패널을 서버 렌더(DOM 없이 마크업만)로 그려서 본다: 목소리 고르기는 없다(발주자 2026-11-03: "음성은 빼버려").
function markup(): string {
  return renderToStaticMarkup(createElement(BuilderPanel, { appearance: { ...DEFAULT_APPEARANCE }, onChange: () => undefined }));
}

describe("BuilderPanel — no 목소리 section", () => {
  it("renders the presets, the slot tabs and the part cards, but no voice section", () => {
    const html = markup();
    // The builder itself is there.
    expect(html).toContain("추천 캐릭터");
    expect(html).toContain('role="tablist"');
    expect(html).toContain("cv-chips");
    // No 목소리 heading, hint, options, radio group or speaker icon.
    for (const gone of ["목소리", "남자 목소리", "여자 목소리", "읽어 줄", "cv-voice", 'role="radio"', 'role="radiogroup"']) {
      expect(html).not.toContain(gone);
    }
  });
});

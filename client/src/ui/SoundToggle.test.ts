import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SoundToggle } from "./SoundToggle";

// 소리 버튼은 이제 목소리·낭독을 말하지 않는다(발주자 2026-11-03: 채팅을 읽어 주지 않는다).
// (서버 렌더는 스토어의 처음 값을 쓰므로 켜진 모양만 본다. 껐을 때의 모양은 그대로다.)
describe("SoundToggle", () => {
  it("is named 소리 켜기/끄기 and never mentions voice or reading aloud", () => {
    const html = renderToStaticMarkup(createElement(SoundToggle));
    expect(html).toContain('aria-label="소리 켜기/끄기"');
    expect(html).toContain('aria-pressed="true"');
    for (const gone of ["음성", "낭독", "목소리", "읽어"]) expect(html).not.toContain(gone);
  });
});

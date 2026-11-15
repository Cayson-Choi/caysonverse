import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Compass } from "./Compass";

describe("Compass", () => {
  it("draws 북 동 남 서 once each, never takes a press, and has a Korean name", () => {
    const html = renderToStaticMarkup(createElement(Compass));
    for (const letter of ["북", "동", "남", "서"]) expect(html.split(`>${letter}<`).length - 1).toBe(1);
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="나침반"');
    expect(html).not.toContain("<button");
  });

  it("passes a pinning style through (the phone layout puts it under the top group)", () => {
    const html = renderToStaticMarkup(createElement(Compass, { style: { left: 12, top: 100 } }));
    expect(html).toContain("left:12px");
    expect(html).toContain("top:100px");
  });
});

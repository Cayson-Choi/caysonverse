import { describe, expect, it } from "vitest";
import { tabWrapTarget } from "./focusTrap";

describe("tabWrapTarget", () => {
  it("Tab on the last control wraps to the first; Shift+Tab on the first wraps to the last", () => {
    expect(tabWrapTarget(5, 4, false)).toBe(0);
    expect(tabWrapTarget(5, 0, true)).toBe(4);
  });

  it("leaves the browser's own move alone in the middle of the dialog", () => {
    for (let i = 0; i < 4; i++) expect(tabWrapTarget(5, i, false)).toBeNull();
    for (let i = 1; i < 5; i++) expect(tabWrapTarget(5, i, true)).toBeNull();
  });

  it("from the dialog itself or from outside it, enters at the matching end", () => {
    expect(tabWrapTarget(5, -1, false)).toBe(0);
    expect(tabWrapTarget(5, -1, true)).toBe(4);
    expect(tabWrapTarget(5, 9, false)).toBe(0);
  });

  it("a single control traps both directions on itself", () => {
    expect(tabWrapTarget(1, 0, false)).toBe(0);
    expect(tabWrapTarget(1, 0, true)).toBe(0);
  });

  it("no controls: nothing to redirect to", () => {
    expect(tabWrapTarget(0, -1, false)).toBeNull();
  });
});

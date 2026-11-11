import { afterEach, describe, expect, it } from "vitest";
import { consumeSuppressedWorldPointer, resetWorldPointerGuard, suppressWorldPointer } from "./worldPointerGuard";

afterEach(() => resetWorldPointerGuard());

describe("world pointer guard", () => {
  it("consumes only the pointer sequence marked by the chat", () => {
    suppressWorldPointer(7);
    expect(consumeSuppressedWorldPointer(8)).toBe(false);
    expect(consumeSuppressedWorldPointer(7)).toBe(true);
    expect(consumeSuppressedWorldPointer(7)).toBe(false);
  });

  it("keeps one mark per pointer id", () => {
    suppressWorldPointer(3);
    suppressWorldPointer(3);
    expect(consumeSuppressedWorldPointer(3)).toBe(true);
    expect(consumeSuppressedWorldPointer(3)).toBe(false);
  });
});

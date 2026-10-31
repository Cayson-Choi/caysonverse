import { describe, it, expect } from "vitest";
import { validateTypingPayload } from "./typing";

describe("validateTypingPayload", () => {
  it("accepts only a boolean `on`", () => {
    expect(validateTypingPayload({ on: true })).toBe(true);
    expect(validateTypingPayload({ on: false })).toBe(false);
    for (const bad of [null, undefined, 1, "on", {}, { on: 1 }, { on: "true" }]) {
      expect(validateTypingPayload(bad)).toBeNull();
    }
  });

  it("returns null for arrays and other non-object payloads", () => {
    expect(validateTypingPayload([true])).toBeNull();
    expect(validateTypingPayload(true)).toBeNull();
    expect(validateTypingPayload(false)).toBeNull();
  });

  it("returns null when `on` is a nullish or boxed value", () => {
    expect(validateTypingPayload({ on: null })).toBeNull();
    expect(validateTypingPayload({ on: undefined })).toBeNull();
    expect(validateTypingPayload({ on: [true] })).toBeNull();
  });
});

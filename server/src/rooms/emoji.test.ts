import { describe, it, expect } from "vitest";
import { EMOJIS } from "@caysonverse/shared/constants";
import { validateEmojiIndex } from "./emoji";

describe("validateEmojiIndex", () => {
  it("accepts every valid index in range", () => {
    for (let i = 0; i < EMOJIS.length; i++) {
      expect(validateEmojiIndex({ index: i })).toBe(i);
    }
  });

  it("returns null for a negative index", () => {
    expect(validateEmojiIndex({ index: -1 })).toBeNull();
  });

  it("returns null for an index at or beyond EMOJIS.length", () => {
    expect(validateEmojiIndex({ index: EMOJIS.length })).toBeNull();
    expect(validateEmojiIndex({ index: EMOJIS.length + 10 })).toBeNull();
  });

  it("returns null for a non-integer index", () => {
    expect(validateEmojiIndex({ index: 1.5 })).toBeNull();
    expect(validateEmojiIndex({ index: NaN })).toBeNull();
    expect(validateEmojiIndex({ index: Infinity })).toBeNull();
  });

  it("returns null for a non-number index", () => {
    expect(validateEmojiIndex({ index: "1" })).toBeNull();
    expect(validateEmojiIndex({ index: null })).toBeNull();
    expect(validateEmojiIndex({ index: undefined })).toBeNull();
    expect(validateEmojiIndex({ index: true })).toBeNull();
    expect(validateEmojiIndex({ index: [1] })).toBeNull();
    expect(validateEmojiIndex({ index: { value: 1 } })).toBeNull();
  });

  it("returns null when the payload is missing the index field", () => {
    expect(validateEmojiIndex({})).toBeNull();
  });

  it("returns null for a malformed payload (not an object)", () => {
    expect(validateEmojiIndex(null)).toBeNull();
    expect(validateEmojiIndex(undefined)).toBeNull();
    expect(validateEmojiIndex("2")).toBeNull();
    expect(validateEmojiIndex(2)).toBeNull();
    expect(validateEmojiIndex([2])).toBeNull();
  });
});

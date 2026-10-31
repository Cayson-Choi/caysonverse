import { describe, expect, it } from "vitest";
import { ROLE_TEACHER } from "@caysonverse/shared/constants";
import { isLocalTeacher } from "./ownNametag";

describe("isLocalTeacher", () => {
  it("uses the synced role when it can be read", () => {
    expect(isLocalTeacher(ROLE_TEACHER, false)).toBe(true);
    expect(isLocalTeacher(ROLE_TEACHER, true)).toBe(true);
    expect(isLocalTeacher(0, false)).toBe(false);
  });

  it("a readable student role beats a stale admin flag", () => {
    expect(isLocalTeacher(0, true)).toBe(false);
  });

  it("falls back to the admin flag while the room state is not readable", () => {
    expect(isLocalTeacher(undefined, true)).toBe(true);
    expect(isLocalTeacher(undefined, false)).toBe(false);
  });
});

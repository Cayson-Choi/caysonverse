import { describe, it, expect } from "vitest";
import { MessageType } from "../messages";
import { ClassMsg, EscapeMsg } from "../escape/messages";
import { VillageMsg } from "./messages";

describe("VillageMsg", () => {
  it("the wire name is UseDoor (brief value, verbatim) and collides with no other message family", () => {
    expect(VillageMsg).toEqual({ UseDoor: "UseDoor" });
    const values = Object.values(VillageMsg);
    expect(new Set(values).size).toBe(values.length);
    // A village client also hears the world messages (VillageRoom is a PlayerRoom).
    const others = new Set<string>([...Object.values(MessageType), ...Object.values(ClassMsg), ...Object.values(EscapeMsg)]);
    for (const v of values) expect(others.has(v), v).toBe(false);
  });
});

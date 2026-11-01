import { describe, it, expect } from "vitest";
import { MessageType } from "../messages";
import { ClassMsg, EscapeMsg } from "./messages";

describe("EscapeMsg", () => {
  it("every value is unique, x_-prefixed and collides with no world MessageType or ClassMsg", () => {
    const values = Object.values(EscapeMsg);
    expect(values).toHaveLength(16);
    expect(new Set(values).size).toBe(values.length);
    for (const v of values) expect(v, v).toMatch(/^x_[a-z_]+$/);
    // An escape-room client also hears the world messages (Move, Chat, …: EscapeRoom is a
    // PlayerRoom) and stays in its class, so one value shared with either family would misroute.
    const others = new Set<string>([...Object.values(MessageType), ...Object.values(ClassMsg)]);
    for (const v of values) expect(others.has(v), v).toBe(false);
    // The wire names the client and the server agree on (brief values, verbatim).
    expect(EscapeMsg).toEqual({
      Content: "x_content",
      Inspect: "x_inspect",
      InspectView: "x_inspect_view",
      Pickup: "x_pickup",
      Combine: "x_combine",
      LockInput: "x_lock_input",
      BoardPlace: "x_board_place",
      LockSubmit: "x_lock_submit",
      Press: "x_press",
      HoldStart: "x_hold_start",
      HoldEnd: "x_hold_end",
      Vote: "x_vote",
      HintRequest: "x_hint",
      Retry: "x_retry",
      Event: "x_event",
      Notice: "x_notice",
    });
  });
});

describe("ClassMsg", () => {
  it("every value is unique, c_-prefixed and never collides with a world MessageType", () => {
    const values = Object.values(ClassMsg);
    expect(values).toHaveLength(12);
    expect(new Set(values).size).toBe(values.length);
    for (const v of values) expect(v, v).toMatch(/^c_[a-z_]+$/);
    // One room hears both families (ClassRoom registers the world messages too), so one value
    // shared by both would route a class message to a world handler or vice versa.
    const world = new Set<string>(Object.values(MessageType));
    for (const v of values) expect(world.has(v), v).toBe(false);
  });
});

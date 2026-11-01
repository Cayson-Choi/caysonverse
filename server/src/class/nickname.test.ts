import { describe, it, expect } from "vitest";
import { decideNickname, nicknameKey } from "./nickname";

describe("nicknameKey", () => {
  it("normalizes case/spacing and decides new / takeover(ghost) / taken(active)", () => {
    // NFC, trim, runs of white space → one space, lower case.
    expect(nicknameKey("  Garam  ")).toBe("garam");
    expect(nicknameKey("가  람")).toBe("가 람");
    expect(nicknameKey("가\t 　람")).toBe("가 람");
    const decomposed = "가람".normalize("NFD"); // e.g. typed on a Mac
    expect(decomposed).not.toBe("가람");
    expect(nicknameKey(decomposed)).toBe("가람");

    const roster = [
      { sid: "a", key: nicknameKey("가람"), connected: true },
      { sid: "b", key: nicknameKey("Bob"), connected: false },
    ];
    expect(decideNickname(roster, nicknameKey("다온"))).toEqual({ kind: "new" });
    expect(decideNickname(roster, nicknameKey(" BOB "))).toEqual({ kind: "takeover", sid: "b" });
    expect(decideNickname(roster, nicknameKey("가람".normalize("NFD")))).toEqual({ kind: "taken" });
  });

  it("an active holder wins over a ghost with the same key; an empty roster is always new", () => {
    const both = [
      { sid: "ghost", key: "x", connected: false },
      { sid: "live", key: "x", connected: true },
    ];
    expect(decideNickname(both, "x")).toEqual({ kind: "taken" });
    expect(decideNickname([...both].reverse(), "x")).toEqual({ kind: "taken" });
    expect(decideNickname([], "x")).toEqual({ kind: "new" });
    // A different key never matches, however close.
    expect(decideNickname([{ sid: "a", key: "가 람", connected: true }], "가람")).toEqual({ kind: "new" });
  });
});

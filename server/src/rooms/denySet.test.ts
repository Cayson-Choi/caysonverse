import { describe, it, expect } from "vitest";
import { DenySet, normalizeNick } from "./denySet";

describe("normalizeNick", () => {
  it("trims and lowercases for case/whitespace-insensitive matching", () => {
    expect(normalizeNick("  Bob  ")).toBe("bob");
    expect(normalizeNick("밥이")).toBe("밥이");
    expect(normalizeNick("ALICE")).toBe("alice");
  });
});

describe("DenySet", () => {
  it("denies a candidate whose IP matches a banned entry", () => {
    const deny = new DenySet();
    deny.add({ ip: "203.0.113.7", nickname: "밥이" });
    expect(deny.isDenied({ ip: "203.0.113.7", nickname: "다른닉네임" })).toBe(true);
  });

  it("denies a candidate whose nickname matches (weak fallback), case/trim-insensitive", () => {
    const deny = new DenySet();
    deny.add({ ip: "203.0.113.7", nickname: "밥이" });
    // Different IP (or none), but the nickname fallback still catches the ban.
    expect(deny.isDenied({ ip: "198.51.100.2", nickname: "밥이" })).toBe(true);
    expect(deny.isDenied({ ip: null, nickname: "  밥이 " })).toBe(true);
    expect(deny.isDenied({ ip: null, nickname: "BOB" })).toBe(false); // not banned
  });

  it("bans by nickname only when the IP is unavailable (global/no-proxy fallback)", () => {
    const deny = new DenySet();
    deny.add({ ip: null, nickname: "밥이" });
    // No IP was stored, so a different-IP rejoin is caught purely by nickname.
    expect(deny.isDenied({ ip: "10.0.0.9", nickname: "밥이" })).toBe(true);
    expect(deny.isDenied({ ip: "10.0.0.9", nickname: "앨리스" })).toBe(false);
  });

  it("does not deny an unrelated candidate (different ip and nickname)", () => {
    const deny = new DenySet();
    deny.add({ ip: "203.0.113.7", nickname: "밥이" });
    expect(deny.isDenied({ ip: "198.51.100.2", nickname: "앨리스" })).toBe(false);
  });

  it("ignores empty/whitespace nickname keys so a blank never matches everyone", () => {
    const deny = new DenySet();
    deny.add({ ip: null, nickname: "   " }); // nothing meaningful to store
    expect(deny.isDenied({ ip: null, nickname: "누구든" })).toBe(false);
    expect(deny.isDenied({ ip: null, nickname: "   " })).toBe(false);
  });

  it("ignores empty IP keys so a blank IP never matches everyone", () => {
    const deny = new DenySet();
    deny.add({ ip: "", nickname: "밥이" });
    // The empty IP must not be treated as a real key.
    expect(deny.isDenied({ ip: "", nickname: "앨리스" })).toBe(false);
    expect(deny.isDenied({ ip: "", nickname: "밥이" })).toBe(true); // nickname still bans
  });
});

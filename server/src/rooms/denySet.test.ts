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
  it("denies a same-nickname rejoin regardless of IP (case/trim-insensitive)", () => {
    const deny = new DenySet();
    deny.add({ ip: "203.0.113.7", nickname: "밥이" });
    // Same nickname from the SAME IP → denied.
    expect(deny.isDenied({ ip: "203.0.113.7", nickname: "밥이" })).toBe(true);
    // Same nickname from a DIFFERENT IP (or none) → still denied (nickname key).
    expect(deny.isDenied({ ip: "198.51.100.2", nickname: "밥이" })).toBe(true);
    expect(deny.isDenied({ ip: null, nickname: "  밥이 " })).toBe(true);
    expect(deny.isDenied({ ip: null, nickname: "BOB" })).toBe(false); // not banned
  });

  it("does NOT deny a different nickname on the SAME (shared NAT) IP — classroom lockout fix (F7)", () => {
    // The whole point of F7: kicking one student on shared classroom Wi-Fi must
    // NOT ban every classmate sharing that one public NAT IP. Only the kicked
    // nickname is denied; a classmate with a different nickname joins freely.
    const deny = new DenySet();
    deny.add({ ip: "203.0.113.7", nickname: "방해꾼" });
    expect(deny.isDenied({ ip: "203.0.113.7", nickname: "앨리스" })).toBe(false);
    expect(deny.isDenied({ ip: "203.0.113.7", nickname: "밥이" })).toBe(false);
    // …but the kicked student refreshing on the same IP is still blocked.
    expect(deny.isDenied({ ip: "203.0.113.7", nickname: "방해꾼" })).toBe(true);
  });

  it("bans by nickname when the IP is unavailable (no-proxy fallback)", () => {
    const deny = new DenySet();
    deny.add({ ip: null, nickname: "밥이" });
    expect(deny.isDenied({ ip: "10.0.0.9", nickname: "밥이" })).toBe(true);
    expect(deny.isDenied({ ip: "10.0.0.9", nickname: "앨리스" })).toBe(false);
  });

  it("does not deny an unrelated candidate (different nickname)", () => {
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

  it("never bans on IP alone — an IP-only entry stores nothing", () => {
    const deny = new DenySet();
    deny.add({ ip: "203.0.113.7", nickname: "" }); // no nickname → nothing to ban
    // A candidate from that exact IP is NOT denied (IP is not a ban key).
    expect(deny.isDenied({ ip: "203.0.113.7", nickname: "앨리스" })).toBe(false);
  });
});

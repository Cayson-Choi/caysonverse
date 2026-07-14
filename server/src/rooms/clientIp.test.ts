import { describe, it, expect } from "vitest";
import type { AuthContext } from "colyseus";
import { resolveClientIp } from "./clientIp";

// Build a minimal auth context carrying only the `ip` field the resolver reads.
function ctx(ip: unknown): AuthContext {
  return { ip } as unknown as AuthContext;
}

describe("resolveClientIp", () => {
  it("returns a single-value IP unchanged (no proxy chain)", () => {
    expect(resolveClientIp(ctx("203.0.113.7"))).toBe("203.0.113.7");
  });

  it("trims surrounding whitespace on a single value", () => {
    expect(resolveClientIp(ctx("  203.0.113.7  "))).toBe("203.0.113.7");
  });

  it("selects the RIGHT-most hop — the real client IP appended by the trusted proxy", () => {
    // Railway appends the observed socket IP; the right-most entry is trusted.
    expect(resolveClientIp(ctx("198.51.100.9, 203.0.113.7"))).toBe("203.0.113.7");
  });

  it("ignores a client-SPOOFED left-most X-Forwarded-For prefix", () => {
    // An attacker sets `X-Forwarded-For: <spoof>`; the proxy appends the real IP.
    // Trusting the left-most entry (the old bug) would return the spoof; we must
    // return the real, right-most hop so the security key can't be rotated.
    const spoofed = "1.2.3.4, 203.0.113.7"; // 1.2.3.4 is attacker-chosen
    expect(resolveClientIp(ctx(spoofed))).toBe("203.0.113.7");
    expect(resolveClientIp(ctx(spoofed))).not.toBe("1.2.3.4");
  });

  it("selects the last hop of a longer chain", () => {
    expect(resolveClientIp(ctx("a.a.a.a, b.b.b.b, 203.0.113.7"))).toBe("203.0.113.7");
  });

  it("skips trailing empty entries and returns the last real hop", () => {
    expect(resolveClientIp(ctx("1.1.1.1, 203.0.113.7, , "))).toBe("203.0.113.7");
  });

  it("takes the last element when defensively handed an array", () => {
    expect(resolveClientIp(ctx(["198.51.100.9", "203.0.113.7"]))).toBe("203.0.113.7");
  });

  it("returns null when the IP is unavailable (no proxy header)", () => {
    expect(resolveClientIp(ctx(undefined))).toBeNull();
    expect(resolveClientIp(ctx(null))).toBeNull();
    expect(resolveClientIp(ctx(""))).toBeNull();
    expect(resolveClientIp(ctx("   "))).toBeNull();
    expect(resolveClientIp(ctx(",  ,"))).toBeNull();
  });

  it("returns null for a non-string, non-array ip value", () => {
    expect(resolveClientIp(ctx(42))).toBeNull();
    expect(resolveClientIp(ctx({}))).toBeNull();
  });

  it("returns null for an undefined context", () => {
    expect(resolveClientIp(undefined)).toBeNull();
  });
});

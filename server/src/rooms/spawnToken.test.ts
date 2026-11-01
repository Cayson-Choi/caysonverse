import { describe, it, expect } from "vitest";
import { SPAWN_TOKEN, assertSpawnToken } from "./spawnToken";

/** The token with one character changed (same length, different value). */
function flipped(token: string): string {
  const last = token[token.length - 1];
  return token.slice(0, -1) + (last === "A" ? "B" : "A");
}

describe("spawn token", () => {
  it("is a fresh 24-byte base64url secret", () => {
    // 24 bytes → 32 base64url symbols, no padding.
    expect(SPAWN_TOKEN).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it("assertSpawnToken accepts only SPAWN_TOKEN", () => {
    expect(() => assertSpawnToken({ spawnToken: SPAWN_TOKEN })).not.toThrow();
    expect(() => assertSpawnToken({ spawnToken: SPAWN_TOKEN, classCode: "AB2CDE" })).not.toThrow();

    const rejected: unknown[] = [
      undefined,
      null,
      {},
      SPAWN_TOKEN, // the bare string is not an options object
      { spawnToken: "" },
      { spawnToken: SPAWN_TOKEN.slice(1) },
      { spawnToken: `${SPAWN_TOKEN}x` },
      { spawnToken: flipped(SPAWN_TOKEN) },
      { spawnToken: ` ${SPAWN_TOKEN}` },
      { spawnToken: 123 },
      { spawnToken: [SPAWN_TOKEN] },
      { spawnToken: { toString: () => SPAWN_TOKEN } },
    ];
    for (const options of rejected) {
      expect(() => assertSpawnToken(options)).toThrow("잘못된 접근이에요");
    }
  });

  it("the rejection is a fixed Korean message that never echoes a token", () => {
    let message = "";
    try {
      assertSpawnToken({ spawnToken: flipped(SPAWN_TOKEN) });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toBe("잘못된 접근이에요");
    expect(message).not.toContain(SPAWN_TOKEN);
  });
});

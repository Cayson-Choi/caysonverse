import { describe, it, expect } from "vitest";
import { Schema, type, Encoder, Decoder } from "@colyseus/schema";

/**
 * Guards the @colyseus/schema `useDefineForClassFields` trap.
 *
 * `@type` installs get/set accessors on the prototype to track state changes.
 * If TypeScript compiles class fields with useDefineForClassFields:true, each
 * field initializer becomes an OWN data property that shadows those accessors,
 * so mutations are never recorded and encode() emits nothing — state sync then
 * fails SILENTLY at runtime.
 *
 * This test mutates a Schema and asserts an encode -> decode round-trip
 * preserves the values. It MUST fail if the decorator tsconfig flags
 * (experimentalDecorators / useDefineForClassFields:false) are removed — that
 * RED behaviour was verified by flipping the flag locally.
 */
class SmokeState extends Schema {
  @type("string") label = "";
  @type("number") count = 0;
}

describe("@colyseus/schema decorator wiring", () => {
  it("tracks @type fields across an encode/decode round-trip", () => {
    const state = new SmokeState();
    state.label = "caysonverse";
    state.count = 42;

    const encoder = new Encoder(state);
    const bytes = encoder.encodeAll();

    // Under the trap, nothing is tracked, so the full-state encode is empty.
    expect(bytes.length).toBeGreaterThan(0);

    const decoded = new SmokeState();
    new Decoder(decoded).decode(bytes);

    expect(decoded.label).toBe("caysonverse");
    expect(decoded.count).toBe(42);
  });
});

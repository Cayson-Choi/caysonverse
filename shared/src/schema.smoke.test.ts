import { describe, it, expect } from "vitest";
import { Schema, type, Encoder, Decoder } from "@colyseus/schema";
import { Player, WorldState } from "./schema";
import { APPEARANCE_FIELDS, APPEARANCE_RANGES, pickAppearance, type Appearance } from "./appearance";

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

  it("Player round-trips its nickname and pose", () => {
    const player = new Player();
    player.nickname = "주민";
    player.x = 1.5;
    player.z = -2.25;

    const decoded = new Player();
    new Decoder(decoded).decode(new Encoder(player).encodeAll());

    expect(decoded.nickname).toBe("주민");
    expect(decoded.x).toBeCloseTo(1.5, 5);
    expect(decoded.z).toBeCloseTo(-2.25, 5);
  });

  it("Player appearance fields default to 0 and round-trip a full look", () => {
    const player = new Player();
    const fields = player as unknown as Record<string, unknown>;
    // Every appearance field is a synced uint8 that starts at 0 (the server writes all 15 at join).
    for (const field of APPEARANCE_FIELDS) expect(fields[field], field).toBe(0);
    // The pre-builder fields are gone from the synced Player.
    expect(fields).not.toHaveProperty("character");
    expect(fields).not.toHaveProperty("tint");

    // The largest legal value in every field, so a wrong wire type (e.g. a bool or a
    // truncated int) or a missing @type would show up as a mismatch.
    const look = {} as Appearance;
    for (const field of APPEARANCE_FIELDS) look[field] = APPEARANCE_RANGES[field] - 1;
    for (const field of APPEARANCE_FIELDS) fields[field] = look[field];
    player.nickname = "외형";

    const decoded = new Player();
    new Decoder(decoded).decode(new Encoder(player).encodeAll());

    expect(pickAppearance(decoded)).toEqual(look);
    expect(decoded.nickname).toBe("외형");
  });

  it("declares the 15 appearance fields as uint8, in APPEARANCE_FIELDS order", () => {
    // @colyseus/schema's per-class field table: { [index]: { name, type, index } }.
    const meta = (Player as unknown as Record<symbol, Record<string, { name: string; type: unknown }>>)[
      Symbol.metadata
    ];
    const fields = Object.keys(meta)
      .filter((k) => /^\d+$/.test(k))
      .map((k) => meta[k]);
    const appearance = fields.filter((f) => (APPEARANCE_FIELDS as readonly string[]).includes(f.name));
    expect(appearance.map((f) => f.name)).toEqual([...APPEARANCE_FIELDS]);
    expect(appearance.every((f) => f.type === "uint8")).toBe(true);
  });

  it("Player.area defaults to the village and round-trips the hall", () => {
    expect(new Player().area).toBe("village");

    const state = new WorldState();
    const player = new Player();
    player.nickname = "방문객";
    state.players.set("s1", player);
    state.players.set("s2", new Player()); // never set: stays at the default
    state.players.get("s2")!.nickname = "마을사람";
    state.players.get("s1")!.area = "hall";

    const decoded = new WorldState();
    new Decoder(decoded).decode(new Encoder(state).encodeAll());
    expect(decoded.players.get("s1")!.area).toBe("hall");
    expect(decoded.players.get("s2")!.area).toBe("village");
    // The new field did not disturb its neighbours.
    expect(decoded.players.get("s1")!.nickname).toBe("방문객");
    expect(decoded.players.get("s1")!.seatIndex).toBe(-1);
  });
});

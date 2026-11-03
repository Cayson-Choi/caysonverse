import { describe, it, expect } from "vitest";
import { Schema, type, Encoder, Decoder } from "@colyseus/schema";
import { ClassState, EscapeState, Player, Team, WorldState } from "./schema";
import { ROLE_STUDENT, ROLE_TEACHER } from "./constants";
import { PLACE_ESCAPE, PLACE_HUB } from "./escape/constants";
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

  it("Player.role defaults to 0 and round-trips 1", () => {
    const player = new Player();
    expect(player.role).toBe(ROLE_STUDENT); // default: student
    expect(ROLE_STUDENT).toBe(0);
    expect(ROLE_TEACHER).toBe(1);

    player.nickname = "선생님";
    player.role = ROLE_TEACHER;

    const bytes = new Encoder(player).encodeAll();
    const decoded = new Player();
    new Decoder(decoded).decode(bytes);

    expect(decoded.role).toBe(ROLE_TEACHER);
    expect(decoded.nickname).toBe("선생님"); // the rest of the Player still syncs
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

  it("Player.area defaults to the village (legacy world and class rooms never set it) and round-trips the hall", () => {
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

  it("ClassState round-trips teams, litRooms and Player.place/teamId", () => {
    // Defaults: a fresh class is in the lobby at the easy level; a fresh player is in the hub, teamless.
    const fresh = new ClassState();
    expect(fresh.phase).toBe("lobby");
    expect(fresh.textLevel).toBe("easy");
    expect(fresh.classCode).toBe("");
    expect(fresh.teams.size).toBe(0);
    expect(new Player().teamId).toBe("");
    expect(new Player().place).toBe(PLACE_HUB);

    const state = new ClassState();
    state.classCode = "AB2CDE";
    state.phase = "running";
    state.textLevel = "hard";
    state.announcement = "공지"; // inherited from WorldState
    state.openRooms.push("counsel");
    state.litRooms.push("counsel");

    const team = new Team();
    team.id = "t1";
    team.nameIndex = 11; // the largest TEAM_NAMES index
    team.colorIndex = 7; // the largest TEAM_COLORS index
    team.members.push("s1", "s2");
    team.escapeRoomId = "room-x";
    team.escapeDoor = "counsel";
    team.escaped.push("counsel");
    team.stars.set("counsel", 3);
    team.padDoor = "counsel";
    team.padLeaderSid = "s2";
    team.padCount = 2;
    state.teams.set("t1", team);

    const player = new Player();
    player.nickname = "가람";
    player.teamId = "t1";
    player.place = PLACE_ESCAPE;
    state.players.set("s1", player);

    const decoded = new ClassState();
    new Decoder(decoded).decode(new Encoder(state).encodeAll());

    expect(decoded.classCode).toBe("AB2CDE");
    expect(decoded.phase).toBe("running");
    expect(decoded.textLevel).toBe("hard");
    expect(decoded.announcement).toBe("공지");
    expect([...decoded.openRooms]).toEqual(["counsel"]);
    expect([...decoded.litRooms]).toEqual(["counsel"]);
    const t = decoded.teams.get("t1")!;
    expect(t.toJSON()).toEqual({
      id: "t1",
      nameIndex: 11,
      colorIndex: 7,
      members: ["s1", "s2"],
      escapeRoomId: "room-x",
      escapeDoor: "counsel",
      escaped: ["counsel"],
      stars: { counsel: 3 },
      padDoor: "counsel",
      padLeaderSid: "s2",
      padCount: 2,
    });
    const p = decoded.players.get("s1")!;
    expect(p.nickname).toBe("가람");
    expect(p.teamId).toBe("t1");
    expect(p.place).toBe(PLACE_ESCAPE);
  });

  it("EscapeState: defaults, then every field round-trips (uint8/uint16 ranges included)", () => {
    const fresh = new EscapeState();
    expect(fresh.toJSON()).toEqual({
      players: {},
      roomDefId: "",
      teamName: "",
      textLevel: "easy",
      phase: "intro",
      paused: false,
      solo: false,
      overtime: false,
      timeLeftS: 0,
      cooldownS: 0,
      flags: [],
      bag: [],
      lockInput: {},
      board: {},
      votes: {},
      finaleStep: 0,
      hintsUsed: 0,
      wrongAttempts: 0,
      hints: [],
    });

    const state = new EscapeState();
    state.roomDefId = "counsel";
    state.teamName = "햇살(파랑)";
    state.textLevel = "hard";
    state.phase = "finale";
    state.paused = true;
    state.solo = true;
    state.overtime = true;
    state.timeLeftS = 1200; // above 255: needs the uint16
    state.cooldownS = 30;
    state.flags.push("picked:flashlight", "solved:cabinet_lock");
    state.bag.push("uv_flashlight");
    state.lockInput.set("cabinet_lock", "1234");
    state.board.set("festival", "ok");
    state.votes.set("s1", "privacy");
    state.finaleStep = 1;
    state.hintsUsed = 2;
    state.wrongAttempts = 300; // above 255: needs the uint16
    state.hints.push("손전등을 살펴봐요.");
    const player = new Player();
    player.nickname = "가람";
    state.players.set("s1", player);

    const decoded = new EscapeState();
    new Decoder(decoded).decode(new Encoder(state).encodeAll());
    const json = decoded.toJSON() as Record<string, unknown>;
    expect({ ...json, players: undefined }).toEqual({
      players: undefined,
      roomDefId: "counsel",
      teamName: "햇살(파랑)",
      textLevel: "hard",
      phase: "finale",
      paused: true,
      solo: true,
      overtime: true,
      timeLeftS: 1200,
      cooldownS: 30,
      flags: ["picked:flashlight", "solved:cabinet_lock"],
      bag: ["uv_flashlight"],
      lockInput: { cabinet_lock: "1234" },
      board: { festival: "ok" },
      votes: { s1: "privacy" },
      finaleStep: 1,
      hintsUsed: 2,
      wrongAttempts: 300,
      hints: ["손전등을 살펴봐요."],
    });
    expect(decoded.players.get("s1")?.nickname).toBe("가람");
  });
});

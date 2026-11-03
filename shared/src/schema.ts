import { Schema, type, MapSchema, ArraySchema } from "@colyseus/schema";
import type { ClassPhase, EscapePhase, TextLevel } from "./escape/constants";
import type { AreaId } from "./village/villageLayout";

/**
 * Root room state, synchronized from the server to every connected client.
 *
 * SERVER-ONLY at runtime: this module executes @colyseus/schema decorators, so
 * it must never enter the browser bundle. The client may `import type` from here
 * but must NOT import any value. Browser-safe shared values live in
 * `constants.ts` / `messages.ts` instead — do not add a barrel that re-exports
 * this module together with them.
 */

/**
 * A single connected participant.
 *
 * Design notes (binding):
 * - No animation-state field: the client derives walk/idle from interpolated
 *   velocity, so it never needs to be synced.
 * - No `y` coordinate: the ground is server-fixed, which structurally prevents
 *   fly-hacks (a client simply cannot express vertical position).
 * - No chat text: transient messages are events, not state (anti-pattern to
 *   keep them in the synced tree).
 * - No admin marker: the `isAdmin` marker is server-only (WorldRoom's
 *   per-connection userData). The only thing published is `role`, which the
 *   server derives from it once at join (controls-ux §5).
 * - Appearance (character stage 3, design 5.2): 15 uint8 fields, declared in
 *   APPEARANCE_FIELDS order (shared/src/appearance.ts — the single source of
 *   their ranges, palettes and validation). WorldRoom.onJoin writes all 15 once,
 *   from the validated join options, so they are fixed for the whole session and
 *   clients read them once (`pickAppearance(player)`). Slot fields are part
 *   indices, colour fields palette indices, `voice` a VOICE_GENDERS index. They
 *   replace the pre-builder `character` / `tint` preset pair.
 */
export class Player extends Schema {
  @type("string") nickname = ""; // set once at join
  // ── appearance (APPEARANCE_FIELDS order) ──
  @type("uint8") hat = 0;
  @type("uint8") hatColor = 0;
  @type("uint8") hair = 0;
  @type("uint8") hairColor = 0;
  @type("uint8") face = 0;
  @type("uint8") skin = 0;
  @type("uint8") top = 0;
  @type("uint8") topColor = 0;
  @type("uint8") bottom = 0;
  @type("uint8") bottomColor = 0;
  @type("uint8") shoes = 0;
  @type("uint8") shoesColor = 0;
  @type("uint8") item = 0;
  @type("uint8") itemColor = 0;
  @type("uint8") voice = 0;
  @type("float32") x = 0;
  @type("float32") z = 0;
  @type("float32") yaw = 0; // radians, normalized to [-PI, PI]
  @type("boolean") connected = true; // used by reconnection (Task 11)
  // Seating (v2 Task 1): -1 = standing; 0..SEATS.length-1 = the occupied seat.
  // The first legitimate discrete synced state — a seated player is fully
  // server-positioned (x/z/yaw snapped to the seat), so 100 seated avatars sync.
  @type("int8") seatIndex = -1;
  // Role (controls-ux Task 3): 0 = student, 1 = teacher (ROLE_STUDENT /
  // ROLE_TEACHER in constants.ts). Written exactly once, by WorldRoom.onJoin from
  // the server-side admin-code result (ClassRoom.onJoin: from a verified one-time
  // teacher pass) — never from join options or client messages — so it is fixed
  // for the whole session and clients read it once.
  @type("uint8") role = 0;
  // AI 학교 탈출 (escape phase 1, ClassRoom only; the legacy world leaves both at their defaults):
  // the player's team id in ClassState.teams ("" = no team), and where they are —
  // PLACE_HUB (0, the hall/corridor) or PLACE_ESCAPE (1, inside their team's escape room).
  @type("string") teamId = "";
  @type("uint8") place = 0;
  // 케이슨 마을 (VillageRoom only; the legacy world and the class rooms never set it and leave the default):
  // which area the player is in — "village" (the open village) or "hall" (inside the memorial hall,
  // where the room is quiet: no emoji, no jumping). Written by VillageRoom at join and on every door use.
  @type("string") area: AreaId = "village";
}

export class WorldState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type("string") announcement = ""; // admin banner (wired in Task 9)
  @type("number") announcedAt = 0;
}

/**
 * One team of a class (AI 학교 탈출). Server-written only (team messages, Task 6; the escape
 * room link, Task 11). Its display name is TEAM_NAMES[nameIndex] + TEAM_COLOR_LABELS[colorIndex].
 */
export class Team extends Schema {
  @type("string") id = "";
  @type("uint8") nameIndex = 0;
  @type("uint8") colorIndex = 0;
  /** ClassRoom sessionIds of the members. */
  @type(["string"]) members = new ArraySchema<string>();
  /** The escape-room instance the team is in ("" = none) and the door (RoomId) it went through. */
  @type("string") escapeRoomId = "";
  @type("string") escapeDoor = "";
  /** RoomIds the team has escaped from. */
  @type(["string"]) escaped = new ArraySchema<string>();
  /** RoomId → stars earned there. */
  @type({ map: "uint8" }) stars = new MapSchema<number>();
  /** Door-pad status: the door most members stand at, who got there first, and how many. */
  @type("string") padDoor = "";
  @type("string") padLeaderSid = "";
  @type("uint8") padCount = 0;
}

/**
 * The synced state of one class (반) — the ClassRoom. The world's players/announcement plus the
 * class's code, progress phase, text level, teams and which rooms are open / solved.
 */
export class ClassState extends WorldState {
  @type("string") classCode = "";
  @type("string") phase: ClassPhase = "lobby";
  @type("string") textLevel: TextLevel = "easy";
  @type({ map: Team }) teams = new MapSchema<Team>();
  /** RoomIds whose doors can be entered (phase 1: ["counsel"]). */
  @type(["string"]) openRooms = new ArraySchema<string>();
  /** RoomIds lit up on the school-model progress board (solved by some team). */
  @type(["string"]) litRooms = new ArraySchema<string>();
}

/**
 * The synced state of one team's escape room (EscapeRoom, Task 10). Server-written only: the
 * room copies the puzzle engine's state in here (`projectToSchema`) after every action, so it
 * holds only what every teammate may see — never an answer, a hint not yet given, a clue
 * original or anyone's split half (those go to one player as `InspectView`). The room data's
 * public part comes once per join as `EscapeMsg.Content`.
 *
 * Collections are written append-only (flags, hints) or as a whole (bag: clear + push), never by
 * index, for the same mid-patch-window reason as `Team.members` (see ClassRoom.writeMembers).
 */
export class EscapeState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  /** The room (RoomId) this instance runs, the team's display name and the class's reading level. */
  @type("string") roomDefId = "";
  @type("string") teamName = "";
  @type("string") textLevel: TextLevel = "easy";
  /** ended > escaped > timeup > intro > the engine's play / finale. */
  @type("string") phase: EscapePhase = "intro";
  /** The teacher paused the class (game time stands still, puzzle actions are dropped). */
  @type("boolean") paused = false;
  /** Exactly one member is connected: the switch becomes a long press, split clues show both halves. */
  @type("boolean") solo = false;
  /** The team pressed "다시 도전" after the time ran out. */
  @type("boolean") overtime = false;
  @type("uint16") timeLeftS = 0;
  /** Seconds until the team may vote again at the last door after a wrong choice. */
  @type("uint8") cooldownS = 0;
  /** Puzzle flags (`picked:…`, `solved:…`, …), in the order they were set; never removed. */
  @type(["string"]) flags = new ArraySchema<string>();
  /** The team bag: item ids. */
  @type(["string"]) bag = new ArraySchema<string>();
  /** Shared lock input: lockId → digits / wheel indexes. */
  @type({ map: "string" }) lockInput = new MapSchema<string>();
  /** Sort board: cardId → binId. */
  @type({ map: "string" }) board = new MapSchema<string>();
  /** Last-door votes of the current step: EscapeRoom sessionId → optionId. */
  @type({ map: "string" }) votes = new MapSchema<string>();
  @type("uint8") finaleStep = 0;
  @type("uint8") hintsUsed = 0;
  @type("uint16") wrongAttempts = 0;
  /** Hint sentences the team received, in order (a teammate who comes in late reads them too). */
  @type(["string"]) hints = new ArraySchema<string>();
}

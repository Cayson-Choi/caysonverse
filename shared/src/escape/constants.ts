/**
 * "AI 학교 탈출" — shared constants for classes (반), teams, rooms and the escape
 * puzzle engine. Browser-safe: plain values and types only, no THREE, no
 * @colyseus/schema, no clocks, so the server, the client and the load test all read
 * ONE definition (same rule as ../constants.ts).
 *
 * The player's look is NOT listed here: the 15 appearance fields live in
 * ../appearance.ts (`APPEARANCE_FIELDS`), re-exported by ../constants.ts.
 */

// ───────────────────────────── Colyseus room names ─────────────────────────────

/** Room name of a class (반): hall, corridor, teams, teacher. */
export const CLASS_ROOM = "class";
/** Room name of one team's escape room (퍼즐 교실). */
export const ESCAPE_ROOM = "escape";

// ─────────────────────────────────── Class code ───────────────────────────────────

export const CLASS_CODE_LENGTH = 6;
/** 32 symbols, no look-alikes: 0/O and 1/I are left out (students read these off a board). */
export const CLASS_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

// ─────────────────────────── Class lifetime and admission ───────────────────────────

/** A class with nobody in it closes this long after the last person left. */
export const CLASS_EMPTY_CLOSE_MS = 600_000;
/** From "수업 끝내기" until connections are closed: time to download the results CSV. */
export const CLASS_END_GRACE_MS = 30_000;
/**
 * Close code the server uses when a class closes. In the application range (4000-4999)
 * but deliberately OUTSIDE everything Colyseus itself sends: CONSENTED 4000,
 * SERVER_SHUTDOWN 4001, WITH_ERROR 4002, FAILED_TO_RECONNECT 4003, MAY_TRY_RECONNECT 4010
 * (and the admin kick, KICK_CLOSE_CODE). A test pins that it collides with none of them,
 * so the client can tell "this class ended" from a dropped connection.
 */
export const CLASS_CLOSED_CODE = 4102;
/** How many classes one server hosts at once. Replaced by the Task 26 measurement. */
export const MAX_CLASSES_DEFAULT = 10;
/** The one-time teacher admission token (`teacherPass`) is valid this long. */
export const TEACHER_PASS_TTL_MS = 120_000;
/** A student rejoining a class keeps retrying for at most this long. */
export const CLASS_REJOIN_BUDGET_MS = 60_000;

// ─────────────────────────────────────── Teams ───────────────────────────────────────

export const TEAM_MIN = 2;
export const TEAM_MAX = 6;
export const TEAM_TARGET = 4;
export const MAX_TEAMS = 50;

/**
 * Team name words — bright daytime / festival words (the school is a sunny day, not night).
 * A team's display name is a name + a colour label, e.g. "햇살(파랑)", so 12 names x 8
 * colours = 96 distinct combinations for up to MAX_TEAMS teams.
 */
export const TEAM_NAMES = [
  "햇살",
  "풍선",
  "새싹",
  "민들레",
  "무지개",
  "바람개비",
  "꽃잎",
  "솜사탕",
  "도토리",
  "해바라기",
  "파도",
  "구름",
] as const;
export const TEAM_COLORS = ["#E85D75", "#F29E4C", "#F1C453", "#5BBF7A", "#3FA7D6", "#4B4FD8", "#8B5CF6", "#D16BA5"] as const;
/** Spoken/written name of each TEAM_COLORS entry, same order (never rely on colour alone). */
export const TEAM_COLOR_LABELS = ["빨강", "주황", "노랑", "초록", "하늘", "파랑", "보라", "분홍"] as const;

// ─────────────────────────────────────── Rooms ───────────────────────────────────────

export const ROOM_IDS = ["counsel", "library", "broadcast", "career", "art", "science", "media"] as const;
export type RoomId = (typeof ROOM_IDS)[number];
/** 상담실 · 도서관 · 방송실 · 진로실 · 미술실 · 과학실 · 미디어실 */
export const ROOM_LABELS: Record<RoomId, string> = {
  counsel: "상담실",
  library: "도서관",
  broadcast: "방송실",
  career: "진로실",
  art: "미술실",
  science: "과학실",
  media: "미디어실",
};
/** The rooms that can be entered in phase 1; the other doors stay shut. */
export const PHASE1_OPEN_ROOMS: readonly RoomId[] = ["counsel"];

// ────────────────────────────── Class and escape phases ──────────────────────────────

export type ClassPhase = "lobby" | "running" | "paused" | "ended";
export type ClassCommand = "start" | "pause" | "resume" | "end";
/** Reading level of the puzzle text (teacher picks it when opening the class). */
export type TextLevel = "easy" | "hard";

/** `Player.place`: standing in the class hall/corridor, or inside a team's escape room. */
export const PLACE_HUB = 0;
export const PLACE_ESCAPE = 1;

export type EscapePhase = "intro" | "play" | "finale" | "timeup" | "escaped" | "ended";

// ─────────────────────────────── Escape room rules ───────────────────────────────

/** 15 minutes (spec §14 aims at 12-15). */
export const ESCAPE_TIME_LIMIT_S = 900;
/** "다시 도전": 5 extra minutes. */
export const ESCAPE_RETRY_EXTRA_S = 300;
export const ESCAPE_INTRO_MS = 8000;
/** Two players must press their switches within this window ("동시 누르기"). */
export const COOP_WINDOW_MS = 2000;
/** A player who is alone holds the switch this long instead. */
export const SOLO_HOLD_MS = 3000;
/** After a failed persuasion, the team waits this long before choosing again. */
export const FINALE_COOLDOWN_MS = 30_000;
/** Minimum wait between two hints of the same step. */
export const HINT_GAP_MS = 30_000;
/** Minimum gap between two lock submissions by one team (a double click counts once). */
export const LOCK_SUBMIT_GAP_MS = 1500;
/** How close (m, on the ground plane) a player must stand to inspect/use an object. */
export const INSPECT_REACH = 2.2;
/** An empty escape room is disposed after this long. */
export const ESCAPE_EMPTY_DISPOSE_MS = 120_000;
/** The admission ticket for entering an escape room is valid this long. */
export const TICKET_TTL_MS = 60_000;
/**
 * Seats of one escape room: every member's ghost (a dropped session keeps its reserved seat for the
 * reconnection window) + their fresh session (a refreshed tab joins with a new ticket) + one spare.
 * So a whole team refreshing at once never finds the room full.
 */
export const ESCAPE_MAX_CLIENTS = 2 * TEAM_MAX + 1;
/** At most `count` puzzle actions per `windowMs` per client; the rest are dropped. */
export const ESCAPE_ACTION_RATE = { count: 10, windowMs: 1000 } as const;

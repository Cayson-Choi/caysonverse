/**
 * HTTP API for classes (반) — server-only.
 *
 *  - `POST /api/class/teacher` `{ teacherKey, classCode?, textLevel?, reopen? }`: verify the
 *    teacher key, open a new class (no `classCode`) or hand out a pass for the LIVE class named
 *    by `classCode` (a teacher coming back after a reload, a co-teacher), and answer
 *    `{ classCode, pass }`. Only `reopen: true` (the client's own restart recovery) may re-open
 *    a code the server no longer has. The pass is the one-time `teacherPass` the client then
 *    puts in its Colyseus join options — the key itself never travels over the WebSocket.
 *  - `POST /api/operator/status` `{ operatorKey }`: the operator's live view (phase 1 has
 *    no screen; this JSON is it, and the Task 26 load test polls it).
 *
 * SECRETS: teacher keys and the operator key arrive only in these request bodies. Nothing
 * here logs a key, a pass, a request body, or an error message that could carry one
 * (Colyseus/JSON errors quote their input) — only fixed strings. Every `/api` error
 * (including JSON syntax errors from the body parser) is answered by the API's own error
 * middleware, never by Express's default handler, which would print the error's stack.
 */

import express, { type Application, type NextFunction, type Request, type Response } from "express";
import { matchMaker } from "colyseus";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { CLASS_ROOM, type TextLevel } from "@caysonverse/shared/escape/constants";
import { normalizeClassCode } from "@caysonverse/shared/escape/classCode";
import { AdminAttemptLimiter, compareAdminCode } from "../rooms/adminAuth";
import { resolveClientIp } from "../rooms/clientIp";
import { SPAWN_TOKEN } from "../rooms/spawnToken";
import { canTeach, loadTeacherKeys, verifyTeacherKey, type TeacherKeyEntry, type VerifiedKey } from "./teacherKeys";
import { classRegistry, type ClassCreateOptions, type ClassRegistry } from "./classRegistry";
import { generateClassCode } from "./classCode";

/**
 * Korean messages shown to teachers / the operator.
 *
 * SERVER-ONLY: the client must never import from server/src/class (this module pulls in
 * the registry, key handling and the matchmaker). Task 13 moves the copy the client needs
 * into shared/.
 */
export const CLASS_API_ERRORS = {
  badRequest: "요청이 올바르지 않아요",
  wrongTeacherKey: "선생님 키가 올바르지 않아요",
  otherTeacher: "이 반 코드는 다른 선생님이 쓰고 있어요",
  /** A class code to re-enter that names no live class (never opened, ended, or gone). */
  classNotOpen: "그 반 코드는 지금 열려 있지 않아요. 새 반을 열려면 반 코드를 비워 주세요",
  tooManyAttempts: "시도가 너무 많아요. 1분 뒤에 다시 해 주세요",
  classesFull: "지금은 반을 더 열 수 없어요. 잠시 뒤에 다시 해 주세요",
  openFailed: "반을 열지 못했어요. 잠시 뒤에 다시 해 주세요",
  wrongOperatorKey: "운영자 키가 올바르지 않아요",
  serverError: "서버에 문제가 생겼어요. 잠시 뒤에 다시 해 주세요",
} as const;

/** Longest key / operator code accepted in a body (keys are 19 symbols). */
const MAX_SECRET_LENGTH = 256;
/** Request-body cap for the class API. */
const API_JSON_LIMIT = "4kb";
/** Memory backstop for the per-client failure limiter (same idea as /api/npc-chat). */
const LIMITER_MAX_CLIENTS = 5000;
/**
 * How long a request waits for someone else's creation of the same class before it gives
 * up with 503 (a hung matchmaker must not pin teacher requests forever).
 */
export const CREATION_WAIT_MS = 10_000;
/**
 * How long the request that creates a class waits for its room before it gives up with 500 and frees
 * its reservation — and with it a CV_MAX_CLASSES slot: a creation that never settles must hold
 * neither forever (final fix B2). Longer than CREATION_WAIT_MS, so a colleague waiting on the same
 * creation gives up first.
 */
export const CREATION_TIMEOUT_MS = 2 * CREATION_WAIT_MS;

export interface ApiResult {
  status: number;
  body: Record<string, unknown>;
}

export interface TeacherOpenDeps {
  registry: ClassRegistry;
  keys: () => TeacherKeyEntry[];
  operatorCode: () => string | undefined;
  createClassRoom: (opts: ClassCreateOptions) => Promise<{ roomId: string }>;
  limiter: AdminAttemptLimiter;
  now: () => number;
}

/** Thrown (and caught right away) when a class room creation outlives CREATION_TIMEOUT_MS. */
const CREATION_TIMED_OUT = "class room creation timed out";

/**
 * `p`, or a rejection after `ms`. The timer never outlives the wait or holds the process open. A late
 * settlement of `p` is ignored here (its own rejection is caught, so it never goes unhandled).
 */
async function withinMs<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(CREATION_TIMED_OUT)), ms);
    (timer as { unref?: () => void }).unref?.();
  });
  p.catch(() => {}); // a creation that fails after the timeout is not an unhandled rejection
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export interface RoomStats {
  phase: string;
  players: number;
  teams: number;
  escapeRooms: number;
}

export interface ProcessStats {
  rssMB: number;
  heapMB: number;
  cpuPct: number;
  eventLoopP95Ms: number;
  uptimeS: number;
}

export interface StatusDeps {
  registry: ClassRegistry;
  operatorCode: () => string | undefined;
  limiter: AdminAttemptLimiter;
  /** Read through `matchMaker.getLocalRoomById`; null when the room is gone. */
  roomStats: (roomId: string) => RoomStats | null;
  processStats: () => ProcessStats;
  /** Clock for the failure limiter; Date.now by default. */
  now?: () => number;
}

const fail = (status: number, error: string): ApiResult => ({ status, body: { error } });

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isSecretString(v: unknown): v is string {
  return typeof v === "string" && v.length <= MAX_SECRET_LENGTH;
}

// ─────────────────────────────── POST /api/class/teacher ───────────────────────────────

interface TeacherOpenRequest {
  teacherKey: string;
  classCode: string | null;
  textLevel: TextLevel;
  /** The client's restart recovery: re-open `classCode` if the server no longer has it. */
  reopen: boolean;
}

/** The validated body, or null when it is malformed (→ 400, not a key failure). */
function parseTeacherBody(body: unknown): TeacherOpenRequest | null {
  if (!isPlainObject(body) || !isSecretString(body.teacherKey)) return null;

  let classCode: string | null = null;
  const rawCode = body.classCode;
  if (rawCode !== undefined && rawCode !== null && !(typeof rawCode === "string" && rawCode.trim() === "")) {
    classCode = normalizeClassCode(rawCode);
    if (classCode === null) return null;
  }

  let textLevel: TextLevel = "easy";
  const rawLevel = body.textLevel;
  if (rawLevel !== undefined && rawLevel !== null) {
    if (rawLevel !== "easy" && rawLevel !== "hard") return null;
    textLevel = rawLevel;
  }

  const rawReopen = body.reopen;
  if (rawReopen !== undefined && rawReopen !== null && typeof rawReopen !== "boolean") return null;
  return { teacherKey: body.teacherKey, classCode, textLevel, reopen: rawReopen === true };
}

/** True when `p` settles within `ms`; the timer never outlives the wait or holds the process open. */
async function settlesWithin(p: Promise<void>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
    (timer as { unref?: () => void }).unref?.();
  });
  try {
    return await Promise.race([p.then(() => true as const), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Room creations in flight, per registry: code → settles (never rejects) when done. */
const creating = new WeakMap<ClassRegistry, Map<string, Promise<void>>>();
function creationsOf(registry: ClassRegistry): Map<string, Promise<void>> {
  let map = creating.get(registry);
  if (!map) {
    map = new Map();
    creating.set(registry, map);
  }
  return map;
}

/**
 * Open a class or hand out a pass for one:
 *
 * | case | answer |
 * |---|---|
 * | right key, no `classCode` | new class → 200 `{ classCode, pass }` |
 * | `classCode`'s class is live and `canTeach` (the opener, a colleague of the group, the operator) | pass for THAT class → 200, no new room |
 * | `classCode` names no live class (never opened, ended, gone) | 404, nothing opened |
 * | the same with `reopen: true` and the code unknown (the server restarted mid-lesson) | re-open that code → 200 |
 * | the class belongs to another teacher/group | 409 |
 * | wrong key | 401, failure recorded |
 * | 5 failures per IP per minute | 429 |
 * | class cap reached | 503 |
 * | the class is still being created by another request for > CREATION_WAIT_MS | 503 |
 * | the room creation fails, or does not finish within CREATION_TIMEOUT_MS | 500, the code and the slot freed |
 * | malformed body | 400 |
 *
 * The key is checked before anything about classes is revealed, so without a key nobody
 * can probe which class codes exist.
 */
export async function handleTeacherOpen(body: unknown, ip: string, deps: TeacherOpenDeps): Promise<ApiResult> {
  if (deps.limiter.isBlocked(ip, deps.now())) return fail(429, CLASS_API_ERRORS.tooManyAttempts);

  const request = parseTeacherBody(body);
  if (!request) return fail(400, CLASS_API_ERRORS.badRequest);

  const key = verifyTeacherKey(request.teacherKey, deps.keys(), deps.operatorCode());
  if (!key) {
    deps.limiter.recordFailure(ip, deps.now());
    return fail(401, CLASS_API_ERRORS.wrongTeacherKey);
  }

  if (request.classCode === null) {
    const code = generateClassCode((c) => deps.registry.get(c) !== undefined);
    return openOrJoin(code, key, request.textLevel, true, deps);
  }
  return openOrJoin(request.classCode, key, request.textLevel, request.reopen, deps);
}

/**
 * A pass for the class `code`. `mayCreate`: open it when the server does not have it (a new
 * class, or the restart recovery's re-open); otherwise a code with no live class is refused (404).
 * A class that has ended is never re-entered.
 */
async function openOrJoin(
  code: string,
  key: VerifiedKey,
  textLevel: TextLevel,
  mayCreate: boolean,
  deps: TeacherOpenDeps,
): Promise<ApiResult> {
  const inFlight = creationsOf(deps.registry);
  // A few rounds: waiting on someone else's creation can end in that creation failing,
  // after which this request re-opens the class itself.
  for (let round = 0; round < 3; round++) {
    const existing = deps.registry.get(code);
    if (existing) {
      if (existing.ended) return fail(404, CLASS_API_ERRORS.classNotOpen);
      if (!canTeach(key, existing.opener)) return fail(409, CLASS_API_ERRORS.otherTeacher);
      const pending = inFlight.get(code);
      if (pending) {
        // Double click or two teachers at once: one room, and the second pass is handed
        // out only once that room exists (else the client's join could beat it) — but
        // never wait longer than CREATION_WAIT_MS.
        if (!(await settlesWithin(pending, CREATION_WAIT_MS))) return fail(503, CLASS_API_ERRORS.openFailed);
        continue;
      }
      return { status: 200, body: { classCode: code, pass: deps.registry.issuePass(code, key, deps.now()) } };
    }
    // Re-entering by code must never open a class silently (a typo, yesterday's code).
    if (!mayCreate) return fail(404, CLASS_API_ERRORS.classNotOpen);

    const opener = { id: key.id, group: key.group, label: key.label };
    const reserved = deps.registry.reserve({ code, opener, textLevel, openedAt: deps.now() });
    if (reserved === "full") return fail(503, CLASS_API_ERRORS.classesFull);
    if (reserved === "taken") continue; // not reachable (checked synchronously above); re-evaluate

    // Our reservation (the entry object itself): after the await we only ever touch the entry
    // if it is still this one — never a newer reservation of the same code.
    const mine = deps.registry.get(code);
    let settle: () => void = () => {};
    const marker = new Promise<void>((resolve) => (settle = resolve));
    inFlight.set(code, marker);
    let roomId: string;
    try {
      ({ roomId } = await withinMs(
        deps.createClassRoom({ spawnToken: SPAWN_TOKEN, classCode: code, textLevel, opener }),
        CREATION_TIMEOUT_MS,
      ));
      // The ClassRoom attaches itself in onCreate; this fills the entry when the room factory is
      // a stand-in (tests) and is a no-op otherwise.
      if (deps.registry.get(code) === mine) deps.registry.attach(code, roomId);
    } catch {
      // A failure or a timeout. Frees our reservation only: if a live room holds the code, its entry is
      // not ours (roomId ≠ null). (A room that still appears after a timeout registers itself and, with
      // nobody in it, closes after CLASS_EMPTY_CLOSE_MS like any empty class.)
      if (deps.registry.get(code) === mine) deps.registry.release(code, null);
      // Fixed text only: a matchmaker error can carry the create options as JSON.
      console.error("[caysonverse] class room creation failed");
      return fail(500, CLASS_API_ERRORS.openFailed);
    } finally {
      // Clear the marker only if it is still ours; a newer creation's marker stays.
      if (inFlight.get(code) === marker) inFlight.delete(code);
      settle();
    }
    // The room may already have closed again (released) before we answer.
    if (deps.registry.get(code)?.roomId !== roomId) return fail(500, CLASS_API_ERRORS.openFailed);
    return { status: 200, body: { classCode: code, pass: deps.registry.issuePass(code, key, deps.now()) } };
  }
  return fail(500, CLASS_API_ERRORS.openFailed);
}

// ─────────────────────────────── POST /api/operator/status ───────────────────────────────

/**
 * The operator's status JSON. Requires the operator key (ADMIN_CODE); shares the
 * failure limiter with the teacher route. Carries class codes, labels and counts only —
 * never a pass, a key, a hash or an opener id/group.
 */
export function handleOperatorStatus(body: unknown, ip: string, deps: StatusDeps): ApiResult {
  const now = deps.now ?? Date.now;
  if (deps.limiter.isBlocked(ip, now())) return fail(429, CLASS_API_ERRORS.tooManyAttempts);

  if (!isPlainObject(body) || !isSecretString(body.operatorKey)) return fail(400, CLASS_API_ERRORS.badRequest);
  if (!compareAdminCode(body.operatorKey.trim(), deps.operatorCode()?.trim())) {
    deps.limiter.recordFailure(ip, now());
    return fail(401, CLASS_API_ERRORS.wrongOperatorKey);
  }

  const classes = deps.registry.list().map((entry) => {
    const stats = entry.roomId === null ? null : deps.roomStats(entry.roomId);
    const phase = entry.roomId === null ? "opening" : (stats?.phase ?? "missing");
    return {
      code: entry.code,
      label: entry.opener.label,
      phase,
      players: stats?.players ?? 0,
      teams: stats?.teams ?? 0,
      escapeRooms: stats?.escapeRooms ?? 0,
    };
  });
  const totals = {
    classes: classes.length,
    players: classes.reduce((sum, c) => sum + c.players, 0),
    escapeRooms: classes.reduce((sum, c) => sum + c.escapeRooms, 0),
  };
  return { status: 200, body: { classes, totals, process: deps.processStats() } };
}

/**
 * Live numbers of one ClassRoom instance (`matchMaker.getLocalRoomById`), read
 * defensively: `state.phase`, connected clients, `state.teams` and the distinct non-empty
 * `escapeRoomId`s of those teams. Null when the room is gone.
 */
export function readRoomStats(room: unknown): RoomStats | null {
  if (typeof room !== "object" || room === null) return null;
  const r = room as { clients?: { length?: unknown }; state?: { phase?: unknown; teams?: unknown } | null };
  const players = typeof r.clients?.length === "number" ? r.clients.length : 0;
  const state = r.state ?? {};
  const phase = typeof state.phase === "string" ? state.phase : "unknown";
  let teams = 0;
  const escapeRoomIds = new Set<string>();
  const teamMap = state.teams as { forEach?: (cb: (team: unknown) => void) => void } | undefined;
  if (teamMap && typeof teamMap.forEach === "function") {
    teamMap.forEach((team) => {
      teams++;
      const id = (team as { escapeRoomId?: unknown } | null)?.escapeRoomId;
      if (typeof id === "string" && id !== "") escapeRoomIds.add(id);
    });
  }
  return { phase, players, teams, escapeRooms: escapeRoomIds.size };
}

const MB = 1024 * 1024;
const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * A process-stats reader. `cpuPct` is the process CPU time (user + system) since the
 * previous read divided by the wall time since then (can exceed 100 with several
 * threads); `eventLoopP95Ms` is the p95 event-loop delay since the previous read
 * (perf_hooks.monitorEventLoopDelay, reset on every read).
 */
export function createProcessStats(): () => ProcessStats {
  const loop = monitorEventLoopDelay({ resolution: 20 });
  loop.enable();
  let lastCpu = process.cpuUsage();
  let lastAt = process.hrtime.bigint();
  return () => {
    const cpu = process.cpuUsage();
    const at = process.hrtime.bigint();
    const cpuUs = cpu.user - lastCpu.user + (cpu.system - lastCpu.system);
    const wallUs = Number(at - lastAt) / 1000;
    lastCpu = cpu;
    lastAt = at;
    const p95Ms = loop.percentile(95) / 1e6;
    loop.reset();
    const mem = process.memoryUsage();
    return {
      rssMB: round1(mem.rss / MB),
      heapMB: round1(mem.heapUsed / MB),
      cpuPct: wallUs > 0 ? round1(Math.max(0, (cpuUs / wallUs) * 100)) : 0,
      eventLoopP95Ms: Number.isFinite(p95Ms) ? round1(Math.max(0, p95Ms)) : 0,
      uptimeS: Math.round(process.uptime()),
    };
  };
}

// ─────────────────────────────────────── Express ───────────────────────────────────────

/**
 * The production room factory: a ClassRoom through the matchmaker (Task 5). The options carry
 * the spawn token, so this is the only way a class comes to exist; never log what it throws
 * (a matchmaker error can quote the options).
 */
export async function createClassRoom(opts: ClassCreateOptions): Promise<{ roomId: string }> {
  const room = await matchMaker.createRoom(CLASS_ROOM, opts);
  return { roomId: room.roomId };
}

/** Test seams for `mountClassApi`; production uses the defaults. */
export type ClassApiOverrides = Partial<
  Pick<TeacherOpenDeps, "registry" | "keys" | "operatorCode" | "createClassRoom" | "now"> &
    Pick<StatusDeps, "roomStats" | "processStats">
>;

/** The client IP for the failure limiter — the same trusted-proxy model as /api/npc-chat. */
function clientIpOf(req: Request): string {
  return resolveClientIp({ ip: req.headers["x-forwarded-for"] } as never) ?? req.socket.remoteAddress ?? "unknown";
}

/**
 * Error middleware for `/api/*`. Body-parser errors (invalid JSON, too large, bad charset)
 * → 400; anything else → 500 with a fixed log line. Never logs the error itself: Node's
 * JSON error messages quote the body, which may contain a key.
 */
function apiErrorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  const e = err as { status?: unknown; statusCode?: unknown } | null;
  const status = typeof e?.status === "number" ? e.status : typeof e?.statusCode === "number" ? e.statusCode : 500;
  res.setHeader("cache-control", "no-store");
  if (status >= 400 && status < 500) {
    res.status(400).json({ error: CLASS_API_ERRORS.badRequest });
    return;
  }
  console.error("[caysonverse] /api request failed");
  res.status(500).json({ error: CLASS_API_ERRORS.serverError });
}

/**
 * Mount `POST /api/class/teacher`, `POST /api/operator/status` and the `/api` error
 * middleware. Call it after the other `/api` routes (so their body-parser errors are
 * answered here too) and before the SPA fallback. Takes `Application` (what Colyseus's
 * `defineServer({ express })` callback receives); an `Express` app is one too.
 */
export function mountClassApi(app: Application, overrides: ClassApiOverrides = {}): void {
  const registry = overrides.registry ?? classRegistry;
  const keys = overrides.keys ?? (() => loadTeacherKeys());
  const operatorCode = overrides.operatorCode ?? (() => process.env.ADMIN_CODE);
  const now = overrides.now ?? Date.now;
  const createRoom = overrides.createClassRoom ?? createClassRoom;
  const roomStats = overrides.roomStats ?? ((roomId: string) => readRoomStats(matchMaker.getLocalRoomById(roomId)));
  const processStats = overrides.processStats ?? createProcessStats();

  // ONE failure limiter for both routes: ADMIN_CODE is accepted by both, so their
  // failures must add up. Past LIMITER_MAX_CLIENTS distinct clients it starts afresh
  // (drop-all, like the npc-chat limiter map) so it cannot grow without bound.
  let limiter = new AdminAttemptLimiter();
  const clientsSeen = new Set<string>();
  const limiterFor = (ip: string): AdminAttemptLimiter => {
    if (!clientsSeen.has(ip)) {
      if (clientsSeen.size >= LIMITER_MAX_CLIENTS) {
        clientsSeen.clear();
        limiter = new AdminAttemptLimiter();
      }
      clientsSeen.add(ip);
    }
    return limiter;
  };

  const json = express.json({ limit: API_JSON_LIMIT });

  app.post("/api/class/teacher", json, async (req, res) => {
    const ip = clientIpOf(req);
    const result = await handleTeacherOpen(req.body, ip, {
      registry,
      keys,
      operatorCode,
      createClassRoom: createRoom,
      limiter: limiterFor(ip),
      now,
    });
    res.setHeader("cache-control", "no-store");
    res.status(result.status).json(result.body);
  });

  app.post("/api/operator/status", json, (req, res) => {
    const ip = clientIpOf(req);
    const result = handleOperatorStatus(req.body, ip, {
      registry,
      operatorCode,
      limiter: limiterFor(ip),
      roomStats,
      processStats,
      now,
    });
    res.setHeader("cache-control", "no-store");
    res.status(result.status).json(result.body);
  });

  app.use("/api", apiErrorHandler);
}

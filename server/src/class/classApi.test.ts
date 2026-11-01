import { describe, it, expect, afterEach, vi } from "vitest";
import { format } from "node:util";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { normalizeClassCode } from "@caysonverse/shared/escape/classCode";
import { AdminAttemptLimiter, ADMIN_ATTEMPT_WINDOW_MS } from "../rooms/adminAuth";
import { SPAWN_TOKEN } from "../rooms/spawnToken";
import { hashKey, type TeacherKeyEntry } from "./teacherKeys";
import { ClassRegistry, type ClassCreateOptions } from "./classRegistry";
import {
  handleTeacherOpen,
  handleOperatorStatus,
  mountClassApi,
  readRoomStats,
  createProcessStats,
  CREATION_WAIT_MS,
  type TeacherOpenDeps,
  type StatusDeps,
} from "./classApi";

// Throwaway test values only — never a real key or ADMIN_CODE.
const KEY = "K7QX-2MPA-9TRW-4HEZ"; // t1, group saebit
const KEY_T2 = "M3NP-8QRS-5TUV-6WXY"; // t2, group saebit (colleague)
const KEY_T3 = "A2BC-3DEF-4GHJ-5KLM"; // t3, group other
const KEY_T4 = "N6PQ-7RST-8UVW-9XYZ"; // t4, no group
const WRONG = "WR0N-GKEY-0000-0000";
const OPERATOR = "op-s3cret";
const ENTRIES: TeacherKeyEntry[] = [
  { id: "t1", label: "새빛초 4-2", group: "saebit", sha256: hashKey(KEY) },
  { id: "t2", label: "새빛초 4-3", group: "saebit", sha256: hashKey(KEY_T2) },
  { id: "t3", label: "한빛초 5-1", group: "other", sha256: hashKey(KEY_T3) },
  { id: "t4", label: "혼자 반", sha256: hashKey(KEY_T4) },
];
const ALL_SECRETS = [KEY, KEY_T2, KEY_T3, KEY_T4, OPERATOR, SPAWN_TOKEN, ...ENTRIES.map((e) => e.sha256)];

const ERR = {
  bad: "요청이 올바르지 않아요",
  wrongKey: "선생님 키가 올바르지 않아요",
  otherGroup: "이 반 코드는 다른 선생님이 쓰고 있어요",
  tooMany: "시도가 너무 많아요. 1분 뒤에 다시 해 주세요",
  full: "지금은 반을 더 열 수 없어요. 잠시 뒤에 다시 해 주세요",
  wrongOperator: "운영자 키가 올바르지 않아요",
};

const IP = "203.0.113.9";
const OTHER_IP = "198.51.100.7";

function setup(opts: { cap?: number; operator?: string | undefined } = {}) {
  const registry = new ClassRegistry(opts.cap ?? 10);
  const created: ClassCreateOptions[] = [];
  let now = 1_000_000;
  const deps: TeacherOpenDeps = {
    registry,
    keys: () => ENTRIES,
    operatorCode: () => ("operator" in opts ? opts.operator : OPERATOR),
    createClassRoom: async (o) => {
      created.push(o);
      return { roomId: `room-${created.length}` };
    },
    limiter: new AdminAttemptLimiter(),
    now: () => now,
  };
  return {
    deps,
    registry,
    created,
    advance: (ms: number) => {
      now += ms;
    },
    at: () => now,
  };
}

/** Swallow and record everything written to the console or the process streams. */
function captureConsole() {
  const out: string[] = [];
  const record = (...args: unknown[]) => {
    out.push(format(...args));
  };
  const spies = [
    vi.spyOn(console, "log").mockImplementation(record),
    vi.spyOn(console, "info").mockImplementation(record),
    vi.spyOn(console, "warn").mockImplementation(record),
    vi.spyOn(console, "error").mockImplementation(record),
    vi.spyOn(console, "debug").mockImplementation(record),
    vi.spyOn(console, "trace").mockImplementation(record),
    vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
      out.push(String(chunk));
      return true;
    }) as never),
    vi.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => {
      out.push(String(chunk));
      return true;
    }) as never),
  ];
  return {
    text: () => out.join("\n"),
    count: () => out.length,
    restore: () => spies.forEach((s) => s.mockRestore()),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("handleTeacherOpen", () => {
  it("handleTeacherOpen: new class → 200 {classCode, pass}; createClassRoom got spawnToken and opener", async () => {
    const { deps, registry, created, at } = setup();
    const res = await handleTeacherOpen({ teacherKey: KEY, textLevel: "hard" }, IP, deps);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(["classCode", "pass"]);
    const code = res.body.classCode as string;
    expect(normalizeClassCode(code)).toBe(code);
    expect(res.body.pass).toMatch(/^[A-Za-z0-9_-]{43}$/);

    expect(created).toEqual([
      {
        spawnToken: SPAWN_TOKEN,
        classCode: code,
        textLevel: "hard",
        opener: { id: "t1", group: "saebit", label: "새빛초 4-2" },
      },
    ]);
    expect(registry.get(code)).toEqual({
      code,
      roomId: "room-1",
      opener: { id: "t1", group: "saebit", label: "새빛초 4-2" },
      textLevel: "hard",
      openedAt: at(),
    });
    // The pass admits this teacher to this class, once.
    expect(registry.consumePass(res.body.pass, code, at())?.id).toBe("t1");
    expect(registry.consumePass(res.body.pass, code, at())).toBeNull();

    // textLevel defaults to "easy"; every new class gets a different code.
    const res2 = await handleTeacherOpen({ teacherKey: KEY }, IP, deps);
    expect(res2.status).toBe(200);
    expect(res2.body.classCode).not.toBe(code);
    expect(created[1].textLevel).toBe("easy");
    // The operator key opens classes too, as the operator.
    const res3 = await handleTeacherOpen({ teacherKey: OPERATOR }, IP, deps);
    expect(res3.status).toBe(200);
    expect(created[2].opener).toEqual({ id: "operator", group: "*", label: "운영자" });
  });

  it("re-opening with the same classCode returns a pass for the existing class (same group) and re-creates it after a restart (Review Focus 5)", async () => {
    const { deps, registry, created, at } = setup();
    const first = await handleTeacherOpen({ teacherKey: KEY }, IP, deps);
    const code = first.body.classCode as string;

    // Same teacher, a colleague of the same group, the operator: a fresh pass, no new room.
    for (const [teacherKey, id] of [
      [KEY, "t1"],
      [KEY_T2, "t2"],
      [OPERATOR, "operator"],
    ] as const) {
      const again = await handleTeacherOpen({ teacherKey, classCode: code, textLevel: "hard" }, IP, deps);
      expect(again.status).toBe(200);
      expect(again.body.classCode).toBe(code);
      expect(again.body.pass).not.toBe(first.body.pass);
      expect(registry.consumePass(again.body.pass, code, at())?.id).toBe(id);
    }
    expect(created).toHaveLength(1);
    expect(registry.get(code)?.textLevel).toBe("easy"); // the running class keeps its level

    // Lower-case and padded input is the same class.
    const typed = await handleTeacherOpen({ teacherKey: KEY, classCode: ` ${code.toLowerCase()} ` }, IP, deps);
    expect(typed.status).toBe(200);
    expect(typed.body.classCode).toBe(code);
    expect(created).toHaveLength(1);

    // Server restart: the registry is empty, so the same code is opened again (progress starts over).
    const restarted = setup();
    const reopened = await handleTeacherOpen(
      { teacherKey: KEY_T2, classCode: code, textLevel: "hard" },
      IP,
      restarted.deps,
    );
    expect(reopened.status).toBe(200);
    expect(reopened.body.classCode).toBe(code);
    expect(restarted.created).toEqual([
      {
        spawnToken: SPAWN_TOKEN,
        classCode: code,
        textLevel: "hard",
        opener: { id: "t2", group: "saebit", label: "새빛초 4-3" },
      },
    ]);
    expect(restarted.registry.get(code)?.roomId).toBe("room-1");
    expect(restarted.registry.consumePass(reopened.body.pass, code, restarted.at())?.id).toBe("t2");
  });

  it("409 other group, 401 wrong key, 429 after 5 failures per IP per minute, 503 at the cap", async () => {
    // 409: a teacher of another group, or a group-less teacher who is not the opener.
    {
      const { deps, created } = setup();
      const code = (await handleTeacherOpen({ teacherKey: KEY }, IP, deps)).body.classCode;
      for (const teacherKey of [KEY_T3, KEY_T4]) {
        const res = await handleTeacherOpen({ teacherKey, classCode: code }, IP, deps);
        expect(res).toEqual({ status: 409, body: { error: ERR.otherGroup } });
      }
      expect(created).toHaveLength(1);
      // A valid key on the wrong class is not a failed key attempt.
      expect(deps.limiter.isBlocked(IP, deps.now())).toBe(false);
    }

    // 401: a wrong key, also when it names an existing class (no probing of class codes).
    {
      const { deps, created } = setup();
      const code = (await handleTeacherOpen({ teacherKey: KEY }, IP, deps)).body.classCode;
      expect(await handleTeacherOpen({ teacherKey: WRONG }, IP, deps)).toEqual({
        status: 401,
        body: { error: ERR.wrongKey },
      });
      expect(await handleTeacherOpen({ teacherKey: WRONG, classCode: code }, IP, deps)).toEqual({
        status: 401,
        body: { error: ERR.wrongKey },
      });
      expect(await handleTeacherOpen({ teacherKey: "" }, IP, deps)).toEqual({
        status: 401,
        body: { error: ERR.wrongKey },
      });
      expect(created).toHaveLength(1);
    }

    // 429: five failures per IP within a minute block that IP — even for the right key.
    {
      const { deps, advance } = setup();
      for (let i = 0; i < 5; i++) {
        expect((await handleTeacherOpen({ teacherKey: WRONG }, IP, deps)).status).toBe(401);
        advance(1000);
      }
      expect(await handleTeacherOpen({ teacherKey: KEY }, IP, deps)).toEqual({
        status: 429,
        body: { error: ERR.tooMany },
      });
      expect(await handleTeacherOpen({ teacherKey: WRONG }, IP, deps)).toEqual({
        status: 429,
        body: { error: ERR.tooMany },
      });
      // Another IP is unaffected.
      expect((await handleTeacherOpen({ teacherKey: KEY }, OTHER_IP, deps)).status).toBe(200);
      // A minute after the failures the IP is free again.
      advance(ADMIN_ATTEMPT_WINDOW_MS);
      expect((await handleTeacherOpen({ teacherKey: KEY }, IP, deps)).status).toBe(200);
    }

    // 503: the class cap is reached — for a new code and for re-opening an unknown code.
    {
      const { deps, created } = setup({ cap: 2 });
      expect((await handleTeacherOpen({ teacherKey: KEY }, IP, deps)).status).toBe(200);
      const second = await handleTeacherOpen({ teacherKey: KEY }, IP, deps);
      expect(second.status).toBe(200);
      expect(await handleTeacherOpen({ teacherKey: KEY }, IP, deps)).toEqual({
        status: 503,
        body: { error: ERR.full },
      });
      expect(await handleTeacherOpen({ teacherKey: KEY, classCode: "ZZ3ZZZ" }, IP, deps)).toEqual({
        status: 503,
        body: { error: ERR.full },
      });
      expect(created).toHaveLength(2);
      // An existing class still hands out passes at the cap.
      expect(
        (await handleTeacherOpen({ teacherKey: KEY, classCode: second.body.classCode }, IP, deps)).status,
      ).toBe(200);
    }
  });

  it("400 for malformed bodies, which never count as key failures", async () => {
    const { deps, created } = setup();
    const bodies: unknown[] = [
      undefined,
      null,
      "K7QX-2MPA-9TRW-4HEZ",
      42,
      [],
      [KEY],
      {},
      { teacherKey: 5 },
      { teacherKey: null },
      { teacherKey: [KEY] },
      { teacherKey: "x".repeat(300) },
      { teacherKey: KEY, classCode: "0OOOOO" }, // look-alikes are not class codes
      { teacherKey: KEY, classCode: "AB2CD" },
      { teacherKey: KEY, classCode: 123456 },
      { teacherKey: KEY, textLevel: "medium" },
      { teacherKey: KEY, textLevel: 1 },
    ];
    for (const body of bodies) {
      expect(await handleTeacherOpen(body, IP, deps)).toEqual({ status: 400, body: { error: ERR.bad } });
    }
    expect(created).toHaveLength(0);
    // 16 malformed requests, yet the IP is not blocked.
    expect((await handleTeacherOpen({ teacherKey: KEY }, IP, deps)).status).toBe(200);
    // An empty classCode / null textLevel mean "not given".
    expect((await handleTeacherOpen({ teacherKey: KEY, classCode: "" }, IP, deps)).status).toBe(200);
    expect((await handleTeacherOpen({ teacherKey: KEY, classCode: null, textLevel: null }, IP, deps)).status).toBe(
      200,
    );
  });

  it("a failed room creation answers 500 with a fixed log line and frees the code", async () => {
    const { deps, registry } = setup();
    deps.createClassRoom = async (o) => {
      // Colyseus errors can carry the create options as JSON — this one does on purpose.
      throw new Error(`room "class" failed with ${JSON.stringify(o)} key=${KEY}`);
    };
    const cap = captureConsole();
    const res = await handleTeacherOpen({ teacherKey: KEY, classCode: "AB2CDE" }, IP, deps).finally(cap.restore);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "반을 열지 못했어요. 잠시 뒤에 다시 해 주세요" });
    expect(registry.get("AB2CDE")).toBeUndefined();
    expect(cap.count()).toBe(1);
    expect(cap.text()).toContain("class room creation failed");
    for (const secret of ALL_SECRETS) expect(cap.text()).not.toContain(secret);
    expect(cap.text()).not.toContain("failed with");

    // The code is free again: the next attempt opens it.
    deps.createClassRoom = async () => ({ roomId: "room-ok" });
    expect((await handleTeacherOpen({ teacherKey: KEY, classCode: "AB2CDE" }, IP, deps)).status).toBe(200);
    expect(registry.get("AB2CDE")?.roomId).toBe("room-ok");
  });

  it("two opens of the same classCode at once create exactly one room (double click / two teachers)", async () => {
    const { deps, registry, created } = setup();
    let finish: (v: { roomId: string }) => void = () => {};
    deps.createClassRoom = (o) => {
      created.push(o);
      return new Promise((resolve) => {
        finish = resolve;
      });
    };
    const a = handleTeacherOpen({ teacherKey: KEY, classCode: "AB2CDE" }, IP, deps);
    const b = handleTeacherOpen({ teacherKey: KEY_T2, classCode: "AB2CDE" }, OTHER_IP, deps);
    const c = handleTeacherOpen({ teacherKey: KEY_T3, classCode: "AB2CDE" }, OTHER_IP, deps);
    await new Promise((r) => setTimeout(r, 10));
    expect(created).toHaveLength(1);
    // The colleague's pass waits for the room instead of racing ahead of it.
    expect(registry.get("AB2CDE")?.roomId).toBeNull();
    finish({ roomId: "room-x" });
    const [ra, rb, rc] = await Promise.all([a, b, c]);
    expect(ra.status).toBe(200);
    expect(rb.status).toBe(200);
    expect(rc).toEqual({ status: 409, body: { error: ERR.otherGroup } });
    expect(ra.body.classCode).toBe("AB2CDE");
    expect(rb.body.classCode).toBe("AB2CDE");
    expect(created).toHaveLength(1);
    expect(registry.get("AB2CDE")?.roomId).toBe("room-x");
    expect(registry.consumePass(rb.body.pass, "AB2CDE", deps.now())?.id).toBe("t2");
  });

  it("a waiting colleague re-opens the class itself when the first creation fails", async () => {
    const { deps, registry, created } = setup();
    let fail: (e: Error) => void = () => {};
    deps.createClassRoom = (o) => {
      created.push(o);
      if (created.length === 1) {
        return new Promise((_resolve, reject) => {
          fail = reject;
        });
      }
      return Promise.resolve({ roomId: "room-second" });
    };
    const cap = captureConsole();
    try {
      const a = handleTeacherOpen({ teacherKey: KEY, classCode: "AB2CDE" }, IP, deps);
      const b = handleTeacherOpen({ teacherKey: KEY_T2, classCode: "AB2CDE" }, IP, deps);
      await new Promise((r) => setTimeout(r, 10));
      fail(new Error("boom"));
      const [ra, rb] = await Promise.all([a, b]);
      expect(ra.status).toBe(500);
      expect(rb.status).toBe(200);
      expect(created).toHaveLength(2);
      expect(created[1].opener.id).toBe("t2");
      expect(registry.get("AB2CDE")?.roomId).toBe("room-second");
    } finally {
      cap.restore();
    }
  });

  it("a waiter gives up after CREATION_WAIT_MS with 503 instead of hanging (fix round 1)", async () => {
    expect(CREATION_WAIT_MS).toBe(10_000);
    vi.useFakeTimers();
    try {
      const { deps, registry, created } = setup();
      let finish: (v: { roomId: string }) => void = () => {};
      deps.createClassRoom = (o) => {
        created.push(o);
        return new Promise((resolve) => {
          finish = resolve;
        });
      };
      const a = handleTeacherOpen({ teacherKey: KEY, classCode: "AB2CDE" }, IP, deps);
      let bResult: unknown = null;
      const b = handleTeacherOpen({ teacherKey: KEY_T2, classCode: "AB2CDE" }, OTHER_IP, deps).then((r) => {
        bResult = r;
        return r;
      });
      await vi.advanceTimersByTimeAsync(CREATION_WAIT_MS - 1);
      expect(bResult).toBeNull(); // still waiting for the colleague's room
      await vi.advanceTimersByTimeAsync(1);
      expect(await b).toEqual({ status: 503, body: { error: "반을 열지 못했어요. 잠시 뒤에 다시 해 주세요" } });
      // The slow creation still completes for its own request; a later request gets a pass at once.
      finish({ roomId: "room-slow" });
      expect((await a).status).toBe(200);
      expect(registry.get("AB2CDE")?.roomId).toBe("room-slow");
      const c = await handleTeacherOpen({ teacherKey: KEY_T2, classCode: "AB2CDE" }, OTHER_IP, deps);
      expect(c.status).toBe(200);
      expect(created).toHaveLength(1);
      // A timed-out wait is not a key failure.
      expect(deps.limiter.isBlocked(OTHER_IP, deps.now())).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a finished creation clears only its OWN in-flight marker and fills only its own reservation (fix round 1)", async () => {
    const { deps, registry, created } = setup();
    const finishers: ((v: { roomId: string }) => void)[] = [];
    deps.createClassRoom = (o) => {
      created.push(o);
      return new Promise((resolve) => finishers.push(resolve));
    };
    const tick = () => new Promise((r) => setTimeout(r, 5));

    // A starts creating AB2CDE …
    const a = handleTeacherOpen({ teacherKey: KEY, classCode: "AB2CDE" }, IP, deps);
    await tick();
    // … its reservation disappears (stand-in for anything freeing it) and C opens the code anew.
    registry.release("AB2CDE", null);
    const c = handleTeacherOpen({ teacherKey: KEY_T2, classCode: "AB2CDE" }, IP, deps);
    await tick();
    expect(created).toHaveLength(2);

    // A finishes first: it must neither clear C's marker nor attach its room to C's reservation.
    finishers[0]({ roomId: "room-a" });
    expect(await a).toEqual({ status: 500, body: { error: "반을 열지 못했어요. 잠시 뒤에 다시 해 주세요" } });
    expect(registry.get("AB2CDE")?.roomId).toBeNull();

    // D (a colleague) still waits for C's room instead of getting a pass for a room that doesn't exist.
    let dDone = false;
    const d = handleTeacherOpen({ teacherKey: KEY, classCode: "AB2CDE" }, IP, deps).then((r) => {
      dDone = true;
      return r;
    });
    await tick();
    expect(dDone).toBe(false);

    finishers[1]({ roomId: "room-c" });
    expect((await c).status).toBe(200);
    expect((await d).status).toBe(200);
    expect(registry.get("AB2CDE")?.roomId).toBe("room-c");
    expect(created).toHaveLength(2);
  });

  it("lower-case, spaced and dash-less keys open classes; wrong spellings still count toward 429 (fix round 1)", async () => {
    const { deps, created } = setup();
    for (const typed of ["k7qx-2mpa-9trw-4hez", "K7QX 2MPA 9TRW 4HEZ", "k7qx2mpa9trw4hez"]) {
      const res = await handleTeacherOpen({ teacherKey: typed }, IP, deps);
      expect(res.status).toBe(200);
    }
    expect(created.map((o) => o.opener.id)).toEqual(["t1", "t1", "t1"]);

    // Five wrong keys — in any spelling — block the IP; then even the right key is 429.
    for (const wrong of ["k7qx-2mpa-9trw-4hex", "K7QX 2MPA 9TRW 4HE", "wr0ngkey00000000", "WR0N-GKEY-0000-0000", " w r 0 n "]) {
      expect((await handleTeacherOpen({ teacherKey: wrong }, IP, deps)).status).toBe(401);
    }
    expect(await handleTeacherOpen({ teacherKey: "k7qx2mpa9trw4hez" }, IP, deps)).toEqual({
      status: 429,
      body: { error: ERR.tooMany },
    });
  });

  it("no teacher-open outcome logs a key, a pass or a hash", async () => {
    const cap = captureConsole();
    const passes: string[] = [];
    try {
      const { deps, advance } = setup({ cap: 1 });
      const ok = await handleTeacherOpen({ teacherKey: ` ${KEY} ` }, IP, deps);
      passes.push(ok.body.pass as string);
      passes.push((await handleTeacherOpen({ teacherKey: KEY_T2, classCode: ok.body.classCode }, IP, deps)).body
        .pass as string);
      await handleTeacherOpen({ teacherKey: KEY_T3, classCode: ok.body.classCode }, IP, deps); // 409
      await handleTeacherOpen({ teacherKey: KEY }, IP, deps); // 503
      await handleTeacherOpen({ teacherKey: KEY, textLevel: "x" }, IP, deps); // 400
      for (let i = 0; i < 6; i++) await handleTeacherOpen({ teacherKey: `${KEY}-${i}` }, IP, deps); // 401 … 429
      advance(1);
    } finally {
      cap.restore();
    }
    expect(passes.every((p) => typeof p === "string" && p.length === 43)).toBe(true);
    // None of these outcomes is an error worth logging.
    expect(cap.count()).toBe(0);
  });
});

describe("handleOperatorStatus", () => {
  const PROCESS = { rssMB: 120.5, heapMB: 60.2, cpuPct: 3.4, eventLoopP95Ms: 11.9, uptimeS: 3600 };

  async function statusSetup(opts: { operator?: string | undefined } = {}) {
    // `"operator" in opts` (not a default parameter): an explicit undefined means "ADMIN_CODE unset".
    const operator = "operator" in opts ? opts.operator : OPERATOR;
    const open = setup({ operator });
    const opened = await handleTeacherOpen({ teacherKey: KEY }, IP, open.deps);
    const stats = new Map([
      ["room-1", { phase: "running", players: 23, teams: 6, escapeRooms: 4 }],
    ]);
    const deps: StatusDeps & { now: () => number } = {
      registry: open.registry,
      operatorCode: () => operator,
      limiter: new AdminAttemptLimiter(),
      roomStats: (roomId) => stats.get(roomId) ?? null,
      processStats: () => PROCESS,
      now: open.deps.now,
    };
    return { deps, open, code: opened.body.classCode as string, pass: opened.body.pass as string };
  }

  it("operator status requires the operator key and never contains pass or sha256 strings", async () => {
    const { deps, open, code, pass } = await statusSetup();
    // A class whose room is not attached yet, and one whose room is gone.
    open.registry.reserve({ code: "ZZ3ZZZ", opener: { id: "t2", group: "saebit", label: "새빛초 4-3" }, textLevel: "easy", openedAt: 1 });
    open.registry.attach("QQ4QQQ", "room-gone", {
      code: "QQ4QQQ",
      opener: { id: "t3", group: "other", label: "한빛초 5-1" },
      textLevel: "hard",
      openedAt: 2,
    });

    for (const operatorKey of [WRONG, KEY, "", " ", `${OPERATOR}x`]) {
      expect(handleOperatorStatus({ operatorKey }, IP, deps)).toEqual({
        status: 401,
        body: { error: ERR.wrongOperator },
      });
    }

    const res = handleOperatorStatus({ operatorKey: ` ${OPERATOR} ` }, OTHER_IP, deps);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      classes: [
        { code, label: "새빛초 4-2", phase: "running", players: 23, teams: 6, escapeRooms: 4 },
        { code: "ZZ3ZZZ", label: "새빛초 4-3", phase: "opening", players: 0, teams: 0, escapeRooms: 0 },
        { code: "QQ4QQQ", label: "한빛초 5-1", phase: "missing", players: 0, teams: 0, escapeRooms: 0 },
      ],
      totals: { classes: 3, players: 23, escapeRooms: 4 },
      process: PROCESS,
    });
    const json = JSON.stringify(res.body);
    expect(json).not.toContain(pass);
    expect(json).not.toContain("sha256");
    expect(json).not.toContain("pass");
    for (const secret of ALL_SECRETS) expect(json).not.toContain(secret);
    // Opener ids and groups stay server-side too: the label is enough for the operator.
    expect(json).not.toContain("saebit");
  });

  it("operator status: 400 for malformed bodies, 429 after 5 failures, unset ADMIN_CODE → always 401", async () => {
    const { deps } = await statusSetup();
    for (const body of [undefined, null, "op-s3cret", [], {}, { operatorKey: 5 }, { operatorKey: "x".repeat(300) }]) {
      expect(handleOperatorStatus(body, IP, deps)).toEqual({ status: 400, body: { error: ERR.bad } });
    }
    for (let i = 0; i < 5; i++) expect(handleOperatorStatus({ operatorKey: WRONG }, IP, deps).status).toBe(401);
    expect(handleOperatorStatus({ operatorKey: OPERATOR }, IP, deps)).toEqual({
      status: 429,
      body: { error: ERR.tooMany },
    });
    expect(handleOperatorStatus({ operatorKey: OPERATOR }, OTHER_IP, deps).status).toBe(200);

    for (const unset of [undefined, ""]) {
      const off = await statusSetup({ operator: unset });
      expect(off.deps.operatorCode()).toBe(unset);
      for (const operatorKey of ["", "undefined", OPERATOR]) {
        expect(handleOperatorStatus({ operatorKey }, OTHER_IP, off.deps).status).toBe(401);
      }
    }
  });
});

describe("room and process stats", () => {
  it("readRoomStats reads phase, players, teams and escape rooms from a live room; null when gone", () => {
    expect(readRoomStats(undefined)).toBeNull();
    const teams = new Map([
      ["a", { escapeRoomId: "esc-1" }],
      ["b", { escapeRoomId: "" }],
      ["c", { escapeRoomId: "esc-2" }],
    ]);
    expect(readRoomStats({ clients: [{}, {}, {}], state: { phase: "running", teams } })).toEqual({
      phase: "running",
      players: 3,
      teams: 3,
      escapeRooms: 2,
    });
    // A room without class state yet (before Task 5) reads as zeros, not a crash.
    expect(readRoomStats({ clients: [], state: {} })).toEqual({
      phase: "unknown",
      players: 0,
      teams: 0,
      escapeRooms: 0,
    });
  });

  it("createProcessStats reports finite, non-negative process numbers", async () => {
    const read = createProcessStats();
    await new Promise((r) => setTimeout(r, 30));
    for (const sample of [read(), read()]) {
      expect(Object.keys(sample).sort()).toEqual(["cpuPct", "eventLoopP95Ms", "heapMB", "rssMB", "uptimeS"]);
      for (const v of Object.values(sample)) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
      }
      expect(sample.rssMB).toBeGreaterThan(0);
      expect(sample.heapMB).toBeGreaterThan(0);
    }
  });
});

describe("HTTP routes (mountClassApi)", () => {
  let server: Server | null = null;
  afterEach(async () => {
    if (server) await new Promise((r) => server!.close(r));
    server = null;
  });

  async function start(overrides: Parameters<typeof mountClassApi>[1]) {
    const app = express();
    // Production-like: Express's default handler would console.error(err.stack) here
    // (it stays silent only when env === "test", which vitest sets).
    app.set("env", "development");
    // Another /api route mounted earlier (like /api/npc-chat) is covered by the same error middleware.
    app.post("/api/other", express.json(), (_req, res) => {
      res.json({ ok: true });
    });
    mountClassApi(app, overrides);
    server = app.listen(0, "127.0.0.1");
    await new Promise((r) => server!.once("listening", r));
    const { port } = server.address() as AddressInfo;
    const post = (route: string, body: string, headers: Record<string, string> = {}) =>
      fetch(`http://127.0.0.1:${port}${route}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body,
      });
    return { post };
  }

  it("malformed JSON carrying a key is answered 400 and nothing reaches console", async () => {
    const { post } = await start({ keys: () => ENTRIES, operatorCode: () => OPERATOR, registry: new ClassRegistry() });
    const cap = captureConsole();
    const answers: { status: number; body: unknown }[] = [];
    try {
      const requests: [string, string, Record<string, string>?][] = [
        ["/api/class/teacher", `{"teacherKey":"${KEY}"`],
        ["/api/class/teacher", `{"teacherKey":"${KEY}",}`],
        ["/api/class/teacher", `{teacherKey:"${KEY}"}`],
        ["/api/class/teacher", `"${KEY}"`], // strict mode: only objects/arrays
        ["/api/class/teacher", `{"teacherKey":"${KEY}","pad":"${"x".repeat(8000)}"}`], // too large
        ["/api/class/teacher", `{"teacherKey":"${KEY}"}`, { "content-type": "application/json; charset=latin9" }],
        ["/api/operator/status", `{"operatorKey":"${OPERATOR}"`],
        ["/api/other", `{"teacherKey":"${KEY}"`],
      ];
      for (const [route, body, headers] of requests) {
        const res = await post(route, body, headers);
        answers.push({ status: res.status, body: await res.json() });
      }
    } finally {
      cap.restore();
    }
    for (const a of answers) expect(a).toEqual({ status: 400, body: { error: ERR.bad } });
    expect(cap.text()).not.toContain(KEY);
    expect(cap.text()).not.toContain(OPERATOR);
    expect(cap.count()).toBe(0);
  });

  it("over HTTP: 200 / 401 / 429 per X-Forwarded-For client, non-JSON bodies → 400, and the key is never logged", async () => {
    const registry = new ClassRegistry();
    const created: ClassCreateOptions[] = [];
    const { post } = await start({
      registry,
      keys: () => ENTRIES,
      operatorCode: () => OPERATOR,
      createClassRoom: async (o) => {
        created.push(o);
        return { roomId: "room-http" };
      },
      roomStats: () => ({ phase: "lobby", players: 1, teams: 0, escapeRooms: 0 }),
    });
    const cap = captureConsole();
    const seen: string[] = [];
    try {
      const ok = await post("/api/class/teacher", JSON.stringify({ teacherKey: KEY, textLevel: "hard" }));
      expect(ok.status).toBe(200);
      const okBody = (await ok.json()) as { classCode: string; pass: string };
      seen.push(okBody.pass);
      expect(registry.get(okBody.classCode)?.roomId).toBe("room-http");
      expect(created[0].spawnToken).toBe(SPAWN_TOKEN);

      // Not JSON at all → 400, not a key failure.
      const plain = await post("/api/class/teacher", KEY, { "content-type": "text/plain" });
      expect(plain.status).toBe(400);

      // The trusted right-most X-Forwarded-For hop is the limiter key.
      for (let i = 0; i < 5; i++) {
        const res = await post("/api/class/teacher", JSON.stringify({ teacherKey: WRONG }), {
          "x-forwarded-for": `10.0.0.${i}, ${IP}`,
        });
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ error: ERR.wrongKey });
      }
      const blocked = await post("/api/class/teacher", JSON.stringify({ teacherKey: KEY }), {
        "x-forwarded-for": IP,
      });
      expect(blocked.status).toBe(429);
      expect(await blocked.json()).toEqual({ error: ERR.tooMany });
      // The same secret space: the blocked client cannot switch to the operator endpoint.
      const blockedStatus = await post("/api/operator/status", JSON.stringify({ operatorKey: OPERATOR }), {
        "x-forwarded-for": IP,
      });
      expect(blockedStatus.status).toBe(429);
      const other = await post("/api/class/teacher", JSON.stringify({ teacherKey: KEY }), {
        "x-forwarded-for": OTHER_IP,
      });
      expect(other.status).toBe(200);
      seen.push(((await other.json()) as { pass: string }).pass);

      const status = await post("/api/operator/status", JSON.stringify({ operatorKey: OPERATOR }), {
        "x-forwarded-for": OTHER_IP,
      });
      expect(status.status).toBe(200);
      const statusBody = (await status.json()) as { classes: { code: string; phase: string }[] };
      expect(statusBody.classes.map((c) => c.phase)).toEqual(["lobby", "lobby"]);
      const text = JSON.stringify(statusBody);
      for (const p of seen) expect(text).not.toContain(p);
    } finally {
      cap.restore();
    }
    for (const secret of [...ALL_SECRETS, ...seen]) expect(cap.text()).not.toContain(secret);
    expect(cap.count()).toBe(0);
  });
});

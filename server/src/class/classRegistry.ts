/**
 * The class registry (반 등록부): every class open in THIS process (single-server design,
 * spec §14 — session-only, nothing is persisted). The teacher HTTP route reserves a code
 * before it creates the ClassRoom; the ClassRoom attaches its roomId in `onCreate` and
 * releases the code in `onDispose`. Both lifecycle calls are tied to the room's id, so a
 * room can only ever fill or free the entry that is its own.
 *
 * It also holds the one-time teacher passes (`teacherPass`): the HTTP route verifies the
 * teacher key and hands out a pass; the ClassRoom consumes it on join. The key itself
 * never travels in Colyseus join options. Passes are kept per class, at most
 * MAX_PASSES_PER_CLASS each (oldest dropped), so memory stays bounded and no call has to
 * sweep every pass of every class.
 */

import { randomBytes } from "node:crypto";
import { MAX_CLASSES_DEFAULT, TEACHER_PASS_TTL_MS, type TextLevel } from "@caysonverse/shared/escape/constants";
import type { VerifiedKey } from "./teacherKeys";

/** Options for `matchMaker.createRoom(CLASS_ROOM, …)`; the ClassRoom (Task 5) receives them. */
export interface ClassCreateOptions {
  spawnToken: string;
  classCode: string;
  textLevel: TextLevel;
  opener: { id: string; group: string; label: string };
}

export interface ClassEntry {
  code: string;
  /** null while the room is being created. */
  roomId: string | null;
  opener: { id: string; group: string; label: string };
  textLevel: TextLevel;
  openedAt: number;
  /**
   * Set by the class's own room when its teacher ended it (`markEnded`): the class only waits out
   * its grace now, so the teacher route hands out no pass for it (a teacher re-entering by code is
   * refused instead of joining a class that is closing).
   */
  ended?: boolean;
}

interface PassRecord {
  code: string;
  key: VerifiedKey;
  expiresAt: number;
}

/**
 * Outstanding (unused, possibly expired) passes kept per class; issuing one more drops the
 * oldest. A teacher needs one pass per "반 열기" click, so 20 is far above real use and
 * only bounds a client that keeps asking.
 */
export const MAX_PASSES_PER_CLASS = 20;

/** `CV_MAX_CLASSES` when it is a positive integer, else MAX_CLASSES_DEFAULT. */
function maxClassesFromEnv(): number {
  const raw = process.env.CV_MAX_CLASSES;
  if (raw === undefined || !/^\d+$/.test(raw.trim())) return MAX_CLASSES_DEFAULT;
  const n = Number(raw.trim());
  return Number.isSafeInteger(n) && n > 0 ? n : MAX_CLASSES_DEFAULT;
}

export class ClassRegistry {
  private readonly classes = new Map<string, ClassEntry>();
  /** pass → record, for O(1) lookup on join. */
  private readonly passes = new Map<string, PassRecord>();
  /** class code → its passes in issue order (a Set keeps insertion order: first = oldest). */
  private readonly passesByClass = new Map<string, Set<string>>();
  private readonly maxClasses: number;

  constructor(maxClasses?: number) {
    this.maxClasses = maxClasses ?? maxClassesFromEnv();
  }

  /** Claim `entry.code` for a class about to be created. */
  reserve(entry: Omit<ClassEntry, "roomId">): "ok" | "taken" | "full" {
    if (this.classes.has(entry.code)) return "taken";
    if (this.classes.size >= this.maxClasses) return "full";
    this.classes.set(entry.code, { ...entry, opener: { ...entry.opener }, roomId: null });
    return "ok";
  }

  /**
   * Record the live room of `code`; true when the entry now carries `roomId`.
   *
   * An entry whose roomId is still null (reserved by the HTTP route) is filled; one that
   * already carries `roomId` stays as it is. An entry held by ANOTHER room is never taken
   * over (→ false): a code belongs to one live room (Task 4 registry hardening). When the
   * code was not reserved (a ClassRoom created directly, e.g. in tests) and `entry` is
   * given, the class is registered here (no cap: the cap is enforced where classes are
   * opened, in `reserve`). Without an entry an unknown code is ignored (→ false) — it was
   * released while its room was being created.
   */
  attach(code: string, roomId: string, entry?: Omit<ClassEntry, "roomId">): boolean {
    const existing = this.classes.get(code);
    if (existing) {
      if (existing.roomId !== null && existing.roomId !== roomId) return false;
      existing.roomId = roomId;
      return true;
    }
    if (!entry) return false;
    this.classes.set(code, { ...entry, opener: { ...entry.opener }, code, roomId });
    return true;
  }

  /**
   * Forget the class and every pass still outstanding for it — but only when the entry
   * belongs to `roomId` (null: a reservation whose room was never attached, the HTTP
   * route's failure path). Anything else is a no-op: Colyseus calls `onDispose` even on a
   * room whose `onCreate` threw, so a refused `create("class", { classCode: <live code> })`
   * must not evict the live class or kill its passes (Task 4 registry hardening).
   */
  release(code: string, roomId: string | null): void {
    const existing = this.classes.get(code);
    if (!existing || existing.roomId !== roomId) return;
    this.classes.delete(code);
    const bucket = this.passesByClass.get(code);
    if (bucket) {
      for (const pass of bucket) this.passes.delete(pass);
      this.passesByClass.delete(code);
    }
  }

  /**
   * The class of `code` has ended (its teacher pressed 수업 끝내기). Only the room that holds the
   * entry may say so (same identity rule as `release`); anything else is a no-op. The entry stays
   * until the room disposes, so the code is not handed to a new class during the grace.
   */
  markEnded(code: string, roomId: string): void {
    const existing = this.classes.get(code);
    if (existing && existing.roomId === roomId) existing.ended = true;
  }

  get(code: string): ClassEntry | undefined {
    return this.classes.get(code);
  }

  /** A snapshot in opening order. */
  list(): readonly ClassEntry[] {
    return [...this.classes.values()];
  }

  /**
   * A one-time teacher pass for `code`: 32 random bytes (base64url), valid for
   * TEACHER_PASS_TTL_MS from `now`. Touches only this class's passes: its expired ones are
   * dropped, then the oldest until there is room under MAX_PASSES_PER_CLASS — O(passes of
   * this class) ≤ 20, never a sweep over every class.
   */
  issuePass(code: string, key: VerifiedKey, now: number): string {
    const held = this.passesByClass.get(code);
    if (held) {
      for (const old of held) {
        const rec = this.passes.get(old);
        if (!rec || now >= rec.expiresAt) this.forgetPass(old, code);
      }
      while (held.size >= MAX_PASSES_PER_CLASS) this.forgetPass(held.values().next().value as string, code);
    }
    // (Re-)fetch: pruning may have dropped an emptied bucket.
    let bucket = this.passesByClass.get(code);
    if (!bucket) {
      bucket = new Set();
      this.passesByClass.set(code, bucket);
    }
    let pass = randomBytes(32).toString("base64url");
    while (this.passes.has(pass)) pass = randomBytes(32).toString("base64url");
    this.passes.set(pass, { code, key: { ...key }, expiresAt: now + TEACHER_PASS_TTL_MS });
    bucket.add(pass);
    return pass;
  }

  /** Passes stored for `code` (expired ones are dropped lazily). For tests and diagnostics. */
  passCount(code: string): number {
    return this.passesByClass.get(code)?.size ?? 0;
  }

  /**
   * The key behind `pass` if it is unused, unexpired and was issued for `code`; the pass
   * is then spent. A pass presented for another class is NOT spent (it is still the
   * teacher's, they may simply have mistyped the code); an expired one is deleted.
   */
  consumePass(pass: unknown, code: string, now: number): VerifiedKey | null {
    if (typeof pass !== "string") return null;
    const rec = this.passes.get(pass);
    if (!rec) return null;
    if (now >= rec.expiresAt) {
      this.forgetPass(pass, rec.code);
      return null;
    }
    if (rec.code !== code) return null;
    this.forgetPass(pass, rec.code);
    return { ...rec.key };
  }

  /** Remove one pass of class `code` from the lookup map and the class's bucket (an emptied bucket goes too). */
  private forgetPass(pass: string, code: string): void {
    this.passes.delete(pass);
    const bucket = this.passesByClass.get(code);
    if (!bucket) return;
    bucket.delete(pass);
    if (bucket.size === 0) this.passesByClass.delete(code);
  }
}

/** The one registry of this server process. */
export const classRegistry = new ClassRegistry();

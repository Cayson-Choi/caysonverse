/**
 * The class registry (반 등록부): every class open in THIS process (single-server design,
 * spec §14 — session-only, nothing is persisted). The teacher HTTP route reserves a code
 * before it creates the ClassRoom; the ClassRoom attaches its roomId in `onCreate` and
 * releases the code in `onDispose`.
 *
 * It also holds the one-time teacher passes (`teacherPass`): the HTTP route verifies the
 * teacher key and hands out a pass; the ClassRoom consumes it on join. The key itself
 * never travels in Colyseus join options.
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
}

interface PassRecord {
  code: string;
  key: VerifiedKey;
  expiresAt: number;
}

/** `CV_MAX_CLASSES` when it is a positive integer, else MAX_CLASSES_DEFAULT. */
function maxClassesFromEnv(): number {
  const raw = process.env.CV_MAX_CLASSES;
  if (raw === undefined || !/^\d+$/.test(raw.trim())) return MAX_CLASSES_DEFAULT;
  const n = Number(raw.trim());
  return Number.isSafeInteger(n) && n > 0 ? n : MAX_CLASSES_DEFAULT;
}

export class ClassRegistry {
  private readonly classes = new Map<string, ClassEntry>();
  private readonly passes = new Map<string, PassRecord>();
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
   * Record the live room of `code`. When the code was not reserved (a ClassRoom created
   * directly, e.g. in tests) and `entry` is given, the class is registered here (no cap:
   * the cap is enforced where classes are opened, in `reserve`). Without an entry an
   * unknown code is ignored — it was released while its room was being created.
   */
  attach(code: string, roomId: string, entry?: Omit<ClassEntry, "roomId">): void {
    const existing = this.classes.get(code);
    if (existing) {
      existing.roomId = roomId;
      return;
    }
    if (entry) this.classes.set(code, { ...entry, opener: { ...entry.opener }, code, roomId });
  }

  /** Forget the class and every pass still outstanding for it. */
  release(code: string): void {
    this.classes.delete(code);
    for (const [pass, rec] of this.passes) {
      if (rec.code === code) this.passes.delete(pass);
    }
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
   * TEACHER_PASS_TTL_MS from `now`.
   */
  issuePass(code: string, key: VerifiedKey, now: number): string {
    this.pruneExpired(now);
    let pass = randomBytes(32).toString("base64url");
    while (this.passes.has(pass)) pass = randomBytes(32).toString("base64url");
    this.passes.set(pass, { code, key: { ...key }, expiresAt: now + TEACHER_PASS_TTL_MS });
    return pass;
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
      this.passes.delete(pass);
      return null;
    }
    if (rec.code !== code) return null;
    this.passes.delete(pass);
    return { ...rec.key };
  }

  private pruneExpired(now: number): void {
    for (const [pass, rec] of this.passes) {
      if (now >= rec.expiresAt) this.passes.delete(pass);
    }
  }
}

/** The one registry of this server process. */
export const classRegistry = new ClassRegistry();

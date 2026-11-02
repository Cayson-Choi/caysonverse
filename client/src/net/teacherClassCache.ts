/**
 * The class this browser last opened (or re-entered) as a teacher — localStorage "cv.teacherClass",
 * `{ code, at }` (AI 학교 탈출, final review I2). The teacher form's "이어서 들어갈 반 코드" is prefilled
 * from it, so a teacher whose tab reloaded (F5, a closed tab, an iPad dropping a background tab) can
 * go straight back into the class still running instead of opening a new one.
 *
 * Only the class code (which the whole class reads off the board) and a time are stored — never the
 * teacher key (teacherSession.ts keeps that in module memory only). Kept apart from the identity
 * cache (identityCache.ts) on purpose: that one holds the last code a STUDENT typed on this device,
 * which must never turn a teacher's 반 열기 into entering a student's class. An old entry is not
 * prefilled (TEACHER_CLASS_PREFILL_MS): yesterday's class is not running any more. All accesses are
 * best-effort (private mode / disabled storage never throws).
 */

import { normalizeClassCode } from "@caysonverse/shared/escape/classCode";

const STORAGE_KEY = "cv.teacherClass";

/** A remembered class is offered for this long after it was opened (a lesson, a double period, a break). */
export const TEACHER_CLASS_PREFILL_MS = 3 * 60 * 60 * 1000;

/** The code to prefill from a stored value at `now`: a canonical code no older than the limit, else "". */
export function teacherClassPrefill(stored: unknown, now: number): string {
  if (typeof stored !== "object" || stored === null) return "";
  const { code, at } = stored as { code?: unknown; at?: unknown };
  const canonical = normalizeClassCode(code);
  if (canonical === null || typeof at !== "number" || !Number.isFinite(at)) return "";
  const age = now - at;
  return age >= 0 && age <= TEACHER_CLASS_PREFILL_MS ? canonical : "";
}

/** The code to prefill in the teacher form now ("" = open a new class). Never throws. */
export function loadTeacherClass(now: number = Date.now()): string {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? teacherClassPrefill(JSON.parse(raw), now) : "";
  } catch {
    return "";
  }
}

/** Remember the class this teacher got a pass for (canonical code only). Never throws. */
export function saveTeacherClass(code: string, now: number = Date.now()): void {
  const canonical = normalizeClassCode(code);
  if (canonical === null) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ code: canonical, at: now }));
  } catch {
    // storage may be unavailable (private mode); non-fatal
  }
}

/** Forget it (the server said that class is not open any more). Never throws. */
export function forgetTeacherClass(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // non-fatal
  }
}

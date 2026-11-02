/**
 * The teacher's session for one open class — held in MODULE MEMORY only, never in
 * localStorage or sessionStorage (same reason as adminSession.ts: the teacher key is a
 * credential; written to storage it would outlive the session and could leak from a
 * shared classroom computer).
 *
 * Why remember the key at all: when the server restarts mid-lesson, the class is gone and
 * the teacher's tab must re-open it under the SAME class code so the students' screens can
 * find it again (Review Focus 5). The resilience driver asks for a new one-time pass with
 * this key (`requestTeacherPass`) and joins with that pass. The pass itself is never kept:
 * it is used once, in the join options. A tab close or a reload forgets everything, and so
 * does leaving the class (resilience.ts calls `forgetTeacher` on every way back to the entry).
 */

import type { TextLevel } from "@caysonverse/shared/escape/constants";
import { normalizeClassCode } from "@caysonverse/shared/escape/classCode";

export interface TeacherSession {
  key: string;
  classCode: string;
  textLevel: TextLevel;
}

let current: TeacherSession | null = null;

/** Remember the key, the class it opened (canonical code) and the reading level. */
export function rememberTeacher(t: TeacherSession): void {
  current = { key: t.key, classCode: normalizeClassCode(t.classCode) ?? "", textLevel: t.textLevel };
}

/** A copy of the remembered session, or null when this tab is not a teacher's. */
export function getTeacher(): TeacherSession | null {
  return current === null ? null : { ...current };
}

/** Drop the key (leaving the class, a kick, the class's end). */
export function forgetTeacher(): void {
  current = null;
}

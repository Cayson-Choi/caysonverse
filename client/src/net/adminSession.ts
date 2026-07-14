/**
 * Session-scoped admin code, held in MODULE MEMORY only — never localStorage or
 * sessionStorage.
 *
 * An admin code is the instructor's secret. Persisting it to storage would risk
 * leaking the credential to disk / a shared machine and outliving the session.
 * Keeping it purely in memory lets a Phase-2 fresh rejoin (the "server restarted
 * mid-lecture" path) RE-authenticate and preserve the instructor's admin powers
 * instead of silently demoting them while the panel stays live (F5) — yet the
 * secret still evaporates on a tab close or full page reload.
 *
 * A REJECTED code on rejoin (server restarted with a different/unset ADMIN_CODE)
 * must fall back to a normal-user join, not fail recovery — see resilience.ts.
 */

let sessionAdminCode: string | null = null;

/** Remember the code that authenticated THIS session's admin join. `""` clears. */
export function rememberAdminCode(code: string): void {
  sessionAdminCode = code.length > 0 ? code : null;
}

/** The remembered admin code to re-send on a fresh rejoin, or null. */
export function getAdminCode(): string | null {
  return sessionAdminCode;
}

/** Drop the remembered code (on leave-to-entry, kick, or a rejected rejoin). */
export function forgetAdminCode(): void {
  sessionAdminCode = null;
}

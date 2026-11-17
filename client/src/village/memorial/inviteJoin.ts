import { useSyncExternalStore } from "react";
import { INVITE_CODE_LENGTH } from "@caysonverse/shared/memorial/constants";
import { normalizeCode } from "@caysonverse/shared/memorial/codes";
import { INVITE_QUERY_KEY } from "@caysonverse/shared/memorial/messages";
import { refreshHall } from "./claimsStore";
import { memorialApi } from "./memorialApi";
import { MEM_COPY } from "./memorialSheets";

/**
 * The family invite link `/?f=<code>` (or `/f/<code>` where the host rewrites it to the app): read once when the page opens,
 * removed from the address bar at once (so it is not re-shared or kept in history), and used after the visitor has joined the
 * village (the device key is ready by then). The result is a quiet notice line.
 */

const SS_KEY = "cv.pendingInvite";

/** The invite code in `href`, normalised, or null. Pure. */
export function inviteCodeIn(href: string): string | null {
  try {
    const u = new URL(href);
    const q = u.searchParams.get(INVITE_QUERY_KEY);
    const path = /^\/f\/([^/]+)\/?$/.exec(u.pathname)?.[1];
    return normalizeCode(q ?? (path ? decodeURIComponent(path) : null), INVITE_CODE_LENGTH);
  } catch {
    return null;
  }
}

/** Call once at startup: keep the code for later, clean the address bar. */
export function captureInvite(): void {
  if (typeof window === "undefined") return;
  const code = inviteCodeIn(window.location.href);
  if (!code) return;
  try {
    sessionStorage.setItem(SS_KEY, code);
  } catch {
    pendingMemory = code;
  }
  const u = new URL(window.location.href);
  u.searchParams.delete(INVITE_QUERY_KEY);
  const path = /^\/f\//.test(u.pathname) ? "/" : u.pathname;
  window.history.replaceState(null, "", `${path}${u.search}${u.hash}`);
}

let pendingMemory: string | null = null;
let notice: string | null = null;
const listeners = new Set<() => void>();
function setNotice(n: string | null) {
  notice = n;
  for (const l of [...listeners]) l();
}

export function useMemorialNotice(): string | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => notice,
    () => notice,
  );
}

export function dismissMemorialNotice(): void {
  setNotice(null);
}

/** After joining: use a captured invite (once). */
export async function consumeInvite(): Promise<void> {
  let code: string | null = pendingMemory;
  try {
    code = sessionStorage.getItem(SS_KEY) ?? code;
    sessionStorage.removeItem(SS_KEY);
  } catch {
    /* memory only */
  }
  pendingMemory = null;
  if (!code) return;
  try {
    await memorialApi.join(code);
    setNotice(MEM_COPY.joined);
    void refreshHall();
  } catch (err) {
    setNotice((err as Error).message || MEM_COPY.joinFailed);
  }
}

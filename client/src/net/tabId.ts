/**
 * An id for THIS browser tab (sessionStorage: a reload keeps it, another tab or window has its own). The village join carries it, so a
 * fresh join of the same tab (the resilience driver's phase 2, after a phone's screen slept past the 20 s reconnection window) can
 * replace its own old session on the server at once instead of leaving a ghost behind. Random, not derived from anything about the
 * person or the device; it never leaves the tab but in the join options. (The memorial's device key is shared by every tab of a
 * browser, so it cannot tell the tab's own old session from the owner's other tab.)
 */
const KEY = "cv.tabId";

function fresh(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 10)).join("-");
}

let memo: string | null = null;

export function tabId(): string {
  if (memo) return memo;
  try {
    const kept = sessionStorage.getItem(KEY);
    if (kept && /^[A-Za-z0-9_-]{8,64}$/.test(kept)) return (memo = kept);
  } catch {
    /* storage blocked: the id lives for the page */
  }
  const id = fresh();
  try {
    sessionStorage.setItem(KEY, id);
  } catch {
    /* ignore */
  }
  return (memo = id);
}

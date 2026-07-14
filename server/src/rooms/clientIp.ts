/**
 * Pure client-IP resolution from the Colyseus auth context. Server-only and
 * clock-free so it is exhaustively unit-testable; the room hands the result to
 * the admin brute-force limiter (per-IP key) and — historically — the kick
 * denySet.
 *
 * TRUSTED-PROXY MODEL (final-review F1). Colyseus 0.17 sources `context.ip`
 * from the raw `x-forwarded-for` header (then `x-client-ip` / `x-real-ip`) — see
 * @colyseus/core `default_routes`. A proxy APPENDS the socket address it observed
 * rather than replacing the header, so behind Railway's single edge proxy the
 * chain arrives as `<client-supplied…>, <realClientIp>` and ONLY the RIGHT-most
 * hop is one we actually trust (the entry Railway itself wrote). The left-most
 * entry is fully client-settable: a scripted request sending
 * `X-Forwarded-For: <spoof>` would control the security key if we trusted it,
 * letting an attacker rotate past the per-IP admin throttle and evade the kick
 * ban. We therefore select the RIGHT-most non-empty hop.
 *
 * ASSUMPTION — exactly ONE trusted proxy (Railway). With N chained trusted
 * proxies the real client would be the N-th-from-last entry; if the deployment
 * ever gains additional trusted hops, revisit this selection (make the trusted
 * hop count explicit). With NO proxy (dev/test/no XFF header) `context.ip` is
 * undefined and this returns null — the caller then uses the global limiter key
 * and the nickname-only denySet fallback.
 */

import type { AuthContext } from "colyseus";

/**
 * The real client IP, or null when unavailable. `x-forwarded-for` may arrive as
 * a comma-separated string or (defensively) an array; both normalize to the last
 * non-empty, trimmed hop. Anything empty ⇒ null.
 */
export function resolveClientIp(context: AuthContext | undefined): string | null {
  const raw = (context as { ip?: unknown } | undefined)?.ip;
  // Normalize to a single chain string. An array (defensive — .get() returns a
  // string, but a custom transport could differ) is joined so the right-most
  // element still wins overall.
  const chain = Array.isArray(raw) ? raw.join(",") : raw;
  if (typeof chain !== "string") return null;

  const hops = chain
    .split(",")
    .map((hop) => hop.trim())
    .filter((hop) => hop.length > 0);

  // Right-most hop = the real client IP written by our one trusted proxy.
  const clientIp = hops.length > 0 ? hops[hops.length - 1] : "";
  return clientIp.length > 0 ? clientIp : null;
}

/**
 * In-memory kick deny list, pure and per-room-instance (WorldRoom owns one).
 *
 * A kicked player is keyed by TWO things:
 *  - their IP, when obtainable (see the IP finding in WorldRoom — often absent
 *    without a reverse proxy), and
 *  - ALWAYS their normalized nickname (trimmed + lowercased) as a weak fallback
 *    so a same-name rejoin is blocked even when no IP is available.
 *
 * `onJoin` checks a candidate against both keys and rejects on either match.
 * This is memory only: a server restart clears it (documented v1 limitation —
 * no persistent bans, per YAGNI).
 */

/** Trim + lowercase so nickname matching ignores case and surrounding spaces. */
export function normalizeNick(nickname: string): string {
  return nickname.trim().toLowerCase();
}

interface DenyEntry {
  ip?: string | null;
  nickname?: string | null;
}

export class DenySet {
  private readonly ips = new Set<string>();
  private readonly nicks = new Set<string>();

  /** Ban an entry. Empty/absent IP or nickname keys are ignored (never stored). */
  add(entry: DenyEntry): void {
    if (entry.ip) this.ips.add(entry.ip);
    const nick = entry.nickname ? normalizeNick(entry.nickname) : "";
    if (nick) this.nicks.add(nick);
  }

  /** True if the candidate matches a banned IP OR a banned nickname. */
  isDenied(candidate: DenyEntry): boolean {
    if (candidate.ip && this.ips.has(candidate.ip)) return true;
    const nick = candidate.nickname ? normalizeNick(candidate.nickname) : "";
    return nick.length > 0 && this.nicks.has(nick);
  }
}

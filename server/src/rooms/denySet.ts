/**
 * In-memory kick deny list, pure and per-room-instance (WorldRoom owns one).
 *
 * v1 ban model (final-review F7): a kicked player is keyed ONLY by their
 * normalized nickname (trimmed + lowercased). We deliberately DO NOT key on IP.
 *
 * Why not IP — the classroom-lockout fix. In production behind Railway's proxy
 * the resolved IP is the client's PUBLIC IP, and a lecture hall of students on
 * one campus/classroom Wi-Fi all share ONE NAT public IP. Banning that IP would
 * reject every other student the moment one disruptive student is kicked — a
 * classroom-wide lockout with no unban command short of a state-wiping restart.
 * Keying on nickname alone blocks the kicked user's trivial same-name rejoin
 * (even from a different network) while NEVER over-blocking classmates who chose
 * different nicknames. This also makes production behavior match the model the
 * design already documents (docs/design.md section 8).
 *
 * Accepted limitation (documented, design section 8): a kicked user who CHANGES
 * their nickname can rejoin — full blocking needs accounts (v2). This is the same
 * structural limit the design already records for the nickname key. A rare
 * secondary effect is that a DIFFERENT person who picks the kicked user's exact
 * nickname is also blocked; acceptable because nicknames are non-unique by design
 * and the alternative (bare-IP or IP+nickname keying) reintroduces the shared-NAT
 * over-block or weakens the cross-network rejoin block.
 *
 * Memory only: a server restart clears it (no persistent bans, per YAGNI).
 */

/** Trim + lowercase so nickname matching ignores case and surrounding spaces. */
export function normalizeNick(nickname: string): string {
  return nickname.trim().toLowerCase();
}

interface DenyEntry {
  /**
   * Kept in the shape for call-site compatibility and audit logging, but IP is
   * INTENTIONALLY NOT a ban key (see class doc — shared-NAT over-block). The
   * resolved IP still keys the admin brute-force limiter elsewhere; only the
   * kick ban ignores it.
   */
  ip?: string | null;
  nickname?: string | null;
}

export class DenySet {
  private readonly nicks = new Set<string>();

  /** Ban an entry by its normalized nickname. Empty/absent nickname → ignored. */
  add(entry: DenyEntry): void {
    const nick = entry.nickname ? normalizeNick(entry.nickname) : "";
    if (nick) this.nicks.add(nick);
  }

  /** True if the candidate's normalized nickname matches a banned entry. */
  isDenied(candidate: DenyEntry): boolean {
    const nick = candidate.nickname ? normalizeNick(candidate.nickname) : "";
    return nick.length > 0 && this.nicks.has(nick);
  }
}

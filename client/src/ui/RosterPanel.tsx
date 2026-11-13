import { useEffect, useSyncExternalStore } from "react";
import { onHotkey } from "../game/hotkeys";
import { rosterRowLabel, rosterRows, rosterTitle, type RosterRow } from "../game/hud";
import { getRemoteRecord, getRoster, subscribeRoster } from "../game/remoteStore";
import { useAppStore } from "../stores/appStore";
import { useUiStore } from "../stores/uiStore";

/**
 * The roster key: Tab HELD shows the list, letting go hides it (the hotkey table sends
 * `roster {show}` for the press and the release). Esc closes it through resolveEscape
 * (escape.ts); the 👥 button toggles the same flag on a phone.
 *
 * A key that goes up while the window is not looking never reaches us, so the list would
 * stay up forever after an alt-tab: losing the window's focus drops a list the Tab key is
 * holding open. (A list opened with the 👥 button is the player's own and stays.)
 */
export function useRosterHotkey(): void {
  useEffect(() => {
    let heldByKey = false;
    const off = onHotkey((action) => {
      if (action.type !== "roster") return;
      heldByKey = action.show;
      useUiStore.getState().setRosterOpen(action.show);
    });
    const onBlur = () => {
      if (!heldByKey) return;
      heldByKey = false;
      useUiStore.getState().setRosterOpen(false);
    };
    window.addEventListener("blur", onBlur);
    return () => {
      off();
      window.removeEventListener("blur", onBlur);
    };
  }, []);
}

/**
 * How many players are in the village, me included — the number on the 👥 button. Counts
 * only (no rows are built or sorted), and re-renders on join / leave only.
 */
export function useRosterCount(): number {
  const hasIdentity = useAppStore((s) => s.identity !== null);
  const roster = useSyncExternalStore(subscribeRoster, getRoster, getRoster);
  return roster.length + (hasIdentity ? 1 : 0);
}

/** The player list's rows: me plus every remote, in the order game/hud.ts `rosterRows` gives. */
function useRosterRows(): RosterRow[] {
  const identity = useAppStore((s) => s.identity);
  // Re-renders on join / leave only (the roster is the set of ids, never positions).
  const roster = useSyncExternalStore(subscribeRoster, getRoster, getRoster);
  if (!identity) return [];
  const self: RosterRow = {
    sid: identity.sessionId,
    nickname: identity.nickname,
    self: true,
  };
  const remotes: RosterRow[] = roster.map((sid) => {
    const rec = getRemoteRecord(sid);
    return { sid, nickname: rec?.nickname ?? sid, self: false };
  });
  return rosterRows(self, remotes);
}

/**
 * The player list (접속자 N명): "(나)" after me, me first, then the rest in Korean order. A short
 * scrolling card in the top-left column, under the 👥 button — in the column's flow.
 */
export function RosterPanel() {
  const open = useUiStore((s) => s.rosterOpen);
  return open ? <RosterList /> : null;
}

/** The open list. Its own component so the rows are built and sorted only while it is up. */
function RosterList() {
  const rows = useRosterRows();
  return (
    <section className="cv-roster" aria-label="접속자 목록">
      <h2 className="cv-roster-title">{rosterTitle(rows.length)}</h2>
      <ul className="cv-roster-list">
        {rows.map((r) => (
          <li key={r.sid} className={"cv-roster-row" + (r.self ? " is-self" : "")}>
            {rosterRowLabel(r)}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Back from the team classroom to the hall (AI 학교 탈출, Task 17): close the classroom connection
 * and show the hall scene again. The class connection stays; the server has already put the
 * player at the door's return point (the hall snaps there, classSync `takeHubSnap`).
 *
 * Both steps run in the same turn on purpose: `leaveEscape` forgets the classroom (the escape
 * store is reset) at once, and the screen must move in that same batch so the classroom scene
 * never renders against an empty store.
 */

import { leaveEscape } from "../net/connection";
import { useAppStore } from "../stores/appStore";

export function leaveToHall(notice: string | null = null): void {
  void leaveEscape();
  useAppStore.getState().exitEscape(notice);
}

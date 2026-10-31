/**
 * The local player's own name tag (controls-ux Task 15, "내 이름표 보기"). Everyone else's
 * tag comes from the synced `Player.role`; the local player's role is read the same way,
 * and only when the room's state is not yet readable does it fall back to the client-side
 * admin flag (a join that supplied a correct admin code — appStore.isAdmin).
 */

import { ROLE_TEACHER } from "@caysonverse/shared/constants";

/**
 * Whether the local player's tag carries the teacher badge. `role` is the synced
 * `Player.role` (0 student / 1 teacher) or `undefined` while the state cannot be read.
 * A readable role always wins: the server writes 1 only after a successful admin
 * authentication, so an admin flag that disagrees with it is the stale one.
 */
export function isLocalTeacher(role: number | undefined, isAdmin: boolean): boolean {
  return role === undefined ? isAdmin : role === ROLE_TEACHER;
}

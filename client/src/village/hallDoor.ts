import type { Object3D } from "three";

/**
 * The memorial hall's door as the MODEL has it (memorial.glb: `door__leaf_l` / `door__leaf_r`, two sliding glass leaves authored
 * closed). MemorialHall registers the leaves while the hall is on screen; PublicAutoDoor slides them with the shared door
 * state machine. Module state, not React state: the door reads it every frame.
 */
export const hallDoor: { leaves: { left: Object3D; right: Object3D } | null } = { leaves: null };

/** Register (or clear, with null) the hall model's door leaves. */
export function setHallDoorLeaves(leaves: { left: Object3D; right: Object3D } | null): void {
  hallDoor.leaves = leaves;
}

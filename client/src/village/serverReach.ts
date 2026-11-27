import type { InteractTarget } from "../game/interact";
import { isHouseArea, isLotArea } from "@caysonverse/shared/village/villageLayout";

/**
 * A house's or a lot building's stair / way out is offered only where the SERVER also has the player in its reach (fix/house-walk-sync,
 * 2026-11-27: "2층으로 올라가기" showed 1.65 m from the pad while the server, 0.36 m behind on the walk, had the player at 2.0 m — past its
 * 1.8 m — and the press was refused). The client's pose runs ahead of the one the server knows while walking (a patch or two), and
 * after refused moves until the self-correction heals the gap; the button waits for the server's pose too, so a press it shows is a
 * press the server takes. Pure: `offersAt` is the area's own target rule (villageTargets), `server` the synced pose (null: none yet).
 */
export function serverAgreedTargets<A extends string>(
  area: A,
  targets: readonly InteractTarget[],
  server: { x: number; z: number; area: string } | null,
  offersAt: (area: A, x: number, z: number) => readonly InteractTarget[],
): readonly InteractTarget[] {
  if (!isHouseArea(area) && !isLotArea(area)) return targets;
  if (!targets.some((t) => t.kind === "door")) return targets;
  if (!server || !Number.isFinite(server.x) || !Number.isFinite(server.z)) return targets;
  // the server has me elsewhere (a door's area flip not yet seen here): it would refuse any of them
  const there = server.area === area ? new Set(offersAt(area, server.x, server.z).map((t) => t.id)) : new Set<string>();
  const kept = targets.filter((t) => t.kind !== "door" || there.has(t.id));
  return kept.length === targets.length ? targets : kept;
}

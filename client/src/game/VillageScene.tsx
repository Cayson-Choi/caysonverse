import { useState } from "react";
import { villageGeometry } from "@caysonverse/shared/village/villageLayout";
import { PlayShell } from "./PlayShell";
import { VILLAGE_ACTIVE_MAP } from "./activeMap";
import type { PlayersRoom } from "./remoteSync";
import { getRoom } from "../net/connection";
import type { Identity } from "../stores/appStore";

/**
 * 케이슨 마을 — PLACEHOLDER scene (Task 3). It exists so the connection flow is real end to end: a
 * `PlayShell` on the village map (`VILLAGE_ACTIVE_MAP`: the shared collision and walk bounds, the same
 * ones the server uses) with one flat meadow under it, plus the shared HUD (chat, emoji, joystick,
 * menu) and the other players of the village room. Task 4 replaces this file with the real scene
 * (the Blender model, plot markers, the memorial hall door); nothing here is meant to stay.
 *
 * App mounts it keyed by `connectionEpoch`, so a reconnect remounts it against the new room.
 */

/** One flat meadow over the whole walkable area, so the avatars do not walk on nothing. */
function Meadow() {
  const b = villageGeometry.bounds;
  return (
    <mesh rotation-x={-Math.PI / 2} position={[(b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2]} receiveShadow>
      <planeGeometry args={[b.maxX - b.minX, b.maxZ - b.minZ]} />
      <meshStandardMaterial color="#8fcf7a" />
    </mesh>
  );
}

export function VillageScene({ identity }: { identity: Identity }) {
  // The village connection (read once per mount: a reconnect remounts this scene).
  const [room] = useState(() => getRoom() as unknown as PlayersRoom | null);
  if (!room) return null;

  return (
    <PlayShell
      identity={identity}
      room={room}
      activeMap={VILLAGE_ACTIVE_MAP}
      lighting="brightDay"
      effects={false}
      world3d={<Meadow />}
      hud={null}
    />
  );
}

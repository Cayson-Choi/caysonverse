import { useEffect, useState } from "react";
import { PlayShell } from "../game/PlayShell";
import { villageActiveMap } from "../game/activeMap";
import { clearClickTarget } from "../game/clickMove";
import { setTargetHandler, setTargetSource } from "../game/interactTargets";
import type { PlayersRoom } from "../game/remoteSync";
import type { Pose } from "../game/types";
import { getRoom, sendUseDoor } from "../net/connection";
import type { Identity } from "../stores/appStore";
import { DoorFade } from "./DoorFade";
import { doorFade } from "./doorFadeModel";
import { VillageGround } from "./VillageGround";
import { areaGate, localArea, readSelfArea, resetLocalArea, setLocalArea, useLocalArea } from "./villageArea";
import { villageTargets } from "./villageTargets";

/**
 * 케이슨 마을 — the village scene (Task 4). A `PlayShell` on the village map under the village's afternoon
 * light, with a GREYBOX of the place (VillageGround: ground, boxes, creek, the plots' glowing markers and signs;
 * the Blender model replaces it in Task 7) and the memorial hall's door.
 *
 * Two areas share this room: the open village and the memorial hall's interior (`Player.area`). The scene follows
 * the LOCAL player's area (villageArea.ts, written by the sync as the server flips it) and shows only that one:
 *  - the ground and boxes of that area (the other one is not mounted at all);
 *  - the map's bounds of that area (`villageActiveMap`, so the sun's shadow box, the overview and the click-move
 *    clamp frame the right place, not the rectangle spanning both);
 *  - the players of that area (the remote sync is given the area gate: a player in the other area has no avatar,
 *    nametag or bubble here);
 *  - the door: "추모관 들어가기" outside and "밖으로 나가기" inside, offered within reach of the pad through the
 *    context button and E (interactTargets.ts). Pressing it draws the curtain (DoorFade) and then sends `UseDoor`;
 *  - the quiet hall: while inside, jumping and emoji are off (quiet.ts), as on the server.
 *
 * App mounts it keyed by `connectionEpoch`, so a reconnect remounts it against the new room.
 */

/**
 * The sun's shadow box, half-size (m), around the player (PlayShell follows them): the village is 190 m across,
 * and one shadow map over it would be 18 cm per texel. 40 m (80 m box) is 8 cm, and the hall's room (9 x 12 m)
 * sits well inside the same box.
 */
const SHADOW_HALF = 40;

/**
 * Plug the door into the context button and the E key for this scene's lifetime (a component of the 3D slot, which
 * is where the live pose is). Pressing it draws the curtain; once that has closed the door is used (`UseDoor`),
 * provided the player is still within reach of it, so the server's answer lands on a black screen.
 */
function VillageDoors({ pose }: { pose: Pose }) {
  useEffect(() => {
    setTargetSource((p) => villageTargets(localArea(), p.x, p.z));
    setTargetHandler((target, phase) => {
      if (phase !== "press" || target.kind !== "door") return;
      clearClickTarget(); // a click-move in progress must not walk on after the teleport
      doorFade.begin(() => {
        if (villageTargets(localArea(), pose.x, pose.z).length === 0) return false; // walked away while it closed
        sendUseDoor();
        return true;
      });
    });
    return () => {
      setTargetSource(null);
      setTargetHandler(null);
    };
  }, [pose]);
  return null;
}

export function VillageScene({ identity }: { identity: Identity }) {
  // The village connection (read once per mount: a reconnect remounts this scene). The local area is seeded
  // from the room's own state, so a reconnect into the hall starts in the hall and a fresh join in the village.
  const [room] = useState(() => {
    const r = getRoom() as unknown as PlayersRoom | null;
    setLocalArea(readSelfArea(r));
    return r;
  });
  const area = useLocalArea();
  useEffect(() => () => resetLocalArea(), []);
  if (!room) return null;

  return (
    <PlayShell
      identity={identity}
      room={room}
      activeMap={villageActiveMap(area)}
      lighting="village"
      effects
      shadowFollowHalf={SHADOW_HALF}
      areas={areaGate}
      world3d={({ pose }) => (
        <>
          <VillageGround area={area} />
          <VillageDoors pose={pose} />
        </>
      )}
      hud={<DoorFade />}
    />
  );
}

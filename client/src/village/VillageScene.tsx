import { Suspense, useEffect, useLayoutEffect, useState } from "react";
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
import { useQualityTier } from "../game/QualityEffects";
import { SceneWarmUp } from "../game/SceneWarmUp";
import { VILLAGE_LAYOUT, type AreaId } from "@caysonverse/shared/village/villageLayout";
import { PlotMarkers } from "./PlotMarkers";
import { DoorPad } from "./VillageHall";
import { HallArea } from "./MemorialHall";
import { CubbyView } from "./CubbyView";
import { cubbyCardState, openCubbyCard } from "./cubbyCard";
import { DayNight } from "./DayNight";
import { VillageModel } from "./VillageModel";
import { VillageBus } from "./VillageBus";
import { VillageBgmButton } from "./VillageBgmButton";
import { VILLAGE_CAMERA_PLANES, VILLAGE_GROUND_DECAL, type VillageTier } from "./villageModelPrep";
import { clearBusCache, clearVillageCaches, holdVillageFiles, holdsVillageFiles } from "./villageRelease";
import { LoadBoundary } from "./LoadBoundary";
import { areaGate, localArea, readSelfArea, releaseLocalArea, seedLocalArea, useLocalArea } from "./villageArea";
import { CUBBY_TARGET_PREFIX, GUIDE_TARGET_PREFIX, villageAndHallTargets, villageTargets } from "./villageTargets";
import { GuideNpcs } from "./GuideNpc";
import { GuideDialog } from "./GuideDialog";
import { guideDialogOpen, openGuideDialog } from "./guideDialogStore";
import { StarSky } from "./sky/StarSky";
import { StarFinder } from "./sky/StarFinder";
import { StarFinderButton } from "./sky/StarFinderButton";

/**
 * 케이슨 마을 — the village scene (Task 4). A `PlayShell` on the village map under the village's afternoon
 * light: outside, the Blender model (Task 7: VillageModel — the plaza, houses, creek, plots, the far mountains and
 * the sky dome, with its far plane past the dome) with the words on the plots' signs and the memorial's door pad;
 * inside, the memorial hall (Task 9: MemorialHall — the Task 8 model, the sample cubbies' props, the candles).
 *
 * Two areas share this room: the open village and the memorial hall's interior (`Player.area`). The scene follows
 * the LOCAL player's area (villageArea.ts, written by the sync as the server flips it) and shows only that one:
 *  - the model or the room of that area (the other one is not mounted at all);
 *  - the map's bounds of that area (`villageActiveMap`, so the sun's shadow box, the overview and the click-move
 *    clamp frame the right place, not the rectangle spanning both);
 *  - the players of that area (the remote sync is given the area gate: a player in the other area has no avatar,
 *    nametag or bubble here);
 *  - the door: "추모관 들어가기" outside and "밖으로 나가기" inside, offered within reach of the pad through the
 *    context button and E (interactTargets.ts). Pressing it draws the curtain (DoorFade) and then sends `UseDoor`;
 *  - the quiet hall: while inside, jumping and emoji are off (quiet.ts), as on the server;
 *  - the cubbies (Task 9): inside, within 1.2 m of a cubby column, "가까이 보기" (context button and E) opens the
 *    close-up card (CubbyView), where "촛불 켜기" lights a candle everyone in the hall sees for 60 s;
 *  - the guides (Task 9A): the plaza's 마을 안내원 and the hall's 안내 데스크 (GuideNpc), "문의하기" within 2.2 m opens
 *    their questions (GuideDialog); an answer plays its voice clip for this player only, ducking the music.
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
/** The village's stand-in while its model is missing: a plain lawn under the walk area. */
function PlainGround() {
  const b = VILLAGE_LAYOUT.walkBounds;
  return (
    <mesh rotation-x={-Math.PI / 2} position={[(b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2]}>
      <planeGeometry args={[b.maxX - b.minX, b.maxZ - b.minZ]} />
      <meshBasicMaterial color="#7d9a5a" />
    </mesh>
  );
}

/** What the local player's area draws: the village model and its signs and door pad, or the hall's room. */
function VillageArea({ area, tier }: { area: AreaId; tier: VillageTier }) {
  if (area === "hall") return <HallArea />;
  return (
    <>
      {/* A failed download shows a plain ground and tries again, instead of the crash screen (final review m2). */}
      <LoadBoundary fallback={<PlainGround />} onReset={clearVillageCaches} notice="마을 풍경을 불러오지 못했어요. 잠시 뒤 다시 불러올게요.">
        <Suspense fallback={null}>
          <VillageModel tier={tier} />
          {/* The bus at the stop (bus review r3, M2): its own error boundary and its own Suspense, so the village never
              waits for it. Its download starts with the model's, so it is usually in when the village shows (and warmed
              up with it); if it comes later it appears then (its own warm-up), and a stalled or failed bus is no bus. */}
          <LoadBoundary fallback={null} onReset={clearBusCache} notice="마을버스를 불러오지 못했어요. 잠시 뒤 다시 불러올게요.">
            <Suspense fallback={null}>
              <VillageBus tier={tier} />
              <SceneWarmUp key={tier} />
            </Suspense>
          </LoadBoundary>
          {/* Its materials compiled ahead once the model is in (night-only and out-of-view ones included). */}
          <SceneWarmUp key={tier} />
        </Suspense>
      </LoadBoundary>
      <PlotMarkers />
      <DoorPad pad={VILLAGE_LAYOUT.memorial.exterior.doorPad} y={0.06} />
    </>
  );
}

function VillageDoors({ pose }: { pose: Pose }) {
  useEffect(() => {
    // Nothing is offered while the cubby card or a guide's questions are open (the E / action button hides).
    setTargetSource((p) => villageAndHallTargets(localArea(), p.x, p.z, cubbyCardState() !== null || guideDialogOpen() !== null));
    setTargetHandler((target, phase) => {
      if (phase !== "press") return;
      if (target.kind === "object" && target.id.startsWith(GUIDE_TARGET_PREFIX)) {
        clearClickTarget(); // stand still in front of the guide while the questions are open
        openGuideDialog(target.id);
        return;
      }
      if (target.kind === "object" && target.id.startsWith(CUBBY_TARGET_PREFIX)) {
        clearClickTarget(); // stand still in front of the cubby while the card is open
        openCubbyCard(target.id);
        return;
      }
      if (target.kind !== "door") return;
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
  // The village connection and the area its state puts us in (read once per mount: a reconnect remounts this
  // scene). The area is seeded from the room's own state, so a reconnect into the hall starts in the hall and a
  // fresh join in the village. Reading the room during render is pure; PUBLISHING the area (it notifies the
  // components that watch it) happens in a layout effect, before paint, with a token so that the unmount of an
  // older scene (a reconnect remounts) cannot reset what this one has seeded.
  const [boot] = useState(() => {
    const r = getRoom() as unknown as PlayersRoom | null;
    return { room: r, area: readSelfArea(r) };
  });
  const { room } = boot;
  const [published, setPublished] = useState(false);
  useLayoutEffect(() => {
    const token = seedLocalArea(boot.area);
    setPublished(true);
    return () => releaseLocalArea(token);
  }, [boot]);
  const live = useLocalArea();
  // Until the seed is published the store may still hold the previous scene's area: draw from the seed itself.
  const area = published ? live : boot.area;
  const tier = useQualityTier();
  // The village's files (model, light maps) stay cached while this scene shows and go one tick after it unmounts
  // (Task 7 review I1). On the light (phone) tier they go while the player is in the hall too, and load again on the
  // way out (final review I2: the village's textures are not resident next to the hall's).
  const holdFiles = holdsVillageFiles(tier, area);
  useEffect(() => (holdFiles ? holdVillageFiles() : undefined), [holdFiles]);
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
      cameraPlanes={VILLAGE_CAMERA_PLANES}
      groundDecal={VILLAGE_GROUND_DECAL}
      world3d={({ pose }) => (
        <>
          <DayNight area={area} tier={tier} />
          <VillageArea area={area} tier={tier} />
          <GuideNpcs area={area} />
          <VillageDoors pose={pose} />
          {area === "village" && <StarSky tier={tier} />}
        </>
      )}
      hudColumn={
        <>
          <VillageBgmButton />
          <StarFinderButton />
        </>
      }
      hud={({ orbit }) => (
        <>
          <DoorFade />
          <CubbyView />
          <GuideDialog />
          <StarFinder orbit={orbit} />
        </>
      )}
    />
  );
}

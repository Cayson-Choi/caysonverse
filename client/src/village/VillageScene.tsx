import { MemorialOverlays } from "./memorial/MemorialOverlays";
import { isTouchDevice } from "../device";
import { Suspense, useEffect, useLayoutEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { PlayShell } from "../game/PlayShell";
import { villageActiveMap } from "../game/activeMap";
import { clearClickTarget } from "../game/clickMove";
import { fireTarget, setTargetHandler, setTargetSource } from "../game/interactTargets";
import { takeArmedHouseUse } from "./houseTap";
import type { PlayersRoom } from "../game/remoteSync";
import type { Pose } from "../game/types";
import { getRoom, sendUseDoor, sendUseStair } from "../net/connection";
import { rideStatusText, sendBusRide, sendBusSit, sendBusStand, showTransitNotice, startTransitSync, transitNowMs, transitTripAt, type TransitRoom, useTransitState } from "../net/transitSync";
import { BUS_VIEW_YAW, busCamGoal, busSeatPreferred, busWalk, selfBusRide } from "../game/busRide";
import { busRiderPoints, takenBusSpots } from "../game/remoteStore";
import { TRANSIT, boardingOpensWords } from "@caysonverse/shared/village/transit";
import type { Identity } from "../stores/appStore";
import { DoorFade } from "./DoorFade";
import { VegVeil } from "./VegVeil";
import { VeilFrameThrottle } from "./VeilFrameThrottle";
import { vegDressing } from "./vegDressing";
import { vegetationPark } from "./veg/villageVegetation";
import { doorFade } from "./doorFadeModel";
import { useQualityTier } from "../game/QualityEffects";
import { SceneWarmUp } from "../game/SceneWarmUp";
import { VILLAGE_LAYOUT, isHouseArea, isLotArea, type AreaId } from "@caysonverse/shared/village/villageLayout";
import { HOUSE_STAIR_TARGET_PREFIX } from "@caysonverse/shared/village/houseTargets";
import { houseNumberOf } from "@caysonverse/shared/village/houseAreas";
import { PlotMarkers } from "./PlotMarkers";
import { HallArea } from "./MemorialHall";
import { CubbyView } from "./CubbyView";
import { cubbyCardState, openCubbyCard } from "./cubbyCard";
import { DayNight } from "./DayNight";
import { VillageModel } from "./VillageModel";
import { VillageBus } from "./VillageBus";
import { BUSSTOP_MODEL_URL, BusStopShelter } from "./BusStopShelter";
import { VillageMusic } from "./VillageMusic";
import { LakeLampLights, LakeWorld } from "../lake/LakeScene";
import { VILLAGE_CAMERA_PLANES, VILLAGE_GROUND_DECAL, type VillageTier } from "./villageModelPrep";
import { clearBusCache, clearVillageCaches, holdVillageFiles, holdsVillageFiles } from "./villageRelease";
import { LoadBoundary } from "./LoadBoundary";
import { areaGate, localArea, readSelfArea, releaseLocalArea, seedLocalArea, useLocalArea } from "./villageArea";
import {
  BUS_RIDE_TARGET_BOARD,
  BUS_RIDE_TARGET_LEAVE,
  BUS_STAND_TARGET_ID,
  COASTER_BOARD_TARGET_ID,
  CUBBY_TARGET_PREFIX,
  GUIDE_TARGET_PREFIX,
  KEYPAD_TARGET_PREFIX,
  busCountdownWords,
  parseBusSitTarget,
  villageAndHallTargets,
  villageBusCabinTargets,
  villageBusTarget,
  villageTargets,
} from "./villageTargets";
import { GuideNpcs } from "./GuideNpc";
import { GuideDialog } from "./GuideDialog";
import { guideDialogOpen, openGuideDialog } from "./guideDialogStore";
import { StarSky } from "./sky/StarSky";
import { StarFinder } from "./sky/StarFinder";
import { StarFinderButton } from "./sky/StarFinderButton";
import { LakeHud } from "../lake/LakeHud";
import { CrosswalkHintPill } from "./CrosswalkHintPill";
import { BusStopHintPill } from "./BusStopHintPill";
import { SIGNALS_MODEL_URL, TransitRoadSignals } from "./TransitRoadSignals";
import { PublicAutoDoor } from "./PublicAutoDoor";
import { VillageLots } from "./lots/VillageLots";
import { LotRoomArea } from "./lots/LotRoom";
import { lotDoorNotice, lotDoorPadById, LOT_DOOR_TARGET_PREFIX } from "./lots/lotTargets";
import { openKeypad, useKeypad } from "./keypadStore";
import { VillageKeypad } from "./VillageKeypad";
import { HouseArea } from "./HouseInterior";
import { HouseEntryCover } from "./HouseEntryCover";
import { prefetchHouse } from "./houseRelease";
import { houseOpen } from "./keypadText";
import { liveSunEnabled } from "./sunShadows";
import { MapPlaces } from "./MapPlaces";
import { ParkWorld } from "../land/ParkWorld";
import { CoasterHud } from "../land/CoasterHud";
import { sendRideBoard } from "../net/connection";
import { landPose } from "../land/coasterRide";
import { startRideAudio } from "../land/coasterAudio";

/**
 * 케이슨 마을 — the village scene (Task 4). A `PlayShell` on the village map under the village's afternoon
 * light: outside, the Blender model (Task 7: VillageModel — the plaza, houses, creek, plots, the far mountains and
 * the sky dome, with its far plane past the dome) with the words on the plots' signs;
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
 *    close-up card (CubbyView), where "촛불 켜기" lights a candle everyone in the hall sees for an hour (server-kept, with who lit it);
 *  - the guides (Task 9A): the plaza's 마을 안내원 and the hall's 안내 데스크 (GuideNpc), "문의하기" within 2.2 m opens
 *    their questions (GuideDialog); answers are words only (no voice, owner 2026-11-17).
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

const dressedNow = () => vegDressing.dressed();
/** Its children mount once the village has been dressed (and stay: a later cover does not take them away). */
function AfterDressed({ children }: { children: ReactNode }) {
  const dressed = useSyncExternalStore(vegDressing.subscribe, dressedNow, dressedNow);
  const [once, setOnce] = useState(dressed);
  useEffect(() => {
    if (dressed) setOnce(true);
  }, [dressed]);
  return once || dressed ? <>{children}</> : null;
}

/** A failed village model: its cover lifts at once (the plain ground and the notice show, not "불러오는 중…"). */
const uncoverVillage = () => vegDressing.uncover();

/** Copies the live pose into the land HUD's module (the HUD column is outside the 3D slot's frame objects). */
function LandPoseProbe({ pose }: { pose: Pose }) {
  useFrame(() => {
    landPose.x = pose.x;
    landPose.z = pose.z;
  });
  return null;
}

/** 케이슨랜드 (the park area): no village model to dress, so the loading cover lifts at once; the park loads in its own Suspense. */
function ParkArea({ tier }: { tier: VillageTier }) {
  useEffect(() => {
    uncoverVillage();
  }, []);
  return (
    <LoadBoundary fallback={null} onReset={() => undefined} onFail={uncoverVillage} notice="케이슨랜드를 불러오지 못했어요. 잠시 뒤 다시 불러올게요.">
      <Suspense fallback={null}>
        <ParkWorld tier={tier} />
      </Suspense>
    </LoadBoundary>
  );
}

/** What the local player's area draws: the village model and its signs (no floor mark at the memorial's door), or the hall's room. */
function VillageArea({ area, tier, pose }: { area: AreaId; tier: VillageTier; pose: Pose }) {
  if (area === "park") return <ParkArea tier={tier} />;
  if (area === "hall") return <HallArea pose={pose} />;
  if (isHouseArea(area)) return <HouseArea area={area} pose={pose} />;
  if (isLotArea(area)) return <LotRoomArea area={area} pose={pose} />;
  return (
    <>
      {/* A failed download shows a plain ground and tries again, instead of the crash screen (final review m2). */}
      <LoadBoundary fallback={<PlainGround />} onReset={clearVillageCaches} onFail={uncoverVillage} notice="마을 풍경을 불러오지 못했어요. 잠시 뒤 다시 불러올게요.">
        <Suspense fallback={null}>
          <VillageModel tier={tier} />
          {/* The bus stop's pad and shelter and the crosswalk signals are small files of their own: a failed one is just missing. */}
          <LoadBoundary fallback={null} onReset={() => useGLTF.clear(BUSSTOP_MODEL_URL)} notice="버스 정류장을 불러오지 못했어요. 잠시 뒤 다시 불러올게요.">
            <Suspense fallback={null}>
              <BusStopShelter />
            </Suspense>
          </LoadBoundary>
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
      {/* The lake (100 m east) waits until the village is dressed (UX 2026-11-16): its files and its build never compete
          with the plaza's on the way in, and its Suspense is its own (it never holds the village back). */}
      <AfterDressed>
        <Suspense fallback={null}>
          <LakeWorld pose={pose} tier={tier} />
        </Suspense>
      </AfterDressed>
      <LoadBoundary fallback={null} onReset={() => useGLTF.clear(SIGNALS_MODEL_URL)} notice="횡단보도 신호등을 불러오지 못했어요. 잠시 뒤 다시 불러올게요.">
        <TransitRoadSignals />
      </LoadBoundary>
      <PlotMarkers />
      <PublicAutoDoor area="village" pose={pose} />
      {/* The six lot buildings (마을 부지 건물, L5): their own loader, never waited for; a failed one is just not there. */}
      <VillageLots pose={pose} tier={tier} />
    </>
  );
}

/**
 * Whether the bus takes riders now and how long until it leaves (ms), by the server's clock as the bus snapshots carry it
 * (transitSync.ts transitNowMs) and the drive the server's bus driver publishes (transitTripAt: the timetable, held up for avatars on the road).
 */
function busScheduleNow(): [boolean, number] {
  const now = transitNowMs();
  const trip = transitTripAt(now);
  if (trip.status === "boarding") return [true, trip.startMs - now];
  return [false, trip.nextStartMs - now];
}

/** The bus is out on its lap now (its doors shut: no getting off until it is back at the stop). */
function busOnRoad(): boolean {
  return transitTripAt(transitNowMs()).status === "inTransit";
}

/** What pressing the board button says while the bus is not taking riders. */
function busWaitNotice(departsInMs: number): string {
  const every = Math.round(TRANSIT.departureEveryMs / 60000);
  return `🚌 다음 버스는 ${busCountdownWords(departsInMs).long} 뒤에 떠나요. 버스는 ${every}분마다 다니고, 출발 ${boardingOpensWords()} 전부터 탈 수 있어요.`;
}

function VillageDoors({ pose }: { pose: Pose }) {
  const { boarded } = useTransitState();
  const keypadOpen = useKeypad().buildingId !== null;
  useEffect(() => {
    // Nothing is offered while the cubby card or a guide's questions are open (the E / action button hides).
    setTargetSource((p) => {
      const area = localArea();
      // Aboard the bus the village offers nothing else: sit / hold / get up / get off by where I stand in the bus's frame.
      if (selfBusRide.slot >= 0) {
        const free = selfBusRide.slot === 0;
        const ahead = free && busWalk.valid ? busWalk.ahead : selfBusRide.ahead;
        const right = free && busWalk.valid ? busWalk.right : selfBusRide.right;
        return villageBusCabinTargets(selfBusRide.slot, ahead, right, takenBusSpots(), busOnRoad(), busRiderPoints(), free && busWalk.valid ? busWalk.yaw : undefined, busSeatPreferred.index);
      }
      const base = villageAndHallTargets(area, p.x, p.z, cubbyCardState() !== null || guideDialogOpen() !== null || keypadOpen);
      const bus = villageBusTarget(area, p.x, p.z, boarded, ...busScheduleNow(), busOnRoad());
      // within the keypad's 2 m of a house door the house's model starts to come (it is usually in by the time the code is typed)
      const keypad = base.find((t) => t.id.startsWith(KEYPAD_TARGET_PREFIX));
      if (keypad) {
        const n = houseNumberOf(keypad.id.slice(KEYPAD_TARGET_PREFIX.length));
        if (n !== null && houseOpen(keypad.id.slice(KEYPAD_TARGET_PREFIX.length))) prefetchHouse(n);
      }
      return bus ? [...base, bus] : base;
    });
    setTargetHandler((target, phase) => {
      if (phase !== "press") return;
      if (target.id === BUS_RIDE_TARGET_BOARD) {
        clearClickTarget();
        const [boardingNow, departsInMs] = busScheduleNow();
        // Outside the boarding window (3 min before each departure): say when the bus leaves (the server would refuse; review 2026-11-15)
        if (!boardingNow) showTransitNotice(busWaitNotice(departsInMs));
        else sendBusRide("board");
        return;
      }
      if (target.id === COASTER_BOARD_TARGET_ID) {
        clearClickTarget();
        startRideAudio(); // inside the press: the browser lets the sound start
        sendRideBoard();
        return;
      }
      if (target.id === BUS_RIDE_TARGET_LEAVE) {
        clearClickTarget();
        sendBusRide("leave");
        return;
      }
      if (target.id === BUS_STAND_TARGET_ID) {
        sendBusStand();
        return;
      }
      const sit = parseBusSitTarget(target.id);
      if (sit) {
        clearClickTarget();
        sendBusSit(sit.kind, sit.index);
        return;
      }
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
      if (target.kind === "object" && target.id.startsWith(LOT_DOOR_TARGET_PREFIX)) {
        const pad = lotDoorPadById(target.id);
        if (pad) showTransitNotice(lotDoorNotice(pad));
        return;
      }
      if (target.kind === "object" && target.id.startsWith(KEYPAD_TARGET_PREFIX)) {
        clearClickTarget();
        openKeypad(target.id.slice(KEYPAD_TARGET_PREFIX.length));
        return;
      }
      if (target.kind !== "door") return;
      clearClickTarget(); // a click-move in progress must not walk on after the teleport
      const stair = target.id.startsWith(HOUSE_STAIR_TARGET_PREFIX);
      doorFade.begin(() => {
        // walked away while the curtain closed (the same thing still offered, or nothing to use)
        if (!villageTargets(localArea(), pose.x, pose.z).some((t) => t.id === target.id)) return false;
        if (stair) sendUseStair();
        else sendUseDoor();
        return true;
      });
    });
    return () => {
      setTargetSource(null);
      setTargetHandler(null);
    };
  }, [pose, boarded, keypadOpen]);
  // A tap on a house's stair or front door armed its use (houseTap.ts): once the walk has brought us into the pad's reach, it is used.
  useFrame(() => {
    const area = localArea();
    if (!isHouseArea(area)) return;
    const offered = villageTargets(area, pose.x, pose.z);
    const id = takeArmedHouseUse(offered.map((t) => t.id));
    const target = id === null ? undefined : offered.find((t) => t.id === id);
    if (target) fireTarget(target, "press");
  });
  return null;
}

/**
 * The live shadows' colour in the village (review r3): the school's indigo (#2b2a55) laid a purple-blue band and square
 * on the road under the signals' arms and heads and round the bus. Shade on sunlit asphalt is a neutral dark grey.
 */
const VILLAGE_SHADOW_COLOR = "#1d1e22";

/** The first ride on this device shows the "look around" hint once (a per-device convenience: browser storage, never required). */
const RIDE_HINT_KEY = "cv.busRideHintSeen";
function rideHintSeen(): boolean {
  try {
    return window.localStorage.getItem(RIDE_HINT_KEY) === "1";
  } catch {
    return false;
  }
}
function markRideHintSeen(): void {
  try {
    window.localStorage.setItem(RIDE_HINT_KEY, "1");
  } catch {
    /* private window: the hint just shows again next time */
  }
}

/** The quick views: the camera eases to look out of the left windows, the front, the right windows (the doors' side) or the back. */
const RIDE_VIEWS: ReadonlyArray<{ id: string; label: string; short: string; yaw: number }> = [
  { id: "left", label: "◀ 왼쪽 창", short: "◀ 왼쪽", yaw: BUS_VIEW_YAW.left },
  { id: "front", label: "앞", short: "앞", yaw: BUS_VIEW_YAW.front },
  { id: "right", label: "오른쪽 창 ▶", short: "오른쪽 ▶", yaw: BUS_VIEW_YAW.right },
  { id: "back", label: "뒤", short: "뒤", yaw: BUS_VIEW_YAW.back },
];

/**
 * The ride panel (owner 2026-11-15): where the bus is, the way to look around (drag the screen, or the quick views: left
 * windows, front, right windows, back), how to sit or stand, and the way off. The hint shows once per device.
 */
function TransitRideHud() {
  const { boarded, snapshot, notice } = useTransitState();
  const touch = isTouchDevice;
  const [hint, setHint] = useState(false);
  useEffect(() => {
    if (!boarded || rideHintSeen()) return;
    setHint(true);
    markRideHintSeen();
    const id = window.setTimeout(() => setHint(false), 9000);
    return () => window.clearTimeout(id);
  }, [boarded]);
  if (!boarded && !notice) return null;
  const btn = {
    border: 0,
    borderRadius: 8,
    padding: "6px 8px",
    cursor: "pointer",
    fontSize: touch ? 13 : 12,
    background: "rgba(255,255,255,0.92)",
    color: "#1b2147",
    // bus v3 QA: every button in the ride panel is a full 48 px tap target on a phone (the views were 24 x 34)
    minHeight: touch ? 48 : 34,
    minWidth: touch ? 48 : undefined,
  } as const;
  return (
    <div
      style={{
        marginTop: 8,
        padding: "8px 10px",
        borderRadius: 10,
        background: "rgba(20, 28, 52, 0.82)",
        color: "#fff",
        fontSize: touch ? 11 : 12,
        lineHeight: 1.3,
        pointerEvents: "auto",
        maxWidth: touch ? 196 : 232,
      }}
      data-testid="bus-ride-hud"
    >
      {boarded ? (
        <>
          <div>🚌 버스 탑승 중</div>
          {touch && !hint ? null : <div style={{ opacity: 0.75 }}>{rideStatusText(snapshot, busCountdownWords(busScheduleNow()[1]).long)}</div>}
          {notice ? (
            // why a seat was refused (taken, the wrong side of a backed seat, too far): a rider must see it
            <div role="alert" data-testid="bus-ride-notice" style={{ marginTop: 5, background: "rgba(255,196,64,0.28)", borderRadius: 8, padding: "5px 8px" }}>
              {notice}
            </div>
          ) : null}
          <div
            style={touch ? { marginTop: 6, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 } : { marginTop: 6, display: "flex", flexWrap: "nowrap", gap: 4 }}
            data-testid="bus-ride-views"
          >
            {RIDE_VIEWS.map((v) => (
              <button key={v.id} type="button" data-view={v.id} style={{ ...btn, padding: "6px 6px", whiteSpace: "nowrap", flex: "0 0 auto" }} onClick={() => { busCamGoal.yaw = v.yaw; }}>
                {touch ? v.short : v.label}
              </button>
            ))}
          </div>
          {hint ? (
            <div style={{ marginTop: 6, background: "rgba(139,92,246,0.35)", borderRadius: 8, padding: "6px 8px" }} data-testid="bus-ride-hint">
              {touch ? "화면을 끌어서 창밖을 둘러보세요 · 빈 의자를 톡 누르면 가서 앉아요" : "화면을 끌어서 창밖을 둘러보세요 · 빈 의자를 누르거나 가까이에서 E"}
            </div>
          ) : touch ? null : (
            <div style={{ marginTop: 5, opacity: 0.7 }}>화면을 끌면 둘러볼 수 있어요 · 의자를 누르거나 가까이에서 E</div>
          )}
          {snapshot?.status === "inTransit" ? (
            // the doors open only at the stop (the server refuses a leave on the lap): say when instead of a dead button
            <div style={{ marginTop: 4, opacity: 0.75 }}>정류장에 돌아오면 내려요</div>
          ) : (
            <button type="button" onClick={() => sendBusRide("leave")} style={{ ...btn, marginTop: 6, width: touch ? "100%" : undefined }}>
              하차
            </button>
          )}
        </>
      ) : (
        <div>{notice}</div>
      )}
    </div>
  );
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
  useEffect(() => (room ? startTransitSync(room as unknown as TransitRoom) : undefined), [room]);
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
  // The village's built vegetation is kept while this scene is up (indoors too): freed one tick after it goes.
  useEffect(() => vegetationPark.hold(), []);
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
      shadowColor={VILLAGE_SHADOW_COLOR}
      shadowFloor={area !== "village" || !liveSunEnabled()}
      world3d={({ pose, seat }) => (
        <>
          {area === "village" && <MapPlaces pose={pose} seat={seat} />}
          <DayNight area={area} tier={tier} />
          {/* The lake lamps' lights, from the first frame and in every area (hall, houses: far away, they light nothing
              there): the scene's light count is part of every lit shader, so it never changes (perf/no-hitch). */}
          <LakeLampLights tier={tier} />
          <VillageArea area={area} tier={tier} pose={pose} />
          <GuideNpcs area={area} />
          <VillageDoors pose={pose} />
          <LandPoseProbe pose={pose} />
          {(area === "village" || area === "park") && <StarSky tier={tier} />}
          <VeilFrameThrottle active={area === "village"} />
        </>
      )}
      hudColumn={
        <>
          <VillageMusic />
          <TransitRideHud />
          <CoasterHud />
          <StarFinderButton />
        </>
      }
      hud={({ orbit, pose, seat }) => (
        <>
          <VegVeil active={area === "village"} />
          <DoorFade />
          <HouseEntryCover />
          <CubbyView />
          <MemorialOverlays />
          <GuideDialog />
          <StarFinder orbit={orbit} />
          {area === "village" && <LakeHud pose={pose} seat={seat} orbit={orbit} />}
          {area === "village" && <CrosswalkHintPill pose={pose} />}
          {area === "village" && <BusStopHintPill pose={pose} />}
          <VillageKeypad />
        </>
      )}
    />
  );
}

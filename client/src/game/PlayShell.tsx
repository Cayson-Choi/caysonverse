import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { KeyboardControls, useProgress } from "@react-three/drei";
import { Object3D, type DirectionalLight, type HemisphereLight } from "three";
import type { Room } from "@colyseus/sdk";
// TYPE-ONLY: schema decorators must never enter the browser bundle.
import type { WorldState } from "@caysonverse/shared/schema";
import { CAMERA, CAMERA_FAR, MOVE_KEYS } from "./constants";
import { LocalPlayer } from "./LocalPlayer";
import { RemotePlayers } from "./RemotePlayers";
import { CameraRig } from "./CameraRig";
import { OverviewMarker } from "./OverviewMarker";
import { ClickMarker } from "./ClickMarker";
import { NametagSystem } from "./NametagSystem";
import { RenderStatsProbe } from "./RenderStatsProbe";
import { QualityEffects, ShadowFloor, useQualityTier } from "./QualityEffects";
import { SceneWarmUp } from "./SceneWarmUp";
import { QUALITY, exposureFor, skyBeforeToneMap } from "./quality";
import { mapBounds, setActiveMap, type ActiveMap } from "./activeMap";
import { overviewAllowed } from "./indoorCamera";
import type { AreaGate } from "./areaFilter";
import { LIGHTING, type LightingId } from "./sceneLighting";
import { LightRigContext, type LightRig } from "./lightRig";
import { GroundDecalContext, type GroundDecal } from "./groundDecal";
import type { PlayersRoom } from "./remoteSync";
import { Chat } from "../ui/Chat";
import { ChatLog } from "../ui/ChatLog";
import { EmojiPalette } from "../ui/EmojiPalette";
import { EmojiFan } from "../ui/EmojiFan";
import { HudTop } from "../ui/HudTop";
import { TouchJoystick } from "../ui/TouchJoystick";
import { ActionButton } from "../ui/ActionButton";
import { JumpButton } from "../ui/JumpButton";
import { Banner } from "../ui/Banner";
import { AdminPanel } from "../ui/AdminPanel";
import { MenuPanel } from "../ui/MenuPanel";
import { CoachMarks } from "../ui/CoachMarks";
import { startJumpSync } from "../net/jumpSync";
import { isTouchDevice } from "../device";
import { getRenderProfile } from "./renderProfile";
import { releaseAllUiCapture } from "./uiCapture";
import { resetViewMode, toggleViewMode, toggleOverview, viewState } from "./viewState";
import { bindNametagMode } from "./settingsBridge";
import { useAppStore } from "../stores/appStore";
import { useCoachStore } from "../stores/coachStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useUiStore } from "../stores/uiStore";
import type { Identity } from "../stores/appStore";
import type { MoveInput } from "./input";
import type { Orbit, Pose, SeatState } from "./types";

/**
 * The per-frame objects a scene's own parts may read (never React state): the local pose
 * (LocalPlayer writes it), the camera orbit and the server-confirmed seat.
 */
export interface ShellFrame {
  pose: Pose;
  orbit: Orbit;
  seat: SeatState;
}

/** A scene slot: plain nodes, or a function of the shell's frame objects. */
export type ShellSlot = ReactNode | ((shell: ShellFrame) => ReactNode);

export interface PlayShellProps {
  identity: Identity;
  /** The room this scene's players live in (the class for the hall, the classroom inside one). */
  room: PlayersRoom;
  /** Set as THE active map while this scene is up (collision, camera, click-move, HUD). */
  activeMap: ActiveMap;
  lighting: LightingId;
  /**
   * The school scenes' look (Task 21): the player's graphics tier (bloom, soft shadows or the light budget,
   * its dpr) and brightness. The hall and the classrooms turn it on; off = the old render budget, no post effects.
   */
  effects: boolean;
  /** The scene's own 3D content, inside the Canvas. */
  world3d: ShellSlot;
  /** The scene's own DOM overlay, after the shared HUD. */
  hud: ShellSlot;
  /** Extra rows under the top-left 👥 column (after the touch chat log and the admin panel). */
  hudColumn?: ReactNode;
  /**
   * Whether the teacher's own admin panel hangs in the top-left column (default true). The hall hosts
   * it inside its teacher panel instead (`hudColumn`), so it passes false.
   */
  adminPanel?: boolean;
  /**
   * Half-size (m) of the sun's shadow box when it should FOLLOW the local player instead of covering the whole map
   * (default: the whole map). A long map (the hub: hall + a 34 m corridor) would stretch one shadow map over 70 m
   * and blur every shadow; a box this big around the player keeps the texels small wherever they walk.
   */
  shadowFollowHalf?: number;
  /**
   * 케이슨 마을: the local player's area. Given, the remote players are filtered by it (only the avatars of the
   * viewer's own area are mounted — areaFilter.ts). Absent in every other scene: nobody has an area there.
   */
  areas?: AreaGate;
  /**
   * The camera's near and far planes (m), where they differ from the school's 0.1 / CAMERA_FAR: 케이슨 마을 draws a
   * sky dome 1.4 km out (VillageScene). Read when the Canvas is made; the far plane is the camera rig's base.
   */
  cameraPlanes?: { near: number; far: number };
  /**
   * Where the ground decals lie (the avatars' blob shadows, the rich tier's shadow floor): height and polygon offset.
   * Default: 3 cm, no offset (every scene but 케이슨 마을, whose ground layers carry offsets of their own).
   */
  groundDecal?: GroundDecal;
}

/**
 * Keeps the sun's shadow box centred on the local player: every frame the light and its target slide by the
 * player's position (the light keeps its offset `key` from the target, so the direction never changes — unless the
 * scene moves the sun itself by writing the offset in place, 케이슨 마을's day and night). Plain number writes,
 * nothing allocated.
 */
function SunFollow({
  sun,
  target,
  pose,
  key3,
}: {
  sun: RefObject<DirectionalLight | null>;
  target: Object3D;
  pose: Pose;
  key3: readonly [number, number, number];
}) {
  useFrame(() => {
    const light = sun.current;
    if (!light) return;
    target.position.set(pose.x, 0, pose.z);
    light.position.set(pose.x + key3[0], key3[1], pose.z + key3[2]);
  });
  return null;
}

/** The school scenes' camera planes. */
const DEFAULT_PLANES = { near: 0.1, far: CAMERA_FAR } as const;

function renderSlot(slot: ShellSlot, shell: ShellFrame): ReactNode {
  return typeof slot === "function" ? slot(shell) : slot;
}

/** DOM loading overlay driven by three's loader progress (GLB fetch/parse). */
function LoadingOverlay() {
  const { active } = useProgress();
  if (!active) return null;
  return <div className="cv-loading">불러오는 중…</div>;
}

/** The local player's synced spawn, else the middle of the map (the server places us before we mount). */
function readSpawn(room: PlayersRoom, map: ActiveMap): Pose {
  const me = room.state?.players?.get?.(room.sessionId);
  const b = mapBounds(map);
  return {
    x: me?.x ?? (b.minX + b.maxX) / 2,
    z: me?.z ?? (b.minZ + b.maxZ) / 2,
    yaw: me?.yaw ?? 0,
  };
}

/**
 * The play scene every school map shares (AI 학교 탈출, Task 15): the Canvas with its lights,
 * the keyboard map, the local player, the other players of `room`, the camera rig, the
 * destination ring, the name tags — and the common HUD (chat, emoji, top bar, touch stick and
 * buttons, guide, menu). A scene brings only its map (`activeMap`), its lighting preset and
 * its own 3D content and HUD.
 *
 * The active map is set WHILE RENDERING, before any child reads it (the HUD's room name reads
 * it in its first render), and the same object again is ignored (activeMap.ts), so a
 * re-render costs nothing and a new map (the gate opening) is one version bump.
 *
 * Per-frame data (pose, orbit, joystick intent, seat) lives in objects made once here and
 * mutated in place — never React state.
 */
export function PlayShell(p: PlayShellProps) {
  setActiveMap(p.activeMap);
  const { identity, room } = p;

  // Local-only: gates the admin panel (the teacher, in a class).
  const isAdmin = useAppStore((s) => s.isAdmin);
  const leftHanded = useSettingsStore((s) => s.settings.leftHanded);
  useEffect(() => bindNametagMode(), []);

  // The orbit starts at the world's default; CameraRig puts the player's remembered zoom and tilt on it before its first
  // frame (cameraMemory.ts), so every scene — the village, the hall, the hub, a classroom — starts where the player left
  // the camera. No scene has a camera preset of its own (owner 2026-11-10).
  const [frame] = useState<ShellFrame>(() => ({
    pose: readSpawn(room, p.activeMap),
    orbit: { yaw: CAMERA.yaw, pitch: CAMERA.pitch, distance: CAMERA.distance },
    seat: { index: -1 },
  }));
  const { pose, orbit, seat } = frame;
  const [moveInput] = useState<MoveInput>(() => ({ forward: 0, right: 0, run: false }));

  // Every fresh scene starts uncaptured, in third person, with no panel open (see WorldScene).
  useEffect(() => {
    releaseAllUiCapture();
    resetViewMode();
    useUiStore.getState().resetPanels();
  }, []);

  // Other players' jumps; our own echo is skipped (it plays the instant we press).
  useEffect(
    () => startJumpSync(room as unknown as Room<WorldState>, identity.sessionId),
    [room, identity.sessionId],
  );

  // The graphics tier (the player's setting; "auto" = the device) and brightness, for the school scenes.
  const tier = useQualityTier();
  const brightness = useSettingsStore((s) => s.settings.brightness);
  // One render budget source (ruling E17): dpr cap, real vs blob shadows. A tier drives it; no tier = the old matrix.
  const profile = getRenderProfile(isTouchDevice, p.effects ? tier : undefined);
  // On the rich tier the bloom chain tone-maps the WHOLE frame, clear colour included, which would wash the sky
  // out to a dull grey-blue next to the light tier's (a renderer does not tone-map its clear colour). So there
  // the clear colour is the one that tone-maps back into the sky (quality.ts); once per sky and brightness.
  const toneMappedFrame = p.effects && QUALITY[tier].bloom;
  const skyClear = useMemo<[number, number, number] | null>(
    () =>
      toneMappedFrame
        ? skyBeforeToneMap(
            LIGHTING[p.lighting].sky,
            exposureFor(brightness) * (LIGHTING[p.lighting].exposure ?? 1),
            LIGHTING[p.lighting].toneCurve,
          )
        : null,
    [toneMappedFrame, p.lighting, brightness],
  );
  // The light tier's flat panels (quality.css) hang on this mark on <html>.
  useEffect(() => {
    if (!p.effects) return;
    document.documentElement.dataset.gfx = tier;
    return () => {
      delete document.documentElement.dataset.gfx;
    };
  }, [p.effects, tier]);

  // The sun aims at the middle of the map, and its shadow box covers the whole map. "The map" is the part the
  // local player is in (the village scene: the village OR the hall's room — activeMap.ts `mapBounds`).
  const light = LIGHTING[p.lighting];
  const planes = p.cameraPlanes ?? DEFAULT_PLANES;
  const b = mapBounds(p.activeMap);
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const half = p.shadowFollowHalf ?? Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + 4;
  const sunRef = useRef<DirectionalLight>(null);
  const hemiRef = useRef<HemisphereLight>(null);
  const [kx, ky, kz] = light.key.position;
  // The sun's offset from its target: this scene's own (the day and night move it by writing it in place).
  const [keyOffset] = useState<[number, number, number]>(() => [kx, ky, kz]);
  const rig = useMemo<LightRig>(() => ({ sun: sunRef, hemi: hemiRef, keyOffset }), [keyOffset]);
  const sunTarget = useMemo(() => {
    const o = new Object3D();
    o.position.set(cx, 0, cz);
    return o;
  }, [cx, cz]);

  const toggleViewUnlessMap = () => {
    if (viewState.mode !== "ov") toggleViewMode(orbit);
  };

  return (
    <>
      <Canvas
        className="cv-canvas"
        dpr={profile.dpr}
        // "percentage" is the shadow map three 0.185 really draws for the old "soft" one (PCFSoftShadowMap is deprecated
        // there and falls back to it with a console warning on every context).
        shadows={profile.shadows ? "percentage" : false}
        camera={{ fov: 55, near: planes.near, far: planes.far, position: [pose.x, 3, pose.z + 8] }}
      >
        <color attach="background" args={skyClear ?? [light.sky]} />
        <fog attach="fog" args={[light.sky, light.fog[0], light.fog[1]]} />
        <hemisphereLight ref={hemiRef} args={[light.hemi[0], light.hemi[1], light.hemi[2]]} />
        <primitive object={sunTarget} />
        <directionalLight
          ref={sunRef}
          castShadow={profile.shadows}
          color={light.key.color}
          intensity={light.key.intensity}
          position={[cx + kx, ky, cz + kz]}
          target={sunTarget}
          shadow-mapSize={[1024, 1024]}
          shadow-camera-near={1}
          shadow-camera-far={Math.hypot(kx, ky, kz) + 2 * half}
          shadow-camera-left={-half}
          shadow-camera-right={half}
          shadow-camera-top={half}
          shadow-camera-bottom={-half}
        />
        {p.shadowFollowHalf !== undefined && profile.shadows && (
          <SunFollow sun={sunRef} target={sunTarget} pose={pose} key3={keyOffset} />
        )}

        <KeyboardControls map={MOVE_KEYS}>
          <LightRigContext.Provider value={rig}>
            <GroundDecalContext.Provider value={p.groundDecal ?? null}>
              <Suspense fallback={null}>
                {renderSlot(p.world3d, frame)}
                <LocalPlayer
                  sessionId={identity.sessionId}
                  nickname={identity.nickname}
                  appearance={identity.appearance}
                  pose={pose}
                  orbit={orbit}
                  seat={seat}
                  moveInput={moveInput}
                  blobShadow={profile.blobShadows}
                />
                <RemotePlayers room={room} selfPose={pose} selfSeat={seat} blobShadow={profile.blobShadows} areas={p.areas} />
                <OverviewMarker pose={pose} />
                <ClickMarker />
                <SceneWarmUp key={tier} emoji />
              </Suspense>
            </GroundDecalContext.Provider>
          </LightRigContext.Provider>
          <CameraRig pose={pose} orbit={orbit} seat={seat} fogRange={light.fog} far={planes.far} />
        </KeyboardControls>
        <NametagSystem />
        {p.effects && <QualityEffects tier={tier} brightness={brightness} exposure={light.exposure} toneCurve={light.toneCurve} />}
        {p.effects && profile.shadows && <ShadowFloor bounds={b} decal={p.groundDecal ?? null} />}
        {import.meta.env.DEV && <RenderStatsProbe />}
      </Canvas>
      <LoadingOverlay />
      <Banner />
      <Chat />
      {isTouchDevice ? <EmojiFan /> : <EmojiPalette />}
      <HudTop
        pose={pose}
        onToggleView={toggleViewUnlessMap}
        onToggleOverview={() => toggleOverview()}
        overviewDisabled={!overviewAllowed(p.activeMap.cameraLimit)}
      >
        {isTouchDevice && <ChatLog />}
        {isAdmin && p.adminPanel !== false && <AdminPanel />}
        {p.hudColumn}
      </HudTop>
      {/* E / F and the context button (on the school maps: the scene's own targets only, no seats, no 조교 — E6). */}
      <ActionButton pose={pose} seat={seat} />
      {isTouchDevice && <JumpButton sessionId={identity.sessionId} />}
      {isTouchDevice && <TouchJoystick moveInput={moveInput} leftHanded={leftHanded} />}
      <CoachMarks pose={pose} orbit={orbit} />
      {renderSlot(p.hud, frame)}
      <MenuPanel
        graphics={p.effects}
        onToggleView={toggleViewUnlessMap}
        onShowGuide={() => useCoachStore.getState().report("restart")}
      />
    </>
  );
}

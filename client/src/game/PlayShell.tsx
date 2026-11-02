import { Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { Canvas } from "@react-three/fiber";
import { KeyboardControls, useProgress } from "@react-three/drei";
import { Object3D } from "three";
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
import { QUALITY, exposureFor, skyBeforeToneMap } from "./quality";
import { setActiveMap, type ActiveMap } from "./activeMap";
import { LIGHTING, type LightingId } from "./sceneLighting";
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
}

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
  const b = map.geometry.bounds;
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
    () => (toneMappedFrame ? skyBeforeToneMap(LIGHTING[p.lighting].sky, exposureFor(brightness)) : null),
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

  // The sun aims at the middle of the map, and its shadow box covers the whole map.
  const light = LIGHTING[p.lighting];
  const b = p.activeMap.geometry.bounds;
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const half = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + 4;
  const [kx, ky, kz] = light.key.position;
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
        camera={{ fov: 55, near: 0.1, far: CAMERA_FAR, position: [pose.x, 3, pose.z + 8] }}
      >
        <color attach="background" args={skyClear ?? [light.sky]} />
        <fog attach="fog" args={[light.sky, light.fog[0], light.fog[1]]} />
        <hemisphereLight args={[light.hemi[0], light.hemi[1], light.hemi[2]]} />
        <primitive object={sunTarget} />
        <directionalLight
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

        <KeyboardControls map={MOVE_KEYS}>
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
            <RemotePlayers room={room} selfPose={pose} selfSeat={seat} blobShadow={profile.blobShadows} />
            <OverviewMarker pose={pose} />
            <ClickMarker />
          </Suspense>
          <CameraRig pose={pose} orbit={orbit} seat={seat} fogRange={light.fog} />
        </KeyboardControls>
        <NametagSystem />
        {p.effects && <QualityEffects tier={tier} brightness={brightness} />}
        {p.effects && profile.shadows && <ShadowFloor bounds={b} />}
        {import.meta.env.DEV && <RenderStatsProbe />}
      </Canvas>
      <LoadingOverlay />
      <Banner />
      <Chat />
      {isTouchDevice ? <EmojiFan /> : <EmojiPalette />}
      <HudTop pose={pose} onToggleView={toggleViewUnlessMap} onToggleOverview={() => toggleOverview()}>
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

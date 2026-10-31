import { Suspense, useEffect, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { KeyboardControls, useProgress } from "@react-three/drei";
import { SPAWN_POINT } from "@caysonverse/shared/constants";
import { CAMERA, FOG_FAR, FOG_NEAR, MOVE_KEYS, SKY_COLOR } from "./constants";
import { LocalPlayer } from "./LocalPlayer";
import { RemotePlayers } from "./RemotePlayers";
import { WorldMap } from "./WorldMap";
import { NpcCharacter } from "./NpcCharacter";
import { NPCS } from "./npc";
import { NpcChatPanel } from "../ui/NpcChatPanel";
import { CameraRig } from "./CameraRig";
import { OverviewMarker } from "./OverviewMarker";
import { ClickMarker } from "./ClickMarker";
import { Chat } from "../ui/Chat";
import { EmojiPalette } from "../ui/EmojiPalette";
import { TouchJoystick } from "../ui/TouchJoystick";
import { ActionButton } from "../ui/ActionButton";
import { JumpButton } from "../ui/JumpButton";
import { ViewToggle } from "../ui/ViewToggle";
import { OverviewToggle } from "../ui/OverviewToggle";
import { SoundToggle } from "../ui/SoundToggle";
import { Banner } from "../ui/Banner";
import { AdminPanel } from "../ui/AdminPanel";
import { getRoom } from "../net/connection";
import { startJumpSync } from "../net/jumpSync";
import { isTouchDevice } from "../device";
import { getRenderProfile } from "./renderProfile";
import { setUiCaptured } from "./uiCapture";
import { resetViewMode, toggleViewMode, toggleOverview } from "./viewState";
import { useAppStore } from "../stores/appStore";
import type { Identity } from "../stores/appStore";
import type { MoveInput } from "./input";
import type { Orbit, Pose, SeatState } from "./types";

/** DOM loading overlay driven by three's loader progress (GLB fetch/parse). */
function LoadingOverlay() {
  const { active } = useProgress();
  if (!active) return null;
  return <div className="cv-loading">불러오는 중…</div>;
}

/** Seed the local pose from the authoritative server spawn (falls back safely). */
function readSpawn(): Pose {
  const room = getRoom();
  // Null-safe: the reflection-decoded state/map may not be fully shaped yet.
  const me = room?.state?.players?.get?.(room.sessionId);
  return { x: me?.x ?? SPAWN_POINT.x, z: me?.z ?? SPAWN_POINT.z, yaw: me?.yaw ?? 0 };
}

export function WorldScene({ identity }: { identity: Identity }) {
  // Local-only: gates the admin panel. Never derived from schema state.
  const isAdmin = useAppStore((s) => s.isAdmin);

  // Per-frame mutable game state — created once, mutated in place, never in
  // React state. Shared by LocalPlayer (writes) and CameraRig (reads).
  const pose = useRef<Pose>(readSpawn()).current;
  const orbit = useRef<Orbit>({
    yaw: CAMERA.yaw,
    pitch: CAMERA.pitch,
    distance: CAMERA.distance,
  }).current;
  // Shared touch movement input (joystick intent + run flag). Written by
  // TouchJoystick, read by LocalPlayer and ADDED to the keyboard intent — one
  // movement path, no fork. `run` is OR-ed with the Shift key.
  const moveInput = useRef<MoveInput>({ forward: 0, right: 0, run: false }).current;
  // The local player's server-confirmed seat (schema-driven). Written by the
  // remote-sync self listener; read by LocalPlayer (pose/anim) + the ActionButton.
  const seat = useRef<SeatState>({ index: -1 }).current;

  // Belt-and-braces: every fresh world (initial join AND each reconnect remount,
  // since this scene is keyed by connectionEpoch) starts with movement UNcaptured
  // AND in third-person with the own avatar visible. The per-component unmount
  // cleanups already release the capture flag, but resetting on mount guarantees a
  // stranded capture — or a stuck FP with the avatar hidden — can never survive
  // into a new world (design 19: view mode does not persist across a reconnect).
  useEffect(() => {
    setUiCaptured(false);
    resetViewMode();
  }, []);

  // Other players' jumps (Task 11): the server's jump broadcast feeds the registry the
  // avatars read each frame. Our own echo is skipped — it plays the instant we press.
  // The scene remounts per connection epoch, so this rebinds to every new room.
  useEffect(() => {
    const room = getRoom();
    if (!room) return;
    return startJumpSync(room, identity.sessionId);
  }, [identity.sessionId]);

  // Static per-session render budget — chosen once at Canvas creation from the
  // touch verdict (no runtime switching): dpr cap, real vs blob shadows.
  const profile = getRenderProfile(isTouchDevice);

  return (
    <>
      <Canvas
        className="cv-canvas"
        dpr={profile.dpr}
        shadows={profile.shadows}
        camera={{ fov: 55, near: 0.1, far: 200, position: [0, 3, 8] }}
      >
        <color attach="background" args={[SKY_COLOR]} />
        <fog attach="fog" args={[SKY_COLOR, FOG_NEAR, FOG_FAR]} />

        {/* Daylight interior (design 30): near-white sky bounce + warm floor
            bounce, bright enough that the rooms read as a lit real building. */}
        <hemisphereLight args={[0xffffff, 0xd8cfc2, 1.1]} />
        <directionalLight
          castShadow={profile.shadows}
          position={[8, 14, 6]}
          intensity={1.7}
          shadow-mapSize={[1024, 1024]}
          shadow-camera-near={1}
          shadow-camera-far={60}
          shadow-camera-left={-35}
          shadow-camera-right={35}
          shadow-camera-top={35}
          shadow-camera-bottom={-35}
        />

        <KeyboardControls map={MOVE_KEYS}>
          <Suspense fallback={null}>
            {/* Furnished lounge + lecture hall, walls and screen (static). */}
            <WorldMap />
            {/* AI 조교 NPC 3인 — 강의실·로비·갤러리 (design 31 + 후속). */}
            {NPCS.map((npc) => (
              <NpcCharacter key={npc.id} npc={npc} />
            ))}
            <LocalPlayer
              sessionId={identity.sessionId}
              character={identity.character}
              tint={identity.tint}
              pose={pose}
              orbit={orbit}
              seat={seat}
              moveInput={moveInput}
              blobShadow={profile.blobShadows}
            />
            {/* Other connected players: snapshot-interpolated, tinted, nametagged.
                Mounts/unmounts on roster changes only; poses stream via the store. */}
            <RemotePlayers selfPose={pose} selfSeat={seat} blobShadow={profile.blobShadows} />
            {/* Overview-only self marker (design 20) — hidden outside overview. */}
            <OverviewMarker pose={pose} />
            {/* Destination ring for a floor click / tap walk (hidden when idle). */}
            <ClickMarker />
          </Suspense>
          <CameraRig pose={pose} orbit={orbit} seat={seat} />
        </KeyboardControls>
      </Canvas>
      <LoadingOverlay />
      <Banner />
      <Chat />
      <EmojiPalette />
      {/* First-person 👁 toggle — touch only (desktop uses V / wheel). Seeds yaw
          from the shared orbit so the world doesn't spin on toggle. */}
      <ViewToggle onToggle={() => toggleViewMode(orbit)} />
      {/* Overview 🗺 toggle — touch only (desktop uses M). Remembers the current
          mode and restores it on exit; the camera work lives in CameraRig. */}
      <OverviewToggle onToggle={() => toggleOverview()} />
      {/* TTS 🔊/🔇 mute toggle — every device (design 23). */}
      <SoundToggle />
      {/* E / F and the context button: sit, stand, or talk to an AI 조교 (Task 10). */}
      <ActionButton pose={pose} seat={seat} />
      {/* Jump button — touch only (desktop jumps with Space, handled in LocalPlayer).
          Sits at the bottom-right edge with the action button right above it. */}
      {isTouchDevice && <JumpButton sessionId={identity.sessionId} seat={seat} />}
      {/* AI 조교 private side-chat panel (design 31). */}
      <NpcChatPanel />
      {/* Movement control — touch devices only: the analog joystick in every view
          (first-person strafes camera-relative). Keyboard stays active regardless. */}
      {isTouchDevice && <TouchJoystick moveInput={moveInput} />}
      {isAdmin && <AdminPanel />}
    </>
  );
}

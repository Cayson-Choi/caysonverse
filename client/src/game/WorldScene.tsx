import { Suspense, useEffect, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { Grid, KeyboardControls, useProgress } from "@react-three/drei";
import { SPAWN_POINT, WORLD_BOUNDS } from "@caysonverse/shared/constants";
import { CAMERA, FOG_FAR, FOG_NEAR, MOVE_KEYS, SKY_COLOR } from "./constants";
import { LocalPlayer } from "./LocalPlayer";
import { RemotePlayers } from "./RemotePlayers";
import { WorldMap } from "./WorldMap";
import { CameraRig } from "./CameraRig";
import { Chat } from "../ui/Chat";
import { EmojiPalette } from "../ui/EmojiPalette";
import { TouchJoystick } from "../ui/TouchJoystick";
import { SitPrompt } from "../ui/SitPrompt";
import { Banner } from "../ui/Banner";
import { AdminPanel } from "../ui/AdminPanel";
import { getRoom } from "../net/connection";
import { isTouchDevice } from "../device";
import { getRenderProfile } from "./renderProfile";
import { setUiCaptured } from "./uiCapture";
import { useAppStore } from "../stores/appStore";
import type { Identity } from "../stores/appStore";
import type { Intent } from "./input";
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
  // Shared joystick movement intent (touch). Written by TouchJoystick, read by
  // LocalPlayer and ADDED to the keyboard intent — one movement path, no fork.
  const moveInput = useRef<Intent>({ forward: 0, right: 0 }).current;
  // The local player's server-confirmed seat (schema-driven). Written by the
  // remote-sync self listener; read by LocalPlayer (pose/anim) + the SitPrompt.
  const seat = useRef<SeatState>({ index: -1 }).current;

  // Belt-and-braces: every fresh world (initial join AND each reconnect remount,
  // since this scene is keyed by connectionEpoch) starts with movement UNcaptured.
  // The per-component unmount cleanups already release the flag, but resetting on
  // mount guarantees a stranded capture can never survive into a new world.
  useEffect(() => setUiCaptured(false), []);

  // Static per-session render budget — chosen once at Canvas creation from the
  // touch verdict (no runtime switching): dpr cap, real vs blob shadows.
  const profile = getRenderProfile(isTouchDevice);

  const width = WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX;
  const depth = WORLD_BOUNDS.maxZ - WORLD_BOUNDS.minZ;

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

        <hemisphereLight args={[0xbcd4ff, 0x2a2340, 0.85]} />
        <directionalLight
          castShadow={profile.shadows}
          position={[8, 14, 6]}
          intensity={1.4}
          shadow-mapSize={[1024, 1024]}
          shadow-camera-near={1}
          shadow-camera-far={60}
          shadow-camera-left={-35}
          shadow-camera-right={35}
          shadow-camera-top={35}
          shadow-camera-bottom={-35}
        />

        {/* Subtle floor grid over the whole playable area. */}
        <Grid
          args={[width, depth]}
          cellSize={1}
          cellColor="#3a3560"
          sectionSize={5}
          sectionColor="#5b53a0"
          fadeDistance={60}
          fadeStrength={1.5}
          infiniteGrid={false}
          position={[0, 0.02, 0]}
        />

        <KeyboardControls map={MOVE_KEYS}>
          <Suspense fallback={null}>
            {/* Furnished lounge + lecture hall, walls and screen (static). */}
            <WorldMap />
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
          </Suspense>
          <CameraRig pose={pose} orbit={orbit} />
        </KeyboardControls>
      </Canvas>
      <LoadingOverlay />
      <Banner />
      <Chat />
      <EmojiPalette />
      {/* Sit/stand prompt: desktop hint + touch button + occupied-seat notice. */}
      <SitPrompt pose={pose} seat={seat} />
      {/* Virtual joystick — touch devices only. Keyboard stays active regardless. */}
      {isTouchDevice && <TouchJoystick moveInput={moveInput} />}
      {isAdmin && <AdminPanel />}
    </>
  );
}

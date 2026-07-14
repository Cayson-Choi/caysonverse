import { Suspense, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { Grid, KeyboardControls, useProgress } from "@react-three/drei";
import { SPAWN_POINT, WORLD_BOUNDS } from "@caysonverse/shared/constants";
import { CAMERA, FOG_FAR, FOG_NEAR, MOVE_KEYS, SKY_COLOR } from "./constants";
import { LocalPlayer } from "./LocalPlayer";
import { RemotePlayers } from "./RemotePlayers";
import { WorldMap } from "./WorldMap";
import { CameraRig } from "./CameraRig";
import { getRoom } from "../net/connection";
import type { Identity } from "../stores/appStore";
import type { Orbit, Pose } from "./types";

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
  // Per-frame mutable game state — created once, mutated in place, never in
  // React state. Shared by LocalPlayer (writes) and CameraRig (reads).
  const pose = useRef<Pose>(readSpawn()).current;
  const orbit = useRef<Orbit>({
    yaw: CAMERA.yaw,
    pitch: CAMERA.pitch,
    distance: CAMERA.distance,
  }).current;

  const width = WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX;
  const depth = WORLD_BOUNDS.maxZ - WORLD_BOUNDS.minZ;

  return (
    <>
      <Canvas
        dpr={[1, 1.5]}
        shadows
        camera={{ fov: 55, near: 0.1, far: 200, position: [0, 3, 8] }}
      >
        <color attach="background" args={[SKY_COLOR]} />
        <fog attach="fog" args={[SKY_COLOR, FOG_NEAR, FOG_FAR]} />

        <hemisphereLight args={[0xbcd4ff, 0x2a2340, 0.85]} />
        <directionalLight
          castShadow
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
              character={identity.character}
              tint={identity.tint}
              pose={pose}
              orbit={orbit}
            />
            {/* Other connected players: snapshot-interpolated, tinted, nametagged.
                Mounts/unmounts on roster changes only; poses stream via the store. */}
            <RemotePlayers selfPose={pose} />
          </Suspense>
          <CameraRig pose={pose} orbit={orbit} />
        </KeyboardControls>
      </Canvas>
      <LoadingOverlay />
    </>
  );
}

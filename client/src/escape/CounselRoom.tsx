import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF, useTexture } from "@react-three/drei";
import type { Object3D, Texture } from "three";
import type { RoomId } from "@caysonverse/shared/escape/constants";
import { ROOM_MAPS, type RoomMap } from "@caysonverse/shared/school/roomMaps";
import { LightShafts } from "../game/LightShafts";
import { MapBoxes, collidersDebugOn } from "../game/MapBoxes";
import { useEscapeStore } from "../stores/escapeStore";
import { clearCounselCaches } from "./counselRelease";
import {
  COUNSEL_LIGHTMAP_URL,
  disposeCounsel,
  disposeModel,
  paintCounsel,
  placeDoor,
  prepareCounsel,
  setPartTargets,
  stepParts,
  type CounselNodes,
} from "./counselModelPrep";
import { LIGHTS_FROM, escapeClock, escapeTimeline, type EscapeFrame } from "./escapeTimeline";
import { prefersReducedMotion } from "./reducedMotion";

/**
 * The counselling room in the scene (AI 학교 탈출, Task 24): loads `counsel.glb` (no Draco) and its light map, dresses a clone
 * of it (counselModelPrep.ts: light map on the `LM_*` materials, no fog on the clouds, the `col__*` boxes hidden) and renders it,
 * the campus backdrop included — so there is no ground or box stand-in any more. On the rich tier the sunny windows
 * (`shaft__*`) get their light shafts.
 *
 * What the puzzle does to the room (COUNSEL_VISUALS, bound to the team's flags) happens on the model's own nodes: a picked-up
 * piece shrinks away, the cabinet door, the board's cover and the safe's door swing open, the solved board and the finale's
 * Ari screen glow — each over 0.4 s. The room is "broken" (a blue-grey multiply on its colours) until the escape; the escape
 * show (escapeTimeline.ts, the same clock the DOM veil and EscapeFx read) glows the last door, swings it open and brings the
 * colours back.
 *
 * Loading: the model is read (suspends) only when this component mounts, i.e. when a team is in the room — the entry
 * screen and the hall never fetch it. Leaving the room releases it for good (loader cache cleared, GPU resources freed).
 * Leaving while it is still loading (this component suspended, so its effects never ran) is covered by the classroom
 * scene, which holds the files while it shows the room and clears the caches when it goes (counselRelease.ts).
 *
 * Flags change a few times per game, so this re-renders on a flag change only (a joined string selector), never per frame and
 * never for the clock. The frame callback writes numbers into existing objects and does nothing at all while the room is at rest
 * (but the 반딧 figure's slow breathing).
 */

// The release of a left room waits one tick, so a remount in the same commit (React StrictMode in dev, a keyed remount) keeps it.
let releaseTimer: ReturnType<typeof setTimeout> | null = null;

function cancelRelease(): void {
  if (releaseTimer !== null) {
    clearTimeout(releaseTimer);
    releaseTimer = null;
  }
}

function scheduleRelease(url: string, scene: Object3D, lightmap: Texture): void {
  cancelRelease();
  releaseTimer = setTimeout(() => {
    releaseTimer = null;
    clearCounselCaches(url);
    disposeModel(scene);
    lightmap.dispose();
  }, 0);
}

/** The 반딧 figure's idle motion: a slow turn and a breath. */
const IDLE = { turn: 0.12, turnSpeed: 0.55, breath: 0.012, breathSpeed: 1.7 } as const;

/** Drives the model's nodes from the team's flags and the escape show. */
function CounselDriver({ nodes }: { nodes: CounselNodes }) {
  // One string for all flags: a new flag array every second (the clock) must not re-render this.
  const flagKey = useEscapeStore((s) => (s.view ? s.view.flags.join("|") : ""));
  const flags = useMemo(() => new Set(flagKey === "" ? [] : flagKey.split("|")), [flagKey]);
  const escaped = flags.has("escaped");
  const still = useMemo(() => prefersReducedMotion(), []);
  const frame = useMemo<EscapeFrame>(() => ({ doorGlow: 0, doorOpen: 0, lights: LIGHTS_FROM, showLines: false, showSummary: false }), []);
  // What the frame callback remembers between frames (plain numbers, not React state).
  const mem = useRef({ first: true, moving: false, lights: Number.NaN, glow: Number.NaN, open: Number.NaN, dirty: true });

  useEffect(() => {
    const m = mem.current;
    // The first look at the room, and a reduced-motion player's every change, put the parts where the flags say at once.
    m.moving = setPartTargets(nodes.parts, flags, m.first || still);
    m.first = false;
    m.dirty = true; // a glow part's colour follows its flag
  }, [nodes, flags, still]);

  useFrame(({ clock }, delta) => {
    const m = mem.current;
    if (m.moving) {
      m.moving = stepParts(nodes.parts, delta < 0.1 ? delta : 0.1);
      m.dirty = true;
    }

    // The escape show (or its result): how bright the room is and how far the last door has come.
    let lights = LIGHTS_FROM;
    let glow = 0;
    let open = 0;
    if (escapeClock.running()) {
      escapeTimeline(escapeClock.elapsed(performance.now()), false, frame);
      lights = frame.lights;
      glow = frame.doorGlow * (1 - 0.7 * frame.doorOpen);
      open = frame.doorOpen;
    } else if (escaped) {
      lights = 1;
      open = 1;
    }
    if (open !== m.open && nodes.door) {
      m.open = open;
      placeDoor(nodes.door, open);
    }
    if (m.dirty || lights !== m.lights || glow !== m.glow) {
      m.dirty = false;
      m.lights = lights;
      m.glow = glow;
      paintCounsel(nodes, lights, glow);
    }

    const bandit = nodes.bandit;
    if (bandit && !still) {
      const t = clock.elapsedTime;
      bandit.rotation.y = IDLE.turn * Math.sin(t * IDLE.turnSpeed);
      bandit.scale.y = 1 + IDLE.breath * Math.sin(t * IDLE.breathSpeed);
    }
  });
  return null;
}

function CounselModel({ map }: { map: RoomMap }) {
  // Both files download at once: the light map's request starts before the model's read suspends this component.
  useTexture.preload(COUNSEL_LIGHTMAP_URL);
  const gltf = useGLTF(map.glb, false);
  const lightmap = useTexture(COUNSEL_LIGHTMAP_URL);
  const nodes = useMemo(() => prepareCounsel(gltf.scene, lightmap, map.visuals), [gltf, lightmap, map]);
  const [debugColliders] = useState(() => collidersDebugOn());

  useEffect(() => () => disposeCounsel(nodes), [nodes]);
  useEffect(() => {
    cancelRelease();
    return () => scheduleRelease(map.glb, gltf.scene, lightmap);
  }, [map.glb, gltf, lightmap]);

  return (
    <>
      {/* dispose={null}: the geometry and shared materials belong to the loader's cache (released above); the copies are ours. */}
      <primitive object={nodes.root} dispose={null} />
      <LightShafts points={nodes.shafts} />
      <CounselDriver nodes={nodes} />
      {debugColliders && <MapBoxes geometry={map.geometry} variant="wire" />}
    </>
  );
}

export const CounselRoom = memo(function CounselRoom({ roomId }: { roomId: RoomId }) {
  const map = ROOM_MAPS[roomId];
  return map ? <CounselModel map={map} /> : null;
});

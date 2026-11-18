import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF, useTexture } from "@react-three/drei";
import {
  type MeshStandardMaterial,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  Vector3,
  type PointLight,
  type Texture,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { LoadBoundary } from "../village/LoadBoundary";
import { SceneWarmUp } from "../game/SceneWarmUp";
import { LakeShopkeeper } from "./LakeShopkeeper";
import { clearNpcCache } from "../village/npcAvatar";
import { DRACO_PATH } from "../game/hub/hubModelPrep";
import { dayNight } from "../village/dayNightDriver";
import type { Pose } from "../game/types";
import { LAKE_AREA, LAKE_FACE_DIR, LAKE_FISHING_SPOTS, LAKE_LAMPS, LAKE_SHORE, LAKE_WATER_Y, insidePolygon } from "@caysonverse/shared/village/lakeLayout";
import { LAKE_URLS, lakeAssetWanted } from "./lakeAssets";
import { createDrops } from "./lakeDrops";
import { LakeGreybox } from "./LakeGreybox";
import { createLakeWater, type LakeWater, type LakeWaterLook } from "./lakeWater";
import { DEFAULT_SEAM, disposeLake, lakeDayNight, prepareLakeStructures, prepareLakeTerrain, type LakeSeam } from "./lakeModelPrep";
import type { VillageTier } from "../village/villageModelPrep";
import { lakeFloatParts, loadLakeGear } from "./lakeProps";
import { LakeSigns } from "./LakeSigns";
import { LakeShopInterior } from "./LakeShopInterior";
import { LakeShore } from "./LakeShore";
import { floraOld, installLakeFlora } from "./lakeFlora";
import { CAST_S, floatPose, scatter, tugIndex, type FloatPose, type Pt } from "./lakeFloat";
import { elapsedSince, forEachAngler, selfId } from "./lakeNet";
import { FISH_PHASE, type FishView } from "./lakeProtocol";
import { rodTipOf } from "./rodTips";
import { hookPointOf } from "./fishHooks";
import { lineOnFish } from "./fishCatch";
import { installLakeFx } from "./lakeFx";
import { useLakeStore } from "./lakeStore";

/**
 * How long (ms) after the village the lake file is asked for. Short (perf/no-hitch, 2026-11-17): its preparation (the
 * water's ripple maps, the lake model) is a few hundred ms of main thread on a slow phone, best done while the arrival's
 * veil still covers the village (it lifts when the trees are grown, ~10 s on a 4x-CPU phone) than after.
 */
const IDLE_WAIT_MS = 1500;
/** A lamp's light at night (B's `light__lake_lamp_*`: warm, 14 m): physical units, tuned by eye on the pier at 23:00. */
const LAMP_LIGHT = { color: "#ffd9a0", intensity: 9, distance: 13, decay: 1.6 } as const;
/** A player past this x (the village's east edge region) asks for the lake file at once (design 10). */
const NEAR_X = 60;

let activeWater: LakeWater | null = null;
/** A ring on the lake's water (a no-op while no water is drawn). */
export function lakeRipple(x: number, z: number, strength: number): void {
  activeWater?.ripple(x, z, strength);
}

function dayLook() {
  const a = dayNight.applied;
  const t = a.waterTint;
  return { night: a.night, lights: a.lights, sunDir: a.keyDir, horizon: a.sky, tint: Math.max(0.15, (t[0] + t[1] + t[2]) / 3) };
}

/** The lake's own water: made once, ticked with the clock and the time of day. */
function useLakeWater(depthAttr: boolean, look?: LakeWaterLook, tier: VillageTier = "high"): LakeWater {
  const water = useMemo(() => createLakeWater({ depthAttr, look }), [depthAttr, look]);
  // the tier is a uniform: a tier change must not make a new material (a new program; GL warnings on phones)
  useEffect(() => water.setTier(tier), [water, tier]);
  useEffect(() => {
    activeWater = water;
    return () => {
      if (activeWater === water) activeWater = null;
      water.dispose();
    };
  }, [water]);
  useFrame(({ clock }) => water.update(clock.elapsedTime, dayLook()));
  return water;
}

/** Tell the village its old backdrop lake can go (lakeVillagePatch.ts): while anything of the new lake is drawn. */
function useDrawn(seam: LakeSeam): void {
  useEffect(() => {
    useLakeStore.setState({ drawn: true, seam });
    return () => useLakeStore.setState({ drawn: false, seam: DEFAULT_SEAM });
  }, [seam]);
}

function Greybox() {
  const water = useLakeWater(false);
  useDrawn(DEFAULT_SEAM);
  return <LakeGreybox water={water} />;
}

/**
 * lake.glb (A) and lake_structures.glb (B), dressed by lakeModelPrep.ts: the ground with A's day / night light maps through the
 * village's light-map recipe, the water with A's water data and reflection panoramas, the facilities with their helpers hidden
 * and their lamps lit at night.
 */
function LakeGlb({ tier, pose }: { tier: VillageTier; pose: Pose }) {
  const gltf = useGLTF(LAKE_URLS.lake, DRACO_PATH);
  const structs = useGLTF(LAKE_URLS.structures, DRACO_PATH);
  const [lmDay, lmNight, reflDay, reflNight, sLmDay, sLmNight] = useTexture([
    LAKE_URLS.lightmap,
    LAKE_URLS.lightmapNight,
    LAKE_URLS.reflDay,
    LAKE_URLS.reflNight,
    LAKE_URLS.structuresLm,
    LAKE_URLS.structuresLmNight,
  ]) as Texture[];
  const dressed = useMemo(() => {
    const terrain = gltf.scene.clone(true);
    const facilities = structs.scene.clone(true);
    const t = prepareLakeTerrain(terrain, lmDay!, lmNight!, tier, gltf.scene.userData);
    const f = prepareLakeStructures(facilities, sLmDay!, sLmNight!);
    return { terrain, facilities, ...t, ...f };
  }, [gltf, structs, lmDay, lmNight, sLmDay, sLmNight, tier]);
  useEffect(() => () => disposeLake(dressed), [dressed]);
  // the forest, willows, reeds and grass drawn again as real branching trees and card bunches on the file's own places (lakeFlora.ts)
  const flora = useMemo(() => (floraOld(window.location.search, import.meta.env.DEV) ? null : installLakeFlora(dressed.terrain, tier)), [dressed, tier]);
  useEffect(() => {
    if (!flora) return;
    dressed.terrain.add(flora.group);
    return () => flora.dispose();
  }, [flora, dressed]);
  useFrame(({ camera }) => flora?.update(camera.position));
  const look = useMemo<LakeWaterLook>(
    () => ({ reflDay: reflDay!, reflNight: reflNight!, lightmap: lmDay!, lightmapNight: lmNight!, lamps: dressed.lampHeads.map((p) => ({ x: p.x, z: p.z })) }),
    [reflDay, reflNight, lmDay, lmNight, dressed],
  );
  const water = useLakeWater(false, look, tier);
  useDrawn(dressed.seam);
  useEffect(() => {
    for (const m of dressed.water) {
      m.material = water.material;
      m.renderOrder = 2;
    }
  }, [dressed, water]);
  // the lamps' own lights (LakeLampLights) sit where the file's lamp heads are
  useEffect(() => {
    lampHeadsFromFile = dressed.lampHeads;
    return () => {
      if (lampHeadsFromFile === dressed.lampHeads) lampHeadsFromFile = null;
    };
  }, [dressed]);
  useFrame(() => {
    lakeDayNight(dressed, dayNight.applied);
  });
  return (
    <>
      <primitive object={dressed.terrain} dispose={null} />
      <primitive object={dressed.facilities} dispose={null} />
      {/* the shallows and the shore: the bed's real depth for the water, the wet bank, reeds and lily pads (LakeShore.tsx) */}
      <LakeShore terrain={dressed.terrain} water={water} tier={tier} />
      <LakeShopInterior />
      {/* the rental's shopkeeper behind the office window (owner 2026-11-16): npc.glb waits in a Suspense of its own; a failed one is no shopkeeper */}
      <LoadBoundary fallback={null} onReset={clearNpcCache} notice="대여점 주인 모습을 불러오지 못했어요. 잠시 뒤 다시 불러올게요.">
        <Suspense fallback={null}>
          <LakeShopkeeper structures={structs.scene} pose={pose} />
          {/* the shopkeeper's materials (npc.glb) compiled in idle time once he is in, not the first time he comes into view */}
          <SceneWarmUp />
        </Suspense>
      </LoadBoundary>
    </>
  );
}

/** The lake file's lamp heads (world), once it is in; LakeLampLights moves its lights onto them. */
let lampHeadsFromFile: readonly Vector3[] | null = null;
/** Lamp head height (m) before the file is in (the lights are dark by day, and the file comes long before dusk matters). */
const LAMP_HEAD_Y = 2.6;

/**
 * The lamps' own light at night on the pier and the 좌대 (the facilities' light maps carry the lamps' pools; these lights are for
 * the avatars): the rich tier only, dark by day. Mounted with the village scene itself in every area (VillageScene.tsx),
 * NOT with the lake file (which comes in seconds later):
 * the scene's light count is part of every lit material's shader, so lights that appear later recompile the whole village's
 * materials — that was the second-long freeze a while after entering (perf/no-hitch, e2e/perf-routes.mjs). One light per
 * LAKE_LAMPS entry, always; they move onto the file's lamp heads when it is in.
 */
export function LakeLampLights({ tier }: { tier: VillageTier }) {
  const lights = useRef<Array<PointLight | null>>([]);
  useFrame(() => {
    const k = LAMP_LIGHT.intensity * dayNight.applied.lights;
    const heads = lampHeadsFromFile;
    for (let i = 0; i < lights.current.length; i++) {
      const l = lights.current[i];
      if (!l) continue;
      l.intensity = k;
      const h = heads?.[i];
      if (h && (l.position.x !== h.x || l.position.z !== h.z)) l.position.set(h.x, h.y - 0.15, h.z);
    }
  });
  if (tier !== "high") return null;
  return (
    <>
      {LAKE_LAMPS.map((p, i) => (
        <pointLight
          key={i}
          ref={(l) => {
            lights.current[i] = l;
          }}
          position={[p.x, LAMP_HEAD_Y, p.z]}
          color={LAMP_LIGHT.color}
          intensity={0}
          distance={LAMP_LIGHT.distance}
          decay={LAMP_LIGHT.decay}
        />
      ))}
    </>
  );
}

/** The lake: its boxes at once when there is no file (placeholder), else the file after the village has settled (or on the way). */
function LakeModel({ tier, pose }: { tier: VillageTier; pose: Pose }) {
  const wanted = lakeAssetWanted("lake");
  const [go, setGo] = useState(!wanted);
  useEffect(() => {
    if (go) return;
    const idle = window.setTimeout(() => setGo(true), IDLE_WAIT_MS);
    return () => window.clearTimeout(idle);
  }, [go]);
  if (!wanted) return <Greybox />;
  return <>{go ? <LakeFromFile tier={tier} pose={pose} /> : <WatchForVisitor onNear={() => setGo(true)} />}</>;
}

function WatchForVisitor({ onNear }: { onNear: () => void }) {
  const near = useRef(onNear);
  near.current = onNear;
  useFrame(({ camera }) => {
    if (camera.position.x > NEAR_X) near.current();
  });
  return null;
}

function LakeFromFile({ tier, pose }: { tier: VillageTier; pose: Pose }) {
  return (
    <LoadBoundary
      fallback={<Greybox />}
      onReset={() => {
        useGLTF.clear(LAKE_URLS.lake);
        useGLTF.clear(LAKE_URLS.structures);
      }}
      notice="낚시터를 불러오지 못했어요. 잠시 뒤 다시 불러올게요."
    >
      <Suspense fallback={null}>
        <LakeGlb tier={tier} pose={pose} />
        {/* its materials compiled as soon as it is in, not the first time the lake comes into view (the map's first open) */}
        <SceneWarmUp key={tier} />
      </Suspense>
    </LoadBoundary>
  );
}

// ───────────────────────────────────────── the rental pad and the chair markers ─────────────────────────────────────────

// ───────────────────────────────────────── the floats, lines, rings and splashes ─────────────────────────────────────────

const LINE_POINTS = 24;
/** The float is drawn this much larger than design 4.4 (1.6x the real one): on a phone portrait screen it must read at 12 m (design 4.4: 30-40 px). */
const FLOAT_VIEW_SCALE = 1.35;
const MAX_SPLASH = 320;
/** The room holds 30; one more than that for a pending join. */
const MAX_FLOATS = 32;
const SEGMENTS = LINE_POINTS - 1;

interface Slot {
  index: number;
  visible: boolean;
  splashedSeq: number;
  tug: number;
  lastPhase: number;
  nextBeat: number;
  pose: FloatPose;
  target: Pt;
  side: Pt;
  seq: number;
  spot: number;
}

/** One float, vertex-coloured (origin = its top): red / yellow / green bands, a pale keme with a green glowing tip, the stem. All 32 are one InstancedMesh (one draw call). */
function createFloatGeometry(): BufferGeometry {
  const r = 0.024;
  const part = (g: BufferGeometry, color: string, y: number): BufferGeometry => {
    g.translate(0, y, 0);
    const c = new Color(color);
    const n = g.getAttribute("position").count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = c.r;
      arr[i * 3 + 1] = c.g;
      arr[i * 3 + 2] = c.b;
    }
    g.setAttribute("color", new Float32BufferAttribute(arr, 3));
    g.deleteAttribute("uv");
    return g;
  };
  const merged = mergeGeometries([
    part(new CylinderGeometry(r * 0.7, r, 0.085, 10), "#e03a2f", -0.0425),
    part(new CylinderGeometry(r, r, 0.075, 10), "#ffd23a", -0.1225),
    part(new CylinderGeometry(r, r * 0.8, 0.065, 10), "#35c25a", -0.1975),
    part(new CylinderGeometry(r * 0.35, r * 0.35, 0.09, 8), "#b9f5ff", 0.045),
    part(new SphereGeometry(0.014, 8, 6), "#7dffb2", 0.095),
    part(new CylinderGeometry(r * 0.8, r * 0.5, 0.5, 8), "#d9d9d9", -0.5),
  ]);
  if (!merged) throw new Error("lake float geometry");
  return merged;
}

const tmpTip = new Vector3();
const tmpOff = new Vector3();
const tmpM = new Matrix4();
const tmpQ = new Quaternion();
const tmpP = new Vector3();
const tmpS = new Vector3();
const ZERO_M = new Matrix4().makeScale(0, 0, 0);
const Z_AXIS = new Vector3(0, 0, 1);
const FACE_SIDE = (f: { x: number; z: number }, seq: number): Pt => {
  const s = seq % 2 === 0 ? 1 : -1;
  return { x: -f.z * s, z: f.x * s };
};

/**
 * Everyone's float and line, the rings and the splashes: drawn from the schema's fields, the same on every screen. All the floats are
 * ONE instanced mesh and all the lines ONE line-segment object (design 10: the lake adds at most 45 draw calls; 30 anglers add 4 here).
 */
function LakeAnglers() {
  // lake_gear.glb's float (chunk C) once it is in; the drawn stand-in until then
  const [gearIn, setGearIn] = useState(() => lakeFloatParts() !== null);
  useEffect(() => {
    if (gearIn) return;
    let live = true;
    void loadLakeGear().then(() => {
      if (live && lakeFloatParts()) setGearIn(true);
    });
    return () => {
      live = false;
    };
  }, [gearIn]);
  const parts = useMemo(() => {
    const slots = new Map<string, Slot>();
    const real = gearIn ? lakeFloatParts() : null;
    const floatGeo = real?.body ? real.body.geometry.clone().applyMatrix4(real.body.matrixWorld) : createFloatGeometry();
    const floatMat = real?.body ? (real.body.material as MeshStandardMaterial).clone() : new MeshBasicMaterial({ vertexColors: true });
    const floatMesh = new InstancedMesh(floatGeo, floatMat, MAX_FLOATS);
    floatMesh.frustumCulled = false;
    for (let i = 0; i < MAX_FLOATS; i++) floatMesh.setMatrixAt(i, ZERO_M);
    const chemiGeo = real?.chemi ? real.chemi.geometry.clone().applyMatrix4(real.chemi.matrixWorld) : null;
    const chemiMat = real?.chemi ? (real.chemi.material as MeshStandardMaterial).clone() : null;
    const chemiBase = chemiMat?.emissiveIntensity ?? 1;
    const chemiMesh = chemiGeo && chemiMat ? new InstancedMesh(chemiGeo, chemiMat, MAX_FLOATS) : null;
    if (chemiMesh) {
      chemiMesh.frustumCulled = false;
      for (let i = 0; i < MAX_FLOATS; i++) chemiMesh.setMatrixAt(i, ZERO_M);
    }
    // the float's origin: its top (the stand-in) or the water line (lake_gear.glb, the top FLOAT_TOP_GLB above)
    const originDown = real ? real.top * FLOAT_VIEW_SCALE : 0;
    const lineGeo = new BufferGeometry();
    const linePos = new Float32Array(MAX_FLOATS * SEGMENTS * 2 * 3).fill(-1000);
    lineGeo.setAttribute("position", new Float32BufferAttribute(linePos, 3));
    const lineMat = new LineBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.8 });
    const lines = new LineSegments(lineGeo, lineMat);
    lines.frustumCulled = false;
    const haloGeo = new RingGeometry(0.3, 0.37, 32);
    haloGeo.rotateX(-Math.PI / 2);
    const haloMat = new MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.32, depthWrite: false });
    const halo = new Mesh(haloGeo, haloMat);
    halo.visible = false;
    // lake v2: the spray of a splash and the drips off a fish (soft round drops, lakeDrops.ts)
    const spray = createDrops(MAX_SPLASH, 0.085, 0.9);
    const drips = createDrops(160, 0.035, 0.95);
    return { slots, floatGeo, floatMat, floatMesh, chemiGeo, chemiMat, chemiMesh, chemiBase, originDown, lineGeo, linePos, lineMat, lines, haloGeo, haloMat, halo, spray, drips, ambient: 12 + Math.random() * 20 };
  }, [gearIn]);
  useEffect(
    () => () => {
      parts.floatGeo.dispose();
      parts.floatMat.dispose();
      parts.floatMesh.dispose();
      parts.chemiGeo?.dispose();
      parts.chemiMat?.dispose();
      parts.chemiMesh?.dispose();
      parts.lineGeo.dispose();
      parts.lineMat.dispose();
      parts.haloGeo.dispose();
      parts.haloMat.dispose();
      parts.spray.dispose();
      parts.drips.dispose();
    },
    [parts],
  );

  const emit = (x: number, y: number, z: number, n: number) => parts.spray.emit(x, y, z, n, 1);
  // the catch rigs' splashes and drips (catchRig.ts) and their rings, while this lake is drawn
  useEffect(() => {
    installLakeFx(lakeRipple, (x, y, z, n, power, drip) => (drip ? parts.drips.emit(x, y, z, n, 0) : parts.spray.emit(x, y, z, n, power)));
    return () => installLakeFx(null, null);
  }, [parts]);

  useFrame((_state, delta) => {
    const me = selfId();
    const haloOn = useLakeStore.getState().halo;
    const seen = new Set<string>();
    let haloShown = false;
    forEachAngler((sid, v: FishView) => {
      if (v.spot < 0) return;
      const spot = LAKE_FISHING_SPOTS[v.spot];
      if (!spot) return;
      let slot = parts.slots.get(sid);
      if (!slot) {
        if (parts.slots.size >= MAX_FLOATS) return;
        slot = { index: parts.slots.size, visible: false, splashedSeq: -1, tug: -1, lastPhase: -1, nextBeat: 0, pose: { visible: false, x: 0, z: 0, top: 0, y: 0, dive: 0, flying: false, flight: 0, stand: 1, taut: false }, target: { x: 0, z: 0 }, side: { x: 0, z: 0 }, seq: -1, spot: -1 };
        parts.slots.set(sid, slot);
      }
      seen.add(sid);
      const f = LAKE_FACE_DIR[spot.face];
      if (slot.seq !== v.seq || slot.spot !== v.spot) {
        scatter(spot, v.seq, slot.target);
        const s = FACE_SIDE(f, v.seq);
        slot.side.x = s.x;
        slot.side.z = s.z;
        slot.seq = v.seq;
        slot.spot = v.spot;
        slot.splashedSeq = -1;
        slot.tug = -1;
      }
      const elapsedMs = elapsedSince(v.at);
      const p = floatPose(v, slot.target, slot.side, elapsedMs, slot.pose);
      const t = elapsedMs / 1000;
      // rings and splashes, at the edges of the phases
      if (v.phase === FISH_PHASE.casting && t >= CAST_S && slot.splashedSeq !== v.seq) {
        slot.splashedSeq = v.seq;
        lakeRipple(slot.target.x, slot.target.z, 1.2);
        emit(slot.target.x, LAKE_WATER_Y, slot.target.z, 14);
      }
      if (v.phase === FISH_PHASE.settling && slot.splashedSeq !== v.seq) {
        // a late joiner or a missed frame: the landing ring still shows
        slot.splashedSeq = v.seq;
        lakeRipple(slot.target.x, slot.target.z, 0.8);
      }
      if (v.phase === FISH_PHASE.nibble) {
        const idx = tugIndex(t, v.spot, v.seq);
        if (idx !== slot.tug) {
          slot.tug = idx;
          if (idx >= 0) lakeRipple(p.x, p.z, 0.35);
        }
      }
      if (v.phase !== slot.lastPhase) {
        if (v.phase === FISH_PHASE.bite) lakeRipple(p.x, p.z, 0.8);
        if (v.phase === FISH_PHASE.missed) lakeRipple(p.x, p.z, 0.4);
        if (v.phase === FISH_PHASE.lifting) {
          lakeRipple(p.x, p.z, 1.0);
          emit(p.x, LAKE_WATER_Y, p.z, 18);
        }
        slot.nextBeat = 0;
        slot.lastPhase = v.phase;
      }
      if (v.phase === FISH_PHASE.hooked || v.phase === FISH_PHASE.fighting) {
        slot.nextBeat -= delta;
        if (slot.nextBeat <= 0) {
          slot.nextBeat = 0.55;
          lakeRipple(p.x, p.z, 0.85);
          if (v.phase === FISH_PHASE.fighting) emit(p.x, LAKE_WATER_Y, p.z, 4);
        }
      }
      // where the line starts: the rod tip
      const tip = rodTipOf(sid);
      let tx: number, ty: number, tz: number;
      if (tip) {
        tip.getWorldPosition(tmpTip);
        tx = tmpTip.x;
        ty = tmpTip.y;
        tz = tmpTip.z;
      } else {
        // no rod in the tree yet: where an open rod tip would be
        tx = spot.anchor.x + f.x * 3.1;
        tz = spot.anchor.z + f.z * 3.1;
        ty = 2.6;
      }
      let fx = p.x;
      let fz = p.z;
      let fy = LAKE_WATER_Y + p.top;
      if (p.flying) {
        const k = p.flight;
        fx = tx + (p.x - tx) * k;
        fz = tz + (p.z - tz) * k;
        fy = ty + (LAKE_WATER_Y - ty) * k + Math.sin(k * Math.PI) * 2.2;
      }
      // lake v2: a fish on the line (catchRig.ts) — the line ends at its mouth, the float rides the line 0.6 m above it
      const hook = lineOnFish(v.phase) ? hookPointOf(sid) : null;
      let lineX = fx;
      let lineY = fy;
      let lineZ = fz;
      if (hook) {
        lineX = hook.x;
        lineY = hook.y;
        lineZ = hook.z;
        const dx = tx - hook.x;
        const dy = ty - hook.y;
        const dz = tz - hook.z;
        const dl = Math.hypot(dx, dy, dz) || 1;
        const up = Math.min(0.3, dl * 0.5);
        fx = hook.x + (dx / dl) * up;
        fy = hook.y + (dy / dl) * up;
        fz = hook.z + (dz / dl) * up;
      }
      const show = !!hook || (p.visible && !p.flying) || (p.flying && p.flight > 0.02);
      slot.visible = show;
      if (show) {
        tmpQ.setFromAxisAngle(Z_AXIS, hook ? 0 : (1 - p.stand) * 1.45);
        // the real float's origin is its water line: put it `originDown` under the top (turned with it while it lies)
        tmpOff.set(0, hook ? 0 : -parts.originDown, 0).applyQuaternion(tmpQ);
        tmpP.set(fx + tmpOff.x, fy + tmpOff.y, fz + tmpOff.z);
        tmpS.setScalar(FLOAT_VIEW_SCALE);
        tmpM.compose(tmpP, tmpQ, tmpS);
        parts.floatMesh.setMatrixAt(slot.index, tmpM);
        parts.chemiMesh?.setMatrixAt(slot.index, tmpM);
      } else {
        parts.floatMesh.setMatrixAt(slot.index, ZERO_M);
        parts.chemiMesh?.setMatrixAt(slot.index, ZERO_M);
      }
      if (haloOn && sid === me && show && !p.flying && !p.taut) {
        parts.halo.position.set(fx, LAKE_WATER_Y + 0.02, fz);
        haloShown = true;
      }
      // the line: tip -> float, slack by phase (taut while fighting)
      const len = Math.hypot(lineX - tx, lineZ - tz);
      // on a fish the line is taut; in the fight, when the angler lets go, it slackens (lake v2: Player.fishReel)
      const slack = hook && v.phase === FISH_PHASE.fighting && (v.reel & 128) === 0;
      const sag = hook ? (slack ? 0.05 : 0.008) * len : p.taut ? 0.02 * len : p.flying ? 0.04 * len : 0.12 * len * (1 - 0.6 * p.dive);
      const base = slot.index * SEGMENTS * 6;
      if (show) {
        const lineEndY = hook ? lineY : p.flying ? fy : Math.max(fy, LAKE_WATER_Y + 0.01);
        let px = tx;
        let py = ty;
        let pz = tz;
        for (let i = 1; i < LINE_POINTS; i++) {
          const k = i / (LINE_POINTS - 1);
          const nx = tx + (lineX - tx) * k;
          const ny = ty + (lineEndY - ty) * k - sag * 4 * k * (1 - k);
          const nz = tz + (lineZ - tz) * k;
          const o = base + (i - 1) * 6;
          parts.linePos[o] = px;
          parts.linePos[o + 1] = py;
          parts.linePos[o + 2] = pz;
          parts.linePos[o + 3] = nx;
          parts.linePos[o + 4] = ny;
          parts.linePos[o + 5] = nz;
          px = nx;
          py = ny;
          pz = nz;
        }
      } else parts.linePos.fill(-1000, base, base + SEGMENTS * 6);
    });
    // anglers who left take their float and line with them (design 12.5)
    for (const [sid, slot] of parts.slots) {
      if (seen.has(sid) || !slot.visible) continue;
      slot.visible = false;
      parts.floatMesh.setMatrixAt(slot.index, ZERO_M);
      parts.chemiMesh?.setMatrixAt(slot.index, ZERO_M);
      parts.linePos.fill(-1000, slot.index * SEGMENTS * 6, (slot.index + 1) * SEGMENTS * 6);
    }
    parts.floatMesh.instanceMatrix.needsUpdate = true;
    if (parts.chemiMesh) {
      parts.chemiMesh.instanceMatrix.needsUpdate = true;
      // the 케미 light glows at night only (lake_gear.glb's M_chemi)
      if (parts.chemiMat) parts.chemiMat.emissiveIntensity = parts.chemiBase * (0.05 + 1.6 * dayNight.applied.lights);
    }
    (parts.lineGeo.getAttribute("position") as Float32BufferAttribute).needsUpdate = true;
    parts.halo.visible = haloShown;
    // the drops: ballistic, gone when they fall back to the water
    parts.spray.step(delta, LAKE_WATER_Y);
    parts.drips.step(delta, LAKE_WATER_Y);

    // a fish jumping somewhere: now and then, the lake lives (design 4.2)
    parts.ambient -= delta;
    if (parts.ambient <= 0) {
      parts.ambient = 20 + Math.random() * 20;
      for (let tries = 0; tries < 8; tries++) {
        const x = 118 + Math.random() * 56;
        const z = -44 + Math.random() * 76;
        if (insidePolygon(x, z, LAKE_SHORE) && x > LAKE_AREA.minX) {
          lakeRipple(x, z, 0.9);
          emit(x, LAKE_WATER_Y, z, 8);
          break;
        }
      }
    }
    if (import.meta.env.DEV) {
      let floats = 0;
      for (const slot of parts.slots.values()) if (slot.visible) floats++;
      (window as unknown as { __cvLakeStats?: () => { floats: number; drawCalls: number } }).__cvLakeStats = () => ({ floats, drawCalls: 4 });
    }
  });
  return (
    <>
      <primitive object={parts.floatMesh} />
      {parts.chemiMesh && <primitive object={parts.chemiMesh} />}
      <primitive object={parts.lines} />
      <primitive object={parts.halo} />
      <primitive object={parts.spray.points} />
      <primitive object={parts.drips.points} />
    </>
  );
}

/** What the lake adds to the village scene (replaces the old pond props): the lake itself, the pad, the markers, the anglers. */
export function LakeWorld({ pose, tier }: { pose: Pose; tier: VillageTier }) {
  // DEV: `?nolake` leaves the lake out (to compare the village's frames and console with and without it).
  if (import.meta.env.DEV && typeof location !== "undefined" && new URLSearchParams(location.search).has("nolake")) return null;
  return (
    <>
      <LakeModel tier={tier} pose={pose} />
      <LakeSigns />
      {/* the yellow rental ring is gone (owner 2026-11-19: "노란색원 이것도 없애자"); renting still happens at the counter spot */}
      <LakeAnglers />
    </>
  );
}


import { useEffect, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Mesh, Raycaster, Vector3, type Camera, type Material, type Object3D, type Scene, type Texture, type WebGLRenderer } from "three";
import { CLOSED_AUTO_DOOR, PUBLIC_AUTO_DOOR, stepAutoDoor, type AutoDoorConfig, type AutoDoorState } from "@caysonverse/shared/village/autoDoor";
import { LOTS_WITH_MODEL, VILLAGE_LOTS, lotDoorPoint, lotLocalToWorld, lotRoomOfDoor, type LotId } from "@caysonverse/shared/village/villageLots";
import { isTouchDevice } from "../../device";
import { forEachRemotePosition } from "../../game/remoteStore";
import { compileSafely } from "../../game/compileSafely";
import type { Pose } from "../../game/types";
import { autoDoorOpenAmount } from "../publicAutoDoorModel";
import { dayNight } from "../dayNightDriver";
import type { VillageTier } from "../villageModelPrep";
import { disposeLoadedLots, loadLots, type LoadedLot, type LoadedLots } from "./lotsLoader";
import { applyLotTextures, applyLotsDayNight, disposeLots, lotsMode, pickLotLevels, prepareLots, setLotDoor, showLotLevels, visibleLoad, type LotLevel, type LotNodes } from "./lotsPrep";
import { LotTextureBank } from "./lotTextures";
import { floraOld } from "../veg/vegMode";
import { cutOldPines, makeTemplePines, pineGroundY } from "./templePines";
import { setLotsDrawn } from "./lotsStore";
import { doorSwingClearance } from "./lotDoorCheck";
import { viewState } from "../../game/viewState";
import { LOT_ROOM_PREFETCH_M, prefetchLotRoom } from "./LotRoom";

declare global {
  interface Window {
    /** DEV: the lot buildings in the game (L5): ready, levels, triangles/draws, doors, the roofs' undersides, texture memory. */
    __cvLots?: () => unknown;
    __cvLotsDoor?: (door: string, amount: number | null) => void;
    /** DEV: every lot at this level (0..2), or null to go back to the distance rule. */
    __cvLotsForce?: (level: number | null) => void;
    /** DEV: sweep every swing door from shut to open against the rest of its lot (the clearance check). */
    __cvLotsDoorCheck?: () => unknown;
  }
}

interface DoorRun {
  state: AutoDoorState;
  pad: { x: number; z: number; radius: number };
  forced: number | null;
}

/** The swing doors' timing (an oak double door on closers: slower than the glass sliders). */
export const LOT_SWING_DOOR: Readonly<AutoDoorConfig> = Object.freeze({ ...PUBLIC_AUTO_DOOR, openingMs: 1100, closingMs: 1400 });

/** Within this far past a room door's pad (m) the camera is brought round to the street side, when it is more than DOOR_VIEW_MAX_OFF off it. */
export const DOOR_VIEW_REACH = 1.2;
export const DOOR_VIEW_MAX_OFF = (70 * Math.PI) / 180;
export const DOOR_VIEW_PITCH = 0.32;

/** A lot door's outward facing (the yaw from the visitor at its pad to a camera behind them, out on the street). */
function doorOutYaw(doorId: string): number {
  const room = lotRoomOfDoor(doorId)!;
  return lotDoorPoint(room.lot, room.door).arrival.yaw;
}

/** Eased door travel (a closer's start and stop), 0..1. */
const ease = (t: number) => t * t * (3 - 2 * t);

/**
 * The lots are read once per tier and kept while the village comes and goes (a visit to a room, a house or the hall unmounts the
 * village's area): coming back out shows them at once, from the same objects and GPU uploads. A new tier (or renderer) reads them again.
 */
interface LotsCache {
  tier: VillageTier;
  gl: WebGLRenderer;
  bank: LotTextureBank;
  ready: Promise<{ loaded: LoadedLots; nodes: LotNodes; loadMs: number } | null>;
  value: { loaded: LoadedLots; nodes: LotNodes; loadMs: number } | null;
  compiled: boolean;
}
let cache: LotsCache | null = null;

/** GPU bytes of the lots' exterior lightmaps (compressed: 1 byte a texel, mips 4/3). */
function lightmapBytes(lots: readonly LoadedLot[]): number {
  let b = 0;
  for (const l of lots)
    if (l.lightmap)
      for (const t of [l.lightmap.ao, l.lightmap.night]) {
        const top = (t as Texture & { mipmaps?: Array<{ width: number; height: number }> }).mipmaps?.[0] ?? (t.image as { width?: number; height?: number });
        b += (top?.width ?? 0) * (top?.height ?? 0) * (4 / 3);
      }
  return Math.round(b);
}

function freeCache(c: LotsCache): void {
  void c.ready.then((v) => {
    if (!v) return;
    disposeLots(v.nodes);
    v.nodes.root.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    for (const lot of v.loaded.lots)
      lot.scene.traverse((o) => {
        const m = o as Mesh;
        if (m.isMesh) m.geometry.dispose();
      });
    disposeLoadedLots(v.loaded);
    for (const lot of v.loaded.lots) if (lot.lightmap) for (const t of [lot.lightmap.ao, lot.lightmap.night]) t.dispose();
    c.bank.dispose();
  });
}

/**
 * The temple yard's pines: the art file's flat green plates and trunks are cut out of the loader's geometry (copies with a new index)
 * and real red pines stand in the temple's detail group (so they show with the building, as the old ones did). `?flora=old` (DEV) keeps
 * the file's own.
 */
function dressTempleYard(nodes: LotNodes, tier: VillageTier): void {
  const detail = nodes.detail.get("lot_temple");
  if (!detail || floraOld(window.location.search, import.meta.env.DEV)) return;
  const ground = pineGroundY(detail);
  const made = makeTemplePines(ground, tier !== "high");
  if (!made) return;
  detail.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const cut = cutOldPines(mesh);
    if (cut) {
      mesh.geometry = cut;
      nodes.own.geometries.push(cut);
    }
  });
  detail.add(made.group);
  nodes.own.geometries.push(...made.geometries);
  nodes.own.materials.push(...(made.disposables as unknown as Material[]));
}

function lotsFor(tier: VillageTier, gl: WebGLRenderer): LotsCache {
  if (cache && cache.tier === tier && cache.gl === gl) return cache;
  if (cache) freeCache(cache);
  const bank = new LotTextureBank(gl, tier === "high" ? "2k" : "1k");
  const t0 = performance.now();
  const ctl = new AbortController();
  const c: LotsCache = { tier, gl, bank, value: null, compiled: false, ready: Promise.resolve(null) };
  c.ready = loadLots(LOTS_WITH_MODEL, gl, bank, ctl.signal)
    .then((loaded) => {
      const nodes = prepareLots(loaded.lots, loaded.specs, loaded.own);
      dressTempleYard(nodes, tier);
      for (const m of nodes.surfaces) applyLotTextures(m, bank);
      bank.takeChanged();
      c.value = { loaded, nodes, loadMs: Math.round(performance.now() - t0) };
      return c.value;
    })
    .catch((e: unknown) => {
      console.error("[lots] the lot buildings failed", e);
      return null;
    });
  cache = c;
  return c;
}

/** The loaded lots, if any (the vegetation reads their trees, the e2e their stats). */
export function loadedLotsNow(): LotNodes | null {
  return cache?.value?.nodes ?? null;
}

/** Compile every lot material (detail, goods, night glow included) once, off the frame (the program gate draws nothing half-made). */
function warmLots(gl: WebGLRenderer, nodes: LotNodes, camera: Camera, scene: Scene): void {
  const hidden: Object3D[] = [];
  nodes.root.traverse((o) => {
    if (!o.visible) {
      hidden.push(o);
      o.visible = true;
    }
  });
  // only the lots' own materials (the scene gives the lights): compiling the whole scene would also start programs for materials other
  // parts are about to free (a glGetProgramiv warning each)
  nodes.root.updateMatrixWorld(true);
  void compileSafely(gl, nodes.root, camera, scene);
  for (const o of hidden) o.visible = false;
}

/**
 * The six lot buildings (마을 부지 건물, L5 / lots v2; lotsPrep.ts): read beside the village (never waited for: their own loader), dressed
 * for the tier, their detail shown by distance (one pool, nearest first) and their full textures loaded while detailed, the oak doors
 * of the five rooms swinging open as anyone comes near, the night glow with the day/night blend.
 */
export function VillageLots({ pose, tier }: { pose: Pose; tier: VillageTier }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const [nodes, setNodes] = useState<LotNodes | null>(null);
  const store = useRef<LotsCache | null>(null);

  useEffect(() => {
    if (lotsMode() === "off") return;
    const c = lotsFor(tier, gl);
    store.current = c;
    let dead = false;
    void c.ready.then((v) => {
      if (dead || !v) return;
      if (!c.compiled) {
        c.compiled = true;
        warmLots(gl, v.nodes, camera, scene);
      }
      setNodes(v.nodes);
    });
    return () => {
      dead = true;
      setLotsDrawn([]);
      setNodes(null);
    };
    // the camera and scene are the canvas's own (stable)
  }, [tier, gl]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!nodes) return;
    setLotsDrawn(nodes.stats.lots);
  }, [nodes]);

  // the rooms' oak doors (a swing rig with a room behind it): a PUBLIC_AUTO_DOOR state machine each; 케이슨랜드's gate stays shut
  const doors = useRef<Map<string, DoorRun>>(new Map());
  useEffect(() => {
    const m = new Map<string, DoorRun>();
    if (nodes) {
      for (const rig of nodes.doors) {
        if (rig.leaves.length === 0 || !lotRoomOfDoor(rig.id)) continue;
        const lot = VILLAGE_LOTS.find((l) => l.id === rig.lot)!;
        const d = lot.doors.find((x) => x.id === rig.id);
        if (!d) continue;
        const p = lotDoorPoint(lot, d);
        m.set(rig.id, { state: { ...CLOSED_AUTO_DOOR }, pad: p.pad, forced: null });
      }
    }
    doors.current = m;
  }, [nodes]);

  const levels = useRef<Map<LotId, LotLevel>>(new Map());
  const forced = useRef<LotLevel | null>(null);
  const refs = useRef([{ x: 0, z: 0 }, { x: 0, z: 0 }]).current;
  const device = isTouchDevice ? "phone" : "pc";

  useEffect(() => {
    if (!import.meta.env.DEV || !nodes) return;
    const c = store.current!;
    window.__cvLots = () => ({
      ready: true,
      tier,
      device,
      levels: Object.fromEntries(levels.current),
      stats: nodes.stats,
      visible: visibleLoad(nodes.root),
      loadMs: c.value?.loadMs,
      textures: c.bank.gpuBytes(device === "phone" ? "mobile" : "desktop"),
      lightmaps: lightmapBytes(c.value?.loaded.lots ?? []),
      failed: c.value?.loaded.failed ?? [],
      doors: [...doors.current].map(([id, d]) => ({ id, phase: d.state.phase, pad: d.pad })),
      undersides: undersides(nodes.root),
    });
    window.__cvLotsDoor = (door, amount) => {
      const d = doors.current.get(door);
      if (d) d.forced = amount;
    };
    window.__cvLotsForce = (level) => {
      forced.current = level === null ? null : (Math.max(0, Math.min(2, level)) as LotLevel);
    };
    window.__cvLotsDoorCheck = () => doorSwingClearance(nodes);
    return () => {
      delete window.__cvLots;
      delete window.__cvLotsDoor;
      delete window.__cvLotsForce;
      delete window.__cvLotsDoorCheck;
    };
  }, [nodes, tier, device]);

  const others = useRef<number[]>([]).current;
  const wanted = useRef({ key: "", at: -1e9 });
  const lmQueue = useRef<Texture[] | null>(null);
  useEffect(() => {
    lmQueue.current = null; // a new set of lots (a tier change): its lightmaps go up again before it shows
  }, [nodes]);
  /** The door the camera last swung round for (null once the visitor walked away from it). */
  const doorView = useRef<string | null>(null);
  useFrame(({ camera: cam, clock }) => {
    if (!nodes) return;
    const c = store.current;
    applyLotsDayNight(nodes, dayNight.applied);
    refs[0]!.x = cam.position.x;
    refs[0]!.z = cam.position.z;
    const posed = Number.isFinite(pose.x);
    refs[1]!.x = posed ? pose.x : cam.position.x;
    refs[1]!.z = posed ? pose.z : cam.position.z;
    const next = forced.current === null ? pickLotLevels(levels.current, refs, nodes.boxes, device) : new Map(nodes.boxes.map((b) => [b.id, forced.current!] as const));
    let changed = next.size !== levels.current.size;
    for (const [id, lv] of next) if (levels.current.get(id) !== lv) changed = true;
    if (changed) {
      levels.current = next;
      showLotLevels(nodes, next);
    }
    // the full textures of the detailed lots (the far albedo for the rest): asked for on a change, and twice a second for the releases;
    // uploaded a couple a frame before they are shown (no frame waits on a 2K upload), the lots drawn once every far albedo is up
    const nowMs = clock.elapsedTime * 1000;
    if (c) {
      c.bank.pump(1);
      // the exterior lightmaps (L6): one up a frame while the lots are still hidden (never a walk's frame later)
      if (lmQueue.current === null) lmQueue.current = (c.value?.loaded.lots ?? []).flatMap((l) => (l.lightmap ? [l.lightmap.ao, l.lightmap.night] : []));
      const lmNext = lmQueue.current.shift();
      if (lmNext) {
        try {
          gl.initTexture(lmNext);
        } catch {
          /* drawn three's way */
        }
      }
      const ready = c.bank.farReady() && lmQueue.current.length === 0;
      if (nodes.root.visible !== ready) nodes.root.visible = ready;
      const sets = new Set<string>();
      for (const [id, lv] of levels.current) if (lv >= 1) for (const s of nodes.lotSets.get(id) ?? []) sets.add(s);
      const key = [...sets].sort().join(",");
      if (key !== wanted.current.key || nowMs - wanted.current.at > 500) {
        wanted.current = { key, at: nowMs };
        c.bank.want(sets, performance.now());
      }
      if (c.bank.takeChanged()) for (const m of nodes.surfaces) applyLotTextures(m, c.bank);
    }
    // At a room's door the camera stands on the street side (owner review 2026-11-17: on the building's side the wall cut the arm short
    // and the lens sat in the avatar's face): walking up to a pad with the camera behind the wall plane, the orbit glides round once
    if (posed) {
      let near: { id: string; yaw: number } | null = null;
      for (const rig of nodes.doors) {
        const run = doors.current.get(rig.id);
        if (!run) continue;
        if (Math.hypot(pose.x - run.pad.x, pose.z - run.pad.z) <= run.pad.radius + DOOR_VIEW_REACH) near = { id: rig.id, yaw: doorOutYaw(rig.id) };
      }
      if (!near) doorView.current = null;
      else if (doorView.current !== near.id) {
        doorView.current = near.id;
        const camYaw = Math.atan2(cam.position.x - pose.x, cam.position.z - pose.z);
        const off = Math.abs(Math.atan2(Math.sin(camYaw - near.yaw), Math.cos(camYaw - near.yaw)));
        if (off > DOOR_VIEW_MAX_OFF && viewState.mode === "tp") viewState.orbitGoal = { yaw: near.yaw, pitch: DOOR_VIEW_PITCH };
      }
    }
    // the doors: anyone (this player, the others) within the approach of a door's pad opens it
    for (const rig of nodes.doors) {
      const run = doors.current.get(rig.id);
      if (!run) continue;
      others.length = 0;
      if (posed) others.push(Math.hypot(pose.x - run.pad.x, pose.z - run.pad.z));
      forEachRemotePosition((x, z, connected) => {
        if (connected) others.push(Math.hypot(x - run.pad.x, z - run.pad.z));
      });
      const occupied = others.some((d) => d <= 1.15);
      const cfg = { ...LOT_SWING_DOOR, approachRadiusM: Math.max(LOT_SWING_DOOR.approachRadiusM, run.pad.radius + 0.75) };
      run.state = stepAutoDoor(run.state, nowMs, { playerDistancesM: others, doorwayOccupied: occupied }, cfg);
      const amount = run.forced ?? ease(autoDoorOpenAmount(run.state, nowMs, cfg));
      setLotDoor(rig, amount);
      // at a room's door its files start to come (usually in by the time the curtain lifts)
      if (posed && others[0]! <= LOT_ROOM_PREFETCH_M) {
        const room = lotRoomOfDoor(rig.id);
        if (room) prefetchLotRoom(room.area, gl, tier !== "high");
      }
    }
  });

  if (!nodes) return null;
  return <primitive object={nodes.root} dispose={null} />;
}

/** DEV: the undersides (m) of the porch roofs, the pergola and the temple's eaves over a few points per lot (LOT_ROOF_SLABS' floors). */
function undersides(root: Object3D): Record<string, number | null> {
  const ray = new Raycaster();
  const out: Record<string, number | null> = {};
  const probe: Array<[LotId, number, number]> = [
    ["lot_school", 0, -1.2], ["lot_school", -1.8, -1.0], ["lot_school", 1.8, -0.5],
    ["lot_library", 7, -1], ["lot_library", 5, 2.5], ["lot_library", 9, -5],
    ["lot_temple", 0, 12], ["lot_temple", 2.5, 12.2], ["lot_temple", 3.3, 11.5], ["lot_temple", 0, -2], ["lot_temple", 7, -2.5], ["lot_temple", -7, -3],
    ["lot_temple", -9.7, -8.5], ["lot_temple", -11.5, -10.2],
    ["lot_church", 0, 3.8], ["lot_church", -1.8, 4.5], ["lot_church", 1.8, 3.2],
    ["lot_chapel", 0, 6], ["lot_gate", 0, -4.8],
  ];
  root.updateMatrixWorld(true);
  for (const [id, lx, lz] of probe) {
    const l = VILLAGE_LOTS.find((x) => x.id === id)!;
    const p = lotLocalToWorld(l, lx, lz);
    ray.set(new Vector3(p.x, 0.6, p.z), new Vector3(0, 1, 0));
    const hit = ray.intersectObject(root, true).find((h) => (h.object as Mesh).renderOrder !== 3);
    out[`${id}@${lx},${lz}`] = hit ? Math.round(hit.point.y * 100) / 100 : null;
  }
  return out;
}

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  AmbientLight,
  Color,
  Group,
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  InstancedMesh,
  Mesh,
  SRGBColorSpace,
  Vector3,
  type BufferGeometry,
  type Material,
  type MeshBasicMaterial,
  type Object3D,
  type Texture,
  type WebGLRenderer,
} from "three";
import { lotDoorPoint, lotRoomOf, type LotRoom } from "@caysonverse/shared/village/villageLots";
import { cafeToRoom } from "@caysonverse/shared/village/cafeRoom";
import type { Pose } from "../../game/types";
import { useQualityTier } from "../../game/QualityEffects";
import { compileSafely } from "../../game/compileSafely";
import { setSeatSightBlocker, setSeatSpotBlocker } from "../../game/seatFraming";
import { setCameraSolids } from "../../game/cameraSolids";
import { viewState } from "../../game/viewState";
import { CAMERA } from "../../game/constants";
import { buildSolidIndex, type SolidIndex } from "../hallSolidIndex";
import { solidTriangles } from "../houseModelPrep";
import { beginHouseEntry, houseEntryReady, houseEntryState } from "../houseEntry";
import { dayNight } from "../dayNightDriver";
import { LOT_ROOM_LIGHT } from "../DayNight";
import { PBR_ANISOTROPY, getPbrKtx2Loader, pbrUrl } from "../pbr/pbrLibrary";
import type { PbrTier } from "../pbr/pbrTypes";
import { WINDOW_VIEWS, gardenWindow, windowViewWeights } from "../lots/gardenWindow";
import { loadLotOwnMap } from "../lots/lotTextures";
import { arrivalYaw } from "../lots/LotRoom";
import { buildCafe, localToRoom, type CafeParts } from "./cafeBuild";
import { buildCafeShell, type ShellParts } from "./cafeShell";
import { blobMaterial, cafeMaterial, makeCafeUniforms, poolMaterial, type CafeUniformSet } from "./cafeMaterials";
import { artAtlas, softDisc } from "./cafeTextures";

declare global {
  interface Window {
    /** DEV: the room drawn now (its stats, draws and triangles in view). Same hook as the other lot rooms'. */
    __cvLotRoom?: () => unknown;
  }
}

/** The room's unit id (cafeRoom.ts CAFE_IN.unit): the walk-in room this file draws instead of a lot GLB. */
export const CAFE_ROOM_UNIT = "lot_cafe_room";

/** How long (ms) a left room stays built, for a quick return (the lot rooms' keep). */
const KEEP_MS = 60_000;
/** How close (m) to the door its files start to come. */
export const CAFE_PREFETCH_M = 14;
/** The entry cover lifts after this long at most (ms) even if the programs are not all compiled. */
const COMPILE_WAIT_MS = 2500;

const noRaycast = (): void => {};

interface Loaded {
  root: Group;
  solid: SolidIndex;
  uniforms: CafeUniformSet;
  materials: Material[];
  textures: Texture[];
  geometries: BufferGeometry[];
  window: MeshBasicMaterial;
  pool: MeshBasicMaterial;
  blob: MeshBasicMaterial;
  stats: { triangles: number; draws: number; phone: boolean };
  dispose(): void;
}

function mesh(geometry: BufferGeometry, material: Material, name: string, pickable: boolean): Mesh {
  const m = new Mesh(geometry, material);
  m.name = name;
  if (!pickable) m.raycast = noRaycast;
  m.matrixAutoUpdate = false;
  return m;
}

function instanced(geometry: BufferGeometry, material: Material, matrices: readonly import("three").Matrix4[], name: string): InstancedMesh {
  const m = new InstancedMesh(geometry, material, matrices.length);
  matrices.forEach((mat, i) => m.setMatrixAt(i, mat));
  m.instanceMatrix.needsUpdate = true;
  m.name = name;
  m.matrixAutoUpdate = false;
  m.computeBoundingSphere();
  m.computeBoundingBox();
  return m;
}

/** A library set's albedo only (the room's light model reads no normal or ORM map: a third of the set's download and decode). */
async function loadAlbedo(id: string, tier: PbrTier, gl: WebGLRenderer): Promise<Texture> {
  const tex = await getPbrKtx2Loader(gl).loadAsync(pbrUrl(id, tier, "albedo"));
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.anisotropy = Math.min(PBR_ANISOTROPY[tier], gl.capabilities.getMaxAnisotropy());
  tex.name = `cafe_${id}`;
  tex.needsUpdate = true;
  return tex;
}

async function loadRoom(room: LotRoom, gl: WebGLRenderer, phone: boolean): Promise<Loaded> {
  const origin = room.origin;
  const matrix = localToRoom(origin);
  const parts: CafeParts = buildCafe({ room: { matrix } });
  const shell: ShellParts = buildCafeShell(matrix);

  // the room's own lighting model (cafeMaterials.ts), its lamps and daylight in the room's world: the front glass is the room's -z
  // wall (the door's), the side glass the +-x ones
  const at = (lx: number, lz: number) => ({ x: origin.x + cafeToRoom(lx, lz).x, z: origin.z + cafeToRoom(lx, lz).z });
  const uniforms = makeCafeUniforms(at, { front: [0, 0.25, -1], sideA: [-1, 0.25, 0], sideB: [1, 0.25, 0] });
  uniforms.uLit.value = 0;

  // the library's floor, plaster and oak (1K on a phone), as the albedo of the room's own light model; and the village behind the glass
  const tier: PbrTier = phone ? "1k" : "2k";
  const view = WINDOW_VIEWS[room.unit.id];
  const [floorMap, plasterMap, oakMap, ...viewMaps] = await Promise.all([
    loadAlbedo("floor_wood", tier, gl),
    loadAlbedo("plaster_painted", tier, gl),
    loadAlbedo("wood_oak", tier, gl),
    ...(view ? view.keys.map((k) => loadLotOwnMap(gl, `/models/village/${k.file}`).catch((err: unknown) => {
      console.error("[cafe] window view", k.id, err);
      return undefined;
    })) : []),
  ]);
  const textures: Texture[] = [floorMap, plasterMap, oakMap];
  for (const t of viewMaps) {
    if (!t) continue;
    if (phone) t.anisotropy = Math.min(t.anisotropy, 4);
    textures.push(t);
  }
  const atlas = artAtlas();
  const disc = softDisc();
  const mats = {
    floor: cafeMaterial("room-floor", floorMap, null, uniforms),
    plaster: cafeMaterial("room-plaster", plasterMap, null, uniforms),
    oak: cafeMaterial("room-oak", oakMap, null, uniforms),
    solid: cafeMaterial("solid", null, null, uniforms),
    art: cafeMaterial("art", atlas, null, uniforms),
  };
  atlas.colorSpace = SRGBColorSpace;
  const blob = blobMaterial(disc);
  const pool = poolMaterial(disc);
  const day = viewMaps[0];
  const glassView = gardenWindow([day, viewMaps[1] ?? undefined, viewMaps[2] ?? undefined], view, origin, 1 / LOT_ROOM_LIGHT.exposure);
  const root = new Group();
  root.name = `lotroom__game_${room.unit.id}`;
  const list: Object3D[] = [
    mesh(shell.floor, mats.floor, "cafe_floor", true),
    mesh(shell.plaster, mats.plaster, "cafe_plaster", true),
    mesh(shell.oak, mats.oak, "cafe_oak", true),
    mesh(shell.trim, mats.solid, "cafe_trim", true),
    mesh(shell.glass, glassView, "cafe_glass", true),
    mesh(parts.fixed, mats.solid, "cafe_fixed", true),
    mesh(parts.art, mats.art, "cafe_art", true),
    instanced(parts.chair, mats.solid, parts.chairMatrices, "cafe_chairs"),
    instanced(parts.table, mats.solid, parts.tableMatrices, "cafe_tables"),
    instanced(parts.stool, mats.solid, parts.stoolMatrices, "cafe_stools"),
    mesh(parts.blobs, blob, "cafe_shadows", false),
    mesh(parts.pools, pool, "cafe_pools", false),
  ];
  list[10]!.renderOrder = 1;
  list[11]!.renderOrder = 2;
  for (const o of list) root.add(o);
  root.updateMatrixWorld(true);

  const b = room.bounds;
  const solid = buildSolidIndex(solidTriangles(root), b.minX - 1, b.maxX + 1, b.minZ - 1, b.maxZ + 1);
  const geometries = [shell.floor, shell.plaster, shell.oak, shell.trim, shell.glass, parts.fixed, parts.art, parts.chair, parts.table, parts.stool, parts.blobs, parts.pools];
  const materials: Material[] = [...Object.values(mats), blob, pool, glassView];
  const stats = { triangles: Math.round(parts.triangles + shell.triangles), draws: list.length, phone };
  return {
    root,
    solid,
    uniforms,
    materials,
    textures,
    geometries,
    window: glassView,
    pool,
    blob,
    stats,
    dispose() {
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      for (const t of textures) t.dispose();
      atlas.dispose();
      disc.dispose();
    },
  };
}

interface Entry {
  key: string;
  promise: Promise<Loaded>;
  value: Loaded | null;
  users: number;
  timer: ReturnType<typeof setTimeout> | null;
}
const entries = new Map<string, Entry>();

function entryFor(room: LotRoom, gl: WebGLRenderer, phone: boolean): Entry {
  const key = `${room.unit.id}@${phone ? "phone" : "pc"}`;
  let e = entries.get(key);
  if (e) return e;
  const entry: Entry = { key, promise: Promise.resolve(null as unknown as Loaded), value: null, users: 0, timer: null };
  entry.promise = loadRoom(room, gl, phone).then((v) => {
    entry.value = v;
    return v;
  });
  entry.promise.catch((err: unknown) => {
    console.error("[cafe] room", err);
    entries.delete(key);
  });
  entries.set(key, entry);
  e = entry;
  return e;
}

function hold(e: Entry): () => void {
  e.users++;
  if (e.timer) clearTimeout(e.timer);
  e.timer = null;
  return () => {
    e.users--;
    if (e.users > 0) return;
    e.timer = setTimeout(() => {
      if (e.users > 0) return;
      entries.delete(e.key);
      void e.promise.then((v) => v.dispose()).catch(() => {});
    }, KEEP_MS);
  };
}

declare global {
  interface Window {
    /** DEV: whether the café's room is built and waiting (the entry's wait: e2e/cafe-enter.mjs). */
    __cvCafeReady?: () => boolean;
  }
}
if (import.meta.env.DEV && typeof window !== "undefined") window.__cvCafeReady = () => [...entries.values()].some((e) => e.value !== null);

/** Start building the room (the player is near its door). Held for the keep time. */
export function prefetchCafeRoom(gl: WebGLRenderer, phone: boolean): void {
  const room = lotRoomOf(`lot:${CAFE_ROOM_UNIT}`);
  if (!room) return;
  const e = entryFor(room, gl, phone);
  if (e.users === 0 && !e.timer) hold(e)();
}

/** Mounted in the village: the room's files and geometry start when the avatar comes near the café's door. */
export function CafeRoomPrefetch({ pose }: { pose: Pose }) {
  const gl = useThree((s) => s.gl);
  const tier = useQualityTier();
  const door = useMemo(() => {
    const r = lotRoomOf(`lot:${CAFE_ROOM_UNIT}`)!;
    return lotDoorPoint(r.lot, r.door).pad;
  }, []);
  const done = useRef(false);
  useFrame(() => {
    if (done.current) return;
    if (Math.hypot(pose.x - door.x, pose.z - door.z) > CAFE_PREFETCH_M) return;
    done.current = true;
    prefetchCafeRoom(gl, tier !== "high");
    window.setTimeout(() => (done.current = false), KEEP_MS - 5000);
  });
  return null;
}

/** The plain room while it builds: the floor and the walls' boxes, so nobody stands in a void (the lot rooms' PlainRoom). */
function PlainRoom({ room }: { room: LotRoom }) {
  const b = room.bounds;
  const mat = useMemo(() => new Color("#E9E1D2"), []);
  return (
    <mesh position={[(b.minX + b.maxX) / 2, -0.01, (b.minZ + b.maxZ) / 2]}>
      <boxGeometry args={[b.maxX - b.minX, 0.02, b.maxZ - b.minZ]} />
      <meshBasicMaterial color={mat} />
    </mesh>
  );
}

/** The café's walk-in room (mounted while the local player is in `lot:lot_cafe_room`). */
export function CafeRoomArea({ area, pose }: { area: string; pose: Pose }) {
  const room = lotRoomOf(area);
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const tier = useQualityTier();
  const phone = tier !== "high";
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (!room) return;
    // a room mounted without the door's curtain (a reconnect): the entry cover until it is drawn
    if (houseEntryState().phase === "idle") beginHouseEntry();
    const e = entryFor(room, gl, phone);
    const release = hold(e);
    let live = true;
    void e.promise
      .then((v) => {
        if (live) setLoaded(v);
      })
      .catch(() => {});
    return () => {
      live = false;
      setLoaded(null);
      release();
    };
  }, [room, gl, phone]);

  // the room's fill for the avatars (an ambient light: no program's light count changes with it)
  const ambient = useMemo(() => new AmbientLight("#fff0dc", 0.5), []);

  useEffect(() => {
    if (!loaded || !room) return;
    let live = true;
    void Promise.race([compileSafely(gl, loaded.root, camera, scene), new Promise((r) => setTimeout(r, COMPILE_WAIT_MS))]).then(() => {
      if (live) houseEntryReady();
    });
    const solid = loaded.solid;
    const offSight = setSeatSightBlocker((fx, fy, fz, tx, ty, tz) => solid.segmentBlocked(fx, fy, fz, tx, ty, tz, 0.35));
    const offSpot = setSeatSpotBlocker((x, y, z) => solid.underHung(x, y, z, 2.6, 1.0, 0.25) || solid.nearSolid(x, y, z, 0.3));
    const offCamera = setCameraSolids(solid);
    viewState.orbitGoal = { yaw: arrivalYaw(solid, pose.x, pose.z, pose.yaw, CAMERA.distance), pitch: 0.55 };
    return () => {
      live = false;
      offSight();
      offSpot();
      offCamera();
    };
  }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!import.meta.env.DEV || !loaded || !room) return;
    window.__cvLotRoom = () => {
      let visTris = 0;
      let visDraws = 0;
      const walk = (o: Object3D) => {
        if (!o.visible) return;
        const m = o as Mesh;
        if (m.isMesh) {
          const g = m.geometry;
          const n = (g.index ? g.index.count : g.getAttribute("position").count) / 3;
          visTris += n * ((m as unknown as InstancedMesh).isInstancedMesh ? (m as unknown as InstancedMesh).count : 1);
          visDraws += 1;
        }
        for (const c of o.children) walk(c);
      };
      walk(loaded.root);
      return { unit: room.unit.id, area: room.area, origin: room.origin, stats: loaded.stats, visible: { triangles: Math.round(visTris), draws: visDraws }, glass: !!loaded.window.userData.windowView };
    };
    return () => {
      delete window.__cvLotRoom;
    };
  }, [loaded, room]);

  useFrame(() => {
    if (!loaded) return;
    const o = dayNight.outdoor;
    const day = Math.max(0, Math.min(1, 1 - o.night));
    const u = loaded.uniforms;
    u.uNight.value = o.night;
    u.uDay.value = day;
    // the café keeps its lamps on all day (a little), bright when the village's lights are
    u.uLit.value = o.lights;
    loaded.pool.opacity = 0.1 + 0.34 * o.lights;
    loaded.blob.opacity = 0.34;
    const v = loaded.window.userData.windowView as { uViewWeight: { value: Vector3 } } | undefined;
    if (v) windowViewWeights(WINDOW_VIEWS[CAFE_ROOM_UNIT]?.keys ?? [], o.night, o.golden, o.sunDir[0] < 0, v.uViewWeight.value);
    else loaded.window.color.setScalar(0.2 + 0.8 * day);
    ambient.intensity = 0.24 + (0.5 - 0.24) * day;
  });

  if (!room) return null;
  return (
    <>
      <primitive object={ambient} dispose={null} />
      {loaded ? <primitive object={loaded.root} dispose={null} /> : <PlainRoom room={room} />}
    </>
  );
}

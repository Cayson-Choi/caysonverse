import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { BufferGeometry, Group, InstancedBufferAttribute, Matrix4, Uint32BufferAttribute, type BufferAttribute, type InstancedMesh, type Material, type Mesh, type Object3D } from "three";
import { trimMesh, type Footprint } from "../street/streetTrim";
import { LOT_ROOMS, lotFootprint, lotLocalToWorld } from "@caysonverse/shared/village/villageLots";
import { useQualityTier } from "../../game/QualityEffects";
import { dayNight } from "../dayNightDriver";
import { driveRoomLights, holdLotRoom, showcaseMaterial, type LoadedRoom } from "../lots/LotRoom";
import { applyClearGlassDayNight, showcaseRooms, type ClearGlass, type GlassBox } from "./clearGlass";

const ROOMS_ON = showcaseRooms();
import { LOT_ROOM_PLACE, PORTAL_LOT_UNITS, lotPortalRoom, type PortalFrame, type PortalRoom } from "./portalRooms";

/**
 * The REAL rooms seen through the lots' windows and open doors (owner 2026-11-21: "건물 밖에서도 유리창을 통해서 안이 보이게"; 11-22:
 * "절에 문이 열렸는데 왜 이모양이야" — the 대웅전's doors opened on a brown backdrop: the shell is hollow, its room is a scene far away).
 * The café's way (cafe/CafeShowcase.tsx, feat/cafe-real) for every lot: the walk-in room's own GLB (the phone file on a phone; the same
 * cache the room uses, so walking in reads nothing again: lots/LotRoom.tsx `holdLotRoom`) is drawn inside its building at the room's real
 * place (portalRooms.ts: the room frame → the village, door on door), with its own baked light by day and night and its lamps
 * (`showcaseMaterial`, `driveRoomLights`), the village's live sun turned down (it would reach the floor through the walls).
 *
 *  - Drawn only near the camera: PC within SHOW_M.pc of a lot, every such lot; a phone within SHOW_M.phone, the nearest PHONE_MAX.
 *  - The room's own window glass (its village panorama, `M_garden`) and screens are left out: from outside the building's glass stands
 *    there (clearGlass.ts) — clear over a drawn room, a dark reflective pane with a lit room's glow elsewhere.
 *  - Triangles wholly outside the room's floor rectangle (window reveals, sills, the porch the room models) are dropped: they would poke
 *    through the shell's walls.
 *  - Nothing of it is picked, casts a shadow or blocks the camera.
 */

/** A lot's room is drawn within this distance (m, camera to the building's footprint). */
export const SHOW_M = { pc: 70, phone: 45 } as const;
/** On a phone, at most this many rooms at once (nearest first). */
export const PHONE_MAX = 2;
/** How much of the village's live sun and sky reaches a room seen from outside (its bake carries its light). */
export const SHOW_DIRECT = 0.18;
/** The re-check's hysteresis (m). */
const HYST = 8;

/** Room frame → village, as a matrix (the frame's rotation is a quarter turn, its inverse its transpose). */
export function frameToVillage(fr: PortalFrame): Matrix4 {
  const m = new Matrix4().set(fr.a, 0, fr.c, -(fr.a * fr.e + fr.c * fr.f), 0, 1, 0, fr.lift, fr.b, 0, fr.d, -(fr.b * fr.e + fr.d * fr.f), 0, 0, 0, 1);
  const k = fr.k ?? 1, kz = fr.kz ?? 0;
  // the depth squeeze about the door wall (PortalFrame.k): Z → kz + (Z − kz)·k
  if (k !== 1) m.multiply(new Matrix4().set(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, k, kz * (1 - k), 0, 0, 0, 1));
  return m;
}

/** A copy of `geo` without the triangles wholly outside the room's floor rectangle (room frame); null when none is dropped. */
export function insideRect(
  geo: BufferGeometry,
  world: Matrix4,
  rect: { minX: number; maxX: number; minZ: number; maxZ: number },
  cut: PortalRoom["cut"] = [],
  pad = 0.02,
): BufferGeometry | null {
  const pos = geo.getAttribute("position") as BufferAttribute | undefined;
  if (!pos) return null;
  const e = world.elements;
  const index = geo.index;
  const n = index ? index.count : pos.count;
  const kept: number[] = [];
  let dropped = 0;
  const out = (i: number) => {
    const x0 = pos.getX(i), y0 = pos.getY(i), z0 = pos.getZ(i);
    const x = e[0]! * x0 + e[4]! * y0 + e[8]! * z0 + e[12]!;
    const y = e[1]! * x0 + e[5]! * y0 + e[9]! * z0 + e[13]!;
    const z = e[2]! * x0 + e[6]! * y0 + e[10]! * z0 + e[14]!;
    if (x < rect.minX - pad || x > rect.maxX + pad || z < rect.minZ - pad || z > rect.maxZ + pad) return true;
    for (const c of cut) if (x >= c.min[0] && x <= c.max[0] && y >= c.min[1] && y <= c.max[1] && z >= c.min[2] && z <= c.max[2]) return true;
    return false;
  };
  for (let t = 0; t + 2 < n; t += 3) {
    const a = index ? index.getX(t) : t, b = index ? index.getX(t + 1) : t + 1, c = index ? index.getX(t + 2) : t + 2;
    if (out(a) && out(b) && out(c)) {
      dropped++;
      continue;
    }
    kept.push(a, b, c);
  }
  if (!dropped) return null;
  const g = new BufferGeometry();
  for (const k of Object.keys(geo.attributes)) g.setAttribute(k, geo.getAttribute(k));
  g.setIndex(new Uint32BufferAttribute(kept, 1));
  g.boundingSphere = geo.boundingSphere?.clone() ?? null;
  g.boundingBox = geo.boundingBox?.clone() ?? null;
  return g;
}

const tmpM = new Matrix4();
const tmpW = new Matrix4();
/** Keep only the instances whose origin is inside the rectangle (a fresh matrix buffer: the clone shares the loader's); false: none is. */
function keepInstancesInside(m: InstancedMesh, rect: { minX: number; maxX: number; minZ: number; maxZ: number }, cut: PortalRoom["cut"] = [], pad = 0.05): boolean {
  const kept: number[] = [];
  for (let i = 0; i < m.count; i++) {
    m.getMatrixAt(i, tmpM);
    tmpW.multiplyMatrices(m.matrixWorld, tmpM);
    const x = tmpW.elements[12]!, y = tmpW.elements[13]!, z = tmpW.elements[14]!;
    const inCut = cut.some((c) => x >= c.min[0] && x <= c.max[0] && y >= c.min[1] && y <= c.max[1] && z >= c.min[2] && z <= c.max[2]);
    if (!inCut && x >= rect.minX - pad && x <= rect.maxX + pad && z >= rect.minZ - pad && z <= rect.maxZ + pad) kept.push(i);
  }
  if (kept.length === m.count) return true;
  if (!kept.length) return false;
  const arr = new Float32Array(kept.length * 16);
  kept.forEach((i, k) => {
    m.getMatrixAt(i, tmpM);
    tmpM.toArray(arr, k * 16);
  });
  m.instanceMatrix = new InstancedBufferAttribute(arr, 16);
  if (m.instanceColor) {
    const src = m.instanceColor;
    const col = new Float32Array(kept.length * 3);
    kept.forEach((i, k) => col.set([src.getX(i), src.getY(i), src.getZ(i)], k * 3));
    m.instanceColor = new InstancedBufferAttribute(col, 3);
  }
  m.count = kept.length;
  return true;
}

export interface Shown {
  id: string;
  group: Group;
  loaded: LoadedRoom;
  dispose(): void;
}

/** Materials whose meshes are not shown from outside: the room's window panorama and its screens (the building's own glass is there). */
const HIDE_FROM_OUTSIDE = /^(M_garden|M_screen|M_view)$/;

/** One loaded room as seen from outside: a clone (shared geometry and maps), its own-light materials, placed by `room`'s frame. */
export function showRoom(loaded: LoadedRoom, room: PortalRoom, direct: { value: number }, night: { value: number }): Shown {
  const scene = loaded.root.clone(true);
  scene.updateMatrixWorld(true);
  const made = new Map<Material, Material>();
  const geos: BufferGeometry[] = [];
  const mats: Material[] = [];
  const rect = { minX: room.min[0], maxX: room.max[0], minZ: room.min[2], maxZ: room.max[2] };
  const drop: Object3D[] = [];
  scene.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as Material;
    if (HIDE_FROM_OUTSIDE.test(mat.name)) {
      drop.push(m);
      return;
    }
    m.raycast = () => {};
    m.castShadow = false;
    m.receiveShadow = false;
    if ((m as InstancedMesh).isInstancedMesh) {
      // the copies standing outside the room (the kit's porch columns, the lanterns under the eaves): left out
      if (!keepInstancesInside(m as InstancedMesh, rect, room.cut)) drop.push(m);
    } else {
      const g = insideRect(m.geometry, m.matrixWorld, rect, room.cut);
      if (g) {
        m.geometry = g;
        geos.push(g);
      }
    }
    let v = made.get(mat);
    if (!v) {
      v = showcaseMaterial(mat, loaded, direct, night);
      made.set(mat, v);
      if (v !== mat) mats.push(v);
    }
    m.material = v;
  });
  for (const o of drop) o.parent?.remove(o);
  const group = new Group();
  group.name = `room_showcase_${room.id}`;
  group.matrixAutoUpdate = false;
  group.matrix.copy(frameToVillage(room.frame));
  group.add(scene);
  group.updateMatrixWorld(true);
  return {
    id: room.id,
    group,
    loaded,
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
    },
  };
}

interface LotEntry {
  id: string;
  area: string;
  room: PortalRoom;
  box: GlassBox;
}

function lotEntries(): LotEntry[] {
  return PORTAL_LOT_UNITS.map((u) => {
    const r = LOT_ROOMS.find((x) => x.unit.id === u)!;
    const f = lotFootprint(r.lot);
    return { id: u, area: r.area, room: lotPortalRoom(r), box: [f.minX, f.minZ, f.maxX, f.maxZ] as const };
  });
}

declare global {
  interface Window {
    /** DEV: the rooms drawn behind the lots' glass now, and those wanted. */
    __cvRoomShowcase?: () => { shown: string[]; wanted: string[] };
  }
}

/**
 * Where the lot's model may stand in for its room (village): the building's inside from 0.8 m behind the door wall to 0.35 m short of the
 * back and side walls, from just under the room's floor to its ceiling. The 대웅전's brown backdrop spans the hall's whole width: wider
 * than the room drawn, so the building's inside (not the room's box) is the measure.
 */
function standInFoot(e: LotEntry): Footprint {
  const r = LOT_ROOMS.find((x) => x.unit.id === e.id)!;
  const lot = r.lot;
  const place = LOT_ROOM_PLACE[e.id]!;
  const front = lot.body.z1 - place.wallIn - 0.8;
  const a = lotLocalToWorld(lot, lot.body.x0 + 0.35, lot.body.z0 + 0.35);
  const b = lotLocalToWorld(lot, lot.body.x1 - 0.35, front);
  const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x), minZ = Math.min(a.z, b.z), maxZ = Math.max(a.z, b.z);
  const y0 = place.lift - 0.15, y1 = place.lift + e.room.max[1];
  return { minX, maxX, minZ, maxZ, maxY: y1, minTop: -1, inside: (x, y, z) => x > minX && x < maxX && z > minZ && z < maxZ && y > y0 && y < y1 };
}

/** Whether `o` is (in) a door leaf: those swing into the room and stay. */
function inDoor(o: Object3D | null): boolean {
  for (; o; o = o.parent) if (o.name.includes("door__")) return true;
  return false;
}

/**
 * Take the lot model's stand-ins for its room out while the real room is drawn (the 대웅전's brown backdrop behind its doors, a floor
 * plane where the room has its own): every triangle with all three corners inside the room's inner volume, the door leaves kept.
 * Returns the undo.
 */
function trimStandIns(root: Object3D, lots: readonly LotEntry[]): () => void {
  const feet = lots.map(standInFoot);
  if (!feet.length) return () => {};
  const undo: Array<() => void> = [];
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || (mesh as InstancedMesh).isInstancedMesh || inDoor(mesh)) return;
    const t = trimMesh(mesh, feet);
    if (!t) return;
    const original = mesh.geometry;
    mesh.geometry = t.geometry;
    undo.push(() => {
      if (mesh.geometry !== t.geometry) return;
      mesh.geometry = original;
      t.geometry.dispose();
    });
  });
  return () => undo.reverse().forEach((u) => u());
}

interface Active {
  release: () => void;
  shown: Shown | null;
  live: boolean;
}

/** The lots' rooms behind their glass and doors (mounted with the lots: `root` their model, `glass` their shared pane material). */
export function LotRoomShowcase({ root, glass }: { root: Object3D; glass: ClearGlass | null }) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const tier = useQualityTier();
  const phone = tier !== "high";
  const entries = useMemo(lotEntries, []);
  const direct = useMemo(() => ({ value: SHOW_DIRECT }), []);
  const night = useMemo(() => ({ value: 0 }), []);
  const holder = useMemo(() => {
    const g = new Group();
    g.name = "room_showcases";
    return g;
  }, []);
  const active = useRef(new Map<string, Active>());

  const untrim = useRef<() => void>(() => {});
  /** The glass clear over the drawn rooms, and the lots' stand-ins out of them (all at once: the shells are merged across lots). */
  const sync = () => {
    const drawn = entries.filter((e) => active.current.get(e.id)?.shown);
    glass?.setShown(drawn.map((e) => e.box));
    untrim.current();
    untrim.current = trimStandIns(root, drawn);
  };

  const start = (e: LotEntry) => {
    const h = holdLotRoom(e.area, gl, phone);
    if (!h) return;
    const a: Active = { release: h.release, shown: null, live: true };
    active.current.set(e.id, a);
    h.promise
      .then((loaded) => {
        if (!a.live) return;
        a.shown = showRoom(loaded, e.room, direct, night);
        holder.add(a.shown.group);
        sync();
      })
      .catch((err: unknown) => console.warn(`[portal] room ${e.id}`, err));
  };
  const stop = (id: string) => {
    const a = active.current.get(id);
    if (!a) return;
    a.live = false;
    if (a.shown) {
      holder.remove(a.shown.group);
      a.shown.dispose();
    }
    a.release();
    active.current.delete(id);
    sync();
  };

  // a new tier (phone / PC files) or model: start over
  useEffect(() => {
    const act = active.current;
    return () => {
      for (const id of [...act.keys()]) stop(id);
    };
  }, [phone, root, gl]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    window.__cvRoomShowcase = () => ({
      shown: [...active.current].filter(([, a]) => a.shown).map(([id]) => id),
      wanted: [...active.current.keys()],
    });
    return () => {
      delete window.__cvRoomShowcase;
    };
  }, []);

  useFrame(({ clock }) => {
    const p = camera.position;
    const lim = phone ? SHOW_M.phone : SHOW_M.pc;
    const act = active.current;
    const near = entries
      .map((e) => {
        const [x0, z0, x1, z1] = e.box;
        const d = Math.hypot(Math.max(x0 - p.x, 0, p.x - x1), Math.max(z0 - p.z, 0, p.z - z1));
        return { e, d: d - (act.has(e.id) ? HYST : 0) };
      })
      .filter((x) => x.d < lim && ROOMS_ON)
      .sort((a, b) => a.d - b.d)
      .slice(0, phone ? PHONE_MAX : entries.length);
    const want = new Set(near.map((x) => x.e.id));
    for (const id of [...act.keys()]) if (!want.has(id)) stop(id);
    for (const x of near) if (!act.has(x.e.id)) start(x.e);
    const o = dayNight.outdoor;
    applyClearGlassDayNight(o);
    const day = Math.max(0, Math.min(1, 1 - o.night));
    direct.value = SHOW_DIRECT * day;
    night.value = Math.max(o.night, o.lights * 0.8);
    for (const a of act.values()) if (a.shown) driveRoomLights(a.shown.loaded, clock.elapsedTime);
  });

  return <primitive object={holder} dispose={null} />;
}

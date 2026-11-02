import {
  Box3,
  MeshBasicMaterial,
  Quaternion,
  SRGBColorSpace,
  Vector3,
  type Material,
  type Mesh,
  type Object3D,
  type Texture,
} from "three";
import { ROOM_IDS, type RoomId } from "@caysonverse/shared/escape/constants";
import { HUB_DOORS } from "@caysonverse/shared/school/hubMap";
import type { ShaftPoint } from "../LightShafts";

/**
 * The hub model (`hub.glb`: the central hall, the east corridor and a campus backdrop, AI 학교 탈출 Task 23) —
 * the pure part: what the art pipeline promises about the file and how the game dresses it, so every rule is
 * unit-tested without a browser or a GLB loader (hubModel.test.ts builds a node tree with the same names).
 *
 * The file's contract (art/school/notes.md, checked by scripts/check-school-glb.ts):
 *  - Materials named `LM_*` are unlit (KHR_materials_unlit → MeshBasicMaterial) and carry a baked light on the
 *    second UV set; the game adds the light map: `lightMap` from the WebP, channel 1, flipY false, sRGB, and
 *    `lightMapIntensity = 1.6π` (three's basic shader computes albedo × lightMap × intensity / π; the file stores
 *    L / 2, so 2π would reproduce the bake exactly and 1.6π is the tuned brightness).
 *  - `M_*` materials never get a light map. `M_cloud` (the far cloud cards, 50-95 m out) ignores the fog.
 *  - `col__*` nodes are the collision boxes (shared/…/hubColliders.ts is generated from them): hidden at load.
 *  - Nodes the scene drives: `gate__east` → `gate__east__bar_1..8` + `gate__east__rails`, `board_window__<RoomId>`,
 *    `door__<RoomId>` → `__L` / `__R`, `pad__<RoomId>`, and `shaft__<n>` (a window the sun shines through).
 *
 * `prepareHub` works on a CLONE of the cached glTF scene (geometry and the shared materials are shared with the
 * cache, so a second mount costs nothing) and returns the handles the scene's components need. Materials that a
 * component changes per room (window panes, pads, door leaves, the gate) are cloned here, once, and listed in
 * `own` so the model can release them.
 */

export const HUB_MODEL_URL = "/models/school/hub.glb";
export const HUB_LIGHTMAP_URL = "/models/school/hub_lightmap.webp";
/** Where the Draco decoder lives (copied from three's examples, Apache-2.0: client/public/draco/). */
export const DRACO_PATH = "/draco/";

/** The light map's strength: 1.6π (see above). */
export const LIGHTMAP_INTENSITY = 1.6 * Math.PI;
/** The light map sits on the second UV set (`uv1`). */
export const LIGHTMAP_CHANNEL = 1;

export const COLLIDER_PREFIX = "col__";
export const LIGHTMAP_MATERIAL_PREFIX = "LM_";
export const CLOUD_MATERIAL = "M_cloud";
const GLOW_MATERIAL = "M_glow";
const SHAFT_PREFIX = "shaft__";

export const GATE_BAR_COUNT = 8;
export const nodeName = {
  gate: "gate__east",
  gateBar: (i: number): string => `gate__east__bar_${i}`,
  gateRails: "gate__east__rails",
  window: (room: RoomId): string => `board_window__${room}`,
  door: (room: RoomId): string => `door__${room}`,
  pad: (room: RoomId): string => `pad__${room}`,
} as const;

/** The progress-board pane of one room. */
export interface WindowNode {
  mesh: Mesh;
  /** This pane's own material (a clone of `M_board_window`), so the room's colour never reaches its neighbours. */
  material: MeshBasicMaterial;
  /** The pane's colour as the model has it (the "not cleared yet" pale glass). */
  unlit: MeshBasicMaterial["color"];
}

export interface GateNode {
  /** `gate__east`: origin on the floor, so scaling Y sinks the bars and rails into it. */
  group: Object3D;
  /** One cloned glow material for the bars and the rails. */
  material: MeshBasicMaterial;
}

export interface PadNode {
  mesh: Mesh;
  /** The pad's own material (a clone of the palette one): `color` tints the baked mat with a team colour. */
  material: MeshBasicMaterial;
}

export interface DoorNode {
  group: Object3D;
  /** Both leaves share this clone: `color` greys a door whose room is closed. */
  material: MeshBasicMaterial;
  /** World z of the leaf face that looks into the corridor (where a sticker can be hung). */
  frontZ: number;
  /** +1 when that face looks toward +z (a door in the north wall), -1 for the south wall. */
  facing: 1 | -1;
}

export interface HubNodes {
  /** The scene graph to render (a clone). */
  root: Object3D;
  gate: GateNode | null;
  windows: Partial<Record<RoomId, WindowNode>>;
  pads: Partial<Record<RoomId, PadNode>>;
  doors: Partial<Record<RoomId, DoorNode>>;
  /** The windows the sun shines through, ordered by number. */
  shafts: ShaftPoint[];
  /** Materials this call made (and nothing else): dispose them with the scene. */
  own: Material[];
}

export function isMesh(o: Object3D): o is Mesh {
  return (o as Mesh).isMesh === true;
}

/** Every material of a mesh as an array (a mesh may hold one or several). */
export function materialsOf(mesh: Mesh): Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

/** Light-map texture settings (idempotent: a texture that is already right is left alone, no re-upload). */
export function configureLightmap(texture: Texture): Texture {
  if (texture.flipY || texture.colorSpace !== SRGBColorSpace || texture.channel !== LIGHTMAP_CHANNEL) {
    texture.flipY = false;
    texture.colorSpace = SRGBColorSpace;
    texture.channel = LIGHTMAP_CHANNEL;
    texture.needsUpdate = true;
  }
  return texture;
}

/** Put the light map on one material (the `LM_*` rule). The same material twice is harmless. */
export function lightmapMaterial(material: Material, lightmap: Texture): void {
  const m = material as MeshBasicMaterial;
  if (m.lightMap === lightmap && m.lightMapIntensity === LIGHTMAP_INTENSITY) return;
  m.lightMap = lightmap;
  m.lightMapIntensity = LIGHTMAP_INTENSITY;
  m.needsUpdate = true;
}

/** The node of that name below `root`, or null. */
function find(root: Object3D, name: string): Object3D | null {
  return root.getObjectByName(name) ?? null;
}

/** First mesh at or below `o`. */
function firstMesh(o: Object3D): Mesh | null {
  if (isMesh(o)) return o;
  for (const c of o.children) {
    const m = firstMesh(c);
    if (m) return m;
  }
  return null;
}

/** A private copy of a mesh's material (kept as a MeshBasicMaterial), registered in `own`. */
function ownMaterial(mesh: Mesh, own: Material[]): MeshBasicMaterial {
  const clone = (materialsOf(mesh)[0] as MeshBasicMaterial).clone();
  mesh.material = clone;
  own.push(clone);
  return clone;
}

const tmpQuat = new Quaternion();
const tmpDir = new Vector3();
const tmpPos = new Vector3();

/** The `shaft__<n>` empties as points: world position, and the yaw of the inward direction (local +Z). Load time only. */
export function readShafts(root: Object3D): ShaftPoint[] {
  root.updateMatrixWorld(true);
  const found: Array<{ n: number; point: ShaftPoint }> = [];
  root.traverse((o) => {
    if (!o.name.startsWith(SHAFT_PREFIX)) return;
    o.getWorldPosition(tmpPos);
    o.getWorldQuaternion(tmpQuat);
    tmpDir.set(0, 0, 1).applyQuaternion(tmpQuat);
    found.push({
      n: Number(o.name.slice(SHAFT_PREFIX.length)),
      point: { x: tmpPos.x, y: tmpPos.y, z: tmpPos.z, rotY: Math.atan2(tmpDir.x, tmpDir.z) },
    });
  });
  found.sort((a, b) => a.n - b.n);
  return found.map((f) => f.point);
}

/**
 * Dress a clone of the hub model for the game (see the file header) and collect the nodes the scene drives.
 * Safe to call again on the same source scene (the shared materials are changed idempotently).
 */
export function prepareHub(source: Object3D, lightmap: Texture): HubNodes {
  const root = source.clone(true);
  configureLightmap(lightmap);
  const own: Material[] = [];

  root.traverse((o) => {
    if (o.name.startsWith(COLLIDER_PREFIX)) {
      o.visible = false;
      return;
    }
    if (!isMesh(o)) return;
    for (const m of materialsOf(o)) {
      if (m.name.startsWith(LIGHTMAP_MATERIAL_PREFIX)) lightmapMaterial(m, lightmap);
      else if (m.name === CLOUD_MATERIAL) (m as MeshBasicMaterial).fog = false;
    }
  });
  root.updateMatrixWorld(true);

  // The gate: its bars and rails glow together (one private glow material), and sink together (the group's Y scale).
  let gate: GateNode | null = null;
  const gateGroup = find(root, nodeName.gate);
  if (gateGroup) {
    const parts: Mesh[] = [];
    gateGroup.traverse((o) => {
      if (isMesh(o) && materialsOf(o)[0]?.name === GLOW_MATERIAL) parts.push(o);
    });
    if (parts.length > 0) {
      const material = (materialsOf(parts[0]!)[0] as MeshBasicMaterial).clone();
      own.push(material);
      for (const p of parts) p.material = material;
      gate = { group: gateGroup, material };
    }
  }

  const windows: HubNodes["windows"] = {};
  const pads: HubNodes["pads"] = {};
  const doors: HubNodes["doors"] = {};
  const box = new Box3();
  for (const room of ROOM_IDS) {
    const wNode = find(root, nodeName.window(room));
    const wMesh = wNode ? firstMesh(wNode) : null;
    if (wMesh) {
      const material = ownMaterial(wMesh, own);
      windows[room] = { mesh: wMesh, material, unlit: material.color.clone() };
    }
  }
  for (const d of HUB_DOORS) {
    // `pad__<room>` itself is the baked mat; its `__glow` child (the glowing ring) keeps the shared glow material.
    const pNode = find(root, nodeName.pad(d.room));
    const pMesh = pNode ? firstMesh(pNode) : null;
    if (pMesh) pads[d.room] = { mesh: pMesh, material: ownMaterial(pMesh, own) };

    const dNode = find(root, nodeName.door(d.room));
    if (dNode) {
      const leaves: Mesh[] = [];
      dNode.traverse((o) => {
        if (isMesh(o)) leaves.push(o);
      });
      if (leaves.length > 0) {
        const material = (materialsOf(leaves[0]!)[0] as MeshBasicMaterial).clone();
        own.push(material);
        for (const l of leaves) l.material = material;
        box.setFromObject(dNode);
        const facing = d.side === "n" ? 1 : -1;
        doors[d.room] = { group: dNode, material, frontZ: facing === 1 ? box.max.z : box.min.z, facing };
      }
    }
  }

  return { root, gate, windows, pads, doors, shafts: readShafts(root), own };
}

/** Release what `prepareHub` made (the shared model materials, geometry and textures stay with the loader's cache). */
export function disposeHub(nodes: HubNodes): void {
  for (const m of nodes.own) m.dispose();
}

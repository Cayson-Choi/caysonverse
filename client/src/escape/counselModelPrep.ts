import { MeshBasicMaterial, type Material, type Mesh, type Object3D, type Texture } from "three";
import type { VisualBinding } from "@caysonverse/shared/school/counselMap";
import type { ShaftPoint } from "../game/LightShafts";
import {
  CLOUD_MATERIAL,
  COLLIDER_PREFIX,
  LIGHTMAP_MATERIAL_PREFIX,
  configureLightmap,
  isMesh,
  lightmapMaterial,
  materialsOf,
  readShafts,
} from "../game/hub/hubModelPrep";
import { LIGHTS_FROM, easeInOut } from "./escapeTimeline";

/**
 * The counselling-room model (`counsel.glb`, AI 학교 탈출 Task 24) — the pure part: how the game dresses the file and how
 * the puzzle flags move its nodes, so every rule is unit-tested without a browser or a GLB loader (counselModelPrep.test.ts
 * builds a node tree with the same names).
 *
 * The file's contract is the hub's (hubModelPrep.ts: `LM_*` materials are unlit and carry the baked light map on the second
 * UV set, `M_cloud` ignores the fog, `col__*` are hidden collision boxes, `shaft__*` empties mark the sunny windows) plus the
 * room's own: every puzzle object is a root node `obj__<id>` at identity rotation whose ORIGIN is its pivot, and
 * `COUNSEL_VISUALS` (shared/…/counselMap.ts) names the nodes a flag moves:
 *   hide   the piece goes away (it shrinks over EASE_SECONDS, then stops being drawn),
 *   show   the opposite,
 *   open   the node swings about its own origin (the hinge) by `angle` radians,
 *   glow   the node's colour is pushed past 1 (warm), which the rich tier's bloom turns into a glow.
 * The last door (`obj__exit_door`, flag `escaped`) is NOT a flag part: the escape show's clock drives it (`door`).
 *
 * The room is "broken" until the escape: its baked colours are multiplied by a blue-grey tint (`tintFor`), which the show lifts
 * as `lights` goes 0.72 → 1. The tint multiplies `material.color`, which three's basic shader applies on top of the light map.
 *
 * `prepareCounsel` works on a CLONE of the cached glTF scene and gives it private copies of every `LM_*` material (the tint and
 * the glow change colours; the cached originals stay untouched) — all listed in `own` so the scene can release them.
 */

export const COUNSEL_LIGHTMAP_URL = "/models/school/counsel_lightmap.webp";

/** Seconds a flag takes to move its node (hide / open / glow). */
export const EASE_SECONDS = 0.4;

/** The node the escape show drives, not a flag. */
export const EXIT_DOOR_NODE = "obj__exit_door";
/** The 반딧 figure by the door: decoration with an idle motion. */
export const BANDIT_NODE = "deco__bandit";

/**
 * The broken room's colour multiplier (blue-grey, about 72 % on average — escapeTimeline's `LIGHTS_FROM`). At `lights` 1 the
 * room is its own colour. (The page's grey haze over the 3D view, EscapeVeil, is a second, much lighter layer of the same look.)
 */
export const BROKEN_TINT = { r: 0.66, g: 0.71, b: 0.82 } as const;

/** What a full glow adds to a colour (multiplied on): warm, so the lit part reads golden and blooms on the rich tier. */
export const GLOW_ADD = { r: 1.5, g: 1.2, b: 0.5 } as const;

/** The glow of the last door while it opens (the show's `doorGlow`, then fading as it swings: Task 20's look). */
export const DOOR_GLOW_ADD = { r: 1.2, g: 1.0, b: 0.45 } as const;

export interface GlowPart {
  /** This node's own material (a private copy of its light-mapped or glowing one). */
  material: MeshBasicMaterial;
  /** Whether the broken-room tint applies to it (a baked `LM_*` surface; the glowing screen face is not tinted). */
  tinted: boolean;
}

export interface Part {
  binding: VisualBinding;
  node: Object3D;
  /** How far the flag's effect has come: 0 (flag off) .. 1 (flag on). It moves toward `target` at 1 / EASE_SECONDS per second. */
  value: number;
  /** 1 when the flag is set, else 0. */
  target: number;
  /** The node's yaw as the model has it (the swing is added to it). */
  baseRotY: number;
  glow: GlowPart | null;
}

export interface DoorPart {
  node: Object3D;
  baseRotY: number;
  /** Radians the door swings when fully open (the binding's angle). */
  angle: number;
  /** The door's own material: tinted and glowing. */
  material: MeshBasicMaterial;
}

export interface CounselNodes {
  /** The scene graph to render (a clone). */
  root: Object3D;
  /** Flag-driven parts, in `COUNSEL_VISUALS` order (a binding whose node is missing is left out). */
  parts: Part[];
  door: DoorPart | null;
  bandit: Object3D | null;
  /** The room-wide light-mapped materials (the tint's targets): one private copy of each `LM_*` material. */
  tinted: MeshBasicMaterial[];
  /** The current tint, written by `tintFor` (reused, so painting allocates nothing). */
  tint: { r: number; g: number; b: number };
  /** The windows the sun shines through, ordered by number. */
  shafts: ShaftPoint[];
  /** Materials this call made (and nothing else): dispose them with the scene. */
  own: Material[];
}

/** Every mesh at or below `o`. */
function meshesOf(o: Object3D, out: Mesh[] = []): Mesh[] {
  if (isMesh(o)) out.push(o);
  for (const c of o.children) meshesOf(c, out);
  return out;
}

/** A private copy of `material` for one node (every mesh of the node uses it); registered in `own`. */
function ownCopy(node: Object3D, own: Material[]): MeshBasicMaterial | null {
  const meshes = meshesOf(node);
  const first = meshes[0] ? (materialsOf(meshes[0])[0] as MeshBasicMaterial | undefined) : undefined;
  if (!first) return null;
  const copy = first.clone();
  own.push(copy);
  for (const m of meshes) m.material = copy;
  return copy;
}

/**
 * Dress a clone of the room model (see the file header) and collect the nodes the scene drives. `bindings` is the room's
 * `COUNSEL_VISUALS`. Safe to call again on the same source scene (it never changes a shared material).
 */
export function prepareCounsel(source: Object3D, lightmap: Texture, bindings: readonly VisualBinding[]): CounselNodes {
  const root = source.clone(true);
  configureLightmap(lightmap);
  const own: Material[] = [];
  const tinted: MeshBasicMaterial[] = [];
  const copies = new Map<Material, Material>();

  root.traverse((o) => {
    if (o.name.startsWith(COLLIDER_PREFIX)) {
      o.visible = false;
      return;
    }
    if (!isMesh(o)) return;
    const mats = materialsOf(o);
    const dressed = mats.map((m) => {
      if (m.name === CLOUD_MATERIAL) (m as MeshBasicMaterial).fog = false;
      if (!m.name.startsWith(LIGHTMAP_MATERIAL_PREFIX)) return m;
      let copy = copies.get(m);
      if (!copy) {
        copy = m.clone();
        lightmapMaterial(copy, lightmap);
        copies.set(m, copy);
        own.push(copy);
        tinted.push(copy as MeshBasicMaterial);
      }
      return copy;
    });
    o.material = Array.isArray(o.material) ? dressed : dressed[0]!;
  });
  root.updateMatrixWorld(true);

  const parts: Part[] = [];
  let door: DoorPart | null = null;
  for (const binding of bindings) {
    const node = root.getObjectByName(binding.node);
    if (!node) continue;
    if (binding.node === EXIT_DOOR_NODE) {
      const material = ownCopy(node, own);
      // The door's copy is painted on its own (it glows), not with the room-wide tint list.
      if (material) door = { node, baseRotY: node.rotation.y, angle: binding.angle ?? 0, material };
      continue;
    }
    let glow: GlowPart | null = null;
    if (binding.effect === "glow") {
      const material = ownCopy(node, own);
      if (material) glow = { material, tinted: material.name.startsWith(LIGHTMAP_MATERIAL_PREFIX) };
    }
    parts.push({ binding, node, value: 0, target: 0, baseRotY: node.rotation.y, glow });
  }
  const bandit = root.getObjectByName(BANDIT_NODE) ?? null;
  return { root, parts, door, bandit, tinted, tint: { r: 1, g: 1, b: 1 }, shafts: readShafts(root), own };
}

/** Put a part's node where its `value` says (the effect's mapping; the glow is read by `paintCounsel`). */
export function placePart(p: Part): void {
  const e = easeInOut(p.value);
  switch (p.binding.effect) {
    case "hide":
      p.node.visible = p.value < 1;
      p.node.scale.setScalar(1 - e);
      break;
    case "show":
      p.node.visible = p.value > 0;
      p.node.scale.setScalar(e);
      break;
    case "open":
      p.node.rotation.y = p.baseRotY + (p.binding.angle ?? 0) * e;
      break;
    case "glow":
      break;
  }
}

/**
 * Set every part's target from the team's flags. `snap` puts the part there at once (the first look at a room that is
 * already part-way solved, a refresh mid-game); otherwise it eases. Returns whether any part has still to move.
 */
export function setPartTargets(parts: readonly Part[], flags: ReadonlySet<string>, snap: boolean): boolean {
  let moving = false;
  for (const p of parts) {
    p.target = flags.has(p.binding.flag) ? 1 : 0;
    if (snap) {
      p.value = p.target;
      placePart(p);
    } else if (p.value !== p.target) {
      moving = true;
    }
  }
  return moving;
}

/** Advance the parts by `dt` seconds toward their targets. Returns whether any is still moving afterwards. */
export function stepParts(parts: readonly Part[], dt: number): boolean {
  let moving = false;
  const step = dt / EASE_SECONDS;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    if (p.value === p.target) continue;
    p.value = p.target > p.value ? Math.min(p.target, p.value + step) : Math.max(p.target, p.value - step);
    placePart(p);
    if (p.value !== p.target) moving = true;
  }
  return moving;
}

/** Swing the last door: `open` 0..1 (the show's `doorOpen`), eased. */
export function placeDoor(door: DoorPart, open: number): void {
  door.node.rotation.y = door.baseRotY + door.angle * easeInOut(open);
}

/** The broken-room multiplier for `lights` (0.72 broken .. 1 set right), written into `out`. */
export function tintFor(lights: number, out: { r: number; g: number; b: number }): void {
  const t = lights >= 1 ? 1 : lights <= LIGHTS_FROM ? 0 : (lights - LIGHTS_FROM) / (1 - LIGHTS_FROM);
  out.r = BROKEN_TINT.r + (1 - BROKEN_TINT.r) * t;
  out.g = BROKEN_TINT.g + (1 - BROKEN_TINT.g) * t;
  out.b = BROKEN_TINT.b + (1 - BROKEN_TINT.b) * t;
}

/**
 * Write the colours: the room-wide tint for `lights`, each glowing part's colour (tint x glow) and the door's (tint x its glow
 * `doorGlow`). Plain number writes into existing colours — nothing is allocated, so the scene may call it every frame it changes.
 */
export function paintCounsel(nodes: CounselNodes, lights: number, doorGlow: number): void {
  const k = nodes.tint;
  tintFor(lights, k);
  for (let i = 0; i < nodes.tinted.length; i++) nodes.tinted[i]!.color.setRGB(k.r, k.g, k.b);
  for (let i = 0; i < nodes.parts.length; i++) {
    const p = nodes.parts[i]!;
    const g = p.glow;
    if (!g) continue;
    const e = easeInOut(p.value);
    const r = (g.tinted ? k.r : 1) * (1 + GLOW_ADD.r * e);
    const gr = (g.tinted ? k.g : 1) * (1 + GLOW_ADD.g * e);
    const b = (g.tinted ? k.b : 1) * (1 + GLOW_ADD.b * e);
    g.material.color.setRGB(r, gr, b);
  }
  const d = nodes.door;
  if (d) d.material.color.setRGB(k.r * (1 + DOOR_GLOW_ADD.r * doorGlow), k.g * (1 + DOOR_GLOW_ADD.g * doorGlow), k.b * (1 + DOOR_GLOW_ADD.b * doorGlow));
}

/** Release what `prepareCounsel` made (the shared model geometry and textures stay with the loader's cache until `disposeModel`). */
export function disposeCounsel(nodes: CounselNodes): void {
  for (const m of nodes.own) m.dispose();
}

/**
 * Free the GPU resources of the loaded model itself (geometry, materials, their textures) — the room is left for good and its
 * cache entry is cleared, so nobody uses them again. Call it once the clone is gone.
 */
export function disposeModel(scene: Object3D): void {
  const done = new Set<{ dispose(): void }>();
  const free = (r: { dispose(): void } | null | undefined): void => {
    if (!r || done.has(r)) return;
    done.add(r);
    r.dispose();
  };
  scene.traverse((o) => {
    if (!isMesh(o)) return;
    free(o.geometry);
    for (const m of materialsOf(o)) {
      free((m as MeshBasicMaterial).map);
      free((m as MeshBasicMaterial).lightMap);
      free(m);
    }
  });
}

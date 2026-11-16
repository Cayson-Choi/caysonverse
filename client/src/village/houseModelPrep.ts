import { BufferAttribute, Color, Matrix4, RepeatWrapping, Vector3, type InstancedMesh, type Material, type Mesh, type MeshBasicMaterial, type Object3D, type Texture } from "three";
import { COLLIDER_PREFIX, LIGHTMAP_MATERIAL_PREFIX, configureLightmap, isMesh, lightmapMaterial, materialsOf } from "../game/hub/hubModelPrep";
import { HOUSE_FLOORS, HOUSE_NODE, houseFiles, type HouseFloor, type HouseNumber } from "@caysonverse/shared/village/houseAreas";
import { freeTexture } from "./villageModelPrep";
import { HOUSE_REMOVED_PIECES } from "@caysonverse/shared/village/houseFixes";

/**
 * A house's interior (`house_N.glb`, 집 실내 G) dressed for the game — the pure part, like memorialModelPrep.ts.
 *
 * The file's contract (docs/designs/houses-interior/contract.md ch. 5; checked by scripts/check-school-glb.ts kind `house`): both floors
 * are in ONE file at their world coordinates; the visible meshes of a floor hang under `floor__h<N>_<F>`, the stair / door / spawn
 * markers, the `seat__` empties and the `col__` collision boxes are root nodes, and `ceil__h<N>_<F>` is that floor's ceiling slab.
 * The game shows ONE floor at a time (`prepareHouse` hides the other floor's group and ceiling), hides the collision boxes, and puts
 * the baked light on the `LM_*` materials when the file has any — the blockout (and a house with no light bake yet) has only `M_*`
 * materials: they are drawn as loaded, lit by the village's indoor light.
 *
 * `prepareHouse` works on a CLONE of the cached scene; the loader's materials are changed idempotently (the light map), so nothing is
 * copied and `disposeHouse` only frees the clone's instance buffers. A house keeps the same file for both floors, so going up or down
 * stairs prepares a new clone of the same cached scene (no download).
 */

/** The window panorama's material: the model's window-view cards use this name (day on the image's top half, night on its bottom half). */
export const HOUSE_VIEW_MATERIAL = "M_view";

/**
 * The two builders name the baked materials differently: houses 1–5 (HA) `LM_*` (the hall's rule), houses 6–10 (HB) `E_H_*` (bake_house_hb.py
 * `export_materials`) — every `E_H_*` but the lamp, the lamp shade and the glass carries the light map on its second UV set.
 */
const HB_PREFIX = "E_H_";
const HB_DIRECT = new Set(["E_H_lamp", "E_H_shade", "E_H_glass"]);
/** The lit-from-within materials (bulbs, lamp shades): drawn as they are, a little dimmer by day (patchHouseGlowMaterial). */
const GLOW = new Set(["M_lamp", "M_shade", "E_H_lamp", "E_H_shade"]);

/** Whether a house material takes the baked light map (`LM_*`, or HB's `E_H_*` but its lamp / shade / glass). */
export function isHouseLightmapMaterial(name: string): boolean {
  return name.startsWith(LIGHTMAP_MATERIAL_PREFIX) || (name.startsWith(HB_PREFIX) && !HB_DIRECT.has(name));
}

/** Whether a house material is a lamp's bulb or shade (it glows: brighter at night). */
export function isHouseGlowMaterial(name: string): boolean {
  return GLOW.has(name);
}

/**
 * How a house's window panorama sits on its view band (the ring / cylinder round each floor, material `M_view`). Both builders give the band
 * the same horizontal UV: u = 0.5 + b / 2π, b = the bearing in the house's world frame clockwise from world −z (the way one looks coming in:
 * every house interior has its front door on its world +z wall). The IMAGES differ:
 *  - HA (houses 1–5, render_view.py): the image centre looks into the house away from its real front door, u growing clockwise —
 *    exactly the band's u, so no shift;
 *  - HB (houses 6–10, render_view_pano.py): the image centre is the village's NORTH whatever way the house faces, so the band must turn by
 *    the house's real door bearing: the interior's door (south, π) stands for the village door — n: 0, e: π/2, s: π, w: 3π/2 — and
 *    u_image = u_band + (doorBearing − π) / 2π.
 * Vertically HA's band spans the whole image half (v 0..1 in the file), HB's its top half (v 0..0.5): `vScale` stretches it to 0..1 (the
 * shader then picks the day or the night half).
 */
export function houseViewMapping(n: HouseNumber, doorSide: "n" | "s" | "e" | "w", vSpan: number): { uShift: number; vScale: number } {
  const DOOR_BEARING = { n: 0, e: Math.PI / 2, s: Math.PI, w: (3 * Math.PI) / 2 } as const;
  const hb = n >= 6;
  const shift = hb ? (DOOR_BEARING[doorSide] - Math.PI) / (2 * Math.PI) : 0;
  return { uShift: shift - Math.floor(shift), vScale: vSpan > 0.75 ? 1 : 2 };
}

/** The vertical extent (max − min) of the view band's texture coordinates in the file: ≈ 1 (HA) or ≈ 0.5 (HB). */
export function viewBandVSpan(root: Object3D): number {
  let lo = Infinity;
  let hi = -Infinity;
  root.traverse((o) => {
    if (!isMesh(o) || !materialsOf(o).some((m) => m.name === HOUSE_VIEW_MATERIAL)) return;
    const uv = o.geometry.getAttribute("uv");
    if (!uv) return;
    for (let i = 0; i < uv.count; i++) {
      const y = uv.getY(i);
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
  });
  return hi > lo ? hi - lo : 1;
}

export interface HouseNodes {
  root: Object3D;
  /** The light-mapped materials (empty for a model without a light bake). */
  lightmapped: Material[];
  /** The window panorama materials (`M_view`), if the model has any. */
  views: Material[];
  /** The lamps' bulbs and shades. */
  glows: Material[];
}

/** The file URLs of house N (houseAreas.ts `houseFiles`), the light map and the night map by quality tier. */
export function houseUrls(n: HouseNumber, tier: "high" | "low") {
  const f = houseFiles(n);
  return {
    glb: f.glb,
    lightmapDay: tier === "high" ? f.lightmapDay : f.lightmapDay1k,
    lightmapNight: tier === "high" ? f.lightmapNight : f.lightmapNight1k,
    view: f.view,
  };
}

/** Whether a loaded house scene has `LM_*` materials, i.e. wants a light map. */
export function houseWantsLightmap(scene: Object3D): boolean {
  let wants = false;
  scene.traverse((o) => {
    if (wants || !isMesh(o)) return;
    for (const m of materialsOf(o)) if (isHouseLightmapMaterial(m.name)) wants = true;
  });
  return wants;
}

/** Whether a loaded house scene has a window-view material. */
export function houseWantsView(scene: Object3D): boolean {
  let wants = false;
  scene.traverse((o) => {
    if (wants || !isMesh(o)) return;
    for (const m of materialsOf(o)) if (m.name === HOUSE_VIEW_MATERIAL) wants = true;
  });
  return wants;
}

/** The wall materials whose patterned paper the builders also put on the ceilings (HA: `LM_plaster`, HB: `E_H_wallpaper` / `E_H_plaster`). */
const WALL_PAPER = new Set(["LM_plaster", "E_H_wallpaper", "E_H_plaster"]);
/**
 * The light map's strength on the pale painted and papered surfaces (walls, ceilings, trims): the day bakes clip there (sun on a white wall
 * stores the light map's maximum), so at the village's 1.6π every wall drew pure white — "blown windows", a showroom box. Matched to the
 * builders' Cycles sheets by eye in the game (review 2026-11-16); the wood, the floors, the fabrics keep the village's strength.
 */
export const HOUSE_PALE_LIGHT = 0.8 * Math.PI;
export const PALE_SURFACES: ReadonlySet<string> = new Set(["LM_plaster", "LM_paint", "LM_ceiling", "LM_tile_white", "E_H_wallpaper", "E_H_plaster", "E_H_paint", "E_H_tile_white"]);

/** The plain painted ceiling the wallpaper's ceiling faces get (a light-mapped material: the bake's shading stays). */
export const HOUSE_CEILING_MATERIAL = "LM_ceiling";
const CEILING_COLOR = "#F1EDE6";
/** Ceiling faces: facing down at least this much, and higher than this (m) — a shelf's underside or a stair's soffit is lower. */
const CEILING_MIN_DOWN = 0.9;
const CEILING_MIN_Y = 2.3;
/**
 * The wallpaper's pattern is drawn this many times smaller in these houses (review 2026-11-16: house 4's flowers were the size of a
 * hand, house 9's circles read as rings on the walls); the UVs are the builders', the texture repeats.
 */
export const WALLPAPER_SCALE: Readonly<Partial<Record<HouseNumber, number>>> = { 4: 2, 9: 2 };

/**
 * Fix what the builders' files get wrong for the game, ONCE on the loaded (cached) scene — idempotent (a flag on the scene):
 *  - the ceilings: the faces of a wallpaper material that face down high up get a plain painted material of their own (a group of the
 *    same geometry, `LM_ceiling`), so a ceiling is not papered like the walls;
 *  - the wallpaper's scale (WALLPAPER_SCALE);
 *  - the window panorama's material is white (the builders left a sky-blue base colour, which tinted and washed out the view);
 *  - the pieces the game takes out (shared houseFixes.ts: a plant, a chair, a side table that shut the way to a stair or a corner) lose
 *    their triangles.
 */
export function dressLoadedHouse(scene: Object3D, n: HouseNumber): void {
  if (scene.userData.houseDressed) return;
  scene.userData.houseDressed = true;
  scene.updateMatrixWorld(true);
  const ceilings = new Map<Material, Material>();
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const cuts = HOUSE_REMOVED_PIECES.filter((q) => q.n === n);
  scene.traverse((o) => {
    if (!isMesh(o) || Array.isArray(o.material) || (o as InstancedMesh).isInstancedMesh) return;
    const m = o.material as MeshBasicMaterial;
    if (m.name === HOUSE_VIEW_MATERIAL) {
      m.color.set("#ffffff");
      return;
    }
    const paper = WALL_PAPER.has(m.name);
    if (!paper && cuts.length === 0) return;
    const scale = paper ? WALLPAPER_SCALE[n] : undefined;
    if (scale && m.map && !m.map.userData.houseScaled) {
      m.map.userData.houseScaled = true;
      m.map.wrapS = m.map.wrapT = RepeatWrapping;
      m.map.repeat.set(scale, scale);
      m.map.needsUpdate = true;
    }
    const g = o.geometry;
    const pos = g.getAttribute("position");
    if (!pos) return;
    const idx = g.getIndex();
    const count = idx ? idx.count : pos.count;
    const keep: number[] = [];
    const ceil: number[] = [];
    let cut = 0;
    for (let i = 0; i + 2 < count; i += 3) {
      const i0 = idx ? idx.getX(i) : i;
      const i1 = idx ? idx.getX(i + 1) : i + 1;
      const i2 = idx ? idx.getX(i + 2) : i + 2;
      a.fromBufferAttribute(pos, i0).applyMatrix4(o.matrixWorld);
      b.fromBufferAttribute(pos, i1).applyMatrix4(o.matrixWorld);
      c.fromBufferAttribute(pos, i2).applyMatrix4(o.matrixWorld);
      const x = (a.x + b.x + c.x) / 3;
      const y = (a.y + b.y + c.y) / 3;
      const z = (a.z + b.z + c.z) / 3;
      if (cuts.some((q) => y > q.cut.minY && y < q.cut.maxY && x > q.box.minX - q.cut.grow && x < q.box.maxX + q.cut.grow && z > q.box.minZ - q.cut.grow && z < q.box.maxZ + q.cut.grow)) {
        cut++;
        continue;
      }
      if (!paper) {
        keep.push(i0, i1, i2);
        continue;
      }
      b.sub(a);
      c.sub(a);
      b.cross(c).normalize();
      (b.y < -CEILING_MIN_DOWN && y > CEILING_MIN_Y ? ceil : keep).push(i0, i1, i2);
    }
    if (ceil.length === 0 && cut === 0) return;
    const all = keep.concat(ceil);
    g.setIndex(new BufferAttribute(pos.count > 65535 ? new Uint32Array(all) : new Uint16Array(all), 1));
    g.clearGroups();
    if (ceil.length === 0) return;
    g.addGroup(0, keep.length, 0);
    g.addGroup(keep.length, ceil.length, 1);
    let cm = ceilings.get(m);
    if (!cm) {
      const made = m.clone();
      made.name = HOUSE_CEILING_MATERIAL;
      made.map = null;
      made.color = new Color(CEILING_COLOR);
      ceilings.set(m, (cm = made));
    }
    o.material = [m, cm];
  });
}

/**
 * Dress a clone of the loaded house for `floor`: the other floor's group and ceiling and every `col__` box hidden, the light map (when
 * given) on every `LM_*` material.
 */
export function prepareHouse(source: Object3D, n: HouseNumber, floor: HouseFloor, lightmap: Texture | null): HouseNodes {
  const root = source.clone(true);
  if (lightmap) configureLightmap(lightmap);
  const hidden = new Set<string>();
  // a dressed house (light-mapped) has its ceilings in its own meshes: the contract's plain `ceil__` slab (an unlit-less standard
  // material, drawn black under the house's light) is only the blockout's ceiling
  const dressed = houseWantsLightmap(source);
  for (const f of HOUSE_FLOORS) {
    if (f !== floor) hidden.add(HOUSE_NODE.floor(n, f));
    if (f !== floor || dressed) hidden.add(HOUSE_NODE.ceiling(n, f));
  }
  const lightmapped: Material[] = [];
  const views: Material[] = [];
  const glows: Material[] = [];
  root.traverse((o) => {
    if (o.name.startsWith(COLLIDER_PREFIX) || hidden.has(o.name)) {
      o.visible = false;
      return;
    }
    if (!isMesh(o)) return;
    for (const m of materialsOf(o)) {
      if (m.name === HOUSE_VIEW_MATERIAL && !views.includes(m)) views.push(m);
      if (isHouseGlowMaterial(m.name) && !glows.includes(m)) glows.push(m);
      if (!lightmap || !isHouseLightmapMaterial(m.name)) continue;
      lightmapMaterial(m, lightmap);
      if (PALE_SURFACES.has(m.name)) (m as MeshBasicMaterial).lightMapIntensity = HOUSE_PALE_LIGHT;
      if (!lightmapped.includes(m)) lightmapped.push(m);
    }
  });
  root.updateMatrixWorld(true);
  return { root, lightmapped, views, glows };
}

/** Free what the clone owns: its InstancedMeshes' instance buffers (the geometry and materials are the loader's). */
export function disposeHouse(nodes: HouseNodes): void {
  nodes.root.traverse((o) => {
    if ((o as InstancedMesh).isInstancedMesh) (o as InstancedMesh).dispose();
  });
}

/**
 * Every visible solid triangle of the prepared floor as a flat world-space array (x y z × 3 per triangle), for the camera's solid index
 * (hallSolidIndex.ts): what is hidden is skipped (the collision boxes, the other floor), glass (transparent) is no wall unless
 * `glassIsSolid` (a house: its glass 중문 and doors stop the camera like the partition they are in), and an
 * instanced mesh adds each instance. The same walk as the memorial hall's.
 */
export function solidTriangles(root: Object3D, glassIsSolid = false): Float32Array {
  root.updateMatrixWorld(true);
  const tris: number[] = [];
  const v = new Vector3();
  const each = new Matrix4();
  const walk = (o: Object3D): void => {
    if (!o.visible) return;
    const m = o as Mesh;
    if (m.isMesh && (glassIsSolid || materialsOf(m).every((x) => !x.transparent))) {
      const pos = m.geometry.getAttribute("position");
      if (pos) {
        const idx = m.geometry.getIndex();
        const count = idx ? idx.count : pos.count;
        const inst = m as unknown as InstancedMesh;
        const copies = inst.isInstancedMesh ? inst.count : 1;
        for (let c = 0; c < copies; c++) {
          if (inst.isInstancedMesh) {
            inst.getMatrixAt(c, each);
            each.premultiply(m.matrixWorld);
          } else each.copy(m.matrixWorld);
          for (let i = 0; i + 2 < count; i += 3)
            for (let k = 0; k < 3; k++) {
              v.fromBufferAttribute(pos, idx ? idx.getX(i + k) : i + k).applyMatrix4(each);
              tris.push(v.x, v.y, v.z);
            }
        }
      }
    }
    for (const child of o.children) walk(child);
  };
  walk(root);
  return Float32Array.from(tris);
}

/**
 * Free the GPU side of a LOADED scene itself (the loader's cached house): geometry, materials, their maps and light maps, instance
 * buffers, each once. Only when the house is let go and the cache entry is cleared (houseRelease.ts).
 */
export function disposeLoadedHouse(scene: Object3D): void {
  const done = new Set<{ dispose(): void }>();
  const free = (r: { dispose(): void } | null | undefined): void => {
    if (!r || done.has(r)) return;
    done.add(r);
    if ((r as Texture).isTexture) freeTexture(r as Texture);
    else r.dispose();
  };
  scene.traverse((o) => {
    if (!isMesh(o)) return;
    free(o.geometry);
    for (const m of materialsOf(o)) {
      free((m as MeshBasicMaterial).map);
      free((m as MeshBasicMaterial).lightMap);
      free(m);
    }
    if ((o as InstancedMesh).isInstancedMesh) free(o as InstancedMesh);
  });
}

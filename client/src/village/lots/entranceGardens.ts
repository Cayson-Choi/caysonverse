import {
  BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Group, InstancedMesh, Matrix4,
  Mesh, MeshStandardMaterial, Object3D, RepeatWrapping, SRGBColorSpace, TextureLoader, Vector3,
  type Texture,
} from "three";
import { LOT_DOOR_YAW, VILLAGE_LOTS, lotWorldToLocal, type VillageLot } from "@caysonverse/shared/village/villageLots";
import { GeoBuilder, type V3 } from "../../land/geoBuilder";
import { versionedUrl } from "../modelUrl";
import { PLANT_CELL } from "../veg/plantCells";
import { climbingRoseSpray, fountainBoxwood, planterSprig, forecourtTulips } from "../veg/vegPlants";
import { mulberry32 } from "../veg/vegRandom";
import { lotSurfaceMaterial, patchLotLight, visibleLoad, type LotNodes } from "./lotsPrep";

type GardenLot = "lot_chapel" | "lot_church";
// Lot-local bounds of one of the paired borders. Reflection across the path gives the other.
const BORDERS = {
  lot_chapel: { inner: 1.88, outer: 4.66, back: 5.68, front: 7.05, columns: 8 },
  lot_church: { inner: 2.55, outer: 4.08, back: 3.08, front: 5.13, columns: 5 },
} as const;

/** Remove only the old forecourt flower instances and the clipped green bar behind them.
 * The instancers also carry other gardens, and the chapel's green mesh holds their edging. */
export function clearEntranceBeds(goods: Object3D, lot: VillageLot, id: GardenLot): void {
  const bed = BORDERS[id];
  const inside = (p: Vector3) => {
    const { lx, lz } = lotWorldToLocal(lot, p.x, p.z);
    return Math.abs(lx) > bed.inner - 0.1 && Math.abs(lx) < bed.outer + 0.1 && lz > bed.back - 0.1 && lz < bed.front + 0.1;
  };
  const matrix = new Matrix4();
  const point = new Vector3();
  goods.updateWorldMatrix(true, true);
  goods.traverse((obj) => {
    if (!(obj instanceof Mesh)) return;
    if (obj instanceof InstancedMesh) {
      if (!obj.name.startsWith(`lotinst__${id}_flower_`)) return;
      let kept = 0;
      for (let i = 0; i < obj.count; i++) {
        obj.getMatrixAt(i, matrix);
        if (inside(point.setFromMatrixPosition(matrix).applyMatrix4(obj.matrixWorld))) continue;
        if (kept !== i) obj.setMatrixAt(kept, matrix);
        kept++;
      }
      obj.count = kept;
      obj.instanceMatrix.needsUpdate = true;
      obj.computeBoundingSphere();
      obj.visible = kept > 0;
      return;
    }
    if (obj.material.name !== `LM_${lot.kind}_green`) return;
    const geometry = obj.geometry as BufferGeometry;
    const pos = geometry.getAttribute("position");
    const index = geometry.index;
    const total = index?.count ?? pos.count;
    const kept: number[] = [];
    for (let i = 0; i < total; i += 3) {
      const a = index?.getX(i) ?? i, b = index?.getX(i + 1) ?? i + 1, c = index?.getX(i + 2) ?? i + 2;
      // All three vertices of a forecourt hedge face lie in its rectangular border.
      if ([a, b, c].every((n) => inside(point.fromBufferAttribute(pos, n).applyMatrix4(obj.matrixWorld)))) continue;
      kept.push(a, b, c);
    }
    if (kept.length < total) {
      geometry.setIndex(kept);
      obj.visible = kept.length > 0;
    }
  });
}

// Each occupied 128 px cell in forecourt_flowers.webp is extracted from drawPlantAtlas().
const ATLAS_CELLS: readonly number[] = [
  PLANT_CELL.pansy, PLANT_CELL.leafPansy, PLANT_CELL.muscari, PLANT_CELL.solid,
  PLANT_CELL.petunia, PLANT_CELL.leafPetunia, PLANT_CELL.tulip, PLANT_CELL.strap,
  PLANT_CELL.boxA, PLANT_CELL.boxB, PLANT_CELL.boxIn,
];
const atlasRows = Math.ceil(ATLAS_CELLS.length / 4);

function tintFlower(geometry: BufferGeometry, tint: Color): BufferGeometry {
  const original = geometry.getAttribute("color");
  const uv = geometry.getAttribute("uv");
  const rgb: number[] = [];
  for (let i = 0; i < original.count; i++) {
    const mask = original.getW(i);
    rgb.push(original.getX(i) * (1 + mask * (tint.r - 1)), original.getY(i) * (1 + mask * (tint.g - 1)), original.getZ(i) * (1 + mask * (tint.b - 1)));
    const x = uv.getX(i) * 4, y = uv.getY(i) * 4;
    const cell = ATLAS_CELLS.indexOf(Math.floor(y) * 4 + Math.floor(x));
    uv.setXY(i, (cell % 4 + x % 1) / 4, (Math.floor(cell / 4) + y % 1) / atlasRows);
  }
  geometry.setAttribute("color", new Float32BufferAttribute(rgb, 3));
  return geometry;
}

/** The plant atlas's pieces (vegPlants) re-pointed at the forecourt atlas and tinted (the gate's topiary uses it too). */
export const tintForecourt = tintFlower;

const soilY = 0.133;

/** Train a cane from each post up and along its half of the existing iron arch. */
export function plantRoseArch(goods: Object3D, garden: Group, low: boolean, plants: MeshStandardMaterial): void {
  const clusters = goods.children.filter((o) => o.name === "lotinst__lot_chapel_rose_clump" || o.name === "lotinst__lot_chapel_rose_clump_s");
  if (!clusters.length) return;
  for (const cluster of clusters) cluster.visible = false;
  // chapel_kit.py rose_arch: the rail springs at 2.25 m and has a 1.4 m radius.
  const spring = 2.25, radius = 1.4, length = spring + radius * Math.PI / 2;
  const cane = new GeoBuilder();
  const perSide = low ? 15 : 26;
  const sprays = new InstancedMesh(tintFlower(climbingRoseSpray(low), new Color("#e58b9e")), plants, perSide * 2);
  const rand = mulberry32(217);
  const pose = new Object3D();
  let index = 0;
  for (const side of [-1, 1]) {
    const caneAt = (s: number): V3 => {
      const arc = Math.max(0, s - spring) / radius;
      const wrap = s * 4.3 + side * 1.7;
      const r = radius + 0.037 * Math.cos(wrap);
      return [-8.2 + side * r * Math.cos(arc), Math.min(s, spring) + r * Math.sin(arc), -1.05 + 0.078 * Math.sin(wrap)];
    };
    const canePoints = Array.from({ length: 27 }, (_, i) => caneAt(length * i / 26));
    cane.tube(canePoints, 0.012, low ? 3 : 5, [0.116, 0.077, 0.035]);
    for (let i = 0; i < perSide; i++) {
      const t = (i + rand() * 0.36) / perSide;
      const s = 0.24 + (length - 0.24) * t;
      pose.position.set(...caneAt(s));
      pose.rotation.set((rand() - 0.5) * 0.95, side + i * 2.4 + rand() * 0.34, (rand() - 0.5) * 0.84);
      pose.scale.setScalar((0.84 + rand() * 0.38) * (s > spring ? 1.16 : 0.94));
      pose.updateMatrix();
      sprays.setMatrixAt(index++, pose.matrix);
    }
  }
  // Land tubes carry tiling UVs. Sample the little atlas's white cell for the bark.
  const wood = cane.build();
  const uv = wood.getAttribute("uv");
  for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.875, 0.5 / atlasRows);
  const trunks = new Mesh(wood, plants);
  trunks.name = "chapel_rose_canes";
  sprays.name = "chapel_climbing_roses";
  sprays.computeBoundingSphere();
  for (const mesh of [trunks, sprays]) {
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.raycast = () => {};
    garden.add(mesh);
  }
}

/** The ring keeps the gardener's original spacing and its two paths to the basin. */
export function plantFountainRing(goods: Object3D, low: boolean, plants: MeshStandardMaterial): void {
  const old = goods.getObjectByName("lotinst__lot_chapel_box_ball");
  if (!(old instanceof InstancedMesh) || !old.parent) return;
  const hedge = old.clone(false);
  hedge.name = "chapel_fountain_boxwood";
  hedge.geometry = tintFlower(fountainBoxwood(low), new Color(0xffffff));
  hedge.material = plants;
  hedge.castShadow = hedge.receiveShadow = true;
  hedge.raycast = () => {};
  hedge.computeBoundingSphere();
  old.visible = false;
  old.parent.add(hedge);
  plants.addEventListener("dispose", () => hedge.dispose());
}

// Pockets beside the fountain and the rose walk, in the frame of chapel_kit.py.
const sideBeds = [
  [9.9, 11.6, -3.6, 1.6], [5.5, 6.6, -4.6, -2.8], [-11.7, -9.9, -4.5, 1.5],
  [-6.5, -5.3, -4.6, -1.6], [-11.6, -9.4, 1.9, 4.2],
] as const;
/** Individual granite kerbs, a recessed bed of earth, tulips and a lower pansy border. */
export function makeEntranceGarden(id: GardenLot, low: boolean, materials: { plants: MeshStandardMaterial; soil: MeshStandardMaterial; kerb: MeshStandardMaterial }): Group {
  const bed = BORDERS[id];
  const rand = mulberry32(id === "lot_chapel" ? 719 : 1297);
  const soil = new GeoBuilder(), kerb = new GeoBuilder();
  const tulips: Matrix4[] = [], pansies: Matrix4[] = [];
  const transform = new Object3D();
  const halfWidth = (bed.outer - bed.inner) / 2, halfDepth = (bed.front - bed.back) / 2;
  for (const side of [-1, 1]) {
    const cx = side * (bed.inner + halfWidth), cz = bed.back + halfDepth;
    soil.box([cx, soilY / 2, cz], [1, 0, 0], [0, 1, 0], halfWidth - 0.052, soilY / 2, halfDepth - 0.052, [0.70, 0.62, 0.52], 0.85);
    for (const across of [true, false]) {
      const length = 2 * (across ? halfWidth : halfDepth - 0.105);
      const count = Math.ceil(length / 0.52);
      for (const edge of [-1, 1]) for (let i = 0; i < count; i++) {
        const along = length * ((i + 0.5) / count - 0.5);
        const x = cx + (across ? along : edge * (halfWidth - 0.053));
        const z = cz + (across ? edge * (halfDepth - 0.053) : along);
        const shade = 0.85 + rand() * 0.14;
        kerb.box([x, 0.089 + rand() * 0.004, z], across ? [1, 0, 0] : [0, 0, 1], [0, 1, 0],
          length / (2 * count) - 0.003, 0.089, 0.053, [shade, shade * 0.96, shade * 0.88], 1);
      }
    }
    const rows = (id === "lot_chapel" ? 3 : 4) - (low ? 1 : 0);
    const cols = low ? Math.ceil(bed.columns * 0.7) : bed.columns;
    for (let row = 0; row < rows; row++) for (let i = 0; i < cols; i++) {
      const u = (i + 0.5 + (row % 2 ? 0.11 : -0.11) + (rand() - 0.5) * 0.36) / cols;
      const v = (row + 0.5 + (rand() - 0.5) * 0.32) / rows;
      const upper = (row === 0 || (row < rows - 1 && (i + row) % 3 === 0));
      // A low diagonal drift opens to the visitor. Keep a little earth visible between clumps.
      transform.position.set(cx + (u - 0.5) * (2 * halfWidth - 0.28), soilY - 0.003, cz + (v - 0.5) * (2 * halfDepth - 0.25));
      transform.rotation.set(0, rand() * Math.PI * 2, 0);
      const spread = (upper ? 1.36 : 1.8) * (low ? 1.11 : 1) * (0.84 + 0.32 * rand());
      transform.scale.set(spread, (upper ? 1.05 : 1.3) * (0.89 + rand() * 0.24), spread);
      transform.updateMatrix();
      (upper ? tulips : pansies).push(transform.matrix.clone());
    }
  }
  const garden = new Group();
  garden.name = `${id}_entrance_beds`;
  if (id === "lot_chapel") {
    for (const [x0, x1, z0, z1] of sideBeds) {
      // A sloping edge disappears into the grass. The roots stand on the level centre.
      const corners = [[x0, z0], [x0, z1], [x1, z1], [x1, z0]] as const;
      const base = soil.vertices;
      for (const [x, z] of corners) {
        const ox = x === x0 ? -0.17 : 0.17, oz = z === z0 ? -0.17 : 0.17;
        soil.rawVertex([x, 0.058, z], [0, 1, 0], x, z, [0.72, 0.62, 0.51]);
        soil.rawVertex([x + ox, 0.014, z + oz], [ox, 0.98, oz], x + ox, z + oz, [0.56, 0.5, 0.42]);
      }
      soil.idx.push(base, base + 2, base + 4, base, base + 4, base + 6);
      for (let k = 0; k < 4; k++) {
        const i = base + k * 2, j = base + ((k + 1) % 4) * 2;
        soil.idx.push(i, i + 1, j + 1, i, j + 1, j);
      }
    }
  }
  garden.add(new Mesh(soil.build(), materials.soil), new Mesh(kerb.build(), materials.kerb));
  const tulip = tintFlower(forecourtTulips(low), new Color(id === "lot_chapel" ? "#fff2d9" : "#eaa1a5"));
  const pansy = tintFlower(planterSprig("pansy", low, 17), new Color(id === "lot_chapel" ? "#b7a0c2" : "#ead6be"));
  for (const [geometry, spots] of [[tulip, tulips], [pansy, pansies]] as const) {
    const mesh = new InstancedMesh(geometry, materials.plants, spots.length);
    spots.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
    mesh.computeBoundingSphere();
    garden.add(mesh);
  }
  for (const child of garden.children) {
    child.castShadow = child.receiveShadow = true;
    child.raycast = () => {};
  }
  return garden;
}

/** Runtime replacements for the explicitly named planting batches in the art files. The
 * same school window box or chapel border holds several colours, each in its own batch. */
const beddingColours: Readonly<Record<string, string>> = {
  lotinst__lot_school_fl_red: "#cc4052", lotinst__lot_school_fl_pink: "#e58da7", lotinst__lot_school_fl_white: "#fff2e5",
  lotinst__lot_school_lo_red: "#d45d68", lotinst__lot_school_lo_yel: "#edc963",
  lotinst__lot_library_ger_red: "#ca3d55", lotinst__lot_library_ger_pink: "#df86a4",
  lotinst__lot_church_geranium: "#d14a58", lotinst__lot_church_geranium_c: "#f29487",
  lotinst__lot_chapel_flower_p: "#df94ac", lotinst__lot_chapel_flower_w: "#fff4dc",
};

export function plantExistingBoxes(goods: Object3D, id: string, low: boolean, plants: MeshStandardMaterial, soil: MeshStandardMaterial): void {
  const roots: Vector3[] = [];
  const bedding = goods.children.filter((child): child is InstancedMesh => child instanceof InstancedMesh && child.count > 0 && !!beddingColours[child.name]);
  const transform = new Matrix4(), scale = new Matrix4(), p = new Vector3();
  for (const old of bedding) {
    const garden = id === "lot_chapel";
    const smaller = old.name.includes("_lo_");
    const shape = planterSprig(garden || smaller ? "pansy" : "petunia", low, old.count);
    const mesh = new InstancedMesh(tintFlower(shape, new Color(beddingColours[old.name]!)), plants, old.count);
    mesh.name = old.name + "_bloom";
    mesh.castShadow = true;
    mesh.raycast = () => {};
    for (let i = 0; i < old.count; i++) {
      old.getMatrixAt(i, transform);
      p.setFromMatrixPosition(transform);
      // The original sill-batch origins are below the top faces of their boxes.
      p.y += garden ? 0.056 : id === "lot_library" ? 0.033 : id === "lot_school" ? (smaller ? 0.012 : 0.043) : 0.006;
      transform.setPosition(p);
      const spread = garden ? 2.1 : smaller ? 0.82 : 1.15;
      transform.multiply(scale.makeScale(spread, garden ? 1.45 : smaller ? 0.75 : 1.05, spread));
      mesh.setMatrixAt(i, transform);
      if (!garden) roots.push(p.clone());
    }
    mesh.computeBoundingSphere();
    old.visible = false;
    goods.add(mesh);
    plants.addEventListener("dispose", () => mesh.dispose());
  }

  // The boxes run parallel to world Z. Group adjacent roots of every colour in each
  // planter, leaving the separate window sills and the gaps between pots unobstructed.
  const trays: Vector3[][] = [];
  for (const root of roots.sort((a, b) => a.z - b.z)) {
    const tray = trays.find((row) => {
      const last = row[row.length - 1]!;
      return Math.abs(root.x - last.x) < 0.12 && Math.abs(root.y - last.y) < 0.04 && root.z - last.z < 0.36;
    });
    if (tray) tray.push(root);
    else trays.push([root]);
  }
  if (!trays.length) return;
  const tops = new GeoBuilder();
  for (const row of trays) {
    const x = row.reduce((sum, p) => sum + p.x, 0) / row.length;
    const first = row[0]!, last = row[row.length - 1]!;
    const halfWidth = first.y < 0.5 ? 0.15 : 0.068;
    tops.box([x, first.y - 0.005, (first.z + last.z) / 2], [1, 0, 0], [0, 1, 0],
      halfWidth, 0.005, (last.z - first.z) / 2 + 0.045, [0.62, 0.54, 0.47], 0.75);
  }
  const top = new Mesh(tops.build(), soil);
  top.raycast = () => {};
  goods.add(top);
}

export function installEntranceGardens(nodes: LotNodes, low: boolean): { plants: MeshStandardMaterial; soil: MeshStandardMaterial } | null {
  if (!nodes.goods.size) return null;
  const loader = new TextureLoader();
  const texture = (name: string, srgb: boolean, tile: boolean): Texture => {
    const map = loader.load(versionedUrl(`/models/village/veg/${name}`));
    if (srgb) map.colorSpace = SRGBColorSpace;
    if (tile) map.wrapS = map.wrapT = RepeatWrapping;
    map.flipY = tile;
    map.anisotropy = 4;
    return map;
  };
  const atlas = texture("forecourt_flowers.webp", true, false);
  const soilMap = texture("soil_c512.jpg", true, true);
  const normal = texture("soil_n256.jpg", false, true);
  const plants = new MeshStandardMaterial({ name: "LM_forecourt_flowers", map: atlas, vertexColors: true, side: DoubleSide, alphaTest: 0.36, roughness: 0.83 });
  const soil = new MeshStandardMaterial({ name: "LM_forecourt_soil", map: soilMap, normalMap: normal, vertexColors: true, roughness: 1 });
  soil.normalScale.set(0.85, 0.85);
  patchLotLight(plants, "forecourt_flowers");
  patchLotLight(soil, "forecourt_soil");
  plants.addEventListener("dispose", () => atlas.dispose());
  soil.addEventListener("dispose", () => { soilMap.dispose(); normal.dispose(); });
  // Both lots already have the flamed granite set in their texture bank.
  const kerb = lotSurfaceMaterial(soil, { pbr: "granite_flamed" });
  kerb.name = "LM_forecourt_kerb";
  nodes.surfaces.push(kerb);
  nodes.own.materials.push(plants, soil, kerb);
  for (const id of ["lot_chapel", "lot_church", "lot_school", "lot_library"] as const) {
    const goods = nodes.goods.get(id);
    if (!goods) continue;
    if (id === "lot_chapel" || id === "lot_church") {
      const lot = VILLAGE_LOTS.find((l) => l.id === id)!;
      clearEntranceBeds(goods, lot, id);
      const garden = makeEntranceGarden(id, low, { plants, soil, kerb });
      if (id === "lot_chapel") {
        plantRoseArch(goods, garden, low, plants);
        plantFountainRing(goods, low, plants);
      }
      garden.position.set(lot.centre.x, 0, lot.centre.z);
      garden.rotation.y = LOT_DOOR_YAW[lot.doorSide];
      goods.add(garden);
      for (const child of garden.children) if (child instanceof InstancedMesh) plants.addEventListener("dispose", () => child.dispose());
    }
    plantExistingBoxes(goods, id, low, plants, soil);
    const measured = visibleLoad(goods);
    const box = nodes.boxes.find((b) => b.id === id)!;
    box.goodsTris = nodes.stats.goodsTriangles[id] = measured.triangles;
    nodes.stats.goodsDraws[id] = measured.draws;
  }
  return { plants, soil };
}

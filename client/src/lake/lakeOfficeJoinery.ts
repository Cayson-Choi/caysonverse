import { BufferGeometry, Float32BufferAttribute, Mesh, type Object3D } from "three";
import { LAKE_SHOP } from "@caysonverse/shared/village/lakeLayout";

// Position, two baked-light UVs and the three linear vertex-colour channels.
type Sample = [number, number, number, number, number, number, number, number];

function clipAtHeight(polygon: Sample[], y: number, above: boolean): Sample[] {
  const out: Sample[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!, b = polygon[(i + 1) % polygon.length]!;
    const keepA = above ? a[1] >= y : a[1] <= y;
    const keepB = above ? b[1] >= y : b[1] <= y;
    if (keepA) out.push(a);
    if (keepA !== keepB) {
      const t = (y - a[1]) / (b[1] - a[1]);
      out.push(a.map((value, k) => value + (b[k]! - value) * t) as Sample);
    }
  }
  return out;
}

const FLOOR = 0.4;
const PITCH = 0.16;

/** The siding primitive already has the window and door openings and the two baked light UVs.
 * Cut its outward triangles into overlapping cedar courses in that same UV chart. */
export function clapboardGeometry(src: BufferGeometry): BufferGeometry {
  const position = src.getAttribute("position"), normals = src.getAttribute("normal");
  const bake = src.getAttribute("uv1"), colors = src.getAttribute("color");
  const pos: number[] = [], uv: number[] = [], uv1: number[] = [], rgb: number[] = [], idx: number[] = [];
  const count = src.index?.count ?? position.count;
  for (let i = 0; i < count; i += 3) {
    const sample = (index: number): Sample => [
      position.getX(index), position.getY(index), position.getZ(index),
      bake.getX(index), bake.getY(index), colors.getX(index), colors.getY(index), colors.getZ(index),
    ];
    const a = src.index?.getX(i) ?? i;
    const tri = [sample(a), sample(src.index?.getX(i + 1) ?? i + 1), sample(src.index?.getX(i + 2) ?? i + 2)];
    const nx = Math.round(normals.getX(a)), nz = Math.round(normals.getZ(a));
    const outside =
      (nx === 1 && Math.abs(tri[0]![0] - LAKE_SHOP.maxX) < 0.004) ||
      (nx === -1 && Math.abs(tri[0]![0] - LAKE_SHOP.minX) < 0.004) ||
      (nz === 1 && Math.abs(tri[0]![2] - LAKE_SHOP.maxZ) < 0.004) ||
      (nz === -1 && Math.abs(tri[0]![2] - LAKE_SHOP.minZ) < 0.004);
    // Hidden backs can go. The original inset plaster, window linings and corner strips
    // surround the replacement, including the ends of each board at the openings.
    if (!outside) continue;
    const lo = Math.min(...tri.map(v => v[1])), hi = Math.max(...tri.map(v => v[1]));
    const start = Math.floor((lo - FLOOR) / PITCH), end = Math.floor((hi - FLOOR) / PITCH);
    for (let course = start; course <= end; course++) {
      const bottom = FLOOR + course * PITCH;
      // The underside casts a contact shadow. The exposed face slopes back under the next board.
      for (const [y0, y1, d0, d1, shade0, shade1] of [
        [0, 0.008, 0, 0.024, 0.42, 0.64],
        [0.008, PITCH, 0.024, 0.001, 1.0, 0.87],
      ] as const) {
        const strip = clipAtHeight(clipAtHeight(tri, bottom + y0, true), bottom + y1, false);
        if (strip.length < 3) continue;
        const base = pos.length / 3;
        for (const [x, y, z, bu, bv, r, g, b] of strip) {
          const t = (y - bottom - y0) / (y1 - y0);
          const depth = d0 + (d1 - d0) * t;
          const shade = (shade0 + (shade1 - shade0) * t) * (0.94 + 0.06 * Math.sin(course * 17.8 + nx * 3 + nz));
          pos.push(x + nx * depth, y, z + nz * depth);
          // The existing grain map runs along V. Offset courses to break up repeated knots.
          uv.push(y / 0.56 + course * 0.31, (nx ? z : x) / 1.35 + course * 0.47);
          uv1.push(bu, bv);
          rgb.push(r * shade, g * shade, b * shade);
        }
        for (let j = 1; j < strip.length - 1; j++) idx.push(base, base + j, base + j + 1);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new Float32BufferAttribute(rgb, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  g.setAttribute("uv1", new Float32BufferAttribute(uv1, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Correct the UV scale on the rental counter's 4.3 m plank, including its narrow front edge. */
function counterGrain(src: BufferGeometry): BufferGeometry {
  const g = src.clone(), p = g.getAttribute("position"), n = g.getAttribute("normal"), uv = g.getAttribute("uv");
  // Find faces of the projecting counter in the office wood primitive without touching the window frame behind it.
  const midX = (LAKE_SHOP.minX + LAKE_SHOP.maxX) / 2;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (Math.abs(x - midX) > 2.155 || y < 1.508 || y > 1.562 || z < LAKE_SHOP.maxZ - 0.002) continue;
    const band = Math.abs(n.getY(i)) > 0.5 ? z - LAKE_SHOP.maxZ : y - 1.51;
    uv.setXY(i, band / 0.56, Math.abs(n.getX(i)) > 0.5 ? (z - y) / 0.48 : (x - midX) / 1.35);
  }
  return g;
}

/** Work on the office clone only. Both new geometries reuse the existing wood material and light maps. */
export function dressLakeOffice(root: Object3D): BufferGeometry[] {
  const office = root.getObjectByName("lake_office");
  const wood = office?.children.find(o => o instanceof Mesh && o.material.name === "M_lake_wood") as Mesh | undefined;
  const siding = office?.children.find(o => o instanceof Mesh && o.material.name === "M_lake_siding") as Mesh | undefined;
  if (!wood || !siding || !["position", "normal", "uv"].every(key => wood.geometry.hasAttribute(key)) ||
    !["position", "normal", "color", "uv1"].every(key => siding.geometry.hasAttribute(key))) return [];
  const boards = clapboardGeometry(siding.geometry);
  if (!boards.getAttribute("position").count) {
    boards.dispose();
    return [];
  }
  const counter = counterGrain(wood.geometry);
  siding.geometry = boards;
  siding.material = wood.material;
  wood.geometry = counter;
  return [boards, counter];
}

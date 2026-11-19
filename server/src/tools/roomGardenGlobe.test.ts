import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { Triangle, Vector3 } from "three";
import { expect, it } from "vitest";
import { parseGlb } from "../../../scripts/lib/schoolGlb";

const lots = path.resolve(__dirname, "../../../client/public/models/village/lots");
const requireDraco = createRequire(__filename);

it("ships one mipmapped garden panorama for both rooms and a separate equirectangular globe chart", () => {
  function chart(dir: string, room: string, material: string, kind: string) {
    const manifest = JSON.parse(readFileSync(path.join(lots, dir, `lot_${room}_textures.json`), "utf8"));
    const spec = manifest.materials[material];
    expect(spec.kind).toBe(kind);
    const file = path.resolve(lots, dir, spec.maps.albedo);
    const ktx = readFileSync(file);
    expect(ktx.subarray(0, 12).toString("hex")).toBe("ab4b5458203230bb0d0a1a0a");
    const width = ktx.readUInt32LE(20), height = ktx.readUInt32LE(24);
    expect(width).toBe(2 * height);
    expect(ktx.readUInt32LE(40)).toBe(1 + Math.floor(Math.log2(width)));
    return file;
  }
  const garden = chart("school", "school_class", "M_garden", "garden");
  expect(chart("library", "library_reading", "M_garden", "garden")).toBe(garden);
  expect(chart("library", "library_reading", "M_globe", "own")).not.toBe(garden);
});

/** Read one shipped primitive with the same Draco library used by the village clearance tests. */
async function primitive(room: string, material: string, part?: string) {
  const { gltf, bin } = parseGlb(readFileSync(path.join(lots, `lot_${room}.glb`)));
  const prim = gltf.meshes!.filter((m) => !part || m.name?.endsWith(part))
    .flatMap((m) => m.primitives).find((p) => gltf.materials![p.material!]?.name === material)!;
  const ext = prim.extensions!.KHR_draco_mesh_compression as { bufferView: number; attributes: Record<string, number> };
  const view = gltf.bufferViews![ext.bufferView]!;
  const data = bin!.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
  const d = await requireDraco("draco3d").createDecoderModule({});
  const decoder = new d.Decoder(), mesh = new d.Mesh(), buffer = new d.DecoderBuffer();
  const array = new d.DracoFloat32Array(), face = new d.DracoInt32Array();
  try {
    buffer.Init(data, data.length);
    expect(decoder.DecodeBufferToMesh(buffer, mesh).ok()).toBe(true);
    function attr(name: string): number[][] {
      const a = decoder.GetAttributeByUniqueId(mesh, ext.attributes[name]);
      decoder.GetAttributeFloatForAllPoints(mesh, a, array);
      const stride: number = a.num_components();
      return Array.from({ length: mesh.num_points() }, (_, i) =>
        Array.from({ length: stride }, (_, k) => array.GetValue(i * stride + k) as number));
    }
    const triangles = Array.from({ length: mesh.num_faces() }, (_, i) => {
      decoder.GetFaceFromMesh(mesh, i, face);
      return [0, 1, 2].map((k) => face.GetValue(k) as number);
    });
    return { points: attr("POSITION").map((p) => new Vector3().fromArray(p)), uv: attr("TEXCOORD_0"), normals: attr("NORMAL"), triangles };
  } finally {
    for (const item of [face, array, buffer, mesh, decoder]) d.destroy(item);
  }
}

it("covers the outer classroom glazing and every canted reading-nook pane right up to the frame", async () => {
  for (const room of ["school_class", "library_reading"]) {
    const { points, triangles } = await primitive(room, "M_garden");
    const panes = triangles.map(([a, b, c]) => new Triangle(points[a!]!, points[b!]!, points[c!]!));
    const target = new Vector3();
    function covered(x: number, y: number, z: number) {
      const at = new Vector3(x, y, z);
      expect(panes.some((p) => p.closestPointToPoint(at, target).distanceTo(at) < 0.002), at.toArray().join(",")).toBe(true);
    }
    if (room === "school_class") {
      for (const left of [0.7, 3.3, 10.3, 12.9])
        for (const x of [left, left + 0.9, left + 1.8])
          for (const y of [2.25, 3.3]) covered(410 + x, y, -0.3);
    } else {
      for (const left of [1.4, 9.6]) {
        const edges = [[left, 0], [left + 0.5, -0.95], [left + 1.9, -0.95], [left + 2.4, 0]];
        for (let i = 1; i < edges.length; i++) {
          const [a, b] = [edges[i - 1]!, edges[i]!];
          for (const t of [0, 0.5, 1]) for (const y of [0.55, 1.9, 3.2])
            covered(470 + (1 - t) * a[0]! + t * b[0]!, y, (1 - t) * a[1]! + t * b[1]!);
        }
      }
    }
  }
});

it("faces both bay ceilings and floors into their alcoves", async () => {
  for (const [material, y, inwardY] of [["LM_library_floor", 0, 1], ["LM_library_plaster", 3.3, -1]] as const) {
    const { points, normals, triangles } = await primitive("library_reading", material, "_shell");
    for (const centre of [472.6, 480.8]) {
      const caps = triangles.filter((face) => face.every((i) =>
        Math.abs(points[i]!.y - y) < 0.002 && Math.abs(points[i]!.x - centre) < 1.21 && points[i]!.z < 0.002));
      expect(caps).toHaveLength(2);
      for (const [a, b, c] of caps) {
        const face = new Triangle(points[a!]!, points[b!]!, points[c!]!);
        expect(face.getNormal(new Vector3()).y * inwardY).toBeGreaterThan(0.99);
        for (const i of [a!, b!, c!]) expect(normals[i]![1]! * inwardY).toBeGreaterThan(0.99);
      }
    }
  }
});

it("wraps one equirectangular chart around the tilted sphere, north up, without a triangle crossing the map seam", async () => {
  const { points, normals, uv, triangles } = await primitive("library_reading", "M_globe");
  const centre = new Vector3(471.625, 0.9, 2.925);
  const axis = new Vector3(0, 0, 1);
  for (let i = 0; i < points.length; i++) {
    const radial = points[i]!.clone().sub(centre);
    expect(radial.length()).toBeCloseTo(0.27, 3);
    expect(radial.normalize().dot(new Vector3().fromArray(normals[i]!))).toBeGreaterThan(0.99);
    radial.applyAxisAngle(axis, -23 * Math.PI / 180);
    const [u, v] = uv[i]!;
    expect(v).toBeCloseTo(Math.acos(Math.max(-1, Math.min(1, radial.y))) / Math.PI, 3);
    if (Math.abs(radial.y) < 0.999) {
      const longitude = Math.atan2(radial.x, radial.z) - 124 * Math.PI / 180;
      const delta = u! - (longitude / (2 * Math.PI) + 0.5);
      expect(Math.abs(delta - Math.round(delta))).toBeLessThan(0.001);
    }
  }
  for (const tri of triangles) {
    const us = tri.map((i) => uv[i]![0]!);
    expect(Math.max(...us) - Math.min(...us)).toBeLessThan(0.04);
  }
});

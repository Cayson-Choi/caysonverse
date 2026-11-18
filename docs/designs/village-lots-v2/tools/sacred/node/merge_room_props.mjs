// Merges a room's small placed props (flowers, organ, mouldings, altar cloth...) into ONE GLB per tier: every instance baked into the
// room frame, one primitive per material, so the room reads one file and draws a handful of meshes instead of a dozen files and
// ~60 meshes. The sacred entry for the merged file sits at the room origin (identity), so the vertices are room-frame metres.
//   node merge_room_props.mjs <spec.json> <sourceDir> <outDir> <room name> [<spec.json> ...]
// spec.json: the room's art spec (patch_room_art.py): its items whose node starts with "lotprop__" and that name a "file"; an item's
// "phone": true puts it in the phone file too. Writes <outDir>/lotprop__<room>_props.glb and ..._props_phone.glb.
import { Document, NodeIO } from "@gltf-transform/core";
import { readFileSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";

const [, , outDir, srcDir, room, ...specs] = process.argv;
mkdirSync(outDir, { recursive: true });
const items = specs.flatMap((s) => JSON.parse(readFileSync(s, "utf8")).items).filter((i) => i.node.startsWith("lotprop__") && i.file && !/_props(_phone)?\.glb$/.test(i.file));
const io = new NodeIO();
const cache = new Map();
const load = async (file) => { if (!cache.has(file)) cache.set(file, await io.read(join(srcDir, basename(file)))); return cache.get(file); };

async function build(phone) {
  const groups = new Map(); // material key -> { mat, pos, nor, uv, idx }
  let n = 0;
  for (const it of items) {
    if (phone && it.phone === false) continue;
    const doc = await load(it.file);
    const c = Math.cos(it.yaw), s = Math.sin(it.yaw);
    for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
      const m = p.getMaterial();
      const key = JSON.stringify([m.getName(), m.getBaseColorFactor(), m.getMetallicFactor(), m.getRoughnessFactor(), m.getEmissiveFactor(), m.getDoubleSided()]);
      if (!groups.has(key)) groups.set(key, { m, pos: [], nor: [], uv: [], idx: [] });
      const g = groups.get(key);
      const P = p.getAttribute("POSITION").getArray(), N = p.getAttribute("NORMAL").getArray(), U = p.getAttribute("TEXCOORD_0").getArray(), I = p.getIndices().getArray();
      const base = g.pos.length / 3;
      for (let i = 0; i < P.length; i += 3) {
        const x = P[i], y = P[i + 1], z = P[i + 2];
        g.pos.push(it.at[0] + x * c + z * s, it.at[1] + y, it.at[2] - x * s + z * c);
        g.nor.push(N[i] * c + N[i + 2] * s, N[i + 1], -N[i] * s + N[i + 2] * c);
      }
      for (let i = 0; i < U.length; i++) g.uv.push(U[i]);
      for (const k of I) g.idx.push(base + k);
      n++;
    }
  }
  const doc = new Document();
  const buf = doc.createBuffer();
  const scene = doc.createScene();
  const name = `lotprop__${room}_props${phone ? "_phone" : ""}`;
  const root = doc.createNode(name);
  scene.addChild(root);
  let tris = 0, k = 0;
  for (const g of groups.values()) {
    const mat = doc.createMaterial(g.m.getName()).setBaseColorFactor(g.m.getBaseColorFactor()).setMetallicFactor(g.m.getMetallicFactor()).setRoughnessFactor(g.m.getRoughnessFactor()).setEmissiveFactor(g.m.getEmissiveFactor()).setDoubleSided(g.m.getDoubleSided());
    const big = g.pos.length / 3 > 65000;
    const prim = doc.createPrimitive().setMaterial(mat)
      .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(new Float32Array(g.pos)).setBuffer(buf))
      .setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(new Float32Array(g.nor)).setBuffer(buf))
      .setAttribute("TEXCOORD_0", doc.createAccessor().setType("VEC2").setArray(new Float32Array(g.uv)).setBuffer(buf))
      .setIndices(doc.createAccessor().setType("SCALAR").setArray(big ? new Uint32Array(g.idx) : new Uint16Array(g.idx)).setBuffer(buf));
    root.addChild(doc.createNode(`${name}_${k}`).setMesh(doc.createMesh(`${name}_${k}`).addPrimitive(prim)));
    tris += g.idx.length / 3;
    k++;
  }
  await io.write(join(outDir, name + ".glb"), doc);
  console.log(name, "instances", n, "materials", groups.size, "tris", tris);
}
await build(false);
await build(true);

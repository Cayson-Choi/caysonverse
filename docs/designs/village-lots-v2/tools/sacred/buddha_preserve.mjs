/** Retain the shipped statue around a replacement face, including its baked shading UVs. */
import { createRequire } from "node:module";
import { MeshoptDecoder } from "meshoptimizer";

const require = createRequire(new URL("./node/package.json", import.meta.url));
const { NodeIO } = require("@gltf-transform/core");
const { ALL_EXTENSIONS } = require("@gltf-transform/extensions");

function partition(document) {
  const meshes = document.getRoot().listMeshes();
  const primitives = meshes[0]?.listPrimitives();
  if (meshes.length !== 1 || primitives?.length !== 1) throw new Error("Expected one Buddha primitive");
  const primitive = primitives[0];
  if (primitive.getMode() !== 4 || primitive.listSemantics().sort().join() !== "NORMAL,POSITION,TEXCOORD_0") {
    throw new Error("Unexpected Buddha vertex layout");
  }
  const position = primitive.getAttribute("POSITION").getArray();
  const normal = primitive.getAttribute("NORMAL").getArray();
  const uv = primitive.getAttribute("TEXCOORD_0").getArray();
  const indices = primitive.getIndices().getArray();
  const vertexCount = position.length / 3;
  const parent = new Uint32Array(vertexCount);
  const coincident = new Map();
  for (let i = 0; i < vertexCount; i++) {
    const key = position.subarray(3*i, 3*i+3).join(",");
    if (!coincident.has(key)) coincident.set(key, i);
    parent[i] = coincident.get(key);
  }
  function root(i) {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  }
  for (let i = 0; i < indices.length; i += 3) {
    const head = root(indices[i]);
    parent[root(indices[i+1])] = head;
    parent[root(indices[i+2])] = head;
  }
  const components = new Map();
  for (let i = 0; i < vertexCount; i++) {
    const id = root(i);
    if (!components.has(id)) {
      components.set(id, { id, min: [Infinity,Infinity,Infinity], max: [-Infinity,-Infinity,-Infinity],
        sample: i, maxU: 0 });
    }
    const component = components.get(id);
    for (let axis = 0; axis < 3; axis++) {
      const value = position[3*i+axis];
      component.min[axis] = Math.min(component.min[axis], value);
      component.max[axis] = Math.max(component.max[axis], value);
    }
    component.maxU = Math.max(component.maxU, uv[2*i]);
  }
  // The oval spans the head from the underside of the chin to beneath the
  // curls. Ears and separate curls only occupy one side or their own height.
  const ovals = [...components.values()].filter(({ min, max }) =>
    min[0] < -.14 && max[0] > .14 && min[1] > 1.41 && min[1] < 1.47 &&
    max[1] > 1.77 && max[1] < 1.915 && min[2] < -.11 && max[2] > .16);
  if (ovals.length !== 1) throw new Error("Cannot locate the seated Buddha's facial oval");
  const oval = ovals[0];
  // On the legacy mesh the oval uses only the skin swatch (U < 1/2).
  // The newer oval wraps onto the dedicated right-hand pigment island.
  const hasIsland = oval.maxU > .5;
  const paletteColumns = hasIsland ? 8 : 4;
  const faceIds = new Set([oval.id]);
  for (const { id, min, max, sample } of components.values()) {
    // Among the components on the front of the oval, only the urna and the
    // old pigment strokes use malachite, vermilion, pearl or crease swatches.
    const tile = Math.floor(uv[2*sample]*paletteColumns) + 4*Math.floor((1-uv[2*sample+1])*2);
    if (min[0] > -.145 && max[0] < .145 && min[1] > 1.45 && max[1] < 1.775 &&
        min[2] > .07 && [3,4,6,7].includes(tile)) faceIds.add(id);
  }
  if (faceIds.size < 2) throw new Error("Cannot locate the Buddha's forehead jewel");
  const face = Uint8Array.from(parent, (_, i) => Number(faceIds.has(root(i))));
  return { primitive, position, normal, uv, indices, face, hasIsland, name: meshes[0].getName(),
    preservedCount: components.size-faceIds.size };
}

export async function preserveSurroundingStatue(previous, replacement, output) {
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ "meshopt.decoder": MeshoptDecoder });
  const before = partition(await io.read(previous));
  const document = await io.read(replacement);
  const after = partition(document);
  if (before.name !== after.name || !after.hasIsland || before.preservedCount !== after.preservedCount) {
    throw new Error("Incompatible Buddha models supplied for face replacement");
  }
  const positions = [], normals = [], uvs = [], indices = [];
  function append(model, takeFace) {
    const remap = new Map();
    for (let t = 0; t < model.indices.length; t += 3) {
      if (Boolean(model.face[model.indices[t]]) !== takeFace) continue;
      for (let j = t; j < t+3; j++) {
        const i = model.indices[j];
        if (!remap.has(i)) {
          remap.set(i, uvs.length / 2);
          positions.push(...model.position.subarray(3*i,3*i+3));
          normals.push(...model.normal.subarray(3*i,3*i+3));
          uvs.push(model.uv[2*i] * (model.hasIsland ? 1 : .5), model.uv[2*i+1]);
        }
        indices.push(remap.get(i));
      }
    }
  }
  append(before, false);
  const kept = indices.length;
  const candidateBodyIndices = after.indices.reduce((n,i) => n + Number(!after.face[i]), 0);
  if (kept !== candidateBodyIndices) throw new Error("Non-face triangle count changed across Buddha builds");
  append(after, true);
  const p = after.primitive;
  p.getAttribute("POSITION").setArray(new Float32Array(positions));
  p.getAttribute("NORMAL").setArray(new Float32Array(normals));
  p.getAttribute("TEXCOORD_0").setArray(new Float32Array(uvs));
  const IndexArray = positions.length/3 > 65535 ? Uint32Array : Uint16Array;
  p.getIndices().setArray(new IndexArray(indices));
  await io.write(output, document);
  console.log(`Retained ${kept/3} original triangles and inserted ${(indices.length-kept)/3} facial triangles`);
}

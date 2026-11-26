/** Keep original positions, shading normals and atlas UVs outside the revised sculpture. */
import { createRequire } from "node:module";
import { MeshoptDecoder } from "meshoptimizer";
import { sculptNose } from "./node/buddha_nose16.mjs";

const require = createRequire(new URL("./node/package.json", import.meta.url));
const { NodeIO } = require("@gltf-transform/core");
const { ALL_EXTENSIONS } = require("@gltf-transform/extensions");

function hasEarIsland({ minU, maxU, minV }) {
  // The lateral relief uses tile 7; the back still uses the skin swatch.
  return minU > .125 && minU < .25 && maxU > .375 && maxU < .5 && minV < .5;
}

function partition(document, region) {
  const meshes = document.getRoot().listMeshes();
  const primitives = meshes[0]?.listPrimitives();
  if (meshes.length !== 1 || primitives?.length !== 1) throw new Error("Expected one Buddha primitive");
  const primitive = primitives[0];
  // The second UV is derived from the final merged normals by the packer.
  if (primitive.getMaterial()?.getEmissiveTexture()?.getName().endsWith("-photographic-fill")) {
    primitive.getAttribute("TEXCOORD_1")?.dispose();
  }
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
        sample: i, minU: Infinity, maxU: 0, minV: Infinity });
    }
    const component = components.get(id);
    for (let axis = 0; axis < 3; axis++) {
      const value = position[3*i+axis];
      component.min[axis] = Math.min(component.min[axis], value);
      component.max[axis] = Math.max(component.max[axis], value);
    }
    component.minU = Math.min(component.minU, uv[2*i]);
    component.maxU = Math.max(component.maxU, uv[2*i]);
    component.minV = Math.min(component.minV, uv[2*i+1]);
  }
  // The oval spans the head from the underside of the chin to beneath the
  // curls. The registered sculpt has a shallower nasal projection than the
  // legacy oval and can be recognized by its dedicated frontal pigment island.
  const ovals = [...components.values()].filter(({ min, max, maxU }) =>
    min[0] < -.14 && max[0] > .14 && min[1] > 1.41 && min[1] < 1.47 &&
    max[1] > 1.77 && max[1] < 1.96 && (maxU > .5 || (min[2] < -.11 && max[2] > .16)));
  if (ovals.length !== 1) throw new Error("Cannot locate the seated Buddha's facial oval");
  const oval = ovals[0];
  // On the legacy mesh the oval uses only the skin swatch (U < 1/2).
  // The newer oval wraps onto the dedicated right-hand pigment island.
  const hasIsland = oval.maxU > .5;
  const selected = new Set();
  const earCurlSides = new Set();
  if (["portrait", "oval", "oval-and-ears", "oval-and-scalp", "scalp"].includes(region)) {
    if (!hasIsland) throw new Error("Expected a registered face with a dedicated pigment island");
    if (["portrait", "oval-and-scalp", "scalp"].includes(region)) {
      // All curl bands and their folded rim use the hair swatch in the
      // upper glTF V half. The urna uses the same U columns in the other half.
      for (const { id, minU, maxU, minV } of components.values()) {
        if (minU > .25 && maxU < .375 && minV > .5) selected.add(id);
      }
      if (!selected.size) throw new Error("Missing cast scalp in the hair swatch");
    }
    if (region !== "scalp") selected.add(oval.id);
  }
  if (["portrait", "oval-and-ears", "ears", "nose-and-ears"].includes(region)) {
    if (!hasIsland) throw new Error("Ear replacement requires the Buddha's current face atlas");
    const sides = new Set();
    for (const component of components.values()) {
      const { id, min, max, minU, maxU, minV } = component;
      // The new curls at each ear root occupy separate parts of the hair swatch.
      // The continuous scalp spans the centre line and always stays on the seed.
      if (region === "nose-and-ears" && minU > .25 && maxU < .375 && minV > .5 &&
          (min[0] > .10 || max[0] < -.10) && min[1] > 1.63 && max[1] < 1.80 &&
          min[2] > -.25 && max[2] < .03) {
        selected.add(id);
        earCurlSides.add(Math.sign(min[0]));
      }
      // The only gilt skin components entirely beside the face are the two
      // pinnae and their folds. Bounds are glTF coordinates (+Y up, +Z front).
      const skinOnly = minU > .125 && maxU < .25 && minV > .5;
      if ((min[0] > .055 || max[0] < -.055) && min[0] > -.245 && max[0] < .245 &&
          min[1] > 1.41 && max[1] < 1.77 && min[2] > -.25 && max[2] < .085 &&
          (skinOnly || hasEarIsland(component))) {
        selected.add(id);
        if (min[1] < 1.52 && max[1] > 1.695) sides.add(Math.sign(min[0]));
      }
    }
    if (sides.size !== 2) throw new Error("Cannot locate both complete Buddha ears");
    if (region === "portrait") {
      const beads = [...components.values()].filter(({ min, max, minU, maxU, minV }) =>
        minU > .25 && maxU < .375 && minV < .5 &&
        min[1] > 1.69 && max[1] < 1.76 && min[2] > 0);
      if (beads.length !== 1) throw new Error("Cannot locate the Buddha's forehead bead");
      selected.add(beads[0].id);
    }
  } else if (region === "head") {
    if (!hasIsland) throw new Error("Head replacement requires the registered Buddha");
    for (const component of components.values()) {
      const { id, min, max, minU, maxU } = component;
      // The neck reliefs straddle the midline. The only lateral skin-only
      // pieces above the shoulders are the pinnae; keep their original carving.
      const lateralEar = (max[0] < 0 || min[0] > 0) &&
        ((minU > .125 && maxU < .25) || hasEarIsland(component));
      if (min[1] > 1.34 && min[0] > -.25 && max[0] < .25 && !lateralEar) selected.add(id);
    }
    if (!selected.has(oval.id)) throw new Error("Missing face in the head selection");
  } else if (region === "face") {
    const paletteColumns = hasIsland ? 8 : 4;
    selected.add(oval.id);
    for (const { id, min, max, sample } of components.values()) {
      // Among the components on the front of the oval, only the urna and the
      // old pigment strokes use the pigment and forehead-jewel swatches.
      const tile = Math.floor(uv[2*sample]*paletteColumns) + 4*Math.floor((1-uv[2*sample+1])*2);
      const frontDepth = tile === 6 ? 0 : .07; // The urna sits farther back than the lips.
      if (min[0] > -.145 && max[0] < .145 && min[1] > 1.45 && max[1] < 1.775 &&
          min[2] > frontDepth && [3,4,6,7].includes(tile)) selected.add(id);
    }
    if (selected.size < 2) throw new Error("Cannot locate the Buddha's forehead jewel");
  }
  const replace = Uint8Array.from(parent, (_, i) => Number(selected.has(root(i))));
  return { primitive, position, normal, uv, indices, replace, hasIsland, name: meshes[0].getName(),
    hasEarIsland: [...selected].some(id => hasEarIsland(components.get(id))),
    earCurlSides, preservedCount: components.size-selected.size };
}

export async function preserveSurroundingStatue(previous, replacement, output, region = "face") {
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ "meshopt.decoder": MeshoptDecoder });
  const shipped = await io.read(previous);
  const sculpt = await io.read(replacement);
  const before = partition(shipped, region);
  const after = partition(sculpt, region);
  if (region === "nose-and-ears") {
    if (before.earCurlSides.size || after.earCurlSides.size !== 2) {
      throw new Error("Expected the original scalp and a donor with local curls at both ears");
    }
    console.log(`Reshaped ${sculptNose(before.primitive)} vertices on the shipped nasal surface`);
  }
  if (before.name !== after.name || !after.hasIsland || before.preservedCount !== after.preservedCount) {
    throw new Error(`Incompatible Buddha models supplied for ${region} replacement`);
  }
  const keepPaint = region === "ears" || region === "scalp";
  const oldEarSkin = [];
  if (region === "ears" && after.hasEarIsland && !before.hasEarIsland) {
    // An ear-only graft keeps the original KTX2 maps. Earlier casts gilded
    // each ear entirely with the shared skin swatch, including the inner folds.
    for (let i = 0; i < before.replace.length; i++) {
      if (before.replace[i]) oldEarSkin.push(i);
    }
  }
  if (keepPaint && !shipped.getRoot().listExtensionsRequired().some(e => e.extensionName === "KHR_texture_basisu")) {
    throw new Error(`The ${region} graft requires a shipped KTX2 Buddha as its source`);
  }
  const positions = [], normals = [], uvs = [], indices = [];
  function append(model, takeReplacement) {
    const remap = new Map();
    for (let t = 0; t < model.indices.length; t += 3) {
      if (Boolean(model.replace[model.indices[t]]) !== takeReplacement) continue;
      for (let j = t; j < t+3; j++) {
        const i = model.indices[j];
        if (!remap.has(i)) {
          remap.set(i, uvs.length / 2);
          positions.push(...model.position.subarray(3*i,3*i+3));
          normals.push(...model.normal.subarray(3*i,3*i+3));
          let u = model.uv[2*i] * (model.hasIsland ? 1 : .5), v = model.uv[2*i+1];
          if (takeReplacement && oldEarSkin.length && u > .375 && u < .5 && v < .5) {
            let nearest = Infinity;
            for (const j of oldEarSkin) {
              const dx = model.position[3*i]-before.position[3*j];
              const dy = model.position[3*i+1]-before.position[3*j+1];
              const dz = model.position[3*i+2]-before.position[3*j+2];
              const d2 = dx*dx + dy*dy + dz*dz;
              if (d2 < nearest) {
                nearest = d2;
                u = before.uv[2*j];
                v = before.uv[2*j+1];
              }
            }
          }
          uvs.push(u, v);
        }
        indices.push(remap.get(i));
      }
    }
  }
  append(before, false);
  const kept = indices.length;
  // The shipped triangles are copied above. These grafts can have a different
  // donor count outside the selection due to hairline culling or body decimation.
  if (!["scalp", "portrait", "oval-and-ears", "ears", "nose-and-ears"].includes(region)) {
    const candidateBodyIndices = after.indices.reduce((n,i) => n + Number(!after.replace[i]), 0);
    if (kept !== candidateBodyIndices) throw new Error(`Triangle count outside the ${region} changed across Buddha builds`);
  }
  append(after, true);
  // The ear and curl grafts use existing swatches on the shipped KTX2 atlases.
  const document = keepPaint ? shipped : sculpt;
  const p = keepPaint ? before.primitive : after.primitive;
  document.getRoot().listExtensionsUsed().find(e => e.extensionName === "EXT_meshopt_compression")?.dispose();
  p.getAttribute("POSITION").setArray(new Float32Array(positions));
  p.getAttribute("NORMAL").setArray(new Float32Array(normals));
  p.getAttribute("TEXCOORD_0").setArray(new Float32Array(uvs));
  const IndexArray = positions.length/3 > 65535 ? Uint32Array : Uint16Array;
  p.getIndices().setArray(new IndexArray(indices));
  await io.write(output, document);
  console.log(`Retained ${kept/3} original triangles and inserted ${(indices.length-kept)/3} triangles for the ${region}`);
}

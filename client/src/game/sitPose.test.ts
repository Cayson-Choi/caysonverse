import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AnimationMixer, Vector3, type Bone, type Object3D, type SkinnedMesh } from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { SIT_POSE, SIT_ROOT_AHEAD } from "@caysonverse/shared/sitPose";
import { CLIP } from "./constants";

/**
 * The seated pose the benches are built around (sitPose.ts), re-measured from the shipped character.glb: if a new
 * export moves the hips, the butt or the hanging calves, every bench seat would float, sink or cut through its
 * front edge — this fails first. Textures are stripped before parsing (node has no image decoder); the geometry,
 * skin and clips are what is measured.
 */

const GLB = fileURLToPath(new URL("../../public/models/character.glb", import.meta.url));

/** The GLB with its images, textures and texture references removed (same binary chunk). */
function withoutTextures(buf: Buffer): ArrayBuffer {
  const jsonLen = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));
  delete gltf.images;
  delete gltf.textures;
  delete gltf.samplers;
  for (const m of gltf.materials ?? []) {
    if (m.pbrMetallicRoughness) {
      delete m.pbrMetallicRoughness.baseColorTexture;
      delete m.pbrMetallicRoughness.metallicRoughnessTexture;
    }
    delete m.normalTexture;
    delete m.occlusionTexture;
    delete m.emissiveTexture;
    delete m.extensions;
  }
  let json = Buffer.from(JSON.stringify(gltf), "utf8");
  json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const rest = buf.subarray(20 + jsonLen);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + json.length + rest.length, 8);
  header.writeUInt32LE(json.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  const out = Buffer.concat([header, json, rest]);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
}

/** The skinned body in `clip` at its first frame: bones by (sanitized) name, and every vertex of `meshes` in world space. */
async function pose(clip: string, meshes: readonly string[]) {
  const gltf = await new Promise<GLTF>((res, rej) => new GLTFLoader().parse(withoutTextures(readFileSync(GLB)), "", res, rej));
  const root: Object3D = gltf.scene;
  const mixer = new AnimationMixer(root);
  mixer.clipAction(gltf.animations.find((c) => c.name === clip)!).play();
  mixer.setTime(0);
  root.updateMatrixWorld(true);
  const bones = new Map<string, Bone>();
  const verts: Vector3[] = [];
  root.traverse((o) => {
    if ((o as Bone).isBone) bones.set(o.name, o as Bone);
    const m = o as SkinnedMesh;
    if (m.isSkinnedMesh && meshes.includes(m.name)) {
      m.skeleton.update();
      const p = m.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) verts.push(m.applyBoneTransform(i, new Vector3().fromBufferAttribute(p, i)).applyMatrix4(m.matrixWorld));
    }
  });
  return { bones, verts };
}

describe("the seated pose of character.glb (what the bench seats assume)", () => {
  it("the hips sit hipsBehindRoot behind the root, the butt's lowest point is at contactY", async () => {
    const { bones, verts } = await pose(CLIP.sitIdle, ["body__legs"]);
    const hips = bones.get("hips")!.getWorldPosition(new Vector3());
    expect(-hips.z).toBeCloseTo(SIT_POSE.hipsBehindRoot, 2);
    // under the hips (z -0.55..-0.38): the butt rests within a centimetre of contactY
    const butt = verts.filter((v) => v.z < -0.38 && v.z > -0.55);
    const low = Math.min(...butt.map((v) => v.y));
    expect(Math.abs(low - SIT_POSE.contactY)).toBeLessThan(0.015);
  }, 20000);

  it("the shins hang no further back than calvesBehindRoot below seat height, so a seat edge SIT_ROOT_AHEAD behind the root clears them", async () => {
    const { verts } = await pose(CLIP.sitIdle, ["body__legs", "body__feet"]);
    // everything of the lower legs that hangs below the seat (y < contactY), and in front of the butt
    const hanging = verts.filter((v) => v.y < SIT_POSE.contactY - 0.01 && v.z > -0.35);
    expect(hanging.length).toBeGreaterThan(20);
    const furthestBack = Math.min(...hanging.map((v) => v.z));
    expect(furthestBack).toBeGreaterThan(-SIT_POSE.calvesBehindRoot - 0.01);
    expect(SIT_ROOT_AHEAD).toBeGreaterThan(-furthestBack);
  }, 20000);

  it("the sit-down clip ends where the seated idle begins (the bench lift is eased over it, not jumped)", async () => {
    const down = await pose(CLIP.sitIdle, []);
    const stand = await pose(CLIP.sitStand, []);
    const a = down.bones.get("hips")!.getWorldPosition(new Vector3());
    const b = stand.bones.get("hips")!.getWorldPosition(new Vector3());
    expect(a.distanceTo(b)).toBeLessThan(0.01);
  }, 20000);
});

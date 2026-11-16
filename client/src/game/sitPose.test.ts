import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AnimationMixer, LoopOnce, Quaternion, Vector3, type Bone, type Object3D, type SkinnedMesh } from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { FLOOR_SIT_POSE, liftForSeatY, SIT_POSE, SIT_ROOT_AHEAD } from "@caysonverse/shared/sitPose";
import { CLIP, FLOOR_CLIP } from "./constants";
import { SEATED_HEAD_BEHIND_ROOT, SEATED_HEAD_RISE } from "./seatedEye";

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
function pose(clip: string, meshes: readonly string[]) {
  return poseAt(clip, 0, meshes);
}

/** The same at `time` seconds into the clip (past the end: the last frame for a one-shot clip). */
async function poseAt(clip: string, time: number, meshes: readonly string[]) {
  const gltf = await new Promise<GLTF>((res, rej) => new GLTFLoader().parse(withoutTextures(readFileSync(GLB)), "", res, rej));
  const root: Object3D = gltf.scene;
  const mixer = new AnimationMixer(root);
  const action = mixer.clipAction(gltf.animations.find((c) => c.name === clip)!);
  action.clampWhenFinished = true;
  action.setLoop(LoopOnce, 1);
  action.play();
  mixer.setTime(time);
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

  it("the seated head's centre is SEATED_HEAD_BEHIND_ROOT behind the root and SEATED_HEAD_RISE above the standing one (seatedEye.ts)", async () => {
    const centre = (v: Vector3[]) => {
      const lo = new Vector3(Infinity, Infinity, Infinity);
      const hi = new Vector3(-Infinity, -Infinity, -Infinity);
      for (const p of v) {
        lo.min(p);
        hi.max(p);
      }
      return lo.add(hi).multiplyScalar(0.5);
    };
    const sat = centre((await pose(CLIP.sitIdle, ["body__head"])).verts);
    const stood = centre((await pose(CLIP.idle, ["body__head"])).verts);
    expect(-sat.z).toBeCloseTo(SEATED_HEAD_BEHIND_ROOT, 1);
    expect(Math.abs(stood.z)).toBeLessThan(0.03);
    expect(sat.y - stood.y).toBeCloseTo(SEATED_HEAD_RISE, 1);
  }, 20000);
});

describe("the cross-legged floor pose of character.glb (what the floor cushion / 보료 seats assume)", () => {
  const BODY = ["body__legs", "body__feet", "body__torso", "body__head", "body__hands"];

  it("the hips sit hipsBehindRoot behind the root and the lowest point of the body is at contactY (a cushion just lifts by its height)", async () => {
    const { bones, verts } = await pose(FLOOR_CLIP.sitIdle, BODY);
    const hips = bones.get("hips")!.getWorldPosition(new Vector3());
    expect(-hips.z).toBeCloseTo(FLOOR_SIT_POSE.hipsBehindRoot, 2);
    expect(Math.abs(Math.min(...verts.map((v) => v.y)) - FLOOR_SIT_POSE.contactY)).toBeLessThan(0.015);
    expect(liftForSeatY(0.12, "floor")).toBeCloseTo(0.12, 6);
    expect(liftForSeatY(0.12)).toBeCloseTo(0.12 - SIT_POSE.contactY, 6); // chairs are unchanged
  }, 20000);

  it("the toes reach toesAheadOfRoot, the knees kneesSideways, the back of the torso torsoBehindRoot", async () => {
    const { verts: legs } = await pose(FLOOR_CLIP.sitIdle, ["body__legs", "body__feet"]);
    expect(Math.max(...legs.map((v) => v.z))).toBeCloseTo(FLOOR_SIT_POSE.toesAheadOfRoot, 1);
    const { verts: thighs } = await pose(FLOOR_CLIP.sitIdle, ["body__legs"]);
    expect(Math.max(...thighs.map((v) => Math.abs(v.x)))).toBeCloseTo(FLOOR_SIT_POSE.kneesSideways, 1);
    const { verts: torso } = await pose(FLOOR_CLIP.sitIdle, ["body__torso"]);
    expect(-Math.min(...torso.map((v) => v.z))).toBeCloseTo(FLOOR_SIT_POSE.torsoBehindRoot, 1);
  }, 20000);

  it("the sit-down ends where the idle begins and the stand-up begins there (no jump at either seam)", async () => {
    const idle = await pose(FLOOR_CLIP.sitIdle, []);
    const down = await poseAt(FLOOR_CLIP.sitDown, 1e9, []); // past the end: clamped to the last frame
    const up = await pose(FLOOR_CLIP.sitStand, []);
    const at = (p: { bones: Map<string, Bone> }, n: string) => p.bones.get(n)!.getWorldPosition(new Vector3());
    for (const n of ["hips", "head", "footl", "footr", "handl", "handr"]) {
      expect(at(down, n).distanceTo(at(idle, n)), `down end vs idle start: ${n}`).toBeLessThan(0.01);
      expect(at(up, n).distanceTo(at(idle, n)), `idle start vs stand-up start: ${n}`).toBeLessThan(0.01);
    }
  }, 20000);

  it("never goes through the floor while sitting down or getting up (every frame, lowest body point >= -1 cm)", async () => {
    for (const clip of [FLOOR_CLIP.sitDown, FLOOR_CLIP.sitStand, FLOOR_CLIP.sitIdle]) {
      for (const t of [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.5, 2.5]) {
        const { verts } = await poseAt(clip, t, ["body__legs", "body__feet"]);
        expect(Math.min(...verts.map((v) => v.y)), `${clip} @ ${t}s`).toBeGreaterThan(-0.01);
      }
    }
  }, 60000);

  it("the idle loop moves (breathing, a head turn) and its last frame meets its first", async () => {
    const first = await poseAt(FLOOR_CLIP.sitIdle, 0, []);
    const mid = await poseAt(FLOOR_CLIP.sitIdle, 0.375, []);
    const moved = first.bones.get("head")!.getWorldPosition(new Vector3()).distanceTo(mid.bones.get("head")!.getWorldPosition(new Vector3()));
    const chestMoved = first.bones.get("chest")!.getWorldQuaternion(new Quaternion()).angleTo(mid.bones.get("chest")!.getWorldQuaternion(new Quaternion()));
    expect(moved + chestMoved).toBeGreaterThan(0.01);
    const gltf = await new Promise<GLTF>((res, rej) => new GLTFLoader().parse(withoutTextures(readFileSync(GLB)), "", res, rej));
    const clip = gltf.animations.find((c) => c.name === FLOOR_CLIP.sitIdle)!;
    for (const tr of clip.tracks) {
      if (!tr.name.endsWith(".quaternion")) continue;
      const v = tr.values;
      const n = tr.times.length - 1;
      for (let k = 0; k < 4; k++) expect(Math.abs(v[n * 4 + k] - v[k]) < 1e-4 || Math.abs(v[n * 4 + k] + v[k]) < 1e-4, `${tr.name} loops`).toBe(true);
    }
  }, 20000);
});

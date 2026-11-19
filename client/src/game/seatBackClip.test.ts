import { describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AnimationMixer, LoopRepeat, Quaternion, Vector3, type Object3D, type SkinnedMesh } from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VILLAGE_SEATS } from "@caysonverse/shared/village/benchSeats";
import { BUS_SEATS, BUS_SEAT_BACKS, seatBodyPoint } from "@caysonverse/shared/village/busCabin";
import { SIT_POSE } from "@caysonverse/shared/sitPose";
import { CHAIR_BACK_BAND, FLOOR_BACK_BAND, backBandOf, flattenedZ, seatBackFace, type BackBand } from "@caysonverse/shared/village/seatBack";
import { LEAN_SPLIT } from "./leanBack";
import { BACK_SQUASH_GLSL } from "./backSquash";

/**
 * Seated avatars never poke through a backrest (owner 2026-11-20: the fishing chair let clothing out behind its back). For every
 * seat type of the village, the avatar's skinned vertices (EVERY outfit and hair part of character.glb at once = the bulkiest
 * look, in the seat's own lean) are measured behind the backrest's face, between the seat surface and the shoulders — raw, and
 * after the avatar-side flattening (seatBack.ts / backSquash.ts). Set SEATCLIP_REPORT=<file.json> to write the table.
 */

const GLB = fileURLToPath(new URL("../../public/models/character.glb", import.meta.url));

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

/** Every vertex of every mesh (all outfit, hair, hat, item parts at once) in `clip` at 8 phases of its loop, with `lean` rad of lean-back. */
async function bulkiestPose(clip: string, lean: number): Promise<{ part: string; v: Vector3[] }[]> {
  const gltf = await new Promise<GLTF>((res, rej) => new GLTFLoader().parse(withoutTextures(readFileSync(GLB)), "", res, rej));
  const root: Object3D = gltf.scene;
  const mixer = new AnimationMixer(root);
  const action = mixer.clipAction(gltf.animations.find((c) => c.name === clip)!);
  action.setLoop(LoopRepeat, Infinity);
  action.play();
  const dur = action.getClip().duration;
  const spine = root.getObjectByName("spine");
  const chest = root.getObjectByName("chest");
  const axis = new Vector3(1, 0, 0);
  const rot = new Quaternion();
  const out: { part: string; v: Vector3[] }[] = [];
  const byPart = new Map<string, Vector3[]>();
  for (let k = 0; k < 8; k++) {
    mixer.setTime((dur * k) / 8);
    // the lean, written on top of the mixer's pose exactly as leanBack.ts does
    if (lean > 0) {
      for (const [bone, share] of [[spine, LEAN_SPLIT.spine], [chest, LEAN_SPLIT.chest]] as const) {
        if (!bone) continue;
        rot.setFromAxisAngle(axis, -lean * share);
        bone.quaternion.multiply(rot);
      }
    }
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      const m = o as SkinnedMesh;
      if (!m.isSkinnedMesh) return;
      m.skeleton.update();
      const p = m.geometry.attributes.position;
      const list = byPart.get(m.name) ?? [];
      for (let i = 0; i < p.count; i++) list.push(m.applyBoneTransform(i, new Vector3().fromBufferAttribute(p, i)).applyMatrix4(m.matrixWorld));
      byPart.set(m.name, list);
    });
  }
  for (const [part, v] of byPart) out.push({ part, v });
  return out;
}

/** The deepest poke (m) behind `face` among vertices with y in [yLo, yHi]: raw, and after the flattening; and which part is worst. */
function penetration(parts: { part: string; v: Vector3[] }[], face: number, band: BackBand, yLo: number, yHi: number) {
  let raw = 0;
  let rawCloth = 0;
  let flat = 0;
  let worst = "";
  for (const { part, v } of parts) {
    if (part.startsWith("item__")) continue; // a held thing (balloon, flag...), not clothing or hair
    for (const p of v) {
      if (p.y < yLo || p.y > yHi) continue;
      const r = -p.z - face;
      if (/^(top|bottom|body)__/.test(part)) rawCloth = Math.max(rawCloth, r);
      if (r > raw) {
        raw = r;
        worst = part;
      }
      flat = Math.max(flat, -flattenedZ(p.z, p.y, face, band) - face);
    }
  }
  return { raw, rawCloth, flat, worst };
}

interface SeatType {
  type: string;
  face: number;
  lean: number;
  band: BackBand;
  floor: boolean;
  n: number;
}

/** Every seat type of the village list (id with its digits stripped + kind), with the largest face / lean of its members. */
function seatTypes(): SeatType[] {
  const map = new Map<string, SeatType>();
  for (const s of VILLAGE_SEATS) {
    if (s.retired) continue;
    const face = seatBackFace(s);
    if (!(face > 0)) continue;
    const floor = s.pose === "floor";
    const type = `${String(s.id).replace(/lake:chair_.*/, "lake:fishing_chair").replace(/[-0-9.]+/g, "#")}${floor ? " (floor)" : ""}`;
    const cur = map.get(type);
    if (!cur) map.set(type, { type, face, lean: s.lean ?? 0, band: backBandOf(s), floor, n: 1 });
    else {
      cur.face = Math.min(cur.face, face); // the tightest face of the type
      cur.lean = Math.max(cur.lean, s.lean ?? 0);
      cur.n++;
    }
  }
  // the village bus: ten backed seats, the backrest's front face 0.02 m... measured from the cabin data (yaw 0: facing forward)
  for (const seat of BUS_SEATS) {
    const back = BUS_SEAT_BACKS.find((b) => b.seat === seat.id)!;
    const root = seatBodyPoint(seat);
    const face = root.ahead - back.max[0];
    const cur = map.get("bus:seat");
    if (!cur) map.set("bus:seat", { type: "bus:seat", face, lean: 0, band: CHAIR_BACK_BAND, floor: false, n: 1 });
    else {
      cur.face = Math.min(cur.face, face);
      cur.n++;
    }
  }
  return [...map.values()];
}

describe("a seated avatar's back never pokes through the backrest (bulkiest look, every seat type)", () => {
  it("the shader does what flattenedZ does (the same lines, the same bands)", () => {
    expect(BACK_SQUASH_GLSL).toContain("cvBehind = - transformed.z - uBackFace");
    expect(BACK_SQUASH_GLSL).toContain("smoothstep( uBackBand.x, uBackBand.y, transformed.y ) * ( 1.0 - smoothstep( uBackBand.z, uBackBand.w, transformed.y ) )");
    expect(flattenedZ(-0.9, 1.0, 0.7, CHAIR_BACK_BAND)).toBeCloseTo(-0.7, 9);
    expect(flattenedZ(-0.9, 1.8, 0.7, CHAIR_BACK_BAND)).toBeCloseTo(-0.9, 9); // the head is above the band
    expect(flattenedZ(-0.6, 1.0, 0.7, CHAIR_BACK_BAND)).toBe(-0.6); // nothing in front of the face moves
    expect(flattenedZ(-0.9, 1.0, 0, CHAIR_BACK_BAND)).toBe(-0.9); // no backrest: off
    expect(flattenedZ(-0.9, 0.2, 0.7, FLOOR_BACK_BAND)).toBeCloseTo(-0.7, 9);
  });

  it("the faces are the design ones (a backed seat is at least the bare torso's 0.71 m behind the root; the fishing chair 0.668)", () => {
    const types = seatTypes();
    const fishing = types.find((t) => t.type === "lake:fishing_chair")!;
    expect(fishing.face).toBeCloseTo(0.668, 2);
    expect(fishing.n).toBe(30);
    for (const t of types.filter((q) => !q.floor)) expect(t.face, t.type).toBeGreaterThan(SIT_POSE.torsoBehindRoot - 0.06);
  });

  it("zero poke after the flattening for every seat type, raw numbers reported", async () => {
    const types = seatTypes();
    expect(types.length).toBeGreaterThan(10);
    const poses = new Map<string, Awaited<ReturnType<typeof bulkiestPose>>>();
    for (const t of types) {
      const key = `${t.floor}|${t.lean}`;
      if (!poses.has(key)) poses.set(key, await bulkiestPose(t.floor ? "Sit_Floor_Idle" : "Sit_Chair_Idle", t.lean));
    }
    const rows = types.map((t) => {
      const parts = poses.get(`${t.floor}|${t.lean}`)!;
      // between the seat surface and the shoulders: where a backrest is
      const p = penetration(parts, t.face, t.band, t.floor ? 0.1 : 0.39, t.band.fallLo);
      return { type: t.type, seats: t.n, faceM: +t.face.toFixed(3), lean: t.lean, rawClothesCm: +(p.rawCloth * 100).toFixed(1), rawPokeCm: +(p.raw * 100).toFixed(1), afterCm: +(p.flat * 100).toFixed(2), worst: p.worst };
    });
    if (process.env.SEATCLIP_REPORT) {
      mkdirSync(dirname(process.env.SEATCLIP_REPORT), { recursive: true });
      writeFileSync(process.env.SEATCLIP_REPORT, JSON.stringify(rows, null, 1));
    }
    for (const r of rows) expect(r.afterCm, `${r.type} (raw ${r.rawPokeCm} cm, worst ${r.worst})`).toBeLessThanOrEqual(0.1);
    // the flattening is a fix, not a no-op: the bulkiest look pokes more than a centimetre somewhere
    expect(Math.max(...rows.map((r) => r.rawPokeCm))).toBeGreaterThan(1);
  }, 120000);
});

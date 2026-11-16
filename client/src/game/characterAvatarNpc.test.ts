import { describe, expect, it } from "vitest";
import {
  Bone,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Matrix4,
  MeshStandardMaterial,
  Object3D,
  Skeleton,
  SkinnedMesh,
  Texture,
  Uint8BufferAttribute,
  type Material,
  type Mesh,
} from "three";
import { assembleAvatar, releaseAvatar, retainAvatar } from "./characterAvatar";
import type { AvatarLook } from "./characterLook";

// NPC 전용 부품(npc.glb, shared/village/npcLooks.ts)이 character.glb의 아바타에 붙는지: 같은 뼈 이름·순서의 두 번째 장면에서
// 복제해 아바타의 뼈에 다시 묶고, 고정색 부품은 합친 메시로, 텍스처 부품(명찰)은 따로 그린다.

function rigWith(parts: [string, Material, number][], groups: [string, [string, Material, number][]][] = [], bones = ["root", "head"]): Object3D {
  const rig = new Object3D();
  rig.name = "Rig";
  const bs = bones.map((n) => {
    const b = new Bone();
    b.name = n;
    return b;
  });
  for (let i = 1; i < bs.length; i++) bs[0].add(bs[i]);
  rig.add(bs[0]);
  rig.updateMatrixWorld(true);
  const skeleton = new Skeleton(bs);
  const tri = (name: string, m: Material, x: number) => {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute([x, 0, 0, x, 1, 0, x, 0, 1], 3));
    g.setAttribute("normal", new Float32BufferAttribute([1, 0, 0, 1, 0, 0, 1, 0, 0], 3));
    g.setAttribute("skinIndex", new Uint8BufferAttribute([0, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0], 4));
    g.setAttribute("skinWeight", new Float32BufferAttribute([0.5, 0.5, 0, 0, 1, 0, 0, 0, 0.5, 0.5, 0, 0], 4));
    g.setIndex([0, 1, 2]);
    const mesh = new SkinnedMesh(g, m);
    mesh.name = name;
    mesh.bind(skeleton, new Matrix4());
    return mesh;
  };
  for (const [n, m, x] of parts) rig.add(tri(n, m, x));
  for (const [gn, kids] of groups) {
    const g = new Group();
    g.name = gn;
    for (const [n, m, x] of kids) g.add(tri(n, m, x));
    rig.add(g);
  }
  const root = new Group();
  root.add(rig);
  return root;
}

const mat = (name: string, color?: Color, map?: Texture) => new MeshStandardMaterial({ name, side: DoubleSide, ...(color ? { color } : {}), ...(map ? { map } : {}) });
const skin = mat("mat_skin");
const character = rigWith([
  ["body__head", skin, 1], ["body__hands", skin, 2], ["body__torso", skin, 3], ["body__legs", skin, 4], ["body__feet", skin, 5],
  ["face__smile", mat("mat_face_smile", undefined, new Texture()), 6], ["bottom__pants", mat("mat_tint_bottom"), 7], ["shoes__dress", mat("mat_tint_shoes"), 8],
]);
const VEST = new Color(0.8, 0.1, 0.1);
const npc = rigWith([], [["top__npc_test", [["top__npc_test_1", mat("npc_red", VEST), 20], ["top__npc_test_2", mat("npc_badge", undefined, new Texture()), 21]]]]);

const look: AvatarLook = {
  parts: { hat: null, hair: null, face: "smile", top: "npc_test", bottom: "pants", shoes: "dress", item: null },
  colors: { skin: "#FFDCC2", hair: "#000000", hat: "#FFFFFF", top: "#FFFFFF", bottom: "#22305A", shoes: "#111111", item: "#FFFFFF", accent: "#FFFFFF" },
};

function names(o: Object3D): string[] {
  const out: string[] = [];
  o.traverse((x) => {
    if ((x as Mesh).isMesh) out.push(x.name);
  });
  return out.sort();
}

describe("assembleAvatar with NPC parts from a second scene (npc.glb)", () => {
  it("grafts the NPC top: its fixed colour joins the merged mesh, its picture is drawn apart, the bare torso is hidden", () => {
    const a = assembleAvatar({ scene: character, extra: npc }, look);
    retainAvatar(a);
    expect(a.parts).toContain("top__npc_test");
    expect(a.parts).not.toContain("body__torso");
    expect(names(a.root)).toEqual(["avatar__solid", "face__smile", "top__npc_test_2"]);
    const solid = a.root.getObjectByName("avatar__solid") as SkinnedMesh;
    const pos = solid.geometry.getAttribute("position");
    const col = solid.geometry.getAttribute("color");
    let seen = 0;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getX(i) !== 20) continue;
      seen++;
      expect([col.getX(i), col.getY(i), col.getZ(i)].map((v, k) => Math.abs(v - [VEST.r, VEST.g, VEST.b][k]) < 1e-5)).toEqual([true, true, true]);
    }
    expect(seen).toBe(3);
    // the badge is bound to the avatar's own bones, not npc.glb's
    const badge = a.root.getObjectByName("top__npc_test_2") as SkinnedMesh;
    const bones: Bone[] = [];
    a.root.traverse((o) => {
      if ((o as Bone).isBone) bones.push(o as Bone);
    });
    expect(badge.skeleton.bones.every((b) => bones.includes(b))).toBe(true);
    expect(a.drawMeshes).toBe(3);
    releaseAvatar(a);
  });

  it("never touches the npc scene it copies from", () => {
    const before = names(npc);
    const a = assembleAvatar({ scene: character, extra: npc }, look);
    retainAvatar(a);
    releaseAvatar(a);
    expect(names(npc)).toEqual(before);
    expect((npc.getObjectByName("top__npc_test_1") as SkinnedMesh).skeleton.bones[0].name).toBe("root");
  });

  it("refuses an NPC part skinned to a bone the character has not", () => {
    const odd = rigWith([], [["top__npc_test", [["top__npc_test_1", mat("npc_red", VEST), 30]]]], ["root", "tail"]);
    expect(() => assembleAvatar({ scene: character, extra: odd }, { ...look, colors: { ...look.colors, bottom: "#000001" } })).toThrow(/tail/);
  });
});

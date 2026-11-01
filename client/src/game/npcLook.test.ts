import { describe, expect, it } from "vitest";
import { Bone, Mesh, MeshStandardMaterial, Object3D, type Material } from "three";
import { SKIN_PALETTE } from "@caysonverse/shared/appearance";
import { BODY_MESHES, CHARACTER_MANIFEST, CHARACTER_SLOTS } from "@caysonverse/shared/characterManifest";
import { CLIP, HEAD_BONE_NAME } from "./constants";
import { TINT_KEYS, clipFor, lookKey, solidColorFor, visibleParts } from "./characterLook";
import type { NpcId } from "./npc";
import { NPC_ACCENTS, NPC_HAIR, NPC_HAIR_COLOR, attachNpcAccessories, npcLook } from "./npcLook";

const NPC_IDS = Object.keys(NPC_ACCENTS) as NpcId[];
/** manifest.npcOnly lists only the slots that have NPC-only parts. */
const NPC_ONLY: Readonly<Record<string, readonly string[] | undefined>> = CHARACTER_MANIFEST.npcOnly;

/** Every mesh node name character.glb ships: the shared slots, the npcOnly parts, the bare body, the hat-hair variants. */
const SHIPPED_MESHES: ReadonlySet<string> = new Set([
  ...BODY_MESHES,
  ...CHARACTER_SLOTS.flatMap((slot) => [
    ...CHARACTER_MANIFEST.slots[slot].map((id) => `${slot}__${id}`),
    ...(NPC_ONLY[slot] ?? []).map((id) => `${slot}__${id}`),
  ]),
  ...Object.values(CHARACTER_MANIFEST.hatVariants),
]);

describe("npcLook", () => {
  it("every assistant wears the npcOnly android outfit and its own accent", () => {
    for (const id of NPC_IDS) {
      const l = npcLook(id);
      expect([l.parts.top, l.parts.bottom, l.parts.shoes]).toEqual(["android", "android", "android"]);
      expect(CHARACTER_MANIFEST.npcOnly.top).toContain("android");
      expect(CHARACTER_MANIFEST.npcOnly.bottom).toContain("android");
      expect(CHARACTER_MANIFEST.npcOnly.shoes).toContain("android");
      expect(solidColorFor("mat_tint_accent", l)).toBe(NPC_ACCENTS[id]);
    }
    // the four stripes are four different colours
    expect(new Set(NPC_IDS.map((id) => NPC_ACCENTS[id])).size).toBe(NPC_IDS.length);
  });

  it("assistants show no hat, no item and no bare torso/legs/feet", () => {
    for (const id of NPC_IDS) {
      const l = npcLook(id);
      expect(l.parts.hat).toBeNull();
      expect(l.parts.item).toBeNull();
      const visible = visibleParts(l.parts);
      expect(visible.filter((p) => p.startsWith("hat__") || p.startsWith("item__"))).toEqual([]);
      for (const bare of ["body__torso", "body__legs", "body__feet"]) expect(visible).not.toContain(bare);
      // the android outfit hides the bare body, and the hair is never the hat variant
      expect(visible.filter((p) => p.endsWith("__hat"))).toEqual([]);
    }
  });

  it("an assistant look resolves to the android outfit, its own hair and a smile, all shipped in the manifest", () => {
    for (const id of NPC_IDS) {
      const visible = visibleParts(npcLook(id).parts);
      expect(visible).toEqual(
        ["body__hands", "body__head", "bottom__android", `face__smile`, `hair__${NPC_HAIR[id]}`, "shoes__android", "top__android"]
          .sort(),
      );
      for (const name of visible) expect({ id, name, shipped: SHIPPED_MESHES.has(name) }).toEqual({ id, name, shipped: true });
    }
  });

  it("the four assistants differ by hair as well as accent", () => {
    // 갤러리 조교는 양갈래: 포니테일은 뒤에서만 보여 앞에서 보면 강의실 조교(짧은 머리)와 같아 보였다
    expect(NPC_HAIR).toEqual({ hall: "short", lobby: "bob", gallery: "twintails", maze: "curly" });
    expect(new Set(Object.values(NPC_HAIR)).size).toBe(4);
    expect(Object.keys(NPC_HAIR).sort()).toEqual([...NPC_IDS].sort());
    for (const id of NPC_IDS) {
      expect(CHARACTER_MANIFEST.slots.hair).toContain(NPC_HAIR[id]);
      expect(npcLook(id).parts.hair).toBe(NPC_HAIR[id]);
    }
    // so every look is its own merged geometry
    expect(new Set(NPC_IDS.map((id) => lookKey(npcLook(id)))).size).toBe(NPC_IDS.length);
  });

  it("assistants never get a long-skirt variant clip", () => {
    for (const id of NPC_IDS) {
      for (const c of Object.values(CLIP)) expect(clipFor(c, npcLook(id))).toBe(c);
    }
  });

  it("colors: pale skin, slate hair, the assistant's accent, everything else white", () => {
    expect(NPC_HAIR_COLOR).toBe("#4A5160");
    for (const id of NPC_IDS) {
      const l = npcLook(id);
      expect(Object.keys(l.colors)).toEqual([...TINT_KEYS]);
      expect(l.colors.skin).toBe(SKIN_PALETTE[0].hex);
      expect(l.colors.hair).toBe(NPC_HAIR_COLOR);
      expect(l.colors.accent).toBe(NPC_ACCENTS[id]);
      for (const key of TINT_KEYS.filter((k) => !["skin", "hair", "accent"].includes(k))) {
        expect({ id, key, hex: l.colors[key] }).toEqual({ id, key, hex: "#FFFFFF" });
      }
      for (const hex of Object.values(l.colors)) expect(hex).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it("gives every call its own look, so one caller cannot recolor another's assistant", () => {
    const a = npcLook("hall");
    const b = npcLook("hall");
    expect(a).not.toBe(b);
    expect(lookKey(a)).toBe(lookKey(b));
    a.colors.accent = "#000000";
    a.parts.hair = null;
    expect(npcLook("hall").colors.accent).toBe(NPC_ACCENTS.hall);
    expect(npcLook("hall").parts.hair).toBe(NPC_HAIR.hall);
  });
});

describe("attachNpcAccessories", () => {
  /** A clone root with a `head` bone, like the toy skeleton's. */
  function rootWithHead(): { root: Object3D; head: Bone } {
    const root = new Object3D();
    const head = new Bone();
    head.name = HEAD_BONE_NAME;
    root.add(head);
    return { root, head };
  }

  it("hangs the antenna stem and the halo ring on the head bone in the accent color", () => {
    const { root, head } = rootWithHead();
    const out: Material[] = [];
    attachNpcAccessories(root, NPC_ACCENTS.maze, out);

    expect(head.children).toHaveLength(2);
    const [stem, halo] = head.children as Mesh[];
    expect(stem.position.y).toBeCloseTo(0.95); // above the head top, relative to the head bone
    expect(halo.position.y).toBeCloseTo(1.1);
    expect(halo.rotation.x).toBeCloseTo(Math.PI / 2); // a horizontal ring
    for (const m of [stem, halo]) {
      expect(m.frustumCulled).toBe(false); // bone-attached: the bounds don't follow the animation
      expect(m.matrixAutoUpdate).toBe(false);
    }
    // the avatar owns these materials (useAvatar disposes whatever decorate pushes)
    expect(out).toEqual([stem.material, halo.material]);
    for (const m of out as MeshStandardMaterial[]) {
      expect(m.color.getHexString()).toBe(NPC_ACCENTS.maze.slice(1));
      expect(m.emissive.getHexString()).toBe(NPC_ACCENTS.maze.slice(1));
    }
  });

  it("makes new materials for every avatar, so releasing one assistant leaves the others glowing", () => {
    const first = rootWithHead();
    const second = rootWithHead();
    const out: Material[] = [];
    attachNpcAccessories(first.root, NPC_ACCENTS.hall, out);
    attachNpcAccessories(second.root, NPC_ACCENTS.hall, out);
    expect(out).toHaveLength(4);
    expect(new Set(out).size).toBe(4);
  });

  it("does nothing when the clone has no head bone", () => {
    const out: Material[] = [];
    const root = new Object3D();
    attachNpcAccessories(root, NPC_ACCENTS.hall, out);
    expect(root.children).toEqual([]);
    expect(out).toEqual([]);
  });
});

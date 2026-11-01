/**
 * The AI 조교 "android docent" look: the same toy body every player has, dressed in
 * the NPC-only `android` outfit (white shell + one accent stripe per assistant), with
 * its own hair, a smile, and no hat or item. A hand-built AvatarLook that NpcCharacter
 * feeds to `useAvatar` like any player look — so the four assistants share the player
 * assembly path (one merged solid mesh + the face) and need no atlas or texture of their
 * own.
 *
 *  - the accent hue is the only thing that tints the outfit's stripe (클로드 orange /
 *    챗지피티 green / 제미나이 blue / 큐리 violet); everything else is white,
 *  - the hair shape differs per assistant too, so they tell apart by silhouette,
 *  - a floating HALO ring on an antenna stem above the head — procedural, emissive,
 *    unmistakably non-human — is attached once at assembly through `useAvatar`'s
 *    `decorate` hook (attachNpcAccessories).
 */

import {
  CylinderGeometry,
  Mesh,
  MeshStandardMaterial,
  TorusGeometry,
  type Material,
  type Object3D,
} from "three";
import { SKIN_PALETTE } from "@caysonverse/shared/appearance";
import { HEAD_BONE_NAME } from "./constants";
import { TINT_KEYS, type AvatarLook } from "./characterLook";
import type { NpcId } from "./npc";

/** Per-assistant accent hue (outfit stripe/halo) — a subtle brand nod. */
export const NPC_ACCENTS: Record<NpcId, string> = {
  hall: "#e8833a", // 아르티 — warm orange
  lobby: "#2fbf8a", // 노바 — teal green
  gallery: "#4d8df0", // 루미 — blue
  maze: "#a06bf0", // 큐리 — violet (미로 골 챔버의 안내자)
};

/** Tech-slate hair shared by all four assistants (the old android under-robe tone). */
export const NPC_HAIR_COLOR = "#4A5160";

/** Hair shape per assistant — a second way to tell them apart besides the accent hue. */
export const NPC_HAIR: Record<NpcId, string> = {
  hall: "short",
  lobby: "bob",
  gallery: "ponytail",
  maze: "curly",
};

/** The outfit is a white shell: every tint but skin, hair and accent stays white. */
const NPC_WHITE = "#FFFFFF";

/**
 * The AvatarLook of one assistant: no hat, its own hair, a smile, the npcOnly `android`
 * top/bottom/shoes and no item. Each call returns a fresh object. `android` has no
 * clip variants, so clipFor(base, npcLook(id)) is always the base clip.
 */
export function npcLook(id: NpcId): AvatarLook {
  const colors = {} as AvatarLook["colors"];
  for (const key of TINT_KEYS) colors[key] = NPC_WHITE;
  colors.skin = SKIN_PALETTE[0].hex;
  colors.hair = NPC_HAIR_COLOR;
  colors.accent = NPC_ACCENTS[id];
  return {
    parts: {
      hat: null,
      hair: NPC_HAIR[id],
      face: "smile",
      top: "android",
      bottom: "android",
      shoes: "android",
      item: null,
    },
    colors,
  };
}

// ── Procedural android accessories (halo antenna — 발주자: 바이저 없이 링만) ──

/** Antenna stem up from the crown of the head. */
const STEM_GEO = new CylinderGeometry(0.015, 0.015, 0.14, 8);
/** Floating halo ring (horizontal). */
const HALO_GEO = new TorusGeometry(0.2, 0.025, 10, 32);

function emissivePart(
  geometry: CylinderGeometry | TorusGeometry,
  color: string,
  out: Material[],
  intensity: number,
): Mesh {
  const material = new MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: intensity,
    roughness: 0.35,
    metalness: 0.2,
  });
  out.push(material);
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false; // bone-attached: the bounds don't follow the animation
  return mesh;
}

/**
 * Attach the glowing halo antenna to the clone's head bone (발주자 확정: 이마
 * 바이저 바는 제거, 머리 위 링만). The toy body's head top sits ≈ 0.92 m above the
 * head bone (bone y 1.241, `body__head` top y 2.16), so the stem (0.95) starts at the
 * crown and the ring (1.1) floats clear above it. Materials are per-avatar and pushed
 * into `out` — pass `a.materials` from useAvatar's `decorate`, which disposes them with
 * the avatar. The two geometries are shared module constants and never disposed.
 */
export function attachNpcAccessories(root: Object3D, accent: string, out: Material[]): void {
  const head = root.getObjectByName(HEAD_BONE_NAME);
  if (!head) return;

  const stem = emissivePart(STEM_GEO, accent, out, 0.8);
  stem.position.set(0, 0.95, 0);
  stem.updateMatrix();
  stem.matrixAutoUpdate = false;
  head.add(stem);

  const halo = emissivePart(HALO_GEO, accent, out, 1.2);
  halo.position.set(0, 1.1, 0);
  halo.rotation.x = Math.PI / 2;
  halo.updateMatrix();
  halo.matrixAutoUpdate = false;
  head.add(halo);
}

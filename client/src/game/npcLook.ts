/**
 * The AI 조교 "android docent" look (발주자: 기존 캐릭터에 없는 새 모습). Built
 * on the mage body via the PROVEN royal composite pipeline — but styled to read
 * as a brand-new character, not any player preset:
 *
 *  - hat/wand/staff/spellbooks hidden (no wizard silhouette),
 *  - whole robe palette-swapped to clean android WHITE with one ACCENT hue per
 *    assistant (클로드 orange / 챗지피티 green / 제미나이 blue),
 *  - a glowing eye VISOR across the face + a floating HALO ring antenna above
 *    the head — procedural, emissive, unmistakably non-human.
 *
 * Cell addresses reuse the queen recipe's verified mage-atlas map (same body,
 * same dump); skin/hand cells are simply never painted. One palette texture is
 * cached per accent (three total), shared by clones.
 */

import {
  CylinderGeometry,
  Mesh,
  MeshStandardMaterial,
  TorusGeometry,
  type Material,
  type Object3D,
  type Texture,
} from "three";
import { HEAD_BONE_NAME } from "./constants";
import { buildPaletteTexture, type RecolorCell } from "./royalPalette";
import type { NpcId } from "./npc";

/** Per-assistant accent hue (visor/halo/trim) — a subtle brand nod. */
export const NPC_ACCENTS: Record<NpcId, string> = {
  hall: "#e8833a", // 아르티 — warm orange
  lobby: "#2fbf8a", // 노바 — teal green
  gallery: "#4d8df0", // 루미 — blue
  maze: "#a06bf0", // 큐리 — violet (미로 골 챔버의 안내자)
};

/** Android body tones. */
const SHELL_WHITE = "#eef1f5"; // robe → clean desaturated shell
const SLATE = "#4a5160"; // under-robe/boots → dark tech slate

/** Mage-hat + weapon nodes hidden on every assistant (same set as the queen). */
export const NPC_HIDE_NODES: readonly string[] = [
  "Mage_Hat",
  "Mage_Cape", // the red drape breaks the android silhouette (screenshot)
  "1H_Wand",
  "2H_Staff",
  "Spellbook",
  "Spellbook_open",
];

const band = (
  col: number,
  b: number,
  color: string,
  flat = false,
): [RecolorCell, RecolorCell] => [
  { col, row: b * 2, color, flat },
  { col, row: b * 2 + 1, color, flat },
];

/**
 * Android recolor plan over the mage atlas (cells verified by the UV dump via
 * the queen recipe; skin (0,0)/(0,1 face band top) wait — face band is (0, b0);
 * protected cells (0,0),(1,0),(2,0 bands) and bare hands (7, b2) are simply
 * not listed here, so they keep the authored skin/hair pixels.
 */
function androidCells(accent: string): RecolorCell[] {
  // Shell cells use FLAT paint: the mage's robe cells are dark navy, and the
  // luminosity-keeping hue-swap left "white" near-black (screenshot-verified).
  return [
    ...band(0, 1, SHELL_WHITE, true), // robe body/arms
    ...band(1, 1, SHELL_WHITE, true), // hood/collar cloth
    ...band(7, 1, SHELL_WHITE, true), // dominant outer-robe surface
    ...band(2, 2, accent), // pouches/accents
    ...band(3, 2, SLATE, true), // boots
    ...band(3, 0, accent), // gray trim
    ...band(4, 0, accent), // arm cuffs
    ...band(5, 0, accent), // sash
  ];
}

/** One cached palette texture per assistant accent (module lifetime). */
const npcPaletteCache = new Map<string, Texture>();

/** The (cached) android palette texture for `accent`. Never dispose it. */
export function getNpcTexture(accent: string, source: Texture): Texture {
  const cached = npcPaletteCache.get(accent);
  if (cached) return cached;
  const built = buildPaletteTexture(androidCells(accent), source);
  npcPaletteCache.set(accent, built);
  return built;
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
  mesh.frustumCulled = false; // bone-attached (same rationale as the crown)
  return mesh;
}

/**
 * Attach the glowing halo antenna to the clone's head bone (발주자 확정: 이마
 * 바이저 바는 제거, 머리 위 링만). Head-local anchors derive from the crown
 * constants' frame (head top ≈ y 0.9). Materials are per-avatar clones pushed
 * into `out`.
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

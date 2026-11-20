import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  AdditiveBlending,
  AmbientLight,
  Color,
  DataTexture,
  DoubleSide,
  EquirectangularReflectionMapping,
  HalfFloatType,
  LinearFilter,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PMREMGenerator,
  RGBAFormat,
  ShaderMaterial,
  Vector2,
  Vector3,
  Vector4,
  DataUtils,
  type Material,
  type Object3D,
  type Texture,
  type WebGLRenderer,
} from "three";
import { lotRoomOf, lotRoomPoint, lotRoomSolids, type LotRoom } from "@caysonverse/shared/village/villageLots";
import type { Pose } from "../../game/types";
import { useQualityTier } from "../../game/QualityEffects";
import { compileSafely } from "../../game/compileSafely";
import { setSeatSightBlocker, setSeatSpotBlocker } from "../../game/seatFraming";
import { setCameraSolids } from "../../game/cameraSolids";
import { viewState } from "../../game/viewState";
import { CAMERA, HEAD_HEIGHT } from "../../game/constants";
import { normalizeAngle } from "../../game/yaw";
import { buildSolidIndex, type SolidIndex } from "../hallSolidIndex";
import { solidTriangles } from "../houseModelPrep";
import { beginHouseEntry, houseEntryReady, houseEntryState } from "../houseEntry";
import { dayNight } from "../dayNightDriver";
import { versionedUrl } from "../modelUrl";
import { lotGltfLoader, loadManifestMaps, disposeLoadedLots } from "./lotsLoader";
import { WINDOW_VIEWS, gardenWindow, windowViewWeights } from "./gardenWindow";
import { LOT_ROOM_LIGHT } from "../DayNight";
import { applyLotTextures, drawnTris, lotSurfaceMaterial } from "./lotsPrep";
import { roomBaked } from "./roomBaked";
import { LotTextureBank, capMips, fetchLotManifest, loadLotOwnMap, manifestPaths, type LotMatSpec } from "./lotTextures";

/**
 * A lot building's walk-in room (lots v2, contract 11; L5v2): `models/village/lots/<unit>.glb` (the phone's `<unit>_phone.glb` where
 * B2 made one), read only when the local player comes near its door or is inside, kept 60 s after leaving. Its model sits at the
 * room's game origin (`LotRoom.shift`: three rooms moved out of the houses' block). Dressed here:
 *  - `LM_*` surfaces: the library sets in full (the room's own bank), lit by the room's light (the indoor key and sky turned down for a
 *    lit interior, a warm fill, the rooms' lamps as point lights — the stand-in for L6's bake, as the builders' look-dev pages).
 *  - the sacred props (`asset.extras.sacred`: statues, stained glass, the 탱화) at their anchors, PC or phone file; glass draws only
 *    its `drawOnly` node; its glow follows the daylight.
 *  - `M_lightpool` (the stained glass's coloured sun on the floor): additive, its strength the daylight's.
 *  - `fire__` (hearth, candles): an additive flame shader flickering 0.6–1.2 Hz with a 7 Hz jitter, its point light in step.
 *  - `M_screen` (the garden and sky behind the windows): unlit, darker at night; `lotnight__` lamps glow at night.
 * The camera keeps to the drawn room (its solid index: never in a wall, a stack or a pew), and arrives looking into the room.
 */

/**
 * Each room's texture plan (owner budgets, contract 11 + coordinator 2026-11-17: classroom 24 MB, reading room 32, chapel 28, church 28,
 * 대웅전 48 on a PC; the phone's 8 / 10 / 8 / 8 / 14): on a PC every set in full at 1K except the listed small parts (their albedo
 * only: a 1.4 MB map instead of 4.2 MB); on a phone every set as its albedo only (0.7 MB) except the floor (and the 대웅전's 마루)
 * that fills the view. `LotRoom` reports the total (`__cvLotRoom().textures`, the sacred pieces' own maps included).
 * With the baked light (L6) the painted plaster is albedo-only on a PC too: the lightmap carries the walls' shading, and
 * its two 1K maps (2.8 MB) fit the same budgets.
 */
export const ROOM_TEXTURES: Readonly<Record<string, { pcAlbedoOnly: readonly string[]; phoneFull: readonly string[]; pc2k?: readonly string[] }>> = {
  // the classroom (owner 2026-11-20 "학교 내부가 너무 허접하네 좀 실감나게"): the pupils' beech desks and chairs read from a metre —
  // the oak set's 2048 albedo on a PC; the powder-coated frames, the brushed metal and the grass leaves are small parts: albedo only
  lot_school_class: { pcAlbedoOnly: ["grass", "cast_iron", "plaster_painted", "steel_painted", "aluminium_brushed"], phoneFull: ["floor_wood"], pc2k: ["wood_oak"] },
  // the reading room (owner 2026-11-20 "고해상도로 선명하게, 흐릿하게 보이는건 없어야 해"): on a PC the oak (bookcases, panelling,
  // tables), the floor and the fireplace's limestone read at eye level from a metre: their 2048 albedo (1100 px/m on the oak's 1.83 m
  // tile, was 560), the rest 1K; the painted wood (book spines before 2026-11-20) is now only frames: albedo only
  lot_library_reading: { pcAlbedoOnly: ["aluminium_brushed", "wood_painted", "plaster_painted"], phoneFull: ["floor_wood"], pc2k: ["wood_oak", "floor_wood", "stone_ashlar"] },
  lot_chapel_nave: { pcAlbedoOnly: ["aluminium_brushed", "plaster_painted"], phoneFull: [] }, // (the phone's chapel: its statues' own maps take the rest of the 8 MB)
  lot_church_nave: { pcAlbedoOnly: ["plaster_painted"], phoneFull: [] }, // (the phone's church: its lightmap carries the floor)
  lot_temple_hall: { pcAlbedoOnly: [], phoneFull: ["wood_pine_natural"] },
};

/** The tier a room set's near maps are read at: 2K for a PC room's close-up sets (`pc2k`), else 1K. */
export function roomSetTier(unit: string, set: string, phone: boolean): "2k" | "1k" {
  return !phone && ROOM_TEXTURES[unit]?.pc2k?.includes(set) ? "2k" : "1k";
}

/** Anisotropic filtering of a room's library sets (PC: 16, the most a desktop GPU offers; phone: 4 — its GPU's bandwidth). */
export const ROOM_ANISOTROPY = { desktop: 16, mobile: 4 } as const;

/** A room's own atlases on a phone (the reading room's 2048 books and rugs): colour 1024, normal / ORM 512 (top mips dropped). */
export const ROOM_OWN_PHONE_MAX = { color: 1024, detail: 512 } as const;

/**
 * A room's own atlas that keeps more on a phone: the classroom's 4096 atlas of sixteen children's drawings (1024 px a sheet on a
 * PC) at 2048 — 512 px a 39 cm sheet, still crisp on a phone's screen from a metre (at 1024 the crayon and the names were mush).
 */
export const ROOM_OWN_PHONE_MAX_BY_MAT: Readonly<Record<string, number>> = { M_school_art: 2048 };

/** A room's lightmaps on a phone: their top mips dropped to this size (the 2048 bakes; 1024 is still 2 cm a texel). */
export const ROOM_LIGHTMAP_PHONE_MAX = 1024;

/** The windows' village panoramas on a phone (3072 x 1536 on a PC): 1536 wide, ~8.5 texels a degree round the eye-level band. */
export const WINDOW_VIEW_PHONE_MAX = 1536;

/**
 * Rooms drawn at a higher pixel ratio on a phone than the light tier's 1 (the village keeps 1: 100 players, no stutter): the
 * reading room's spines, gilt and wood grain at dpr 1 on a 3x phone were a third of the screen's pixels — soft. A room is a small
 * scene (no village behind it), so 1.5 costs little.
 */
export const ROOM_PHONE_DPR: Readonly<Record<string, number>> = { lot_library_reading: 1.5, lot_school_class: 1.5 };

function roomSetFull(unit: string, set: string, phone: boolean): boolean {
  const plan = ROOM_TEXTURES[unit];
  if (!plan) return !phone;
  return phone ? plan.phoneFull.includes(set) : !plan.pcAlbedoOnly.includes(set);
}

/** Estimated GPU bytes of a room's own and sacred maps (compressed: 1 byte a texel on a desktop, 0.5–1 on a phone; mips 4/3). */
function ownTextureBytes(root: Object3D, mobile: boolean): number {
  const seen = new Set<Texture>();
  let bytes = 0;
  root.traverse((o) => {
    if (!isMesh(o) || !o.visible) return;
    for (const m of matsOf(o))
      for (const k of ["map", "normalMap", "aoMap", "roughnessMap", "metalnessMap", "emissiveMap", "lightMap", "lmNight"] as const) {
        // (the baked light, L6: the day map on lightMap, the night one beside it — counted for every material, a set's too)
        const t = k === "lmNight" ? ((m as MeshStandardMaterial).userData.lmNight as Texture | undefined) : (m as MeshStandardMaterial)[k];
        if (!t || seen.has(t) || ((m as MeshStandardMaterial).userData.lotSet && k !== "lightMap" && k !== "lmNight")) continue;
        seen.add(t);
        const img = (t as Texture & { mipmaps?: Array<{ width: number; height: number }> }).mipmaps?.[0] ?? (t.image as { width?: number; height?: number } | null);
        if (!img?.width || !img.height) continue;
        bytes += img.width * img.height * (mobile && k === "map" ? 0.5 : 1) * (4 / 3);
      }
  });
  return Math.round(bytes);
}

/**
 * The largest a sacred piece's own map is drawn (texels on its long side), by kind (colour: albedo and the glass's
 * emissive; normal; ORM: ambient occlusion, roughness, metalness) and tier. The pieces' files carry 2048 px statues and
 * 768x2000 lancets: the chapel's eight came to 56 MB of a 28 MB room (L5v2 budget pass). A KTX2 map keeps its mips, so
 * the cap only drops the levels above it (no re-encode, no new file); a piece is seen from a few metres, where 1024 /
 * 512 is still 300+ px a metre (the ORM's soft shading the least of it: 256).
 */
type SacredCap = { color: number; normal: number; orm: number };
export const SACRED_MAP_MAX: { desktop: SacredCap; mobile: SacredCap } = {
  desktop: { color: 1024, normal: 512, orm: 256 },
  mobile: { color: 1024, normal: 256, orm: 256 },
};

/**
 * Rooms whose sacred pieces are the point of the room get a higher cap (owner 2026-11-18: "고해상도로 선명하게"): the 대웅전's 본존불, 협시보살
 * and 탱화 keep their full maps on a desktop (colour up to 3072 for the 탱화, normal 2048), 1024 / 1024 on a phone (the room's GPU budget has the room: 48 / 14 MB).
 */
export const SACRED_MAP_MAX_BY_UNIT: Record<string, { desktop: SacredCap; mobile: SacredCap }> = {
  lot_temple_hall: {
    desktop: { color: 3072, normal: 2048, orm: 512 },
    mobile: { color: 1024, normal: 1024, orm: 256 },
  },
};

/**
 * The gilt statues, the halo and the scroll fittings reflect a small HDR panorama of the hall (128 x 64 half floats, prefiltered once by a
 * PMREM generator that is kept, never disposed: disposing one in the middle of a room load frees programs under the loader's compile poll,
 * a TypeError in three's timer). A metal has nothing to reflect in a room without an environment map, so burnished gold read as dry ochre
 * (owner 2026-11-18: "진짜 입체적으로 … 실제 새것같은 질감"). The first version was an 8-bit panorama (radiance <= 1: the reflections
 * came out too dark to see even at envMapIntensity 30); this one holds real radiances: the paper doors and lamps at 1.5..3, the lacquered
 * walls and floor around 0.4..0.8. Only the sacred gilt carries it: the dancheong, the paintings and the room's own surfaces do not.
 */
const SACRED_ENV_W = 128;
const SACRED_ENV_INTENSITY = 0.45;
/**
 * The 본존불's own polished gilt bronze reflects the hall harder (2026-11-18 v2, owner "방 안 금빛도 살려": at 0.45 the statue read as dull
 * ochre in the hall's even light). Only its material (`…_buddha_gilt`): the 광배 stays at 0.45 (at 0.9 it burned white).
 */
const SACRED_STATUE_ENV_INTENSITY = 1.5;
/** The 본존불's warm fill (emissive x its own colour map; linear). */
const SACRED_STATUE_FILL = new Color(0.16, 0.12, 0.06);
const sacredEnvs = new WeakMap<WebGLRenderer, { pm: PMREMGenerator; tex: Texture }>();
/** The hall seen from the altar, linear radiance per direction (room frame: the door wall toward -z, y up). */
function hallRadiance(x: number, y: number, z: number): [number, number, number] {
  if (y > 0.55) {
    const lamp = Math.sin(Math.atan2(z, x) * 6) > 0.8 && y < 0.9;
    return lamp ? [3.2, 2.4, 1.4] : [0.10, 0.28, 0.25];
  }
  if (y < -0.25) return [0.6, 0.4, 0.22]; // the pine floor
  if (z < -0.3) return y > 0.12 ? [0.6, 0.85, 0.8] : [1.7, 1.55, 1.3]; // the paper doors toward the visitor (daylight), a blue-green transom
  return y > 0.0 ? [0.55, 0.14, 0.08] : [0.8, 0.66, 0.46]; // the lacquered walls over the plaster
}
function sacredEnv(gl: WebGLRenderer): Texture {
  const have = sacredEnvs.get(gl);
  if (have) return have.tex;
  const w = SACRED_ENV_W;
  const h = w / 2;
  const data = new Uint16Array(w * h * 4);
  for (let j = 0; j < h; j++) {
    const lat = ((j + 0.5) / h - 0.5) * Math.PI; // row 0 = straight down (flipY false)
    for (let i = 0; i < w; i++) {
      const lon = ((i + 0.5) / w - 0.5) * Math.PI * 2;
      const [r, g, b] = hallRadiance(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon));
      const k = (j * w + i) * 4;
      data[k] = DataUtils.toHalfFloat(r);
      data[k + 1] = DataUtils.toHalfFloat(g);
      data[k + 2] = DataUtils.toHalfFloat(b);
      data[k + 3] = DataUtils.toHalfFloat(1);
    }
  }
  const eq = new DataTexture(data, w, h, RGBAFormat, HalfFloatType);
  eq.mapping = EquirectangularReflectionMapping;
  eq.magFilter = LinearFilter;
  eq.minFilter = LinearFilter;
  eq.needsUpdate = true;
  const pm = new PMREMGenerator(gl);
  const rt = pm.fromEquirectangular(eq);
  eq.dispose();
  sacredEnvs.set(gl, { pm, tex: rt.texture });
  return rt.texture;
}

/**
 * The hero pieces (the statues and the framed prints: what a visitor walks up to and looks at from arm's length) keep their
 * 2K maps: at the budget caps above a 2048 normal map reached the screen as 512 (the marble's folds and the faces read as
 * soft clay). A phone keeps 1K colour and normal (the phone files carry 1K maps; the pieces are few).
 */
export const SACRED_HERO_MAP_MAX = {
  desktop: { color: 2048, normal: 2048, orm: 1024 },
  mobile: { color: 1024, normal: 1024, orm: 512 },
} as const;

/** The map caps of a sacred piece by its anchor's node name: the hero pieces (statues, framed art) keep more than the rest. */
export function sacredCaps(node: string, phone: boolean): { color: number; normal: number; orm: number } {
  const tier = phone ? "mobile" : "desktop";
  // the saints stand at the side: the budget caps; the 14 stations are small prints seen one or two at a time (768 px a long side is 1.8x the screen)
  // Mary: the 2K normal map carries the face and the folds; the marble's colour is soft (1K); the crucifix (a wood scan, seen from 3 m+): 1K normal
  if (node === "lotstatue__lot_chapel_nave_mary") return { ...SACRED_HERO_MAP_MAX[tier], color: 1024, orm: phone ? 256 : 512 };
  if (node === "lotstatue__lot_chapel_nave_crucifix") return { color: 1024, normal: 1024, orm: 512 };
  if (node.startsWith("lotart__lot_chapel_nave_station")) return { ...SACRED_MAP_MAX[tier], color: phone ? 512 : 768 };
  if (node.startsWith("lotart__lot_church_nave_")) return { ...SACRED_MAP_MAX[tier], color: phone ? 768 : 1024 };
  return SACRED_MAP_MAX[tier];
}

/** Whether a sacred piece takes anisotropic reads (everything but the glass). */
export function isSacredHero(node: string): boolean {
  return /^lot(statue|art)__lot_(chapel|church)_nave_/.test(node);
}

export { capMips } from "./lotTextures";

/** The rooms with a phone file (`<unit>_phone.glb`): B2's chapel and church, and the classroom (b1 `--phone`, 2026-11-20: the same
 * room and atlases with lighter geometry — 33k triangles, 29 draws). */
export const LOT_ROOM_PHONE_FILES: ReadonlySet<string> = new Set(["lot_chapel_nave", "lot_church_nave", "lot_school_class", "lot_library_reading"]);

/** How long (ms) a room's files stay after leaving it (a quick look outside and back in reads nothing again). */
export const LOT_ROOM_KEEP_MS = 60_000;
/** How near a room's door (m) its files start to come (they are usually in by the time the curtain lifts). */
export const LOT_ROOM_PREFETCH_M = 7;

interface SacredEntry {
  node: string;
  file: string;
  phoneFile?: string;
  /** B2: whether the phone draws it; B3: the phone file's path. */
  phone?: boolean | string;
  drawOnly?: string;
  showOnly?: string;
  hidePrefix?: string;
  mirrorX?: boolean;
  glass?: { emissiveIntensity?: { day: number; night: number } };
}

/** A sacred prop's file as a URL (B2 writes `lots/sacred/…` from models/village/, B3 `sacred/…` from models/village/lots/). */
export function sacredUrl(path: string): string {
  return versionedUrl(path.startsWith("lots/") ? `/models/village/${path}` : `/models/village/lots/${path}`);
}

/** The file a tier reads for a sacred prop, or null when the phone leaves it out. */
export function sacredFile(s: SacredEntry, phone: boolean): string | null {
  if (!phone) return s.file;
  if (s.phone === false) return null;
  if (typeof s.phone === "string") return s.phone;
  return s.phoneFile ?? s.file;
}

/** The room's lamps standing in for L6's bake (room frame): points [x, y, z, colour, intensity, distance], spots [x, y, z, tx, ty, tz, colour, intensity]. */
interface RoomLights {
  ambient: [string, number, number];
  /** The fire's light (room frame; the model's `fire__<unit>_light` moves it on load). */
  fire?: [number, number, number];
  points: Array<[number, number, number, string, number, number]>;
  spots: Array<[number, number, number, number, number, number, string, number]>;
}
/**
 * A per-room colour grade on the lit surfaces (a multiply, linear): the chapel's honey stone under a warm bake and warm lamps read
 * orange all over (the paintings and the stained glass lost their true colours); a slight cool pull brings the room to a neutral cream.
 */
/**
 * Triangles of a room's small goods that a sacred prop now replaces (room frame boxes [x0, x1, y0, y1, z0, z1]): the chapel's
 * low-poly flowers (the lilies and roses are real petals now), the church organ's flat pipes. Applied to the `_goods` mesh.
 */
export const ROOM_STRIP: Readonly<Record<string, ReadonlyArray<readonly [number, number, number, number, number, number]>>> = {
  lot_chapel_nave: [
    [3.85, 4.25, 1.17, 1.95, 12.65, 13.05], [5.15, 5.55, 1.17, 1.95, 12.65, 13.05], // the altar's vases
    [0.23, 0.53, 1.04, 1.7, 9.5, 9.8], [0.67, 0.97, 1.04, 1.7, 9.5, 9.8], [8.43, 8.73, 1.04, 1.7, 9.5, 9.8], [8.87, 9.17, 1.04, 1.7, 9.5, 9.8], // the side altars'
    [2.35, 3.15, 1.4, 2.4, 12.15, 12.95], [6.25, 7.05, 1.4, 2.4, 10.85, 11.65], // the urns' arrangements
  ],
  lot_church_nave: [[7.3, 7.5, 1.24, 2.8, 7.6, 8.4]],
};

/** Drops the triangles whose centre is in one of the boxes from a room's goods meshes (a no-op when there are none). */
export function stripRoomGoods(scene: Object3D, unit: string, origin: { x: number; z: number }): number {
  const boxes = ROOM_STRIP[unit];
  if (!boxes) return 0;
  let dropped = 0;
  scene.traverse((o) => {
    if (!isMesh(o) || !o.name.includes("_goods")) return;
    const g = o.geometry;
    const idx = g.getIndex();
    const pos = g.getAttribute("position");
    if (!idx || !pos) return;
    g.computeBoundingBox();
    const ox = g.boundingBox && g.boundingBox.min.x > 100 ? origin.x : 0;
    const oz = g.boundingBox && g.boundingBox.min.x > 100 ? origin.z : 0;
    const keep: number[] = [];
    const groups: Array<{ start: number; count: number; materialIndex: number }> = [];
    const ranges = g.groups.length ? g.groups.map((r) => ({ start: r.start, end: r.start + r.count, materialIndex: r.materialIndex ?? 0 })) : [{ start: 0, end: idx.count, materialIndex: 0 }];
    for (const r of ranges) {
      const first = keep.length;
      for (let i = r.start; i < r.end; i += 3) {
        let cx = 0, cy = 0, cz = 0;
        for (let k = 0; k < 3; k++) {
          const v = idx.getX(i + k);
          cx += pos.getX(v); cy += pos.getY(v); cz += pos.getZ(v);
        }
        cx = cx / 3 - ox; cy /= 3; cz = cz / 3 - oz;
        if (boxes.some((bx) => cx >= bx[0] && cx <= bx[1] && cy >= bx[2] && cy <= bx[3] && cz >= bx[4] && cz <= bx[5])) dropped++;
        else keep.push(idx.getX(i), idx.getX(i + 1), idx.getX(i + 2));
      }
      groups.push({ start: first, count: keep.length - first, materialIndex: r.materialIndex });
    }
    if (keep.length !== idx.count) {
      g.setIndex(keep);
      g.clearGroups();
      if (ranges.length > 1 || g.groups.length) for (const r of groups) g.addGroup(r.start, r.count, r.materialIndex);
    }
  });
  return dropped;
}

export const ROOM_GRADE: Readonly<Record<string, readonly [number, number, number]>> = { lot_chapel_nave: [0.80, 0.93, 1.18] };

const ROOM_LIGHTS: Record<string, RoomLights> = {
  lot_school_class: { ambient: ["#fff4e6", 0.55, 0.28], points: [[5.2, 3.2, 5, "#fff1dc", 6, 9], [10.4, 3.2, 5, "#fff1dc", 6, 9]], spots: [] },
  lot_library_reading: { fire: [6.7, 0.61, 9.93], ambient: ["#fff0dc", 0.5, 0.24], points: [[4.5, 4.2, 5.5, "#ffd9a6", 7, 9], [9, 4.2, 5.5, "#ffd9a6", 7, 9]], spots: [] },
  lot_chapel_nave: {
    fire: [4.7, 1.6, 11.9],
    ambient: ["#f3efe9", 0.6, 0.35],
    points: [[4.7, 3.9, 5.1, "#ffdcb4", 9, 9], [4.7, 3.9, 8.5, "#ffdcb4", 9, 9], [4.7, 5.3, 1.4, "#ffe0b8", 2.5, 6]],
    spots: [[4.7, 7.0, 9.4, 4.7, 2.2, 12.6, "#ffe0b8", 60], [3.2, 5.2, 7.25, 0.6, 1.75, 9.85, "#ffe4c4", 30], [6.2, 5.2, 7.25, 8.8, 1.75, 9.85, "#ffe4c4", 30]],
  },
  lot_church_nave: { fire: [3.9, 1.4, 9.6], ambient: ["#ffe9d0", 0.6, 0.35], points: [[3.9, 3.6, 3.6, "#ffcf96", 7, 8], [3.9, 3.6, 6.9, "#ffcf96", 7, 8]], spots: [[3.9, 5.6, 6.6, 3.9, 3.2, 10.4, "#fff0d8", 40]] },
  lot_temple_hall: {
    ambient: ["#ffe6c8", 0.6, 0.35],
    points: [[5.7, 2.6, 1.2, "#fff2dc", 30, 14], [4.45, 1.7, 5.15, "#ffb466", 1.8, 3], [6.95, 1.7, 5.15, "#ffb466", 1.8, 3]],
    spots: [[5.7, 4.6, 3.6, 5.7, 2.4, 6.5, "#ffd9a0", 60], [3.4, 4.2, 4.0, 3.4, 2.4, 6.5, "#ffd9a0", 22], [8.0, 4.2, 4.0, 8.0, 2.4, 6.5, "#ffd9a0", 22]],
  },
};

/** The flame cards (M_fire, B1/B2 hook): additive, unlit; COLOR_0 rgb = colour, a = soft edge; uv.y = height up the flame. */
const FIRE_VERT = /* glsl */ `
varying vec4 vC;
varying vec2 vUv;
void main() {
#ifdef USE_COLOR_ALPHA
  vC = color;
#elif defined( USE_COLOR )
  vC = vec4( color, 1.0 );
#else
  vC = vec4( 1.0 );
#endif
  vUv = uv;
  vec4 p = vec4( position, 1.0 );
#ifdef USE_INSTANCING
  p = instanceMatrix * p;
#endif
  gl_Position = projectionMatrix * modelViewMatrix * p;
}`;
const FIRE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uGain;
varying vec4 vC;
varying vec2 vUv;
float h21( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float vnoise( vec2 p ) {
  vec2 i = floor( p ); vec2 f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( h21( i ), h21( i + vec2( 1.0, 0.0 ) ), f.x ), mix( h21( i + vec2( 0.0, 1.0 ) ), h21( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
void main() {
  float y = clamp( vUv.y, 0.0, 1.0 );
  // noise flowing up the flame (its tongues), the slow breath and the quick jitter
  float n = vnoise( vec2( vUv.x * 2.6 + gl_FragCoord.x * 0.0005, y * 3.2 - uTime * 1.9 ) );
  float n2 = vnoise( vec2( vUv.x * 5.0, y * 6.0 - uTime * 3.7 ) + 7.3 );
  float breath = 0.82 + 0.12 * sin( uTime * 5.65 ) + 0.06 * sin( uTime * 44.0 + vUv.x * 3.0 );
  float tongue = smoothstep( 1.05, 0.15, y + ( n - 0.5 ) * 0.55 + ( n2 - 0.5 ) * 0.25 );
  float a = vC.a * tongue * breath;
  vec3 c = vC.rgb * ( 1.15 - 0.45 * y ) * ( 0.85 + 0.3 * n2 );
  gl_FragColor = vec4( c * a * uGain, a );
}`;

/** The hearth's flicker lamp's strength (the M_fire hook: 2200 K, ~180 cd, in the scene's light units). */
const FIRE_INTENSITY = 2.4;

/**
 * The room's lamps as a term of its own materials (no three.js lights): per lamp a position and range (vec4), a direction and the cosine
 * of its cone (vec4; −2 for a point lamp) and a colour × strength (vec3, set each frame: the night's lamps, the fire's flicker).
 */
export interface RoomLamps {
  pos: { value: Vector4[] };
  dir: { value: Vector4[] };
  col: { value: Vector3[] };
  colour: Color[];
  base: number[];
  /** The fire's lamp (index), −1 for none. */
  fire: number;
}

function roomLamps(room: LotRoom, phone: boolean, fireAt: Vector3 | null): RoomLamps {
  const L = ROOM_LIGHTS[room.unit.id];
  const lamps: RoomLamps = { pos: { value: [] }, dir: { value: [] }, col: { value: [] }, colour: [], base: [], fire: -1 };
  const add = (p: { x: number; z: number }, y: number, colour: string, k: number, range: number, dir: Vector4) => {
    lamps.pos.value.push(new Vector4(p.x, y, p.z, range));
    lamps.dir.value.push(dir);
    lamps.colour.push(new Color(colour));
    lamps.col.value.push(new Vector3());
    lamps.base.push(k);
  };
  if (L) {
    // the phone keeps two lamps and the fire (each is a loop step in every lit fragment)
    for (const [x, y, z, col, k, d] of phone ? L.points.slice(0, 2) : L.points) add(lotRoomPoint(room, x, z), y, col, k, d, new Vector4(0, -1, 0, -2));
    if (!phone)
      for (const [x, y, z, tx, ty, tz, col, k] of L.spots) {
        const d = new Vector3(tx - x, ty - y, tz - z).normalize();
        add(lotRoomPoint(room, x, z), y, col, k, 12, new Vector4(d.x, d.y, d.z, Math.cos(Math.PI / 7)));
      }
  }
  if (fireAt) {
    lamps.fire = lamps.base.length;
    add({ x: fireAt.x, z: fireAt.z }, fireAt.y, "#ff9a4a", FIRE_INTENSITY, 6, new Vector4(0, -1, 0, -2));
  }
  return lamps;
}

const LAMP_VERT_PARS = /* glsl */ `
varying vec3 vRoomWorld;
varying vec3 vRoomNormal;
void main() {`;
const LAMP_VERT = /* glsl */ `#include <project_vertex>
{
  vec4 rw = vec4( transformed, 1.0 );
  vec3 rn = objectNormal;
#ifdef USE_INSTANCING
  rw = instanceMatrix * rw;
  rn = mat3( instanceMatrix ) * rn;
#endif
  vRoomWorld = ( modelMatrix * rw ).xyz;
  vRoomNormal = normalize( mat3( modelMatrix ) * rn );
}`;
const LAMP_FRAG_PARS = (n: number) => /* glsl */ `
#define ROOM_LAMPS ${n}
uniform vec4 uRoomLampPos[ ROOM_LAMPS ];
uniform vec4 uRoomLampDir[ ROOM_LAMPS ];
uniform vec3 uRoomLampCol[ ROOM_LAMPS ];
varying vec3 vRoomWorld;
varying vec3 vRoomNormal;
void main() {`;
const LAMP_FRAG = /* glsl */ `#include <lights_fragment_end>
{
  vec3 rN = normalize( vRoomNormal );
  vec3 rV = normalize( cameraPosition - vRoomWorld );
  vec3 rSum = vec3( 0.0 );
  vec3 rSpec = vec3( 0.0 );
  PhysicalMaterial rLobe = material;
  rLobe.roughness = max( material.roughness, 0.55 );
  for ( int i = 0; i < ROOM_LAMPS; i ++ ) {
    vec3 Ld = uRoomLampPos[ i ].xyz - vRoomWorld;
    float d = length( Ld );
    vec3 Ln = Ld / max( d, 1e-4 );
    float range = uRoomLampPos[ i ].w;
    float fall = pow( clamp( 1.0 - pow( d / range, 4.0 ), 0.0, 1.0 ), 2.0 ) / max( pow( d, 1.6 ), 0.01 );
    vec4 sd = uRoomLampDir[ i ];
    float cone = sd.w < -1.5 ? 1.0 : smoothstep( sd.w, mix( sd.w, 1.0, 0.6 ), dot( -Ln, sd.xyz ) );
    vec3 rIn = uRoomLampCol[ i ] * fall * cone * max( dot( rN, Ln ), 0.0 );
    rSum += rIn;
    // a metal takes a lamp as a highlight, not as diffuse light (2026-11-18: with the albedo as diffuse every gilt statue lit up flat,
    // like matte ochre paint); dielectrics are unchanged
    // (a broad lobe: the lamps' intensities are tuned for diffuse light, and a sharp GGX peak from them bloomed the whole altar)
    rSpec += rIn * BRDF_GGX( Ln, rV, rN, rLobe ) * ( 0.35 * metalnessFactor );
  }
  reflectedLight.directDiffuse += rSum * material.diffuseContribution * RECIPROCAL_PI;
  reflectedLight.directSpecular += rSpec;
}`;

/** A room material lit by its lamps too (once per material; the program key carries the lamp count). */
function patchRoomLamps(m: MeshStandardMaterial, lamps: RoomLamps): void {
  const n = lamps.base.length;
  if (n === 0 || m.userData.roomLamps) return;
  m.userData.roomLamps = true;
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, r) => {
    prev?.call(m, shader, r);
    shader.uniforms.uRoomLampPos = lamps.pos;
    shader.uniforms.uRoomLampDir = lamps.dir;
    shader.uniforms.uRoomLampCol = lamps.col;
    shader.vertexShader = shader.vertexShader.replace("void main() {", LAMP_VERT_PARS).replace("#include <project_vertex>", LAMP_VERT);
    shader.fragmentShader = shader.fragmentShader.replace("void main() {", LAMP_FRAG_PARS(n)).replace("#include <lights_fragment_end>", LAMP_FRAG);
  };
  const key = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => `${key()}|roomlamps${n}`;
  m.needsUpdate = true;
}

/** A room's baked light (L6, bake_lots.py): GLB extras `lightmap`, irradiance = (texel, linear) x `scale` on TEXCOORD_1. */
export interface RoomLightmapSpec {
  day: string;
  night: string;
  scale: number;
  channel?: number;
}
/**
 * How much of the baked irradiance a lit surface takes (the bake's units are Cycles' diffuse irradiance; the game's
 * lights stay on top of it: the sun's key through the windows, the lamps' and the fire's moving part).
 */
export const LIGHTMAP_GAIN = 0.8;
/** The longest the entry cover waits for the room's programs (ms): a slow phone still gets in. */
export const ROOM_COMPILE_WAIT_MS = 2500;
/** The room's ambient fill with a lightmap in (the bake carries the bounce): this share of the unbaked fill. */
export const LIGHTMAP_AMBIENT = 0.3;

/**
 * The day map on `lightMap` (channel 1) and the night map mixed in by one uniform (`mix`: 0 day .. 1 night), in the
 * lightmap chunk itself: one program for day and night, nothing recompiles as the light changes.
 */
export function patchLightmapMix(m: MeshStandardMaterial, night: Texture, mix: { value: number }): void {
  if (m.userData.lightmapMix) return;
  m.userData.lightmapMix = true;
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, r) => {
    prev?.call(m, shader, r);
    shader.uniforms.uLmNight = { value: night };
    shader.uniforms.uLmMix = mix;
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", "uniform sampler2D uLmNight;\nuniform float uLmMix;\nvoid main() {")
      .replace(
        "#include <lights_fragment_maps>",
        `#if defined( RE_IndirectDiffuse ) && defined( USE_LIGHTMAP )
  irradiance += mix( texture2D( lightMap, vLightMapUv ).rgb, texture2D( uLmNight, vLightMapUv ).rgb, uLmMix ) * lightMapIntensity;
#endif
#undef USE_LIGHTMAP
#include <lights_fragment_maps>`,
      );
  };
  const key = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => `${key()}|lmmix`;
  m.needsUpdate = true;
}

export interface LoadedRoom {
  unit: string;
  root: Group;
  bank: LotTextureBank;
  own: Texture[];
  materials: Material[];
  surfaces: MeshStandardMaterial[];
  lightpools: MeshBasicMaterial[];
  screens: MeshBasicMaterial[];
  glow: MeshBasicMaterial;
  glass: Array<{ m: MeshStandardMaterial; day: number; night: number }>;
  fire: ShaderMaterial | null;
  fireLight: Vector3 | null;
  lamps: RoomLamps;
  /** The baked light's day/night mix (null: the room has no lightmap, or the phone's file). */
  lightmap: { mix: { value: number } } | null;
  solid: SolidIndex;
  stats: { triangles: number; draws: number; sacred: number; sacredTriangles: number; file: string; phone: boolean };
}

function isMesh(o: Object3D): o is Mesh {
  return (o as Mesh).isMesh === true;
}
const matsOf = (m: Mesh): Material[] => (Array.isArray(m.material) ? m.material : [m.material]);

async function loadRoom(room: LotRoom, gl: WebGLRenderer, phone: boolean): Promise<LoadedRoom> {
  const unit = room.unit.id;
  const file = phone && LOT_ROOM_PHONE_FILES.has(unit) ? `${unit}_phone` : unit;
  const { loader, draco } = lotGltfLoader(gl);
  // (no staging: the room uploads everything under its entry cover, below)
  // the 1K tier in every room (a room is seen from a few metres: 1K over a set's 1.5–2 m tile is the 512 px/m the surfaces need), and the
  // room's texture plan for which sets come in full (albedo, normal, ORM) or as their albedo only (ROOM_TEXTURES)
  const bank = new LotTextureBank(gl, "1k", false, { tierOf: (set) => roomSetTier(unit, set, phone), anisotropy: phone ? ROOM_ANISOTROPY.mobile : ROOM_ANISOTROPY.desktop });
  try {
    const gltf = await loader.loadAsync(versionedUrl(`/models/village/lots/${file}.glb`));
    const extras = (gltf.parser.json as { asset?: { extras?: { textures?: unknown; sacred?: SacredEntry[]; lightmap?: RoomLightmapSpec } } }).asset?.extras ?? {};
    const manifests = await Promise.all(manifestPaths(extras.textures).map((p) => fetchLotManifest(p)));
    const { specs, own, ownExtra, textures } = await loadManifestMaps(manifests, gl, bank, (set) => roomSetFull(unit, set, phone));
    if (phone) {
      // a phone: the room's own atlases at most 1024 (their normal / ORM 512), 4x anisotropy
      for (const [name, t] of Object.entries(own)) {
        t.anisotropy = Math.min(t.anisotropy, ROOM_ANISOTROPY.mobile);
        capMips(t, specs[name]?.kind === "garden" ? WINDOW_VIEW_PHONE_MAX : ROOM_OWN_PHONE_MAX_BY_MAT[name] ?? ROOM_OWN_PHONE_MAX.color);
      }
      for (const x of Object.values(ownExtra))
        for (const t of [x.normal, x.orm]) {
          if (!t) continue;
          t.anisotropy = Math.min(t.anisotropy, ROOM_ANISOTROPY.mobile);
          capMips(t, ROOM_OWN_PHONE_MAX.detail);
        }
    }
    // the village behind the windows: the evening's and the night's panoramas (the day's is the manifest's own M_garden map)
    const view = WINDOW_VIEWS[unit];
    // (index-aligned with the keys after the day's: a key that failed to load stays undefined and shows the day's)
    const viewMaps: (Texture | undefined)[] = [];
    if (view) {
      const more = await Promise.allSettled(view.keys.slice(1).map((k) => loadLotOwnMap(gl, `/models/village/${k.file}`)));
      for (const r of more) {
        if (r.status !== "fulfilled") {
          console.error("[lots] window view", unit, r.reason);
          viewMaps.push(undefined);
          continue;
        }
        if (phone) {
          r.value.anisotropy = Math.min(r.value.anisotropy, ROOM_ANISOTROPY.mobile);
          capMips(r.value, WINDOW_VIEW_PHONE_MAX);
        }
        textures.push(r.value);
        viewMaps.push(r.value);
      }
    }
    const scene = gltf.scene;
    scene.updateMatrixWorld(true);
    stripRoomGoods(scene, unit, (extras as { origin?: { x: number; z: number } }).origin ?? { x: 0, z: 0 });
    // the baked light (L6): both maps or none
    let lm: { day: Texture; night: Texture; scale: number; mix: { value: number } } | null = null;
    if (extras.lightmap) {
      const spec = extras.lightmap;
      const maps = await Promise.allSettled([spec.day, spec.night].map((p) => loadLotOwnMap(gl, `/models/village/${p}`)));
      if (maps[0]!.status === "fulfilled" && maps[1]!.status === "fulfilled") {
        const [day, night] = [maps[0].value, maps[1].value];
        for (const t of [day, night]) {
          t.channel = spec.channel ?? 1;
          t.anisotropy = 1;
          if (phone) capMips(t, ROOM_LIGHTMAP_PHONE_MAX);
          textures.push(t);
        }
        lm = { day, night, scale: spec.scale, mix: { value: 0 } };
      } else console.error("[lots] lightmap", unit, maps);
    }

    // the sacred props, read alongside (each its own GLB with its own KTX2 maps)
    const sacred = (extras.sacred ?? []).flatMap((s) => {
      const f = sacredFile(s, phone);
      return f ? [{ s, f }] : [];
    });
    // each file read once: a piece the room shows more than once (the church's six clear lancets, the temple's two
    // bodhisattvas) is a copy of the first, sharing its maps (read once per anchor, the church's six were six sets of maps)
    const files = [...new Set(sacred.map(({ f }) => f))];
    const read = await Promise.allSettled(files.map((f) => loader.loadAsync(sacredUrl(f))));
    const firstUse = new Set<string>();
    const props: Array<PromiseSettledResult<{ scene: Group }>> = sacred.map(({ f }) => {
      const r = read[files.indexOf(f)]!;
      if (r.status !== "fulfilled") return r;
      const fresh = !firstUse.has(f);
      firstUse.add(f);
      // (copies are made before the first is dressed below: each starts from the file's own materials)
      return { status: "fulfilled", value: { scene: fresh ? r.value.scene : (r.value.scene.clone(true) as Group) } };
    });

    const materials: Material[] = [];
    const surfaces: MeshStandardMaterial[] = [];
    const lightpools: MeshBasicMaterial[] = [];
    const screens: MeshBasicMaterial[] = [];
    const glass: LoadedRoom["glass"] = [];
    const glow = new MeshBasicMaterial({ name: "lotroom_glow", vertexColors: true, toneMapped: false, transparent: true, depthWrite: false, opacity: 0 });
    materials.push(glow);
    let fire: ShaderMaterial | null = null;
    const made = new Map<string, Material>();
    const dressed = (src: Material, colours: boolean, baked = false): Material => {
      const key = `${src.name}|${colours ? "c" : "-"}|${baked ? "lm" : "-"}`;
      const hit = made.get(key);
      if (hit) return hit;
      const s = src as MeshStandardMaterial;
      const spec: LotMatSpec | undefined = specs[src.name];
      let m: Material;
      if (src.name.startsWith("LM_")) {
        const sm = lotSurfaceMaterial(s, spec, false);
        sm.vertexColors = colours;
        const grade = ROOM_GRADE[unit];
        if (grade) sm.color.multiply(new Color(grade[0], grade[1], grade[2]));
        applyLotTextures(sm, bank);
        if (baked && lm) {
          sm.lightMap = lm.day;
          sm.lightMapIntensity = lm.scale * LIGHTMAP_GAIN;
          sm.userData.lmNight = lm.night;
          patchLightmapMix(sm, lm.night, lm.mix);
        }
        surfaces.push(sm);
        m = sm;
      } else if (spec?.kind === "glass" || src.name === "M_glass") {
        m = new MeshStandardMaterial({ name: src.name, color: "#c9d6dc", roughness: 0.05, metalness: 0, transparent: true, opacity: 0.22, depthWrite: false });
      } else if (spec?.kind === "garden") {
        const b = gardenWindow([own[src.name], ...viewMaps], view, room.origin, 1 / LOT_ROOM_LIGHT.exposure);
        screens.push(b);
        m = b;
      } else if (spec?.kind === "screen") {
        const b = new MeshBasicMaterial({ name: src.name, vertexColors: colours, toneMapped: true });
        screens.push(b);
        m = b;
      } else if (spec?.kind === "lightpool" && own[src.name]) {
        const b = new MeshBasicMaterial({ name: src.name, map: own[src.name]!, transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -1 });
        lightpools.push(b);
        m = b;
      } else if (spec?.kind === "fire") {
        fire ??= new ShaderMaterial({
          name: "lotroom_fire",
          vertexShader: FIRE_VERT,
          fragmentShader: FIRE_FRAG,
          uniforms: { uTime: { value: 0 }, uGain: { value: 1 } },
          vertexColors: true,
          transparent: true,
          blending: AdditiveBlending,
          depthWrite: false,
          side: DoubleSide,
        });
        m = fire;
      } else if (spec?.kind === "own" && own[src.name]) {
        // an atlas of the room's own (paintings, the globe; the reading room's books and rugs): with its normal map and ORM when
        // it has them (the books' raised bands and tooling, the gilt's metal), COLOR_0 tinting when the manifest says so
        const extra = ownExtra[src.name] ?? {};
        const om = new MeshStandardMaterial({ name: src.name, map: own[src.name]!, roughness: 0.55, vertexColors: !!spec.vertexColor && colours, side: s.side });
        if (extra.normal) {
          om.normalMap = extra.normal;
          om.normalScale = new Vector2(1, -1); // glTF tangent space without tangents
        }
        if (extra.orm) {
          om.roughnessMap = extra.orm;
          om.metalnessMap = extra.orm;
          om.roughness = 1;
          om.metalness = 1;
        }
        m = om;
      } else {
        m = s.clone();
      }
      made.set(key, m);
      materials.push(m);
      return m;
    };
    let triangles = 0;
    let draws = 0;
    const drop: Object3D[] = [];
    scene.traverse((o) => {
      if (o.name.startsWith("col__")) {
        drop.push(o);
        return;
      }
      if (!isMesh(o)) return;
      const night = o.name.startsWith("lotnight__") || o.parent?.name.startsWith("lotnight__");
      if (night) {
        o.material = glow;
        o.renderOrder = 3;
        o.raycast = () => {};
      } else {
        const colours = !!o.geometry.getAttribute("color");
        const baked = !!lm && !!o.geometry.getAttribute("uv1");
        const ms = matsOf(o).map((m) => dressed(m, colours, baked));
        o.material = ms.length > 1 ? ms : ms[0]!;
        if (o.name.startsWith("fire__") || matsOf(o).some((m) => (m as Material).blending === AdditiveBlending)) o.raycast = () => {};
      }
      o.castShadow = false;
      o.receiveShadow = false;
      triangles += drawnTris(o);
      draws += matsOf(o).length;
    });
    for (const o of drop) o.parent?.remove(o);

    // the sacred props at their anchors
    let sacredTriangles = 0;
    const waits: Promise<unknown>[] = [];
    props.forEach((r, i) => {
      const { s } = sacred[i]!;
      const anchor = scene.getObjectByName(s.node);
      if (r.status !== "fulfilled" || !anchor) {
        if (r.status === "rejected") console.error(`[lots] ${s.node}`, r.reason);
        return;
      }
      const prop = r.value.scene;
      prop.traverse((o) => {
        if (!isMesh(o)) return;
        const base = o.name.replace(/_phone$/, "");
        if ((s.drawOnly && base !== s.drawOnly) || (s.hidePrefix && o.name.startsWith(s.hidePrefix) && o.name !== s.showOnly)) {
          o.visible = false;
          return;
        }
        const hero = isSacredHero(s.node);
        // the temple hall has its own (higher) caps per unit; the chapel / church heroes and prints have theirs per node
        const unitCap = SACRED_MAP_MAX_BY_UNIT[unit];
        const cap = unitCap ? unitCap[phone ? "mobile" : "desktop"] : sacredCaps(s.node, phone);
        const aniso = Math.min(16, gl.capabilities.getMaxAnisotropy());
        const out = matsOf(o).map((mat) => {
          let m = mat as MeshStandardMaterial;
          for (const k of ["map", "emissiveMap", "normalMap", "aoMap", "roughnessMap", "metalnessMap"] as const) {
            const t = m[k];
            if (!t) continue;
            capMips(t, k === "map" || k === "emissiveMap" ? cap.color : k === "normalMap" ? cap.normal : cap.orm);
            // sharp at a slant (a statue seen from the side, a painting along the wall): mips + anisotropic filtering
            if (unitCap || (hero && (k === "map" || k === "normalMap"))) t.anisotropy = Math.max(t.anisotropy, unitCap ? aniso : Math.min(8, aniso));
          }
          const set = /^M_pbr_(.+)$/.exec(m.name)?.[1];
          if (set) {
            // a library set by name (sacred.json: the file carries only a fallback colour and metre UVs)
            const sm = lotSurfaceMaterial(m, { pbr: set, roughnessScale: 1, normalScale: 1 }, false);
            sm.vertexColors = !!o.geometry.getAttribute("color");
            waits.push(bank.loadNear(set).then(() => applyLotTextures(sm, bank)));
            surfaces.push(sm);
            materials.push(sm);
            m = sm;
          }
          if (m.name.includes("gilt") || (s.node.startsWith("lotstatue__") && m.metalnessMap)) {
            m.envMap = sacredEnv(gl);
            m.envMapIntensity = /_buddha_gilt$/.test(m.name) ? SACRED_STATUE_ENV_INTENSITY : SACRED_ENV_INTENSITY;
          }
          if (/_buddha_gilt$/.test(m.name) && m.map) {
            // a small warm fill on the leaf itself (its own colour map, so the dark curls stay dark): the side away from the
            // lamps read as brown bronze (owner "더 다듬어" — gold leaf everywhere), without lifting the highlights
            m.emissive.copy(SACRED_STATUE_FILL);
            m.emissiveMap = m.map;
            m.emissiveIntensity = 1;
          }
          if (s.mirrorX) m.side = DoubleSide;
          if (s.glass && m.emissiveMap) glass.push({ m, day: s.glass.emissiveIntensity?.day ?? 1.5, night: s.glass.emissiveIntensity?.night ?? 0.15 });
          return m;
        });
        o.material = out.length > 1 ? out : out[0]!;
        o.castShadow = false;
        o.receiveShadow = false;
        sacredTriangles += drawnTris(o);
        draws += out.length;
      });
      anchor.add(prop);
    });

    await Promise.allSettled(waits);
    // the room's lamps on every lit material of it (its surfaces, the sacred pieces, the paintings)
    scene.updateMatrixWorld(true);
    const fireNode = scene.getObjectByName(`fire__${unit}_light`);
    const fireAt = fireNode ? new Vector3().setFromMatrixPosition(fireNode.matrixWorld).add(new Vector3(room.shift.x, 0, room.shift.z)) : null;
    const lamps = roomLamps(room, phone, fireAt);
    scene.traverse((o) => {
      if (!isMesh(o)) return;
      for (const m of matsOf(o)) if ((m as MeshStandardMaterial).isMeshStandardMaterial) patchRoomLamps(m as MeshStandardMaterial, lamps);
    });
    // every texture on the GPU now, under the entry cover (the first frame inside never waits for an upload)
    const seen = new Set<Texture>();
    const uploads: Texture[] = [];
    scene.traverse((o) => {
      if (!isMesh(o) || !o.visible) return;
      for (const m of matsOf(o))
        for (const k of ["map", "normalMap", "aoMap", "roughnessMap", "metalnessMap", "emissiveMap", "lightMap", "lmNight"] as const) {
          // (the baked light's two maps too, L6: their first draw was a 100-170 ms upload on the way in)
          const t = k === "lmNight" ? ((m as MeshStandardMaterial).userData.lmNight as Texture | undefined) : (m as MeshStandardMaterial)[k];
          if (t && !seen.has(t)) {
            seen.add(t);
            uploads.push(t);
          }
        }
    });
    // (in slices: a 2K normal map is a 5 MB upload, ten of them in one task were one 300 ms frame; a pause of a frame between
    // every ~3 MB keeps each frame under the cover short)
    let sliced = 0;
    for (const t of uploads) {
      try {
        gl.initTexture(t);
      } catch {
        /* drawn three's way */
      }
      const img = (t as Texture & { mipmaps?: Array<{ width: number; height: number }> }).mipmaps?.[0] ?? (t.image as { width?: number; height?: number } | null);
      sliced += (img?.width ?? 0) * (img?.height ?? 0);
      if (sliced > 3_000_000) {
        sliced = 0;
        await new Promise((r) => setTimeout(r, 16));
      }
    }
    const root = new Group();
    root.name = `lotroom__game_${unit}`;
    root.add(scene);
    root.position.set(room.shift.x, 0, room.shift.z);
    root.updateMatrixWorld(true);
    // the camera's and the seat framing's solid model: the drawn room (its glass is no wall: the stained glass is in it)
    const b = room.bounds;
    const solid = buildSolidIndex(solidTriangles(root), b.minX - 1, b.maxX + 1, b.minZ - 1, b.maxZ + 1);
    // the fire's point light (the node `fire__<unit>_light`)
    const fl = scene.getObjectByName(`fire__${unit}_light`);
    const fireLight = fl ? new Vector3().setFromMatrixPosition(fl.matrixWorld) : null;
    return {
      unit,
      root,
      bank,
      own: textures,
      lightmap: lm ? { mix: lm.mix } : null,
      materials,
      surfaces,
      lightpools,
      screens,
      glow,
      glass,
      fire,
      fireLight,
      lamps,
      solid,
      stats: { triangles: Math.round(triangles), draws, sacred: props.filter((p) => p.status === "fulfilled").length, sacredTriangles: Math.round(sacredTriangles), file, phone },
    };
  } finally {
    draco.dispose();
  }
}

function disposeRoom(r: LoadedRoom): void {
  r.root.traverse((o) => {
    if (isMesh(o)) o.geometry.dispose();
  });
  for (const m of r.materials) m.dispose();
  disposeLoadedLots({ textures: r.own });
  r.bank.dispose();
}

interface CacheEntry {
  key: string;
  promise: Promise<LoadedRoom>;
  value: LoadedRoom | null;
  users: number;
  timer: ReturnType<typeof setTimeout> | null;
}
const rooms = new Map<string, CacheEntry>();

function roomEntry(room: LotRoom, gl: WebGLRenderer, phone: boolean): CacheEntry {
  const key = `${room.unit.id}@${phone ? "phone" : "pc"}`;
  let e = rooms.get(key);
  if (!e) {
    const entry: CacheEntry = { key, promise: Promise.resolve(null as unknown as LoadedRoom), value: null, users: 0, timer: null };
    entry.promise = loadRoom(room, gl, phone).then((v) => {
      entry.value = v;
      return v;
    });
    entry.promise.catch((err: unknown) => {
      console.error(`[lots] room ${room.unit.id}`, err);
      rooms.delete(key);
    });
    rooms.set(key, entry);
    e = entry;
  }
  return e;
}

function hold(e: CacheEntry): () => void {
  e.users++;
  if (e.timer) clearTimeout(e.timer);
  e.timer = null;
  return () => {
    e.users--;
    if (e.users > 0) return;
    e.timer = setTimeout(() => {
      if (e.users > 0) return;
      rooms.delete(e.key);
      void e.promise.then(disposeRoom).catch(() => {});
    }, LOT_ROOM_KEEP_MS);
  };
}

/** Start reading a room's files (the player is at its door). Held for LOT_ROOM_KEEP_MS. */
export function prefetchLotRoom(area: string, gl: WebGLRenderer, phone: boolean): void {
  const room = lotRoomOf(area);
  if (!room) return;
  const e = roomEntry(room, gl, phone);
  if (e.users === 0 && !e.timer) hold(e)();
}

declare global {
  interface Window {
    /** DEV: the room drawn now (its stats, the camera's solid model's size, the lights). */
    __cvLotRoom?: () => unknown;
  }
}

/** The arrival camera: among 24 directions within 65° of straight behind, the one with the longest clear arm (the houses' rule). */
export function arrivalYaw(solid: SolidIndex, x: number, z: number, bodyYaw: number, wanted: number): number {
  const pitch = 0.55;
  const behind = normalizeAngle(bodyYaw + Math.PI);
  const y = HEAD_HEIGHT + wanted * Math.sin(pitch);
  const h = wanted * Math.cos(pitch);
  let best = { yaw: behind, clear: -1 };
  for (let k = 0; k < 24; k++) {
    const yaw = normalizeAngle(behind + ((k - 12) * 2 * Math.PI) / 24);
    if (Math.abs(normalizeAngle(yaw - behind)) > (65 * Math.PI) / 180) continue; // (the room stays in front: never a side wall's view)
    const clear = solid.segmentHit(x, HEAD_HEIGHT, z, x + Math.sin(yaw) * h, y, z + Math.cos(yaw) * h) * wanted;
    if (clear > best.clear + 0.15 || (Math.abs(clear - best.clear) <= 0.15 && Math.abs(normalizeAngle(yaw - behind)) < Math.abs(normalizeAngle(best.yaw - behind)))) best = { yaw, clear };
  }
  return best.yaw;
}

/** The plain room while the model loads: the floor and the walls' boxes, so nobody stands in a void. */
function PlainRoom({ room }: { room: LotRoom }) {
  const b = room.bounds;
  const mat = useMemo(() => new MeshBasicMaterial({ color: "#E9E1D2" }), []);
  useEffect(() => () => mat.dispose(), [mat]);
  return (
    <group>
      <mesh position={[(b.minX + b.maxX) / 2, -0.01, (b.minZ + b.maxZ) / 2]} material={mat}>
        <boxGeometry args={[b.maxX - b.minX, 0.02, b.maxZ - b.minZ]} />
      </mesh>
      {lotRoomSolids(room).map((s) => (
        <mesh key={s.name} position={[(s.minX + s.maxX) / 2, s.height / 2, (s.minZ + s.maxZ) / 2]} material={mat}>
          <boxGeometry args={[s.maxX - s.minX, s.height, s.maxZ - s.minZ]} />
        </mesh>
      ))}
    </group>
  );
}

/** The room the local player is in (mounted while they are in `lot:<unit>`). */
export function LotRoomArea({ area, pose }: { area: string; pose: Pose }) {
  const room = lotRoomOf(area);
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const tier = useQualityTier();
  const phone = tier !== "high";
  const setDpr = useThree((s) => s.setDpr);
  const [loaded, setLoaded] = useState<LoadedRoom | null>(null);

  // a sharper picture in the rooms that ask for it on a phone (ROOM_PHONE_DPR), back to the tier's when the room goes
  useEffect(() => {
    const want = room && phone ? ROOM_PHONE_DPR[room.unit.id] : undefined;
    if (!want || !loaded) return;
    const before = gl.getPixelRatio();
    setDpr(Math.max(before, Math.min(want, window.devicePixelRatio || 1)));
    return () => setDpr(before);
  }, [room, phone, loaded, gl, setDpr]);

  useEffect(() => {
    if (!room) return;
    // a room mounted without the door's curtain (a reconnect): the entry cover until it is drawn
    if (houseEntryState().phase === "idle") beginHouseEntry();
    const e = roomEntry(room, gl, phone);
    const release = hold(e);
    let live = true;
    void e.promise
      .then((v) => {
        if (!live) return;
        setLoaded(v);
      })
      .catch(() => {});
    return () => {
      live = false;
      setLoaded(null);
      release();
    };
  }, [room, gl, phone]);

  // the room's fill (an ambient light: no program's light count changes with it); its lamps, spots and fire are the materials'
  // own lamp term (roomLamps): real point / spot lights would recompile every lit program, the avatars' too, on the way in
  const lights = useMemo(() => {
    if (!room) return null;
    const L = ROOM_LIGHTS[room.unit.id];
    const g = new Group();
    g.name = "lotroom_lights";
    const ambient = L ? new AmbientLight(L.ambient[0], L.ambient[1]) : null;
    if (ambient) g.add(ambient);
    return { group: g, ambient };
  }, [room]);

  // drawn: the cover may lift, the camera keeps to the room's solids, it glides to look into the room, the materials are compiled
  useEffect(() => {
    if (!loaded || !room) return;
    // the cover lifts once the room's programs are compiled (the lightmapped variants are new ones: compiled behind the
    // curtain, not on the first frame inside), or after ROOM_COMPILE_WAIT_MS at most
    let live = true;
    void Promise.race([compileSafely(gl, loaded.root, camera, scene), new Promise((r) => setTimeout(r, ROOM_COMPILE_WAIT_MS))]).then(() => {
      if (live) houseEntryReady();
    });
    const solid = loaded.solid;
    const offSight = setSeatSightBlocker((fx, fy, fz, tx, ty, tz) => solid.segmentBlocked(fx, fy, fz, tx, ty, tz, 0.35));
    const offSpot = setSeatSpotBlocker((x, y, z) => solid.underHung(x, y, z, 2.6, 1.0, 0.25) || solid.nearSolid(x, y, z, 0.3));
    const offCamera = setCameraSolids(solid);
    viewState.orbitGoal = { yaw: arrivalYaw(solid, pose.x, pose.z, pose.yaw, CAMERA.distance), pitch: 0.55 };
    return () => {
      live = false;
      offSight();
      offSpot();
      offCamera();
    };
  }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!import.meta.env.DEV || !loaded || !room) return;
    window.__cvLotRoom = () => {
      let visTris = 0;
      let visDraws = 0;
      const walk = (o: Object3D) => {
        if (!o.visible) return;
        if (isMesh(o)) {
          visTris += drawnTris(o);
          visDraws += matsOf(o).length;
        }
        for (const c of o.children) walk(c);
      };
      walk(loaded.root);
      return {
        unit: loaded.unit,
        area: room.area,
        origin: room.origin,
        stats: loaded.stats,
        visible: { triangles: Math.round(visTris), draws: visDraws },
        textures: { ...loaded.bank.gpuBytes(phone ? "mobile" : "desktop"), own: ownTextureBytes(loaded.root, phone) },
        lamps: { count: loaded.lamps.base.length, fire: loaded.lamps.fire >= 0 },
        fire: !!loaded.fire,
        lightpools: loaded.lightpools.length,
        glass: loaded.glass.length,
        screens: loaded.screens.length,
      };
    };
    return () => {
      delete window.__cvLotRoom;
    };
  }, [loaded, room, phone]);

  const colour = useRef(new Color()).current;
  useFrame(({ clock }) => {
    if (!loaded || !lights) return;
    const o = dayNight.outdoor;
    const day = Math.max(0, Math.min(1, 1 - o.night));
    const t = clock.elapsedTime;
    if (loaded.fire) loaded.fire.uniforms.uTime!.value = t;
    // the coloured sun on the floor, the glass's glow and the view behind the windows follow the daylight outside
    for (const m of loaded.lightpools) m.color.setScalar(0.9 * day * day);
    for (const g of loaded.glass) g.m.emissiveIntensity = g.night + (g.day - g.night) * day;
    colour.setScalar(0.22 + 0.78 * day);
    for (const m of loaded.screens) {
      const v = m.userData.windowView as { uViewWeight: { value: Vector3 } } | undefined;
      if (v) {
        // the village's own light at this hour (evening: the sun in the west, -x)
        const keys = WINDOW_VIEWS[loaded.unit]?.keys ?? [];
        windowViewWeights(keys, o.night, o.golden, o.sunDir[0] < 0, v.uViewWeight.value);
      } else if (m.name !== "M_garden") m.color.copy(colour);
    }
    loaded.glow.opacity = Math.max(0.25, o.lights);
    // the room's lamps: brighter at night (they carry the room then), the fill lower
    const L = ROOM_LIGHTS[loaded.unit];
    if (L && lights.ambient) lights.ambient.intensity = (L.ambient[2] + (L.ambient[1] - L.ambient[2]) * day) * (loaded.lightmap ? LIGHTMAP_AMBIENT : 1);
    // the baked light: the day map by day, the night map by night (one uniform)
    if (loaded.lightmap) loaded.lightmap.mix.value = 1 - day;
    roomBaked.on = !!loaded.lightmap;
    const lamps = loaded.lamps;
    for (let i = 0; i < lamps.base.length; i++) {
      const k = lamps.fire === i ? FIRE_INTENSITY * (0.82 + 0.12 * Math.sin(t * 5.65) + 0.06 * Math.sin(t * 44.0)) : lamps.base[i]! * (1 + 0.6 * (1 - day));
      lamps.col.value[i]!.set(lamps.colour[i]!.r * k, lamps.colour[i]!.g * k, lamps.colour[i]!.b * k);
    }
  });

  // (leaving the room: the outdoor light is the village's own again)
  useEffect(() => () => void (roomBaked.on = false), []);

  if (!room) return null;
  return (
    <>
      {lights ? <primitive object={lights.group} dispose={null} /> : null}
      {loaded ? <primitive object={loaded.root} dispose={null} /> : <PlainRoom room={room} />}
    </>
  );
}

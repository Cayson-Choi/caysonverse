import { ClampToEdgeWrapping, SRGBColorSpace, Texture, TextureLoader, type Material, type MeshStandardMaterial } from "three";
import { versionedUrl } from "../village/modelUrl";

/**
 * The eel's own skin (a real-photo-based atlas cell, tools: docs/designs/lake-fishing/tools/eel_skin.py). lake_fish.glb's shared atlas
 * had a procedural placeholder for it; the cell lives in its own file so the shared fish model is not touched. The file is the eel's cell of
 * that atlas (atlas column 2, row 2 of 4 x 3): the shared UVs are mapped onto it by the texture's repeat / offset.
 */
export const EEL_SKIN_URL = versionedUrl("/models/lake/lake_eel_skin.webp");
/** The eel's cell in the 4 x 3 atlas (column, row). */
export const EEL_CELL = { col: 2, row: 2, cols: 4, rows: 3 } as const;

let tex: Texture | null = null;
let failed = false;
const waiting = new Set<MeshStandardMaterial>();

function loadTexture(): void {
  if (tex || failed) return;
  tex = new TextureLoader().load(
    EEL_SKIN_URL,
    (t) => {
      for (const m of waiting) {
        m.map = t;
        m.needsUpdate = true;
      }
      waiting.clear();
    },
    undefined,
    () => {
      failed = true;
      tex = null;
      waiting.clear(); // keep the shared atlas' cell
    },
  );
  tex.colorSpace = SRGBColorSpace;
  tex.flipY = false; // glTF UVs
  tex.wrapS = tex.wrapT = ClampToEdgeWrapping;
  tex.repeat.set(EEL_CELL.cols, EEL_CELL.rows);
  tex.offset.set(-EEL_CELL.col, -EEL_CELL.row);
  tex.anisotropy = 4;
}

/** Put the eel's skin on a live fish-body material (only the `M_fish` body, not the fins); the atlas' own cell shows until the file is in. */
export function applyEelSkin(m: Material): void {
  const s = m as MeshStandardMaterial;
  if (!/^M_fish/.test(s.name)) return;
  loadTexture();
  if (failed || !tex) return;
  if (tex.image) {
    s.map = tex;
    s.needsUpdate = true;
  } else waiting.add(s);
}

export function isEelKind(id: string): boolean {
  return id === "eel";
}

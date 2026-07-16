/**
 * Procedural royal accessories (v2 Task 13): the prince's gold epaulettes, the
 * queen's medallion + waist band, and the princess' flared peplum skirt. Pure
 * geometry builders — no new GLBs. Geometry and BASE materials live at module
 * level and are shared by every avatar (never disposed per avatar); each avatar
 * gets its OWN untinted material clone (pushed into `out`) so the existing
 * opacity-ghosting and disposal paths in the players cover accessories too.
 *
 * Budget: king +0 tris (palette + cape + crown carry him), prince ≈140 (two
 * hemisphere epaulettes), queen ≈72 (disc + open band), princess 96 (open
 * cylinder peplum) — all far below the 500-tri/royal cap.
 */

import {
  CylinderGeometry,
  DoubleSide,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  type Material,
  type Object3D,
} from "three";
import type { RoyalId } from "./constants";

// ── Shared BASE materials (module lifetime — cloned per avatar, never disposed).
const GOLD_BASE = new MeshStandardMaterial({ color: 0xd9a832, metalness: 0.7, roughness: 0.35 });
// Peplum is an open surface seen from both sides while walking → DoubleSide. A
// LIGHTER rose than the repainted dress cells, so the overskirt reads as its
// own layer instead of vanishing into the same hue (screenshot-tuned).
const ROSE_BASE = new MeshStandardMaterial({ color: 0xe88ab8, roughness: 0.8, side: DoubleSide });

// ── Shared geometries (module lifetime). Unit-ish sizes, fitted via mesh.scale.
/** Shoulder dome: a unit hemisphere (pole +Y), ~70 tris. */
const EPAULETTE_GEO = new SphereGeometry(1, 10, 4, 0, Math.PI * 2, 0, Math.PI / 2);
/** Medallion disc: unit radius, unit height cylinder WITH caps, ~48 tris. */
const MEDALLION_GEO = new CylinderGeometry(1, 1, 1, 12);
/** Waist band: unit open cylinder (no caps), 40 tris. */
const BAND_GEO = new CylinderGeometry(1, 1, 1, 20, 1, true);
/** Peplum: flared open cylinder in REAL metres (0.17→0.35 over 0.27m), 96 tris. */
const PEPLUM_GEO = new CylinderGeometry(0.17, 0.35, 0.27, 48, 1, true);

/**
 * Hide the peplum while the avatar is SEATED, or its skirt would spear through
 * the thighs. The server-authoritative seatIndex reaches this module only as
 * the pose it drives (LocalPlayer/RemotePlayer play the sit clips on seat
 * transitions — both files belong to other work lanes and stay untouched): the
 * KayKit sit clips hold the hips bone at local Y = 0.4813 while idle/walk stay
 * within 0.3254..0.3921 (measured by scripts/dump-uv-cells.mjs across all four
 * GLBs; bind pose = 0.4057). 0.44 splits the two ranges with margin.
 */
export const PEPLUM_HIDE_HIPS_Y = 0.44;

/**
 * Re-show threshold BELOW the hide one — hysteresis (review v2-13 M2): the
 * StandUp clip's hips curve crosses 0.44 in BOTH directions before settling,
 * which would flicker a single-threshold predicate. Re-showing only once the
 * hips drop under 0.41 yields one clean transition per sit/stand; idle/walk
 * never exceed 0.3921, so a standing avatar always ends up shown.
 */
export const PEPLUM_SHOW_HIPS_Y = 0.41;

/** Pure predicate (unit-tested): hide chair-high, re-show only clearly below. */
export function peplumVisibleForHipsY(hipsY: number, wasVisible: boolean): boolean {
  return hipsY < (wasVisible ? PEPLUM_HIDE_HIPS_Y : PEPLUM_SHOW_HIPS_Y);
}

/** Dev registry of live peplums (E2E asserts the seated hide/restore). */
const peplumRegistry = new Set<Mesh>();

/** Clone a shared base material for one avatar, tracked in `out` for disposal. */
function cloneShared(base: MeshStandardMaterial, out: Material[]): MeshStandardMaterial {
  const cloned = base.clone();
  out.push(cloned);
  return cloned;
}

/**
 * Build one accessory mesh on a shared geometry. Accessories are static in
 * their bone's frame, so the local matrix is composed ONCE and matrixAutoUpdate
 * turned off (the bone's world matrix still animates them for free). Like the
 * crown they are bone-attached, so rest-pose culling would pop them — culling
 * is disabled the same way.
 */
function buildPart(
  geometry: CylinderGeometry | SphereGeometry,
  material: Material,
  transform: {
    position: [number, number, number];
    scale?: [number, number, number];
    rotationX?: number;
  },
): Mesh {
  const mesh = new Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  mesh.position.set(...transform.position);
  if (transform.scale) mesh.scale.set(...transform.scale);
  if (transform.rotationX) mesh.rotation.x = transform.rotationX;
  mesh.updateMatrix();
  mesh.matrixAutoUpdate = false;
  return mesh;
}

/**
 * Attach the royal's procedural accessories to the cloned rig's bones. Bone
 * names verified by scripts/dump-uv-cells.mjs (same skeleton in all 4 GLBs).
 * The king adds none — his palette (red+gold), big cape and full crown carry
 * the silhouette. Missing bones (never expected) simply skip the accessory.
 */
export function attachRoyalAccessories(root: Object3D, royal: RoyalId, out: Material[]): void {
  if (royal === "prince") {
    // Gold epaulettes: one dome per shoulder. The upperarm bone's +Y runs down
    // the arm, so the dome is flipped (rotation.x = π) to cap the shoulder ball.
    // Sized to crest ABOVE the knight's own (gold-repainted) pauldrons, or the
    // dome disappears inside them (screenshot-tuned).
    for (const side of ["upperarm.l", "upperarm.r"]) {
      const bone = root.getObjectByName(side);
      if (!bone) continue;
      bone.add(
        buildPart(EPAULETTE_GEO, cloneShared(GOLD_BASE, out), {
          position: [0, 0.03, 0],
          scale: [0.17, 0.12, 0.17],
          rotationX: Math.PI,
        }),
      );
    }
  } else if (royal === "queen") {
    // Gold medallion on the chest (disc facing +Z = model front) + a thin waist
    // band where the robe cinches (spine bone origin is the waistline). Sits
    // BELOW the robe's big collar; the robe's measured front surface at chest
    // height is z ≈ 0.30 (Mage_Body POSITION dump), so the disc rides at 0.33
    // to stay proud of the cloth.
    const chest = root.getObjectByName("chest");
    if (chest) {
      chest.add(
        buildPart(MEDALLION_GEO, cloneShared(GOLD_BASE, out), {
          position: [0, 0.02, 0.33],
          scale: [0.06, 0.025, 0.06],
          rotationX: Math.PI / 2,
        }),
      );
    }
    const spine = root.getObjectByName("spine");
    if (spine) {
      spine.add(
        buildPart(BAND_GEO, cloneShared(GOLD_BASE, out), {
          position: [0, 0.03, 0],
          scale: [0.23, 0.05, 0.2],
        }),
      );
    }
  } else if (royal === "princess") {
    const hips = root.getObjectByName("hips");
    if (!hips) return;
    const material = cloneShared(ROSE_BASE, out);
    const peplum = buildPart(PEPLUM_GEO, material, { position: [0, -0.06, 0] });
    // Seated hide: `visible` becomes a live view of the animated hips pose, so
    // the skirt vanishes exactly while the sit clips hold the chair pose — no
    // per-frame wiring in the player components, works for local AND remote.
    // `shown` carries the hysteresis state across reads (see PEPLUM_SHOW_HIPS_Y).
    let shown = true;
    Object.defineProperty(peplum, "visible", {
      configurable: true,
      get: () => (shown = peplumVisibleForHipsY(hips.position.y, shown)),
      set: () => {}, // pose is the single source of truth — writes are no-ops
    });
    hips.add(peplum);
    if (import.meta.env.DEV) {
      peplumRegistry.add(peplum);
      // The avatar's cloned materials are disposed on unmount — ride that as
      // the unregister signal so the dev registry can't leak across remounts.
      material.addEventListener("dispose", () => peplumRegistry.delete(peplum));
    }
  }
  // king: no procedural parts.
}

declare global {
  interface Window {
    /** Dev/E2E hook: visibility of every live peplum (seated-hide assertions). */
    __cvRoyalPeplums?: () => boolean[];
  }
}

/**
 * True when `obj`'s root ancestor is the three Scene. StrictMode double-invokes
 * the avatar useMemo in dev, so the registry also holds the DISCARDED clone's
 * peplum (its root is never mounted); the hook reports mounted ones only.
 */
function isMounted(obj: Object3D): boolean {
  let node: Object3D = obj;
  while (node.parent) node = node.parent;
  return (node as Object3D & { isScene?: boolean }).isScene === true;
}

// Dev-only E2E hook (tree-shaken in production, same pattern as debug.ts).
if (import.meta.env.DEV && typeof window !== "undefined") {
  window.__cvRoyalPeplums = () =>
    [...peplumRegistry].filter((p) => isMounted(p)).map((p) => p.visible);
}

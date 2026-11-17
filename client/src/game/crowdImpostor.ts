/**
 * Far-avatar crowd (perf/crowd, 2026-11-18; owner: "100명이 플레이하는데 끊김이나 렉이나 이런게 걸리면 안돼").
 *
 * With ~100 avatars in one view the CPU frame went to the avatars' node trees (50 nodes and 44 bones each: matrices, skeleton
 * update, two draws apiece, 11-18k triangles apiece), not to the animation mixers (measured: e2e/crowd-100.mjs). An avatar far
 * from the camera is a few dozen pixels tall, so beyond ENTER_M a standing or walking avatar is drawn as one INSTANCE of a
 * 700-triangle toy figure instead — head, hair cap, body, two arms, two legs — in the avatar's own skin / hair / top /
 * bottom / shoe colours, with the leg and arm swing done in the vertex shader. ALL the far avatars are one draw call, with no
 * skeleton, no mixer, no node tree (RemotePlayer takes the full avatar out of the scene while its stand-in is shown and puts it
 * back, posed, when the viewer comes within EXIT_M). Seated, riding, jumping, fishing and disconnected avatars are never stood in
 * for: the full avatar stays.
 *
 * This module has no React: the geometry, the material, the slot book-keeping and the hysteresis rule (all unit-tested).
 */
import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  SphereGeometry,
  Color,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { AvatarLook } from "./characterLook";
import { CLICK_PICK_KEY } from "./clickPick";

/**
 * A standing / walking avatar farther than the crowd's threshold from the camera is drawn as a stand-in. The threshold is the
 * distance of the BUDGET-th nearest avatar (the budget: how many full avatars the device draws well; the near limit is per tier too), kept between
 * IMPOSTOR_MIN_M (nothing nearer is ever a stand-in: the look up close is the full avatar's) and IMPOSTOR_MAX_M (nothing
 * nearer than that is worth a stand-in when there is room for all of them).
 */
export const IMPOSTOR_MIN_M = 14;
export const IMPOSTOR_MAX_M = 28;
/** Half the gap (m) between becoming a stand-in and becoming a full avatar again: an avatar on the border does not flicker. */
export const IMPOSTOR_HYST_M = 1.5;
/** Full avatars drawn at once: the PC tier, and the touch / low-spec tier. */
export const FULL_BUDGET = { rich: { count: 32, minM: 14 }, lite: { count: 10, minM: 14 } } as const;
/** Most stand-ins at once (a room holds 30 players; the rest is slack for several rooms' worth of looks). */
export const IMPOSTOR_CAPACITY = 128;

/** Hysteresis: whether the avatar is a stand-in on the next frame, given the crowd's threshold (m). */
export function wantsImpostor(now: boolean, eligible: boolean, distance: number, thresholdM: number): boolean {
  if (!eligible) return false;
  return now ? distance >= thresholdM - IMPOSTOR_HYST_M : distance > thresholdM + IMPOSTOR_HYST_M;
}

/** The threshold (m) for the distances reported this frame (sorted in place, ascending, over the first `n`). */
export function crowdThreshold(distances: Float32Array, n: number, budget: number, minM: number = IMPOSTOR_MIN_M): number {
  if (n <= budget) return IMPOSTOR_MAX_M;
  const sorted = distances.subarray(0, n).sort();
  return Math.min(IMPOSTOR_MAX_M, Math.max(minM, sorted[budget - 1]));
}

/** Vertex part ids (the `aPart` attribute): which of the avatar's colours a vertex takes. */
export const PART = { skin: 0, hair: 1, top: 2, bottom: 3, shoes: 4 } as const;

/** Swing: rotation about the X axis through the hip / the shoulder (m above the feet). */
const HIP_Y = 0.54;
const SHOULDER_Y = 1.0;

interface Piece {
  geometry: BufferGeometry;
  part: number | "head";
  /** signed swing weight (0 = rigid) and its pivot height */
  swing: number;
  pivotY: number;
}

/** One primitive, UVs dropped (the merge needs the same attributes everywhere), with its part id and swing rig per vertex. */
function finish(piece: Piece): BufferGeometry {
  const g = piece.geometry;
  g.deleteAttribute("uv");
  const n = g.getAttribute("position").count;
  const part = new Float32Array(n);
  const rig = new Float32Array(n * 3);
  const pos = g.getAttribute("position");
  const normal = g.getAttribute("normal");
  for (let i = 0; i < n; i++) {
    if (piece.part === "head") {
      // the top and the back of the head are hair, the face and the sides skin
      const hair = normal.getY(i) > 0.25 || normal.getZ(i) < -0.2 || (normal.getY(i) > 0.05 && pos.getZ(i) < 0.1);
      part[i] = hair ? PART.hair : PART.skin;
      if (hair) {
        // the hair (or hat) stands a little off the skull, like the avatar's
        pos.setXYZ(i, pos.getX(i) * 1.07, 1.4 + (pos.getY(i) - 1.4) * 1.07, pos.getZ(i) * 1.07);
      }
    } else {
      part[i] = piece.part;
    }
    rig[i * 3] = piece.swing;
    rig[i * 3 + 1] = piece.pivotY;
  }
  g.setAttribute("aPart", new Float32BufferAttribute(part, 1));
  g.setAttribute("aRig", new Float32BufferAttribute(rig, 3));
  return g;
}

/** The toy figure (model space: y up, facing +Z, feet at y = 0), about 1.65 m tall. */
export function buildFigureGeometry(): BufferGeometry {
  const pieces: Piece[] = [];
  const add = (geometry: BufferGeometry, part: Piece["part"], x: number, y: number, z = 0, swing = 0, pivotY = 0): void => {
    geometry.translate(x, y, z);
    pieces.push({ geometry, part, swing, pivotY });
  };
  // legs (bottom colour) and shoes: swing about the hip, one forward while the other is back
  for (const side of [1, -1]) {
    add(new CylinderGeometry(0.13, 0.115, 0.42, 7, 1), PART.bottom, side * 0.15, 0.33, 0, side, HIP_Y);
    add(new BoxGeometry(0.23, 0.13, 0.34), PART.shoes, side * 0.15, 0.065, 0.05, side, HIP_Y);
  }
  // body (top colour): a slightly tapered trunk
  add(new CylinderGeometry(0.31, 0.34, 0.54, 8, 1), PART.top, 0, 0.78);
  // arms (top colour) with skin hands: swing about the shoulder, against the legs
  for (const side of [1, -1]) {
    add(new CylinderGeometry(0.09, 0.085, 0.42, 6, 1), PART.top, side * 0.43, 0.79, 0, -side * 0.85, SHOULDER_Y);
    add(new SphereGeometry(0.1, 6, 5), PART.skin, side * 0.43, 0.56, 0, -side * 0.85, SHOULDER_Y);
  }
  // head: skin face, hair on the top and the back (a bald or hatted figure tints that cap by its own colour)
  add(new SphereGeometry(0.41, 12, 9), "head", 0, 1.4);
  const merged = mergeGeometries(pieces.map(finish), false);
  if (!merged) throw new Error("crowdImpostor: cannot merge the figure");
  merged.computeBoundingSphere();
  return merged;
}

/** The colours a stand-in takes from a look: skin, hair (the hat's colour under a hat), top, bottom, shoes. */
export function impostorColors(look: AvatarLook): Color[] {
  const c = look.colors;
  const bare = (id: string | null, tint: string, skin: string): string => (id === null ? skin : tint);
  return [
    new Color(c.skin),
    new Color(look.parts.hat !== null ? c.hat : bare(look.parts.hair, c.hair, c.skin)),
    new Color(bare(look.parts.top, c.top, c.skin)),
    new Color(bare(look.parts.bottom, c.bottom, c.skin)),
    new Color(look.parts.shoes === null ? c.skin : c.shoes),
  ];
}

/** Per-instance attribute names, in the order impostorColors returns the colours. */
const COLOR_ATTRS = ["aSkin", "aHair", "aTop", "aBottom", "aShoes"] as const;

/** The stand-in material: three's standard material (lit and fogged like the avatars') with the swing and the tints injected. */
export function createImpostorMaterial(roughness: number): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ roughness, metalness: 0 });
  material.name = "avatar__impostor";
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "void main() {",
        `attribute float aPart;
attribute vec3 aRig;
attribute vec3 aSkin;
attribute vec3 aHair;
attribute vec3 aTop;
attribute vec3 aBottom;
attribute vec3 aShoes;
attribute vec2 aGait; // x: the stride phase (rad), y: the speed (m/s)
varying vec3 vTint;
void main() {
  vTint = aPart < 0.5 ? aSkin : aPart < 1.5 ? aHair : aPart < 2.5 ? aTop : aPart < 3.5 ? aBottom : aShoes;`,
      )
      .replace(
        "#include <begin_vertex>",
        `vec3 transformed = vec3( position );
{
  float walk = clamp( aGait.y / 1.4, 0.0, 1.0 );
  float ang = sin( aGait.x ) * aRig.x * walk * 0.7;
  float cs = cos( ang );
  float sn = sin( ang );
  float dy = transformed.y - aRig.y;
  float oy = aRig.y + dy * cs - transformed.z * sn;
  float oz = dy * sn + transformed.z * cs;
  transformed.y = aRig.x == 0.0 ? transformed.y : oy;
  transformed.z = aRig.x == 0.0 ? transformed.z : oz;
  transformed.y += abs( sin( aGait.x ) ) * 0.05 * walk;
}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", "varying vec3 vTint;\nvoid main() {")
      .replace("#include <color_fragment>", "#include <color_fragment>\n  diffuseColor.rgb *= vTint;");
  };
  material.customProgramCacheKey = () => "avatar__impostor_v1";
  return material;
}

const ZERO = new Matrix4().makeScale(0, 0, 0);

/**
 * The stand-ins: one InstancedMesh of the figure (slots handed out to RemotePlayers), optionally a second one of the blob
 * shadow (the touch / low-spec tier draws a flat shadow under each avatar instead of a live one).
 */
export class CrowdImpostors {
  readonly mesh: InstancedMesh;
  readonly blob: InstancedMesh | null;
  private readonly free: number[] = [];
  private high = 0;
  private active = 0;
  private readonly gait: InstancedBufferAttribute;
  private readonly colorAttrs: InstancedBufferAttribute[] = [];
  private readonly blobY: number;
  /** Distances of the avatars that could be stand-ins, reported this frame; the threshold is read from the last full round. */
  private readonly reports = new Float32Array(IMPOSTOR_CAPACITY * 2);
  private reported = 0;
  /** Distance (m) beyond which an eligible avatar is a stand-in (before the hysteresis). */
  thresholdM: number = IMPOSTOR_MAX_M;
  budget: number = FULL_BUDGET.rich.count;
  minM: number = FULL_BUDGET.rich.minM;

  constructor(
    blob: { geometry: BufferGeometry; material: InstancedMesh["material"]; y: number } | null,
    roughness = 0.45,
    capacity = IMPOSTOR_CAPACITY,
  ) {
    const geometry = buildFigureGeometry();
    this.mesh = new InstancedMesh(geometry, createImpostorMaterial(roughness), capacity);
    this.mesh.name = "avatar__impostors";
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    // a click goes through a far stand-in to the ground behind it (the click pick caches an instanced mesh's box once, which
    // the moving instances would outgrow)
    this.mesh.userData[CLICK_PICK_KEY] = "ignore";
    for (const name of COLOR_ATTRS) {
      const attr = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
      geometry.setAttribute(name, attr);
      this.colorAttrs.push(attr);
    }
    this.gait = new InstancedBufferAttribute(new Float32Array(capacity * 2), 2);
    geometry.setAttribute("aGait", this.gait);
    for (let i = 0; i < capacity; i++) this.mesh.setMatrixAt(i, ZERO);
    if (blob) {
      this.blob = new InstancedMesh(blob.geometry, blob.material, capacity);
      this.blob.name = "avatar__impostor_blobs";
      this.blob.count = 0;
      this.blob.frustumCulled = false;
      this.blob.userData[CLICK_PICK_KEY] = "ignore";
      for (let i = 0; i < capacity; i++) this.blob.setMatrixAt(i, ZERO);
      this.blobY = blob.y;
    } else {
      this.blob = null;
      this.blobY = 0;
    }
  }

  /** Stand-ins in use. */
  get count(): number {
    return this.active;
  }

  /** Take a slot for an avatar of this look, or -1 when full (the avatar then stays a full one). */
  acquire(colors: readonly Color[]): number {
    const slot = this.free.pop() ?? (this.high < this.mesh.instanceMatrix.count ? this.high++ : -1);
    if (slot < 0) return -1;
    for (let k = 0; k < this.colorAttrs.length; k++) {
      const a = this.colorAttrs[k].array as Float32Array;
      a[slot * 3] = colors[k].r;
      a[slot * 3 + 1] = colors[k].g;
      a[slot * 3 + 2] = colors[k].b;
    }
    for (const a of this.colorAttrs) a.needsUpdate = true;
    this.active += 1;
    this.mesh.count = this.high;
    if (this.blob) this.blob.count = this.high;
    return slot;
  }

  /** Give a slot back: its instance collapses to nothing. */
  release(slot: number): void {
    if (slot < 0) return;
    this.mesh.setMatrixAt(slot, ZERO);
    this.blob?.setMatrixAt(slot, ZERO);
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.blob) this.blob.instanceMatrix.needsUpdate = true;
    this.free.push(slot);
    this.active -= 1;
  }

  /**
   * Place one stand-in: at (x, y, z) facing `yaw`, at `speed` m/s, the stride phase advancing `dt` s. Writes the matrix by hand
   * (no scratch objects); three uploads the changed buffers once per render.
   */
  place(slot: number, x: number, y: number, z: number, yaw: number, speed: number, phase: number, floorY: number): void {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const m = this.mesh.instanceMatrix.array as Float32Array;
    const o = slot * 16;
    // rotation about Y (column-major), translation
    m[o] = c;
    m[o + 1] = 0;
    m[o + 2] = -s;
    m[o + 3] = 0;
    m[o + 4] = 0;
    m[o + 5] = 1;
    m[o + 6] = 0;
    m[o + 7] = 0;
    m[o + 8] = s;
    m[o + 9] = 0;
    m[o + 10] = c;
    m[o + 11] = 0;
    m[o + 12] = x;
    m[o + 13] = y;
    m[o + 14] = z;
    m[o + 15] = 1;
    const g = this.gait.array as Float32Array;
    g[slot * 2] = phase;
    g[slot * 2 + 1] = speed;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.gait.needsUpdate = true;
    if (this.blob) this.blob.instanceMatrix.needsUpdate = true;
    if (this.blob) {
      // the flat shadow: the geometry is a XY plane, laid on the floor (rotation -90 deg about X)
      const b = this.blob.instanceMatrix.array as Float32Array;
      b[o] = 1;
      b[o + 1] = 0;
      b[o + 2] = 0;
      b[o + 3] = 0;
      b[o + 4] = 0;
      b[o + 5] = 0;
      b[o + 6] = -1;
      b[o + 7] = 0;
      b[o + 8] = 0;
      b[o + 9] = 1;
      b[o + 10] = 0;
      b[o + 11] = 0;
      b[o + 12] = x;
      b[o + 13] = floorY + this.blobY;
      b[o + 14] = z;
      b[o + 15] = 1;
    }
  }

  /** An avatar that could be a stand-in reports its distance to the camera, once a frame. */
  report(distance: number): void {
    if (this.reported < this.reports.length) this.reports[this.reported++] = distance;
  }

  /** Once a frame, before the avatars: settle the threshold from what they reported last frame. */
  startFrame(): void {
    this.thresholdM = crowdThreshold(this.reports, this.reported, this.budget, this.minM);
    this.reported = 0;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshStandardMaterial).dispose();
    this.mesh.dispose();
    this.blob?.dispose();
  }
}

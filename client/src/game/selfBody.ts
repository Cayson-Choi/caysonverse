import { MeshBasicMaterial, type Material, type Mesh, type Object3D } from "three";
import { setAvatarOpacity, type BuiltAvatar } from "./characterAvatar";
import { SELF_FADE_OPACITY, SELF_FADE_RENDER_ORDER, SELF_FADE_TAU } from "./clickRing";

/**
 * The local player's own body, for what has to be seen past it. LocalPlayer registers its avatar group and the avatar's
 * height (BuiltAvatar.topY: feet to the top of the hair) while it is mounted; ClickMarker reports, each frame, whether
 * that body hides the destination ring (`hidingRing`: clickRing.ts ringBehindSelf), and LocalPlayer fades the body
 * while it does (stepSelfFade). Read per frame, never React state.
 */
export const selfBody: { object: Object3D | null; height: number; hidingRing: boolean } = { object: null, height: 0, hidingRing: false };

/** LocalPlayer's mount: its group and its avatar's height. Returns the unmount (only its own registration goes). */
export function registerSelfBody(object: Object3D, height: number): () => void {
  selfBody.object = object;
  selfBody.height = height;
  selfBody.hidingRing = false;
  return () => {
    if (selfBody.object !== object) return;
    selfBody.object = null;
    selfBody.height = 0;
    selfBody.hidingRing = false;
  };
}

/**
 * The faded body's depth, written just before its colour (SELF_FADE_RENDER_ORDER) and after the ring: only its front
 * surface is then blended — not the hair's inner shells and the far arm seen through the near one, which a body
 * faded without it showed as dark rings on the back of the head.
 */
const DEPTH_ONLY: Material = new MeshBasicMaterial({ colorWrite: false, depthWrite: true, transparent: true });

/** The own body's fade: its opacity now, its meshes' own render orders and its depth copies while it is faded. */
export interface SelfFade {
  opacity: number;
  orders: Map<Object3D, number> | null;
  depth: Mesh[] | null;
}

export function createSelfFade(): SelfFade {
  return { opacity: 1, orders: null, depth: null };
}

/**
 * The avatar drawn after the ring, its depth first (`on`) — or back at its meshes' own render orders, its depth copies
 * gone. The copies share the meshes' geometry and skeleton (a skinned copy poses as the body does); only the meshes
 * whose own material is opaque get one (a see-through face plane would cut the head in front of it).
 */
function drawAfterRing(f: SelfFade, avatar: BuiltAvatar, on: boolean): void {
  if (on) {
    if (f.orders) return;
    const orders = new Map<Object3D, number>();
    const meshes: Mesh[] = [];
    avatar.root.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh || mesh.userData.selfDepth) return;
      orders.set(mesh, mesh.renderOrder);
      meshes.push(mesh);
    });
    const depth: Mesh[] = [];
    for (const mesh of meshes) {
      mesh.renderOrder = SELF_FADE_RENDER_ORDER + 1;
      const material = mesh.material as Material;
      const base = material.userData?.base as { transparent: boolean } | undefined;
      if (!mesh.parent || Array.isArray(mesh.material) || (base ? base.transparent : material.transparent)) continue;
      const copy = mesh.clone(false);
      copy.material = DEPTH_ONLY;
      copy.renderOrder = SELF_FADE_RENDER_ORDER;
      copy.userData = { selfDepth: true };
      mesh.parent.add(copy);
      depth.push(copy);
    }
    f.orders = orders;
    f.depth = depth;
  } else {
    if (f.orders) for (const [o, order] of f.orders) o.renderOrder = order;
    if (f.depth) for (const copy of f.depth) copy.removeFromParent();
    f.orders = null;
    f.depth = null;
  }
}

/**
 * One frame of the own body's fade (`dt` s): toward SELF_FADE_OPACITY while it hides the ring (`fade`), else back to 1,
 * eased (SELF_FADE_TAU). While faded it is drawn after the ring, its depth first: the ring shows through its front
 * surface the way the ground round it does — not over it, and no dashed outline of it on the body. Touches the
 * materials only when the opacity changes. Returns the opacity now.
 */
export function stepSelfFade(f: SelfFade, avatar: BuiltAvatar, fade: boolean, dt: number): number {
  const goal = fade ? SELF_FADE_OPACITY : 1;
  let next = goal + (f.opacity - goal) * Math.exp(-Math.min(Math.max(dt, 0), 0.1) / SELF_FADE_TAU);
  if (Math.abs(next - goal) < 0.01) next = goal;
  if (next === f.opacity) return next;
  f.opacity = next;
  setAvatarOpacity(avatar, next);
  drawAfterRing(f, avatar, next < 1);
  return next;
}

/** The body back in full at once (an unmount, a new avatar). */
export function endSelfFade(f: SelfFade, avatar: BuiltAvatar): void {
  if (f.opacity === 1 && !f.orders) return;
  f.opacity = 1;
  setAvatarOpacity(avatar, 1);
  drawAfterRing(f, avatar, false);
}

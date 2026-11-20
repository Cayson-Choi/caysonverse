/**
 * True first person (owner 2026-11-20: "1인칭 뷰에서 바닥을 내려다보면 실제로는 내 발이 보이는게 정상 아닐까?"): in first person the
 * own body stays drawn from the neck down — torso, arms, legs, feet and what the hands hold — and looking down shows them walking,
 * sitting on a bench or a cushion, riding. Only the head goes: the character's head, face, hair and hat are all skinned to the one
 * `head` bone (character.glb), so that bone is shrunk to nothing for the frame's drawing, and the eye is put where the head's eyes
 * are, a little in front of the neck, so the view never starts inside the neck or the shoulders.
 *
 * Both happen in the scene's onBeforeRender, after every frame callback and after three's matrix pass, so they read the body's
 * FINAL pose for this frame whatever order the camera rig and the player's frame callbacks ran in:
 *  - the eye: the camera rig publishes the eye it estimated (`fpEye`, from the pose) and how much first person weighs; the
 *    difference to the head's real eye point is added to the camera once per frame;
 *  - the head: shrunk, and its subtree's matrices refreshed (the skin reads the bones' world matrices when it is drawn); put
 *    back at the start of the player's next frame callback (`restoreHead`), before anything else reads it;
 *  - the shadow: the body keeps casting its own; the head's share is cast by an invisible stand-in (no colour, no depth) of
 *    the head's size, so the shadow on the ground is the whole avatar.
 * Local only: remote players draw their own avatars of me, untouched.
 */
import { Matrix4, Mesh, MeshBasicMaterial, Quaternion, SphereGeometry, Vector3, type Bone, type Camera, type Object3D, type Scene } from "three";

/** The eye in the head bone's own frame (character.glb units: the face's plate spans y 0.24..0.58 above the bone, z 0.31..0.48). */
export const FP_EYE_LOCAL = Object.freeze({ x: 0, y: 0.36, z: 0.36 });
/** The scale the head bone is shrunk to (not 0: a singular bone matrix would make NaNs in the skin's normals). */
export const HEAD_COLLAPSED = 1e-4;
/** The head's shadow stand-in, in the head bone's frame: an ellipsoid round the skull and hair. */
const HEAD_SHADOW = { cy: 0.56, rx: 0.52, ry: 0.6, rz: 0.5 };
/** The TP<->FP blend from which the headless body is drawn (below it the camera is still crossing the head: hidden as before). */
export const FP_BODY_BLEND = 0.98;
/** The camera's near plane in first person (m): the shoulders and the hands just below the eye are not cut (the village's is 0.2). */
export const FP_NEAR = 0.05;

/** What the camera rig asked for this frame (written by CameraRig, read once by the render hook). */
export const fpEye = {
  armed: false,
  /** 0..1: how much of the camera is the first-person eye (1 = fully first person, 0 = no correction). */
  w: 0,
  /**
   * The furthest the eye may sit forward of the neck (1 = the eye point).
   */
  pullMax: 1,
  /** The eye's sideways shift in the head's frame (character.glb units, + = the avatar's left): CAROUSEL_SIDE on the horse. */
  side: 0,
  /** On foot (not seated, not on a ride): the walk's bob of the head bone is held out of the eye (see steadyHead). */
  onFoot: false,
  /** The body is going somewhere now (ground speed above STEADY_MOVING). */
  moving: false,
  x: 0,
  y: 0,
  z: 0,
  camera: null as Camera | null,
};

/** Ground speed (m/s) above which the body counts as walking. */
export const STEADY_MOVING = 0.15;
/** How long the body must stand still (s) before its head's resting place is taken as the one to hold while walking. */
export const STEADY_REST_S = 1.2;
const STEADY_EASE_S = 0.25;

/** The own body's first-person state (written by LocalPlayer every frame). */
export const fpBody = {
  /** The own avatar's head bone (null until the avatar is up). */
  head: null as Bone | null,
  /** The own avatar group (its label sprites are hidden in first person: the own name tag and bubble sit where the eye is). */
  group: null as Object3D | null,
  /** The model's root inside the group (kept), and the blob shadow's group (kept). */
  keep: [] as Object3D[],
  /** Draw the body headless this frame (first person, the body on screen). */
  active: false,
  /** The head is shrunk right now (until restoreHead). */
  collapsed: false,
  savedScale: new Vector3(1, 1, 1),
  /** Label sprites hidden for this frame (restored with the head). */
  hidden: [] as Object3D[],
  shadow: null as Mesh | null,
  /** The neighbours' body axes (x, z) on the ground (set by LocalPlayer: the remote players as drawn). */
  forEachNeighbour: null as ((fn: (x: number, z: number) => void) => void) | null,
  /** The eye's slide along the head's forward now (1 = the eye point; eased toward neighbourPull), and when it was eased. */
  pull: 1,
  pullAt: 0,
  /** The eye's sideways shift used for the last frame (fpEye.side). */
  side: 0,
  /** DEV/e2e: the last head eye (world) and the correction applied. */
  lastEye: new Vector3(),
  lastFix: new Vector3(),
  /**
   * Owner 2026-11-20: "1인칭뷰로 볼때는 흔들림이 없도록": the head bone bobs with every step (up to 16 cm up and down running, 7 cm
   * sideways), and the eye rode it. On foot the head's offset from the pose's estimate (in the body's frame) is HELD while walking:
   * `rest` is that offset as it stands when the body has stood still a while, `hold` what the eye uses (eased to `rest` when
   * walking begins, so a stand-up from a seat never freezes at the seat's height). Seated or riding, the live head is used.
   */
  hold: new Vector3(),
  rest: new Vector3(),
  hasRest: false,
  haveHold: false,
  stillFor: 0,
  /** DEV/e2e: the hold is off (the live head, as before). */
  steadyOff: false,
};

const eyeV = new Vector3();
const m4 = new Matrix4();
const qBody = new Quaternion();
const sBody = new Vector3();
const pBody = new Vector3();
const boneV = new Vector3();
const rawV = new Vector3();
const qInv = new Quaternion();

/**
 * The head's eye point in world space (the head bone's matrixWorld must be current). `pull` (1 = the eye, 0 = over the neck,
 * below 0 behind it) slides it along the head's forward: see NEIGHBOUR_CLEAR.
 * The point rides on the head bone's position (the walk's bob, the sit, a hop), turned with the BODY (the avatar group, or the
 * head itself without one), not with the head's own nods and sways of the clips: the view does not wobble with them.
 */
export function headEyeWorld(head: Bone, out: Vector3, pull = 1, side = 0): Vector3 {
  const frame = fpBody.group && fpBody.head === head ? fpBody.group : head;
  frame.matrixWorld.decompose(pBody, qBody, sBody);
  out.set((FP_EYE_LOCAL.x + side) * sBody.x, FP_EYE_LOCAL.y * sBody.y, FP_EYE_LOCAL.z * pull * sBody.z).applyQuaternion(qBody);
  return out.add(pBody.setFromMatrixPosition(head.matrixWorld));
}

/**
 * Another player right beside or in front (owner 2026-11-20: "1인칭뷰에서 바로 옆에 있는 상대방도 잘 보이도록 해"): the chibi head is
 * about a metre round and two bodies may stand 0.7 m apart, so an eye pushed forward of the own neck would be inside a neighbour's
 * head. The eye slides back along the head's forward (down to PULL_MIN, a little behind the neck: nothing of the own body is
 * there, the head is shrunk) until it is this far (m, across the ground) from every neighbour's body axis: the widest hair's
 * half width (0.69 m, the curly hair) and the near plane, with a margin.
 */
export const NEIGHBOUR_CLEAR = 0.8;
export const PULL_MIN = -0.4;
/**
 * On the carousel the brass pole and the horse's neck rise right in front of the rider's face, through the middle of the chibi's
 * metre-wide head, and the horse bobs up and down on it: the eye leans a little to one side of them, as a rider looks past the
 * pole (sliding the eye back instead shows the shirt's collar from above when looking down).
 */
export const CAROUSEL_SIDE = 0.26;
const PULL_STEP = 0.1;
const headV = new Vector3();

/** The pull that keeps the eye NEIGHBOUR_CLEAR from every neighbour (1 when none is near). Exported for tests. */
export function neighbourPull(head: Bone, each: ((fn: (x: number, z: number) => void) => void) | null): number {
  if (!each) return 1;
  headEyeWorld(head, eyeV, 1);
  headEyeWorld(head, headV, 0);
  const dx = eyeV.x - headV.x;
  const dz = eyeV.z - headV.z;
  let best = 1;
  let near = false;
  each((x, z) => {
    if (Math.hypot(x - headV.x, z - headV.z) < NEIGHBOUR_CLEAR + Math.hypot(dx, dz)) near = true;
  });
  if (!near) return 1;
  for (let k = 1; k >= PULL_MIN - 1e-9; k -= PULL_STEP) {
    const ex = headV.x + dx * k;
    const ez = headV.z + dz * k;
    let clear = true;
    each((x, z) => {
      if (clear && Math.hypot(x - ex, z - ez) < NEIGHBOUR_CLEAR) clear = false;
    });
    best = k;
    if (clear) return k;
  }
  return best;
}

/** Put the head back as the mixer left it (the start of the player's frame callback, and whenever first person ends). */
export function restoreHead(): void {
  const b = fpBody;
  if (b.collapsed && b.head) {
    // the mixer writes the head's scale every frame (character.glb has a head.scale track): only undo our own write
    if (b.head.scale.x === HEAD_COLLAPSED) b.head.scale.copy(b.savedScale);
    b.head.updateMatrixWorld(true);
  }
  b.collapsed = false;
  for (const o of b.hidden) o.visible = true;
  b.hidden.length = 0;
  if (b.shadow) b.shadow.visible = false;
}

function shadowStandIn(): Mesh {
  const geo = new SphereGeometry(1, 16, 12);
  // no colour and no depth in the view: it is seen only by the shadow map's depth pass
  const mat = new MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false });
  const mesh = new Mesh(geo, mat);
  mesh.name = "fp-head-shadow";
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  mesh.matrixWorldAutoUpdate = false;
  mesh.visible = false;
  mesh.renderOrder = -1000;
  mesh.raycast = () => {};
  return mesh;
}

/**
 * Hold the head bone's walking bob out of `eyeV` (the live eye, qBody the body's turn from headEyeWorld): the eye is the held
 * offset instead of the bone's. Seated, riding or in the walk's absence the eye stays the live head.
 */
function steadyHead(head: Bone, dt: number, fix: typeof fpEye): void {
  const b = fpBody;
  if (b.steadyOff) return;
  boneV.setFromMatrixPosition(head.matrixWorld);
  qInv.copy(qBody).invert();
  rawV.set(boneV.x - fix.x, boneV.y - fix.y, boneV.z - fix.z).applyQuaternion(qInv);
  const k = (tau: number) => 1 - Math.exp(-dt / tau);
  if (!fix.onFoot || !b.haveHold) {
    b.hold.copy(rawV);
    b.haveHold = true;
    b.stillFor = 0;
    if (!fix.onFoot) b.hasRest = false;
  } else if (fix.moving) {
    b.stillFor = 0;
    if (b.hasRest) b.hold.lerp(b.rest, k(STEADY_EASE_S));
  } else {
    b.stillFor += dt;
    if (b.stillFor < STEADY_REST_S) b.hold.lerp(rawV, k(0.15));
    else {
      if (!b.hasRest) {
        b.rest.copy(b.hold);
        b.hasRest = true;
      }
      b.rest.lerp(rawV, k(0.5));
      b.hold.copy(b.rest);
    }
  }
  // eye = live eye - the bone's raw offset + the held one (both turned with the body)
  rawV.sub(b.hold).applyQuaternion(qBody);
  eyeV.sub(rawV);
}

/** The render hook's work (exported for tests): the eye correction once per frame, the head shrunk, the labels hidden. */
export function beforeRender(camera: Camera): void {
  const b = fpBody;
  const head = b.head;
  const fix = fpEye;
  if (head && (fix.armed || b.active) && !b.collapsed) head.updateWorldMatrix(true, false);
  if (fix.armed && fix.camera === camera) {
    fix.armed = false;
    if (head && fix.w > 0) {
      // the slide back from a neighbour's head: quick when it has to go back, slow when it comes forward again
      const want = Math.min(fix.pullMax, neighbourPull(head, b.forEachNeighbour));
      const now = typeof performance === "undefined" ? 0 : performance.now();
      const dt = b.pullAt > 0 ? Math.min(0.1, Math.max(0, (now - b.pullAt) / 1000)) : 1;
      b.pullAt = now;
      b.pull += (want - b.pull) * Math.min(1, dt * (want < b.pull ? 20 : 4));
      b.side = fix.side;
      headEyeWorld(head, eyeV, b.pull, b.side);
      b.lastEye.copy(eyeV);
      steadyHead(head, dt, fix);
      b.lastFix.set((eyeV.x - fix.x) * fix.w, (eyeV.y - fix.y) * fix.w, (eyeV.z - fix.z) * fix.w);
      camera.position.add(b.lastFix);
      camera.updateMatrixWorld();
    } else b.lastFix.set(0, 0, 0);
  }
  if (!b.active || !head || b.collapsed) return;
  // the head's shadow stand-in, placed from the head as it is before it shrinks
  if (b.shadow) {
    m4.makeScale(HEAD_SHADOW.rx, HEAD_SHADOW.ry, HEAD_SHADOW.rz).setPosition(0, HEAD_SHADOW.cy, 0);
    b.shadow.matrixWorld.multiplyMatrices(head.matrixWorld, m4);
    b.shadow.visible = true;
  }
  b.savedScale.copy(head.scale);
  head.scale.setScalar(HEAD_COLLAPSED);
  head.updateMatrixWorld(true);
  b.collapsed = true;
  // the own name tag, speech bubble and emoji hang above the head, at the eye: not drawn in first person
  const g = b.group;
  if (g) {
    for (const c of g.children) {
      if (c.visible && !b.keep.includes(c) && c !== b.shadow) {
        c.visible = false;
        b.hidden.push(c);
      }
    }
  }
}

/**
 * Hook the scene's onBeforeRender (chained with any the scene already has) and add the head's shadow stand-in to `group`.
 * Returns the cleanup.
 */
export function installFpBody(scene: Scene, group: Object3D): () => void {
  const prev = scene.onBeforeRender;
  const shadow = shadowStandIn();
  group.add(shadow);
  fpBody.shadow = shadow;
  // (a Scene's hook is called with the renderer, the scene, the camera and the render target: three's WebGLRenderer.render)
  scene.onBeforeRender = function (this: Scene, ...args: Parameters<Scene["onBeforeRender"]>) {
    prev.apply(this, args);
    beforeRender(args[2]);
  };
  return () => {
    restoreHead();
    scene.onBeforeRender = prev;
    group.remove(shadow);
    shadow.geometry.dispose();
    (shadow.material as MeshBasicMaterial).dispose();
    if (fpBody.shadow === shadow) fpBody.shadow = null;
    fpBody.active = false;
    fpEye.armed = false;
  };
}

/**
 * DEV only (e2e/fp-body.mjs): `window.__cvFpBodyOff = true` brings back the first person as it was before (the own body hidden,
 * the eye at the pose's estimate), to photograph before and after in one run. Tree-shaken in production.
 */
export function fpBodyOff(): boolean {
  return import.meta.env.DEV && typeof window !== "undefined" && (window as unknown as { __cvFpBodyOff?: boolean }).__cvFpBodyOff === true;
}

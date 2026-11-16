// One angler's catch on screen (lake v2): the fish model through the stages of fishCatch.ts — a dark shape under the water, the
// splash where it breaks out, hanging from the line by its mouth (a little pendulum on the rod tip, flapping, dripping), into the
// left hand or the net, held up still flexing, let go into the water. The line's end follows its mouth (fishHooks.ts). The same on
// every screen: it reads only the schema's fields (via fishingRig.ts) and the avatar's own bones.
//
// First person (owner 2026-11-16): the own avatar is hidden in first person, so the fish is not hung on the hidden hands there —
// from the moment the hand takes it, it is held in the lower middle of the view (in front of the camera, nose to the right).

import { CanvasTexture, Mesh, MeshBasicMaterial, MultiplyBlending, PlaneGeometry, Quaternion, Vector3, type Camera, type Object3D } from "three";
import { LAKE_WATER_Y } from "@caysonverse/shared/village/lakeLayout";
import { FISH_PHASE, species, type FishView } from "./lakeProtocol";
import { FISH_VIEW_SCALE, createFishModel, type FishModel } from "./lakeProps";
import { REEL_S, HANG_END_S, catchState, releasePoint, underPos, type CatchState, type Pt3 } from "./fishCatch";
import { setHookPoint } from "./fishHooks";
import { lakeRipple, lakeSplash } from "./lakeFx";
import { cameraProbe } from "../game/cameraProbe";

/** Past this distance from the camera an angler's fish is drawn with the LOD1 model. */
const FAR_M = 22;
const UP = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);

export interface CatchInput {
  view: FishView;
  /** Seconds into the phase. */
  t: number;
  delta: number;
  atSpot: boolean;
  handL: Object3D | null;
  handR: Object3D | null;
  rodTip: Object3D | null;
  netBag: Object3D | null;
  /** The world (the scene): the fish hangs there, in world coordinates. */
  world: Object3D | null;
  /** First person, my own avatar: the camera to hold the fish in front of. */
  fpCamera: Camera | null;
}

export interface CatchRig {
  update(i: CatchInput): void;
  hide(): void;
  dispose(): void;
}

let shadowTex: CanvasTexture | null = null;
/** A soft dark fish shape (seen from above) for the shadow on the surface. */
function shadowTexture(): CanvasTexture {
  if (shadowTex) return shadowTex;
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff";
  g.fillRect(0, 0, 128, 64);
  const grd = g.createRadialGradient(70, 32, 4, 64, 32, 60);
  grd.addColorStop(0, "rgba(20,26,18,0.95)");
  grd.addColorStop(0.55, "rgba(40,48,34,0.55)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.beginPath();
  g.ellipse(68, 32, 52, 15, 0, 0, Math.PI * 2);
  g.fill();
  g.beginPath(); // the tail
  g.moveTo(20, 32);
  g.lineTo(4, 20);
  g.lineTo(4, 44);
  g.closePath();
  g.fillStyle = "rgba(40,48,34,0.5)";
  g.fill();
  shadowTex = new CanvasTexture(c);
  return shadowTex;
}

export function createCatchRig(sid: string): CatchRig {
  let fish: FishModel | null = null;
  let shadow: Mesh | null = null;
  const cs: CatchState = { stage: "none", k: 0, wriggle: 0, beat: 0 };
  const under: Pt3 & { yaw: number } = { x: 0, y: 0, z: 0, yaw: 0 };
  const rel: Pt3 = { x: 0, y: 0, z: 0 };
  // the pendulum (the mouth on the line) and the last poses the blends start from
  const hook = new Vector3();
  const hookV = new Vector3();
  let hookLive = false;
  const lastPos = new Vector3();
  const lastQ = new Quaternion();
  const fromPos = new Vector3();
  const fromQ = new Quaternion();
  let fromStage = "none";
  let flexPhase = 0;
  let lastStage = "none";
  let lastPhase = -1;
  let lastSeq = -1;
  let swirl = 0;
  let drip = 0;
  let dropSplashed = false;
  const tip = new Vector3();
  const a = new Vector3();
  const q = new Quaternion();
  const q2 = new Quaternion();
  const mouth = new Vector3();
  const P = new Vector3();
  const corr = new Vector3();
  const la = new Vector3();
  const lb = new Vector3();
  const lw = new Vector3();
  const lq = new Quaternion();

  const ensure = (world: Object3D) => {
    if (!fish) fish = createFishModel();
    if (fish.root.parent !== world) world.add(fish.root);
    if (!shadow) {
      const mat = new MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false, blending: MultiplyBlending, premultipliedAlpha: true, opacity: 1 });
      shadow = new Mesh(new PlaneGeometry(1, 0.5), mat);
      shadow.rotation.x = -Math.PI / 2;
      shadow.renderOrder = 3;
      shadow.frustumCulled = false;
    }
    if (shadow.parent !== world) world.add(shadow);
  };

  /** Nose along `dir` (world), back up as far as it can be. */
  const lookAlong = (dir: Vector3, roll: number, out: Quaternion): Quaternion => {
    const d = la.copy(dir).normalize();
    out.setFromUnitVectors(Z, d);
    // keep the back up: turn about the nose so the fish's +Y is as near the world's up as the nose allows
    const upNow = lb.set(0, 1, 0).applyQuaternion(out);
    const want = lw.copy(UP).addScaledVector(d, -UP.dot(d));
    if (want.lengthSq() > 1e-6) {
      want.normalize();
      const ang = Math.atan2(lb.clone().cross(want).dot(d), upNow.dot(want));
      out.premultiply(lq.setFromAxisAngle(d, ang));
    }
    if (roll) out.premultiply(lq.setFromAxisAngle(d, roll));
    return out;
  };

  const hide = () => {
    if (fish) fish.root.visible = false;
    if (shadow) shadow.visible = false;
    if (hookLive) setHookPoint(sid, null);
    hookLive = false;
  };

  return {
    hide,
    update(i) {
      const { view, t, delta } = i;
      const sp = species(view.kind);
      catchState(view, t, cs);
      if (!i.atSpot || !sp || cs.stage === "none" || !i.world) {
        hide();
        lastStage = "none";
        return;
      }
      ensure(i.world);
      const f = fish!;
      const sh = shadow!;
      f.setCm(view.cm);
      f.setKind(view.kind, sp.color);
      const len = (view.cm / 100) * FISH_VIEW_SCALE; // the drawn length
      const newCatch = view.seq !== lastSeq || view.phase !== lastPhase;
      if (view.seq !== lastSeq) dropSplashed = false;
      lastSeq = view.seq;
      lastPhase = view.phase;
      if (cs.stage !== lastStage) {
        fromPos.copy(lastPos);
        fromQ.copy(lastQ);
        fromStage = lastStage;
      }
      const stageChanged = cs.stage !== lastStage;
      // the tail beat
      flexPhase += delta * cs.beat * Math.PI * 2;
      const bend = cs.stage === "net" ? 0.12 : cs.stage === "line" || cs.stage === "toHand" ? Math.sin(t * 2.3) * 0.08 : 0;
      f.setFlex(flexPhase, 0.075 * cs.wriggle, bend);
      const camD = Math.hypot(cameraProbe.x - lastPos.x, cameraProbe.y - lastPos.y, cameraProbe.z - lastPos.z);
      f.setFar(!i.fpCamera && camD > FAR_M);

      const pos = P.set(0, 0, 0);
      const rot = q.identity();
      let showShadow = false;
      const rodTip = i.rodTip;
      if (rodTip) rodTip.getWorldPosition(tip);

      switch (cs.stage) {
        case "under":
        case "surface": {
          if (!underPos(view, view.phase === FISH_PHASE.lifting ? Math.min(t, REEL_S) : t, under)) break;
          const surf = cs.stage === "surface";
          pos.set(under.x, surf ? LAKE_WATER_Y - 0.03 * len + Math.max(0, Math.sin(t * 9)) * 0.06 : under.y, under.z);
          // a breach out of the water (lifting): it leaps up toward the rod
          if (view.phase === FISH_PHASE.lifting && surf) pos.y = LAKE_WATER_Y + ((t - REEL_S) / 0.16) * 0.25;
          const dir = a.set(Math.sin(under.yaw), surf ? 0.25 : 0, Math.cos(under.yaw));
          lookAlong(dir, surf ? Math.sin(t * 11) * 0.9 : Math.sin(t * 3) * 0.15, rot);
          showShadow = !surf;
          // swirls on the surface over it; splashes when it thrashes
          swirl -= delta;
          if (swirl <= 0) {
            swirl = surf ? 0.22 : 0.5;
            lakeRipple(pos.x, pos.z, surf ? 0.9 : 0.45);
            if (surf) lakeSplash(pos.x, LAKE_WATER_Y, pos.z, 6, 0.8 + len);
          }
          if (stageChanged && surf) {
            lakeRipple(pos.x, pos.z, 1.3);
            lakeSplash(pos.x, LAKE_WATER_Y, pos.z, 26, 1.2 + len);
          }
          // the line's end: the mouth
          mouth.set(0, 0, 0.5 * len).applyQuaternion(rot).add(pos);
          hook.copy(mouth);
          hookV.set(0, view.phase === FISH_PHASE.lifting ? 2.4 : 0, 0);
          break;
        }
        case "line": {
          // a pendulum: the mouth on a line from the rod tip that is reeled in to 0.75 m
          const k = Math.min(1, (t - REEL_S - 0.16) / (HANG_END_S - REEL_S - 0.16));
          const L0 = Math.max(0.8, tip.y - LAKE_WATER_Y);
          const L = L0 + (0.75 - L0) * (k * k * (3 - 2 * k));
          if (!rodTip) break;
          if (stageChanged && fromStage !== "surface") {
            hook.set(tip.x, tip.y - L, tip.z);
            hookV.set(0, 0, 0);
          }
          const dt = Math.min(delta, 1 / 30);
          hookV.y -= 9.8 * dt;
          hookV.multiplyScalar(1 - 0.9 * dt);
          hook.addScaledVector(hookV, dt);
          // the line: never longer than L (a rope: it pulls, never pushes)
          a.copy(hook).sub(tip);
          const d = a.length();
          if (d > L && d > 1e-6) {
            a.multiplyScalar(L / d);
            corr.copy(tip).add(a).sub(hook);
            hook.add(corr);
            hookV.addScaledVector(corr, 1 / Math.max(dt, 1e-3));
            // remove the outward speed along the line
            const n = a.normalize();
            const out = hookV.dot(n);
            if (out > 0) hookV.addScaledVector(n, -out);
          }
          // hanging by the mouth: nose up toward the tip, the body below, flapping (roll about the line)
          const up = a.copy(tip).sub(hook).normalize();
          lookAlong(up, Math.sin(t * 7.5) * 0.35, rot);
          pos.copy(hook).addScaledVector(up, -0.5 * len);
          drip -= delta;
          if (drip <= 0) {
            drip = 0.05;
            const tailEnd = a.copy(hook).addScaledVector(up, -len);
            lakeSplash(tailEnd.x, tailEnd.y, tailEnd.z, 1, 0, true);
          }
          break;
        }
        case "toHand":
        case "hand":
        case "net":
        case "show": {
          let target: Vector3 | null = null;
          const tq = q2;
          if (i.fpCamera) {
            // first person: held in the lower middle of the view, side on, nose to the right
            const cam = i.fpCamera;
            cam.updateMatrixWorld();
            const fwd = a.set(0, 0, -1).applyQuaternion(cam.quaternion);
            const right = new Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
            const camUp = new Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
            const dist = 0.55 + len * 0.55;
            target = new Vector3().setFromMatrixPosition(cam.matrixWorld).addScaledVector(fwd, dist).addScaledVector(camUp, -0.16 - len * 0.12);
            const nose = right.clone().addScaledVector(fwd, -0.15).normalize();
            lookAlong(nose, 0, tq);
            // the flank toward the camera: roll so the fish's +X (its right flank) faces back at the camera
            const flank = new Vector3(1, 0, 0).applyQuaternion(tq);
            const toCam = fwd.clone().negate();
            const ang = Math.atan2(flank.clone().cross(toCam).dot(nose), flank.dot(toCam));
            tq.premultiply(new Quaternion().setFromAxisAngle(nose, ang + Math.sin(t * 6) * 0.08));
          } else if (cs.stage === "net" && i.netBag) {
            target = i.netBag.getWorldPosition(new Vector3()).add(new Vector3(0, -0.06, 0));
            const side = i.handR && i.handL ? i.handR.getWorldPosition(new Vector3()).sub(i.handL.getWorldPosition(new Vector3())) : new Vector3(1, 0, 0);
            side.y = 0;
            lookAlong(side.lengthSq() > 1e-6 ? side : new Vector3(1, 0, 0), 1.2, tq);
          } else if ((cs.stage === "toHand" || cs.stage === "hand") && i.handL) {
            target = i.handL.getWorldPosition(new Vector3()).add(new Vector3(0, -0.04, 0));
            // held by the head, hanging, swinging a little
            const hang = new Vector3(Math.sin(t * 3.1) * 0.25, 1, Math.cos(t * 2.4) * 0.2).normalize();
            lookAlong(hang, Math.sin(t * 6) * 0.3, tq);
            target.addScaledVector(hang, -0.42 * len);
          } else if (i.handL && i.handR) {
            const l = i.handL.getWorldPosition(new Vector3());
            const r = i.handR.getWorldPosition(new Vector3());
            target = l.clone().add(r).multiplyScalar(0.5).add(new Vector3(0, 0.07, 0));
            const dir = r.sub(l);
            if (dir.lengthSq() < 1e-4) dir.set(1, 0, 0);
            lookAlong(dir, 0, tq);
          }
          if (!target) break;
          // the blends: from the line into the hand, from the surface into the net
          const k = cs.stage === "toHand" || cs.stage === "net" ? cs.k : 1;
          if (k < 1 && (fromStage === "line" || fromStage === "surface" || fromStage === "toHand")) {
            pos.copy(fromPos).lerp(target, k);
            pos.y += Math.sin(k * Math.PI) * 0.15;
            rot.copy(fromQ).slerp(tq, k);
          } else {
            pos.copy(target);
            rot.copy(tq);
          }
          if (cs.stage === "net" && stageChanged) lakeSplash(pos.x, LAKE_WATER_Y, pos.z, 20, 1.4);
          drip -= delta;
          if (drip <= 0 && pos.y > LAKE_WATER_Y + 0.1) {
            drip = cs.stage === "show" ? 0.22 : 0.09;
            const down = a.set(0, 0, -0.45 * len).applyQuaternion(rot).add(pos);
            lakeSplash(down.x, down.y - 0.02, down.z, 1, 0, true);
          }
          // the line follows the fish into the hand
          mouth.set(0, 0, 0.5 * len).applyQuaternion(rot).add(pos);
          hook.copy(mouth);
          break;
        }
        case "drop": {
          if (!releasePoint(view.spot, rel)) break;
          // from where the hands let go, an arc into the water, turning nose down
          const k = cs.k;
          const start = fromStage === "show" ? fromPos : lastPos;
          pos.set(start.x + (rel.x - start.x) * k, start.y + (rel.y - start.y) * k + Math.sin(k * Math.PI) * 0.35, start.z + (rel.z - start.z) * k);
          const dir = a.set(rel.x - start.x, -1.2 * k, rel.z - start.z);
          if (dir.lengthSq() < 1e-6) dir.set(0, -1, 0);
          lookAlong(dir, Math.sin(t * 9) * 0.5, rot);
          if (k > 0.92 && !dropSplashed) {
            dropSplashed = true;
            lakeRipple(rel.x, rel.z, 1.2);
            lakeSplash(rel.x, LAKE_WATER_Y, rel.z, 22, 1.3);
          }
          break;
        }
        default:
          break;
      }
      f.root.position.copy(pos);
      f.root.quaternion.copy(rot);
      // under the water the model is drawn too (the murky water hides most of it): the shadow on the surface reads as a dark shape
      f.root.visible = true;
      if (showShadow) {
        sh.visible = true;
        sh.position.set(pos.x, LAKE_WATER_Y + 0.012, pos.z);
        sh.rotation.set(-Math.PI / 2, 0, under.yaw - Math.PI / 2);
        sh.scale.set(len * 1.2, len * 1.2, 1);
        (sh.material as MeshBasicMaterial).opacity = 1;
      } else sh.visible = false;
      lastPos.copy(pos);
      lastQ.copy(rot);
      lastStage = cs.stage;
      // the line's end: the mouth while the fish is on it
      const onLine = cs.stage === "under" || cs.stage === "surface" || cs.stage === "line";
      setHookPoint(sid, onLine ? hook : null);
      hookLive = onLine;
      void newCatch;
    },
    dispose() {
      hide();
      if (fish) {
        fish.root.removeFromParent();
        fish.dispose();
        fish = null;
      }
      if (shadow) {
        shadow.removeFromParent();
        shadow.geometry.dispose();
        (shadow.material as MeshBasicMaterial).dispose();
        shadow = null;
      }
    },
  };
}

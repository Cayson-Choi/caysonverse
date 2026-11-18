// The angler's arm on the rod (owner 2026-11-19: "팔과 손이 뭔가 많이 꺽여 있는 느낌", "낚시대를 잡은 손이 어색"): measured in the shipped
// fishing_anims.glb with every rod clip sampled densely — the right wrist is never bent more than 35 degrees (the forearm and the hand's finger
// axis stay nearly in line), the rod lies along the forearm (cocked up by ROD_COCK_DEG plus what the steep poses need), the elbow stays in a
// natural range. fishing_anims.py makes the poses from these rules; this fails first if a re-export breaks them.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AnimationMixer, LoopOnce, Quaternion, Vector3, type Object3D } from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { FISHING_CLIPS, ROD_AXIS_R, ROD_COCK_DEG, GRIP_OFFSET, ROD_HAND_AT } from "@caysonverse/shared/village/fishingAnims";

const GLB = fileURLToPath(new URL("../../public/models/lake/fishing_anims.glb", import.meta.url));
const ROD_CLIPS = ["Fish_Sit_Idle", "Fish_Sit_Cast", "Fish_Sit_Strike", "Fish_Sit_Fight", "Fish_Sit_Lift", "Fish_Net", "Carry_Rod"] as const;
const deg = (r: number): number => (r * 180) / Math.PI;

async function load(): Promise<GLTF> {
  const buf = readFileSync(GLB);
  return new Promise((res, rej) => new GLTFLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, "", res, rej));
}

interface Sample {
  clip: string;
  t: number;
  wristBend: number;
  rodVsForearm: number;
  elbow: number;
}

async function samples(): Promise<Sample[]> {
  const gltf = await load();
  const root: Object3D = gltf.scene;
  const bone = (n: string): Object3D => root.getObjectByName(n)!;
  const out: Sample[] = [];
  const P = (n: string): Vector3 => bone(n).getWorldPosition(new Vector3());
  for (const name of ROD_CLIPS) {
    const clip = gltf.animations.find((c) => c.name === name)!;
    const mixer = new AnimationMixer(root);
    const action = mixer.clipAction(clip);
    action.setLoop(LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    const dur = FISHING_CLIPS[name].seconds;
    for (let t = 0; t <= dur + 1e-6; t += dur / 40) {
      mixer.setTime(Math.min(t, dur - 1e-4));
      root.updateMatrixWorld(true);
      const s = P("upperarmr");
      const e = P("lowerarmr");
      const w = P("wristr");
      const forearm = w.clone().sub(e).normalize();
      const q = bone("handslotr").getWorldQuaternion(new Quaternion());
      const fingers = new Vector3(1, 0, 0).applyQuaternion(q);
      const rod = new Vector3(...ROD_AXIS_R).normalize().applyQuaternion(q);
      out.push({
        clip: name,
        t,
        wristBend: deg(fingers.angleTo(forearm)),
        rodVsForearm: deg(rod.angleTo(forearm)),
        elbow: deg(e.clone().sub(s).normalize().angleTo(w.clone().sub(e).normalize())),
      });
    }
  }
  return out;
}

describe("the right arm on the rod, in every rod clip", () => {
  it("the wrist is never bent more than 35 degrees (forearm and hand in line)", async () => {
    const all = await samples();
    const worst = all.reduce((a, b) => (b.wristBend > a.wristBend ? b : a));
    expect(worst.wristBend, `${worst.clip} @ ${worst.t.toFixed(2)} s`).toBeLessThan(35);
  }, 60000);

  it("the rod lies along the forearm: within 45 degrees of it, at least the designed cock in the calm pose", async () => {
    const all = await samples();
    const worst = all.reduce((a, b) => (b.rodVsForearm > a.rodVsForearm ? b : a));
    expect(worst.rodVsForearm, `${worst.clip} @ ${worst.t.toFixed(2)} s`).toBeLessThan(45);
    const idle = all.filter((x) => x.clip === "Fish_Sit_Idle");
    for (const x of idle) expect(Math.abs(x.rodVsForearm - ROD_COCK_DEG)).toBeLessThan(4);
  }, 60000);

  it("the elbow stays in a relaxed range (40..130 degrees of bend; 110 at most while waiting)", async () => {
    const all = await samples();
    for (const x of all) {
      expect(x.elbow, `${x.clip} @ ${x.t.toFixed(2)} s`).toBeGreaterThan(40);
      expect(x.elbow, `${x.clip} @ ${x.t.toFixed(2)} s`).toBeLessThan(130);
    }
    for (const x of all.filter((y) => y.clip === "Fish_Sit_Idle")) expect(x.elbow).toBeLessThan(110);
  }, 60000);

  it("the grip: the hand holds the rod ROD_HAND_AT along its axis (the butt is inside the forearm, not out behind the hand)", () => {
    const u = new Vector3(...ROD_AXIS_R).normalize();
    const root = new Vector3(...GRIP_OFFSET); // where the rod's own origin is in the slot frame
    const handAt = root.clone().addScaledVector(u, ROD_HAND_AT); // the point of the rod at the hand = the slot origin
    expect(handAt.length()).toBeLessThan(1e-3);
    const butt = -0.338 - ROD_HAND_AT; // how far the handle's end is behind the hand (m)
    expect(Math.abs(butt)).toBeLessThan(0.26); // within the forearm's length
  });
});

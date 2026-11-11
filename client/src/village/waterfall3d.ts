import {
  AdditiveBlending,
  BufferGeometry,
  CatmullRomCurve3,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector3,
  type Camera,
  type Object3D,
} from "three";
import type { VillageTier } from "./villageModelPrep";

/** The waterfall is outside the walk bounds, so it can be richer without adding collision cost. */
const FALL = { x: -118, z: -78, width: 28, height: 36 } as const;

export interface Waterfall3D {
  group: Group;
  update(seconds: number, camera: Camera): void;
  dispose(): void;
}

function rand(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function streamMaterial(name: string, opacity: number): MeshBasicMaterial {
  return new MeshBasicMaterial({
    name,
    color: 0x9edcff,
    transparent: true,
    opacity,
    depthWrite: false,
    side: DoubleSide,
    blending: AdditiveBlending,
    fog: true,
  });
}

/** Build a layered, curved fall: rounded water strands, plunge foam, and a volumetric spray field. */
export function createWaterfall3D(tier: VillageTier): Waterfall3D {
  const group = new Group();
  group.name = "waterfall_3d";
  group.position.set(FALL.x, 0, FALL.z);
  const own: Array<{ dispose(): void }> = [];
  const streams: Mesh[] = [];

  const main = streamMaterial("M_waterfall_3d", tier === "high" ? 0.62 : 0.5);
  own.push(main);
  // Three offset curtains create thickness from the east-facing valley camera instead of one stretched card.
  for (let i = 0; i < 3; i++) {
    const z = (i - 1) * FALL.width * 0.25;
    const curve = new CatmullRomCurve3([
      new Vector3(-0.25 + i * 0.12, FALL.height - 0.4, z),
      new Vector3(0.08 + i * 0.08, FALL.height * 0.72, z + 0.7),
      new Vector3(0.18, FALL.height * 0.34, z - 0.45),
      new Vector3(0.35, 0.28, z + 0.15),
    ]);
    const tube = new TubeGeometry(curve, tier === "high" ? 40 : 20, tier === "high" ? 0.24 : 0.32, 6, false);
    const mesh = new Mesh(tube, main);
    mesh.name = `waterfall_stream_${i}`;
    mesh.renderOrder = 4 + i;
    group.add(mesh);
    own.push(tube);
    streams.push(mesh);
  }

  const foamMat = new MeshBasicMaterial({
    name: "M_waterfall_foam",
    color: 0xd9f6ff,
    transparent: true,
    opacity: tier === "high" ? 0.58 : 0.42,
    depthWrite: false,
    side: DoubleSide,
    blending: AdditiveBlending,
    fog: true,
  });
  const foam = new Mesh(new TorusGeometry(2.8, 0.16, 6, tier === "high" ? 32 : 16), foamMat);
  foam.name = "waterfall_plunge_foam";
  foam.rotation.x = Math.PI / 2;
  foam.position.set(0.4, 0.08, 0.1);
  foam.renderOrder = 8;
  group.add(foam);
  own.push(foam.geometry, foamMat);

  const count = tier === "high" ? 96 : 28;
  const positions = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  const sizes = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    phases[i] = rand(i + 11);
    sizes[i] = 0.03 + rand(i + 31) * 0.07;
    positions[i * 3] = 0.2 + rand(i + 51) * 0.55;
    positions[i * 3 + 1] = rand(i + 71) * FALL.height;
    positions[i * 3 + 2] = (rand(i + 91) - 0.5) * FALL.width * 0.75;
  }
  const particleGeo = new BufferGeometry();
  particleGeo.setAttribute("position", new Float32BufferAttribute(positions, 3));
  const particleMat = new PointsMaterial({
    name: "M_waterfall_spray",
    color: 0xd6f7ff,
    transparent: true,
    opacity: tier === "high" ? 0.66 : 0.4,
    size: tier === "high" ? 0.14 : 0.1,
    sizeAttenuation: true,
    depthWrite: false,
    blending: AdditiveBlending,
    fog: true,
  });
  const spray = new Points(particleGeo, particleMat);
  spray.name = "waterfall_spray";
  spray.renderOrder = 9;
  group.add(spray);
  own.push(particleGeo, particleMat);

  const mistMat = new MeshBasicMaterial({
    name: "M_waterfall_mist",
    color: 0xbfefff,
    transparent: true,
    opacity: tier === "high" ? 0.12 : 0.07,
    depthWrite: false,
    blending: AdditiveBlending,
    fog: true,
  });
  const mistGeo = new SphereGeometry(1.2, tier === "high" ? 12 : 8, tier === "high" ? 8 : 5);
  const mist: Mesh[] = [];
  for (let i = 0; i < (tier === "high" ? 5 : 2); i++) {
    const m = new Mesh(mistGeo, mistMat);
    m.name = `waterfall_mist_${i}`;
    m.position.set(0.8 + i * 0.25, 0.25 + i * 0.08, (i - 2) * 0.7);
    m.scale.set(1.2 + i * 0.15, 0.45, 0.8);
    group.add(m);
    mist.push(m);
  }
  own.push(mistGeo, mistMat);

  return {
    group,
    update(seconds, camera) {
      const d = camera.position.distanceTo(group.position);
      const near = Math.max(0, Math.min(1, 1 - (d - 45) / 65));
      main.opacity = (tier === "high" ? 0.35 : 0.28) + near * 0.3;
      particleMat.opacity = (tier === "high" ? 0.22 : 0.14) + near * 0.45;
      const pos = particleGeo.getAttribute("position") as Float32BufferAttribute;
      for (let i = 0; i < count; i++) {
        const phase = phases[i]!;
        const y = ((phase + seconds * (0.16 + 0.08 * rand(i + 121))) % 1) * FALL.height;
        pos.setY(i, y);
        pos.setX(i, 0.2 + 0.3 * Math.sin(seconds * 1.4 + phase * 9));
        pos.setZ(i, positions[i * 3 + 2]! + 0.12 * Math.sin(seconds * 2.1 + phase * 13));
      }
      pos.needsUpdate = true;
      for (let i = 0; i < mist.length; i++) mist[i]!.position.x = 0.8 + i * 0.25 + Math.sin(seconds * 0.45 + i) * 0.15;
    },
    dispose() {
      for (const item of own) item.dispose();
    },
  };
}

/** Hide the stretched GLB waterfall sheets and the crossed mist cards. */
export function hideWaterfallCards(root: Object3D): Object3D[] {
  const hidden: Object3D[] = [];
  root.traverse((o) => {
    if (!("material" in o)) return;
    const materials = Array.isArray((o as { material?: unknown }).material)
      ? ((o as { material: unknown[] }).material)
      : [(o as { material?: { name?: string } }).material];
    if (materials.some((m) => (m as { name?: string } | undefined)?.name === "M_waterfall")) {
      o.visible = false;
      hidden.push(o);
    }
  });
  return hidden;
}


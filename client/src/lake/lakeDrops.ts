// Water drops (lake v2): the spray of a splash and the drips off a fish, as two point clouds of soft round sprites (one draw call
// each). Ballistic; a drop is gone when it falls back to the water. Allocation-free per frame.

import { AdditiveBlending, BufferGeometry, CanvasTexture, Float32BufferAttribute, NormalBlending, Points, PointsMaterial, type Texture } from "three";

let dropTex: Texture | null = null;
function dropTexture(): Texture {
  if (dropTex) return dropTex;
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const g = c.getContext("2d")!;
  const r = g.createRadialGradient(13, 12, 1, 16, 16, 15);
  r.addColorStop(0, "rgba(255,255,255,1)");
  r.addColorStop(0.35, "rgba(230,244,255,0.85)");
  r.addColorStop(1, "rgba(200,225,245,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 32, 32);
  dropTex = new CanvasTexture(c);
  return dropTex;
}

export interface Drops {
  points: Points;
  /** `n` drops at (x, y, z): thrown up and out by `power` (0 = just let fall, a drip). */
  emit(x: number, y: number, z: number, n: number, power: number): void;
  /** Move them; `floorY` the water. */
  step(delta: number, floorY: number): void;
  dispose(): void;
}

export function createDrops(max: number, size: number, opacity: number, additive = false): Drops {
  const pos = new Float32Array(max * 3).fill(-1000);
  const vel = new Float32Array(max * 3);
  const life = new Float32Array(max);
  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(pos, 3));
  const mat = new PointsMaterial({ map: dropTexture(), color: "#eef7ff", size, transparent: true, opacity, depthWrite: false, sizeAttenuation: true, blending: additive ? AdditiveBlending : NormalBlending });
  const points = new Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 4;
  let next = 0;
  let live = 0;
  return {
    points,
    emit(x, y, z, n, power) {
      for (let k = 0; k < n; k++) {
        const i = next;
        next = (next + 1) % max;
        pos[i * 3] = x + (Math.random() - 0.5) * 0.06;
        pos[i * 3 + 1] = y;
        pos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.06;
        const a = Math.random() * Math.PI * 2;
        const out = (0.3 + Math.random() * 1.0) * power;
        vel[i * 3] = Math.cos(a) * out * 0.7;
        vel[i * 3 + 1] = power > 0 ? (1.2 + Math.random() * 2.0) * power : -0.2 - Math.random() * 0.4;
        vel[i * 3 + 2] = Math.sin(a) * out * 0.7;
        life[i] = power > 0 ? 0.9 : 1.6;
      }
      live = max;
    },
    step(delta, floorY) {
      if (live <= 0) return;
      let any = 0;
      for (let i = 0; i < max; i++) {
        if (life[i]! <= 0) continue;
        any++;
        life[i] = life[i]! - delta;
        vel[i * 3 + 1] = vel[i * 3 + 1]! - 9.8 * delta;
        pos[i * 3] = pos[i * 3]! + vel[i * 3]! * delta;
        pos[i * 3 + 1] = pos[i * 3 + 1]! + vel[i * 3 + 1]! * delta;
        pos[i * 3 + 2] = pos[i * 3 + 2]! + vel[i * 3 + 2]! * delta;
        if (pos[i * 3 + 1]! < floorY || life[i]! <= 0) {
          life[i] = 0;
          pos[i * 3 + 1] = -1000;
        }
      }
      (geo.getAttribute("position") as Float32BufferAttribute).needsUpdate = true;
      if (any === 0) live = 0;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}

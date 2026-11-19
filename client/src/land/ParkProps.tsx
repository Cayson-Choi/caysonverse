import { useEffect, useMemo } from "react";
import { CanvasTexture, MeshStandardMaterial, PlaneGeometry, SRGBColorSpace, type Texture } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { PARK_BINS, PARK_KIOSK, PARK_LAMPS, PARK_PLANTERS } from "@caysonverse/shared/village/parkArea";
import { GeoBuilder, type V3 } from "./geoBuilder";
import { addLathe } from "./parkShapes";
import { parkMaterial, pickSet } from "./pbr";
import { Booth, type BoothSpec } from "./ParkBooth";

const X: V3 = [1, 0, 0];
const Y: V3 = [0, 1, 0];
const bannerPosts = PARK_LAMPS.filter((l) => l.x > 30 && l.x < 50 && l.z < -138);

/** Each bin has a rolled mouth, a recessed liner and a rain hood on two stays. */
function addBin(b: GeoBuilder, x: number, z: number) {
  const enamel: V3 = [0.055, 0.16, 0.105];
  const trim: V3 = [0.47, 0.33, 0.13];
  addLathe(b, x, z, [[0.28, 0], [0.31, 0.04], [0.31, 0.12], [0.33, 0.82], [0.35, 0.84],
    [0.35, 0.865], [0.335, 0.88], [0.285, 0.875]], enamel, 1, 24);
  addLathe(b, x, z, [[0.285, 0.875], [0.272, 0.84], [0.255, 0.49], [0, 0.485]], [0.028, 0.033, 0.031], 1, 24);
  addLathe(b, x, z, [[0.323, 0.68], [0.332, 0.686], [0.333, 0.704], [0.324, 0.71]], trim, 1, 24);
  for (const dx of [-0.27, 0.27]) {
    b.box([x + dx, 0.962, z], X, Y, 0.018, 0.115, 0.027, trim);
  }
  addLathe(b, x, z, [[0, 1.061], [0.35, 1.055], [0.362, 1.069], [0.352, 1.093],
    [0.27, 1.125], [0.15, 1.147], [0, 1.154]], enamel, 1, 24);
}

function bannerTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 384;
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, 384);
  g.addColorStop(0, "#4B4FD8");
  g.addColorStop(1, "#2f3399");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 384);
  ctx.fillStyle = "#f2c14e";
  ctx.fillRect(0, 0, 128, 14);
  ctx.fillRect(0, 370, 128, 14);
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 44 : 18;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    ctx.lineTo(64 + Math.cos(a) * r, 120 + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#f3efea";
  ctx.font = "bold 40px 'Jua', 'Malgun Gothic', 'Noto Sans KR', sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("케이슨", 64, 240);
  ctx.fillText("랜드", 64, 290);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** People-scale props: the ticket kiosk by the arch, litter bins, stone planters with shrubs, and pennant banners on the promenade's lamp posts. */
export function ParkProps({ all }: { all: Texture[] }) {
  const geo = useMemo(() => {
    const b = new GeoBuilder();
    // planters: a stone trough with a cap, a bed of soil, a clipped round shrub and flowers
    for (const p of PARK_PLANTERS) {
      b.box([p.x, 0.4, p.z], X, Y, p.w / 2, 0.4, p.d / 2, [0.74, 0.72, 0.68], 2);
      b.box([p.x, 0.82, p.z], X, Y, p.w / 2 + 0.08, 0.05, p.d / 2 + 0.08, [0.82, 0.8, 0.76]);
      // (the soil and the flowers are the village flower system's: ParkVegetation plants these troughs)
    }
    return b.build();
  }, []);
  const stone = useMemo(() => parkMaterial(pickSet(all, "PaintedPlaster017"), 1.4, { vertexColors: true, normalScale: 0.8 }), [all]);
  // pennant banners hung from arms on the promenade's lamp posts
  const tex = useMemo(() => bannerTexture(), []);
  const bannerMat = useMemo(() => new MeshStandardMaterial({ map: tex, roughness: 0.85 }), [tex]);
  const bannerGeo = useMemo(() => {
    // Both printed sides follow the same folds. The sewn top sleeve stays on the crossbar.
    const faces = bannerPosts.flatMap((post, i) => {
      const x = post.x + (post.x < 40 ? 0.9 : -0.9);
      return [0, Math.PI].map((yaw) => {
        const face = new PlaneGeometry(0.8, 2.4, 10, 8).rotateY(yaw);
        const p = face.getAttribute("position");
        for (let k = 0; k < p.count; k++) {
          const u = p.getX(k) / 0.8 + 0.5;
          const drop = 0.5 - p.getY(k) / 2.4;
          const pleat = Math.sin(u * 10.5 + 1.2 * drop + i * 1.7);
          const billow = 0.10 * Math.sin(Math.PI * drop) + drop * (0.08 + 0.12 * pleat);
          p.setXYZ(k, x + p.getX(k) + 0.055 * drop * drop, 2.27 + p.getY(k) + 0.035 * drop * pleat, post.z + billow);
        }
        face.computeVertexNormals();
        return face;
      });
    });
    const cloth = mergeGeometries(faces);
    faces.forEach((f) => f.dispose());
    return cloth;
  }, []);
  useEffect(() => () => {
    bannerGeo.dispose();
    bannerMat.dispose();
    tex.dispose();
  }, [bannerGeo, bannerMat, tex]);
  const armGeo = useMemo(() => {
    const b = new GeoBuilder();
    for (const {x, z} of PARK_BINS) addBin(b, x, z);
    for (const l of bannerPosts) {
      const dir = l.x < 40 ? 1 : -1;
      const metal: V3 = [0.15, 0.16, 0.22];
      b.cylinder([l.x, 3.5, l.z], [l.x + dir * 1.37, 3.5, l.z], 0.038, 0.035, 10, metal, true);
      b.cylinder([l.x + dir * 0.06, 3.18, l.z], [l.x + dir * 0.48, 3.49, l.z], 0.018, 0.018, 7, metal);
    }
    return b.build();
  }, []);
  const armMat = useMemo(() => new MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.3 }), []);
  const kiosk = useMemo<BoothSpec>(
    () => ({ x: PARK_KIOSK.x, z: PARK_KIOSK.z, w: PARK_KIOSK.w, d: PARK_KIOSK.d, kind: "snack", plaster: "#f4e2c2", tile: "#ffb99a", title: "별빛 간식", sub: "SNACKS · DRINKS", stripes: [[0.3, 0.34, 0.8], [0.97, 0.94, 0.88]] }),
    [],
  );
  return (
    <group>
      <Booth all={all} spec={kiosk} />
      <mesh geometry={geo} material={stone} castShadow receiveShadow />
      <mesh geometry={armGeo} material={armMat} castShadow receiveShadow />
      <mesh geometry={bannerGeo} material={bannerMat} castShadow receiveShadow />
    </group>
  );
}

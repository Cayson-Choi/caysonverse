import { useEffect, useMemo } from "react";
import { CanvasTexture, MeshStandardMaterial, PlaneGeometry, SRGBColorSpace, type Texture } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { PARK_BINS, PARK_KIOSK, PARK_LAMPS, PARK_PLANTERS } from "@caysonverse/shared/village/parkArea";
import { GeoBuilder, type V3 } from "./geoBuilder";
import { parkMaterial, pickSet } from "./pbr";
import { Booth, type BoothSpec } from "./ParkBooth";

const X: V3 = [1, 0, 0];
const Y: V3 = [0, 1, 0];

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
    // litter bins: a barrel in dark green with a domed lid and a band
    for (const bin of PARK_BINS) {
      b.cylinder([bin.x, 0.05, bin.z], [bin.x, 0.95, bin.z], 0.3, 0.34, 12, [0.16, 0.34, 0.24]);
      b.cylinder([bin.x, 0.95, bin.z], [bin.x, 1.12, bin.z], 0.36, 0.2, 12, [0.12, 0.26, 0.19], true);
      b.cylinder([bin.x, 0.55, bin.z], [bin.x, 0.62, bin.z], 0.345, 0.345, 12, [0.8, 0.7, 0.3]);
    }
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
  const posts = useMemo(() => PARK_LAMPS.filter((l) => l.x > 30 && l.x < 50 && l.z < -138), []);
  const bannerGeo = useMemo(() => {
    // Print each face in its own reading direction and draw the whole promenade together.
    const faces = posts.flatMap((post) => {
      const x = post.x + (post.x < 40 ? 0.9 : -0.9);
      return [0, Math.PI].map((yaw) => new PlaneGeometry(0.8, 2.4).rotateY(yaw).translate(x, 2.35, post.z));
    });
    return mergeGeometries(faces);
  }, [posts]);
  useEffect(() => () => {
    bannerGeo.dispose();
    bannerMat.dispose();
    tex.dispose();
  }, [bannerGeo, bannerMat, tex]);
  const armGeo = useMemo(() => {
    const b = new GeoBuilder();
    for (const l of posts) b.box([l.x + (l.x < 40 ? 0.5 : -0.5), 3.5, l.z], X, Y, 0.5, 0.03, 0.03, [0.15, 0.16, 0.22]);
    return b.build();
  }, [posts]);
  const armMat = useMemo(() => new MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.3 }), []);
  const kiosk = useMemo<BoothSpec>(
    () => ({ x: PARK_KIOSK.x, z: PARK_KIOSK.z, w: PARK_KIOSK.w, d: PARK_KIOSK.d, kind: "snack", plaster: "#f4e2c2", tile: "#ffb99a", title: "별빛 간식", sub: "SNACKS · DRINKS", stripes: [[0.3, 0.34, 0.8], [0.97, 0.94, 0.88]] }),
    [],
  );
  return (
    <group>
      <Booth all={all} spec={kiosk} />
      <mesh geometry={geo} material={stone} castShadow receiveShadow />
      <mesh geometry={armGeo} material={armMat} castShadow />
      <mesh geometry={bannerGeo} material={bannerMat} castShadow />
    </group>
  );
}

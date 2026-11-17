import { useMemo } from "react";
import { CanvasTexture, Color, DoubleSide, MeshStandardMaterial, SRGBColorSpace, type Texture } from "three";
import { PARK_BINS, PARK_KIOSK, PARK_LAMPS, PARK_PLANTERS } from "@caysonverse/shared/village/parkArea";
import { GeoBuilder, type V3 } from "./geoBuilder";
import { parkMaterial, pickSet } from "./pbr";

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
    // the kiosk: a plinth, a plastered body with a service window and counter, a striped awning, a tiled hip roof, a lantern
    const k = PARK_KIOSK;
    b.box([k.x, 0.2, k.z], X, Y, k.w / 2 + 0.1, 0.2, k.d / 2 + 0.1, [0.6, 0.58, 0.54], 2);
    b.box([k.x, 1.7, k.z], X, Y, k.w / 2, 1.5, k.d / 2, [0.95, 0.9, 0.78], 2);
    b.box([k.x, 1.85, k.z + k.d / 2 + 0.02], X, Y, 1.2, 0.55, 0.05, [0.12, 0.1, 0.1]); // the service window, dark
    b.box([k.x, 1.25, k.z + k.d / 2 + 0.3], X, Y, 1.4, 0.06, 0.32, [0.5, 0.33, 0.2]); // the counter shelf
    for (let i = 0; i < 9; i++) b.box([k.x - 1.6 + i * 0.4, 2.7, k.z + k.d / 2 + 0.55], X, [0, 0.9553, -0.2955], 0.2, 0.025, 0.7, i % 2 ? [0.97, 0.94, 0.88] : [0.3, 0.34, 0.8]); // awning stripes
    for (const e of [-1, 1]) b.cylinder([k.x + e * 1.8, 0.2, k.z + k.d / 2 + 0.95], [k.x + e * 1.8, 2.55, k.z + k.d / 2 + 0.95], 0.04, 0.04, 6, [0.92, 0.9, 0.84]);
    b.box([k.x, 3.35, k.z], X, Y, k.w / 2 + 0.5, 0.12, k.d / 2 + 0.5, [0.45, 0.24, 0.2]);
    b.box([k.x, 3.75, k.z], X, Y, k.w / 2 - 0.4, 0.14, k.d / 2 - 0.4, [0.5, 0.27, 0.22]);
    b.box([k.x, 4.0, k.z], X, Y, 0.9, 0.1, 0.9, [0.55, 0.3, 0.24]);
    b.cylinder([k.x, 4.1, k.z], [k.x, 4.9, k.z], 0.05, 0.05, 6, [0.2, 0.2, 0.24]);
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
      b.box([p.x, 0.88, p.z], X, Y, p.w / 2 - 0.1, 0.06, p.d / 2 - 0.1, [0.3, 0.2, 0.14]);
      for (let i = 0; i < 3; i++) b.box([p.x - 0.9 + i * 0.9, 1.25, p.z], X, Y, 0.4, 0.38, 0.4, i === 1 ? [0.22, 0.46, 0.24] : [0.95, 0.55, 0.68]);
    }
    return b.build();
  }, []);
  const stone = useMemo(() => parkMaterial(pickSet(all, "PaintedPlaster017"), 1.4, { vertexColors: true, normalScale: 0.8 }), [all]);
  // pennant banners hung from arms on the promenade's lamp posts
  const tex = useMemo(() => bannerTexture(), []);
  const bannerMat = useMemo(() => new MeshStandardMaterial({ map: tex, roughness: 0.85, side: DoubleSide, color: new Color("#ffffff") }), [tex]);
  const posts = useMemo(() => PARK_LAMPS.filter((l) => l.x > 30 && l.x < 50 && l.z < -138), []);
  const armGeo = useMemo(() => {
    const b = new GeoBuilder();
    for (const l of posts) b.box([l.x + (l.x < 40 ? 0.5 : -0.5), 3.5, l.z], X, Y, 0.5, 0.03, 0.03, [0.15, 0.16, 0.22]);
    return b.build();
  }, [posts]);
  const armMat = useMemo(() => new MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.3 }), []);
  return (
    <group>
      <mesh geometry={geo} material={stone} castShadow receiveShadow />
      <mesh geometry={armGeo} material={armMat} castShadow />
      {posts.map((l) => (
        <mesh key={`${l.x}_${l.z}`} position={[l.x + (l.x < 40 ? 0.9 : -0.9), 2.35, l.z]} material={bannerMat} castShadow>
          <planeGeometry args={[0.8, 2.4]} />
        </mesh>
      ))}
    </group>
  );
}

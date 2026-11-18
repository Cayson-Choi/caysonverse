import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { dayNight } from "../village/dayNightDriver";
import { CanvasTexture, Color, DoubleSide, MeshStandardMaterial, SRGBColorSpace, type Texture } from "three";
import { PARK_SHOPS, type ParkShop } from "@caysonverse/shared/village/parkArea";
import { GeoBuilder, type V3 } from "./geoBuilder";
import { parkMaterial, pickSet } from "./pbr";

const X: V3 = [1, 0, 0];
const Y: V3 = [0, 1, 0];

const SHOP_NAMES: Record<string, string> = { bakery: "빵집", toys: "장난감 가게", tea: "찻집", souvenir: "기념품", candy: "사탕 가게", photo: "사진관" };
/** The night glow of each shop's windows (× the clock's lights) and its lamp colour. */
const SHOP_GLOW = [1.5, 1.1, 1.7, 0.9, 1.3, 0.0];
const SHOP_WARM = ["#ffb35e", "#ffc27a", "#ffa94d", "#ffd08a", "#ff9f55", "#ffb35e"];
const SHUTTERS: V3[] = [[0.2, 0.42, 0.3], [0.52, 0.24, 0.2], [0.24, 0.36, 0.5], [0.3, 0.45, 0.28]];

/** A hanging shop sign (canvas): the shop's name on a painted board with a gold rim. */
function shopSignTexture(name: string, wall: V3): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 256;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = `rgb(${Math.round(wall[0] * 130)},${Math.round(wall[1] * 110)},${Math.round(wall[2] * 150)})`;
  ctx.fillRect(0, 0, 512, 256);
  ctx.strokeStyle = "#f2c14e";
  ctx.lineWidth = 12;
  ctx.strokeRect(10, 10, 492, 236);
  ctx.fillStyle = "#fff6e0";
  ctx.font = "bold 96px 'Jua', 'Malgun Gothic', 'Noto Sans KR', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(name, 256, 134);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}


/**
 * The unseen faces of a shop (the back and the two gable ends): the riders and the walkers behind the row see them, so they get the same
 * half-timbering, windows with shutters and flower boxes (and a service door on the back), only plainer than the street front.
 */
function addPlainFace(wall: GeoBuilder, s: ParkShop, F: V3, dist: number, latHalf: number, shut: V3, door: boolean): void {
  const wallH = 4.4;
  const beam = s.beam;
  // lateral axis: horizontal, perpendicular to F (boxes are symmetric, so its sign does not matter)
  const L: V3 = [-F[2], 0, F[0]];
  const at = (f: number, y: number, l: number): V3 => [s.x + F[0] * (dist + f) + L[0] * l, y, s.z + F[2] * (dist + f) + L[2] * l];
  const white: V3 = [0.95, 0.94, 0.9];
  // posts, rails, braces
  for (const l of [-latHalf + 0.25, 0, latHalf - 0.25]) wall.box(at(0.06, wallH / 2 + 0.5, l), F, Y, 0.1, wallH / 2 - 0.5, 0.15, beam);
  for (const y of [1.2, 2.75, wallH - 0.12]) wall.box(at(0.07, y, 0), F, Y, 0.11, 0.14, latHalf + 0.05, beam);
  const winsAt = door ? [-latHalf * 0.55, latHalf * 0.55] : [0];
  for (const l of winsAt) {
    wall.box(at(0.05, 2.15, l), F, Y, 0.15, 0.7, 0.8, [0.2, 0.2, 0.22]);
    wall.box(at(0.12, 2.15, l), F, Y, 0.05, 0.6, 0.68, [0.66, 0.82, 0.95]);
    for (const e of [-1, 1]) wall.box(at(0.15, 2.15, l + e * 0.72), F, Y, 0.09, 0.72, 0.07, white);
    for (const e of [-1, 1]) wall.box(at(0.15, 2.15 + e * 0.67, l), F, Y, 0.09, 0.07, 0.8, white);
    wall.box(at(0.16, 2.15, l), F, Y, 0.05, 0.6, 0.025, white);
    wall.box(at(0.16, 2.15, l), F, Y, 0.05, 0.025, 0.68, white);
    wall.box(at(0.25, 1.42, l), F, Y, 0.22, 0.05, 0.94, [0.82, 0.8, 0.76]);
    for (const e of [-1, 1]) {
      wall.box(at(0.19, 2.15, l + e * 1.2), F, Y, 0.04, 0.72, 0.38, shut);
      for (let sl = -3; sl <= 3; sl++) wall.box(at(0.235, 2.15 + sl * 0.2, l + e * 1.2), F, Y, 0.012, 0.022, 0.32, [shut[0] * 0.7, shut[1] * 0.7, shut[2] * 0.7]);
    }
    wall.box(at(0.38, 1.26, l), F, Y, 0.18, 0.12, 0.86, [0.4, 0.26, 0.16]);
    for (let f = 0; f < 5; f++) wall.box(at(0.38, 1.47, l - 0.6 + f * 0.3), F, Y, 0.13, 0.12, 0.12, f % 2 ? [0.96, 0.5, 0.62] : [0.98, 0.82, 0.3]);
  }
  if (door) {
    wall.box(at(0.04, 1.3, 0), F, Y, 0.17, 1.3, 0.75, [0.14, 0.09, 0.06]);
    wall.box(at(0.11, 1.3, 0), F, Y, 0.06, 1.18, 0.54, [0.33, 0.2, 0.11]);
    for (const e of [-1, 1]) wall.box(at(0.15, 1.3, e * 0.72), F, Y, 0.12, 1.35, 0.09, beam);
    wall.box(at(0.16, 2.7, 0), F, Y, 0.13, 0.11, 0.9, beam);
    wall.box(at(0.4, 0.1, 0), F, Y, 0.4, 0.1, 0.9, [0.62, 0.6, 0.56]);
    wall.box(at(0.2, 2.35, 1.0), F, Y, 0.09, 0.15, 0.09, [0.98, 0.86, 0.5]);
  }
}

function addShop(wall: GeoBuilder, roof: GeoBuilder, cloth: GeoBuilder, glass: GeoBuilder, s: ParkShop, shut: V3): void {
  const F: V3 = [s.faces, 0, 0];
  const wallH = 4.4;
  const half = s.d / 2;
  const c = (f: number, y: number, side: number): V3 => [s.x + s.faces * f, y, s.z + side];
  const beam = s.beam;
  // the body, a stone plinth with a cap course, and corner quoins
  wall.box(c(0, wallH / 2, 0), F, Y, half, wallH / 2, s.w / 2, s.wall, 3);
  wall.box(c(0, 0.45, 0), F, Y, half + 0.12, 0.45, s.w / 2 + 0.12, [0.58, 0.56, 0.52], 2);
  wall.box(c(0, 0.95, 0), F, Y, half + 0.18, 0.05, s.w / 2 + 0.18, [0.7, 0.68, 0.64], 2);
  for (const e of [-1, 1]) for (let k = 0; k < 6; k++) wall.box(c(half + 0.03, 1.3 + k * 0.62, e * (s.w / 2 - 0.2)), F, Y, 0.1, 0.3, 0.24 + (k % 2) * 0.1, [0.9, 0.86, 0.78]);
  // the half-timbering: posts, rails and braces, standing proud of the plaster
  for (let k = -s.w / 2 + 0.7; k <= s.w / 2 - 0.5; k += s.w / 6) wall.box(c(half + 0.07, wallH / 2 + 0.5, k), F, Y, 0.12, wallH / 2 - 0.5, 0.16, beam);
  for (const y of [1.2, 2.75, wallH - 0.12]) wall.box(c(half + 0.08, y, 0), F, Y, 0.13, 0.15, s.w / 2 + 0.08, beam);
  for (let k = -s.w / 2 + 0.7; k < s.w / 2 - 0.9; k += s.w / 3) wall.box(c(half + 0.09, 3.5, k + s.w / 6), F, [0, 0.7071, 0.7071], 0.09, 0.95, 0.12, beam);
  // door: a recessed dark opening in a thick frame, a transom, a step and a lantern
  const dz = -s.w / 4;
  wall.box(c(half + 0.04, 1.4, dz), F, Y, 0.18, 1.45, 0.85, [0.14, 0.09, 0.06]);
  wall.box(c(half + 0.12, 1.4, dz), F, Y, 0.06, 1.3, 0.62, [0.36, 0.22, 0.12]);
  for (const e of [-1, 1]) wall.box(c(half + 0.16, 1.4, dz + e * 0.82), F, Y, 0.13, 1.5, 0.1, beam);
  wall.box(c(half + 0.18, 2.95, dz), F, Y, 0.15, 0.12, 1.0, beam);
  wall.box(c(half + 0.18, 0.55, dz), F, Y, 0.45, 0.1, 0.95, [0.62, 0.6, 0.56]);
  wall.box(c(half + 0.35, 2.4, dz + 1.1), F, Y, 0.1, 0.16, 0.1, [0.98, 0.86, 0.5]);
  // windows: deep reveals, white frames with muntins, sills, shutters both sides, flower boxes
  for (const k of [s.w / 6 + 0.4, s.w / 3 + 1.1]) {
    if (k + 0.9 > s.w / 2) continue;
    wall.box(c(half + 0.05, 2.1, k), F, Y, 0.16, 0.72, 0.84, [0.2, 0.2, 0.22]);
    glass.box(c(half + 0.12, 2.1, k), F, Y, 0.05, 0.62, 0.72, [0.66, 0.82, 0.95]); // its own mesh: the panes glow at night
    for (const e of [-1, 1]) wall.box(c(half + 0.16, 2.1, k + e * 0.76), F, Y, 0.1, 0.74, 0.07, [0.95, 0.94, 0.9]);
    for (const y of [-1, 1]) wall.box(c(half + 0.16, 2.1 + y * 0.7, k), F, Y, 0.1, 0.07, 0.84, [0.95, 0.94, 0.9]);
    wall.box(c(half + 0.17, 2.1, k), F, Y, 0.06, 0.62, 0.025, [0.95, 0.94, 0.9]);
    wall.box(c(half + 0.17, 2.1, k), F, Y, 0.06, 0.025, 0.72, [0.95, 0.94, 0.9]);
    wall.box(c(half + 0.26, 1.38, k), F, Y, 0.24, 0.05, 0.98, [0.82, 0.8, 0.76]);
    for (const e of [-1, 1]) {
      wall.box(c(half + 0.2, 2.1, k + e * 1.28), F, Y, 0.04, 0.74, 0.4, shut);
      for (let sl = -3; sl <= 3; sl++) wall.box(c(half + 0.245, 2.1 + sl * 0.2, k + e * 1.28), F, Y, 0.012, 0.022, 0.34, [shut[0] * 0.7, shut[1] * 0.7, shut[2] * 0.7]);
    }
    wall.box(c(half + 0.4, 1.22, k), F, Y, 0.2, 0.12, 0.88, [0.4, 0.26, 0.16]);
    for (let f = 0; f < 6; f++) wall.box(c(half + 0.4, 1.44, k - 0.7 + f * 0.28), F, Y, 0.14, 0.13, 0.12, f % 2 ? [0.96, 0.5, 0.62] : [0.98, 0.82, 0.3]);
  }
  // a striped fabric awning over the door: a sloped slab per stripe, a scalloped valance
  for (let i = 0; i < 8; i++) {
    const col: V3 = i % 2 === 0 ? [0.86, 0.3, 0.3] : [0.97, 0.94, 0.88];
    const dir: V3 = [s.faces * 0.9553, -0.2955, 0];
    const nrm: V3 = [s.faces * 0.2955, 0.9553, 0];
    cloth.box(c(half + 0.75, 3.15, dz - 1.05 + i * 0.3), dir, nrm, 0.78, 0.02, 0.15, col);
    cloth.box(c(half + 1.44, 2.88, dz - 1.05 + i * 0.3), F, Y, 0.02, 0.1 + (i % 2) * 0.03, 0.15, col);
  }
  // the pitched roof: tile slabs with a ridge cap, stepped gable ends, a chimney with a pot
  const rh = s.roofH;
  const alpha = Math.atan2(rh, half + 0.45);
  const ca = Math.cos(alpha);
  const sa = Math.sin(alpha);
  const L = Math.hypot(half + 0.45, rh) / 2 + 0.2;
  for (const sgn of [1, -1]) {
    const dir: V3 = [s.faces * sgn * ca, -sa, 0];
    const nrm: V3 = [s.faces * sgn * sa, ca, 0];
    roof.box([s.x + s.faces * sgn * (half / 2 + 0.22), wallH + rh / 2 + 0.06, s.z], dir, nrm, L, 0.11, s.w / 2 + 0.55, [1, 1, 1], 2.4);
  }
  roof.box([s.x, wallH + rh + 0.14, s.z], F, Y, 0.38, 0.11, s.w / 2 + 0.6, [0.5, 0.26, 0.22]);
  for (let k = 0; k < 6; k++) {
    const w = half * (1 - (k + 0.5) / 6);
    for (const e of [-1, 1]) wall.box(c(0, wallH + (k * rh) / 6 + rh / 12, e * (s.w / 2 - 0.02)), F, Y, w, rh / 12, 0.11, s.wall);
  }
  const chim: V3 = [s.x - s.faces * (half * 0.4), wallH + rh + 0.5, s.z + s.w / 3];
  wall.box(chim, X, Y, 0.5, 1.15, 0.5, [0.72, 0.45, 0.38], 1);
  wall.box([chim[0], chim[1] + 1.25, chim[2]], X, Y, 0.38, 0.14, 0.38, [0.4, 0.3, 0.28]);
  wall.cylinder([chim[0], chim[1] + 1.4, chim[2]], [chim[0], chim[1] + 1.9, chim[2]], 0.22, 0.2, 8, [0.7, 0.4, 0.3]);
  // the back (service door, windows) and the two gable ends
  addPlainFace(wall, s, [-s.faces, 0, 0], half, s.w / 2, shut, true);
  addPlainFace(wall, s, [0, 0, 1], s.w / 2, half, shut, false);
  addPlainFace(wall, s, [0, 0, -1], s.w / 2, half, shut, false);
  // the iron bracket of the hanging signboard, beside the door
  wall.box(c(half + 0.9, 3.75, dz + 1.7), F, Y, 0.9, 0.04, 0.05, [0.12, 0.12, 0.14]);
}

/** The promenade's six storybook shop fronts: real plaster PBR, half-timbering, deep reveals, shutters, flower boxes, awnings, signs. */
export function Shops({ all }: { all: Texture[] }) {
  const { wallGeo, roofGeo, clothGeo, glassGeos } = useMemo(() => {
    const w = new GeoBuilder();
    const r = new GeoBuilder();
    const cl = new GeoBuilder();
    const gl = PARK_SHOPS.map(() => new GeoBuilder());
    PARK_SHOPS.forEach((s, i) => addShop(w, r, cl, gl[i]!, s, SHUTTERS[i % SHUTTERS.length]!));
    return { wallGeo: w.build(), roofGeo: r.build(), clothGeo: cl.build(), glassGeos: gl.map((g) => g.build()) };
  }, []);
  // the shop windows light up with the night, each a little different (a warm lamp, a dimmer one, one shop with its light out)
  const glassMats = useMemo(() => SHOP_GLOW.map((k, i) => ({ k, mat: new MeshStandardMaterial({ color: "#b9d4ee", roughness: 0.2, emissive: new Color(SHOP_WARM[i % SHOP_WARM.length]!), emissiveIntensity: 0 }) })), []);
  useFrame(() => {
    const l = dayNight.applied.lights;
    for (const g of glassMats) g.mat.emissiveIntensity = l * g.k;
  });
  const wallMat = useMemo(() => parkMaterial(pickSet(all, "Plaster003"), 0.7, { vertexColors: true, normalScale: 1.0, color: new Color("#ffffff") }), [all]);
  const roofMat = useMemo(() => parkMaterial(pickSet(all, "RoofingTiles013A"), 1, { color: new Color("#e29a7c"), normalScale: 1.0 }), [all]);
  const clothMat = useMemo(() => new MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: DoubleSide }), []);
  const signs = useMemo(
    () =>
      PARK_SHOPS.map((s) => {
        const tex = shopSignTexture(SHOP_NAMES[s.id] ?? s.id, s.wall);
        return { s, mat: new MeshStandardMaterial({ map: tex, roughness: 0.6 }) };
      }),
    [],
  );
  return (
    <group>
      <mesh geometry={wallGeo} material={wallMat} castShadow receiveShadow />
      {glassGeos.map((g, i) => (
        <mesh key={i} geometry={g} material={glassMats[i % glassMats.length]!.mat} />
      ))}
      <mesh geometry={roofGeo} material={roofMat} castShadow receiveShadow />
      <mesh geometry={clothGeo} material={clothMat} castShadow />
      {signs.map(({ s, mat }) => (
        <mesh key={s.id} position={[s.x + s.faces * (s.d / 2 + 0.95), 3.45, s.z - s.w / 4 + 1.7]} material={mat} castShadow>
          <boxGeometry args={[1.5, 0.75, 0.06]} />
        </mesh>
      ))}
    </group>
  );
}

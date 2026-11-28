import { crispTextTexture, sharpenTextMaterial } from "../game/sceneText";
import { addInkLabel, type InkTone } from "../game/inkLabels";
import { useEffect, useMemo, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { dayNight } from "../village/dayNightDriver";
import { CanvasTexture, Color, DoubleSide, MeshStandardMaterial, SRGBColorSpace, type Object3D, type Texture } from "three";
import { PARK_SHOPS, type ParkShop } from "@caysonverse/shared/village/parkArea";
import { GeoBuilder, type V3 } from "./geoBuilder";
import { parkMaterial, pickSet } from "./pbr";
import { addShopWindow } from "./parkShopWindows";
import { shopWindows } from "@caysonverse/shared/village/parkShopWindowLayout";

const X: V3 = [1, 0, 0];
const Y: V3 = [0, 1, 0];

const SHOP_NAMES: Record<string, string> = { bakery: "빵집", toys: "장난감 가게", tea: "찻집", souvenir: "기념품", candy: "사탕 가게", photo: "사진관" };
/** The night glow of each shop's windows (× the clock's lights) and its lamp colour. */
const SHOP_GLOW = [1.5, 1.1, 1.7, 0.9, 1.3, 0.0];
const SHOP_WARM = ["#ffb35e", "#ffc27a", "#ffa94d", "#ffd08a", "#ff9f55", "#ffb35e"];
const SHUTTERS: V3[] = [[0.2, 0.42, 0.3], [0.52, 0.24, 0.2], [0.24, 0.36, 0.5], [0.3, 0.45, 0.28]];

/** The hanging sign's board (m) and its canvas (px). */
const SIGN = { w: 1.5, h: 0.75, d: 0.06 } as const;
const SIGN_PX = { w: 512, h: 256 } as const;

/** The sign's painted board colour (sRGB hex): the shop's wall colour, deepened. */
function signBoardColour(wall: V3): string {
  const hex = (v: number) => Math.round(v).toString(16).padStart(2, "0");
  return `#${hex(wall[0] * 130)}${hex(wall[1] * 110)}${hex(wall[2] * 150)}`;
}

/** The shop's name in the sign's 512 x 256 px (scale the context for another size), its colours through `tone`. */
function paintShopName(ctx: CanvasRenderingContext2D, name: string, tone: InkTone = (c) => c): void {
  ctx.font = "bold 96px 'Jua', 'Malgun Gothic', 'Noto Sans KR', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // a dark rim round the cream letters: they stay apart from the painted board when the sign is far and small (fix/pine-text)
  ctx.lineJoin = "round";
  ctx.lineWidth = 10;
  ctx.strokeStyle = tone("rgba(30, 20, 30, 0.55)");
  ctx.strokeText(name, 256, 134, 460);
  ctx.fillStyle = tone("#fff6e0");
  ctx.fillText(name, 256, 134, 460);
}

/** A hanging shop sign (canvas): the shop's name (`name` null: none) on a painted board with a gold rim. `scale`: of the 512 x 256 px. */
function shopSignTexture(name: string | null, wall: V3, scale = 1): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = SIGN_PX.w * scale;
  c.height = SIGN_PX.h * scale;
  const ctx = c.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.fillStyle = signBoardColour(wall);
  ctx.fillRect(0, 0, 512, 256);
  ctx.strokeStyle = "#f2c14e";
  ctx.lineWidth = 12;
  ctx.strokeRect(10, 10, 492, 236);
  if (name !== null) paintShopName(ctx, name);
  // mipmapped, trilinear, the GPU's highest anisotropy (sceneText.ts); its material samples it half a mip sharper
  const t = crispTextTexture(new CanvasTexture(c));
  t.colorSpace = SRGBColorSpace;
  return t;
}


/**
 * #13 exteriors (2026-11-27): the half-timbering was boxes of the plaster material (the plaster's swirl stretched over each beam, flat
 * brown): it is real oak now, its own mesh, the grain along every member (posts upright, rails and braces along their length), one
 * texture repeat per TIMBER_M metres.
 */
const TIMBER_M = 2.4;
/** The shops' beam colours were picked for a flat swatch: × the oak set's own mid-brown albedo they need lifting to read as stained oak. */
const timberTint = (b: V3): V3 => [Math.min(1, b[0] * 1.9), Math.min(1, b[1] * 1.9), Math.min(1, b[2] * 1.9)];
/** An upright member (half depth `d` along F, half width `w` along the wall, half height `h`) with its grain vertical. */
function post(timber: GeoBuilder, c: V3, F: V3, lat: V3, d: number, w: number, h: number, color: V3): void {
  // box(ax = F, ay = along the wall): its third axis F x lat is vertical, so the faces' u (and the oak's grain) runs up the post
  timber.box(c, F, lat, d, w, h, color, TIMBER_M);
}

/**
 * The unseen faces of a shop (the back and the two gable ends): the riders and the walkers behind the row see them, so they get the same
 * half-timbering, windows with shutters and flower boxes (and a service door on the back), only plainer than the street front.
 */
function addPlainFace(wall: GeoBuilder, wood: GeoBuilder, timber: GeoBuilder, s: ParkShop, F: V3, dist: number, latHalf: number, door: boolean): void {
  const wallH = 4.4;
  const beam = timberTint(s.beam);
  // lateral axis: horizontal, perpendicular to F (boxes are symmetric, so its sign does not matter)
  const L: V3 = [-F[2], 0, F[0]];
  const at = (f: number, y: number, l: number): V3 => [s.x + F[0] * (dist + f) + L[0] * l, y, s.z + F[2] * (dist + f) + L[2] * l];
  // posts, rails, braces
  for (const l of [-latHalf + 0.25, 0, latHalf - 0.25]) post(timber, at(0.06, wallH / 2 + 0.5, l), F, L, 0.1, 0.15, wallH / 2 - 0.5, beam);
  for (const y of [1.2, 2.75, wallH - 0.12]) timber.box(at(0.07, y, 0), F, Y, 0.11, 0.14, latHalf + 0.05, beam, TIMBER_M);
  if (door) {
    wall.box(at(0.04, 1.3, 0), F, Y, 0.17, 1.3, 0.75, [0.14, 0.09, 0.06]);
    addDoorLeaf(wood, F, at, 0.20, 2.48);
    for (const e of [-1, 1]) post(timber, at(0.15, 1.3, e * 0.72), F, L, 0.12, 0.09, 1.35, beam);
    timber.box(at(0.16, 2.7, 0), F, Y, 0.13, 0.11, 0.9, beam, TIMBER_M);
    wall.box(at(0.4, 0.1, 0), F, Y, 0.4, 0.1, 0.9, [0.62, 0.6, 0.56]);
    wall.box(at(0.2, 2.35, 1.0), F, Y, 0.09, 0.15, 0.09, [0.98, 0.86, 0.5]);
  }
}

/** A timber door seated between its jambs. The leaf and its grip clear the opening's dark lining. */
function addDoorLeaf(wood: GeoBuilder, face: V3, at: (d: number, y: number, l: number) => V3, bottom: number, top: number): void {
  const grain: V3 = [0.52, 0.30, 0.18];
  const rail: V3 = [0.66, 0.42, 0.25];
  const middle = (bottom + top) / 2;
  wood.box(at(0.238, middle, 0), face, Y, 0.017, (top - bottom) / 2, 0.605, grain, 1.15);
  for (const side of [-1, 1]) wood.box(at(0.261, middle, side * 0.55), face, Y, 0.014, (top - bottom) / 2, 0.055, rail, 1);
  for (const y of [bottom + 0.08, middle, top - 0.08]) wood.box(at(0.261, y, 0), face, Y, 0.014, 0.068, 0.50, rail, 1);
  const brass: V3 = [0.72, 0.50, 0.21];
  const grip = bottom + 0.98;
  wood.box(at(0.267, grip, 0.44), face, Y, 0.013, 0.079, 0.032, brass);
  wood.cylinder(at(0.275, grip + 0.032, 0.44), at(0.332, grip + 0.032, 0.44), 0.023, 0.018, 8, brass);
  wood.cylinder(at(0.332, grip + 0.032, 0.44), at(0.332, grip + 0.032, 0.314), 0.018, 0.015, 8, brass, true);
}

function addShop(wall: GeoBuilder, wood: GeoBuilder, timber: GeoBuilder, roof: GeoBuilder, cloth: GeoBuilder, glass: GeoBuilder, s: ParkShop, shut: V3): void {
  const F: V3 = [s.faces, 0, 0];
  const wallH = 4.4;
  const half = s.d / 2;
  const c = (f: number, y: number, side: number): V3 => [s.x + s.faces * f, y, s.z + side];
  const beam = timberTint(s.beam);
  const LAT: V3 = [0, 0, 1];
  // the body, a stone plinth with a cap course, and corner quoins
  wall.box(c(0, wallH / 2, 0), F, Y, half, wallH / 2, s.w / 2, s.wall, 3);
  wall.box(c(0, 0.45, 0), F, Y, half + 0.12, 0.45, s.w / 2 + 0.12, [0.58, 0.56, 0.52], 2);
  wall.box(c(0, 0.95, 0), F, Y, half + 0.18, 0.05, s.w / 2 + 0.18, [0.7, 0.68, 0.64], 2);
  for (const e of [-1, 1]) for (let k = 0; k < 6; k++) wall.box(c(half + 0.03, 1.3 + k * 0.62, e * (s.w / 2 - 0.2)), F, Y, 0.1, 0.3, 0.24 + (k % 2) * 0.1, [0.9, 0.86, 0.78]);
  // the half-timbering: posts, rails and braces, standing proud of the plaster
  for (let k = -s.w / 2 + 0.7; k <= s.w / 2 - 0.5; k += s.w / 6) post(timber, c(half + 0.07, wallH / 2 + 0.5, k), F, LAT, 0.12, 0.16, wallH / 2 - 0.5, beam);
  for (const y of [1.2, 2.75, wallH - 0.12]) timber.box(c(half + 0.08, y, 0), F, Y, 0.13, 0.15, s.w / 2 + 0.08, beam, TIMBER_M);
  // the braces: the grain runs along each (its length on the box's third axis)
  for (let k = -s.w / 2 + 0.7; k < s.w / 2 - 0.9; k += s.w / 3) timber.box(c(half + 0.09, 3.5, k + s.w / 6), F, [0, 0.7071, -0.7071], 0.09, 0.12, 0.95, beam, TIMBER_M);
  // door: a recessed dark opening in a thick frame, a transom, a step and a lantern
  const dz = -s.w / 4;
  wall.box(c(half + 0.04, 1.4, dz), F, Y, 0.18, 1.45, 0.85, [0.14, 0.09, 0.06]);
  addDoorLeaf(wood, F, (d, y, l) => c(half + d, y, dz + l), 0.20, 2.79);
  for (const e of [-1, 1]) post(timber, c(half + 0.16, 1.4, dz + e * 0.82), F, LAT, 0.13, 0.1, 1.5, beam);
  timber.box(c(half + 0.18, 2.95, dz), F, Y, 0.15, 0.12, 1.0, beam, TIMBER_M);
  wall.box(c(half + 0.33, 0.10, dz), F, Y, 0.38, 0.10, 0.95, [0.62, 0.6, 0.56]);
  wall.box(c(half + 0.35, 2.4, dz + 1.1), F, Y, 0.1, 0.16, 0.1, [0.98, 0.86, 0.5]);
  for (const opening of shopWindows(s)) addShopWindow(opening, s.id, wood, cloth, glass, shut);
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
  addPlainFace(wall, wood, timber, s, [-s.faces, 0, 0], half, s.w / 2, true);
  addPlainFace(wall, wood, timber, s, [0, 0, 1], s.w / 2, half, false);
  addPlainFace(wall, wood, timber, s, [0, 0, -1], s.w / 2, half, false);
  // the iron bracket of the hanging signboard, beside the door
  wall.box(c(half + 0.9, 3.75, dz + 1.7), F, Y, 0.9, 0.04, 0.05, [0.12, 0.12, 0.14]);
}

/** The promenade's six storybook shop fronts: real plaster PBR, half-timbering, deep reveals, shutters, flower boxes, awnings, signs. */
export function Shops({ all }: { all: Texture[] }) {
  const { wallGeo, woodGeo, timberGeo, roofGeo, clothGeo, glassGeos } = useMemo(() => {
    const w = new GeoBuilder();
    const wood = new GeoBuilder();
    const timber = new GeoBuilder();
    const r = new GeoBuilder();
    const cl = new GeoBuilder();
    const gl = PARK_SHOPS.map(() => new GeoBuilder());
    PARK_SHOPS.forEach((s, i) => addShop(w, wood, timber, r, cl, gl[i]!, s, SHUTTERS[i % SHUTTERS.length]!));
    return { wallGeo: w.build(), woodGeo: wood.build(), timberGeo: timber.build(), roofGeo: r.build(), clothGeo: cl.build(), glassGeos: gl.map((g) => g.build()) };
  }, []);
  // the shop windows light up with the night, each a little different (a warm lamp, a dimmer one, one shop with its light out)
  const glassMats = useMemo(() => SHOP_GLOW.map((k, i) => ({ k, mat: new MeshStandardMaterial({ color: "#c7dee4", transparent: true, opacity: 0.21, depthWrite: false, roughness: 0.14, emissive: new Color(SHOP_WARM[i % SHOP_WARM.length]!), emissiveIntensity: 0 }) })), []);
  useFrame(() => {
    const l = dayNight.applied.lights;
    for (const g of glassMats) g.mat.emissiveIntensity = l * g.k;
  });
  // the plaster's mottled colour map read as grime on a new shop: the fresh limewash is the shop's own colour (vertex colours), the set
  // gives only its trowelled relief and sheen
  const wallMat = useMemo(() => parkMaterial(pickSet(all, "Plaster003"), 0.7, { useColor: false, vertexColors: true, normalScale: 0.5, color: new Color("#ffffff") }), [all]);
  const timberMat = useMemo(() => parkMaterial(pickSet(all, "WoodFloor051"), 1, { vertexColors: true, normalScale: 0.6 }), [all]);
  const woodMat = useMemo(() => parkMaterial(pickSet(all, "WoodFloor051"), 1, { vertexColors: true, normalScale: 0.5 }), [all]);
  const roofMat = useMemo(() => parkMaterial(pickSet(all, "RoofingTiles013A"), 1, { color: new Color("#e29a7c"), normalScale: 1.0 }), [all]);
  const clothMat = useMemo(() => new MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: DoubleSide }), []);
  const signs = useMemo(
    () =>
      PARK_SHOPS.map((s) => {
        const tex = shopSignTexture(SHOP_NAMES[s.id] ?? s.id, s.wall);
        return { s, mat: sharpenTextMaterial(new MeshStandardMaterial({ map: tex, roughness: 0.6 })) };
      }),
    [],
  );
  return (
    <group>
      <mesh geometry={wallGeo} material={wallMat} castShadow receiveShadow />
      <mesh geometry={woodGeo} material={woodMat} castShadow receiveShadow />
      <mesh geometry={timberGeo} material={timberMat} castShadow receiveShadow />
      {glassGeos.map((g, i) => (
        <mesh key={i} geometry={g} material={glassMats[i % glassMats.length]!.mat} />
      ))}
      <mesh geometry={roofGeo} material={roofMat} castShadow receiveShadow />
      <mesh geometry={clothGeo} material={clothMat} castShadow receiveShadow />
      {signs.map(({ s, mat }) => (
        <ShopSign key={s.id} shop={s} mat={mat} />
      ))}
    </group>
  );
}

/**
 * One hanging sign: a painted box, the name on both broad faces. The name is drawn crisp on the label overlay where the scene is drawn
 * at fewer pixels than the screen has (inkLabels.ts); the box then wears its board alone (made on first use, at half the pixels).
 */
function ShopSign({ shop: s, mat }: { shop: ParkShop; mat: MeshStandardMaterial }) {
  const [front, setFront] = useState<Object3D | null>(null);
  const [back, setBack] = useState<Object3D | null>(null);
  useEffect(() => {
    if (!front || !back) return;
    const name = SHOP_NAMES[s.id] ?? s.id;
    const ink = mat.map;
    let blank: Texture | null = null;
    // either face may be on the overlay (only one faces the eye at a time)
    const off = new Set<Object3D>();
    const label = (anchor: Object3D) =>
      addInkLabel({
        object: anchor,
        w: SIGN.w,
        h: SIGN.h,
        paint: (g, w, h, tone) => {
          g.save();
          g.scale(w / SIGN_PX.w, h / SIGN_PX.h);
          paintShopName(g, name, tone);
          g.restore();
        },
        // a plain lit board (MeshStandardMaterial under the scene's lights): its light worked out from them, day and night
        lit: "standard",
        // the plain board above the name, inside the rim
        probe: { x: 0, y: SIGN.h / 2 - 0.15, albedo: signBoardColour(s.wall) },
        setInk: (on) => {
          if (on) off.delete(anchor);
          else off.add(anchor);
          if (off.size > 0 && !blank) blank = shopSignTexture(null, s.wall, 0.5);
          mat.map = off.size > 0 && blank ? blank : ink;
        },
      });
    const a = label(front);
    const b = label(back);
    return () => {
      a();
      b();
      blank?.dispose();
    };
  }, [front, back, mat, s]);
  return (
    <group position={[s.x + s.faces * (s.d / 2 + 0.95), 3.45, s.z - s.w / 4 + 1.7]}>
      <mesh material={mat} castShadow>
        <boxGeometry args={[SIGN.w, SIGN.h, SIGN.d]} />
      </mesh>
      <object3D ref={setFront} position={[0, 0, SIGN.d / 2]} name="shop_sign_ink" />
      <object3D ref={setBack} position={[0, 0, -SIGN.d / 2]} rotation={[0, Math.PI, 0]} name="shop_sign_ink" />
    </group>
  );
}

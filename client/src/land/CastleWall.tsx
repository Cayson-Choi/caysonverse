/**
 * The castle wall (shared/src/village/parkWall.ts: the plan; castleWallGeometry.ts: the stones), drawn from a plan in either place:
 * `<CastleWall plan={PARK_WALL_PLAN} … />` inside 케이슨랜드, `<VillageParkWall />` (village side) round the park's skyline.
 *
 * Seven draws whatever the length: the wall modules, the towers' stone, their roofs, the gilt trim, the banners (all instanced), the
 * lanterns (iron + glass: one instanced mesh, two groups) and one `Points` draw of halos at night (BulbHalos). The stone is the
 * village's PBR library's honey ashlar (stone_ashlar: albedo, normal, ORM roughness) at its real 3 m tile; the roofs are its slate,
 * glazed in the gate's colour. Night: the lanterns' glass glows with dayNight's `lights` weight and their halos fade in.
 */
import { useEffect, useMemo, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  CanvasTexture,
  Color,
  DoubleSide,
  FrontSide,
  Group,
  InstancedMesh,
  MeshStandardMaterial,
  SRGBColorSpace,
  type BufferGeometry,
  type Matrix4,
  type WebGLRenderer,
} from "three";
import type { WallPlan } from "@caysonverse/shared/village/parkWall";
import { createPbrMaterial, getPbrSet, pbrTierFor, type PbrSet } from "../village/pbr/pbrLibrary";
import { dayNight } from "../village/dayNightDriver";
import { compileSafely } from "../game/compileSafely";
import { BulbHalos } from "./nightGlow";
import {
  bannerGeometry,
  lanternGeometry,
  roofGeometry,
  towerGeometry,
  trianglesOf,
  trimGeometry,
  wallInstances,
  wallModuleGeometry,
  type WallTier,
} from "./castleWallGeometry";

export interface WallLook {
  /**
   * Linear multipliers on the ashlar's albedo (honey limestone, mean sRGB 0.69 / 0.62 / 0.52): lifted to the gatehouse's cream beside it
   * (about sRGB 0.83 / 0.76 / 0.64); the faces toward the village look north, into their own shade.
   */
  stone: readonly [number, number, number];
  /** Linear multipliers on the slate (mean sRGB 0.36 / 0.39 / 0.43): the glaze of the gate's own roofs. */
  roof: readonly [number, number, number];
  /** The banner's colours: field, border and the star's disc. */
  banner: { field: string; border: string; disc: string; star: string };
}

/** The village gatehouse: honey stone, green domes with gold, red-and-gold banners with a blue star disc. */
export const VILLAGE_WALL_LOOK: WallLook = { stone: [1.5, 1.55, 1.6], roof: [0.35, 1.3, 0.6], banner: { field: "#e2b23a", border: "#c2352b", disc: "#24409a", star: "#ffffff" } };
/** The park's gate arch: sandstone, indigo-glazed spires, indigo banners with a gold star. */
export const PARK_WALL_LOOK: WallLook = { stone: [1.5, 1.52, 1.55], roof: [0.55, 0.65, 3.0], banner: { field: "#2c3190", border: "#f2c14e", disc: "#f6f0e0", star: "#e8b030" } };

function bannerTexture(b: WallLook["banner"]): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 288;
  const g = c.getContext("2d")!;
  g.fillStyle = b.field;
  g.fillRect(0, 0, 128, 288);
  g.fillStyle = b.border;
  g.fillRect(0, 0, 18, 288);
  g.fillRect(110, 0, 18, 288);
  g.fillRect(0, 0, 128, 30);
  g.fillRect(0, 236, 128, 52);
  g.fillStyle = b.disc;
  g.beginPath();
  g.ellipse(64, 128, 34, 58, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = b.star;
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 27 : 11;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const x = 64 + Math.cos(a) * r;
    const y = 130 + Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
  g.fill();
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

interface Built {
  root: Group;
  glass: MeshStandardMaterial;
  glows: [number, number, number][];
  stats: { drawCalls: number; triangles: number; modules: number; towers: number; lanterns: number };
  dispose(): void;
}

function instanced(geo: BufferGeometry, mat: MeshStandardMaterial | MeshStandardMaterial[], list: readonly Matrix4[], name: string, shadows: boolean): InstancedMesh {
  const m = new InstancedMesh(geo, mat, Math.max(1, list.length));
  m.name = name;
  list.forEach((x, i) => m.setMatrixAt(i, x));
  m.count = list.length;
  m.instanceMatrix.needsUpdate = true;
  m.computeBoundingSphere();
  m.computeBoundingBox();
  m.castShadow = shadows;
  m.receiveShadow = shadows;
  return m;
}

function make(plan: WallPlan, heightAt: (x: number, z: number) => number, tier: WallTier, look: WallLook, lampsOn: "inner" | "outer", stoneSet: PbrSet, roofSet: PbrSet, shadows: boolean): Built {
  const inst = wallInstances(plan, heightAt, lampsOn);
  const geos = {
    module: wallModuleGeometry(tier),
    tower: towerGeometry(tier),
    roof: roofGeometry(tier),
    trim: trimGeometry(tier),
    banner: bannerGeometry(),
    lantern: lanternGeometry(),
  };
  const stone = createPbrMaterial(stoneSet, { repeatMeters: [1, 1], params: { color: new Color().setRGB(...look.stone), vertexColors: true } });
  stone.name = "M_castle_stone";
  const roof = createPbrMaterial(roofSet, { repeatMeters: [1, 1], normalStrength: 1.3, params: { color: new Color().setRGB(...look.roof), vertexColors: true } });
  roof.name = "M_castle_roof";
  const gold = new MeshStandardMaterial({ color: "#f2c14e", emissive: new Color("#6b4a08"), emissiveIntensity: 0.5, roughness: 0.32, metalness: 0.65 });
  gold.name = "M_castle_gold";
  const bannerTex = bannerTexture(look.banner);
  const banner = new MeshStandardMaterial({ map: bannerTex, roughness: 0.85, side: FrontSide });
  banner.name = "M_castle_banner";
  const iron = new MeshStandardMaterial({ color: "#26221f", roughness: 0.55, metalness: 0.5 });
  iron.name = "M_castle_iron";
  const glass = new MeshStandardMaterial({ color: "#f5deb0", emissive: new Color("#ffb24a"), emissiveIntensity: 0, roughness: 0.2, side: DoubleSide });
  glass.name = "M_castle_lamp";

  const root = new Group();
  root.name = "castle_wall";
  const parts = [
    instanced(geos.module, stone, inst.modules, "castle_wall_modules", shadows),
    instanced(geos.tower, stone, inst.towers, "castle_wall_towers", shadows),
    instanced(geos.roof, roof, inst.towers, "castle_wall_roofs", shadows),
    instanced(geos.trim, gold, inst.towers, "castle_wall_trim", false),
    instanced(geos.banner, banner, inst.towers, "castle_wall_banners", false),
    instanced(geos.lantern, [iron, glass], inst.lanterns, "castle_wall_lanterns", false),
  ];
  root.add(...parts);
  const triangles =
    trianglesOf(geos.module) * inst.modules.length +
    (trianglesOf(geos.tower) + trianglesOf(geos.roof) + trianglesOf(geos.trim) + trianglesOf(geos.banner)) * inst.towers.length +
    trianglesOf(geos.lantern) * inst.lanterns.length;
  return {
    root,
    glass,
    glows: inst.glows,
    stats: { drawCalls: 8, triangles: Math.round(triangles), modules: inst.modules.length, towers: inst.towers.length, lanterns: inst.lanterns.length },
    dispose() {
      for (const g of Object.values(geos)) g.dispose();
      for (const m of [stone, roof, gold, banner, iron, glass]) m.dispose();
      bannerTex.dispose();
      for (const p of parts) p.dispose();
    },
  };
}

declare global {
  interface Window {
    /** Dev-only: each mounted wall's numbers (draw calls, triangles, instances). */
    __cvWall?: Record<string, Built["stats"]>;
  }
}

/**
 * A wall from `plan` on `heightAt` (null: not yet known, nothing drawn). Built once its two texture sets are in, compiled before its first
 * frame (no hitch when it appears).
 */
export function CastleWall({
  id,
  plan,
  heightAt,
  tier,
  look,
  lampsOn,
  shadows = false,
}: {
  id: string;
  plan: WallPlan;
  heightAt: ((x: number, z: number) => number) | null;
  tier: WallTier;
  look: WallLook;
  lampsOn: "inner" | "outer";
  shadows?: boolean;
}) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const [built, setBuilt] = useState<Built | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!heightAt) return;
    let dead = false;
    let b: Built | null = null;
    const ptier = pbrTierFor(tier === "high" ? "high" : "low");
    void Promise.all([getPbrSet("stone_ashlar", ptier, gl as WebGLRenderer), getPbrSet("roof_slate", ptier, gl as WebGLRenderer)])
      .then(([stoneSet, roofSet]) => {
        if (dead) return;
        b = make(plan, heightAt, tier, look, lampsOn, stoneSet, roofSet, shadows);
        setBuilt(b);
      })
      .catch((e) => {
        if (import.meta.env.DEV) console.warn("[castle wall] texture sets failed", e);
      });
    return () => {
      dead = true;
      b?.dispose();
      setBuilt(null);
      setReady(false);
    };
  }, [gl, plan, heightAt, tier, look, lampsOn, shadows]);

  useEffect(() => {
    if (!built) return;
    let dead = false;
    void compileSafely(gl, built.root, camera).then(() => {
      if (!dead) setReady(true);
    });
    return () => {
      dead = true;
    };
  }, [built, gl, camera]);

  useEffect(() => {
    if (!import.meta.env.DEV || !built) return;
    window.__cvWall = { ...(window.__cvWall ?? {}), [id]: built.stats };
    return () => {
      if (window.__cvWall) delete window.__cvWall[id];
    };
  }, [built, id]);

  useFrame(() => {
    if (!built) return;
    const l = Math.min(1, dayNight.applied.lights);
    built.glass.emissiveIntensity = 0.15 + 2.4 * l;
  });

  const glows = useMemo(() => built?.glows ?? [], [built]);
  if (!built || !ready) return null;
  return (
    <>
      <primitive object={built.root} dispose={null} />
      {glows.length > 0 && <BulbHalos places={glows} size={2.4} strength={0.9} />}
    </>
  );
}

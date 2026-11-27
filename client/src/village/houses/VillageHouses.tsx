import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { houseFlowerBoxBeds } from "./houseFlowerBoxes";
import { flowerMassMesh } from "./houseFlowerMass";
import type { Mesh as MassMesh } from "three";
import { HOUSE_FLOWER_MASS } from "../veg/vegLod";
import { useFrame, useThree } from "@react-three/fiber";
import { RepeatWrapping, SRGBColorSpace, type Material, type Mesh, type Object3D, type Texture } from "three";
import { VILLAGE_LAYOUT } from "@caysonverse/shared/village/villageLayout";
import { HOUSE_EXTERIOR_DEFAULT } from "@caysonverse/shared/village/houseOwnership";
import { isTouchDevice } from "../../device";
import { dayNight } from "../dayNightDriver";
import type { VillageTier } from "../villageModelPrep";
import { noteHousesRequested } from "../villageRelease";
import { HouseShowcase } from "../portal/HouseShowcase";
import { readHouseMaps, readHouseTextureMeta, readHouses } from "./housesLoader";
import {
  applyHousesDayNight,
  housesMode,
  cutOldHouses,
  disposeHouses,
  houseTextureFiles,
  pickDetail,
  prepareHouses,
  showDetail,
  type HouseMaps,
  type OldHouseCut,
} from "./housesPrep";
import { buildHouseSigns, houseBoards } from "./houseSigns";
import { getLocalPose, setPorchesDrawn } from "./houseLift";
import { createVegetation, type VillageVegetation } from "../veg/villageVegetation";
import { vegModeFrom } from "../veg/vegMode";

/** The flower masses, one per graphics tier, made once (houseFlowerMass.ts). */
const flowerMasses = new Map<string, MassMesh>();
function flowerMassFor(tier: "high" | "low"): MassMesh {
  let m = flowerMasses.get(tier);
  if (!m) {
    const beds = houseFlowerBoxBeds().filter((b): b is Extract<typeof b, { kind: "box" }> => b.kind === "box");
    const lod = HOUSE_FLOWER_MASS[tier];
    m = flowerMassMesh(beds, lod.near, lod.full).mesh;
    flowerMasses.set(tier, m);
  }
  return m;
}

declare global {
  interface Window {
    /** Dev-only: the houses' model in the game (집 외관 A8, X3): ready, the detail shown, triangles and draws, the old houses' cut. */
    __cvHouses?: () => {
      ready: boolean;
      tier: VillageTier;
      porches: string[];
      detail: string[];
      stats: unknown;
      cut: { meshes: number; trianglesRemoved: number; proxiesHidden: number } | null;
      boards: number;
      prepares: number;
    };
  }
}

/**
 * The ten houses' own model (집 외관 A8, X3; housesPrep.ts): read beside the village (never waited for), dressed for the tier,
 * drawn with their nameplates; once drawn, the old houses are cut out of the village clone `villageRoot` and the porches lift
 * the bodies on them (houseLift.ts). Unmounted (or failed: LoadBoundary), everything is put back.
 */
export { housesMode };

/** How many times the houses were dressed this page (DEV: once per visit and tier, not per render). */
let prepares = 0;

export function VillageHouses({ villageRoot, tier }: { villageRoot: Object3D; tier: VillageTier }) {
  noteHousesRequested();
  const gltf = readHouses();
  const meta = readHouseTextureMeta();
  const files = useMemo(() => houseTextureFiles(meta, tier), [meta, tier]);
  const read = readHouseMaps(files.map((f) => f.url));
  // the same cached textures come back in a new array on every render: keep one array while they are the same (a new
  // array would dress the houses again, and free the materials a warm-up may still be compiling)
  const texKey = read.map((t) => t.uuid).join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const textures = useMemo(() => read, [texKey]);
  const gl = useThree((s) => s.gl);

  const nodes = useMemo(() => {
    const maps: Record<string, Partial<HouseMaps>> = {};
    const aniso = Math.min(8, gl.capabilities.getMaxAnisotropy());
    files.forEach((f, i) => {
      const t = textures[i]!;
      if (!gl.properties.has(t)) {
        // glTF UVs; the sets tile; only the albedo is colour (a texture already on the GPU keeps its first settings)
        t.flipY = false;
        t.wrapS = t.wrapT = RepeatWrapping;
        t.anisotropy = f.kind === "albedo" ? aniso : Math.min(4, aniso);
        if (f.kind === "albedo") t.colorSpace = SRGBColorSpace;
        t.needsUpdate = true;
      }
      const m = (maps[f.material] ??= {});
      if (f.kind === "albedo") m.map = t;
      else if (f.kind === "normal") m.normalMap = t;
      else m.roughnessMap = t;
    });
    const full: Record<string, HouseMaps> = {};
    for (const [k, m] of Object.entries(maps)) if (m.map && m.normalMap) full[k] = { map: m.map, normalMap: m.normalMap, roughnessMap: m.roughnessMap ?? null };
    // the planting cards' picture: the village's own flower atlas (T_flora on its M_leaf_flora)
    let floraMap: Texture | null = null;
    villageRoot.traverse((o) => {
      const m = (o as Mesh).material as Material | Material[] | undefined;
      for (const x of Array.isArray(m) ? m : m ? [m] : []) if (!floraMap && x.name === "M_leaf_flora") floraMap = (x as { map?: Texture | null }).map ?? null;
    });
    prepares++;
    return prepareHouses(gltf.scene, full, floraMap);
  }, [gltf, files, textures, gl, villageRoot]);

  // the beds' and gardens' plants: grown in 3D from the planting cards, as the village's (X2 hand-over; cards hidden)
  const vegRef = useRef<VillageVegetation | null>(null);
  useEffect(() => {
    const mode = vegModeFrom(window.location.search, import.meta.env.DEV);
    if (mode === "old") return;
    let dead = false;
    nodes.root.updateMatrixWorld(true);
    void createVegetation(nodes.root, tier, mode, () => dead, { flowersOnly: true })
      .then((v) => {
        if (!v) return;
        if (dead) {
          v.dispose();
          return;
        }
        // the flowers and grass tufts only: the beds' soil is the model's own (X2's, 0.29 m)
        for (const c of [...v.group.children]) if (!c.name.startsWith("veg_flowers")) v.group.remove(c);
        vegRef.current = v;
        nodes.root.add(v.group);
      })
      .catch((e: unknown) => console.error("[houses] flowers failed", e));
    return () => {
      dead = true;
      const v = vegRef.current;
      vegRef.current = null;
      if (v) {
        nodes.root.remove(v.group);
        v.dispose();
      }
    };
  }, [nodes, tier]);

  // the window boxes', baskets', pots' and borders' flower masses: full mounds of colour from the street (houseFlowerMass.ts)
  // (one mesh per tier, kept for the session: freeing its material while the warm-up still compiles it is what made the
  // glGetProgramiv warnings on a remount — X3's lesson with the house materials)
  useEffect(() => {
    const mass = flowerMassFor(tier);
    nodes.root.add(mass);
    return () => {
      nodes.root.remove(mass);
    };
  }, [nodes, tier]);

  const signs = useMemo(() => {
    const houses = VILLAGE_LAYOUT.sceneryHouses.filter((h) => h.kind === "house");
    return buildHouseSigns(houseBoards(houses, HOUSE_EXTERIOR_DEFAULT), gl.capabilities.getMaxAnisotropy());
  }, [gl]);
  useEffect(() => {
    if (signs.mesh) nodes.root.add(signs.mesh);
    return () => {
      if (signs.mesh) nodes.root.remove(signs.mesh);
      signs.dispose();
    };
  }, [nodes, signs]);

  // drawn: the old houses out of the clone, the porches lifting
  const cutRef = useRef<OldHouseCut | null>(null);
  useLayoutEffect(() => {
    const cut = cutOldHouses(villageRoot);
    cutRef.current = cut;
    setPorchesDrawn(nodes.porches);
    return () => {
      cut.restore();
      cutRef.current = null;
      setPorchesDrawn([]);
    };
  }, [villageRoot, nodes]);

  const shown = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (import.meta.env.DEV) {
      window.__cvHouses = () => {
        const c = cutRef.current;
        return {
          ready: true,
          tier,
          porches: nodes.porches,
          detail: [...shown.current],
          stats: nodes.stats,
          cut: c ? { meshes: c.meshes, trianglesRemoved: c.trianglesRemoved, proxiesHidden: c.proxiesHidden } : null,
          boards: signs.mesh ? 1 : 0,
          prepares,
        };
      };
    }
    return () => {
      if (import.meta.env.DEV) delete window.__cvHouses;
      disposeHouses(nodes);
    };
  }, [nodes, tier, signs]);

  const device = isTouchDevice ? "phone" : "pc";
  const refs = useMemo(() => [{ x: 0, z: 0 }, { x: 0, z: 0 }], []);
  useFrame(({ camera, clock, gl: r }) => {
    applyHousesDayNight(nodes, dayNight.applied);
    vegRef.current?.update(camera, clock.elapsedTime, r.domElement.height);
    const p = getLocalPose();
    refs[0]!.x = camera.position.x;
    refs[0]!.z = camera.position.z;
    const posed = Number.isFinite(p.x);
    refs[1]!.x = posed ? p.x : camera.position.x;
    refs[1]!.z = posed ? p.z : camera.position.z;
    const next = pickDetail(shown.current, refs, nodes.boxes, device);
    if (next.size !== shown.current.size || [...next].some((id) => !shown.current.has(id))) {
      shown.current = next;
      showDetail(nodes, next);
    }
  });

  return (
    <>
      <primitive object={nodes.root} dispose={null} />
      {/* the nearest house's real rooms behind its clear glass (owner 2026-11-21) */}
      <HouseShowcase glass={nodes.glow.glass} />
    </>
  );
}

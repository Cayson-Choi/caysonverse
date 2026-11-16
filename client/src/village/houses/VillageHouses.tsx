import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { RepeatWrapping, SRGBColorSpace, type Object3D } from "three";
import { VILLAGE_LAYOUT } from "@caysonverse/shared/village/villageLayout";
import { HOUSE_EXTERIOR_DEFAULT } from "@caysonverse/shared/village/houseOwnership";
import { isTouchDevice } from "../../device";
import { dayNight } from "../dayNightDriver";
import type { VillageTier } from "../villageModelPrep";
import { noteHousesRequested } from "../villageRelease";
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
    };
  }
}

/**
 * The ten houses' own model (집 외관 A8, X3; housesPrep.ts): read beside the village (never waited for), dressed for the tier,
 * drawn with their nameplates; once drawn, the old houses are cut out of the village clone `villageRoot` and the porches lift
 * the bodies on them (houseLift.ts). Unmounted (or failed: LoadBoundary), everything is put back.
 */
export { housesMode };

export function VillageHouses({ villageRoot, tier }: { villageRoot: Object3D; tier: VillageTier }) {
  noteHousesRequested();
  const gltf = readHouses();
  const meta = readHouseTextureMeta();
  const files = useMemo(() => houseTextureFiles(meta, tier), [meta, tier]);
  const textures = readHouseMaps(files.map((f) => f.url));
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
    return prepareHouses(gltf.scene, full);
  }, [gltf, files, textures, gl]);

  const signs = useMemo(() => {
    const houses = VILLAGE_LAYOUT.sceneryHouses.filter((h) => h.kind === "house");
    return buildHouseSigns(houseBoards(houses, HOUSE_EXTERIOR_DEFAULT), Math.min(8, gl.capabilities.getMaxAnisotropy()));
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
  useFrame(({ camera }) => {
    applyHousesDayNight(nodes, dayNight.applied);
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

  return <primitive object={nodes.root} dispose={null} />;
}

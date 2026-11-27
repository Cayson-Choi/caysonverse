import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { Group, type Material, type Mesh, type Texture } from "three";
import { HOUSE_NUMBERS, houseFloorBounds, type HouseFloor, type HouseNumber } from "@caysonverse/shared/village/houseAreas";
import { houseSolidBox } from "@caysonverse/shared/village/houseExterior";
import { useQualityTier } from "../../game/QualityEffects";
import { DRACO_PATH, configureLightmap } from "../../game/hub/hubModelPrep";
import { dayNight } from "../dayNightDriver";
import { hallNightWeight } from "../hallNight";
import { HOUSE_VIEW_MATERIAL, dressLoadedHouse, houseUrls, houseWantsLightmap, prepareHouse, type HouseNodes } from "../houseModelPrep";
import { houseNightMapUniform, houseNightUniform, patchHouseGlowMaterial, patchHouseLightmapMaterial, resetHouseNight } from "../houseNight";
import { holdHouseFiles, loadHouseTexture, noteHouseRequested } from "../houseRelease";
import { localArea } from "../villageArea";
import { applyClearGlassDayNight, houseCardHide, showcaseRooms, type ClearGlass, type GlassBox } from "./clearGlass";

const ROOMS_ON = showcaseRooms();
import { a8House, housePortalRoom } from "./portalRooms";
import { frameToVillage, insideRect } from "./RoomShowcase";

/**
 * The real rooms behind a house's windows (owner 2026-11-21: "건물 밖에서도 유리창을 통해서 안이 보이게"). The lots' way
 * (RoomShowcase.tsx) for the A8 houses: the house's own interior model (`house_N.glb`, both floors, with its baked light by day and at
 * night — the same files and cache the house's inside reads, houseRelease.ts) drawn inside its shell, door on door (portalRooms.ts
 * `housePortalRoom`), for the ONE house nearest the camera (houseRelease keeps one house in memory: walking in reads nothing again).
 * Its panes turn clear (clearGlass.ts) and the lit window cards behind them step aside; every other house keeps dark reflective panes
 * over its cards — a dim room by day, a warm lit one at night.
 *
 * Owned by the clear-glass work; the interior models and their furniture are the house agents' — this only draws them, read-only
 * (the window panorama band, `M_view`, is left out: from outside the house's own glass stands there).
 */

/** The nearest house's rooms are drawn within this distance (m, camera to the house's solid box). */
export const HOUSE_SHOW_M = { pc: 38, phone: 26 } as const;
const HYST = 5;

function boxOf(n: HouseNumber): GlassBox {
  const b = houseSolidBox(a8House(n));
  return [b.minX, b.minZ, b.maxX, b.maxZ] as const;
}

/** One house's two floors, drawn in its shell (suspends while its model loads). */
function HouseRooms({ n, onShown }: { n: HouseNumber; onShown: (n: HouseNumber | null) => void }) {
  noteHouseRequested(n);
  const tier = useQualityTier();
  const urls = houseUrls(n, tier);
  const gltf = useGLTF(urls.glb, DRACO_PATH);
  const [day, setDay] = useState<Texture | null>(null);
  const wantsLightmap = useMemo(() => houseWantsLightmap(gltf.scene), [gltf]);
  // held once drawn (an effect: holding frees every other house at once, and the house drawn before must be gone first); let go on
  // unmount unless the player is walking INTO this house, whose own hold takes the files over (houseRelease keeps a set of held
  // houses, not a count: our release would let the inside's files go)
  useEffect(() => {
    const release = holdHouseFiles(n);
    return () => {
      if (!localArea().startsWith(`house:house_${n}:`)) release();
    };
  }, [n]);
  useEffect(() => {
    if (!wantsLightmap) return;
    let live = true;
    void loadHouseTexture(n, urls.lightmapDay).then((t) => live && setDay(t));
    void loadHouseTexture(n, urls.lightmapNight).then((t) => {
      if (live && t) houseNightMapUniform.value = configureLightmap(t);
    });
    return () => {
      live = false;
      resetHouseNight();
    };
  }, [n, urls.lightmapDay, urls.lightmapNight, wantsLightmap]);

  const floors = useMemo(() => {
    dressLoadedHouse(gltf.scene, n);
    const out: Array<{ nodes: HouseNodes; group: Group; dispose: () => void }> = [];
    for (const floor of [1, 2] as HouseFloor[]) {
      const nodes = prepareHouse(gltf.scene, n, floor, day);
      const b = houseFloorBounds(n, floor);
      const rect = { minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ };
      const own: Array<{ dispose(): void }> = [];
      const drop: Mesh[] = [];
      nodes.root.updateMatrixWorld(true);
      nodes.root.traverse((o) => {
        const m = o as Mesh;
        if (!m.isMesh) return;
        const mats = (Array.isArray(m.material) ? m.material : [m.material]) as Material[];
        if (mats.some((x) => x.name === HOUSE_VIEW_MATERIAL)) {
          drop.push(m);
          return;
        }
        m.raycast = () => {};
        m.castShadow = false;
        m.receiveShadow = false;
        if (!(m as { isInstancedMesh?: boolean }).isInstancedMesh) {
          const g = insideRect(m.geometry, m.matrixWorld, rect);
          if (g) {
            m.geometry = g;
            own.push(g);
          }
        }
      });
      for (const m of drop) m.visible = false;
      for (const m of nodes.lightmapped) patchHouseLightmapMaterial(m);
      for (const m of nodes.glows) patchHouseGlowMaterial(m);
      const group = new Group();
      group.name = `house_showcase_${n}_${floor}`;
      group.matrixAutoUpdate = false;
      group.matrix.copy(frameToVillage(housePortalRoom(n, floor).frame));
      group.add(nodes.root);
      group.updateMatrixWorld(true);
      out.push({ nodes, group, dispose: () => own.forEach((g) => g.dispose()) });
    }
    return out;
  }, [gltf, n, day]);
  useEffect(() => () => floors.forEach((f) => f.dispose()), [floors]);
  useEffect(() => {
    onShown(n);
    return () => onShown(null);
  }, [n, onShown, floors]);

  useFrame(() => {
    houseNightUniform.value = hallNightWeight(dayNight.outdoor.night, houseNightMapUniform.value !== null);
  });

  return (
    <>
      {floors.map((f) => (
        <primitive key={f.group.name} object={f.group} dispose={null} />
      ))}
    </>
  );
}

declare global {
  interface Window {
    /** DEV: the house whose rooms are drawn behind its glass now, and the one wanted. */
    __cvHouseShowcase?: () => { shown: number | null; wanted: number | null };
  }
}

/** The nearest house's rooms behind its glass (mounted with the houses: `glass` is their shared pane material). */
export function HouseShowcase({ glass }: { glass: ClearGlass | null }) {
  const camera = useThree((s) => s.camera);
  const tier = useQualityTier();
  const phone = tier !== "high";
  const [wanted, setWanted] = useState<HouseNumber | null>(null);
  const wantedRef = useRef<HouseNumber | null>(null);
  const shownRef = useRef<HouseNumber | null>(null);
  const boxes = useMemo(() => new Map(HOUSE_NUMBERS.map((n) => [n, boxOf(n)] as const)), []);

  const onShown = useMemo(
    () => (n: HouseNumber | null) => {
      shownRef.current = n;
      const b = n === null ? null : boxes.get(n)!;
      glass?.setShown(b ? [b] : []);
      if (b) houseCardHide.uCardHide.value.set(b[0] - 0.4, b[1] - 0.4, b[2] + 0.4, b[3] + 0.4);
      else houseCardHide.uCardHide.value.set(0, 0, -1, -1);
    },
    [glass, boxes],
  );

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    window.__cvHouseShowcase = () => ({ shown: shownRef.current, wanted: wantedRef.current });
    return () => {
      delete window.__cvHouseShowcase;
    };
  }, []);

  useFrame(() => {
    const p = camera.position;
    const lim = phone ? HOUSE_SHOW_M.phone : HOUSE_SHOW_M.pc;
    let best: HouseNumber | null = null;
    let bd = Infinity;
    for (const [n, [x0, z0, x1, z1]] of boxes) {
      const d = Math.hypot(Math.max(x0 - p.x, 0, p.x - x1), Math.max(z0 - p.z, 0, p.z - z1)) - (n === wantedRef.current ? HYST : 0);
      if (ROOMS_ON && d < lim && d < bd) (bd = d), (best = n);
    }
    if (best !== wantedRef.current) {
      wantedRef.current = best;
      setWanted(best);
    }
    applyClearGlassDayNight(dayNight.outdoor);
  });

  if (wanted === null) return null;
  return (
    <Quiet key={wanted}>
      <Suspense fallback={null}>
        <HouseRooms n={wanted} onShown={onShown} />
      </Suspense>
    </Quiet>
  );
}

/** A failed read of a house's rooms is simply no rooms behind its glass (its panes stay dark): logged, never a notice. */
class Quiet extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  componentDidCatch(err: unknown): void {
    console.warn("[portal] house rooms", err);
  }
  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

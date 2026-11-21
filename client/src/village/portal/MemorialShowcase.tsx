import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF, useTexture } from "@react-three/drei";
import { Group, type Mesh, type Object3D } from "three";
import { useQualityTier } from "../../game/QualityEffects";
import { DRACO_PATH } from "../../game/hub/hubModelPrep";
import { dayNight } from "../dayNightDriver";
import { hallNightReady, hallNightUniform, hallNightWeight, loadHallNight } from "../hallNight";
import { MEMORIAL_LIGHTMAP_URLS, MEMORIAL_MODEL_URL, disposeMemorial, prepareMemorial } from "../memorialModelPrep";
import { holdMemorialFiles, noteMemorialRequested } from "../memorialRelease";
import { applyClearGlassDayNight, memorialCardHide, showcaseRooms, type ClearGlass } from "./clearGlass";

const ROOMS_ON = showcaseRooms();
import { memorialPortalRoom } from "./portalRooms";
import { frameToVillage, insideRect } from "./RoomShowcase";

/**
 * The memorial hall seen through its shop front (owner 2026-11-21: "건물 밖에서도 유리창을 통해서 안이 보이게"): the lots' way
 * (RoomShowcase.tsx) for 케이슨 마을 추모관 — the hall's own model (`memorial.glb`, with its baked light by day and at night: the files and
 * cache the hall reads, memorialRelease.ts) drawn behind the porch's back wall, its door on the porch's shop-front door (portalRooms.ts
 * `memorialPortalRoom`), while the camera is near. The village's panes there turn clear (clearGlass.ts) and the painted card behind them
 * steps aside (`memorialCardHide`). The cubbies' photos and candles (memorial_props.glb) stay inside: from the porch the hall's room,
 * light and furniture read through the glass.
 */

/** The hall is drawn within this distance (m) of the porch. */
export const MEMORIAL_SHOW_M = { pc: 40, phone: 28 } as const;
const HYST = 5;
/** The memorial building's box (village x0, z0, x1, z1): its panes clear and its cards hidden while the hall is drawn. */
const BUILDING = [-10.4, -68.4, 10.4, -51.6] as const;
const PORCH = { x: 0, z: -52 } as const;

function HallRoom({ onShown }: { onShown: (on: boolean) => void }) {
  noteMemorialRequested();
  const tier = useQualityTier();
  const hall = useGLTF(MEMORIAL_MODEL_URL, DRACO_PATH);
  const lightmap = useTexture(MEMORIAL_LIGHTMAP_URLS[tier]);
  useEffect(() => holdMemorialFiles(), []);
  const shown = useMemo(() => {
    const nodes = prepareMemorial(hall.scene, lightmap);
    const room = memorialPortalRoom();
    const rect = { minX: room.min[0], maxX: room.max[0], minZ: room.min[2], maxZ: room.max[2] };
    const own: Array<{ dispose(): void }> = [];
    nodes.root.updateMatrixWorld(true);
    nodes.root.traverse((o: Object3D) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
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
    const group = new Group();
    group.name = "memorial_showcase";
    group.matrixAutoUpdate = false;
    group.matrix.copy(frameToVillage(room.frame));
    group.add(nodes.root);
    group.updateMatrixWorld(true);
    return { nodes, group, dispose: () => own.forEach((g) => g.dispose()) };
  }, [hall, lightmap]);
  useEffect(
    () => () => {
      shown.dispose();
      disposeMemorial(shown.nodes);
    },
    [shown],
  );
  useEffect(() => {
    onShown(true);
    return () => onShown(false);
  }, [shown, onShown]);
  const nightAsked = useRef(false);
  useFrame(() => {
    const o = dayNight.outdoor;
    if (!nightAsked.current && Math.max(o.night, o.lights) > 0.05) {
      nightAsked.current = true;
      void loadHallNight(tier).catch(() => undefined);
    }
    hallNightUniform.value = hallNightWeight(o.night, hallNightReady());
  });
  return <primitive object={shown.group} dispose={null} />;
}

/** The memorial hall behind the porch's glass (mounted with the village model: `glass` is the village's pane material). */
export function MemorialShowcase({ glass }: { glass: ClearGlass | null }) {
  const camera = useThree((s) => s.camera);
  const tier = useQualityTier();
  const phone = tier !== "high";
  const [near, setNear] = useState(false);
  const nearRef = useRef(false);
  const onShown = useMemo(
    () => (on: boolean) => {
      glass?.setShown(on ? [BUILDING] : []);
      if (on) memorialCardHide.uCardHide.value.set(...BUILDING);
      else memorialCardHide.uCardHide.value.set(0, 0, -1, -1);
      if (import.meta.env.DEV) (window as unknown as { __cvMemorialShown?: boolean }).__cvMemorialShown = on;
    },
    [glass],
  );
  useFrame(() => {
    const p = camera.position;
    const d = Math.hypot(p.x - PORCH.x, p.z - PORCH.z);
    const lim = phone ? MEMORIAL_SHOW_M.phone : MEMORIAL_SHOW_M.pc;
    const want = ROOMS_ON && (nearRef.current ? d < lim + HYST : d < lim);
    if (want !== nearRef.current) {
      nearRef.current = want;
      setNear(want);
    }
    applyClearGlassDayNight(dayNight.outdoor);
  });
  if (!near) return null;
  return (
    <Quiet>
      <Suspense fallback={null}>
        <HallRoom onShown={onShown} />
      </Suspense>
    </Quiet>
  );
}

/** A failed read of the hall is simply no hall behind the glass (logged, never a notice). */
class Quiet extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  componentDidCatch(err: unknown): void {
    console.warn("[portal] memorial hall", err);
  }
  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF, useTexture } from "@react-three/drei";
import { Group, type Mesh, type Object3D } from "three";
import { useQualityTier } from "../../game/QualityEffects";
import { DRACO_PATH } from "../../game/hub/hubModelPrep";
import { dayNight } from "../dayNightDriver";
import { hallNightReady, hallNightUniform, hallNightWeight, loadHallNight } from "../hallNight";
import { MEMORIAL_LIGHTMAP_URLS, MEMORIAL_MODEL_URL, disposeMemorial, prepareMemorial } from "../memorialModelPrep";
import { holdMemorialFiles, noteMemorialRequested, setMemorialTier } from "../memorialRelease";
import { SAMPLE_PHOTO_ATLAS } from "../sampleCubbies";
import { localArea } from "../villageArea";
import { applyClearGlassDayNight, clearGlassMaterial, memorialCardHide, showcaseRooms, type ClearGlass } from "./clearGlass";
import { isHallGlass } from "../hallGlass";

const ROOMS_ON = showcaseRooms();
import { MEMORIAL_PORCH, memorialPortalRoom, toVillage } from "./portalRooms";
import { trimMesh, type Footprint } from "../street/streetTrim";
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
  // read exactly as the hall reads them (one cache entry: the light map with the portrait atlas), so the hall's release clears and frees
  // the same entry — a light map read alone would be freed with the pair yet stay cached, and the next look would upload a freed image
  setMemorialTier(tier);
  const [lightmap] = useTexture([MEMORIAL_LIGHTMAP_URLS[tier], SAMPLE_PHOTO_ATLAS.url]);
  // held from the first render (a release pending from the hall's own exit is cancelled before anything frees the files); let go on
  // unmount unless the player is walking INTO the hall, whose own hold takes the files over (memorialRelease keeps one flag, not a count)
  const [release] = useState(() => holdMemorialFiles());
  useEffect(() => () => {
    if (localArea() !== "hall") release();
  }, [release]);
  const shown = useMemo(() => {
    const nodes = prepareMemorial(hall.scene, lightmap);
    const room = memorialPortalRoom();
    const rect = { minX: room.min[0], maxX: room.max[0], minZ: room.min[2], maxZ: room.max[2] };
    const own: Array<{ dispose(): void }> = [];
    // the hall's own door and window glass, seen from the porch: plain clear glass (its inside sheens are for a visitor in the hall)
    const clear = clearGlassMaterial("M_hall_glass_outside");
    clear.setShown([[-1e5, -1e5, 1e5, 1e5]]);
    own.push(clear.material);
    nodes.root.updateMatrixWorld(true);
    nodes.root.traverse((o: Object3D) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      m.raycast = () => {};
      if (!Array.isArray(m.material) && isHallGlass(m.material.name)) m.material = clear.material;
      m.castShadow = false;
      m.receiveShadow = false;
      if (!(m as { isInstancedMesh?: boolean }).isInstancedMesh) {
        const g = insideRect(m.geometry, m.matrixWorld, rect, room.cut);
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

/**
 * The village model's stand-in behind the shop front (a shallow vestibule: a rendered back wall 3 m in, its painted card), inside the
 * hall's volume: taken out of the clone while the hall is drawn there. The porch, the building's outer walls and its roof stay.
 */
function trimVestibule(root: Object3D): () => void {
  const pr = memorialPortalRoom();
  const a = toVillage(pr.frame, pr.min[0], 0, pr.min[2]);
  const b = toVillage(pr.frame, pr.max[0], 0, pr.max[2]);
  const minX = Math.min(a[0], b[0]) + 0.3, maxX = Math.max(a[0], b[0]) - 0.3;
  const minZ = Math.min(a[2], b[2]) + 0.3, maxZ = MEMORIAL_PORCH.backZ - 0.2;
  const y0 = MEMORIAL_PORCH.floorY - 0.1, y1 = MEMORIAL_PORCH.floorY + pr.max[1];
  const feet: Footprint[] = [{ minX, maxX, minZ, maxZ, maxY: y1, minTop: -1, inside: (x, y, z) => x > minX && x < maxX && z > minZ && z < maxZ && y > y0 && y < y1 }];
  const undo: Array<() => void> = [];
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || (mesh as { isInstancedMesh?: boolean }).isInstancedMesh) return;
    for (let p: Object3D | null = mesh; p; p = p.parent) if (p.name === "memorial_showcase") return;
    const t = trimMesh(mesh, feet);
    if (!t) return;
    const original = mesh.geometry;
    mesh.geometry = t.geometry;
    undo.push(() => {
      if (mesh.geometry !== t.geometry) return;
      mesh.geometry = original;
      t.geometry.dispose();
    });
  });
  return () => undo.reverse().forEach((u) => u());
}

/** The memorial hall behind the porch's glass (mounted with the village model: `root` its clone, `glass` the village's pane material). */
export function MemorialShowcase({ root, glass }: { root: Object3D; glass: ClearGlass | null }) {
  const camera = useThree((s) => s.camera);
  const tier = useQualityTier();
  const phone = tier !== "high";
  const [near, setNear] = useState(false);
  const nearRef = useRef(false);
  const untrim = useRef<(() => void) | null>(null);
  const onShown = useMemo(
    () => (on: boolean) => {
      untrim.current?.();
      untrim.current = on ? trimVestibule(root) : null;
      glass?.setShown(on ? [BUILDING] : []);
      if (on) memorialCardHide.uCardHide.value.set(...BUILDING);
      else memorialCardHide.uCardHide.value.set(0, 0, -1, -1);
      if (import.meta.env.DEV) (window as unknown as { __cvMemorialShown?: boolean }).__cvMemorialShown = on;
    },
    [glass, root],
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

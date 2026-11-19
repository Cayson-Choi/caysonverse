import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Group } from "three";
import { coasterTrack } from "@caysonverse/shared/land/coaster";
import { PARK_BOUNDS, PARK_PLANTERS, PARK_TREES, PARK_TROUGHS } from "@caysonverse/shared/village/parkArea";
import { PARK_PONDS } from "./ParkScenery";
import type { Bed } from "../village/veg/flowerPlacement";
import type { Card } from "../village/veg/vegCards";
import { flowerMassMesh } from "../village/houses/houseFlowerMass";
import { CLICK_PICK_KEY } from "../game/clickPick";
import { isTouchDevice } from "../device";
import { selfRide } from "./coasterRide";
import { createVegetation, type VillageVegetation } from "../village/veg/villageVegetation";
import type { Bush } from "../village/veg/shrubs";
import type { TreeSpec } from "../village/veg/treeSkeleton";
import { circuitGround, taken } from "./ParkScenery";
import { parkBorders } from "./parkBorders";

/** A phone draws the park's trees to 380 m and its bushes to 170 m (the tier's bands go to 600 and 300): the wheel's top sees the whole park. */
export const PHONE_FAR_RANGE = { trees: 380, bush: 170 } as const;

const rngOf = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

/**
 * 케이슨랜드's trees and bushes, grown by the VILLAGE's vegetation (veg/villageVegetation.ts, `parkTrees` / `parkBushes`): the same crowns of
 * twigs and 3D leaves, the same bark, wind and levels of detail as the village's trees and the cherries in bloom, at the park's own spots:
 *  - the park's collidable trees (shared PARK_TREES: the verges, the plaza, the shops' backs): a share of them cherries;
 *  - woods among the coaster's layout (outside the walk bounds, no colliders), thicker on a PC;
 *  - a treeline ring at 330-400 m, thinner, taller.
 * Every tier uses the village's PHONE levels of detail (veg/vegLod.ts VEG_TIERS.low): a full crown right at the player's feet, the simple 3D
 * sprays beyond, thinned far out; the PC frame budget (DESIGN.md section 8) cannot carry the PC bands for the park's trees.
 */
/** The flower beds: the plaza's troughs, the planters at the promenade's end, and borders along the circuit's path and round the ponds (planted by the village's flower system). */
export function parkBeds(): { beds: Bed[]; cards: Card[] } {
  const beds: Bed[] = [];
  const rnd = rngOf(515);
  for (const t of PARK_TROUGHS) beds.push({ kind: "box", x0: t.x0 + 0.1, x1: t.x1 - 0.1, z0: t.z0 + 0.1, z1: t.z1 - 0.1, y: t.y, out: null, plant: "pot" });
  for (const p of PARK_PLANTERS) beds.push({ kind: "box", x0: p.x - p.w / 2 + 0.1, x1: p.x + p.w / 2 - 0.1, z0: p.z - p.d / 2 + 0.1, z1: p.z + p.d / 2 - 0.1, y: 0.84, out: null, plant: "pot" });
  const ground = circuitGround();
  ground.forEach((g, i) => {
    if (i % 4 !== 2 || (g.z < 9 && g.x > -45 && g.x < 35)) return;
    const side = i % 8 === 2 ? 1 : -1;
    const cx = g.x + g.px * 4.2 * side;
    const cz = g.z + g.pz * 4.2 * side;
    beds.push({ kind: "box", x0: cx - 0.8, x1: cx + 0.8, z0: cz - 0.55, z1: cz + 0.55, y: 0.1, out: null, plant: "border" });
  });
  for (const pond of PARK_PONDS) {
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + 0.3;
      const cx = pond.x + Math.cos(a) * (pond.rx + 2.2);
      const cz = pond.z + Math.sin(a) * (pond.rz + 2.2);
      beds.push({ kind: "box", x0: cx - 0.9, x1: cx + 0.9, z0: cz - 0.6, z1: cz + 0.6, y: 0.1, out: null, plant: "border" });
    }
  }
  beds.push(...parkBorders().flowers);
  // a planting card standing in each bed (pink, yellow or purple row): the village's placement fills the whole bed round it
  const cards: Card[] = beds.map((b, id) => {
    if (b.kind !== "box") throw new Error("box beds only");
    const x = (b.x0 + b.x1) / 2;
    const z = (b.z0 + b.z1) / 2;
    return { id: 100000 + id, x, y: b.y + 0.15, z, ax: x - 0.2, az: z, bx: x + 0.2, bz: z, floor: b.y, h: 0.3, u: 0.5, v: [0.12, 0.37, 0.62][Math.floor(rnd() * 3)]!, light: 1, tris: [] };
  });
  return { beds, cards };
}

export function parkTreeSpecs(): { trees: TreeSpec[]; bushes: Bush[] } {
  const rnd = rngOf(7771);
  const trees: TreeSpec[] = [];
  let index = 5000;
  PARK_TREES.forEach((t, i) => {
    const cherry = t.kind === 2 && i % 2 === 0;
    trees.push({ index: index++, kind: cherry ? "cherry" : "green", x: t.x, z: t.z, H: cherry ? 5.6 + t.s * 0.8 : 7 + t.s * 2.6, R: cherry ? 2.7 : 3.1 + t.s * 0.9, seed: 7000 + i });
  });
  const ground = circuitGround();
  const pond = { x: 0, z: 20 };
  const t = coasterTrack();
  const li = Math.round(((t.marks.loopFrom ?? 0) + (t.marks.loopTo ?? 0)) / 2);
  pond.x = t.pos[3 * li]! + 6;
  // dense groups along the layout (the ride passes between tree walls) and out beyond it: clusters of 8-16 trees with an understorey of shrubs
  const perCluster = isTouchDevice ? 6 : 12;
  const near = isTouchDevice ? 8 : 13; // clusters along the circuit
  const centres: { x: number; z: number; r: number }[] = [];
  for (let i = 0; i < near; i++) {
    const g = ground[Math.floor(((i + 0.5) / near) * ground.length) % ground.length]!;
    const side = i % 2 === 0 ? 1 : -1;
    centres.push({ x: g.x + g.px * 17 * side, z: g.z + g.pz * 17 * side, r: 9 });
  }
  for (const [cx, cz] of (isTouchDevice ? [[-120, 110], [140, 130], [330, 110]] : [[-150, 100], [-60, 150], [60, 140], [170, 150], [260, 130], [350, 100], [-170, 40], [380, 30]]) as ReadonlyArray<readonly [number, number]>) centres.push({ x: cx, z: cz, r: 12 });
  const woodList: { x: number; z: number }[] = [];
  const understorey: Bush[] = [];
  for (const c of centres) {
    let placed = 0;
    let guard = 0;
    while (placed < perCluster && guard++ < 400) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * c.r;
      const x = c.x + Math.cos(a) * r;
      const z = c.z + Math.sin(a) * r * 0.9;
      if (z < 3.2 || taken(x, z, ground, pond)) continue;
      if (woodList.some((w) => Math.hypot(w.x - x, w.z - z) < 4.4)) continue;
      woodList.push({ x, z });
      placed++;
    }
    for (let k = 0; k < 7; k++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * (c.r + 3);
      const x = c.x + Math.cos(a) * r;
      const z = c.z + Math.sin(a) * r * 0.9;
      if (z < 3.2 || taken(x, z, ground, pond)) continue;
      const s = 0.8 + rnd() * 0.8;
      understorey.push({ x, y: 0, z, h: 0.9 * s, r: 0.75 * s, seed: rnd(), cards: [] });
    }
  }
  woodList.forEach((w, i) => trees.push({ index: index++, kind: "green", x: w.x, z: w.z, H: 7.5 + rnd() * 3.5, R: 3.2 + rnd() * 1.2, seed: 8000 + i }));
  const ring = 0;
  for (let i = 0; i < ring; i++) {
    const a = (i / ring) * Math.PI * 2 + rnd() * 0.1;
    const r = 330 + rnd() * 60;
    trees.push({ index: index++, kind: "green", x: 105 + Math.cos(a) * r * 1.15, z: -60 + Math.sin(a) * r * 0.75, H: 12 + rnd() * 4, R: 4.6 + rnd() * 1.2, seed: 9000 + i });
  }
  // bushes along the circuit's path (the village's boxwood and azalea)
  const bushes: Bush[] = [];
  ground.forEach((g, i) => {
    if (i % 3 !== 1 || (g.z < 9 && g.x > -45 && g.x < 35)) return;
    const s = 0.8 + rnd() * 0.7;
    bushes.push({ x: g.x + g.px * 5.4, y: 0, z: g.z + g.pz * 5.4, h: 0.9 * s, r: 0.7 * s, seed: rnd(), cards: [] });
  });
  // the hedge along the path's left edge and the park's south boundary: a continuous row of the village's clipped shrubs (replaces box hedges)
  const hedge: Bush[] = [];
  ground.forEach((g, gi) => {
    if (g.z < 9 && g.x > -45 && g.x < 35) return;
    if (isTouchDevice && gi % 2 === 1) return; // a phone gets every second shrub of the hedge (each a bit wider)
    const s = (isTouchDevice ? 1.25 : 0.9) + rnd() * 0.5;
    hedge.push({ x: g.x - g.px * 3.5, y: 0, z: g.z - g.pz * 3.5, h: 1.0 * s, r: 1.25 * s, seed: rnd(), cards: [] });
  });
  for (let x = PARK_BOUNDS.minX + 2; x < PARK_BOUNDS.maxX; x += isTouchDevice ? 6 : 3) {
    if (x > -30 && x < 30) continue;
    const s = 0.9 + rnd() * 0.5;
    hedge.push({ x, y: 0, z: -2.7, h: 1.15 * s, r: 1.45 * s, seed: rnd(), cards: [] });
  }
  return { trees, bushes: [...bushes, ...hedge, ...understorey, ...parkBorders().bushes] };
}

export function ParkVegetation() {
  const getThree = useThree((s) => s.get);
  const [veg, setVeg] = useState<VillageVegetation | null>(null);
  const specs = useMemo(parkTreeSpecs, []);
  const flowerBeds = useMemo(parkBeds, []);
  // A low flowering crown stays on the soil after the individual petunias thin out.
  const planterBlooms = useMemo(() => {
    const pots = flowerBeds.beds.filter((bed): bed is Extract<Bed, { kind: "box" }> => bed.kind === "box" && bed.plant === "pot");
    const blooms = flowerMassMesh(pots, 8, 18);
    blooms.mesh.name = "park_planting_blooms";
    blooms.mesh.frustumCulled = true;
    blooms.mesh.userData[CLICK_PICK_KEY] = "ignore";
    return blooms;
  }, [flowerBeds]);
  useEffect(() => () => planterBlooms.dispose(), [planterBlooms]);
  const lastSweep = useRef(-1);
  useEffect(() => {
    let dead = false;
    let built: VillageVegetation | null = null;
    createVegetation(new Group(), "low", "new", () => dead, {
      parkTrees: specs.trees,
      parkBushes: specs.bushes,
      farThin: isTouchDevice ? 0.12 : 0.4,
      farRange: isTouchDevice ? PHONE_FAR_RANGE : undefined,
      parkBeds: flowerBeds.beds,
      parkCards: flowerBeds.cards,
      makeWorker: () => new Worker(new URL("../village/veg/crownWorker.ts", import.meta.url), { type: "module" }),
      focus: () => {
        const p = getThree().camera.position;
        return [p.x, p.y, p.z];
      },
      onShow: (v) => {
        if (!dead) setVeg(v);
      },
    })
      .then((v) => {
        if (dead) {
          v?.dispose();
          return;
        }
        built = v;
        if (v) setVeg(v);
      })
      .catch((e: unknown) => console.error("[park veg] build failed", e));
    return () => {
      dead = true;
      setVeg(null);
      built?.dispose();
    };
  }, [specs, flowerBeds, getThree]);
  useFrame(({ clock, gl, camera }) => {
    // a carousel or wheel ride: the vegetation is judged from the ride's foot, not from the turning / rising eye
    if (veg) veg.setViewOverride(selfRide.slot >= 0 && selfRide.ride === 2 ? [110, 1.7, -119] : selfRide.slot >= 0 && selfRide.ride === 3 ? [205, 1.7, -128.2] : null);
    veg?.update(camera, clock.elapsedTime, gl.domElement.height);
    // the park's crowns draw no shadow of their own (the village's near ones do): every leaf layer twice in the shadow pass is the frame's largest cost
    if (veg && Math.floor(clock.elapsedTime * 2) !== lastSweep.current) {
      lastSweep.current = Math.floor(clock.elapsedTime * 2);
      veg.group.traverse((o) => {
        if (o.castShadow) o.castShadow = false;
      });
    }
  });
  return <>
    <primitive object={planterBlooms.mesh} dispose={null} />
    {veg && <primitive object={veg.group} dispose={null} />}
  </>;
}

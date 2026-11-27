/**
 * 케이슨랜드's gate seen from INSIDE the park is the village's gate (owner 2026-11-21: "들어가기전에 입구를 바라본 이미지와 들어간 후에 입구를
 * 바라본 이미지가 일치하도록"). The park used to draw a gate of its own behind the visitor - a wider arch between two round, blue-roofed
 * towers under a gold star - nothing like the gatehouse one had just walked through.
 *
 * Now it is the SAME model: the village's gatehouse (lot_gate.glb as the village dresses it: the open iron leaves, the guide maps on the
 * piers, the forecourt's fountain, lamps and bunting beyond the arch) stands in the park's north wall, at the place that corresponds to
 * its place in the village (the village's gate line z 94 is the park's z -186.5; the same mapping the village's picture beyond the arch
 * uses, ParkVillageView), so one sees its real back: the piers and the wings from behind, the turnstiles under their canopy, the flags.
 * Nothing is loaded or built twice: the village's own objects are lent to the park while it is mounted (the village's model is not drawn
 * then) and handed back when it goes.
 */
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Group, type Object3D, type WebGLRenderer } from "three";
import { PARK_GATE_FROM_VILLAGE } from "@caysonverse/shared/village/parkArea";
import type { VillageTier } from "../village/villageModelPrep";
import { dayNight } from "../village/dayNightDriver";
import { applyLotsDayNight, shiftLotLamps, type LotNodes } from "../village/lots/lotsPrep";
import { lotsNodesFor } from "../village/lots/VillageLots";

/** The gate's own objects among the lots' (lotsPrep's names): the shells (the gate kit's materials are its alone), detail, leaves, dressing, glow. */
export function isGateLotObject(name: string): boolean {
  return name.startsWith("lotshells_LM_martgate") || name === "lotdetail__lot_gate" || name.startsWith("door__lot_gate") || name === "gate_far_dress" || name.startsWith("lotnight__lot_gate");
}

export function ParkGateLot({ tier }: { tier: VillageTier }) {
  const gl = useThree((s) => s.gl);
  const group = useMemo(() => {
    const g = new Group();
    g.name = "park_gate_lot";
    g.position.set(PARK_GATE_FROM_VILLAGE.dx, 0, PARK_GATE_FROM_VILLAGE.dz);
    return g;
  }, []);
  const nodesRef = useRef<LotNodes | null>(null);
  useEffect(() => {
    let dead = false;
    let undo: (() => void) | null = null;
    void lotsNodesFor(tier, gl as WebGLRenderer).then((nodes) => {
      if (dead || !nodes) return;
      const lent: Array<{ o: Object3D; parent: Object3D; visible: boolean }> = [];
      const shown: Array<{ o: Object3D; visible: boolean }> = [];
      for (const o of [...nodes.root.children]) {
        if (!isGateLotObject(o.name)) continue;
        lent.push({ o, parent: nodes.root, visible: o.visible });
        group.add(o);
        // the whole gate, as from right in front of it: its detail, its goods and its far dressing (the night glow keeps the clock's say)
        if (!o.name.startsWith("lotnight__")) o.visible = true;
      }
      const goods = nodes.goods.get("lot_gate");
      if (goods) {
        shown.push({ o: goods, visible: goods.visible });
        goods.visible = true;
      }
      // the lots' night lamps are points in the village's frame: they move with the gate while it stands here
      const unshift = shiftLotLamps(PARK_GATE_FROM_VILLAGE.dx, PARK_GATE_FROM_VILLAGE.dz);
      group.updateMatrixWorld(true);
      nodesRef.current = nodes;
      undo = () => {
        unshift();
        for (const s of shown) s.o.visible = s.visible;
        for (const l of lent) {
          l.parent.add(l.o);
          l.o.visible = l.visible;
        }
        nodes.root.updateMatrixWorld(true);
        nodesRef.current = null;
      };
    });
    return () => {
      dead = true;
      undo?.();
    };
  }, [tier, gl, group]);
  useFrame(() => {
    const n = nodesRef.current;
    if (n) applyLotsDayNight(n, dayNight.applied);
  });
  return <primitive object={group} dispose={null} />;
}

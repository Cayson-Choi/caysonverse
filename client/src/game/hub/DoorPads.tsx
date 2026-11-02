import { useEffect, useLayoutEffect, useMemo } from "react";
import { MeshBasicMaterial, type CanvasTexture } from "three";
import { HUB_DOORS } from "@caysonverse/shared/school/hubMap";
import { canvas2d, canvasTexture, roundRect } from "../spriteCanvas";
import { FONT_FAMILY } from "../nametag";
import { useClassStore } from "../../stores/classStore";
import { useHubNodes } from "./HubModel";

/**
 * The corridor's room doors and the waiting pads in front of them (AI 학교 탈출, Task 15, driven from the model in
 * Task 23). hub.glb holds, per door (HUB_DOORS): the double door `door__<room>` and the pad mat `pad__<room>`; the
 * room's name over the door is a runtime label (HubSigns).
 *  - The pad where MY team has gathered (`padDoor`, at least one member on it) is tinted with my team's colour
 *    (the pad's own material, so the other pads keep their look).
 *  - A door whose room is not open (`openRooms`) is greyed (the door's own material) and carries a "준비 중" sticker.
 *
 * Reads only discrete class state (classStore, re-rendered on change), nothing per frame. The sticker is a canvas
 * texture made once per mount and released with it.
 */

const PAD_IDLE = "#FFFFFF";
const DOOR_OPEN = "#FFFFFF";
const DOOR_CLOSED = "#9C9CA8";
/** The sticker on a closed door: a hair in front of the leaf face, below the portholes. */
const STICKER_Y = 1.05;
const STICKER_H = 0.34;
const STICKER_OUT = 0.012;

/** Draw a short label on a rounded plate. Returns the texture and its aspect (w / h). */
function plateTexture(text: string, bg: string, fg: string): { texture: CanvasTexture; aspect: number } {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 144;
  const ctx = canvas2d(canvas);
  ctx.fillStyle = bg;
  roundRect(ctx, 6, 6, canvas.width - 12, canvas.height - 12, 36);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.font = `700 72px ${FONT_FAMILY}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 4);
  return { texture: canvasTexture(canvas), aspect: canvas.width / canvas.height };
}

export function DoorPads() {
  const { pads, doors } = useHubNodes();
  const openRooms = useClassStore((s) => s.openRooms);
  const myTeam = useClassStore((s) => s.teams.find((t) => t.mine) ?? null);

  // The "준비 중" sticker: made once per mount, released with it.
  const soon = useMemo(() => {
    const s = plateTexture("준비 중", "#FFF7E0", "#7A5A12");
    return { material: new MeshBasicMaterial({ map: s.texture, transparent: true, fog: false }), aspect: s.aspect };
  }, []);
  useEffect(
    () => () => {
      soon.material.map?.dispose();
      soon.material.dispose();
    },
    [soon],
  );

  // The pad where my team has gathered takes its colour; closed doors go grey. Before the first frame (layout effect).
  const gatheredAt = myTeam && myTeam.padCount > 0 ? myTeam.padDoor : "";
  const teamColor = myTeam?.color ?? null;
  useLayoutEffect(() => {
    for (const d of HUB_DOORS) {
      pads[d.room]?.material.color.set(gatheredAt === d.room && teamColor ? teamColor : PAD_IDLE);
      doors[d.room]?.material.color.set(openRooms.includes(d.room) ? DOOR_OPEN : DOOR_CLOSED);
    }
  }, [pads, doors, openRooms, gatheredAt, teamColor]);

  return (
    <group>
      {HUB_DOORS.map((d) => {
        const node = doors[d.room];
        if (!node || openRooms.includes(d.room)) return null;
        return (
          <mesh
            key={d.room}
            position={[d.x, STICKER_Y, node.frontZ + node.facing * STICKER_OUT]}
            rotation={[0, node.facing === 1 ? 0 : Math.PI, 0]}
            material={soon.material}
            renderOrder={2}
          >
            <planeGeometry args={[STICKER_H * soon.aspect, STICKER_H]} />
          </mesh>
        );
      })}
    </group>
  );
}

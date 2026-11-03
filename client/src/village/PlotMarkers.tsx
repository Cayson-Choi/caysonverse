import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { BoxGeometry, CanvasTexture, DoubleSide, MeshBasicMaterial, MeshStandardMaterial, SRGBColorSpace } from "three";
import { canvas2d } from "../game/spriteCanvas";
import { FONT_FAMILY } from "../game/nametag";
import { fitFontPx, labelCanvasSize } from "../game/hub/hubSignSpecs";
import { plotMarkerSpecs, type PlotMarkerSpec } from "./plotSigns";

/**
 * The empty building plots of 케이슨 마을 (Task 4): a soft glowing outline round each plot where a building
 * is planned (violet; amber where one is going up) and a sign post at the edge toward the plaza with the words
 * "곧 지어져요 · 도서관" (or "공사 중 · 도서관"). The memorial hall's plot gets neither. Markers are NOT colliders:
 * players may walk onto an empty plot. Where each plot, post and facing is comes from the layout (plotSigns.ts).
 *
 * The words are drawn on a canvas once per mount with the same system Korean font stack the name tags and the
 * hall's signs use (nametag.ts `FONT_FAMILY`), and released with the scene. The glow breathes: one opacity write
 * per frame per colour, nothing allocated.
 */

const GLOW_VIOLET = "#8B5CF6";
const GLOW_AMBER = "#F59E0B";
const STRIP_W = 0.6;
const STRIP_INSET = 0.3;
const STRIP_Y = 0.07;
const FILL_Y = 0.04;

const BOARD = { w: 3.0, h: 1.1, depth: 0.1, centreY: 2.3, forward: 0.1 } as const;
const POST = { w: 0.18, h: 2.8 } as const;
const BOARD_COLOUR = { normal: "#F6F1E7", building: "#F4B63F" } as const;
const TEXT_COLOUR = { normal: "#3B3FB8", building: "#3A2600" } as const;

const UNIT_BOX = new BoxGeometry(1, 1, 1);

function signTexture(spec: PlotMarkerSpec): CanvasTexture {
  const { width, height } = labelCanvasSize({ w: BOARD.w, h: BOARD.h });
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas2d(canvas);
  const weight = 800;
  const measure = (text: string, px: number): number => {
    ctx.font = `${weight} ${px}px ${FONT_FAMILY}`;
    return ctx.measureText(text).width;
  };
  const px = fitFontPx(spec.lines, width, height, measure);
  ctx.font = `${weight} ${px}px ${FONT_FAMILY}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = spec.underConstruction ? TEXT_COLOUR.building : TEXT_COLOUR.normal;
  const lineH = px * 1.12;
  const top = height / 2 - ((spec.lines.length - 1) * lineH) / 2;
  spec.lines.forEach((line, i) => ctx.fillText(line, width / 2, top + i * lineH + px * 0.04));
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** The four strips of a plot's outline as boxes: [centre x, centre z, size x, size z]. */
function stripRects(spec: PlotMarkerSpec): Array<[number, number, number, number]> {
  const { minX, maxX, minZ, maxZ } = spec.rect;
  const x0 = minX + STRIP_INSET;
  const x1 = maxX - STRIP_INSET;
  const z0 = minZ + STRIP_INSET;
  const z1 = maxZ - STRIP_INSET;
  return [
    [(x0 + x1) / 2, z0, x1 - x0, STRIP_W], // north
    [(x0 + x1) / 2, z1, x1 - x0, STRIP_W], // south
    [x0, (z0 + z1) / 2, STRIP_W, z1 - z0 - STRIP_W], // west
    [x1, (z0 + z1) / 2, STRIP_W, z1 - z0 - STRIP_W], // east
  ];
}

export function PlotMarkers() {
  const specs = useMemo(() => plotMarkerSpecs(), []);
  const assets = useMemo(() => {
    const glow = (color: string, opacity: number) =>
      new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, toneMapped: false, fog: false });
    const textures = new Map<string, CanvasTexture>(specs.map((s) => [s.id, signTexture(s)]));
    return {
      violet: glow(GLOW_VIOLET, 0.8),
      amber: glow(GLOW_AMBER, 0.8),
      violetFill: glow(GLOW_VIOLET, 0.14),
      amberFill: glow(GLOW_AMBER, 0.18),
      post: new MeshStandardMaterial({ color: "#8A6A48", roughness: 0.9 }),
      board: new MeshStandardMaterial({ color: BOARD_COLOUR.normal, roughness: 0.85 }),
      boardBuilding: new MeshStandardMaterial({ color: BOARD_COLOUR.building, roughness: 0.85 }),
      textures,
      words: new Map<string, MeshBasicMaterial>(
        specs.map((s) => [
          s.id,
          new MeshBasicMaterial({ map: textures.get(s.id), transparent: true, side: DoubleSide, toneMapped: false, fog: false }),
        ]),
      ),
    };
  }, [specs]);
  useEffect(
    () => () => {
      for (const t of assets.textures.values()) t.dispose();
      for (const m of assets.words.values()) m.dispose();
      for (const m of [assets.violet, assets.amber, assets.violetFill, assets.amberFill, assets.post, assets.board, assets.boardBuilding]) m.dispose();
    },
    [assets],
  );

  // The outline breathes (opacity only; the same two materials serve every plot).
  useFrame(({ clock }) => {
    const pulse = 0.5 + 0.5 * Math.sin(clock.elapsedTime * 2.2);
    assets.violet.opacity = 0.7 + 0.3 * pulse;
    assets.amber.opacity = 0.7 + 0.3 * pulse;
  });

  return (
    <group>
      {specs.map((spec) => {
        const building = spec.underConstruction;
        const { minX, maxX, minZ, maxZ } = spec.rect;
        return (
          <group key={spec.id} name={`plot_marker__${spec.id}`}>
            <mesh
              position={[(minX + maxX) / 2, FILL_Y, (minZ + maxZ) / 2]}
              rotation-x={-Math.PI / 2}
              material={building ? assets.amberFill : assets.violetFill}
              renderOrder={1}
            >
              <planeGeometry args={[maxX - minX - 2 * STRIP_INSET, maxZ - minZ - 2 * STRIP_INSET]} />
            </mesh>
            {stripRects(spec).map(([cx, cz, sx, sz], i) => (
              <mesh
                key={i}
                geometry={UNIT_BOX}
                material={building ? assets.amber : assets.violet}
                position={[cx, STRIP_Y, cz]}
                scale={[sx, 0.04, sz]}
                renderOrder={2}
              />
            ))}
            {/* The sign: a post and a board, the words on both faces (the board faces the plaza). */}
            <group position={[spec.post.x, 0, spec.post.z]} rotation={[0, spec.yaw, 0]}>
              <mesh geometry={UNIT_BOX} material={assets.post} position={[0, POST.h / 2, 0]} scale={[POST.w, POST.h, POST.w]} castShadow />
              <mesh
                geometry={UNIT_BOX}
                material={building ? assets.boardBuilding : assets.board}
                position={[0, BOARD.centreY, BOARD.forward]}
                scale={[BOARD.w, BOARD.h, BOARD.depth]}
                castShadow
              />
              <mesh position={[0, BOARD.centreY, BOARD.forward + BOARD.depth / 2 + 0.004]} material={assets.words.get(spec.id)}>
                <planeGeometry args={[BOARD.w, BOARD.h]} />
              </mesh>
              <mesh
                position={[0, BOARD.centreY, BOARD.forward - BOARD.depth / 2 - 0.004]}
                rotation-y={Math.PI}
                material={assets.words.get(spec.id)}
              >
                <planeGeometry args={[BOARD.w, BOARD.h]} />
              </mesh>
            </group>
          </group>
        );
      })}
    </group>
  );
}

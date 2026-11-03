import { useEffect, useMemo } from "react";
import { CanvasTexture, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from "three";
import { canvas2d } from "../game/spriteCanvas";
import { FONT_FAMILY } from "../game/nametag";
import { fitFontPx, labelCanvasSize } from "../game/hub/hubSignSpecs";
import { plotMarkerSpecs, type PlotMarkerSpec } from "./plotSigns";

/**
 * The words on the empty building plots' signs (케이슨 마을, Task 4; Task 7: on the model's boards). The village
 * model already has each plot's glowing outline and a blank wooden sign board at the layout's sign post, facing the
 * plaza (Task 6, art/village/tools/parts_buildings.py `sign_post`): this draws only the words, "곧 지어져요 · 도서관"
 * (the library: "공사 중 · 도서관"), on the board's painted face and on its plain back. Markers are NOT colliders.
 *
 * The words are drawn on a canvas once per mount with the same system Korean font stack the name tags and the
 * hall's signs use (nametag.ts `FONT_FAMILY`), and released with the scene.
 */

/**
 * The model's board, in the sign's own frame (x across, +z toward the plaza, y up; the frame is the sign post's
 * position turned by the plot's facing): the painted face is 1.08 x 0.6 m at y 0.8..1.4, 8.5 cm in front of the
 * post line; the board's back is 2 cm in front of it.
 */
export const SIGN_FACE = { w: 1.08, h: 0.6, centreY: 1.1, front: 0.085, back: 0.02, lift: 0.004 } as const;
const TEXT_COLOUR = { normal: "#2F3290", building: "#7A3300" } as const;

function signTexture(spec: PlotMarkerSpec): CanvasTexture {
  const { width, height } = labelCanvasSize({ w: SIGN_FACE.w, h: SIGN_FACE.h });
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

export function PlotMarkers() {
  const specs = useMemo(() => plotMarkerSpecs(), []);
  const assets = useMemo(() => {
    const textures = new Map<string, CanvasTexture>(specs.map((s) => [s.id, signTexture(s)]));
    const words = new Map<string, MeshBasicMaterial>(
      specs.map((s) => [
        s.id,
        new MeshBasicMaterial({
          map: textures.get(s.id),
          transparent: true,
          depthWrite: false,
          toneMapped: false,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -4,
        }),
      ]),
    );
    return { textures, words, plane: new PlaneGeometry(SIGN_FACE.w, SIGN_FACE.h) };
  }, [specs]);
  useEffect(
    () => () => {
      for (const t of assets.textures.values()) t.dispose();
      for (const m of assets.words.values()) m.dispose();
      assets.plane.dispose();
    },
    [assets],
  );

  return (
    <group>
      {specs.map((spec) => (
        <group key={spec.id} name={`plot_sign__${spec.id}`} position={[spec.post.x, 0, spec.post.z]} rotation={[0, spec.yaw, 0]}>
          <mesh
            geometry={assets.plane}
            material={assets.words.get(spec.id)}
            position={[0, SIGN_FACE.centreY, SIGN_FACE.front + SIGN_FACE.lift]}
            renderOrder={2}
          />
          <mesh
            geometry={assets.plane}
            material={assets.words.get(spec.id)}
            position={[0, SIGN_FACE.centreY, SIGN_FACE.back - SIGN_FACE.lift]}
            rotation-y={Math.PI}
            renderOrder={2}
          />
        </group>
      ))}
    </group>
  );
}

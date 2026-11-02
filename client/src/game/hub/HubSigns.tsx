import { useEffect, useMemo } from "react";
import { CanvasTexture, MeshBasicMaterial, SRGBColorSpace } from "three";
import { canvas2d } from "../spriteCanvas";
import { FONT_FAMILY } from "../nametag";
import { HUB_SIGNS, fitFontPx, labelCanvasSize, type SignSpec } from "./hubSignSpecs";

/**
 * The hall's text plates (AI 학교 탈출, Task 23): the board's title, the four door signs, the team sign (both
 * faces) and the west seal's "다음 업데이트" — transparent labels hung in front of the model's blank plates
 * (placement: hubSignSpecs.ts). Each is a canvas drawn once per mount with the system Korean font and released with
 * the scene. Unlike the nametag sprites, a label is a world-space plane seen at angles, so its texture keeps its
 * mipmaps and a little anisotropy to stay crisp (and calm) from far away.
 */

const ANISOTROPY = 4;

/** One label's canvas texture: its words, centred, as large as fits (with a soft dark edge on the violet plates). */
function signTexture(spec: SignSpec): CanvasTexture {
  const { width, height } = labelCanvasSize(spec);
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
  ctx.lineJoin = "round";
  const lineH = px * 1.12;
  const top = height / 2 - ((spec.lines.length - 1) * lineH) / 2;
  spec.lines.forEach((line, i) => {
    const y = top + i * lineH + px * 0.04;
    if (spec.outline) {
      ctx.lineWidth = Math.max(2, px * 0.1);
      ctx.strokeStyle = spec.outline;
      ctx.strokeText(line, width / 2, y);
    }
    ctx.fillStyle = spec.color;
    ctx.fillText(line, width / 2, y);
  });
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = ANISOTROPY;
  return texture;
}

export function HubSigns() {
  const signs = useMemo(
    () =>
      HUB_SIGNS.map((spec) => ({
        spec,
        material: new MeshBasicMaterial({
          map: signTexture(spec),
          transparent: true,
          depthWrite: false,
          // The words sit on a baked plate: draw them at the plate's own brightness, in front of it.
          toneMapped: false,
          fog: false,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        }),
      })),
    [],
  );
  useEffect(
    () => () => {
      for (const s of signs) {
        s.material.map?.dispose();
        s.material.dispose();
      }
    },
    [signs],
  );
  return (
    <group>
      {signs.map(({ spec, material }) => (
        <mesh key={spec.id} position={[spec.x, spec.y, spec.z]} rotation={[0, spec.rotY, 0]} material={material} renderOrder={1}>
          <planeGeometry args={[spec.w, spec.h]} />
        </mesh>
      ))}
    </group>
  );
}

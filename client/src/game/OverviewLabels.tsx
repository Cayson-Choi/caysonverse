import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { MathUtils, type Group, type PerspectiveCamera, type Sprite, type SpriteMaterial } from "three";
import { WALL_HEIGHT, ZONES } from "@caysonverse/shared/worldMap";
import { ZONE_LABELS, type ZoneKey } from "./hud";
import { FONT_FAMILY } from "./nametag";
import { viewState } from "./viewState";
import { OV_VIS_BLEND } from "./viewMode";
import { overviewLabelProbe } from "./labelRegistry";
import { billboardSprite, canvas2d, canvasTexture, roundRect } from "./spriteCanvas";

/** Height (m) the labels float at: above the wall tops, so nothing in the map hides them. */
const LABEL_Y = WALL_HEIGHT + 0.5;
/** On-screen height (CSS px) every label keeps whatever the zoom: readable, not shouting. */
const LABEL_SCREEN_PX = 30;
/** Raster size: the text is drawn at this font size (px) on a canvas this tall. */
const FONT_PX = 56;
const PAD_X = 28;
const PAD_Y = 14;
/** The labels draw over the whole scene (the nametags are 1000+; the self marker is a mesh). */
const RENDER_ORDER = 1002;

const ZONE_KEYS = Object.keys(ZONES) as ZoneKey[];

interface LabelHandle {
  sprite: Sprite;
  /** Canvas width / height, so a resize keeps the text's proportions. */
  aspect: number;
  dispose(): void;
}

/** One room-name sprite: white text on a dark rounded pill (the nametag pipeline of spriteCanvas.ts). */
function createLabel(text: string): LabelHandle {
  const font = `700 ${FONT_PX}px ${FONT_FAMILY}`;
  const measure = document.createElement("canvas").getContext("2d");
  if (measure) measure.font = font;
  const textW = measure ? Math.ceil(measure.measureText(text).width) : FONT_PX * text.length;
  const w = textW + 2 * PAD_X;
  const h = FONT_PX + 2 * PAD_Y;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas2d(canvas);
  roundRect(ctx, 2, 2, w - 4, h - 4, (h - 4) / 2);
  ctx.fillStyle = "rgba(20, 16, 44, 0.82)";
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(190, 172, 255, 0.85)";
  ctx.stroke();
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, w / 2, h / 2 + 2);

  const texture = canvasTexture(canvas);
  const sprite = billboardSprite(texture, w / h, 1, RENDER_ORDER);
  sprite.raycast = () => {}; // a label is never what a click lands on
  return {
    sprite,
    aspect: w / h,
    dispose() {
      texture.dispose();
      (sprite.material as SpriteMaterial).dispose();
    },
  };
}

/**
 * Room names on the map (controls-ux Task 16): while the overview is up, each room carries
 * its name — 미로방, 로비, 강의실, AI 갤러리 — at its centre, so "where is the lecture hall?"
 * reads at a glance next to the red self marker (OverviewMarker).
 *
 * Shown only once the overview blend is past OV_VIS_BLEND (the camera is high enough that
 * the map is readable, the same gate the self marker uses), so they never flash over the
 * normal third-person view. Each label is a billboard sprite (spriteCanvas.ts) whose world
 * size is re-derived every frame from the camera's height, so on screen it stays about
 * LABEL_SCREEN_PX tall from the whole-map view down to the closest zoom.
 *
 * Built in an effect (not render) and disposed in its cleanup, so StrictMode's double mount
 * and a reconnect remount never leak a texture. Per-frame work is a handful of scalar writes.
 */
export function OverviewLabels() {
  const groupRef = useRef<Group>(null);
  const handles = useRef<LabelHandle[]>([]);

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    const made = ZONE_KEYS.map((key) => {
      const z = ZONES[key];
      const label = createLabel(ZONE_LABELS[key]);
      label.sprite.position.set((z.minX + z.maxX) / 2, LABEL_Y, (z.minZ + z.maxZ) / 2);
      group.add(label.sprite);
      return label;
    });
    handles.current = made;
    overviewLabelProbe.count = made.length;
    return () => {
      for (const label of made) {
        group.remove(label.sprite);
        label.dispose();
      }
      handles.current = [];
      overviewLabelProbe.count = 0;
      overviewLabelProbe.visible = false;
    };
  }, []);

  useFrame(({ camera, size }) => {
    const group = groupRef.current;
    if (!group) return;
    const blend = viewState.ovBlend;
    const show = blend > OV_VIS_BLEND;
    group.visible = show;
    overviewLabelProbe.visible = show;
    if (!show) return;
    // Fade in over the second half of the ascent (and out over the first half of the descent).
    const opacity = MathUtils.clamp((blend - OV_VIS_BLEND) / (1 - OV_VIS_BLEND), 0, 1);
    overviewLabelProbe.opacity = opacity;
    // World height that projects to LABEL_SCREEN_PX at the camera's distance above the label.
    const cam = camera as PerspectiveCamera;
    const dist = Math.max(1, cam.position.y - LABEL_Y);
    const worldH =
      (LABEL_SCREEN_PX / Math.max(1, size.height)) * 2 * dist * Math.tan(MathUtils.degToRad(cam.fov) / 2);
    for (const label of handles.current) {
      label.sprite.scale.set(worldH * label.aspect, worldH, 1);
      (label.sprite.material as SpriteMaterial).opacity = opacity;
    }
  });

  return <group ref={groupRef} visible={false} />;
}

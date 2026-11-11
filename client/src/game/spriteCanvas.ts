/**
 * Shared canvas -> sprite plumbing for above-avatar UI (nametags, speech bubbles, emoji reactions, the overview's room
 * names). One pipeline: rasterize onto a 2D canvas, wrap it in a CanvasTexture, and mount it as a depth-independent
 * billboard sprite. Every label builds on these primitives so there is a single canvas/texture/sprite path, never two.
 *
 * Crisp text (fix/crisp-labels — the owner: "글씨가 왜 이렇게 흐리게 나오는거야?"). Measured at night in the village, the name
 * tags came out soft for four reasons, each fixed here or by the code that sizes the labels:
 *  1. The rich tier drew them in its SCENE pass (postChain.ts): when the frame governor lowered the render scale (dpr
 *     1.5 -> 1.25 -> 1) they were drawn at that lower resolution and stretched over the screen, then FXAA blended their
 *     glyph edges and the final pass tone-mapped their colours (a grey capsule, grey text). Labels now live on their own
 *     layer (LABEL_LAYER): the post chain leaves them out of the scene pass and draws them AFTER its final pass, straight
 *     to the screen at the canvas's full resolution — no stretch, no FXAA, no tone curve, no fog (`toneMapped: false`,
 *     `fog: false`). The light tier draws them in its one pass, as before (its canvas is not stretched by the game).
 *  2. A tag's text was rasterized at 48 px and shown at 12-16 CSS px: a 2-4x minification through trilinear mipmaps,
 *     which blends two blurred mip levels. The tags and bubbles are now rasterized at the size they are SHOWN at, in
 *     device pixels (font px = on-screen CSS px x dpr, re-rasterized only when that whole-pixel bucket changes:
 *     `fontBucket`), and sampled with a plain LinearFilter.
 *  3. Even at the right size a sprite lands on a fractional pixel position, and bilinear filtering then spreads every
 *     glyph edge over two pixels. The label vertex shader (`LABEL_VERTEX`) draws a sprite whose projected size is within
 *     `snap` of its texture's size at EXACTLY the texture's size, its corner on a whole pixel: every texel lands on one
 *     screen pixel, as the browser's own text does. Farther from it (a size the texture was not made for yet) it draws
 *     the projected size, as three's own sprite shader does.
 *  4. The colours were tone-mapped and fogged (1.) — the tags were dimmer than designed at night.
 * Sprites that are not text keep a smooth, unsnapped size (the emoji: a mipmapped glyph sampled with a small negative LOD
 * bias so it stays sharp without shimmering).
 */

import {
  CanvasTexture,
  LinearFilter,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector2,
  Vector4,
  type WebGLRenderer,
} from "three";

/**
 * The layer every label sprite is on (and only on). The scene's camera sees it (NametagSystem enables it), so the light
 * tier draws labels in its one pass; the rich tier's post chain hides it from its scene pass and draws it on its own,
 * after the final pass, at full resolution (postChain.ts `renderLabels`).
 */
export const LABEL_LAYER = 30;

/**
 * How far (as a share) a text label's projected size may be from its texture's for it to be drawn at exactly the texture's
 * size, pixel-aligned. Its texture is made for the size it is shown at (within half a font pixel, `fontBucket`), so in
 * practice it always is; 0.2 still covers the smallest fonts' rounding (an 8 px font: its 2 px paddings are ±0.5 px).
 */
export const LABEL_SNAP = 0.3;

/** Trace a rounded-rectangle path; the caller fills and/or strokes it. */
export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Obtain a 2D context or throw a clear error (canvas is unavailable). */
export function canvas2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");
  return ctx;
}

/** A CanvasTexture for a UI canvas shown at about one texel per screen pixel: no mipmaps, linear, sRGB. */
export function canvasTexture(canvas: HTMLCanvasElement): CanvasTexture {
  const texture = new CanvasTexture(canvas);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/**
 * The whole-pixel font size to rasterize a text label at, for text that shows `desiredPx` device pixels tall now and was
 * last rasterized at `currentPx`: the nearest whole pixel, kept inside [min, max] — but the current size stays until the
 * wanted one is at least `hysteresis` px away from it, so a size hovering on a half pixel (a camera bobbing with the walk)
 * does not re-rasterize every frame. A non-finite or non-positive `desiredPx` keeps the current size.
 */
export function fontBucket(desiredPx: number, currentPx: number, min: number, max: number, hysteresis = 0.75): number {
  if (!(desiredPx > 0) || !Number.isFinite(desiredPx)) return currentPx;
  const d = Math.min(max, Math.max(min, desiredPx));
  if (Math.abs(d - currentPx) < hysteresis) return currentPx;
  return Math.min(max, Math.max(min, Math.round(d)));
}

/** New label canvases one frame may rasterize for size changes (a canvas draw + upload: ~0.2-1 ms each on a slow CPU). */
export const RASTERS_PER_FRAME = 2;
let budgetFrame = Number.NaN;
let budgetLeft = 0;

/** The current frame's key: the rAF timestamp (`document.timeline.currentTime` is the same for all of a frame's callbacks). */
function frameKey(): number {
  const t = typeof document === "undefined" ? undefined : document.timeline?.currentTime;
  return typeof t === "number" ? t : performance.now();
}

/**
 * Take one of this frame's re-rasterizations (true), or none is left (false: keep the current texture and ask again next
 * frame). `frame` identifies the frame (default: its rAF timestamp); a new value starts a fresh budget.
 */
export function takeRasterBudget(frame: number = frameKey(), perFrame: number = RASTERS_PER_FRAME): boolean {
  if (frame !== budgetFrame) {
    budgetFrame = frame;
    budgetLeft = perFrame;
  }
  if (budgetLeft <= 0) return false;
  budgetLeft -= 1;
  return true;
}

// ── the label sprite's shader ────────────────────────────────────────────────

/**
 * three's sprite vertex shader with the pixel snap (see the header, 3.): `uRes` is the viewport being drawn into (px),
 * `uTexPx` the map's size (texels), `uSnap` the share within which the texture's own size is drawn (0: never). Labels do
 * not rotate, so `rotation` is not applied.
 */
export const LABEL_VERTEX = /* glsl */ `
uniform float rotation;
uniform vec2 center;
uniform vec2 uRes;
uniform vec2 uTexPx;
uniform float uSnap;

#include <common>
#include <uv_pars_vertex>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>

void main() {

	#include <uv_vertex>

	vec4 mvPosition = modelViewMatrix[ 3 ];

	vec2 scale = vec2( length( modelMatrix[ 0 ].xyz ), length( modelMatrix[ 1 ].xyz ) );

	#ifndef USE_SIZEATTENUATION

		bool isPerspective = isPerspectiveMatrix( projectionMatrix );

		if ( isPerspective ) scale *= - mvPosition.z;

	#endif

	// The sprite faces the camera, so its four corners share the anchor's w: work in pixels around the anchor.
	vec4 anchorClip = projectionMatrix * mvPosition;
	vec2 res = max( uRes, vec2( 1.0 ) );
	vec2 anchorPx = ( anchorClip.xy / anchorClip.w * 0.5 + 0.5 ) * res;
	vec2 sizePx = scale * vec2( projectionMatrix[ 0 ][ 0 ], projectionMatrix[ 1 ][ 1 ] ) / anchorClip.w * 0.5 * res;
	vec2 texPx = max( uTexPx, vec2( 1.0 ) );
	vec2 off = abs( sizePx / texPx - 1.0 );
	vec2 originPx;
	vec2 drawPx;
	if ( uSnap > 0.0 && off.x <= uSnap && off.y <= uSnap ) {
		// One texel per pixel, the corner on a whole pixel: every texel centre falls on a pixel centre.
		drawPx = texPx;
		originPx = floor( anchorPx - center * drawPx + 0.5 );
	} else {
		drawPx = sizePx;
		originPx = anchorPx - center * drawPx;
	}
	vec2 cornerPx = originPx + ( position.xy + 0.5 ) * drawPx;
	gl_Position = vec4( ( cornerPx / res * 2.0 - 1.0 ) * anchorClip.w, anchorClip.z, anchorClip.w );
	mvPosition.xy += ( position.xy - ( center - vec2( 0.5 ) ) ) * scale;

	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>

}
`;

/** The map sample with a LOD bias (`uLodBias`, in mip levels; 0 for the unmipmapped text labels). */
const LABEL_MAP_FRAGMENT = /* glsl */ `
#ifdef USE_MAP
	diffuseColor *= texture2D( map, vMapUv, uLodBias );
#endif
`;

/** The viewport size every label draw reads (set just before each draw: the pass it is in decides it). */
const resolution = { value: new Vector2(1, 1) };
const viewport = new Vector4();

export interface LabelSpriteOptions {
  /** Pixel snap tolerance (LABEL_SNAP for text; 0, the default: always the projected size, never snapped). */
  snap?: number;
  /** LOD bias of the map sample, in mip levels (negative: sharper; only matters for a mipmapped map). Default 0. */
  lodBias?: number;
}

/**
 * A billboard sprite showing `texture`, `heightM` metres tall with width from the canvas `aspect`, on LABEL_LAYER. Always
 * readable: no depth test/write, high render order, its canvas colours as they are (no tone mapping, no fog). Each sprite
 * gets its OWN material (disposed by the caller) so per-sprite state never bleeds between avatars.
 */
export function billboardSprite(
  texture: CanvasTexture,
  aspect: number,
  heightM: number,
  renderOrder: number,
  options: LabelSpriteOptions = {},
): Sprite {
  const material = new SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    fog: false,
  });
  const texPx = { value: new Vector2(1, 1) };
  const snap = { value: options.snap ?? 0 };
  const lodBias = { value: options.lodBias ?? 0 };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRes = resolution;
    shader.uniforms.uTexPx = texPx;
    shader.uniforms.uSnap = snap;
    shader.uniforms.uLodBias = lodBias;
    shader.vertexShader = LABEL_VERTEX;
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", "uniform float uLodBias;\nvoid main() {")
      .replace("#include <map_fragment>", LABEL_MAP_FRAGMENT);
  };
  material.customProgramCacheKey = () => "cv-label-sprite";
  const sprite = new Sprite(material);
  sprite.scale.set(heightM * aspect, heightM, 1);
  sprite.renderOrder = renderOrder;
  sprite.layers.set(LABEL_LAYER);
  sprite.onBeforeRender = (renderer: WebGLRenderer) => {
    renderer.getCurrentViewport(viewport);
    resolution.value.set(viewport.z, viewport.w);
    const image = material.map?.image as { width?: number; height?: number } | undefined;
    texPx.value.set(image?.width ?? 1, image?.height ?? 1);
  };
  return sprite;
}

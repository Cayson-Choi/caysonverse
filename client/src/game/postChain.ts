import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  CineonToneMapping,
  Color,
  ColorManagement,
  CustomToneMapping,
  GLSL3,
  HalfFloatType,
  LinearToneMapping,
  NeutralToneMapping,
  RGBAFormat,
  RawShaderMaterial,
  ReinhardToneMapping,
  SRGBTransfer,
  Scene,
  type Sprite,
  type SpriteMaterial,
  Vector2,
  WebGLRenderTarget,
  type Camera,
  type ColorSpace,
  type Object3D,
  ShaderMaterial,
  type Texture,
  type ToneMapping,
  type WebGLRenderer,
} from "three";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";
import { UnrealBloomPass } from "three-stdlib";
import { compileSafely } from "./compileSafely";
import { setRenderScale } from "./renderScale";
import { LABEL_LAYER, billboardSprite, canvasTexture } from "./spriteCanvas";

/**
 * The rich tier's post chain (Task 21's bloom, made cheap enough for a laptop's integrated GPU — perf/interaction-latency).
 *
 * The old chain (drei `<Effects multisamping={4}>` + UnrealBloomPass + OutputPass) drew the scene into a full-size 4x MSAA
 * half-float target, resolved it, ran the bloom, ADDED the bloom back into that MSAA target (a second full-screen MSAA write
 * and a second resolve), then tone-mapped to a canvas that was itself 4x MSAA. On a Radeon 680M at 2560x1290 that was
 * 20-25 ms of GPU time a frame: the game sat at 30-46 fps and, with Chrome's ~4-frame pipeline, every click or key press
 * reached the screen 100-700 ms later (the Vercel toolbar's "Interaction Timing" toasts).
 *
 * This chain draws the same picture with three full-screen passes fewer:
 *  1. the scene into ONE half-float target, no MSAA (`target`);
 *  2. the bloom (three-stdlib's UnrealBloomPass, the same threshold, blur and mips) up to its composite, and no further;
 *  3. ONE final pass to the screen: scene + bloom (exactly what the pass's additive copy added: rgb x alpha, unclamped as
 *     on a float target), the renderer's tone curve and exposure, sRGB — what OutputPass did — and FXAA on top of that
 *     for the edges the MSAA used to smooth (the edge search reads the tone-mapped scene; the blend is taken in linear
 *     light, as an MSAA resolve did).
 * The frame governor (renderBudget.ts) lowers the RENDER SCALE (`setScale`): the scene is drawn into the bottom-left part of
 * the same target (its viewport), the bloom's bright pass reads that part, and the final pass stretches it over the canvas.
 * Nothing is re-made for a step — no canvas resize, no new target, no shader — so a step costs nothing on its frame. (Resizing
 * the canvas for a step, the first version, made that frame 100-317 ms on the Radeon 680M and showed the freshly cleared,
 * empty canvas for that long: the page's dark background flashed over the whole game.) The canvas and the targets are
 * re-made only when the drawing buffer itself changes size (`setSize`: the window was resized).
 *
 * The labels (name tags, speech bubbles, emoji: LABEL_LAYER, spriteCanvas.ts) are not part of that picture
 * (fix/crisp-labels): the scene pass leaves their layer out, and `renderLabels` draws them last, straight to the screen at
 * the drawing buffer's full resolution — never stretched by a render scale, smeared by FXAA, tone-mapped or bloomed.
 */

/** The final pass's defines for the renderer's tone curve and output colour space (OutputPass's own rule). */
export function outputDefines(toneMapping: ToneMapping, outputColorSpace: string): Record<string, string> {
  const d: Record<string, string> = {};
  if (ColorManagement.getTransfer(outputColorSpace as ColorSpace) === SRGBTransfer) d.SRGB_TRANSFER = "";
  if (toneMapping === LinearToneMapping) d.LINEAR_TONE_MAPPING = "";
  else if (toneMapping === ReinhardToneMapping) d.REINHARD_TONE_MAPPING = "";
  else if (toneMapping === CineonToneMapping) d.CINEON_TONE_MAPPING = "";
  else if (toneMapping === ACESFilmicToneMapping) d.ACES_FILMIC_TONE_MAPPING = "";
  else if (toneMapping === AgXToneMapping) d.AGX_TONE_MAPPING = "";
  else if (toneMapping === NeutralToneMapping) d.NEUTRAL_TONE_MAPPING = "";
  else if (toneMapping === CustomToneMapping) d.CUSTOM_TONE_MAPPING = "";
  return d;
}

const VERTEX = /* glsl */ `
precision highp float;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
in vec3 position;
in vec2 uv;
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

/**
 * FXAA: the edge search and blend of three's FXAAShader (Jasper Flick's FXAA, NVIDIA's algorithm), on the tone-mapped
 * picture computed in place. Tuned to stand in for the MSAA it replaces, which smoothed geometric edges and left the
 * textures alone: the edge thresholds are FXAA 3.11's "high quality" ones (0.0625 / 0.125: three's 0.0312 / 0.063 treat
 * most of the paving's texture as edges) and the sub-pixel blend is low (0.25, FXAA's "almost off": it blurs any pixel
 * that stands out from its neighbours, texture detail included). Measured on the village by day at 2560x1290 (Laplacian
 * variance of the 3D view, main's MSAA = 100 %): three's settings 55 %, 0.0625 / 0.125 / 0.5 68 %, these 74-86 %.
 */
const FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform vec2 texel;
// The part of tScene the scene was drawn into (the render scale), as a share of the texture, and the last texel centre in it
// (a sample is held inside the part: past its edge lies what an earlier, larger frame left).
uniform vec2 uvScale;
uniform vec2 uvMax;
#include <tonemapping_pars_fragment>
#include <colorspace_pars_fragment>
in vec2 vUv;
out vec4 outColor;

vec3 toneMap(vec3 c) {
#if defined(LINEAR_TONE_MAPPING)
  return LinearToneMapping(c);
#elif defined(REINHARD_TONE_MAPPING)
  return ReinhardToneMapping(c);
#elif defined(CINEON_TONE_MAPPING)
  return CineonToneMapping(c);
#elif defined(ACES_FILMIC_TONE_MAPPING)
  return ACESFilmicToneMapping(c);
#elif defined(AGX_TONE_MAPPING)
  return AgXToneMapping(c);
#elif defined(NEUTRAL_TONE_MAPPING)
  return NeutralToneMapping(c);
#elif defined(CUSTOM_TONE_MAPPING)
  return CustomToneMapping(c);
#else
  return c;
#endif
}

vec4 display(vec4 hdr) {
  vec4 c = vec4(toneMap(hdr.rgb), hdr.a);
#ifdef SRGB_TRANSFER
  c = sRGBTransferOETF(c);
#endif
  return c;
}

vec4 sceneAt(vec2 uv) {
  return texture(tScene, min(uv, uvMax));
}

// The frame's colour at uv (in tScene's coordinates): the scene plus the bloom, as the bloom pass's additive copy
// (src.rgb * src.a, ONE) left it. The bloom covers the whole screen whatever the scale (its bright pass read the part).
vec4 frameAt(vec2 uv) {
  vec4 b = texture(tBloom, uv / uvScale);
  return display(sceneAt(uv) + b * b.a);
}

float lumaAt(vec2 uv) {
  return dot(display(sceneAt(uv)).rgb, vec3(0.3, 0.59, 0.11));
}

#define EDGE_STEP_COUNT 6
#define EDGE_GUESS 8.0
const float edgeSteps[EDGE_STEP_COUNT] = float[EDGE_STEP_COUNT](1.0, 1.5, 2.0, 2.0, 2.0, 4.0);
const float CONTRAST_THRESHOLD = 0.0625;
const float RELATIVE_THRESHOLD = 0.125;
const float SUBPIXEL_BLENDING = 0.25;

void main() {
  vec2 uv = vUv * uvScale;
  float m = lumaAt(uv);
  float n = lumaAt(uv + texel * vec2(0.0, 1.0));
  float e = lumaAt(uv + texel * vec2(1.0, 0.0));
  float s = lumaAt(uv + texel * vec2(0.0, -1.0));
  float w = lumaAt(uv + texel * vec2(-1.0, 0.0));
  float highest = max(max(max(max(n, e), s), w), m);
  float lowest = min(min(min(min(n, e), s), w), m);
  float contrast = highest - lowest;
  if (contrast < max(CONTRAST_THRESHOLD, RELATIVE_THRESHOLD * highest)) {
    outColor = frameAt(uv);
    return;
  }
  float ne = lumaAt(uv + texel * vec2(1.0, 1.0));
  float nw = lumaAt(uv + texel * vec2(-1.0, 1.0));
  float se = lumaAt(uv + texel * vec2(1.0, -1.0));
  float sw = lumaAt(uv + texel * vec2(-1.0, -1.0));

  // Sub-pixel blend.
  float f = (2.0 * (n + e + s + w) + ne + nw + se + sw) / 12.0;
  f = clamp(abs(f - m) / contrast, 0.0, 1.0);
  f = smoothstep(0.0, 1.0, f);
  float pixelBlend = f * f * SUBPIXEL_BLENDING;

  // Edge direction.
  float horizontal = abs(n + s - 2.0 * m) * 2.0 + abs(ne + se - 2.0 * e) + abs(nw + sw - 2.0 * w);
  float vertical = abs(e + w - 2.0 * m) * 2.0 + abs(ne + nw - 2.0 * n) + abs(se + sw - 2.0 * s);
  bool isHorizontal = horizontal >= vertical;
  float pL = isHorizontal ? n : e;
  float nL = isHorizontal ? s : w;
  float pGradient = abs(pL - m);
  float nGradient = abs(nL - m);
  float pixelStep = isHorizontal ? texel.y : texel.x;
  float oppositeLuma;
  float gradient;
  if (pGradient < nGradient) {
    pixelStep = -pixelStep;
    oppositeLuma = nL;
    gradient = nGradient;
  } else {
    oppositeLuma = pL;
    gradient = pGradient;
  }

  // Edge length.
  vec2 uvEdge = uv;
  vec2 edgeStep;
  if (isHorizontal) {
    uvEdge.y += pixelStep * 0.5;
    edgeStep = vec2(texel.x, 0.0);
  } else {
    uvEdge.x += pixelStep * 0.5;
    edgeStep = vec2(0.0, texel.y);
  }
  float edgeLuma = (m + oppositeLuma) * 0.5;
  float gradientThreshold = gradient * 0.25;
  vec2 puv = uvEdge + edgeStep * edgeSteps[0];
  float pDelta = lumaAt(puv) - edgeLuma;
  bool pAtEnd = abs(pDelta) >= gradientThreshold;
  for (int i = 1; i < EDGE_STEP_COUNT && !pAtEnd; i++) {
    puv += edgeStep * edgeSteps[i];
    pDelta = lumaAt(puv) - edgeLuma;
    pAtEnd = abs(pDelta) >= gradientThreshold;
  }
  if (!pAtEnd) puv += edgeStep * EDGE_GUESS;
  vec2 nuv = uvEdge - edgeStep * edgeSteps[0];
  float nDelta = lumaAt(nuv) - edgeLuma;
  bool nAtEnd = abs(nDelta) >= gradientThreshold;
  for (int i = 1; i < EDGE_STEP_COUNT && !nAtEnd; i++) {
    nuv -= edgeStep * edgeSteps[i];
    nDelta = lumaAt(nuv) - edgeLuma;
    nAtEnd = abs(nDelta) >= gradientThreshold;
  }
  if (!nAtEnd) nuv -= edgeStep * EDGE_GUESS;
  float pDistance = isHorizontal ? puv.x - uv.x : puv.y - uv.y;
  float nDistance = isHorizontal ? uv.x - nuv.x : uv.y - nuv.y;
  float shortest;
  bool deltaSign;
  if (pDistance <= nDistance) {
    shortest = pDistance;
    deltaSign = pDelta >= 0.0;
  } else {
    shortest = nDistance;
    deltaSign = nDelta >= 0.0;
  }
  float edgeBlend = deltaSign == (m - edgeLuma >= 0.0) ? 0.0 : 0.5 - shortest / (pDistance + nDistance);

  float blend = max(pixelBlend, edgeBlend);
  vec2 at = uv;
  if (isHorizontal) at.y += pixelStep * blend;
  else at.x += pixelStep * blend;
  vec4 c = frameAt(at);
  // The alpha of the pixel itself (the canvas clamps it; an opaque sky makes it 1 everywhere).
  c.a = frameAt(uv).a;
  outColor = c;
}`;

/**
 * The bloom's bright pass: three-stdlib's LuminosityHighPassShader (UnrealBloomPass's own), reading only the part of the
 * scene's target the scene was drawn into (the render scale). The bloom itself keeps its size: it is a blur of the screen.
 */
const HIGH_PASS_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const HIGH_PASS_FRAGMENT = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec3 defaultColor;
uniform float defaultOpacity;
uniform float luminosityThreshold;
uniform float smoothWidth;
uniform vec2 uvScale;
uniform vec2 uvMax;
varying vec2 vUv;
void main() {
  vec4 texel = texture2D(tDiffuse, min(vUv * uvScale, uvMax));
  vec3 luma = vec3(0.299, 0.587, 0.114);
  float v = dot(texel.xyz, luma);
  vec4 outputColor = vec4(defaultColor.rgb, defaultOpacity);
  float alpha = smoothstep(luminosityThreshold, luminosityThreshold + smoothWidth, v);
  gl_FragColor = mix(outputColor, texel, alpha);
}`;

export interface BloomSettings {
  strength: number;
  radius: number;
  threshold: number;
}

const BLUR_X = new Vector2(1, 0);
const BLUR_Y = new Vector2(0, 1);

/** The smallest render scale (the governor's lowest step on a dpr-2 screen is 1 / 2). */
const MIN_SCALE = 0.25;

/** Scene -> half-float target -> bloom -> one tone-mapping + FXAA pass to the screen. See the file header. */
export class PostChain {
  /** The scene's target: half-float (the bloom needs light past white), a depth buffer, NO multisampling. */
  readonly target: WebGLRenderTarget;
  readonly bloomPass: UnrealBloomPass;
  /** The bloom's bright pass (reads the scaled part of the scene's target). */
  readonly highPass: ShaderMaterial;
  readonly output: RawShaderMaterial;
  /** The part of the target the scene is drawn into, in pixels (the whole target at scale 1). */
  readonly region = new Vector2(1, 1);
  private readonly quad = new FullScreenQuad();
  /**
   * The label pass's scene: no children of its own — for the pass it borrows the real scene's child list, so the labels
   * stay where they are (on the avatars) while this pass gets its OWN render state. Drawing the real scene a second time
   * with only the label layer would collect no lights into the scene's render state and every lit material would see the
   * light setup change twice a frame (a program look-up per material per frame); this scene's state has no lights, always.
   */
  private readonly labels = new Scene();
  private readonly noChildren: Object3D[] = [];
  /** A stand-in label kept alive so its compiled program (shared by every label) is never released (`warmLabels`). */
  private labelWarmer: Sprite | null = null;
  private readonly size = new Vector2(0, 0);
  private renderScale = 1;
  private readonly oldClear = new Color();
  private toneMapping: ToneMapping | null = null;
  private colorSpace: string | null = null;

  constructor(settings: BloomSettings) {
    this.target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, format: RGBAFormat, depthBuffer: true, stencilBuffer: false });
    this.target.texture.name = "PostChain.scene";
    this.target.samples = 0;
    this.bloomPass = new UnrealBloomPass(new Vector2(256, 256), settings.strength, settings.radius, settings.threshold);
    // One pair of vectors shared by both passes (set together in applyRegion).
    const uvScale = new Vector2(1, 1);
    const uvMax = new Vector2(1, 1);
    this.highPass = new ShaderMaterial({
      name: "PostChain.bright",
      uniforms: {
        tDiffuse: { value: this.target.texture },
        luminosityThreshold: { value: settings.threshold },
        smoothWidth: { value: 0.01 },
        defaultColor: { value: new Color(0) },
        defaultOpacity: { value: 0 },
        uvScale: { value: uvScale },
        uvMax: { value: uvMax },
      },
      vertexShader: HIGH_PASS_VERTEX,
      fragmentShader: HIGH_PASS_FRAGMENT,
    });
    this.output = new RawShaderMaterial({
      name: "PostChain.output",
      glslVersion: GLSL3,
      uniforms: {
        tScene: { value: this.target.texture },
        tBloom: { value: null },
        texel: { value: new Vector2(1, 1) },
        uvScale: { value: uvScale },
        uvMax: { value: uvMax },
        toneMappingExposure: { value: 1 },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      depthTest: false,
      depthWrite: false,
    });
  }

  /**
   * Size in DRAWING-BUFFER pixels (css size x dpr). Cheap to call every frame: only a change does anything (the targets are
   * re-made at the new size: the window was resized).
   */
  setSize(width: number, height: number): void {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    if (w === this.size.x && h === this.size.y) return;
    this.size.set(w, h);
    this.target.setSize(w, h);
    this.bloomPass.setSize(w, h);
    (this.output.uniforms.texel!.value as Vector2).set(1 / w, 1 / h);
    this.applyRegion();
  }

  /** The render scale in force (1: the whole drawing buffer). */
  get scale(): number {
    return this.renderScale;
  }

  /**
   * Draw the scene at `scale` of the drawing buffer's width and height (the frame governor's step, renderBudget.ts) and
   * stretch it over the screen in the final pass. Nothing is re-made: a viewport and four numbers.
   */
  setScale(scale: number): void {
    const s = Math.min(1, Math.max(MIN_SCALE, Number.isFinite(scale) ? scale : 1));
    if (s === this.renderScale) return;
    this.renderScale = s;
    this.applyRegion();
  }

  private applyRegion(): void {
    const w = this.size.x;
    const h = this.size.y;
    if (w === 0 || h === 0) return;
    const rw = Math.max(1, Math.min(w, Math.round(w * this.renderScale)));
    const rh = Math.max(1, Math.min(h, Math.round(h * this.renderScale)));
    this.region.set(rw, rh);
    // (setSize resets the viewport and the scissor to the whole target.) The clear is held to the region too.
    this.target.viewport.set(0, 0, rw, rh);
    this.target.scissor.set(0, 0, rw, rh);
    this.target.scissorTest = rw < w || rh < h;
    (this.output.uniforms.uvScale!.value as Vector2).set(rw / w, rh / h);
    (this.output.uniforms.uvMax!.value as Vector2).set((rw - 0.5) / w, (rh - 0.5) / h);
  }

  /**
   * One frame: the scene into the target (without the labels), the bloom from it, the final pass to the screen (the default
   * framebuffer), then the labels on top at full resolution.
   */
  render(renderer: WebGLRenderer, scene: Object3D, camera: Camera): void {
    const oldAutoClear = renderer.autoClear;
    const oldMask = camera.layers.mask;
    renderer.autoClear = false;
    renderer.setRenderTarget(this.target);
    renderer.clear();
    setRenderScale(this.renderScale);
    camera.layers.disable(LABEL_LAYER);
    try {
      renderer.render(scene, camera);
    } finally {
      setRenderScale(1);
      camera.layers.mask = oldMask;
      renderer.autoClear = oldAutoClear;
    }

    const bloom = this.renderBloom(renderer);
    this.prepareOutput(renderer);
    this.output.uniforms.tBloom!.value = bloom;
    this.output.uniforms.toneMappingExposure!.value = renderer.toneMappingExposure;
    this.quad.material = this.output;
    renderer.setRenderTarget(null);
    this.quad.render(renderer);
    this.renderLabels(renderer, scene, camera);
  }

  /**
   * The labels, over the finished frame on the screen: the scene's LABEL_LAYER only, nothing cleared, at the drawing
   * buffer's own size. Their materials are not tone-mapped and not fogged (spriteCanvas.ts), so they come out in their
   * canvas colours; the matrices are this frame's (the scene pass updated them).
   */
  renderLabels(renderer: WebGLRenderer, scene: Object3D, camera: Camera): void {
    const labels = this.labels;
    const oldMask = camera.layers.mask;
    const oldAutoClear = renderer.autoClear;
    const oldInfoReset = renderer.info.autoReset;
    labels.children = scene.children;
    labels.matrixWorldAutoUpdate = false;
    camera.layers.set(LABEL_LAYER);
    renderer.autoClear = false;
    renderer.info.autoReset = false; // adds to the draw counts three keeps for the frame instead of starting them over
    renderer.setRenderTarget(null);
    try {
      renderer.render(labels, camera);
    } finally {
      labels.children = this.noChildren;
      camera.layers.mask = oldMask;
      renderer.autoClear = oldAutoClear;
      renderer.info.autoReset = oldInfoReset;
    }
  }

  /**
   * UnrealBloomPass.render up to its composite (renderTargetsHorizontal[0]) — without its additive copy back into the
   * scene, and with the bright pass reading the scaled part of the scene's target (`highPass`).
   */
  private renderBloom(renderer: WebGLRenderer): Texture {
    const p = this.bloomPass;
    renderer.getClearColor(this.oldClear);
    const oldAlpha = renderer.getClearAlpha();
    const oldAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setClearColor(p.clearColor, 0);

    this.highPass.uniforms.luminosityThreshold!.value = p.threshold;
    this.quad.material = this.highPass;
    renderer.setRenderTarget(p.renderTargetBright);
    renderer.clear();
    this.quad.render(renderer);

    let from = p.renderTargetBright;
    for (let i = 0; i < p.nMips; i++) {
      const blur = p.separableBlurMaterials[i]!;
      this.quad.material = blur;
      blur.uniforms.colorTexture!.value = from.texture;
      blur.uniforms.direction!.value = BLUR_X;
      renderer.setRenderTarget(p.renderTargetsHorizontal[i]!);
      renderer.clear();
      this.quad.render(renderer);
      blur.uniforms.colorTexture!.value = p.renderTargetsHorizontal[i]!.texture;
      blur.uniforms.direction!.value = BLUR_Y;
      renderer.setRenderTarget(p.renderTargetsVertical[i]!);
      renderer.clear();
      this.quad.render(renderer);
      from = p.renderTargetsVertical[i]!;
    }

    const composite = p.compositeMaterial;
    composite.uniforms.bloomStrength!.value = p.strength;
    composite.uniforms.bloomRadius!.value = p.radius;
    composite.uniforms.bloomTintColors!.value = p.bloomTintColors;
    this.quad.material = composite;
    renderer.setRenderTarget(p.renderTargetsHorizontal[0]!);
    renderer.clear();
    this.quad.render(renderer);

    renderer.setClearColor(this.oldClear, oldAlpha);
    renderer.autoClear = oldAutoClear;
    return p.renderTargetsHorizontal[0]!.texture;
  }

  /**
   * Compile the label pass's program ahead of the first label (SceneWarmUp): the labels share one program, but the label
   * pass draws to the screen from a render state with no lights, a variant the scene's own warm-up (for the scene's target,
   * with its lights) does not make. A 1 x 1 stand-in label is compiled in exactly that state.
   */
  warmLabels(renderer: WebGLRenderer, camera: Camera): Promise<unknown> {
    if (!this.labelWarmer) {
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      this.labelWarmer = billboardSprite(canvasTexture(canvas), 1, 1, 0);
    }
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(null);
    try {
      return compileSafely(renderer, this.labelWarmer, camera, this.labels);
    } finally {
      renderer.setRenderTarget(prev);
    }
  }

  /** Rebuild the final pass's defines when the renderer's tone curve or colour space changed (OutputPass's rule). */
  private prepareOutput(renderer: WebGLRenderer): void {
    if (this.toneMapping === renderer.toneMapping && this.colorSpace === renderer.outputColorSpace) return;
    this.toneMapping = renderer.toneMapping;
    this.colorSpace = renderer.outputColorSpace;
    this.output.defines = outputDefines(renderer.toneMapping, renderer.outputColorSpace);
    this.output.needsUpdate = true;
  }

  dispose(): void {
    this.target.dispose();
    this.bloomPass.dispose();
    this.highPass.dispose();
    this.output.dispose();
    if (this.labelWarmer) {
      const m = this.labelWarmer.material as SpriteMaterial;
      m.map?.dispose();
      m.dispose();
      this.labelWarmer = null;
    }
  }
}

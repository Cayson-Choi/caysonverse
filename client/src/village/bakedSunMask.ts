import {
  PCFShadowMap,
  Camera,
  Color,
  DoubleSide,
  DirectionalLight,
  GLSL3,
  Mesh,
  NoColorSpace,
  Object3D,
  OrthographicCamera,
  PlaneGeometry,
  RGFormat,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  Vector4,
  WebGLRenderTarget,
  LinearFilter,
  type BufferGeometry,
  type Material,
  type Texture,
  type WebGLRenderer,
  Matrix4,
  Vector3,
} from "three";
import { isMesh, materialsOf, COLLIDER_PREFIX, LIGHTMAP_MATERIAL_PREFIX } from "../game/hub/hubModelPrep";
import { CASTER_TOP, MASK_MAP_SIZE, MASK_TILE, orthoBoxFor } from "./sunShadows";
import type { Vec3 } from "./dayNightBlend";

/**
 * The baked sun's visibility in the light map's UV space (docs/designs/sun-shadows): for every texel of the shipped day
 * light map, how much of it saw the bake's sun (1) or lay in a baked shadow (0). The live light (sunShadows.ts) takes
 * the baked sun's direct light out by it, so the fixed morning shadows of the bake go and the real sun's live ones
 * take their place — without a new bake. Built ONCE when the village loads, on the GPU:
 *
 *  1. the village is cut into `MASK_TILE` m tiles; for each, a depth map from the bake's sun (`MASK_MAP_SIZE`², a few cm
 *     per texel) of the model as it was baked (the loader's untouched source: the old card trees and the plaza
 *     zelkova the bake saw, not the runtime trees that replaced them);
 *  2. the light-mapped meshes are drawn into the mask with their light-map UVs as positions; each texel inside the tile
 *     averages 4×4 shadow tests over its own footprint (the screen derivatives of the world position are one texel),
 *     so the mask has the bake's resolution and its edges fall where the baked shadows' do;
 *  3. the islands' 8-texel margins are filled outward (8 dilation passes), as the bake's margin was, so bilinear
 *     reads at an island's edge agree with the light map's.
 * R = the visibility, G = 1 where the mask knows the texel (0 outside the tiles: the material keeps the bake there).
 */

/** Material names that never cast in the bake's light for this mask (sky, far hills, water, glows). */
const NOT_CASTERS = new Set(["M_sky", "M_backdrop", "M_water", "M_waterfall", "M_glow_plot"]);
/**
 * The old foliage cards (M_leaf_*): their shadows hardly show in the shipped day map (the bake's light passed their
 * cut-outs and the sky filled in under them), while their cards as opaque-ish depth made crown-sized blots in the mask
 * where the bake is lit. The trunks (M_bark, LM_bark) stay.
 */
const LEAF = "M_leaf_";
/** The backdrop's forest cards (far away, never over the village). */
const FAR_FOREST = "inst__far_";

const UV_VERTEX = /* glsl */ `
in vec2 uv1;
out vec3 vW;
void main() {
	vW = ( modelMatrix * vec4( position, 1.0 ) ).xyz;
	gl_Position = vec4( uv1 * 2.0 - 1.0, 0.0, 1.0 );
}`;

const UV_FRAGMENT = /* glsl */ `
precision highp float;
precision highp sampler2DShadow;
uniform sampler2DShadow uMap;
uniform mat4 uMat;
uniform vec4 uTile;
uniform vec3 uDir;
uniform float uTexel;
uniform float uBias;
in vec3 vW;
out vec4 fragColor;
void main() {
	vec3 dx = dFdx( vW );
	vec3 dy = dFdy( vW );
	if ( vW.x < uTile.x || vW.x >= uTile.z || vW.z < uTile.y || vW.z >= uTile.w ) discard;
	vec3 n = cross( dx, dy );
	float ln = length( n );
	n = ln > 1e-12 ? n / ln : vec3( 0.0, 1.0, 0.0 );
	if ( dot( n, uDir ) < 0.0 ) n = - n;
	float s = 0.0;
	for ( int i = 0; i < 4; i ++ ) {
		for ( int j = 0; j < 4; j ++ ) {
			vec2 o = ( vec2( float( i ), float( j ) ) + 0.5 ) / 4.0 - 0.5;
			vec3 p = vW + dx * o.x + dy * o.y + n * uTexel * 1.5 + uDir * uTexel;
			vec4 c = uMat * vec4( p, 1.0 );
			s += textureLod( uMap, vec3( c.xy, c.z - uBias ), 0.0 );
		}
	}
	fragColor = vec4( s / 16.0, 1.0, 0.0, 1.0 );
}`;

const QUAD_VERTEX = /* glsl */ `
out vec2 vUv;
void main() {
	vUv = uv;
	gl_Position = vec4( position.xy * 2.0, 0.0, 1.0 );
}`;

const DILATE_FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D uSrc;
out vec4 fragColor;
void main() {
	ivec2 p = ivec2( gl_FragCoord.xy );
	ivec2 size = textureSize( uSrc, 0 );
	vec2 c = texelFetch( uSrc, p, 0 ).rg;
	if ( c.g > 0.5 ) {
		fragColor = vec4( c, 0.0, 1.0 );
		return;
	}
	float sum = 0.0;
	float n = 0.0;
	for ( int i = - 1; i <= 1; i ++ ) {
		for ( int j = - 1; j <= 1; j ++ ) {
			ivec2 q = clamp( p + ivec2( i, j ), ivec2( 0 ), size - 1 );
			vec2 t = texelFetch( uSrc, q, 0 ).rg;
			if ( t.g > 0.5 ) {
				sum += t.r;
				n += 1.0;
			}
		}
	}
	fragColor = n > 0.0 ? vec4( sum / n, 1.0, 0.0, 1.0 ) : vec4( 0.0 );
}`;

export interface BakedSunMask {
  texture: Texture;
  /** What the build did (DEV probe, tests of the scene). */
  stats: { tiles: number; tilesDrawn: number; ms: number; size: number };
  dispose(): void;
}

export interface MaskArea {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** The tiles (world XZ rectangles) that cover `area`, `tile` m each. */
export function maskTiles(area: MaskArea, tile = MASK_TILE): MaskArea[] {
  const out: MaskArea[] = [];
  for (let x = area.minX; x < area.maxX; x += tile) {
    for (let z = area.minZ; z < area.maxZ; z += tile) {
      out.push({ minX: x, maxX: Math.min(area.maxX, x + tile), minZ: z, maxZ: Math.min(area.maxZ, z + tile) });
    }
  }
  return out;
}

function makeTarget(size: number): WebGLRenderTarget {
  const rt = new WebGLRenderTarget(size, size, {
    format: RGFormat,
    type: UnsignedByteType,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    generateMipmaps: false,
    depthBuffer: false,
  });
  rt.texture.colorSpace = NoColorSpace;
  return rt;
}

/**
 * Build the mask for the model `source` (the loader's own scene, untouched), a light map `size` texels square, the
 * bake's sun `dir` (toward it), over `area`. Leaves the renderer as it found it.
 */
export function buildBakedSunMask(gl: WebGLRenderer, source: Object3D, size: number, dir: Vec3, area: MaskArea): BakedSunMask {
  const t0 = performance.now();
  source.updateMatrixWorld(true);
  const lmMeshes: Mesh[] = [];
  const casters: Array<{ o: Mesh; was: boolean }> = [];
  source.traverse((o) => {
    if (!isMesh(o) || o.name.startsWith(COLLIDER_PREFIX)) return;
    const mats = materialsOf(o);
    if (mats.some((m: Material) => m.name.startsWith(LIGHTMAP_MATERIAL_PREFIX)) && (o.geometry as BufferGeometry).getAttribute("uv1")) {
      lmMeshes.push(o as Mesh);
    }
    if (!o.name.startsWith(FAR_FOREST) && !mats.every((m: Material) => NOT_CASTERS.has(m.name) || m.name.startsWith(LEAF))) {
      casters.push({ o: o as Mesh, was: o.castShadow });
      o.castShadow = true;
    }
  });

  // The light for the tiles' depth maps (never in a scene: it lights nothing).
  const light = new DirectionalLight();
  const target = new Object3D();
  light.target = target;
  light.shadow.mapSize.set(MASK_MAP_SIZE, MASK_MAP_SIZE);
  const cam = light.shadow.camera as OrthographicCamera;
  const everyLayer = new Camera();
  everyLayer.layers.enableAll();

  // The UV pass.
  const uvMaterial = new ShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: UV_VERTEX,
    fragmentShader: UV_FRAGMENT,
    uniforms: {
      uMap: { value: null },
      uMat: { value: new Matrix4() },
      uTile: { value: new Vector4() },
      uDir: { value: new Vector3(dir[0], dir[1], dir[2]) },
      uTexel: { value: 0.05 },
      uBias: { value: 0.0004 },
    },
    // the light-map UV islands wind either way round: both faces
    side: DoubleSide,
    depthTest: false,
    depthWrite: false,
  });
  const uvScene = new Scene();
  const uvMeshes = lmMeshes.map((src) => {
    const m = new Mesh(src.geometry, uvMaterial);
    m.matrixAutoUpdate = false;
    m.matrix.copy(src.matrixWorld);
    m.matrixWorld.copy(src.matrixWorld);
    m.matrixWorldAutoUpdate = false;
    m.frustumCulled = false;
    if (!src.geometry.boundingBox) src.geometry.computeBoundingBox();
    const box = src.geometry.boundingBox!.clone().applyMatrix4(src.matrixWorld);
    uvScene.add(m);
    return { m, box };
  });
  const dummy = new Camera();

  const mask = makeTarget(size);
  const spare = makeTarget(size);

  // Renderer state to give back.
  const prevTarget = gl.getRenderTarget();
  const prevAutoClear = gl.autoClear;
  const prevShadowEnabled = gl.shadowMap.enabled;
  const prevShadowAuto = gl.shadowMap.autoUpdate;
  const prevClear = gl.getClearColor(new Color());
  const prevClearAlpha = gl.getClearAlpha();
  gl.autoClear = false;
  gl.shadowMap.enabled = true;
  if (gl.shadowMap.type !== PCFShadowMap) gl.shadowMap.type = PCFShadowMap; // (LiveSunShadows drawSlice: why)
  gl.shadowMap.autoUpdate = true;

  gl.setRenderTarget(mask);
  gl.setClearColor(0x000000, 0);
  gl.clear(true, false, false);

  const tiles = maskTiles(area);
  let drawn = 0;
  const u = uvMaterial.uniforms;
  for (const tile of tiles) {
    const margin = 2;
    let any = false;
    for (const { m, box } of uvMeshes) {
      m.visible = box.max.x >= tile.minX && box.min.x <= tile.maxX && box.max.z >= tile.minZ && box.min.z <= tile.maxZ;
      any ||= m.visible;
    }
    if (!any) continue;
    drawn++;
    const centre: Vec3 = [(tile.minX + tile.maxX) / 2, 0, (tile.minZ + tile.maxZ) / 2];
    const box = orthoBoxFor(dir, centre, {
      minX: tile.minX - margin,
      maxX: tile.maxX + margin,
      minZ: tile.minZ - margin,
      maxZ: tile.maxZ + margin,
      top: CASTER_TOP,
    });
    cam.left = box.left;
    cam.right = box.right;
    cam.bottom = box.bottom;
    cam.top = box.top;
    cam.near = box.near;
    cam.far = box.far;
    cam.updateProjectionMatrix();
    target.position.set(centre[0], centre[1], centre[2]);
    light.position.set(centre[0] + dir[0] * 400, centre[1] + dir[1] * 400, centre[2] + dir[2] * 400);
    target.updateMatrixWorld(true);
    light.updateMatrixWorld(true);
    light.shadow.needsUpdate = true;
    gl.shadowMap.render([light], source as Scene, everyLayer);
    const texel = Math.max(box.right - box.left, box.top - box.bottom) / MASK_MAP_SIZE;
    u.uMap!.value = light.shadow.map!.depthTexture;
    (u.uMat!.value as Matrix4).copy(light.shadow.matrix);
    (u.uTile!.value as Vector4).set(tile.minX, tile.minZ, tile.maxX, tile.maxZ);
    u.uTexel!.value = texel;
    u.uBias!.value = (texel * 1.5) / (box.far - box.near);
    gl.setRenderTarget(mask);
    gl.render(uvScene, dummy);
  }

  // Fill the islands' margins outward.
  const quad = new Mesh(
    new PlaneGeometry(1, 1),
    new ShaderMaterial({ glslVersion: GLSL3, vertexShader: QUAD_VERTEX, fragmentShader: DILATE_FRAGMENT, uniforms: { uSrc: { value: null } }, depthTest: false, depthWrite: false }),
  );
  quad.frustumCulled = false;
  const quadScene = new Scene();
  quadScene.add(quad);
  let src = mask;
  let dst = spare;
  for (let i = 0; i < 8; i++) {
    (quad.material as ShaderMaterial).uniforms.uSrc!.value = src.texture;
    gl.setRenderTarget(dst);
    gl.render(quadScene, dummy);
    [src, dst] = [dst, src];
  }
  const result = src;
  dst.dispose();

  // Give everything back.
  gl.setRenderTarget(prevTarget);
  gl.autoClear = prevAutoClear;
  gl.shadowMap.enabled = prevShadowEnabled;
  gl.shadowMap.autoUpdate = prevShadowAuto;
  gl.setClearColor(prevClear, prevClearAlpha);
  for (const c of casters) c.o.castShadow = c.was;
  light.shadow.map?.depthTexture?.dispose();
  light.shadow.map?.dispose();
  light.dispose();
  uvMaterial.dispose();
  quad.geometry.dispose();
  (quad.material as ShaderMaterial).dispose();

  return {
    texture: result.texture,
    stats: { tiles: tiles.length, tilesDrawn: drawn, ms: Math.round(performance.now() - t0), size },
    dispose: () => result.dispose(),
  };
}

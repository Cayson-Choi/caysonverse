import type { BufferGeometry, Matrix4 } from "three";
import { Vector3 } from "three";

/**
 * The plaza's paving (village.glb `LM_setts`, the pavements' `LM_walk`): two things between it and real stone (owner 2026-11-21, on
 * 케이슨랜드's cobbles: "모두 게임내 모든 요소를 이정도 수준으로").
 *
 * 1. STRETCH. The setts are laid in rings round the fountain (u along the arc, v out along the radius, 1.8 m a tile). Inside 8.6 m the
 *    build's rings break down: 2:1 squashed from 6 to 8 m and, in the fan next to the fountain's plinth, 600 m of arc per tile - a
 *    grey smear where stones should be. `fixSettsUv` relays that inner court straight (u = x, v = z at the same 1.8 m a tile): the
 *    plinth it surrounds is square, so straight courses meet it as a mason would lay them.
 * 2. FLAT. The scan's colour has no relief: the joints were paint. `SETTS_RELIEF` reads the height out of the stones' own picture
 *    (the joints are dark, the stones' crowns light), turns its slope into a normal in world space and lights it with the live sun: the
 *    joints fall into shade on the sun's far side and the stones' shoulders catch it, turning with the time of day. Filtered by the
 *    pixel's footprint: it fades out where a pixel is wider than a joint (no shimmer in the distance), and with the night.
 */
export const SETTS_MATERIALS: readonly string[] = ["LM_setts", "LM_walk"];
/** Inside this radius (m, round the fountain at the plaza's centre) the setts are relaid straight. */
export const SETTS_COURT_RADIUS = 8.6;
/** Metres a tile of the setts' texture covers (the build's own density, kept). */
export const SETTS_TILE_M = 1.8;

/**
 * A copy of the setts' geometry with the inner court's triangles relaid (world-planar uv). Triangles are told by their centroid; the
 * geometry is un-indexed so the court's edge vertices can carry both layouts. `uv1` (the light map) and everything else is kept.
 */
export function fixSettsUv(geometry: BufferGeometry, matrixWorld: Matrix4, centre = { x: 0, z: 0 }): { geometry: BufferGeometry; relaid: number } {
  const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  const pos = g.getAttribute("position");
  const uv = g.getAttribute("uv");
  if (!pos || !uv) return { geometry: g, relaid: 0 };
  const p = [new Vector3(), new Vector3(), new Vector3()];
  let relaid = 0;
  for (let t = 0; t + 2 < pos.count; t += 3) {
    let cx = 0;
    let cz = 0;
    for (let k = 0; k < 3; k++) {
      p[k]!.fromBufferAttribute(pos, t + k).applyMatrix4(matrixWorld);
      cx += p[k]!.x / 3;
      cz += p[k]!.z / 3;
    }
    if (Math.hypot(cx - centre.x, cz - centre.z) >= SETTS_COURT_RADIUS) continue;
    for (let k = 0; k < 3; k++) uv.setXY(t + k, p[k]!.x / SETTS_TILE_M, p[k]!.z / SETTS_TILE_M);
    relaid++;
  }
  uv.needsUpdate = true;
  return { geometry: g, relaid };
}

/** The relief's strength: metres of height per unit of the picture's luma, and how far the light may swing. */
export const SETTS_RELIEF_LOOK = { heightM: 0.009, min: 0.62, max: 1.3 } as const;

/**
 * `#include <map_fragment>` for the setts: the map, then the relief (needs sunShadows' fragment pars: vSsWorld, uSsSunDir; and
 * `uVillageNight`).
 */
export const SETTS_RELIEF = /* glsl */ `#include <map_fragment>
#ifdef USE_MAP
{
	// two mip levels down: the joints and the stones' crowns, not the granite's grain (a relief of every speck would sparkle in motion)
	float settsH = dot( texture2D( map, vMapUv, 2.0 ).rgb, vec3( 0.299, 0.587, 0.114 ) );
	vec2 settsWx = dFdx( vSsWorld.xz );
	vec2 settsWy = dFdy( vSsWorld.xz );
	float settsDet = settsWx.x * settsWy.y - settsWx.y * settsWy.x;
	if ( abs( settsDet ) > 1e-10 ) {
		float settsHx = dFdx( settsH );
		float settsHy = dFdy( settsH );
		// the height's slope per metre along world x and z
		vec2 settsG = vec2( settsHx * settsWy.y - settsHy * settsWx.y, settsHy * settsWx.x - settsHx * settsWy.x ) / settsDet;
		float settsPx = max( length( settsWx ), length( settsWy ) );
		float settsFade = clamp( 0.012 / settsPx, 0.0, 1.0 ) * ( 1.0 - uVillageNight );
		vec3 settsN = normalize( vec3( - settsG.x * ${SETTS_RELIEF_LOOK.heightM.toFixed(4)}, 1.0, - settsG.y * ${SETTS_RELIEF_LOOK.heightM.toFixed(4)} ) );
		float settsLit = max( dot( settsN, uSsSunDir ), 0.0 ) / max( uSsSunDir.y, 0.25 );
		diffuseColor.rgb *= mix( 1.0, clamp( settsLit, ${SETTS_RELIEF_LOOK.min.toFixed(2)}, ${SETTS_RELIEF_LOOK.max.toFixed(2)} ), settsFade );
	}
}
#endif`;

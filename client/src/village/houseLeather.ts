import { BufferAttribute, type BufferGeometry } from "three";

/**
 * Leather in a house (polish 3, owner 2026-11-28, house 6: "가죽 소파가 밋밋"): the houses are drawn unlit under their light maps, so a
 * leather sofa had the albedo and the baked (diffuse) light only — a matte hide that read as suede. Its look comes back in two parts:
 *  - in the bake (uph_light.py): soft creases (short-range AO on the leather's vertices) and a deeper hide;
 *  - here: a view-dependent sheen — a broad highlight of the ceiling / window light that moves as one walks round the sofa, and a faint
 *    rim at grazing angles — scaled by the baked light at that point (a dark corner stays dark, night is dimmer).
 * The house files carry no normals (unlit), so the leather's geometry gets smooth ones once, averaged over every face that shares a
 * POSITION (the light-map UV seams split the vertices; averaging by index would leave a hard line along every seam).
 */

/** The house leather materials (HA `LM_leather`, HB `E_H_leather`). */
export function isHouseLeatherMaterial(name: string): boolean {
  return name === "LM_leather" || name === "E_H_leather";
}

/** Peak sheen (share of the baked light at the point), its lobe's sharpness, and the grazing rim's share. */
export const LEATHER_SHEEN = { spec: 0.16, power: 18, rim: 0.06 } as const;

/**
 * Glazed table ceramics (polish 4, 2026-11-28: vases, cups, teapots, bowls and plates of the houses, material `H_glaze` in the builders):
 * the same view-dependent highlight as the leather, sharper and brighter (a glaze is a thin glass coat), a cool-white rim.
 */
export const GLAZE_SHEEN = { spec: 0.34, power: 64, rim: 0.1 } as const;

export interface HouseSheen {
  spec: number;
  power: number;
  rim: number;
}

/** The house glaze materials (HA `LM_glaze`, HB `E_H_glaze`). */
export function isHouseGlazeMaterial(name: string): boolean {
  return name === "LM_glaze" || name === "E_H_glaze";
}

/**
 * Round small things (polish 4, 2026-11-28: the house 1 vase still showed flat vertical panels and the fruit read lumpy in the phone
 * close-up): a vase, a cup or an apple was a scatter of sub-texel light-map islands, one flat value per face. The bake now gives each
 * such thing ONE light-map point (uph_light.py collapse_decor_uv: the mean of its vertex light, a light probe), so the light map gives
 * it a single level, and here that level is shaped by the smooth normal (`shape`: a soft top light, darker underneath) so it reads
 * round. `bias` (a mip bias on the read) stays 0: the probe is a 5 x 5 texel block. Glaze strongly, petals and the atlas props gently.
 */
export const ROUND_LIT = { glaze: { bias: 0.0, shape: 0.55 }, petal: { bias: 0.0, shape: 0.35 }, atlas: { bias: 0.0, shape: 0.4 } } as const;

/** The house atlas materials (HA `LM_atlas`, HB `E_H_atlas`): the small props in atlas colours. */
export function isHouseAtlasMaterial(name: string): boolean {
  return name === "LM_atlas" || name === "E_H_atlas";
}

/** The table flowers' petals and florets (HA `LM_petal`, HB `E_H_petal`; polish 4). */
export function isHousePetalMaterial(name: string): boolean {
  return name === "LM_petal" || name === "E_H_petal";
}

/** How a house material is lit round (glaze, petals, atlas), or null. */
export function houseRoundLitOf(name: string): { bias: number; shape: number } | null {
  if (isHouseGlazeMaterial(name)) return ROUND_LIT.glaze;
  if (isHousePetalMaterial(name)) return ROUND_LIT.petal;
  if (isHouseAtlasMaterial(name)) return ROUND_LIT.atlas;
  return null;
}

/** Whether a house material needs smooth normals in the game (a sheen or a round light). */
export function houseWantsNormals(name: string): boolean {
  return houseSheenOf(name) !== null || houseRoundLitOf(name) !== null;
}

/** The round light, right after the light map's texel is read (lightMapTexel; needs vLeatherN). */
export function roundLitFrag(p: { shape: number }): string {
  return /* glsl */ `
	{
		float rOk = step( 0.01, length( vLeatherN ) );
		vec3 rN = vLeatherN / max( length( vLeatherN ), 0.01 );
		rN *= dot( rN, cameraPosition - vHouseFireW ) < 0.0 ? -1.0 : 1.0; // toward the eye (the faces' winding is not to be trusted)
		float rUp = 0.5 + 0.5 * dot( rN, normalize( vec3( 0.35, 1.0, 0.25 ) ) );
		lightMapTexel.rgb *= mix( 1.0, 1.0 - ${p.shape.toFixed(3)} * 0.65 + ${p.shape.toFixed(3)} * rUp, rOk );
	}`;
}

/** The sheen a house material takes (leather, glaze), or null. */
export function houseSheenOf(name: string): { kind: "leather" | "glaze"; sheen: HouseSheen } | null {
  if (isHouseLeatherMaterial(name)) return { kind: "leather", sheen: LEATHER_SHEEN };
  if (isHouseGlazeMaterial(name)) return { kind: "glaze", sheen: GLAZE_SHEEN };
  return null;
}

/** Smooth normals by position (idempotent: a flag on the geometry). Returns false when there was nothing to do. */
export function smoothNormalsByPosition(g: BufferGeometry): boolean {
  if (g.userData.leatherNormals) return false;
  const pos = g.getAttribute("position");
  if (!pos) return false;
  g.userData.leatherNormals = true;
  const idx = g.getIndex();
  const n = pos.count;
  const key = new Map<string, number>();
  const slot = new Int32Array(n);
  const q = (v: number) => Math.round(v * 700); // 1.4 mm (the files' 16-bit Draco positions are ~0.6 mm steps over a house: a finer key split the copies)
  for (let i = 0; i < n; i++) {
    const k = `${q(pos.getX(i))},${q(pos.getY(i))},${q(pos.getZ(i))}`;
    let s = key.get(k);
    if (s === undefined) {
      s = key.size;
      key.set(k, s);
    }
    slot[i] = s;
  }
  const acc = new Float32Array(key.size * 3);
  const count = idx ? idx.count : n;
  for (let t = 0; t + 2 < count; t += 3) {
    const a = idx ? idx.getX(t) : t;
    const b = idx ? idx.getX(t + 1) : t + 1;
    const c = idx ? idx.getX(t + 2) : t + 2;
    const ax = pos.getX(a), ay = pos.getY(a), az = pos.getZ(a);
    const ux = pos.getX(b) - ax, uy = pos.getY(b) - ay, uz = pos.getZ(b) - az;
    const vx = pos.getX(c) - ax, vy = pos.getY(c) - ay, vz = pos.getZ(c) - az;
    // area-weighted face normal; the builders' faces are not all wound the same way (polish 4: a vase read as two halves), so each face
    // is added turned to agree with what its vertex has gathered so far
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const i of [a, b, c]) {
      const s = slot[i]! * 3;
      const sg = acc[s]! * nx + acc[s + 1]! * ny + acc[s + 2]! * nz < 0 ? -1 : 1;
      acc[s] += sg * nx;
      acc[s + 1] += sg * ny;
      acc[s + 2] += sg * nz;
    }
  }
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const s = slot[i]! * 3;
    const x = acc[s]!, y = acc[s + 1]!, z = acc[s + 2]!;
    const l = Math.hypot(x, y, z) || 1;
    out[i * 3] = x / l;
    out[i * 3 + 1] = y / l;
    out[i * 3 + 2] = z / l;
  }
  g.setAttribute("normal", new BufferAttribute(out, 3));
  return true;
}

export const LEATHER_VERT_PARS = /* glsl */ `varying vec3 vLeatherN;`;
export const LEATHER_VERT = /* glsl */ `
	vec3 leatherN = normal;
#ifdef USE_INSTANCING
	leatherN = mat3( instanceMatrix ) * leatherN;
#endif
	vLeatherN = mat3( modelMatrix ) * leatherN;`;
export const LEATHER_FRAG_PARS = /* glsl */ `varying vec3 vLeatherN;`;
/** Added to the outgoing colour (after the light map); needs vHouseFireW (the world position) and lightMapTexel. */
export function sheenFrag(p: HouseSheen): string {
  return /* glsl */ `
	{
		float lOk = step( 0.01, length( vLeatherN ) ); // (no normals: no sheen, never a NaN)
		vec3 lN = vLeatherN / max( length( vLeatherN ), 0.01 );
		lN *= dot( lN, cameraPosition - vHouseFireW ) < 0.0 ? -1.0 : 1.0; // toward the eye (the faces' winding is not to be trusted)
		vec3 lV = normalize( cameraPosition - vHouseFireW );
		vec3 lH = normalize( lV + vec3( 0.0, 1.0, 0.0 ) );
		float lSpec = pow( max( dot( lN, lH ), 0.0 ), ${p.power.toFixed(1)} );
		float lRim = pow( 1.0 - max( dot( lN, lV ), 0.0 ), 3.0 );
		float lLum = dot( lightMapTexel.rgb * lightMapIntensity * RECIPROCAL_PI, vec3( 0.2126, 0.7152, 0.0722 ) );
		outgoingLight += vec3( 1.0, 0.95, 0.88 ) * lOk * lLum * ( ${p.spec.toFixed(3)} * lSpec + ${p.rim.toFixed(3)} * lRim );
	}
	#include <opaque_fragment>`;
}
/** The leather's (polish 3). */
export const LEATHER_FRAG = sheenFrag(LEATHER_SHEEN);

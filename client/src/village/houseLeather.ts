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
  const q = (v: number) => Math.round(v * 2000); // 0.5 mm
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
    // area-weighted face normal
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const i of [a, b, c]) {
      const s = slot[i]! * 3;
      acc[s] += nx;
      acc[s + 1] += ny;
      acc[s + 2] += nz;
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
export const LEATHER_FRAG = /* glsl */ `
	{
		float lOk = step( 0.01, length( vLeatherN ) ); // (no normals: no sheen, never a NaN)
		vec3 lN = vLeatherN / max( length( vLeatherN ), 0.01 ) * ( gl_FrontFacing ? 1.0 : -1.0 );
		vec3 lV = normalize( cameraPosition - vHouseFireW );
		vec3 lH = normalize( lV + vec3( 0.0, 1.0, 0.0 ) );
		float lSpec = pow( max( dot( lN, lH ), 0.0 ), ${LEATHER_SHEEN.power.toFixed(1)} );
		float lRim = pow( 1.0 - max( dot( lN, lV ), 0.0 ), 3.0 );
		float lLum = dot( lightMapTexel.rgb * lightMapIntensity * RECIPROCAL_PI, vec3( 0.2126, 0.7152, 0.0722 ) );
		outgoingLight += vec3( 1.0, 0.95, 0.88 ) * lOk * lLum * ( ${LEATHER_SHEEN.spec.toFixed(3)} * lSpec + ${LEATHER_SHEEN.rim.toFixed(3)} * lRim );
	}
	#include <opaque_fragment>`;

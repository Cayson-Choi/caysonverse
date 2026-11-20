import { BufferGeometry, Float32BufferAttribute, Mesh, ShaderMaterial, Vector3 } from "three";

/** Isolates the coals and original flame cards from other fixtures sharing the baked room's lamp material. */
export interface HearthBox {
  min: readonly [number, number, number];
  max: readonly [number, number, number];
}

export const HOUSE_HEARTHS: Readonly<Record<number, HearthBox>> = {
  1: { min: [361.52, 0.05, -7.75], max: [363.28, 1.05, -7.0] },
  2: { min: [392.42, 0.05, -7.75], max: [394.18, 1.05, -7.0] },
  7: { min: [504.04, 0.05, -3.08], max: [505.0, 1.05, -1.32] },
  10: { min: [576.0, 0.05, -6.93], max: [577.25, 1.05, -4.87] },
};

/** The hearth box uniforms shared by every patched lamp material: an empty box (min > max) when the house has no fireplace. */
export const houseHearthMin = { value: new Vector3(1, 1, 1) };
export const houseHearthMax = { value: new Vector3(0, 0, 0) };
export const houseFireTime = { value: 0 };
/** Centre of the glowing ember bed and the direction its log faces in the four exported rooms. */
const EMBERS: Readonly<Record<number, readonly [number, number, number, number]>> = {
  1: [362.40, 0.18, -7.44, 0], 2: [393.30, 0.18, -7.44, 0],
  7: [504.35, 0.18, -2.20, Math.PI / 2], 10: [576.31, 0.26, -5.90, Math.PI / 2],
};
export const houseEmberY = { value: 0 };

export function setHouseHearth(n: number): void {
  const b = HOUSE_HEARTHS[n];
  if (b) {
    houseEmberY.value = EMBERS[n]![1];
    houseHearthMin.value.set(...b.min);
    houseHearthMax.value.set(...b.max);
  } else {
    houseHearthMin.value.set(1, 1, 1);
    houseHearthMax.value.set(0, 0, 0);
  }
}

export const FLAME_GLSL = /* glsl */ `
	if ( all( greaterThanEqual( vHouseWorld, uHearthMin ) ) && all( lessThanEqual( vHouseWorld, uHearthMax ) ) ) {
		if (vHouseWorld.y > uEmberY + 0.01) discard; // the old triangular cards above the grate
		vec2 p = (vHouseWorld.xz - uHearthMin.xz) * 64.0;
		float coal = 0.5 + 0.5 * sin(p.x + 0.7 * sin(p.y)) * cos(p.y * 1.3);
		float glow = smoothstep(0.28, 0.84, coal + 0.08 * sin(uHouseFireTime * 2.6 + p.x));
		diffuseColor.rgb = mix(vec3(0.08, 0.012, 0.003), vec3(1.8, 0.29, 0.014), glow);
	}`;

/** Tapered, curved flame volumes over the coals; each tongue has its own depth, lean and flicker phase. */
export function hearthFlames(n: number) {
  const bed = EMBERS[n];
  if (!bed) return null;
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  const rings = [[0, 0.43], [0.17, 1], [0.46, 0.78], [0.73, 0.39], [1, 0.016]] as const;
  const sides = 8;
  const tongues = [
    [-0.158, 0.028, 0.23, 0.054, 0.035], [-0.085, -0.032, 0.295, 0.055, -0.025],
    [-0.026, 0.017, 0.36, 0.061, 0.034], [0.039, -0.044, 0.25, 0.055, 0.047],
    [0.095, 0.035, 0.19, 0.050, -0.028], [0.156, -0.013, 0.28, 0.048, 0.033],
  ] as const;
  for (const [phase, [x, z, height, radius, lean]] of tongues.entries()) {
    const start = positions.length / 3;
    for (const [j, [t, width]] of rings.entries()) {
      for (let i = 0; i < sides; i++) {
        const a = 2 * Math.PI * i / sides;
        positions.push(x + lean * t * t + Math.cos(a) * radius * width, height * t,
          z + 0.018 * Math.sin(t * 4 + phase) * t + Math.sin(a) * radius * width * 0.74);
        uvs.push(t, phase * 2.4);
        if (j === 0) continue;
        const index = start + j * sides + i, next = start + j * sides + (i + 1) % sides;
        indices.push(index - sides, index, next, index - sides, next, next - sides);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mat = new ShaderMaterial({
    uniforms: { uTime: houseFireTime }, transparent: true, depthWrite: false,
    vertexShader: `
      uniform float uTime;
      varying float t, facing;
      void main() {
        t = uv.x;
        vec3 p = position;
        p.x += t*t * (0.023*sin(4.8*uTime + uv.y) + 0.010*sin(8.9*uTime + t*5.0));
        p.y *= 1.0 + 0.08*t*sin(6.2*uTime + uv.y);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        facing = abs(dot(normalize(normalMatrix*normal), normalize(-mv.xyz)));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying float t, facing;
      void main() {
        float hot = (1.0-t) * (0.35 + 0.65*facing);
        vec3 tint = mix(vec3(1.35, 0.12, 0.012), vec3(3.2, 1.85, 0.39), smoothstep(0.12, 0.84, hot));
        float alpha = (0.10 + 0.82*smoothstep(0.03, 0.65, facing)) * (1.0-smoothstep(0.68, 1.0, t));
        gl_FragColor = vec4(tint, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new Mesh(geometry, mat);
  mesh.name = "hearth_flames";
  mesh.position.set(bed[0], bed[1], bed[2]);
  mesh.rotation.y = bed[3];
  mesh.raycast = () => {};
  return mesh;
}

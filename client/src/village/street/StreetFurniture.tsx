import { Suspense, useEffect, useLayoutEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import {
  Frustum,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3,
  type BufferGeometry,
  type Material,
  type Object3D,
  type Texture,
} from "three";
import { litUniform, type VillageTier } from "../villageModelPrep";
import { InstanceCuller } from "../instanceCull";
import { versionedUrl } from "../modelUrl";
import { BANNER_POLES, BANNER_POLE_LIGHT_Y, LAMP_MODEL_LIGHT_Y, LAMP_POSTS, bannerSlot, BANNER_ATLAS } from "./streetLayout";
import { bannerFabricGeometry, bannerHardwareGeometry, lampPostGeometry, lanternGlassGeometry } from "./streetGeometry";
import { fabricMaterial, glassMaterial, metalMaterial, metalTextures, poolMaterial, poolTexture, setGlassLit, streetTime, weaveTexture } from "./streetMaterials";
import { trimOldStreetFurniture, type StreetTrimStats } from "./streetTrim";

/** The banners' print atlas (tools/banners): 1536 px on the rich tier, 1024 px on the light one. */
export const STREET_BANNERS_URL = versionedUrl("/models/village/street_banners.webp");
export const STREET_BANNERS_1K_URL = versionedUrl("/models/village/street_banners_1k.webp");

/** The paving's height under the banner poles (m): the night pools lie just over it. */
const POOL_Y = 0.07;
const POOL_SIZE = 7;
const BANNER_POLE_LIFT = BANNER_POLE_LIGHT_Y - LAMP_MODEL_LIGHT_Y;

declare global {
  interface Window {
    /** Dev-only: the street furniture's numbers (draw calls, instances, what the trim took out of the village). */
    __cvStreet?: () => { trim: StreetTrimStats; drawCalls: number; postsDrawn?: number; instances: Record<string, number> };
  }
}

const noRaycast = (): void => {};

function instanced(geometry: BufferGeometry, material: Material, matrices: Matrix4[], name: string): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, matrices.length);
  matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.name = name;
  mesh.raycast = noRaycast; // decoration: never takes a click or the camera's ray
  mesh.frustumCulled = false; // spread over the whole village and raised by `aLift` (the instances' sphere misses that)
  mesh.matrixAutoUpdate = false;
  return mesh;
}

const at = (x: number, z: number, yaw: number, y = 0): Matrix4 =>
  new Matrix4().compose(new Vector3(x, y, z), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw), new Vector3(1, 1, 1));

/**
 * 케이슨 마을's lamp posts and street banners (streetLayout.ts): takes the baked ones out of the village clone and draws
 * the new ones in their places — the posts (25: 15 plaza and ring, 2 lane, 8 banner poles) and their lantern glass, the
 * banner arms, the 16 banners and the banner poles' night pools: five draw calls in all.
 */
export function StreetFurniture({ root, tier }: { root: Object3D; tier: VillageTier }) {
  const trim = useMemo(() => ({ stats: { meshes: 0, trianglesRemoved: 0 } as StreetTrimStats }), []);
  useLayoutEffect(() => {
    const t = trimOldStreetFurniture(root);
    trim.stats = t.stats;
    return () => t.restore();
  }, [root, trim]);

  const posts = useMemo(() => {
    const tex = metalTextures();
    const metal = metalMaterial(tex);
    const glass = glassMaterial();
    const all = [
      ...LAMP_POSTS.map((p) => ({ m: at(p.x, p.z, p.yaw), lift: p.lightY - LAMP_MODEL_LIGHT_Y })),
      ...BANNER_POLES.map((p) => ({ m: at(p.x, p.z, p.yaw), lift: BANNER_POLE_LIFT })),
    ];
    const lifts = new InstancedBufferAttribute(new Float32Array(all.map((a) => a.lift)), 1);
    const postGeo = lampPostGeometry();
    postGeo.setAttribute("aLift", lifts);
    const glassGeo = lanternGlassGeometry();
    glassGeo.setAttribute("aLift", lifts);
    const hwGeo = bannerHardwareGeometry(BANNER_POLE_LIFT);
    hwGeo.setAttribute("aLift", new InstancedBufferAttribute(new Float32Array(BANNER_POLES.length), 1));
    const matrices = all.map((a) => a.m);
    const postMesh = instanced(postGeo, metal, matrices, "street_lamp_posts");
    const glassMesh = instanced(glassGeo, glass, matrices, "street_lamp_glass");
    // three culls an instanced set as one: the posts (3.7k triangles each, spread over the village) are repacked to the ones in view
    const heights = [...LAMP_POSTS.map((p) => p.lightY), ...BANNER_POLES.map(() => BANNER_POLE_LIGHT_Y)];
    const culler = new InstanceCuller(
      [postMesh, glassMesh],
      [[lifts], []],
      {
        spheres: all.map((a, i) => {
          const h = heights[i]! + 0.8;
          return [a.m.elements[12]!, h / 2, a.m.elements[14]!, h / 2 + 0.6] as const;
        }),
      },
    );
    const hwMesh = instanced(hwGeo, metal, BANNER_POLES.map((p) => at(p.x, p.z, p.yaw)), "street_banner_arms");
    const pMap = poolTexture();
    const pool = poolMaterial(pMap);
    const poolGeo = new PlaneGeometry(POOL_SIZE, POOL_SIZE).rotateX(-Math.PI / 2);
    const poolMesh = instanced(poolGeo, pool, BANNER_POLES.map((p) => at(p.x, p.z, 0, POOL_Y)), "street_banner_pools");
    poolMesh.renderOrder = 2;
    return {
      meshes: [postMesh, glassMesh, hwMesh, poolMesh],
      culler,
      glass,
      pool,
      dispose() {
        for (const g of [postGeo, glassGeo, hwGeo, poolGeo]) g.dispose();
        for (const m of [metal, glass, pool]) m.dispose();
        for (const t of [tex.detail, tex.color, pMap]) t.dispose();
      },
    };
  }, []);
  useEffect(() => () => posts.dispose(), [posts]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    window.__cvStreet = () => ({
      trim: trim.stats,
      drawCalls: 5,
      postsDrawn: posts.culler.drawn,
      instances: { posts: LAMP_POSTS.length + BANNER_POLES.length, arms: BANNER_POLES.length, banners: BANNER_POLES.length * 2, pools: BANNER_POLES.length },
    });
    return () => {
      delete window.__cvStreet;
    };
  }, [trim]);

  const view = useMemo(() => ({ frustum: new Frustum(), m: new Matrix4() }), []);
  useFrame(({ camera }, delta) => {
    streetTime.value += Math.min(delta, 0.1);
    // the posts in view only (a lamp 3 m behind the camera is still drawn: its sphere's reach is its height)
    view.m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    view.frustum.setFromProjectionMatrix(view.m);
    posts.culler.update(view.frustum, camera.position);
    const lit = litUniform.value;
    setGlassLit(posts.glass, lit);
    posts.pool.opacity = 0.42 * lit;
    posts.meshes[3]!.visible = lit > 0.01;
  });

  return (
    <group name="village-street-furniture">
      {posts.meshes.map((m) => (
        <primitive key={m.name} object={m} dispose={null} />
      ))}
      {/* the banners wait for their print; the posts never do */}
      <Suspense fallback={null}>
        <Banners url={tier === "high" ? STREET_BANNERS_URL : STREET_BANNERS_1K_URL} maxAnisotropy={tier === "high" ? 8 : 4} />
      </Suspense>
    </group>
  );
}

function Banners({ url, maxAnisotropy }: { url: string; maxAnisotropy: number }) {
  const print = useTexture(url) as Texture;
  const banners = useMemo(() => {
    print.colorSpace = SRGBColorSpace;
    print.anisotropy = maxAnisotropy;
    print.needsUpdate = true;
    const weave = weaveTexture();
    const material = fabricMaterial(print, weave);
    const geometry = bannerFabricGeometry();
    const matrices: Matrix4[] = [];
    const slots: number[] = [];
    const phases: number[] = [];
    BANNER_POLES.forEach((p, i) => {
      for (const side of [-1, 1] as const) {
        // the model hangs on +x; the -x banner is the same turned half round (its back face, printed the right way, faces the plaza)
        matrices.push(at(p.x, p.z, side === 1 ? p.yaw : p.yaw + Math.PI));
        const { col, row } = bannerSlot(p.theme, side);
        slots.push(col / BANNER_ATLAS.cols, 1 - (row + 1) / BANNER_ATLAS.rows);
        phases.push(i * 1.7 + (side === 1 ? 0 : 2.3));
      }
    });
    geometry.setAttribute("aSlot", new InstancedBufferAttribute(new Float32Array(slots), 2));
    geometry.setAttribute("aPhase", new InstancedBufferAttribute(new Float32Array(phases), 1));
    geometry.setAttribute("aLift", new InstancedBufferAttribute(new Float32Array(matrices.length), 1));
    geometry.setAttribute("liftW", new InstancedBufferAttribute(new Float32Array(matrices.length), 1));
    const mesh = instanced(geometry, material, matrices, "street_banners");
    return {
      mesh,
      dispose() {
        geometry.dispose();
        material.dispose();
        weave.dispose();
      },
    };
  }, [print, maxAnisotropy]);
  useEffect(() => () => banners.dispose(), [banners]);
  return <primitive object={banners.mesh} dispose={null} />;
}

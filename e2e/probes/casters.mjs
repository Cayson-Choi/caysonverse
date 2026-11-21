/**
 * Which shadow casters draw on a face: lists the casting meshes in a box, then photographs one view with each named group's shadow switched
 * off in turn (the photo camera nudged so the shadow maps redraw).
 *   node e2e/probe.mjs e2e/probes/casters.mjs <out> desktop <time> -- x0,x1,z0,z1 camx,camy,camz lookx,looky,lookz fov name1,name2,...
 */
export default async ({ P, args, hideHud, cam, shot, sleep }) => {
  const [boxS, camS, lookS, fovS, namesS = ""] = args;
  const box = boxS.split(",").map(Number);
  const c = camS.split(",").map(Number);
  const l = lookS.split(",").map(Number);
  await hideHud(true);
  await cam([-24, 2.2, 78], [-24, 4, 94], 55);
  await sleep(9000);
  const list = await P.page.evaluate((box) => {
    const { scene } = window.__cvThree();
    const out = [];
    const V = scene.position.constructor;
    scene.traverse((o) => {
      if (!o.isMesh || !o.castShadow) return;
      for (let q = o; q; q = q.parent) if (!q.visible) return;
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      const p = o.geometry.boundingSphere.center.clone().applyMatrix4(o.matrixWorld);
      if (p.x < box[0] || p.x > box[1] || p.z < box[2] || p.z > box[3]) return;
      const names = [];
      for (let q = o; q && names.length < 3; q = q.parent) if (q.name) names.push(q.name);
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      out.push(`${names.join("<")} | ${m?.name} | r ${o.geometry.boundingSphere.radius.toFixed(1)} at ${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)}${o.isInstancedMesh ? " inst " + o.count : ""}`);
      void V;
    });
    return out;
  }, box);
  for (const r of list) console.log("CASTER", r);
  const snap = async (tag) => {
    for (const d of [0.03, 0]) {
      await cam([c[0] + d, c[1], c[2]], l, Number(fovS));
      await sleep(1500);
    }
    await shot(`casters-${tag}`);
  };
  await snap("all");
  for (const name of namesS.split(",").filter(Boolean)) {
    const n = await P.page.evaluate((name) => {
      const { scene } = window.__cvThree();
      let k = 0;
      scene.traverse((o) => {
        if (!o.isMesh || !o.castShadow) return;
        const m = Array.isArray(o.material) ? o.material[0] : o.material;
        let hit = false;
        for (let q = o; q; q = q.parent) if (q.name && q.name.includes(name)) hit = true;
        if (m?.name?.includes(name)) hit = true;
        if (hit) { o.castShadow = false; k++; }
      });
      return k;
    }, name);
    console.log("off", name, n);
    await snap(`no-${name}`);
  }
};

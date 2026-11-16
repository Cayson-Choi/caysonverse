// keyframes.mjs - renders every fishing clip at key times with the real rod/net/fish on the real character (side + front views).
//   node art/lake/tools/viewer/keyframes.mjs <outDir> [clipName]
import { open, sheet } from "./render.mjs";
const outDir = process.argv[2] || "art/lake/work/handfit";
const only = process.argv[3];
const FISH = process.env.FISH || "carp";
const T = {
  Fish_Sit_Idle: { ts: [0, 1.0, 1.85, 2.5], rod: "ext", bend: "idle" },
  Fish_Sit_Cast: { ts: [0.25, 0.375, 0.54, 0.67], rod: "ext" },
  Fish_Sit_Strike: { ts: [0.1, 0.19, 0.3, 0.41], rod: "ext", bend: "idle" },
  Fish_Sit_Fight: { ts: [0.0, 0.42, 0.67, 1.0], rod: "ext", bend: "fight" },
  Fish_Sit_Lift: { ts: [0.33, 0.54, 0.75, 1.0], rod: "ext", bend: "idle", fish: { sp: FISH, cm: 30, mode: "lift" }, fishFrom: 2 },
  Fish_Net: { ts: [0.0, 0.375, 0.58, 0.83, 1.04, 1.2], rod: "ext", net: true },
  Fish_Stand_Show: { ts: [0.3, 0.8, 1.4, 2.0], rod: null, fish: { sp: FISH, cm: 60, mode: "show" }, tgt: [0, 1.0, 0.2] },
  Fish_Release: { ts: [0, 0.29, 0.46, 0.79], rod: null, fish: { sp: FISH, cm: 40, mode: "show" }, tgt: [0, 0.9, 0.2] },
  Carry_Rod: { ts: [0, 0.35, 0.7, 1.0], rod: "fold", base: "Walking_A" },
};
const { page, close } = await open(process.env.QUERY || "");
for (const [clip, d] of Object.entries(T)) {
  if (only && only !== clip) continue;
  const frames = [];
  for (const [vi, view] of ["side", "front"].entries()) {
    for (const [ti, t] of d.ts.entries()) {
      const gear = {}; if (d.rod) { gear.rod = d.rod; if (d.bend) gear.bend = d.bend; } if (d.net) gear.net = true;
      const fish = d.fish && (d.fishFrom === undefined || ti >= d.fishFrom) ? d.fish : undefined;
      const sit = clip.startsWith("Fish_Sit") || clip === "Fish_Net";
      frames.push({ label: `${clip} t=${t}s ${view}`, cfg: { clip, t, base: d.base, baseT: d.base ? t : 0, gear, fish, view, dist: sit ? 5.2 : 4.4, target: d.tgt || [0, sit ? 1.2 : 1.05, sit ? 0.5 : 0] } });
    }
  }
  await sheet(page, { out: `${outDir}/${clip}.png`, W: 440, H: 460, cols: d.ts.length, frames });
}
await close();

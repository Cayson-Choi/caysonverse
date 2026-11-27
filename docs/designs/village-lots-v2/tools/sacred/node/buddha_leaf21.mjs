/** Broad gold and warm bounce over the bilateral nose casting.
 * Each knot stores RGB log gains in units of 1/256. Its 7.5 mm spacing
 * preserves the broad turn seen in both registered views.
 */
import fs from 'node:fs';

const field = JSON.parse(fs.readFileSync(new URL('./buddha_gilt21.json', import.meta.url), 'utf8'));

function splineAxis(value, origin, count) {
  const t = Math.max(1, Math.min(count - 2.01, (value - origin) / field.spacing));
  const center = Math.floor(t + 0.5);
  const fraction = t - center;
  return {
    first: center - 1,
    weights: [0.5 * (0.5 - fraction) ** 2, 0.75 - fraction ** 2, 0.5 * (0.5 + fraction) ** 2],
  };
}

export function giltRGBGain([x, y, z], tier) {
  const lateral = Math.abs(x);
  const u = splineAxis(60 * lateral / z, field.origin[0], field.width);
  const v = splineAxis(60 * y / z, field.origin[1], field.height);
  const lattice = field.tiers[tier];
  const gain = [0, 0, 0];
  for (let j = 0; j < 3; j++) {
    const row = lattice[v.first + j];
    for (let i = 0; i < 3; i++) {
      const knot = row[u.first + i];
      const weight = u.weights[i] * v.weights[j] / 256;
      for (let channel = 0; channel < gain.length; channel++) gain[channel] += weight * knot[channel];
    }
  }

  return gain.map(Math.exp);
}

/** Engraved globe albedo, equirectangular. Inputs: Natural Earth 1:110m land and rivers, public domain.
 * node b1_globe_map.mjs ne_110m_land.geojson ne_110m_rivers_lake_centerlines.geojson globe.png
 * Encode the result with png2ktx2.mjs. The globe's UV seam and this map's edges are the antimeridian.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const requireArt = createRequire(new URL("../../../../art/materials/tools/package.json", import.meta.url));
const sharp = requireArt("sharp");
const [landFile, riversFile, output] = process.argv.slice(2);
const features = (file) => JSON.parse(readFileSync(file, "utf8")).features;
const line = (points) => points.map(([lon, lat], i) =>
  `${i ? "L" : "M"}${((lon + 180) * 1024 / 360).toFixed(2)} ${((90 - lat) * 512 / 180).toFixed(2)}`,
).join("");
const land = features(landFile).flatMap(({ geometry: g }) => {
  const polygons = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  return polygons.map((poly) => poly.map((ring) => line(ring) + "Z").join(""));
}).join("");
const rivers = features(riversFile).flatMap(({ geometry: g }) =>
  (g.type === "LineString" ? [g.coordinates] : g.coordinates).map(line),
).join("");
const grid = [];
for (let lon = -180; lon <= 180; lon += 15) grid.push(line([[lon, -90], [lon, 90]]));
for (let lat = -75; lat < 90; lat += 15) grid.push(line([[-180, lat], [180, lat]]));
const circles = [-66.56, -23.44, 23.44, 66.56].map((lat) => line([[-180, lat], [180, lat]])).join("");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1024" height="512">
  <defs>
    <linearGradient id="sea" x2="0" y2="1" gradientUnits="objectBoundingBox">
      <stop stop-color="#a3bdba"/><stop offset=".45" stop-color="#6e9eaa"/><stop offset="1" stop-color="#acc1b9"/>
    </linearGradient>
    <linearGradient id="land" x2="0" y2="1" gradientUnits="objectBoundingBox">
      <stop stop-color="#d4c9a0"/><stop offset=".38" stop-color="#c6c38e"/><stop offset=".7" stop-color="#c0b580"/><stop offset="1" stop-color="#e4dbc0"/>
    </linearGradient>
    <path id="coasts" d="${land}" fill-rule="evenodd" stroke-linejoin="round"/>
  </defs>
  <rect width="1024" height="512" fill="url(#sea)"/>
  <use xlink:href="#coasts" fill="none" stroke="#a8c0b6" stroke-width="6"/>
  <use xlink:href="#coasts" fill="none" stroke="#83a6a3" stroke-width="4.3"/>
  <use xlink:href="#coasts" fill="none" stroke="#adc3b6" stroke-width="3.5"/>
  <use xlink:href="#coasts" fill="url(#land)" stroke="#6b705a" stroke-width="1.1"/>
  <path d="${rivers}" fill="none" stroke="#788e86" stroke-width=".8" />
  <path d="${grid.join("")}" fill="none" stroke="#435655" stroke-width=".65" opacity=".65"/>
  <path d="${circles}" fill="none" stroke="#755d42" stroke-width=".65" stroke-dasharray="2.2 1.7" opacity=".8"/>
  <path d="M0 256H1024" stroke="#8d6747" stroke-width="1.2"/>
</svg>`;
await sharp(Buffer.from(svg)).png().toFile(output);

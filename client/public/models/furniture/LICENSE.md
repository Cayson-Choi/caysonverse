# Furniture model assets

These furniture models are from the **Kenney Furniture Kit (2.0)** by
**Kenney** (kenney.nl).

- License: **CC0 1.0 Universal** (public domain dedication) — free for personal,
  educational and commercial use; crediting Kenney is appreciated but not
  required. https://creativecommons.org/publicdomain/zero/1.0/
- Source: https://kenney.nl/assets/furniture-kit
  (download: `kenney_furniture-kit.zip`, `Models/GLTF format/` — self-contained
  GLB, no external `.bin`/textures)
- Author site: https://kenney.nl/

Only the models actually placed in the world map are committed here (9 of the
kit's 140), copied verbatim from the kit's `Models/GLTF format/` folder:

| File                     | Used for                                   |
| ------------------------ | ------------------------------------------ |
| `loungeSofa.glb`         | Lounge sofas (incl. the E2E collision test)|
| `loungeSofaLong.glb`     | Long lounge sofa against the west wall     |
| `tableCoffee.glb`        | Lounge coffee table                        |
| `rugRectangle.glb`       | Lounge rug (decorative, no collision)      |
| `pottedPlant.glb`        | Corner + doorway greenery                  |
| `lampSquareFloor.glb`    | Lounge floor lamp (decorative, no collision)|
| `desk.glb`               | Student desks + instructor desk            |
| `chairDesk.glb`          | Student chairs + instructor chair          |
| `bookcaseClosedWide.glb` | Lecture-hall bookcases                      |

Placements, per-model footprints and the uniform up-scale live in
`shared/src/worldMap.ts` (the single source of map + collision truth). The kit
models are ~half life-size, so the map applies a uniform `FURNITURE_SCALE`.

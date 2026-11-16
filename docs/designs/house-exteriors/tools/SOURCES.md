# House body kit (X1) — texture sources and licences

All scans are CC0 (public domain); the downloads stay in `art/village/downloads/tex_x1/` (git-ignored, private assets repo).
`make_house_textures.py` turns them into the WebP sets in `client/public/models/village/houses/`.

| Set (contract 6) | Material | Source | Licence | Taken 2026-11-16 |
|---|---|---|---|---|
| render (stucco / drivit) | LM_render | ambientCG **Plaster001** 2K-JPG — https://ambientcg.com/a/Plaster001 | CC0 1.0 | Color, NormalGL, Roughness |
| granite | LM_stone | ambientCG **Granite005A** 2K-JPG — https://ambientcg.com/a/Granite005A | CC0 1.0 | Color, NormalGL (+ procedural honed pitting) |
| shingle (3-tab asphalt) | LM_roof | procedural (numpy, `set_shingle`) — no third-party pixels | — | granules, tabs, keyways, course shadow |
| oak | LM_wood (top band) | Poly Haven **oak_veneer_01** 2k — https://polyhaven.com/a/oak_veneer_01 | CC0 1.0 | diff, nor_gl, rough |
| timber_cladding | LM_wood (bottom band) | Poly Haven **japanese_cedar_planks** 2k — https://polyhaven.com/a/japanese_cedar_planks | CC0 1.0 | diff, nor_gl, rough |
| metal_painted | LM_metal (top band) | ambientCG **Metal027** 2K-JPG — https://ambientcg.com/a/Metal027 | CC0 1.0 | Color, NormalGL, Roughness |
| pvc_frame | LM_metal (bottom band) | ambientCG **Plastic013A** 2K-JPG — https://ambientcg.com/a/Plastic013A | CC0 1.0 | Color, NormalGL, Roughness |

The reference photos the look was judged against (Korean countryside houses) are other people's photos: they stay in
`art/village/refs/exterior/` with their `SOURCES.txt` and are never committed.

## X2 porch kit (2026-11-17)
No new texture sets (the seven sets are at the 3 MB budget): the porch, steps, beds, deck, bench, LPG, mailbox and garden reuse
the sets above, tinted per part. The flower / vegetable cards use the village's own procedural `T_flora` atlas
(`docs/handoff/art-tools/make_textures.py`, no third-party pixels) through village.glb's `M_leaf_flora`. The porch reference
photos (other people's) stay in `art/village/refs/exterior_x2/` with their `SOURCES.txt`, never committed.

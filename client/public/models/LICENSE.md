# Character model assets

These character models are from the **KayKit Adventurers Character Pack (v1.0)**
by **Kay Lousberg** (KayKit).

- License: **CC0 1.0 Universal** (public domain dedication) — no attribution
  required, but credited here as a courtesy.
- Source: https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0
  (files: `addons/kaykit_character_pack_adventures/Characters/gltf/{Knight,Barbarian,Mage,Rogue}.glb`)
- Author site: https://kaylousberg.com/

| File            | Source file (repo) | Preset label |
| --------------- | ------------------ | ------------ |
| `knight.glb`    | `Knight.glb`       | 기사         |
| `barbarian.glb` | `Barbarian.glb`    | 바바리안     |
| `mage.glb`      | `Mage.glb`         | 마법사       |
| `rogue.glb`     | `Rogue.glb`        | 도적         |

Each model embeds 76 animation clips on a shared skeleton; this project uses
`Idle`, `Walking_A`, and the `Sit_Chair_*` trio.

## Crown accessory

The royal characters (왕/왕비/공주/왕자, v2 Task 2) are COMPOSED — no new bodies.
They reuse the four bodies above (accessories hidden) with a crown attached to the
`head` bone.

- File: `crown.glb`
- Model: **"Crown"** by **Quaternius**
- License: **CC0 1.0 Universal** (public domain dedication)
- Source: https://poly.pizza/m/i0PZVuVlYv
  (direct GLB: https://static.poly.pizza/1381b02a-8310-437b-a2a7-82cab0a94a4c.glb)

Single mesh `Crown2` with two untextured materials (`Gold`, `Red`); never tinted
(attached after the body's multiply-tint so it keeps its own gold/gem colors).

"""B3 (lots v2: 마을 절) — the layout of the `dancheong_wood` PBR set (a painted atlas, not a tiling texture), shared by the
painter (temple_dancheong.py) and the kits (temple_kit.py, temple_room_kit.py). Pure python, no deps.

The set's `tileMeters` is 1 and `process.atlas` keeps its edges as painted: one UV unit = the whole atlas, so a part maps
straight into a region with explicit UVs (Blender convention: v up from the image's bottom row; the glTF export flips v and
three samples with flipY off, so both renderers read the same texel). Regions are (u0, v0, u1, v1).

Bands run the full width (u 0..1 = a member's length, the end motif at u 0 and mirrored at u 1):
  beam_a      머리초 beam, 녹청 field with a small brocade (창방, 평방, 도리, 일주문 beams)
  beam_b      머리초 beam, 삼청/군청 field (대들보, 종보 inside the hall; 범종각)
  rafter      서까래 side (양록 field, 휘 band at the eaves end u 0)
  buyeon      부연 side (삼청 field, 휘 band at u 0)
  column_head 주의초 (hanging lotus pendants) over 석간주, repeats 4x along u (round a column)
  paint       neutral off-white paint over wood grain: tinted with COLOR_0 (석간주 columns, 뇌록 boards, 주칠 frames)
Tiles (0.25 square):
  rafter_end  서까래 마구리 연화 rosette (1/8)  buyeon_end  부연 마구리 매화점 (1/8)   hanji  창호지 (1/4 x 1/8)
  kkotsal     빗꽃살 lattice (raised, paper behind)
  coffer      우물반자 연화 panel                bracket     공포 첨차 face (초엽 scrolls)
  sumidan     수미단 carved peony panel (relief)  cloud       운문 (닫집, 포벽)
  gold_scroll 금단청 vine on red lacquer (gold)  lotus_paper 연등 lotus-petal paper
"""

ATLAS_PX = 2048

BANDS = {
    "beam_a": (0.0, 0.40, 1.0, 0.50),
    "beam_b": (0.0, 0.30, 1.0, 0.40),
    "rafter": (0.0, 0.24, 1.0, 0.30),
    "buyeon": (0.0, 0.18, 1.0, 0.24),
    "column_head": (0.0, 0.12, 1.0, 0.18),
    "paint": (0.0, 0.0, 1.0, 0.12),
}

_TILES = ["small", "kkotsal", "coffer", "bracket", "sumidan", "cloud", "gold_scroll", "lotus_paper"]
TILES = {name: ((i % 4) * 0.25, 0.5 + (i // 4) * 0.25, (i % 4) * 0.25 + 0.25, 0.5 + (i // 4) * 0.25 + 0.25) for i, name in enumerate(_TILES)}
# the first tile slot holds three small ones: the two eave ends (bottom half) and plain 창호지 paper (top half)
TILES["rafter_end"] = (0.0, 0.5, 0.125, 0.625)
TILES["buyeon_end"] = (0.125, 0.5, 0.25, 0.625)
TILES["hanji"] = (0.0, 0.625, 0.25, 0.75)
del TILES["small"]

REGIONS = dict(BANDS)
REGIONS.update(TILES)

PAD = 3.0 / ATLAS_PX  # keep samples off a region's edge (mip bleed)


def ruv(region, s, t):
    """A point (s, t) in 0..1 of a region -> atlas UV (padded)."""
    u0, v0, u1, v1 = REGIONS[region]
    s = min(max(s, 0.0), 1.0)
    t = min(max(t, 0.0), 1.0)
    return (u0 + PAD + (u1 - u0 - 2 * PAD) * s, v0 + PAD + (v1 - v0 - 2 * PAD) * t)

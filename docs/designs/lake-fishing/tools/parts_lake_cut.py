"""What the village must stop building where the fishing lake (art/lake, lake.glb) takes over (design 11.2, 11.3).

Pure Python (no Blender) so parts_nature.py / parts_fill.py / build_village.py can call it with three lines each when the
village is next re-baked. The lake's own terrain covers exactly these rectangles; its seam vertices are the village's own
(ground_h / terrain_h samples on the grid lines below), so nothing else changes.

  hole 1  ground_outer (build_village.build_ground, 2.5 m grid, lines -112 + 2.5 k): every cell inside
          x >= 95.5, -69.5 <= z <= 45.5   (cell corners are grid lines, the cut is clean)
  hole 2  backdrop_near (parts_nature.backdrop, 7 m grid up to |x| 150, then 12 m): every cell inside
          112 <= x <= 190, -70 <= z <= 49   (190, -70 and 49 are lines of that grid; 112 is the ground grid's edge)
  disc    the old backdrop lake: parts_nature.backdrop()'s `disc(lc.x, lc.z, ...)` call (backdrop_water) and the
          `lake_pavilion` + `lake_pier` objects stop being built
  forest  parts_fill.fill()'s backdrop forest (far_*): no trees inside HOLE_FOREST, and the lake basin of
          parts_nature.terrain_h (`lake_d`) is no longer needed beyond the hole (it only shapes meadow, keep it)

Usage in the village scripts (when re-baking):
    import parts_lake_cut as LC
    # build_village.build_ground: `if LC.in_ground_hole(xs[i], xs[i+1], zs[j], zs[j+1]): continue`
    # parts_nature.backdrop:      `if LC.in_backdrop_hole(x0, x1, z0, z1): continue` (before near.face / far.face),
    #                             `if not LC.skip_lake_disc(): disc(...)`, `if not LC.skip_lake_pavilion(): ...`
    # parts_fill.fill (far forest): `if LC.far_forest_exclusion(x, z): continue`
"""

# The lake zone: design 2.2 (lakeLayout.ts LAKE_AREA) and the village backdrop grid lines it is rounded out to.
GROUND_HOLE = {"minX": 95.5, "maxX": 112.0, "minZ": -69.5, "maxZ": 45.5}
BACKDROP_HOLE = {"minX": 112.0, "maxX": 190.0, "minZ": -70.0, "maxZ": 49.0}
EPS = 1e-6


def lake_hole_rect():
    """The two rectangles the village leaves open for lake.glb (ground_outer's, backdrop_near's)."""
    return {"ground": dict(GROUND_HOLE), "backdrop": dict(BACKDROP_HOLE)}


def _inside(r, x0, x1, z0, z1):
    return x0 >= r["minX"] - EPS and x1 <= r["maxX"] + EPS and z0 >= r["minZ"] - EPS and z1 <= r["maxZ"] + EPS


def in_ground_hole(x0, x1, z0, z1):
    """True for a ground_outer grid cell that lies entirely inside the first hole (do not build it)."""
    r = GROUND_HOLE
    # the ground grid ends at x = 110.5 (-112 + 2.5 * 89): a cell reaching past 112 does not exist, so test the part that does
    return x0 >= r["minX"] - EPS and x1 <= r["maxX"] + EPS and z0 >= r["minZ"] - EPS and z1 <= r["maxZ"] + EPS


def in_backdrop_hole(x0, x1, z0, z1):
    """True for a backdrop_near / backdrop_far grid cell inside the second hole (do not build it)."""
    return _inside(BACKDROP_HOLE, x0, x1, z0, z1)


def skip_lake_disc():
    """True: parts_nature.backdrop() must not add the old lake disc (`disc(lc.x, lc.z, ...)`) to backdrop_water. The plunge
    pool (`disc(fx + 7, fz, ...)`) and the feeder stream stay (they are the waterfall's, outside the holes)."""
    return True


def skip_lake_pavilion():
    """True: parts_nature.backdrop() must not build `lake_pavilion` and `lake_pier` (the lake's pavilion is lake.glb's)."""
    return True


# Trees of the backdrop forest (parts_fill.fill): none inside the lake zone plus a 6 m margin (the lake brings its own).
HOLE_FOREST = {"minX": 95.5 - 6.0, "maxX": 190.0 + 6.0, "minZ": -70.0 - 6.0, "maxZ": 49.0 + 6.0}


def far_forest_exclusion(x, z):
    """True when a backdrop tree at (x, z) must be skipped."""
    r = HOLE_FOREST
    return r["minX"] <= x <= r["maxX"] and r["minZ"] <= z <= r["maxZ"]

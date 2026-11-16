"""print triangle counts of kit pieces (blender -b --factory-startup -P hb_measure.py)"""
import math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
import kit_core as K, kit_shell as SH, kit_seating as SE, kit_tables as TA, kit_decor as DE, kit_beds as BE, kit_storage as ST, kit_kitchen as KI
import hb_pieces
def count(name, fn, **kw):
    K.begin(name)
    fn(K.Frame(0, 0, 0, 0), **kw)
    ob = K.end(None, link=False)
    print("TRIS %-24s %6d" % (name, K.tri_count(ob)))
for n, fn, kw in [("bookwall3.6", ST.bookwall, dict(w=3.6)), ("bookwall_lite3.6", hb_pieces.bookwall_lite, dict(w=3.6)), ("bookwall_lite3.6_lad", hb_pieces.bookwall_lite, dict(w=3.6, ladder=True)), ("bookcase1", ST.bookcase, {}), ("sofa_fabric", SE.sofa_fabric, {}), ("sofa_leather", SE.sofa_leather, {}),
    ("armchair_reading", SE.armchair_reading, {}), ("chair_desk", SE.chair_desk, {}), ("chair_dining_wood", SE.chair_dining_wood, {}), ("ottoman", SE.ottoman, {}),
    ("desk", TA.desk, {}), ("bed_queen", BE.bed_queen, {}), ("window_seat", BE.window_seat, {}), ("plant_monstera", DE.plant_monstera, {}), ("plant_olive", DE.plant_olive, {}),
    ("plant_rubber", DE.plant_rubber, {}), ("floor_lamp", DE.floor_lamp, {}), ("rug_rect", DE.rug_rect, {}), ("globe", DE.globe, {}), ("piano", TA.piano_upright, {}),
    ("guitar_stand", DE.guitar_stand, {}), ("workbench", TA.workbench, {}), ("stool_bar", SE.stool_bar, {}), ("island", KI.island, {}), ("table_dining_rect", TA.table_dining_rect, {}),
    ("wood_stove", DE.wood_stove, {}), ("firewood", DE.firewood_pile, {}), ("wardrobe_builtin", ST.wardrobe_builtin, {}), ("shoe_cab", ST.shoe_cabinet, {}),
    ("pyeongsang", SE.pyeongsang, {}), ("bangseok", SE.bangseok, {}), ("mattress_sofa", BE.mattress_sofa, {}), ("bean_bag", SE.bean_bag, {}), ("sofa_floor", SE.sofa_floor, {}),
    ("table_low", TA.table_low, {}), ("boryo", SE.boryo, {}), ("stool_wood", SE.stool_wood, {}), ("bench_log", SE.bench_log, {}), ("rocking", SE.rocking_chair, {}),
    ("counter_base", KI.counter_base, {}), ("upper_cab", KI.upper_cabinets, {}), ("hood", KI.hood, {}), ("fridge", KI.fridge, {}), ("table_round", TA.table_dining_round, {}),
    ("pendant_dome", DE.pendant_dome, {}), ("string_lights", DE.string_lights, {}), ("bed_single", BE.bed_single, {}), ("tv_wall", TA.tv_wall, {}), ("audio", TA.tv_cabinet_audio, {}),
    ("trunk", ST.trunk, {}), ("banndaji", ST.banndaji, {}), ("wall_shelf", ST.wall_shelf, {}), ("cabinet_glass", ST.cabinet_glass, {}), ("frame_art", DE.frame_art, {}), ("curtain", None, {})]:
    if fn: count(n, fn, **kw)

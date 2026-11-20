"""HB materials registered into the kit's table (imported by the house scripts AND by bake_house_hb.py so authoring and export agree):
H_wallpaper - subtle Korean 벽지 pattern, a different tile per house (T_h_wp_<N>.png, grey, tinted by the vertex colour); H_hanji - lit paper for 창호."""
import kit_core as K

K.MATS["H_wallpaper"] = dict(tex="T_h_wp_6.png", rough=0.9, tint=True)
K.MATS["H_hanji"] = dict(tex="T_h_paper.png", rough=0.9, tint=True)


def use_wallpaper(n):
    K.MATS["H_wallpaper"]["tex"] = f"T_h_wp_{n}.png"
    K._M.pop("H_wallpaper", None)
    import kit_paint
    kit_paint.set_house(n)

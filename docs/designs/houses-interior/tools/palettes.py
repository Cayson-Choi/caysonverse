"""Layered pass (owner via coordinator 2026-11-17: "everything is one beige tone ... layered colour and pattern"): one palette per house,
matched to its exterior colour. Each is a clear scheme — wall paint above the chair rail, a contrasting painted wainscot below it, white or
wood trim, a white ceiling — and two accent colours carried by the textiles (patterned cushions, a check armchair, curtains, quilts, rugs).
Hex values are sRGB; K.lin turns them into the kit's linear vertex tints."""
import kit_core as K

L = K.lin

RAW = {
    # 1 (pink): dusty-rose walls over cream panelling, sage + navy accents, rose floral curtains
    1: dict(wall="#DDB2AA", wall2="#E6C3BC", low="#F3ECE2", trim="#FBF8F2", ceil="#FBF8F3", floor="#E9CBA6",
            curtain="#EBD9D2", curtain_m="H_drape", sofa="#E2D8CA", chair="#8EA48B", acc1="#8EA48B", acc2="#3F4F6E", rug="#D9C6B4", rug_b="#3F4F6E",
            quilt="#C98F86", head="#9DB09A"),
    # 2 (sky): powder-blue walls over white panelling, mustard + coral accents, blue gingham curtains
    2: dict(wall="#A9C3D9", wall2="#B8CEE0", low="#FAF8F3", trim="#FFFFFF", ceil="#FBFAF6", floor="#E5C9A3",
            curtain="#7E9DC2", curtain_m="H_drape", sofa="#E9E2D5", chair="#D9AE4C", acc1="#D9AE4C", acc2="#D47D66", rug="#E3D8C4", rug_b="#6E8DB5",
            quilt="#8BA8CB", head="#D9AE4C"),
    # 3 (yellow): butter walls over cream, cornflower + tomato accents, red gingham curtains (farmhouse kitchen)
    3: dict(wall="#EED17A", wall2="#F1DC9A", low="#F7F1E3", trim="#FFFFFF", ceil="#FCFAF4", floor="#D9A877",
            curtain="#C2564A", curtain_m="H_drape", sofa="#5F80B3", chair="#C2564A", acc1="#C2564A", acc2="#5F80B3", rug="#E8DCC4", rug_b="#5F80B3",
            quilt="#5F80B3", head="#C2564A"),
    # 4 (white): warm stone walls over sage-green panelling, plum + mustard accents, cream floral curtains
    4: dict(wall="#E6DECD", wall2="#E9E2D3", low="#8FA38D", trim="#F8F5EE", ceil="#FBF9F4", floor="#D8B48A",
            curtain="#F0E6D3", curtain_m="H_drape", sofa="#B9A68A", chair="#7E4C5E", acc1="#7E4C5E", acc2="#C99A3E", rug="#C9B79C", rug_b="#7E4C5E",
            quilt="#7E4C5E", head="#8FA38D"),
    # 5 (mint): mint walls over white, terracotta + ochre accents (sunroom), oat floral curtains
    5: dict(wall="#B4D3BC", wall2="#C2DBC7", low="#FBFAF5", trim="#FFFFFF", ceil="#FCFBF7", floor="#DDBA8E",
            curtain="#F1E4CF", curtain_m="H_drape", sofa="#EFE8DB", chair="#C8714F", acc1="#C8714F", acc2="#D6A84D", rug="#E9DDC8", rug_b="#C8714F",
            quilt="#C8714F", head="#9CBFA7"),
    # 6 (yellow, library): deep library green over cream panelling, ochre + rust accents, ochre check curtains
    6: dict(wall="#5D7A66", wall2="#6E8A76", low="#EFE6D2", trim="#F6F1E6", ceil="#FAF7F0", floor="#C4936A",
            curtain="#D3A54B", curtain_m="H_drape", sofa="#B9583F", chair="#D3A54B", acc1="#D3A54B", acc2="#B9583F", rug="#C9B28F", rug_b="#3E5446",
            quilt="#D3A54B", head="#3E5446"),
    # 7 (mint, music): seafoam walls over deep teal panelling, mustard + blush accents, soft sage check curtains
    7: dict(wall="#BCD9CF", wall2="#C7DFD6", low="#4F7377", trim="#FBF9F4", ceil="#FBFAF6", floor="#D2A67C",
            curtain="#B9CDBF", curtain_m="H_drape", sofa="#E8DFD0", chair="#C8AE72", acc1="#D6A84D", acc2="#DFA9A0", rug="#E4D8C3", rug_b="#4F7377",
            quilt="#DFA9A0", head="#4F7377"),
    # 8 (sky, hanok): paper-white walls over slate-blue panelling, wood trim, indigo + persimmon accents, pale blue check curtains
    8: dict(wall="#EAE3D3", wall2="#ECE5D6", low="#7F93AB", trim="#7A5A3F", ceil="#F8F5EE", floor="#CFA27A",
            curtain="#AFC3D8", curtain_m="H_drape", sofa="#3F4F7C", chair="#D07A45", acc1="#D07A45", acc2="#3F4F7C", rug="#E1D6C1", rug_b="#3F4F7C",
            quilt="#3F4F7C", head="#7F93AB"),
    # 9 (pink, dining / cafe): terracotta-pink walls over cream, olive + teal accents, teal check curtains
    9: dict(wall="#D9A396", wall2="#E1B4A9", low="#F6EFE5", trim="#FFFFFF", ceil="#FCF9F4", floor="#D9AF85",
            curtain="#5E9A97", curtain_m="H_drape", sofa="#E9E0D1", chair="#3F7C7A", acc1="#7F8C4F", acc2="#3F7C7A", rug="#E2D3BE", rug_b="#7F8C4F",
            quilt="#7F8C4F", head="#3F7C7A"),
    # 10 (white, stove cabin): oat walls over walnut-brown panelling, red check + forest accents, red check curtains
    10: dict(wall="#E6D8BF", wall2="#EADFC9", low="#8D6446", trim="#6B4A33", ceil="#F6F0E4", floor="#C9976A",
             curtain="#A8463C", curtain_m="H_drape", sofa="#5A7454", chair="#A8463C", acc1="#A8463C", acc2="#5A7454", rug="#D8C7A9", rug_b="#A8463C",
             quilt="#A8463C", head="#5A7454"),
}


def palette(n):
    raw = RAW[n]
    return {k: (L(v) if isinstance(v, str) and v.startswith("#") else v) for k, v in raw.items()}

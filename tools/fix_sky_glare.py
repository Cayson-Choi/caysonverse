"""
Day-sky glare fix (2026-11-16): re-grades two textures inside client/public/models/village/village.glb in place.
  - T_sky (the sky dome): the bake carried a sunset sun glow + god rays at one fixed azimuth, which showed by day as a
    blown-out milky patch with no sun. The low-frequency brightness around it is replaced by the clean sky gradient
    measured on the opposite side (clouds' detail stays); the horizon band is pulled to a soft blue-grey, not a white wall.
  - T_backdrop (the far hills): the haze baked into the ridges was near-white ("snow" look); it is re-coloured to a mild
    blue-grey aerial perspective so the mountains read as hills.
Usage: python tools/fix_sky_glare.py <in.glb> <out.glb> [--sky-only]
"""
import io, json, struct, sys
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, gaussian_filter1d

src, dst = sys.argv[1], sys.argv[2]
b = open(src, "rb").read()
jl = struct.unpack_from("<I", b, 12)[0]
js = json.loads(b[20:20 + jl])
bin0 = b[20 + jl + 8:]

def img_bytes(i):
    bv = js["bufferViews"][js["images"][i]["bufferView"]]
    return bin0[bv.get("byteOffset", 0): bv.get("byteOffset", 0) + bv["byteLength"]]

def smooth(x, a, b_):
    t = np.clip((x - a) / (b_ - a), 0, 1)
    return t * t * (3 - 2 * t)

def fix_sky(im):
    a = np.asarray(im.convert("RGB"), dtype=np.float32) / 255.0
    h, w, _ = a.shape
    clean = a[:, int(w * 0.45):int(w * 0.98), :]
    g = np.median(clean, axis=1)                      # (h,3) clean vertical gradient
    g = gaussian_filter1d(g, 6, axis=0)
    low = np.stack([gaussian_filter(a[..., c], 40, mode=("nearest", "wrap")) for c in range(3)], -1)
    excess = np.maximum(low - g[:, None, :], 0)
    # glow mask: wide soft disc around the glow centre (u~0.19, v~0.77), wrap-aware in u
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    du = np.minimum(np.abs(xx - 0.19 * w), w - np.abs(xx - 0.19 * w))
    d = np.hypot(du, (yy - 0.77 * h) * 1.0)
    mask = 1 - smooth(d, 520, 900)
    out = a - excess * mask[..., None]
    # also pull the cloud tops near the glow down a little (lit rims)
    out = np.clip(out, 0, 1)
    # horizon haze: the lowest part is a cream/white band; tint it toward blue-grey, a touch darker
    v = yy / h
    band = smooth(v, 0.70, 0.95)[..., None]
    hz = np.array([0.66, 0.73, 0.80], np.float32)
    lum = out @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    out = out * (1 - 0.55 * band) + hz * (lum[..., None] / 0.78) * 0.55 * band
    # a clearer blue: a little more colour in the whole sky
    l2 = (out @ np.array([0.2126, 0.7152, 0.0722], np.float32))[..., None]
    out = l2 + (out - l2) * 1.3
    return Image.fromarray((np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8))

def fix_backdrop(im):
    a = np.asarray(im.convert("RGB"), dtype=np.float32) / 255.0
    r, g_, b_ = a[..., 0], a[..., 1], a[..., 2]
    y = 0.2126 * r + 0.7152 * g_ + 0.0722 * b_
    sat = (a.max(-1) - a.min(-1)) / np.maximum(a.max(-1), 1e-4)
    s = smooth(y, 0.60, 0.80) * (1 - smooth(sat, 0.22, 0.45))
    base = np.array([0.50, 0.60, 0.66], np.float32)   # hazy blue-grey ridge
    shade = (0.80 + (y - 0.7) * 0.9)[..., None]
    new = np.clip(base * shade, 0, 1)
    out = a * (1 - s[..., None]) + new * s[..., None]
    return Image.fromarray((np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8))

def enc(im):
    f = io.BytesIO(); im.save(f, "WEBP", quality=90, method=6); return f.getvalue()

# the images by NAME (vrb2: the rebuilt file's image order differs from the 2026-11-16 file's, where T_sky was image 18 and
# T_backdrop image 4; fixed indices graded the wrong textures)
def img_index(name):
    return next(i for i, im in enumerate(js["images"]) if im.get("name") == name)

SKY, BACKDROP = img_index("T_sky"), img_index("T_backdrop")
repl = {SKY: enc(fix_sky(Image.open(io.BytesIO(img_bytes(SKY)))))}
if "--sky-only" not in sys.argv:
    repl[BACKDROP] = enc(fix_backdrop(Image.open(io.BytesIO(img_bytes(BACKDROP)))))
for i, data in repl.items():
    Image.open(io.BytesIO(data)).convert("RGB").save(dst.rsplit(".", 1)[0] + f"_img{i}.png")

# rebuild the binary chunk with the replaced images (all bufferViews re-packed, 4-byte aligned)
order = sorted(range(len(js["bufferViews"])), key=lambda k: js["bufferViews"][k].get("byteOffset", 0))
img_of_bv = {js["images"][i]["bufferView"]: i for i in range(len(js["images"])) if "bufferView" in js["images"][i]}
new = bytearray()
for k in order:
    bv = js["bufferViews"][k]
    off = bv.get("byteOffset", 0)
    data = repl[img_of_bv[k]] if img_of_bv.get(k) in repl else bin0[off:off + bv["byteLength"]]
    while len(new) % 4: new.append(0)
    bv["byteOffset"] = len(new); bv["byteLength"] = len(data)
    new += data
while len(new) % 4: new.append(0)
js["buffers"][0]["byteLength"] = len(new)
jb = json.dumps(js, separators=(",", ":")).encode()
jb += b" " * (-len(jb) % 4)
total = 12 + 8 + len(jb) + 8 + len(new)
open(dst, "wb").write(struct.pack("<4sII", b"glTF", 2, total) + struct.pack("<I4s", len(jb), b"JSON") + jb + struct.pack("<I4s", len(new), b"BIN\0") + bytes(new))
print("ok", len(b), "->", total)

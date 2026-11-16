# make_fabrics.py — NPC 옷감의 노멀 맵(타일, 128 x 128): 울 능직, 면 평직, 폴리 립스톱, 메시, 타월(테리), 캔버스.
#   python docs/designs/npc/make_fabrics.py <outdir>
# 높이 지도를 이어지는(타일) 함수로 만들고 기울기로 탄젠트 공간 노멀을 구한다(OpenGL 규약 = glTF: +Y가 위).
import sys, os
import numpy as np
from PIL import Image

N = 128
y, x = np.mgrid[0:N, 0:N].astype(np.float64)
rng = np.random.default_rng(7)


def tile_noise(scale, octaves=3):
    """이어지는 값 잡음(주기 N): 저해상도 무작위 격자를 주기적으로 보간."""
    out = np.zeros((N, N))
    amp = 1.0
    for o in range(octaves):
        s = scale * (2 ** o)
        g = rng.random((s, s))
        gx = x / N * s; gy = y / N * s
        x0 = np.floor(gx).astype(int) % s; y0 = np.floor(gy).astype(int) % s
        x1 = (x0 + 1) % s; y1 = (y0 + 1) % s
        fx = gx - np.floor(gx); fy = gy - np.floor(gy)
        fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy)
        v = (g[y0, x0] * (1 - fx) + g[y0, x1] * fx) * (1 - fy) + (g[y1, x0] * (1 - fx) + g[y1, x1] * fx) * fy
        out += v * amp
        amp *= 0.5
    return out / out.max()


def weave(threads, over=1):
    """평직(over=1) / 능직(over>1): 날실·씨실이 번갈아 위로 오는 실의 높이."""
    p = N / threads
    u = x / p; v = y / p
    iu = np.floor(u).astype(int); iv = np.floor(v).astype(int)
    fu = u - iu; fv = v - iv
    warp = np.sin(np.pi * fu) ** 0.8   # 날실(세로) 단면
    weft = np.sin(np.pi * fv) ** 0.8   # 씨실(가로) 단면
    up = ((iu + iv) % (over + 1)) == 0 if over > 1 else ((iu + iv) % 2 == 0)
    return np.where(up, 0.6 + 0.4 * warp * (0.6 + 0.4 * np.sin(np.pi * fv)), 0.6 + 0.4 * weft * (0.6 + 0.4 * np.sin(np.pi * fu)))


def twill(threads):
    p = N / threads
    d = (x + y) / p
    rib = np.sin(np.pi * (d - np.floor(d))) ** 0.7
    cross = 0.15 * np.sin(2 * np.pi * x / p)
    return rib + cross


def normal_from(h, strength):
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5
    nx = -dx * strength; ny = dy * strength; nz = np.ones_like(h)
    l = np.sqrt(nx * nx + ny * ny + nz * nz)
    rgb = np.stack([nx / l, ny / l, nz / l], -1) * 0.5 + 0.5
    return Image.fromarray((rgb * 255).round().astype(np.uint8), "RGB")


def main(out):
    os.makedirs(out, exist_ok=True)
    fab = {
        # 울 정장: 고운 능직 + 아주 약한 얼룩(모직의 결)
        "wool": (twill(32) * 0.8 + tile_noise(8) * 0.35, 3.0),
        # 면 셔츠: 고운 평직
        "cotton": (weave(24) + tile_noise(16) * 0.15, 2.4),
        # 폴리 조끼: 립스톱(가는 평직 + 굵은 격자 실)
        "poly": (weave(32) * 0.6 + 0.8 * ((np.sin(np.pi * x / 8) ** 40) + (np.sin(np.pi * y / 8) ** 40)), 2.2),
        # 메시 등판: 네모 구멍
        "mesh": (np.minimum(np.abs(np.sin(np.pi * x / 8)), np.abs(np.sin(np.pi * y / 8))) ** 0.3 * -1 + 1, 4.0),
        # 타월(테리): 촘촘한 고리 = 작은 둥근 혹들 + 잡음
        "terry": (tile_noise(32, 2) * 0.7 + np.clip(np.sin(2 * np.pi * x / 4) * np.sin(2 * np.pi * y / 4), 0, 1) * 0.6, 3.5),
        # 캔버스 모자: 굵은 평직
        "canvas": (weave(12) + tile_noise(8) * 0.2, 3.0),
    }
    for name, (h, s) in fab.items():
        h = (h - h.min()) / (h.max() - h.min())
        normal_from(h * 6.0, s).save(os.path.join(out, f"fab_{name}_n.jpg"), quality=88)
        print("wrote", name)


if __name__ == "__main__":
    main(sys.argv[1])

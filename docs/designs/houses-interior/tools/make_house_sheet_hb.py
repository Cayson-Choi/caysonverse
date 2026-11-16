"""Comparison / contact sheets of a house (system Python: PIL).

  python art/village/tools/houses/make_house_sheet.py --house N [--out docs/designs/houses-interior/review]

Reads art/village/work/house_N_views.json (the VIEWS of hNN.py; entries with "ref": [category, index] and "label" become rows of the comparison
sheet) and the review renders art/village/work/review/hN_<view>_<day|night>.png. Writes
  h<N>_compare.jpg  rows of [model day | model night | real reference photo + its source]  (art/village/refs/houses/<category>/<index>.jpg, sources.json)
  h<N>_rooms_day.jpg / h<N>_rooms_night.jpg   contact sheet of every review view
"""
import json
import os
import sys
from urllib.parse import urlparse

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
REPO = os.path.dirname(os.path.dirname(ROOT))
WORK = os.path.join(ROOT, "work")
REVIEW = os.path.join(WORK, "review")
REFS = os.path.join(ROOT, "refs", "houses")
FONT = "C:/Windows/Fonts/malgun.ttf"
FONT_B = "C:/Windows/Fonts/malgunbd.ttf"
ROWS = {   # house -> [(view name, label, reference category, photo index)] : the comparison sheet's rows
    6: [("f1_desk", "1층 책상·책장 벽", "04_study", 0), ("f1_lounge", "1층 독서 안락의자", "04_study", 2), ("f1_stair", "1층 계단·소파", "08_stairs_2f", 7),
        ("f2_bed", "2층 침실", "15_master_bedroom", 1)],
    7: [("f1_piano", "1층 피아노", "12_hobby_music", 8), ("f1_listen", "1층 오디오·기타", "12_hobby_music", 0), ("f2_bench", "2층 작업대·타공판", "13_workshop", 5),
        ("f2_shop", "2층 공방", "13_workshop", 9)],
    8: [("f1_back", "1층 대청마루 뒤벽", "07_hanok_maru", 5), ("f1_entry", "1층 대들보·서까래", "07_hanok_maru", 0), ("f2_lounge", "2층 다락 라운지", "09_attic", 3),
        ("f2_sky", "2층 경사 천장·천창", "09_attic", 4)],
    9: [("f1_dining", "1층 8인 식탁", "11_dining", 5), ("f1_kitchen", "1층 주방·아일랜드", "03_farm_kitchen", 0), ("f1_cafe", "1층 홈카페", "11_dining", 0),
        ("f2_living", "2층 좌식 거실", "19_floor_sofa", 2)],
    10: [("f1_stove", "1층 장작 난로", "02_modern_living", 3), ("f1_sofa", "1층 소파·난로", "09_attic", 1), ("f2_bed", "2층 다락 침실", "09_attic", 11),
         ("f2_seat", "2층 창가 좌석", "09_attic", 9)],
}
THEME = {6: "책의 집 (서재)", 7: "음악 거실 + 공방", 8: "한옥풍 대청마루 + 다락", 9: "다이닝 · 홈카페", 10: "장작 난로 오두막"}


def font(sz, bold=False):
    try:
        return ImageFont.truetype(FONT_B if bold else FONT, sz)
    except Exception:
        return ImageFont.load_default()


def fit(im, w, h, bg=(24, 24, 26)):
    r = min(w / im.width, h / im.height)
    im2 = im.resize((max(1, int(im.width * r)), max(1, int(im.height * r))), Image.LANCZOS)
    out = Image.new("RGB", (w, h), bg)
    out.paste(im2, ((w - im2.width) // 2, (h - im2.height) // 2))
    return out


def label(im, text, size=22, pos=(10, 8), fg=(255, 255, 255)):
    d = ImageDraw.Draw(im, "RGBA")
    f = font(size, True)
    tw = d.textlength(text, font=f)
    d.rectangle([pos[0] - 6, pos[1] - 4, pos[0] + tw + 8, pos[1] + size + 8], fill=(0, 0, 0, 150))
    d.text(pos, text, font=f, fill=fg)


def src_of(cat, idx, sources):
    try:
        it = sources[cat]["items"][idx]
        return urlparse(it["lpage"]).netloc.replace("www.", "")
    except Exception:
        return "?"


def main():
    a = sys.argv[1:]
    n = int(a[a.index("--house") + 1])
    out = a[a.index("--out") + 1] if "--out" in a else os.path.join(REPO, "docs", "designs", "houses-interior", "review")
    os.makedirs(out, exist_ok=True)
    views = json.load(open(os.path.join(WORK, f"house_{n}_views.json"), encoding="utf-8"))
    sources = json.load(open(os.path.join(REFS, "sources.json"), encoding="utf-8"))
    W, Hh = 720, 405

    def render(v, tag):
        p = os.path.join(REVIEW, f"h{n}_{v['name']}_{tag}.png")
        return Image.open(p).convert("RGB") if os.path.exists(p) else None

    byname = {v["name"]: v for v in views}
    rows = []
    for (vn, lab, cat, idx) in ROWS.get(n, []):
        v = dict(byname[vn])
        v["label"], v["ref"] = lab, [cat, idx]
        rows.append(v)
    if rows:
        head = 70
        sheet = Image.new("RGB", (W * 3, head + (Hh + 34) * len(rows)), (18, 18, 20))
        d = ImageDraw.Draw(sheet)
        d.text((16, 14), f"{n}번 집 — {THEME[n]}   |   모델 낮 · 모델 밤 · 실제 사진(참고)", font=font(32, True), fill=(255, 255, 255))
        for i, v in enumerate(rows):
            y = head + i * (Hh + 34)
            for c, tag in enumerate(("day", "night")):
                im = render(v, tag)
                if im is not None:
                    t = fit(im, W, Hh)
                    label(t, f"{v.get('label', v['name'])} · {'낮' if tag == 'day' else '밤'}")
                    sheet.paste(t, (c * W, y))
            cat, idx = v["ref"][:2]
            rp = os.path.join(REFS, cat, f"{idx:02d}.jpg")
            if os.path.exists(rp):
                t = fit(Image.open(rp).convert("RGB"), W, Hh, (30, 30, 34))
                label(t, "실제 사진", 20)
                sheet.paste(t, (2 * W, y))
                d.text((2 * W + 10, y + Hh + 6), f"출처 {src_of(cat, idx, sources)}  ({cat}/{idx:02d})", font=font(18), fill=(190, 190, 195))
        sheet.save(os.path.join(out, f"h{n}_compare.jpg"), quality=88)
        print("wrote", os.path.join(out, f"h{n}_compare.jpg"))
    for tag in ("day", "night"):
        ims = [(v, render(v, tag)) for v in views]
        ims = [(v, im) for v, im in ims if im is not None]
        if not ims:
            continue
        cols = 2
        cw, ch = 760, 428
        rr = (len(ims) + cols - 1) // cols
        sheet = Image.new("RGB", (cw * cols, 56 + ch * rr), (18, 18, 20))
        ImageDraw.Draw(sheet).text((16, 10), f"{n}번 집 — {THEME[n]} — {'낮' if tag == 'day' else '밤'} (눈높이 1.0~1.5 m)", font=font(30, True), fill=(255, 255, 255))
        for i, (v, im) in enumerate(ims):
            t = fit(im, cw, ch)
            label(t, f"{v.get('label', v['name'])} · {'1층' if v['floor'] == 1 else '2층'}")
            sheet.paste(t, ((i % cols) * cw, 56 + (i // cols) * ch))
        sheet.save(os.path.join(out, f"h{n}_rooms_{tag}.jpg"), quality=86)
        print("wrote", os.path.join(out, f"h{n}_rooms_{tag}.jpg"))


main()

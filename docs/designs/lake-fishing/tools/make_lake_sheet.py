"""The 12.8 comparison sheet of art chunk A: our renders side by side with the real photos (art/village/refs/lake), day and night.

  python art/lake/tools/make_lake_sheet.py            -> docs/designs/lake-fishing/lake_compare_A_day.jpg, ..._night.jpg, ..._seam.jpg

Each row: our render (left, 16:9) | one or two real photos (right) | a one-line note. Rows come from ROWS below; a missing render
or photo is reported and skipped. System Python with PIL.
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
LAKE = os.path.dirname(HERE)
REPO = os.path.dirname(os.path.dirname(LAKE))
REN = os.path.join(LAKE, "work", "renders")
PH = os.path.join(REPO, "art", "village", "refs", "lake")
OUT = os.path.join(REPO, "docs", "designs", "lake-fishing")
FONT = "C:/Windows/Fonts/malgunbd.ttf"
FONT_R = "C:/Windows/Fonts/malgun.ttf"

SHEETS = {
    "lake_compare_A_day": [
        ("넓은 전경 (사진과 같은 구도, B 시설 포함)", "wide_photo.png", ["01_reservoir_overview_a.jpg", "01_reservoir_overview_c.jpg"], "골짜기를 둘러싼 숲 능선, 흐릿한 녹갈색 물, 물가 마른 풀·진흙띠"),
        ("좌대·잔교 쪽", "jwadae.png", ["02_jwadae_a.jpg", "03_pier_a.jpg"], "물색과 반사, 물가 풀"),
        ("물가에서 본 전경 (낮)", "overview_day.png", ["01_reservoir_overview_a.jpg", "01_reservoir_overview_c.jpg"],
         "산·숲이 물에 비치고, 물은 탁한 녹갈색, 물가에 갈대 띠"),
        ("갈대 무더기", "reed_n.png", ["01_reservoir_overview_c.jpg"], "가는 곧은 줄기 1.4~2.3 m, 이삭, 휘어진 잎(두께 있는 줄기, 평면 카드 없음)"),
        ("부들", "cattail.png", ["06_cattail_b.jpg", "06_reeds_a.jpg"], "넓은 칼잎 + 갈색 원통 꽃대"),
        ("물가: 진흙 · 사석 · 자갈", "shore_rock.png", ["03_pier_a.jpg"], "잔교 뿌리 둘레 돌 쌓기, 젖은 진흙 띠"),
        ("출고 파일 미리보기 (낮, 라이트맵·꼭짓점색 적용)", "game_overview.png", ["01_reservoir_overview_c.jpg"], "lake.glb를 가져와 게임처럼 빛 없이 보이게 한 모습(물은 대신 반사 파노라마)"),
        ("노지(물가 자리) 뒤편", "nojiside.png", ["01_reservoir_overview_a.jpg"], "자갈 노지, 풀밭, 물가 풀"),
    ],
    "lake_compare_A_night": [
        ("밤 호수 (전경)", "wide_photo_night.png", ["07_night_chemi_a.jpg", "07_night_chemi_b.webp"], "거의 검은 수면, 가로등·창빛이 길게 비침"),
        ("출고 파일 미리보기 (밤)", "game_overview_night.png", ["07_night_chemi_b.webp"], "밤 라이트맵 + 밤 반사 파노라마. 나무 꼭짓점색은 낮 빛이라 게임에서 밤에 어둡게 곱함"),
        ("밤 잔교 쪽", "pier_night.png", ["07_night_chemi_a.jpg"], "가로등 불빛이 물에 비침"),
    ],
    "lake_compare_A_seam": [
        ("광장 쪽에서 본 호수 (낮)", "seam_village_day.png", [], "마을 땅(낮) -> 호수 땅, x 95.5 이음매"),
        ("호수에서 본 마을 (낮)", "seam_lake_day.png", [], "호수 쪽에서 서쪽(마을)을 봄"),
        ("이음매 (밤)", "seam_village_night_night.png", [], "밝기가 튀지 않음"),
    ],
}


def font(size, bold=True):
    return ImageFont.truetype(FONT if bold else FONT_R, size)


def fit(im, w, h):
    s = min(w / im.width, h / im.height)
    return im.resize((max(1, int(im.width * s)), max(1, int(im.height * s))), Image.LANCZOS)


def make(name, rows):
    W = 2400
    RH = 560
    pad = 14
    head = 90
    imgs = []
    for title, ren, photos, note in rows:
        rp = os.path.join(REN, ren)
        if not os.path.exists(rp):
            print("missing render", ren)
            continue
        ps = []
        for p in photos:
            pp = os.path.join(PH, p)
            if os.path.exists(pp):
                ps.append(Image.open(pp).convert("RGB"))
            else:
                print("missing photo", p)
        imgs.append((title, Image.open(rp).convert("RGB"), ps, note))
    if not imgs:
        print("nothing for", name)
        return
    sheet = Image.new("RGB", (W, head + len(imgs) * (RH + 2 * pad + 40)), (243, 239, 234))
    d = ImageDraw.Draw(sheet)
    d.text((pad * 2, 18), name.replace("_", " ") + " — 왼쪽: 우리 렌더, 오른쪽: 실제 사진", font=font(38), fill=(40, 40, 60))
    y = head
    for title, ren, ps, note in imgs:
        d.text((pad * 2, y), title, font=font(30), fill=(75, 79, 216))
        d.text((pad * 2 + 520, y + 6), note, font=font(22, False), fill=(60, 60, 60))
        y += 40
        left_w = 1440 if ps else W - 2 * pad
        r = fit(ren, left_w, RH)
        sheet.paste(r, (pad, y))
        x = pad + left_w + pad
        if ps:
            pw = (W - x - pad - (len(ps) - 1) * pad) // len(ps)
            for im in ps:
                pi = fit(im, pw, RH)
                sheet.paste(pi, (x, y))
                x += pw + pad
        y += RH + 2 * pad
    out = os.path.join(OUT, name + ".jpg")
    sheet.save(out, quality=88)
    print("sheet ->", out, sheet.size)


def main(argv):
    which = argv[0] if argv else None
    for name, rows in SHEETS.items():
        if which and which not in name:
            continue
        make(name, rows)


if __name__ == "__main__":
    main(sys.argv[1:])

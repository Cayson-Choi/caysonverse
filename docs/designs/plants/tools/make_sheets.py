import json, os
from PIL import Image, ImageDraw, ImageFont
R = r"D:/ClaudeCode/caysonverse-plants"
REF = R + "/art/village/refs/plants"
B = R + "/docs/designs/plants/shots/before"
A = R + "/docs/designs/plants/shots/after"
LD = R + "/docs/designs/plants/lookdev"
OUT = R + "/docs/designs/plants/sheets"
src = json.load(open(REF + "/sources.json", encoding="utf-8"))
font = ImageFont.truetype("C:/Windows/Fonts/malgun.ttf", 22)
small = ImageFont.truetype("C:/Windows/Fonts/malgun.ttf", 14)
W, H = 760, 428
def tile(path, label, credit=None):
    im = Image.open(path).convert("RGB")
    # cover-crop to W x H
    r = max(W / im.width, H / im.height)
    im = im.resize((int(im.width * r + 1), int(im.height * r + 1)))
    x0, y0 = (im.width - W) // 2, (im.height - H) // 2
    im = im.crop((x0, y0, x0 + W, y0 + H))
    d = ImageDraw.Draw(im)
    d.rectangle((0, 0, W, 34), fill=(0, 0, 0))
    d.text((10, 3), label, fill=(255, 255, 255), font=font)
    if credit:
        d.rectangle((0, H - 22, W, H), fill=(0, 0, 0))
        d.text((8, H - 20), credit, fill=(230, 230, 230), font=small)
    return im
def ref(name, label):
    s = src[name]
    a = s["author"].encode("utf-8", "ignore").decode("utf-8")
    return tile(f"{REF}/{name}", label, f"사진: {s['title'][5:60]} / {a[:30]} / {s['license']} (Wikimedia Commons)")
def sheet(name, rows):
    cols = max(len(r) for r in rows)
    im = Image.new("RGB", (W * cols, H * len(rows)), "white")
    for j, r in enumerate(rows):
        for i, t in enumerate(r):
            im.paste(t, (i * W, j * H))
    im.save(f"{OUT}/{name}.jpg", quality=86)
    print(name)
sheet("1_square_planter", [
    [tile(f"{B}/plants-squareClose-new.jpg", "전 — 광장 사각 화분 (주인님 스크린샷 각도)"), tile(f"{A}/plants-squareClose-new.jpg", "후 — 회양목 공 + 팬지·페튜니아·무스카리·메리골드 + 바크 멀칭"), ref("boxwood_ball_1.jpg", "실제 — 둥글게 다듬은 회양목")],
    [tile(f"{B}/plants-squarePlanter-new.jpg", "전 — 보통 거리 (약 6 m)"), tile(f"{A}/plants-squarePlanter-new.jpg", "후 — 보통 거리 (약 6 m)"), ref("petunia_bed_1.jpg", "실제 — 페튜니아 화단")],
])
sheet("2_bush_close", [
    [tile(f"{B}/plants-bushClose-new.jpg", "전 — 덤불 근접 (카메라가 덤불 안: 10~15 cm 큰 잎)"), tile(f"{A}/plants-bushClose-new.jpg", "후 — 덤불 근접 (1.5~2 cm 잎 잔가지, 안쪽 그늘)"), ref("boxwood_leaves_1.jpg", "실제 — 회양목 잎 (1.5~2.5 cm)")],
    [tile(f"{LD}/planter_bush.jpg", "후 — 룩데브 50 cm 근접"), tile(f"{LD}/bushes.jpg", "후 — 회양목 공 / 철쭉 무더기(꽃 일부)"), ref("azalea_clipped_2.jpg", "실제 — 다듬은 철쭉·호랑가시 생울타리")],
])
sheet("3_flower_beds", [
    [tile(f"{B}/plants-planterTop-new.jpg", "전 — 벚나무 둥근 화분 위에서"), tile(f"{A}/plants-planterTop-new.jpg", "후 — 벚나무 둥근 화분 위에서"), ref("pansy_bed_2.jpg", "실제 — 팬지(비올라) 화단")],
    [tile(f"{B}/plants-fountainBed-new.jpg", "전 — 분수 모서리 화단"), tile(f"{A}/plants-fountainBed-new.jpg", "후 — 분수 모서리 화단"), ref("marigold_bed_2.jpg", "실제 — 메리골드")],
    [tile(f"{B}/plants-houseBed-new.jpg", "전 — 집 앞 화단·덤불"), tile(f"{A}/plants-houseBed-new.jpg", "후 — 집 앞 화단·덤불"), ref("muscari_2.jpg", "실제 — 무스카리")],
])
sheet("4_lane_shrubs", [
    [tile(f"{B}/plants-laneShrubs-new.jpg", "전 — 길가 덤불"), tile(f"{A}/plants-laneShrubs-new.jpg", "후 — 길가 덤불 (회양목 88, 철쭉 21그루)"), ref("azalea_korea_1.jpg", "실제 — 철쭉 꽃")],
])
sheet("5_zelkova", [
    [tile(f"{B}/plants-zelkovaDeck-new.jpg", "전 — 나무 없이 남은 평상"), tile(f"{A}/plants-zelkovaDeck-new.jpg", "후 — 느티나무(정자나무)가 평상 가운데에"), ref("zelkova_big_1.jpg", "실제 — 마을 당산 느티나무와 정자")],
    [tile(f"{B}/plants-zelkovaUnder-new.jpg", "전 — 평상 옆에서 올려다봄"), tile(f"{A}/plants-zelkovaUnder-new.jpg", "후 — 줄기·큰 가지·잔가지·잎 연결"), ref("zelkova_old_1.jpg", "실제 — 느티나무 수관")],
])
sheet("6_lookdev_close", [
    [tile(f"{LD}/planter_close.jpg", "룩데브 — 사각 화분 근접 (게임 식생 재질)"), tile(f"{LD}/bed_close.jpg", "룩데브 — 꽃 종류별 근접"), ref("pansy_close_1.jpg", "실제 — 팬지 얼굴")],
    [tile(f"{LD}/atlas.jpg", "식물 아틀라스 (코드로 그림, 1024², 사진 사용 없음)"), tile(f"{LD}/bed_marigold.jpg", "룩데브 — 페튜니아·메리골드"), ref("marigold_2.jpg", "실제 — 프렌치 메리골드")],
])

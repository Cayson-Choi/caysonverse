"""Writes plan_garden.html: top-down layout sketch of the rainbow-bridge garden path (village metres -> px).
Run: python -I plan_garden.py, then ../render.sh plan_garden.html plan_garden.png 1440 960."""
import pathlib

S = 15.0


def P(x, z):
    return ((x + 30) * S + 40, (z + 97) * S + 40)


def smooth(seq):
    """Catmull-Rom through the points as a cubic bezier path."""
    p = [P(x, z) for x, z in seq]
    d = f"M{p[0][0]:.1f},{p[0][1]:.1f}"
    for i in range(len(p) - 1):
        p0 = p[max(i - 1, 0)]
        p1 = p[i]
        p2 = p[i + 1]
        p3 = p[min(i + 2, len(p) - 1)]
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        d += f" C{c1[0]:.1f},{c1[1]:.1f} {c2[0]:.1f},{c2[1]:.1f} {p2[0]:.1f},{p2[1]:.1f}"
    return d


west = [(-4, -50.5), (-11, -51.5), (-13.2, -56), (-13.2, -64), (-13.5, -70), (-9, -74.5), (-3, -76), (0, -77.3)]
meadow = [(0, -82.7), (-4, -84.5), (-6, -88), (-2.5, -90), (2.5, -90), (7, -88.5), (11.5, -86), (15, -83.5), (16, -82)]
east = [(16.4, -77.5), (15, -74), (13.2, -70), (13.2, -60), (11, -51.5), (4, -50.5)]
stream = [(-26, -77.5), (-20, -79.5), (-12, -79), (-3, -80), (3, -80.3), (10, -79.6), (16, -80.2), (22, -79), (27, -78)]
trees = [(-11, -91), (-7, -93.2), (-2.5, -94), (2.5, -94), (7, -93.2), (11, -91), (-13, -84), (13, -90.5), (19, -86), (-18, -88), (21, -91), (-20, -84.5)]
benches = [(-15.6, -66, 90), (15.6, -66, -90), (-8.5, -88, 60), (9, -90.5, -30)]
lights = [(-12, -54), (-12, -61), (-12, -68), (-8, -73.2), (-1.8, -77.5), (-5.3, -84.3), (0, -88.6), (6, -86.8), (12, -84.3), (14.3, -76), (12, -68), (12, -61), (12, -54)]

svg = []
A = svg.append
W, H = 1000, 960
A(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="Noto Sans KR">')
A(f'<rect width="{W}" height="{H}" fill="#dfe8d3"/>')
x0, y0 = P(-30, -97)
A(f'<rect x="{x0}" y="{y0}" width="{60*S}" height="{2*S}" fill="#9fb08a"/><text x="{x0+6}" y="{y0+20}" font-size="13" fill="#3d4a33">마을 북쪽 끝 (z −95) — 너머는 먼 산 배경</text>')
px0, py0 = P(-14, -72)
A(f'<rect x="{px0}" y="{py0}" width="{28*S}" height="{24*S}" fill="none" stroke="#7f8f70" stroke-dasharray="6 5"/>')
bx, by = P(-10, -68)
A(f'<rect x="{bx}" y="{by}" width="{20*S}" height="{16*S}" rx="4" fill="#efe9df" stroke="#8a7e73" stroke-width="2"/>')
cx, cy = P(0, -60)
A(f'<text x="{cx}" y="{cy-6}" font-size="22" font-weight="800" text-anchor="middle" fill="#4b3d31">추모관</text><text x="{cx}" y="{cy+18}" font-size="13" text-anchor="middle" fill="#6c6158">20 × 16 m</text>')
fx, fy = P(-6, -52)
A(f'<rect x="{fx}" y="{fy}" width="{12*S}" height="{4*S}" fill="#e3d8c6"/>')
lx, ly = P(-1.5, -48)
A(f'<rect x="{lx}" y="{ly}" width="{3*S}" height="{4*S+40}" fill="#e3d8c6"/><text x="{lx+52}" y="{ly+40}" font-size="13" fill="#4b3d31">광장에서 오는 길</text>')
dx, dy = P(0, -51.6)
A(f'<circle cx="{dx}" cy="{dy}" r="6" fill="#4b4fd8"/><text x="{dx+10}" y="{dy+4}" font-size="12" fill="#4b4fd8">문</text>')
A(f'<path d="{smooth(stream)}" fill="none" stroke="#8fc3d9" stroke-width="{2.6*S}" stroke-linecap="round"/>')
A(f'<path d="{smooth(stream)}" fill="none" stroke="#b8deeb" stroke-width="{1.2*S}" stroke-linecap="round" opacity=".7"/>')
ox, oy = P(-21, -79)
A(f'<ellipse cx="{ox}" cy="{oy}" rx="{4.5*S}" ry="{3.2*S}" fill="#8fc3d9"/><text x="{ox}" y="{oy+4}" font-size="12" text-anchor="middle" fill="#2f5566">작은 연못</text>')
for seg in (west, meadow, east):
    A(f'<path d="{smooth(seg)}" fill="none" stroke="#c9b48f" stroke-width="{1.9*S}" stroke-linecap="round" stroke-linejoin="round"/>')
    A(f'<path d="{smooth(seg)}" fill="none" stroke="#e2d2b2" stroke-width="{1.5*S}" stroke-linecap="round" stroke-linejoin="round"/>')
b0 = P(-1.1, -82.9)
A(f'<rect x="{b0[0]}" y="{b0[1]}" width="{2.2*S}" height="{5.8*S}" rx="10" fill="#b98b5e" stroke="#7a5534" stroke-width="2"/>')
cols = ["#e8a0a0", "#efc08f", "#efe09a", "#a9d4a0", "#9cc8e0", "#a9a9e0", "#c7a6dc"]
seg_w = (5.8 * S - 8) / 7
for i, c in enumerate(cols):
    A(f'<rect x="{b0[0]-3}" y="{b0[1]+4+i*seg_w:.1f}" width="4" height="{seg_w:.1f}" fill="{c}"/><rect x="{b0[0]+2.2*S-1}" y="{b0[1]+4+i*seg_w:.1f}" width="4" height="{seg_w:.1f}" fill="{c}"/>')
for k in range(5):
    sx, sy = P(16.0 + 0.1 * k, -81.6 + 0.95 * k)
    A(f'<ellipse cx="{sx}" cy="{sy}" rx="9" ry="6" fill="#b9b2a6" stroke="#8a8378"/>')
mx, my = P(0, -91.8)
A(f'<ellipse cx="{mx}" cy="{my}" rx="{1.6*S}" ry="{1.0*S}" fill="#a39d93" stroke="#6f6a62" stroke-width="2"/>')
for (tx, tz) in trees:
    x, y = P(tx, tz)
    A(f'<circle cx="{x}" cy="{y}" r="{1.9*S}" fill="#8db07a" opacity=".85"/><circle cx="{x}" cy="{y}" r="3" fill="#5b4532"/><rect x="{x-5}" y="{y+8}" width="10" height="6" fill="#d8b56a"/>')
for (tx, tz) in [(-22, -71), (22, -71), (-19, -60), (19, -60), (-25, -90), (25, -86)]:
    x, y = P(tx, tz)
    A(f'<circle cx="{x}" cy="{y}" r="{2.6*S}" fill="#7aa06a" opacity=".75"/>')
for (fx_, fz, w, h) in [(-17, -70, 3, 6), (17, -70, 3, 6), (-8, -76, 4, 1.6), (8, -76, 4, 1.6)]:
    x, y = P(fx_ - w / 2, fz - h / 2)
    A(f'<rect x="{x}" y="{y}" width="{w*S}" height="{h*S}" rx="8" fill="#c9a6d6" opacity=".8"/>')
for (bx_, bz, rot) in benches:
    x, y = P(bx_, bz)
    A(f'<g transform="translate({x},{y}) rotate({rot})"><rect x="-{1.1*S}" y="-6" width="{2.2*S}" height="12" rx="3" fill="#8a6440"/></g>')
for (lx_, lz) in lights:
    x, y = P(lx_, lz)
    A(f'<circle cx="{x}" cy="{y}" r="4" fill="#ffd27a" stroke="#a07a2a"/>')


def lab(x, z, t, dx=0, dy=0, anchor="middle", size=13, w="700"):
    X, Y = P(x, z)
    A(f'<text x="{X+dx}" y="{Y+dy}" font-size="{size}" font-weight="{w}" text-anchor="{anchor}" fill="#3b322b" paint-order="stroke" stroke="#f4f1e8" stroke-width="4">{t}</text>')


lab(1.5, -80, "① 무지개다리", 8, 4, "start")
lab(0, -91.8, "② 기억의 돌", 0, 34)
lab(-16, -64, "서쪽 산책길", -14, 0, "end")
lab(16, -64, "동쪽 산책길", 14, 0, "start")
lab(17, -79.5, "③ 징검다리", 14, 4, "start")
lab(-15, -91, "④ 기억 나무 (명패)", 0, 44)
lab(-8, -76, "꽃밭", 0, 28, size=12, w="500")
sx, sy = P(-28, -46.5)
A(f'<rect x="{sx}" y="{sy}" width="{10*S}" height="6" fill="#3b322b"/><text x="{sx}" y="{sy-6}" font-size="12" fill="#3b322b">10 m</text>')
nx, ny = P(25, -47)
A(f'<text x="{nx}" y="{ny}" font-size="16" font-weight="800" text-anchor="middle" fill="#3b322b">↑ 북 (−z)</text>')
A("</svg>")

legend = """
<div class="lg"><h1>무지개다리 정원 산책길</h1><p class="s" style="margin-top:2px">배치 스케치 (위에서 본 그림)</p>
<p class="s">마을 좌표(m). 추모관 앞마당에서 서쪽 길로 들어가 뒤편 정원을 돌고 동쪽 길로 돌아와요. 한 바퀴 약 115 m, 걸어서 1분 30초쯤.</p>
<ol>
<li><b>무지개다리</b> — 시냇물을 남북으로 건너는 원목 아치 다리(길이 5.8 m, 폭 2.2 m). 난간 덮개만 일곱 빛깔을 아주 옅게. 해 질 녘과 밤에는 다리 아래 물빛에 무지개가 은은하게 비쳐요.</li>
<li><b>기억의 돌</b> — 넓적한 자연석에 "무지개다리 너머, 다시 만날 때까지". 앞에 꽃 놓는 자리.</li>
<li><b>징검다리</b> — 돌아오는 길은 시냇물 돌 5개를 밟고 건너요.</li>
<li><b>기억 나무 12그루</b> — 나무 밑동에 작은 금속 명패. 누르면 그 아이 칸으로 가는 버튼(유료 후보).</li>
</ol>
<ul class="k">
<li><i style="background:#e2d2b2"></i>마사토 길 폭 1.5 m + 돌 경계석</li>
<li><i style="background:#8fc3d9"></i>시냇물 폭 2.6 m · 연못 (호수 물 셰이더 재사용)</li>
<li><i style="background:#ffd27a;border-radius:6px"></i>낮은 볼라드 등 13개 (밤에만 켜짐)</li>
<li><i style="background:#8a6440"></i>벤치 4개 (등받이 없음, 양쪽 앉기)</li>
<li><i style="background:#c9a6d6"></i>꽃밭 (수국·라벤더·국화)</li>
</ul>
<p class="s">점선 = plot_n 경계(28 × 24 m). 정원은 그 북쪽 x −26..27, z −94..−70 을 더 써요. 집 7·9(x ±31)와는 떨어져 있어요. 빌드 전에 마을 충돌 상자·지형·먼 산 배경과 겹치는지 확인해요.</p></div>"""

html = f"""<!doctype html><html lang="ko"><head><meta charset="utf-8"><link rel="stylesheet" href="common.css"><style>
body{{width:1440px;height:960px;display:flex;background:#f3efe6;overflow:hidden}}
.lg{{padding:34px 30px;width:440px}} h1{{font-size:24px;font-weight:800;line-height:1.3}} .s{{font-size:13.5px;color:#6c6158;margin-top:10px;line-height:1.55}}
ol{{margin:16px 0 0 20px;font-size:14.5px;line-height:1.55}} ol li{{margin-bottom:8px}} ul.k{{list-style:none;margin-top:12px;font-size:13.5px;line-height:2}}
ul.k i{{display:inline-block;width:18px;height:12px;margin-right:8px;vertical-align:middle;border-radius:2px}}</style></head><body>{''.join(svg)}{legend}</body></html>"""
pathlib.Path(__file__).with_name("plan_garden.html").write_text(html, encoding="utf-8")

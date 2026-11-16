"""Writes ../plan.svg: top-down plan of the proposed lake next to the village's east side."""
import math, os
import lake_layout as L

X0, X1, Z0, Z1 = 20, 192, -76, 50
S = 6.0
W, H = (X1 - X0) * S, (Z1 - Z0) * S + 70
def P(x, z): return (round((x - X0) * S, 1), round((z - Z0) * S, 1))
def pts(poly): return " ".join(f"{a},{b}" for a, b in (P(x, z) for x, z in poly))
def rect(b, **kw):
    x, y = P(b["minX"], b["minZ"])
    return f'<rect x="{x}" y="{y}" width="{(b["maxX"]-b["minX"])*S}" height="{(b["maxZ"]-b["minZ"])*S}" {attrs(kw)}/>'
def attrs(kw): return " ".join(f'{k.replace("_","-")}="{v}"' for k, v in kw.items())
def text(x, z, t, size=12, anchor="middle", **kw):
    a, b = P(x, z)
    return f'<text x="{a}" y="{b}" font-size="{size}" text-anchor="{anchor}" {attrs(kw)}>{t}</text>'

o = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="Malgun Gothic, Apple SD Gothic Neo, sans-serif">',
     f'<rect width="{W}" height="{H}" fill="#e9eedf"/>']
# lake area (new walk area) and outside-hills
o.append(rect(L.AREA, fill="#c9d3b4", stroke="#6b7a55", stroke_width=2, stroke_dasharray="8 5"))
o.append(f'<polygon points="{pts(L.WALK)}" fill="#dfe8c6" stroke="none"/>')
# old walk boundary x = 95
a, b = P(95, Z0); c, d = P(95, Z1)
o.append(f'<line x1="{a}" y1="{b}" x2="{c}" y2="{d}" stroke="#a33" stroke-width="2" stroke-dasharray="4 4"/>')
o.append(text(94, -72, "지금 걷기 경계 x=95", 12, "end", fill="#a33"))
o.append(text(140, -72, "새 호수 구역 x 95.5–186, z −69.5–45.5 (걷는 곳 = 연두색)", 13, fill="#4a5a35"))
# village context
cx, cz = P(0, 0)
o.append(f'<circle cx="{cx}" cy="{cz}" r="{37*S}" fill="#b9b9b4"/><circle cx="{cx}" cy="{cz}" r="{31*S}" fill="#d9d3c4"/>')
o.append(text(24, 0, "광장·순환도로", 13, fill="#555"))
for name, b, col in [("카페", dict(minX=40.6, maxX=60.6, minZ=-22.6, maxZ=-7.6), "#c8a98a"),
                     ("매점", dict(minX=46.1, maxX=51.1, minZ=-5.85, maxZ=-1.85), "#c8a98a"),
                     ("학교 부지", dict(minX=47, maxX=73, minZ=2, maxZ=28), "#e5dcc0"),
                     ("성당 부지", dict(minX=39, maxX=65, minZ=-50, maxZ=-24), "#e5dcc0"),
                     ("버스정류장", dict(minX=38.6, maxX=43.4, minZ=-10.8, maxZ=-1.4), "#bbb")]:
    o.append(rect(b, fill=col, stroke="#8a7a66"))
    o.append(text((b["minX"]+b["maxX"])/2, (b["minZ"]+b["maxZ"])/2 + 1, name, 11, fill="#4a4036"))
for x, z in [(70, -15), (74, 2), (80, -45), (66, 39), (71, 34), (76, 39), (81, 34)]:
    a, b = P(x, z); o.append(f'<circle cx="{a}" cy="{b}" r="5" fill="#5f7d4a"/>')
o.append(rect(dict(minX=70.7, maxX=73.3, minZ=-3.6, maxZ=-0.4), fill="#8b6b4a")); o.append(text(72, -4.5, "피크닉4", 10, fill="#555"))
# trail
o.append(f'<polyline points="{pts(L.TRAIL)}" fill="none" stroke="#b08a5a" stroke-width="{2.5*S}" stroke-linecap="round" stroke-linejoin="round"/>')
o.append(text(78, -12.5, "낚시터 가는 흙길 (폭 2.5 m)", 12, fill="#6b4f2c"))
# water + reeds
o.append(f'<polygon points="{pts(L.SHORE)}" fill="#6f8f7a" stroke="#4b6656" stroke-width="2"/>')
o.append(text(162, -14, "저수지 (약 5,300 m²)", 14, fill="#eaf2ea"))
o.append(text(162, -10.5, "수면 y −0.55 · 걷는 바닥 y 0", 11, fill="#eaf2ea"))
for (x, z), r in L.REEDS:
    a, b = P(x, z); o.append(f'<circle cx="{a}" cy="{b}" r="{r*S}" fill="#9aa860" opacity="0.8"/>')
o.append(text(171, 18, "갈대·부들", 11, fill="#2f3a1a"))
# decks
for b in L.DECKS: o.append(rect(b, fill="#a8814f", stroke="#5a4026"))
for b in (L.HUT_A, L.HUT_B): o.append(rect(b, fill="#5b6f84", stroke="#33404d"))
o.append(text(123, -3.5, "잔교 (폭 3 m, 길이 34 m) · P01–P16", 11, fill="#fff"))
o.append(text(152.5, -36, "좌대 A (A1–A4)", 12, fill="#fff")); o.append(text(152.5, 13, "좌대 B (B1–B4)", 12, fill="#fff"))
# shop + rental pad
o.append(rect(L.SHOP, fill="#d8c08e", stroke="#6b5532", stroke_width=2))
o.append(text(102, -22, "관리소·대여점", 12, fill="#3d2f17"))
a, b = P(*L.RENTAL_PAD); o.append(f'<circle cx="{a}" cy="{b}" r="{2.5*S}" fill="#ffd34d" opacity="0.55" stroke="#c99a00"/>')
o.append(text(L.RENTAL_PAD[0] - 4, L.RENTAL_PAD[1] + 0.8, "대여 자리", 11, "end", fill="#7a5a00"))
# pavilion
pc = L.PAVILION["centre"]; s = L.PAVILION["size"]
o.append(rect(dict(minX=pc[0]-s/2, maxX=pc[0]+s/2, minZ=pc[1]-s/2, maxZ=pc[1]+s/2), fill="#a0603a", stroke="#5a2f17"))
o.append(text(pc[0], pc[1] + 5, "정자 (등받이 없음)", 11, fill="#5a2f17"))
for x, z, f in L.BENCHES:
    o.append(rect(dict(minX=x-0.5, maxX=x+0.5, minZ=z-1.2, maxZ=z+1.2), fill="#7a5130"))
o.append(text(101.5, -33, "벤치(등받이)", 10, "end", fill="#5a3a20"))
for x, z in L.PICNIC:
    o.append(rect(dict(minX=x-1.2, maxX=x+1.2, minZ=z-1.6, maxZ=z+1.6), fill="#8b6b4a"))
o.append(text(97, 17.5, "피크닉 테이블", 10, "start", fill="#5a3a20"))
for x, z in L.LAMPS:
    a, b = P(x, z); o.append(f'<circle cx="{a}" cy="{b}" r="3" fill="#f7d36b" stroke="#7a6a2a"/>')
# spots + float targets
for sid, x, z, f in L.SPOTS:
    fx, fz = L.FACE[f]
    tx, tz = x + fx * L.CAST_M, z + fz * L.CAST_M
    a, b = P(x, z); c, d = P(tx, tz)
    o.append(f'<line x1="{a}" y1="{b}" x2="{c}" y2="{d}" stroke="#ffffff" stroke-width="1" stroke-dasharray="2 2" opacity="0.8"/>')
    o.append(f'<circle cx="{c}" cy="{d}" r="2.6" fill="#ff4a2a"/>')
    o.append(f'<circle cx="{a}" cy="{b}" r="4.2" fill="#1d4e89" stroke="#fff"/>')
    if sid in ("P03","P04","P05","P06","P07","P08","P09","P10","P11","P12"):
        continue
    lx, lz = x - fx * 2.4, z - fz * 2.4
    if sid.startswith("P") and f in ("n", "s"):
        lx, lz = x - 2.6, z + fz * 1.4
    o.append(text(lx, lz + 0.6, sid, 10, fill="#10243f", font_weight="bold"))
# legend
y0 = (Z1 - Z0) * S + 18
items = [("#1d4e89", "낚시 자리 30곳 (의자, 등받이 있음 → 앞에서만)"), ("#ff4a2a", "찌가 떨어지는 곳 (자리 앞 6 m)"),
         ("#f7d36b", "가로등(밤)"), ("#a8814f", "잔교·부교·좌대 (바닥 y 0)"), ("#dfe8c6", "걷는 땅"), ("#c9d3b4", "언덕·숲 (못 들어감)")]
for i, (col, t) in enumerate(items):
    x = 12 + (i % 3) * 360; y = y0 + (i // 3) * 24
    o.append(f'<rect x="{x}" y="{y-11}" width="14" height="14" fill="{col}" stroke="#333"/>')
    o.append(f'<text x="{x+20}" y="{y+1}" font-size="13">{t}</text>')
# north arrow + scale
o.append(f'<g transform="translate({W-40},40)"><polygon points="0,-22 8,6 0,0 -8,6" fill="#222"/><text y="22" font-size="13" text-anchor="middle">북</text></g>')
a, b = P(150, 46.5); o.append(f'<line x1="{a}" y1="{b}" x2="{a+20*S}" y2="{b}" stroke="#222" stroke-width="3"/>')
o.append(f'<text x="{a+10*S}" y="{b-6}" font-size="12" text-anchor="middle">20 m</text>')
o.append(text(22, -73, "서쪽 x −118의 폭포(B1)는 이 그림 밖, 호수에서 약 250 m", 12, "start", fill="#555"))
o.append("</svg>")
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "plan.svg")
open(out, "w", encoding="utf-8").write("\n".join(o))
print("wrote", os.path.normpath(out))

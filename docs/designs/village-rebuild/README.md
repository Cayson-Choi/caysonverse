# 마을 재빌드 vrb2 (2026-11-16)

원본 마을 소스(art/village/tools, 집·카페 재건 포함)로 village.glb를 다시 빌드·굽기. 바뀐 스크립트는 git이 무시하는
`art/` 아래에 있어서, 원본(11-15 live) 대비 전체 변경을 [`vrb2_tools.patch`](vrb2_tools.patch)로 남겨요.

## 재현 확인 (변경 없이 다시 빌드)
- 11-15 배치(fcdcf81 shared)로 build_village → 원본 village_authoring.blend와 객체 7,722개 비교: 모두 같음(버스 가림막만 버스 GLB 판 차이).
- 내보낸 GLB(+초승달 패치 +fix_sky_glare) vs 운영 village.glb: 노드 449개·충돌/좌석 표시·재질·삼각형 255,267개 동일, 97개 프리미티브의 형상 동일,
  이미지 21장 픽셀 동일(T_sky·T_backdrop은 바이트까지). 다른 것: 라이트맵 UV(TEXCOORD_1)와 배경 UV — Blender 5.3의 UV 포장기가 5.2와 달라서.

## 이번에 바뀐 것
1. 해 나누기 굽기(SUN_SPLIT): 낮 라이트맵에 해 직사광 없음, `asset.extras.cvLightmapSun = "live"`, 노멀 내보내기, 초승달 낮 프로브 재맞춤
   (`fit_moon_probe_split.py`, `MOON_PROBE_HAS_SUN = false`). 버스는 굽기에서 뺌(움직이고, 해 그림자는 실시간).
2. 폭포 사이트 상자(x −140..−100, z −104..−58): 옛 절벽·바위·리본·안개·소·숲 카드를 소스에서 빼고 `falls_site.py`가 땅·배경을 상자에서 자름.
   이음매 높이는 waterfall.glb가 맞춘 `waterfall_site_edge.json` 그대로(다시 쓴 파일이 1e-7 안에서 같음). 위치 Draco 18비트.
3. 먼 산: 배경 지형 ±260 m, mid/mount 항 삭제, 숲 카드 240 m 안(같은 난수 순서라 남는 나무는 제자리).
4. 바닥: T_plaza 한 장 대신 광장 화강석 판석(돌마다 면, T_setts 3.5 mm/텍셀, 아래 절반은 보도 판석), 도로(T_road: 도로 좌표로 그린 선 —
   매끄러운 곡선, 한국 규격 횡단보도 45/45 cm 6줄, 신호 있는 두 곳 정지선, 버스 정차 구간 중앙선 없음), 부지 잔디를 실제 크기 잔디로, 부지 하늘색 빛 띠 삭제.
5. 버스 정류장(village_busstop.glb, build_busstop.py): 한국 표준 쉘터, 0.85 m 뒤로.

## 다시 만들기
```
python tools/make_textures.py tiles setts road plaza ; python tools/make_busstop_textures.py   (art/village에서)
npx tsx scripts/export-village-layout.ts art/village/layout.json ; cp client/public/models/village/village_bus.glb art/village/export/
blender -b --factory-startup -P tools/build_village.py
blender -b work/village_authoring.blend -P tools/bake_village.py -- --samples 384      (GPU 약 20분)
blender -b work/village_lmprep.blend -P tools/bake_village.py -- --night --samples 384  (약 10분)
node scripts/patch-village-moon.mjs <export/village.glb> --out <moon.glb> ; python tools/fix_sky_glare.py <moon.glb> <client village.glb>
라이트맵 WebP 낮 82 / 밤 76, extract-colliders, extract-seat-markers, check-school-glb village
blender -b work/village_lmprep.blend -P tools/fit_moon_probe_split.py   (해·하늘이 바뀌면)
```

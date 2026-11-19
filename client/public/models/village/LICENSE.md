# 케이슨 마을 모델 — 자산 기록

`village.glb`와 `village_lm.webp`는 이 프로젝트에서 Blender와 스크립트로 직접 만든 것입니다(`art/village/tools/`, 저장소에는 올리지 않음).
재료로 쓴 외부 자산은 모두 Poly Haven(https://polyhaven.com)의 CC0 1.0 Universal 자산이고, 2026-11-03에 Poly Haven API
(https://api.polyhaven.com)로 이름과 라이선스를 확인하고 내려받았습니다. AI로 만든 모델·텍스처는 없습니다.

| Poly Haven 자산 | 주소 | 쓰는 곳 (GLB 안의 텍스처) |
| --- | --- | --- |
| leafy_grass | https://polyhaven.com/a/leafy_grass | 잔디 `T_grass`, 광장 그림 `T_plaza`의 풀, 부지 잔디 `T_lawn` |
| rock_boulder_dry | https://polyhaven.com/a/rock_boulder_dry | 화강암 `T_stone`, 바위 `T_rock`, 광장 판석, 폭포 절벽(배경 텍스처에 구움) |
| clean_asphalt | https://polyhaven.com/a/clean_asphalt | 순환 도로 (`T_plaza`) |
| concrete_pavers | https://polyhaven.com/a/concrete_pavers | 보도 블록 (`T_plaza`) |
| asphalt_04 | https://polyhaven.com/a/asphalt_04 | 마을 길 콘크리트 `T_concrete` |
| white_plaster_02 | https://polyhaven.com/a/white_plaster_02 | 흰 벽 `T_render` |
| wood_planks | https://polyhaven.com/a/wood_planks | 나무 `T_wood` |
| roof_slates_02 | https://polyhaven.com/a/roof_slates_02 | 지붕 `T_roof` |
| stone_wall | https://polyhaven.com/a/stone_wall | 돌담 `T_wall` |
| sakura_bark | https://polyhaven.com/a/sakura_bark | 벚나무 껍질 (`T_bark`) |
| japanese_zelkova_bark | https://polyhaven.com/a/japanese_zelkova_bark | 느티나무·나무 껍질 (`T_bark`) |
| island_tree_01 (잎 텍스처만) | https://polyhaven.com/a/island_tree_01 | 잎 그림을 잘라 만든 잎·벚꽃·꽃밭 카드 |
| kloppenheim_06_puresky (HDRI 2k) | https://polyhaven.com/a/kloppenheim_06_puresky | 굽기 조명(하늘빛), 하늘 돔 `T_sky` |

그 밖의 그림(광장 판석 무늬, 벚꽃·꽃·갈대·꽃잎 카드, 창·유리·실내·버스·차양·현수막, 물·폭포)은 `make_textures.py`가 직접 그렸습니다.

## 추모관 실내 (`memorial.glb`, `memorial_lm.webp`, `memorial_props.glb`) — 케이슨 마을 1단계 Task 8

세 파일 모두 이 프로젝트에서 Blender와 스크립트로 직접 만든 것입니다(`art/village/tools/build_memorial.py`, `bake_memorial.py`,
`build_props.py`, `render_garden.py`, `make_memorial_textures.py`, 저장소에는 올리지 않음). AI로 만든 모델·텍스처는 없습니다.
바닥·참나무·흰 래커·패브릭·작은 부품 색 텍스처와 칸 소품 텍스처는 스크립트가 직접 그렸고(절차적), 외부 재료는 위 표와 같은
Poly Haven CC0 1.0 자산만 썼습니다.

| Poly Haven 자산 | 주소 | 쓰는 곳 |
| --- | --- | --- |
| white_plaster_02 | https://polyhaven.com/a/white_plaster_02 | 흰 벽·천장 `T_m_plaster`의 결 |
| kloppenheim_06_puresky (HDRI 2k) | https://polyhaven.com/a/kloppenheim_06_puresky | 창으로 드는 하늘빛(라이트맵 굽기), 창밖 정원 그림의 하늘 |
| leafy_grass | https://polyhaven.com/a/leafy_grass | 창밖 정원 그림 `T_m_garden`의 잔디 |
| precast_stone_paving | https://polyhaven.com/a/precast_stone_paving | 창밖 정원 그림의 돌길 |
| island_tree_01 (잎 텍스처만), japanese_zelkova_bark, sakura_bark | 위 표 | 창밖 정원 그림의 나무(마을과 같은 잎·껍질 텍스처) |

## 마을버스 (`village_bus.glb`) — 2026-11-11

이 프로젝트에서 Blender와 스크립트로 직접 만든 것입니다(`art/village/tools/build_bus.py`, `make_bus_textures.py`, 저장소에는
올리지 않음). 3D 생성 AI, 사진, 외부 모델은 쓰지 않았습니다. 형상은 9 m급 저상 마을버스의 공개 치수(전장·전폭·축거·오버행·타이어
규격)와 비율만 참고해 코드로 만들었고, 제조사 엠블럼·회사 도색·노선 번호는 넣지 않았습니다. 도색, 휠체어·유모차 그림,
타이어·휠·루버 텍스처는 모두 스크립트가 직접 그렸습니다. 외부 모델·사진 자산은 없습니다.

- 도색(2026-11-11 4차, 발주자가 고른 1안 "달빛 남색"): 진주빛 흰 차체, 아래 몰딩부터 0.70 m까지 남색 아랫단, 그 위 보라색 가는
  줄 하나, 흰 지붕 띠. 무늬·배지는 없습니다(뒤 범퍼의 반사판도 줄무늬 없는 빨간 사각형, 4차 다듬기).
- 글자는 이 마을의 이름뿐입니다. 양옆과 뒤의 "☾ 케이슨 마을"(초승달은 분수의 초승달 모양을 스크립트로 그림)은 주아체(Jua,
  Copyright 2018 The Jua Project Authors, SIL Open Font License 1.1)로 그렸습니다. 글꼴 파일과 라이선스 전문(`OFL.txt`)은
  `art/village/fonts/`에 함께 두었고, GLB에는 글꼴 파일이 아니라 그려진 글자 그림만 들어 있습니다.
- 행선지 LED(앞·옆 "케이슨 마을", 뒤 "마을버스")는 Windows의 맑은 고딕 Bold로 쓴 글자를 1비트 점으로 찍어 그린 그림입니다
  (글꼴 파일은 넣지 않음).
버스 아래 도로에 까는 접지 그림자(`M_bus_ground`의 그림)도 같은 스크립트가 이 버스 모델 자체로 Blender에서 구운 앰비언트
오클루전입니다(2026-11-11 2차, 외부 자산 없음).

## 추모관 실내 다시 짓기 (`memorial.glb`, `memorial_lm.webp`, `memorial_lm_1k.webp`, `memorial_lm_night.webp`, `memorial_lm_night_1k.webp`, `memorial_garden_night.webp`) — 2026-11-13

`memorial.glb`는 옛 방을 늘이지 않고 설계안(15 × 12 m, 천장 4.5 m)대로 Blender와 스크립트로 처음부터 다시 만들었습니다
(`art/village/tools/build_memorial.py`, `make_memorial_textures.py`, `bake_memorial.py`, `post_memorial.py`, 저장소에는 올리지 않음).
모양은 직접 모델링했고 AI로 만든 모델·텍스처는 없습니다. 낮·밤 라이트맵(2048 px와 폰용 1024 px)은 같은 Blender 장면을 굽습니다.
앉는 자리 자료(`shared/src/village/generated/memorialSeats.ts`)와 충돌 상자는 이 모델의 `seat__*`·`col__*` 표식에서 뽑습니다.

| 자산 | 출처 | 라이선스 | 쓰는 곳 |
| --- | --- | --- | --- |
| Noto Sans KR (`NotoSansKR-VF.ttf`) | Copyright The Noto Project Authors (https://github.com/notofonts/noto-cjk) | SIL Open Font License 1.1 | 실내 표지 글씨(구역 명패, "기억의 자리", 브랜드 벽, 안내도, 키오스크 화면, 우체통, 티 코너, 헌화 꽃)를 구운 `T_m_signs` 텍스처와 외벽 명판의 입체 글자 `memorial_facade_letters`. |
| white_plaster_02 (Poly Haven) | https://polyhaven.com/a/white_plaster_02 | CC0 1.0 | 흰 벽·천장 결 (위 표와 같음) |
| kloppenheim_06_puresky (HDRI 2k) | https://polyhaven.com/a/kloppenheim_06_puresky | CC0 1.0 | 낮 굽기의 하늘빛, 창밖 정원 그림의 하늘 |
| leafy_grass, precast_stone_paving, island_tree_01(잎), japanese_zelkova_bark, sakura_bark (Poly Haven) | 위 표들 | CC0 1.0 | 창밖 정원 그림(낮 `T_m_garden`, 밤 `memorial_garden_night.webp`은 같은 그림을 어둡게 고쳐 별·달·정원등을 그린 것) |

바닥 마루, 참나무, 래커, 패브릭, 작은 부품 색, 거실 액자 그림(강아지 수채화 느낌)은 스크립트가 직접 그렸습니다(절차적). 실사 견본 사진은 다음 단계(견본 칸)에서 출처와 함께 이 문서에 적습니다.

## 런타임 식생 텍스처 (`veg/`) — 2026-11-16

나무 껍질(`bark_*`), 화단 흙(`soil_*`), 화분 테두리 돌(`stone_*`)은 `docs/designs/plants2/tools/make_veg_textures.py`가 아래
Poly Haven CC0 1.0 자산으로 만든 것입니다(2026-11-16 Poly Haven API로 내려받음). 흙의 바크 칩은 같은 껍질 사진을 잘라 붙였고,
자갈·꽃잎·잎은 스크립트가 그렸습니다. AI로 만든 텍스처는 없습니다.

| Poly Haven 자산 | 주소 | 쓰는 곳 |
| --- | --- | --- |
| sakura_bark | https://polyhaven.com/a/sakura_bark | 벚나무 껍질 `bark_cherry_*`, 바크 칩 |
| japanese_zelkova_bark | https://polyhaven.com/a/japanese_zelkova_bark | 느티나무·활엽수 껍질 `bark_plates_*`, 바크 칩 |
| bark_willow | https://polyhaven.com/a/bark_willow | 버드나무 껍질 `bark_willow_*`, 바크 칩 |
| japanese_hackberry_bark | https://polyhaven.com/a/japanese_hackberry_bark | 어린 나무 껍질 `bark_smooth_*` |
| bark_brown_02 | https://polyhaven.com/a/bark_brown_02 | 과수원 나무 껍질 `bark_plum_*`, 바크 칩 |
| brown_mud | https://polyhaven.com/a/brown_mud | 화단 흙 바탕 `soil_*` |
| rock_boulder_dry | https://polyhaven.com/a/rock_boulder_dry | 사각 화분 테두리 `stone_*` |

## 호수 숲·버드나무·갈대, 절 소나무 (식생 개선, 2026-11-18)

호수의 숲(자작나무·참나무·너도밤나무)·버드나무와 절 마당의 소나무는 코드로 가지를 뻗어 만든 3D 나무(`client/src/village/veg/treeKit.ts`)이고, 줄기·가지의 껍질은
위 표의 **기존 Poly Haven CC0 1.0 껍질 사진을 그대로 다시 씁니다**(새로 내려받은 것 없음). 자작나무·너도밤나무는 `bark_smooth_*`
(japanese_hackberry_bark), 참나무와 소나무(붉은 갈색으로 물들임)는 `bark_plates_*`(japanese_zelkova_bark), 버드나무는 `bark_willow_*`(bark_willow)입니다.
잎·솔잎·갈대·부들·풀 그림(`client/src/village/veg/leafAtlas.ts`)은 스크립트가 직접 그린 것(절차적)이고, 저작권이 걸린 사진을 쓰지 않았습니다.
## 집 외관 2차 (2026-11-18)

`houses/house_wood_*`, `house_sandstone_*`, `house_tile_*`는 Poly Haven CC0 1.0 자산을 가공한 것입니다(2026-11-18 API로 내려받음).

| Poly Haven 자산 | 주소 | 쓰는 곳 |
| --- | --- | --- |
| dark_wood | https://polyhaven.com/a/dark_wood | 참나무 보·기둥·베란다 판자 `house_wood_*` |
| mossy_sandstone | https://polyhaven.com/a/mossy_sandstone | 사암 `house_sandstone_*` (이끼 얼룩은 지우고 한 덩이의 결만 씀) |
| clay_roof_tiles_03 | https://polyhaven.com/a/clay_roof_tiles_03 | 기와 `house_tile_*`, 케이슨랜드 정문 첨탑 |

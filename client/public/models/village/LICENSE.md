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
  줄 하나, 흰 지붕 띠. 무늬·배지는 없습니다.
- 글자는 이 마을의 이름뿐입니다. 양옆과 뒤의 "☾ 케이슨 마을"(초승달은 분수의 초승달 모양을 스크립트로 그림)은 주아체(Jua,
  Copyright 2018 The Jua Project Authors, SIL Open Font License 1.1)로 그렸습니다. 글꼴 파일과 라이선스 전문(`OFL.txt`)은
  `art/village/fonts/`에 함께 두었고, GLB에는 글꼴 파일이 아니라 그려진 글자 그림만 들어 있습니다.
- 행선지 LED(앞·옆 "케이슨 마을", 뒤 "마을버스")는 Windows의 맑은 고딕 Bold로 쓴 글자를 1비트 점으로 찍어 그린 그림입니다
  (글꼴 파일은 넣지 않음).
버스 아래 도로에 까는 접지 그림자(`M_bus_ground`의 그림)도 같은 스크립트가 이 버스 모델 자체로 Blender에서 구운 앰비언트
오클루전입니다(2026-11-11 2차, 외부 자산 없음).

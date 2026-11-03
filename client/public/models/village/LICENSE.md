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

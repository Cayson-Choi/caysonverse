# 집 실내 공용 텍스처 (realism pass 2026-11-17)

`hi/` (PC) · `lo/` (폰, 절반 크기)의 `T_h_*.webp`는 집 10채가 함께 쓰는 알베도예요. 각 `house_N.glb`에는 같은 이름의 128 px 사본만 들어 있고,
게임이 들어갈 때 이 파일로 바꿔 끼워요(`client/src/village/houseModelPrep.ts` `applyHouseTextures`). 만드는 법: `art/village/tools/houses/make_house_textures_real.py`.

| 파일 | 원본 | 라이선스 |
| --- | --- | --- |
| `T_h_floor_oak` (헤링본 원목 마루) | Poly Haven `herringbone_parquet` (https://polyhaven.com/a/herringbone_parquet) | CC0 1.0 |
| `T_h_floor_oakL` | Poly Haven `laminate_floor_02` (https://polyhaven.com/a/laminate_floor_02) | CC0 1.0 |
| `T_h_floor_dark` | Poly Haven `dark_wooden_planks` | CC0 1.0 |
| `T_h_plaster`, `T_h_wp*` (라임워시 벽 + 아래 판넬 몰딩(웨인스코팅)은 직접 그림) | Poly Haven `plastered_wall` + ambientCG `Wallpaper001A` 노멀 | CC0 1.0 |
| `T_h_wood_oak` | Poly Haven `oak_veneer_01` | CC0 1.0 |
| `T_h_wood_walnut` | Poly Haven `natural_walnut_veneer` | CC0 1.0 |
| `T_h_wood_dark` | Poly Haven `dark_wood` | CC0 1.0 |
| `T_h_wood_pine`, `T_h_logwall` (통나무 벽은 결만 쓰고 통나무 모양·틈은 직접 그림) | Poly Haven `coated_pine_02` | CC0 1.0 |
| `T_h_tile_white` (흰 서브웨이 타일) | Poly Haven `long_white_tiles` | CC0 1.0 |
| `T_h_tile_grey` (무늬 시멘트 타일, 무늬는 직접 그림) | 직접 제작(절차 생성) | 직접 제작 |
| `T_h_leather` | Poly Haven `brown_leather` | CC0 1.0 |
| `T_h_stone` (대리석·석재 상판, 난로 앞 받침) | Poly Haven `marble_01` | CC0 1.0 |
| `T_h_floral` (다마스크 리넨: 커튼·퀼트·쿠션) | Poly Haven `floral_jacquard` | CC0 1.0 |
| `T_h_check` (깅엄 체크 리넨: 체크 안락의자·쿠션·커튼, 체크 무늬는 직접 그림) | ambientCG `Fabric030` 노멀(짜임 요철) | CC0 1.0 |
| `T_h_fabric` | ambientCG `Fabric030` (https://ambientcg.com/view?id=Fabric030) | CC0 1.0 |
| `T_h_rattan` | ambientCG `Wicker007B` | CC0 1.0 |
| `T_h_rug` | ambientCG `Carpet016` | CC0 1.0 |
| `T_h_jangpan`, `T_h_paper`, `T_h_bamboo`, `T_h_jagae`, `T_h_leaf`, `T_h_atlas` | 직접 제작(절차 생성) | 직접 제작 |

게임은 집을 조명 없이(unlit) 라이트맵으로 그려서 노멀·거칠기 맵을 실시간으로 쓰지 않아요. 대신 스캔의 노멀과 AO로 만든 요철(널빤지 틈, 천의 짜임, 돌 줄눈)을
알베도에 구워 넣었어요.

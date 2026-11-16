# M1 PBR 재질 라이브러리 (케이슨 마을 실사화)

아트 디렉터 계획(2026-11-16, PLAN.md 3장 "표면별 PBR 재질 사양"과 M1 묶음)의 결과물이에요. 마을의 땅, 건물 안팎, 사물이 쓸 **사진 스캔 기반 CC0 PBR 세트**와, 그것을 게임에서 바로 쓰는 로더 API, 확인용 룩데브 페이지를 담고 있어요. 마을 GLB 재질을 이 세트로 바꾸는 일은 G1(LM-PBR 셰이더)과 vrb2(바닥) 담당이에요. 이 라이브러리는 재료만 줘요.

## 무엇이 어디에 있나

| 경로 | 내용 |
| --- | --- |
| `art/materials/materials.json` | 세트 목록(사람이 고치는 원본): 출처, 실제 타일 크기, 목표 밀도, 쓰는 곳, 가공 옵션 |
| `scripts/build-materials.mjs` | 내려받기 → 가공 → 이음매 검사 → KTX2 인코딩 → 매니페스트/README 표 생성 |
| `art/materials/tools/` | 빌드 도구(sharp, ktx2-encoder = Basis Universal wasm, fflate). `npm --prefix art/materials/tools ci`로 설치. 앱 번들에는 들어가지 않아요. `shoot-lookdev.mjs`는 룩데브 스크린샷 |
| `art/materials/src/` | 내려받은 원본(커밋하지 않음, `art/`는 git 무시). 원본 URL과 md5는 `src/*/source.json`과 `build-report.json`에 있어요 |
| `client/public/textures/pbr/2k/`, `1k/` | 결과 텍스처 `<id>_{albedo,normal,orm}.ktx2` |
| `client/public/textures/pbr/basis/` | 설치된 three 0.185와 짝인 Basis 트랜스코더(Apache-2.0, three 패키지에서 복사) |
| `client/src/village/pbr/pbrLibrary.ts` | 로더 API (`getPbrSet`, `createPbrMaterial`, ...) |
| `client/src/village/pbr/pbrManifest.generated.ts` | 빌드가 만드는 매니페스트(파일 크기, 해시, 타일 크기, 평균색) |
| `client/dev/pbr-lookdev.html` | 룩데브: 모든 세트를 구와 바닥/벽/지붕 견본에 올려 마을의 낮·밤 빛으로 보여 줘요 |

## 세트 구성 (텍스처 3장)

| 맵 | 내용 | 색 공간 | 코덱 | 해상도 |
| --- | --- | --- | --- | --- |
| `albedo` | 색 | sRGB | ETC1S (BasisLZ) | 2K(PC), 1K(폰) |
| `normal` | 노멀, OpenGL(+Y 위) | 선형(NoColorSpace) | UASTC + RDO(λ1) + Zstd | 1K. 판석과 보도블록만 2K도 있음 |
| `orm` | R = AO, G = 거칠기, B = 금속 | 선형 | UASTC + RDO(λ1) + Zstd | 1K (PC와 폰 공용) |

- ORM 한 장을 `aoMap`, `roughnessMap`, `metalnessMap` 세 자리에 같이 꽂아요(three는 aoMap.r, roughnessMap.g, metalnessMap.b를 읽어요). `roughness = metalness = 1`로 둬야 스캔 값이 그대로 나와요(three는 스칼라와 맵을 곱해요).
- 노멀과 ORM을 UASTC로 한 이유: ETC1S로 줄이면 아스팔트 요철이 4x4 블록으로 뭉개지고(PSNR 26 dB, UASTC 34 dB), 하이라이트를 반짝이게 하는 거칠기 점무늬가 지워졌어요. RDO λ1은 구조가 있는 맵에서 크기를 40% 줄이고 눈에 보이는 차이가 없었어요(λ2부터 줄눈에 블록이 보임).
- 모든 파일은 밉맵 전체 단계를 가지고 있어요. PC에서는 BC7, 아이폰에서는 ETC2(알베도)와 ASTC 4x4(노멀, ORM)로 풀려요.

## 쓰는 법

```ts
import { getPbrSet, createPbrMaterial, pbrTierFor } from "../village/pbr/pbrLibrary";

const set = await getPbrSet("plaza_granite", pbrTierFor(qualityTier), gl);   // gl = WebGLRenderer
const mat = createPbrMaterial(set, { repeatMeters: [uMeters, vMeters] });     // UV 1칸이 몇 m인지
mesh.material = mat;
```

- **처음 다운로드에 들어가지 않아요.** 아무도 `getPbrSet`을 부르지 않으면 텍스처도 트랜스코더도 받지 않아요. 같은 세트를 동시에 여러 번 불러도 한 번만 받아요.
- **반복(repeat)**: `repeatMeters`(UV 한 칸이 덮는 실제 m)를 주면 세트의 실제 타일 크기로 반복 수를 계산해요. 직접 `repeat`를 줘도 돼요. 반복이 다른 재질끼리도 GPU 업로드는 하나를 같이 써요(복제 텍스처가 `source`를 공유).
- **UV 규칙**: glTF처럼 v가 아래로 가는 규칙(flipY 꺼짐)이에요. 우리 GLB 메시에는 그대로 맞아요. three 기본 도형(PlaneGeometry 등)에 쓰려면 `flipGeometryV(geometry)`를 한 번 불러요.
- **노멀 방향**: 탄젠트 속성이 없는 메시(우리 GLB 전부)에서는 `normalScale.y = -1`이어야 해요. GLTFLoader와 같은 규칙이고, `createPbrMaterial`이 기본으로 그렇게 해요. 탄젠트가 있으면 `meshHasTangents: true`.
- **색 바꾸기**: `params: { color }`로 알베도를 곱해서 바꿔요(드라이비트 미색, 강판 파랑, 패브릭 색 등). 회색이나 흰색 세트(stucco_white, ceramic_siding, metal_roof_seam, wallpaper, steel_painted, fabric_upholstery)는 이렇게 쓰라고 만든 거예요.
- **G1(라이트맵 위 PBR)**: 라이트맵 재질에 넣을 때는 `set.map / set.normalMap / set.orm`을 직접 쓰고, 반복은 `pbrTextures(set, { repeat })`로 받으면 돼요. 평균색(`info.meanAlbedo`)은 먼 거리 LOD나 라이트맵 색 맞추기에 써요.
- **메모리 해제**: 장면을 떠날 때 `releasePbrSet(id, tier)`.

## 예산 (PLAN.md 3장, 7장)

- **GPU 메모리**(밉 포함 추정, `pbrGpuBytes`): PC 2K 세트 하나 약 8.4 MB(BC7: 2K 알베도 5.6 + 1K 노멀 1.4 + 1K ORM 1.4; 판석과 보도블록은 2K 노멀이라 약 12.6 MB). 폰 1K 세트 하나 약 3.5 MB(ETC2 알베도 0.7 + ASTC 노멀 1.4 + ASTC ORM 1.4). 그래서 **PC 180 MB 안에 2K 세트 14개 이상(일반 세트로는 21개), 폰 60 MB 안에 1K 세트 17개**가 들어가요. 테스트가 이 두 줄을 지켜요.
- **다운로드**: 폰 세트 하나가 약 0.8~2.7 MB예요(라이브러리 전체는 디스크 약 78 MB: 2K 27 MB, 1K 50 MB, 트랜스코더 0.6 MB). 첫 진입 +6 MB 예산을 지키려면 첫 화면(광장)에 보이는 세트만 먼저 부르고 나머지는 그 뒤에 불러요. 세트별 크기는 아래 표와 `pbrDownloadBytes(id, tier)`에 있어요.
- **세트 수**: 라이브러리는 27세트예요. 계획의 "재질 세트 25개 이하"는 한 장면이 동시에 쓰는 수로 보고, G1/vrb2가 장면에서 고를 때 지켜요.

## 텍스처 밀도 가이드 (1인칭 1 m에서 흐리지 않게)

- 목표: 땅과 벽 512 px/m, 판석, 보도블록, 연석, 바닥재, 가구 1024 px/m (PLAN.md 3장 표).
- 표의 "px/m PC / 폰"은 실제 크기 그대로 반복했을 때의 알베도 밀도예요. 타일 크기를 바꾸면(예: 반복을 2배) 무늬 크기가 실제와 달라지니, **크기는 실제 그대로 두고** 해상도가 모자란 곳은 디테일 섞기(G1의 거리 기반 디테일 타일)로 채워요.
- `roof_shingle`은 원본 한 장이 8 m라서 256 px/m예요. 지붕은 2 m 안까지 다가가지 않는 곳에만 써요.
- 반복 무늬가 10 m 밖에서 보이지 않게, 넓은 면(잔디, 아스팔트, 판석)은 매크로 변화 맵(얼룩, 때)을 셰이더에서 섞어요(G1, vrb2).

## 세트 목록

아래 표는 `scripts/build-materials.mjs`가 매번 다시 써요(크기는 KB).

<!-- sets:start -->
| id | 이름 | 쓰는 곳 | 타일 크기 (m) | px/m PC / 폰 | 2K 파일 KB (albedo / normal) | 1K 파일 KB (albedo / normal / ORM) | 출처 (CC0) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `asphalt` | 아스팔트 (마을 순환 도로, 주차장) | Road surface: ring road, parking. Fine cracks; tyre-mark/patch macro variation is G1/vrb2's job. | 3 | 683 / 341 (목표 512) | 901 / - | 251 / 1272 / 1283 | [polyhaven asphalt_02](https://polyhaven.com/a/asphalt_02) |
| `sidewalk_pavers` | 보도블록 (인터로킹 200x100) | Sidewalks and bus-stop apron: grey 200x100 concrete blocks in running bond. | 3.1 | 661 / 330 (목표 1024) | 872 / 2266 | 241 / 594 / 937 | [polyhaven pavement_04](https://polyhaven.com/a/pavement_04) |
| `plaza_granite` | 광장 화강석 판석 | Plaza slabs: grey granite (거창석-like) large-format slabs with real joints. Add per-slab tint jitter and water-stain macro in the shader. | 1.8 | 1138 / 569 (목표 1024) | 882 / 4434 | 247 / 1082 / 464 | [polyhaven granite_tile_03](https://polyhaven.com/a/granite_tile_03) |
| `granite_flamed` | 화강석 버너 마감 (연석, 화분대, 분수 갓돌) | Jointless flamed granite for curbs (1 m segments: put the joint in the geometry), planter copings, fountain basin, bollards, steps. | 1 (추정) | 2048 / 1024 (목표 1024) | 906 / - | 258 / 1264 / 815 | [ambientcg Granite002A](https://ambientcg.com/view?id=Granite002A) |
| `grass` | 잔디 | Lawns and empty lots. Real lawn photo scan; desaturated a little toward Korean countryside grass. Blend with dirt_path through a mask for worn patches. | 1.4 | 1463 / 731 (목표 512) | 1037 / - | 282 / 1314 / 1189 | [ambientcg Grass004](https://ambientcg.com/view?id=Grass004) |
| `dirt_path` | 흙길 (마사토) | Footpaths, worn ground under benches, field edges, flower-bed soil. | 3 | 683 / 341 (목표 512) | 964 / - | 268 / 1273 / 1253 | [polyhaven park_dirt](https://polyhaven.com/a/park_dirt) |
| `gravel` | 자갈 (강자갈) | Creek bed and banks, drainage strips, gravel parking, under the pavilion eaves. | 1.5 | 1365 / 683 (목표 512) | 936 / - | 273 / 1318 / 1144 | [ambientcg Gravel022](https://ambientcg.com/view?id=Gravel022) |
| `stucco_white` | 드라이비트 (흰색 스타코) | Korean countryside house walls (드라이비트/스타코 흰색·미색). Tint with material.color for off-white; add rain streaks under windows as a macro mask. | 2 | 1024 / 512 (목표 512) | 726 / - | 197 / 1150 / 402 | [polyhaven white_stucco](https://polyhaven.com/a/white_stucco) |
| `ceramic_siding` | 세라믹 사이딩 (가로 패널) | Horizontal fibre-cement / ceramic lap siding on house walls and gables. Grey; tint for beige/white variants. | 1.96 | 1045 / 522 (목표 512) | 558 / - | 157 / 1074 / 415 | [polyhaven exterior_wall_cladding_03](https://polyhaven.com/a/exterior_wall_cladding_03) |
| `wood_siding` | 목재 사이딩 | Horizontal lap wood siding: the cafe, the bait shop, sheds. | 2 | 1024 / 512 (목표 512) | 682 / - | 192 / 667 / 508 | [polyhaven wooden_planks](https://polyhaven.com/a/wooden_planks) |
| `metal_roof_seam` | 징크 / 칼라강판 지붕 | Standing-seam style metal roofs (리얼징크, 칼라강판), container and shed walls, fence sheets. Recoloured to dark zinc grey; tint with material.color for blue/red 강판. | 2 | 1024 / 512 (목표 512) | 391 / - | 97 / 518 / 758 | [polyhaven box_profile_metal_sheet](https://polyhaven.com/a/box_profile_metal_sheet) |
| `roof_shingle` | 아스팔트 슁글 | Asphalt shingle roofs of the newer houses. | 8 | 256 / 128 (목표 512) | 837 / - | 243 / 994 / 1019 | [polyhaven grey_roof_01](https://polyhaven.com/a/grey_roof_01) |
| `roof_giwa` | 기와 (짙은 회색 점토 기와) | Pavilion (정자) and traditional roofs: dark grey clay tiles in rows, ridges in the normal map. Lay the rows along the eaves. | 2 (추정) | 1024 / 512 (목표 512) | 483 / - | 151 / 439 / 777 | [ambientcg RoofingTiles013A](https://ambientcg.com/view?id=RoofingTiles013A) |
| `concrete_exposed` | 노출 콘크리트 | Memorial hall walls, foundations, retaining walls, utility poles' bases, L-gutters. | 2.16 | 948 / 474 (목표 512) | 766 / - | 210 / 622 / 823 | [polyhaven concrete_wall_007](https://polyhaven.com/a/concrete_wall_007) |
| `brick_red` | 적벽돌 | Red-brick houses, garden walls, chimneys. | 1 | 2048 / 1024 (목표 1024) | 966 / - | 270 / 1250 / 1009 | [polyhaven red_brick_03](https://polyhaven.com/a/red_brick_03) |
| `rock` | 자연석 바위 | Creek boulders, stone-wall stones, landscaping rocks (same source as today's T_rock/T_stone, now with normal + roughness). | 1.8 | 1138 / 569 (목표 512) | 907 / - | 257 / 1134 / 1063 | [polyhaven rock_boulder_dry](https://polyhaven.com/a/rock_boulder_dry) |
| `floor_wood` | 원목 마루 | Interior hardwood floors (houses, cafe, memorial hall). | 1.7 | 1205 / 602 (목표 1024) | 796 / - | 220 / 424 / 798 | [polyhaven wood_floor](https://polyhaven.com/a/wood_floor) |
| `floor_laminate` | 강마루 (밝은 오크) | Light-oak laminate floors typical of Korean houses and apartments. | 1.7 | 1205 / 602 (목표 1024) | 811 / - | 218 / 429 / 602 | [polyhaven laminate_floor_02](https://polyhaven.com/a/laminate_floor_02) |
| `tile_white` | 흰색 타일 (욕실, 주방 벽) | Bathroom and kitchen wall tiles, cafe counter front. | 1.27 | 1613 / 806 (목표 1024) | 737 / - | 198 / 688 / 662 | [polyhaven long_white_tiles](https://polyhaven.com/a/long_white_tiles) |
| `wallpaper` | 벽지 (흰색 실크/우드칩) | Interior walls and ceilings. Tint with material.color for beige or pastel wallpaper. | 1 (추정) | 2048 / 1024 (목표 512) | 525 / - | 133 / 1122 / 409 | [ambientcg Wallpaper001A](https://ambientcg.com/view?id=Wallpaper001A) |
| `plaster_painted` | 도장 미장벽 | Painted plaster walls (cafe, memorial hall back rooms, stairwells). | 2 | 1024 / 512 (목표 512) | 780 / - | 217 / 1142 / 556 | [polyhaven painted_plaster_wall](https://polyhaven.com/a/painted_plaster_wall) |
| `wood_deck` | 데크 목재 | Outdoor decks, the cafe terrace, bridge planks, picnic tables, bench slats (rotate UVs along the slat). | 1.8 | 1138 / 569 (목표 1024) | 874 / - | 244 / 677 / 967 | [polyhaven wood_floor_deck](https://polyhaven.com/a/wood_floor_deck) |
| `wood_oak` | 오크 무늬목 (가구) | Furniture, door leaves, counters, frames, the pavilion's oiled pillars (tint darker). | 1.83 | 1119 / 560 (목표 1024) | 795 / - | 215 / 405 / 965 | [polyhaven oak_veneer_01](https://polyhaven.com/a/oak_veneer_01) |
| `steel_painted` | 분체도장 강철 (검정/진회색) | Powder-coated steel: bench frames, railings, lamp and sign poles, bollards, bus-stop frame. Tint with material.color for dark grey or green. | 1 (추정) | 2048 / 1024 (목표 512) | 705 / - | 196 / 787 / 561 | [ambientcg Metal027](https://ambientcg.com/view?id=Metal027) |
| `aluminium_brushed` | 헤어라인 알루미늄 | Window frames, door handles, kiosk trim, signal housings, mailbox fronts. | 1 (추정) | 2048 / 1024 (목표 512) | 557 / - | 172 / 263 / 418 | [ambientcg Metal009](https://ambientcg.com/view?id=Metal009) |
| `cast_iron` | 주철 (검정 도장, 마모) | Cast-iron bench legs, manhole and drain covers, the fountain's spout, old pump. | 1 (추정) | 2048 / 1024 (목표 512) | 732 / - | 212 / 611 / 1070 | [ambientcg Metal046B](https://ambientcg.com/view?id=Metal046B) |
| `fabric_upholstery` | 패브릭 (소파, 방석) | Sofas, cushions, chair seats, curtains. Neutral grey; tint with material.color. | 0.5 (추정) | 4096 / 2048 (목표 1024) | 873 / - | 234 / 1188 / 962 | [ambientcg Fabric030](https://ambientcg.com/view?id=Fabric030) |
<!-- sets:end -->

## 다시 만들기

```sh
npm --prefix art/materials/tools ci
node scripts/build-materials.mjs                       # 모두 (원본이 없으면 내려받음, 약 1시간)
node scripts/build-materials.mjs --only grass,asphalt  # 몇 개만
node scripts/build-materials.mjs --manifest-only       # 매니페스트와 README 표만
```

- 바꾼 세트만 `--only`로 다시 만들어요. 결과 파일은 git에 그대로 올라가요(LFS 없음). 전체를 다시 만들면 저장소가 그만큼 커져요.
- 이음매 검사: 알베도의 감싸기 경계 차이를 안쪽 이웃 차이와 비교해서 2배를 넘으면 그 축의 가장자리를 반쯤 민 복사본과 섞어요. 결과는 `build-report.json`의 `seams`에 있어요.
- 새 세트를 넣을 때: `materials.json`에 한 줄 더하고, CC0인지 확인하고, `docs/licenses.md`의 M1 절에 한 줄 더해요.

## 룩데브 (검토용)

```sh
npm run dev -w client -- --port 5697
node art/materials/tools/shoot-lookdev.mjs --url http://localhost:5697 --out <폴더> --shots all
```

`/dev/pbr-lookdev.html?time=day|night&env=g0|none&tier=2k|1k&group=ground,stone` 또는 `?set=<id>&cam=close|graze`. `env=g0`은 G0이 넣을 하늘 반사(PMREM)를 흉내 내고, `env=none`은 지금 게임의 빛(반구광 + 해)만이에요.

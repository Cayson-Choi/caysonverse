# B6 먼 산 — 실제처럼 겹겹이 물러나는 능선 (2026-11-16)

주인 요청: "먼 산의 모습도 실제와 비슷하도록 해".

## 무엇이 바뀌었나

- **전**: `village.glb`의 `village_backdrop`(삼각형 20,230개, `M_backdrop`/`T_backdrop` 2048²) 안에 반지름 620 m 너머의 먼 산맥이
  한 겹의 실루엣으로 구워져 있었어요. 아침 하늘 수정(`tools/fix_sky_glare.py`) 뒤로는 단색 청회색 오려 붙인 판처럼 보였어요.
- **후**: 마을 둘레에 **능선 4겹**(가까운 숲 능선 → 중간 → 먼 → 가장 먼)을 런타임 애셋으로 따로 그려요.
  - 능선마다 자연스러운 능선선(둥근 봉우리·안부·긴 오르내림, 뾰족한 삼각형 없음), 앞으로 나온 지능선과 들어간 골,
    사면을 타고 내려오는 골짜기, 가까운 능선엔 나무 수관 무늬와 드문 화강암 노출, 소나무(짙은)·활엽수(연한) 군락.
  - 공기원근(대기 원근)은 **실행 중 셰이더**에서 계산: 카메라와의 거리로 하늘 쪽으로 옅어지고(가까운 능선 ≈ 0.12, 중간 0.3,
    먼 0.5, 가장 먼 0.68), 능선 발치(골짜기)는 안개가 더 끼어요. 옅어지는 색은 **그 방향 하늘 돔의 지평선 색**(돔 텍스처 ×
    `domeTint`)이라 아침·낮·노을·밤 모두 먼 능선이 하늘에 녹아들어요. 땅 색조는 낮 흰색 → 노을 따뜻한 색 → 밤 어두운 남색.
  - 옛 `village.glb`의 먼 산맥은 **불러온 복제본에서만** 잘라내요(반지름 240 m 밖에 통째로 있는 삼각형 11,955개와 그 위 숲 카드
    3,898장). 마을 가까운 언덕·폭포 뒤 고원·호수 분지는 그대로예요. `village.glb` 파일은 건드리지 않았어요.

참고 사진: `art/village/refs/mountains/`(로컬, git 제외 폴더) — 출처·라이선스는 아래 표와 `sources.json`.

## 파일

| 파일 | 내용 |
|---|---|
| `docs/designs/mountains/tools/build_mountains.py` | 생성기(numpy + Pillow, Blender 불필요). 능선 격자와 색 아틀라스를 만들어요. `--preview DIR`로 광장 기준 파노라마 미리보기 |
| `docs/designs/mountains/tools/make_sheets.py` | 비교 시트(실제 사진 위, 게임 화면 아래) |
| `client/public/models/village/mountains.v1.bin` | 능선 격자: 겹마다 (방위 열 × 행) 정점의 반지름·높이(uint16, 0.05 m 단위) — 60,108 B |
| `client/public/models/village/mountains.v1.webp` | 색 아틀라스 4096×816(겹마다 가로 띠 1개, u = 방위, v = 발치→능선), 조명 포함·안개 없음 — 406,218 B |
| `client/src/village/mountains.ts` | 순수 부분: 파일 읽기, 메시 만들기(그리기 1번), 재질(안개·색조·리치 등급 역톤), 옛 먼 산 잘라내기 |
| `client/src/village/VillageMountains.tsx` | 장면 부분: 두 파일을 읽고(자기 Suspense, 마을은 기다리지 않음), 링을 세우고, 옛 먼 산을 잘라내고, 매 프레임 시간대 적용 |
| `client/src/village/mountains.test.ts` | 단위 시험(4겹, 높이각 < 16°, 면 방향, 잘라내기/되돌리기, 시간대 색조) |
| `e2e/mountains-look.mjs` | 게임 화면 촬영(광장 4방향, 호수 쪽, 폭포 쪽 × 시간대 × PC/휴대폰) |

다시 만들기:

```
python docs/designs/mountains/tools/build_mountains.py            # ~3분, 두 파일을 client/public/models/village/에 씀
python docs/designs/mountains/tools/build_mountains.py --preview .superpowers/mtn/pv
```

모양 조절은 생성기 맨 위 `LAYERS`(반지름 R·흔들림 dR·높이 범위 H·격자·아틀라스 행·수관 크기·서쪽 높임 west),
`LOW_AZ`(동북동 호수·노을 쪽을 낮게), 색 `PINE/DECID/FRESH/ROCK/SOIL`. 안개는 `mountains.ts`의 `MOUNTAIN_LOOK`.

## 예산 (전 → 후)

| | 전 (먼 산맥) | 후 |
|---|---|---|
| 삼각형 | 옛 backdrop 중 반지름 240 m 밖 11,955 + 숲 카드 3,898장 × 4 = 15,592 → **27,547** | 새 능선 **26,240** (가까운 13,824 / 중간 7,168 / 먼 3,200 / 가장 먼 2,048) |
| 그리기 호출 | (backdrop·숲 카드 메시에 포함) | **+1** (능선 4겹이 메시 1개·재질 1개) |
| 내려받기 | `village.glb` 5,579,396 B (그대로) | + `mountains.v1.bin` 60,108 B + `mountains.v1.webp` 406,218 B = **+0.47 MB** |
| GPU 텍스처 | `T_backdrop` 2048² (그대로, 가까운 언덕이 계속 씀) | + 아틀라스 4096×816 ≈ 17.8 MB(밉맵 포함), **휴대폰 등급은 2048×408로 줄여 ≈ 4.5 MB** |

W6 재빌드가 먼 산맥(아래)을 `village.glb`에서 빼면 그만큼(삼각형 약 27.5k, 숲 인스턴스 3,898) 파일도 줄어요.

## 마을 재빌드(W6)에 넣는 방법 — 정확한 단계

새 능선은 **런타임 애셋으로 계속 따로** 두는 것을 추천해요(재빌드·굽기에 묶이지 않고, 시간대 안개가 셰이더에서 돌아요).
재빌드 때 할 일은 **옛 먼 산을 마을 파일에서 빼는 것**뿐이에요.

1. `art/village/tools/parts_nature.py` `terrain_h(x, z)`: `d > 15` 분기의 `mid`(반지름 230–470 m)와 `mount`(620–1050 m) 항을 지우거나
   반지름 240 m 밖에서 0이 되게 하세요. 가까운 언덕 `hills`(d 25–180 m)와 호수 분지·폭포 뒤 고원 규칙은 그대로 둡니다.
2. 같은 파일 `backdrop(c)`: 지형 격자 `axis()`를 ±1100 m 대신 **±260 m**까지만 만들고(가장자리가 새 능선의 발치 215 m 안쪽에
   숨게), `r < 320` near/far 나누기는 `backdrop_near` 하나로 합치세요(`backdrop_far`는 없어짐).
3. `BD_terrain` 재질의 눈(snow, Z 150–162 m)·높은 바위(Z 60–95 m) 분기는 이제 닿지 않으니 지워도 돼요.
4. 숲 카드(`inst__far_*`, `parts_fill.py`의 "backdrop forest" 루프)는 **반지름 240 m 안쪽에만** 심으세요:
   `r = 116 + (rng.random() ** 1.6) * 520` → `* 124`로, 그리고 `math.hypot(x, z) > 240`이면 `continue`. 개수(7000)는 줄여도 돼요
   (지금 잘라낸 뒤 남는 것이 3,102장).
5. 재빌드한 `village.glb`에서 반지름 240 m 밖에 backdrop 삼각형·숲 카드가 없으면 `VillageMountains`의 `cutFarBackdrop`는 아무것도
   자르지 않아요(지워도 되고, 남겨 둬도 해가 없음). `__cvMountains()`의 `cutTriangles`/`cutInstances`가 0이면 재빌드가 맞게 된 거예요.
6. `tools/fix_sky_glare.py --sky-only`처럼 **`T_backdrop` 재색칠은 더 하지 마세요**: 남은 가까운 언덕의 색이 바뀌어요.

### 호수(A10, feat/lake-f)와 폭포(W6)와의 관계

- 동쪽: 호수의 `lake_ridge`(x 112–190 m, 높이 ~18–42 m)는 새 능선보다 훨씬 가까워서 앞을 가려요. 새 능선은 동북동(방위 70°,
  노을·호수 쪽)을 42 %까지 낮춰 계곡이 열려 보이게 했어요. `lakeVillagePatch.ts`의 잘라내기(호수 구역 R 안)와 `cutFarBackdrop`
  (반지름 240 m 밖)는 겹치지 않고 순서와 상관없이 함께 돌아요.
- 서쪽: 폭포 사이트(x −118, z −78, 반지름 약 140 m)와 그 뒤 고원(높이 41 m)은 240 m 안이라 그대로예요. 새 가까운·중간 능선은
  방위 280° 둘레(서북서)를 30 %/18 % 높여 폭포 뒤에 더 높은 산이 서 있게 했어요(고원 가장자리 높이각 ≈ 9.4° 위로 솟음).

## 시간대 연결 (런타임)

- `VillageMountains`가 매 프레임 `applyMountains(material, dayNight.applied, nodes.sky.color, gl.toneMappingExposure)`:
  - 땅 색조 `mountainLandTint(s)`: 낮 (1,1,1) → 황금시간 `GOLDEN_LAND` (1.08,0.84,0.64) × golden → 밤 `NIGHT_LAND` (0.03,0.045,0.1) × night.
  - 안개 색: 하늘 돔 텍스처(돔과 같은 매핑 `nodes.skyMapping`, 지평선 위 0.03 rad, 흐린 밉 4) × 돔 색조(`domeTint`).
  - 리치 등급: 돔처럼 마지막 톤 곡선을 셰이더에서 되돌려(`INVERSE_TONE_GLSL`) 화면에 보이는 색이 작성한 색 그대로.
- DEV 비교: 주소에 `?mountains=old`를 붙이면 새 능선 없이 옛 먼 산 그대로.

## 참고 사진 출처

| 파일 | 원본 | 라이선스 |
|---|---|---|
| ref01–03 | Sobaeksan as seen from Woraksan Yeongbong Peak (1, 3, 5) — Ashy Minivet, Wikimedia Commons | CC0 |
| ref04 | Sobaeksan-1208755 — antipc7, Wikimedia Commons | CC0 |
| ref06–08 | Korea-Mountain-Jirisan-01/06/11 — eimoberg, Wikimedia Commons | CC BY 2.0 |
| ref10–12 | Panoramic view of Gurye-eup 01 / Jeongseon-eup / Cheongsong-eup — 한국학중앙연구원, Wikimedia Commons | KOGL 제1유형 |
| ref13–14 | Hahoe Folk Village 01/03 — Bernard Gagnon, Wikimedia Commons | CC0 |
| ref15 | Korea-Yeongju-Yonghyeolri-Mountain-01 — Robert at Picasa, Wikimedia Commons | CC BY 3.0 |
| ref16 | Seorak-myeon, Gapyeong-gun 2022-12-16 — Katsujiro Maekawa, Wikimedia Commons | CC0 |

비교 시트에는 CC0 사진(ref03, ref04, ref13)만 써요. 게임 애셋(격자·아틀라스)은 사진을 쓰지 않고 절차적으로 만들었어요(CC0 해당 없음, 자작).

## 확인한 것 (2026-11-16)

- 비교 시트: `docs/designs/mountains/sheets/` — `sheet-0800/1230/1630/1715/2100.jpg`(위: 실제 사진, 아래: 게임 광장 북·남·서, 폭포 쪽,
  호수 쪽, 광장 동), `before-after-1230.jpg`(같은 자리 전/후).
- 게임 촬영: `node e2e/mountains-look.mjs` — PC 1280×800(고급) 08:00·12:30·16:30·17:15·21:00 × 광장 4방향·폭포 쪽·호수 쪽,
  휴대폰 375×812(저사양) 12:30·17:15·21:00 × 광장 4방향. 콘솔 오류 0.
- 단위 시험: `client/src/village/mountains.test.ts` 5개, 마을 시험 전체 통과(53파일).
- 알려진 한계: 호수 쪽 촬영 지점(78, 8)은 걷기가 버스 정류장 근처에서 멈춰 정면이 나무·건물에 일부 가려져요(동쪽 능선은
  광장→동 사진에서도 보임). 낮의 먼 능선 색은 지금 하늘 돔의 지평선 색(회청색)을 따라가서 사진의 짙은 청색보다 회색빛이에요 —
  하늘 돔 색을 바꾸면 산도 저절로 따라가요.
- `release/1`(호수 통합)과 합칠 때: `lakeVillagePatch`와 `cutFarBackdrop`가 둘 다 `village_backdrop`의 인덱스 사본을 만들어요.
  서로의 사본 위에 겹쳐 적용돼도 맞게 동작하지만, 되돌리기는 적용의 역순(VillageModel의 effect 정리 순서)이어야 해요.

# 집 실내 약속 (P0) — 모든 덩어리가 지키는 숫자와 이름

작성 2026-11-16 · 브랜치 `feat/houses-p0` (기준 `feat/houses-interior` 4a43931) · 설계 `design.md`

사장님 답 "추천대로 해"(2026-11-16)로 설계 10장의 질문 10개는 **모두 추천안**이에요. 이 문서는 그 결정과 설계를 **코드 상수로 고정한 것**이고, K(공용 키트)·HA(1~5번 집)·HB(6~10번 집)·F(바닥 앉기 자세)·G(게임 연결)는 여기 적힌 것만 쓰면 서로 기다리지 않고 동시에 만들 수 있어요.

| 무엇 | 파일 | 누가 고치나 |
|---|---|---|
| **원본(진짜 약속)** | `shared/src/village/houseAreas.ts` (+ 시험 `houseAreas.test.ts`) | P0만. 바꿀 일이 생기면 P0/설계자에게 |
| Blender용 JSON | `docs/designs/houses-interior/contract.json` — `npx tsx scripts/export-house-contract.ts`로 만듦 (시험이 코드와 같은지 확인) | 손으로 고치지 않음 |
| Blender 도우미 | `docs/designs/houses-interior/houses_contract.py` (`HouseBuild`, `l2w`, `yaw_l2w`, 노드 이름) | P0 |
| 점검 + 자리 파일 생성 | `scripts/gen-house-seats.ts` | P0 |
| 블록아웃 | `docs/designs/houses-interior/blockout_house.py` → `client/public/models/village/houses/house_1.glb` | P0 (HA가 진짜 모델로 덮어씀) |

---

## 1. 사장님 결정 (`HOUSE_POLICY`)

| 질문 | 결정 | 코드 |
|---|---|---|
| Q1 누가 들어가나 | 1004를 아는 사람 누구나, **한 집(두 층 합계) 최대 8명**, 9번째는 "집이 가득 찼어요" | `maxOccupants: 8` |
| Q1 안내원 | 안내원(가이드 NPC)이 "집 번호는 1004예요"라고 알려 줘도 됨 — **나중에 G가 대사 추가**. 서버는 지금처럼 해시만 가짐 | `guideTellsCode: true` |
| Q2 채팅 | 같은 집이면 **1·2층 모두 들림**. 모습은 같은 층만 보임 | `chatScope: "house"` |
| Q3 바닥 앉기 | 새 자세(양반다리) **만듦 — F 담당**. 이 문서는 자리 종류 `floor`와 자세 이름 `floor`만 정함 | `pose: "floor"` |
| Q4 침대 | **가장자리에 앉기만** (눕기 없음) | `bedSit: "edge"` |
| Q5 방석 방향 | **상 쪽만 봄** (어느 쪽에서 다가와도 앉으면 상을 봄) | `cushionFacing: "table"` |
| Q6 창 밖 | 그 집 자리에서 찍은 **실제 마을 파노라마** | `windowView: "panorama"` |
| Q7 테마 | 설계 4장의 10채 그대로 | `HOUSE_SEAT_PLAN` |
| Q8 욕실 | **닫힌 문만** (층마다 1개) | `bathroom: "door-only"` |
| Q9 번호 | **들어갈 때마다 다시 누름** | `rememberCode: false` |
| Q10 작은 가구 | 인형이 앉기엔 너무 작은 가구는 **앉기 없음** — 자리 표식을 아예 안 둠 (폭 0.38 m 미만 금지) | `tinyFurnitureSittable: false`, `HOUSE_SEAT_MIN_WIDTH` |

---

## 2. 좌표

### 2.1 방 기준(로컬) — 설계 2.1 그대로
- 원점 = 현관 벽 안쪽, **들어오는 사람의 왼쪽** 모서리. x 0 → 10.6 (왼쪽 → 오른쪽), z 0 → 7.8 (현관 벽 → 뒷벽), y 위.
- 로컬 방향(yaw): 0 = 방 안쪽(+z), π/2 = 들어오는 사람의 오른쪽(+x). 방향 벡터 = (sin a, cos a).
- 현관문 x 4.4 ~ 6.2 (z = 0 벽), 현관(타일) x 3.6 ~ 7.0, z 0 ~ 1.5, 중문 선 z = 1.5.

### 2.2 세계(게임) 좌표 — 서버 하나의 좌표 공간
- N번 집 1층 원점 **(360 + 24(N−1), 0)**, 2층 원점 **(같은 x, 30)**.
- **세계 x = 원점 x + 로컬 x, 세계 z = 원점 z − 로컬 z.** 들어오는 사람은 세계 −z(북쪽)를 보고, 오른쪽이 세계 +x(동쪽)예요 (시안 `mockup_rooms.py`와 같은 손 방향).
- z를 뒤집으므로 방향은 **세계 yaw = π − 로컬 yaw** (`localYawToWorld`, 파이썬 `yaw_l2w`). 들어올 때 세계 yaw = π.
- 층 사각형(= 클라이언트 `ActiveMap.bounds`, `houseFloorBounds`): x 원점 ~ 원점+10.6, z 원점−7.8 ~ 원점. 벽 0.3 m는 이 사각형 **바깥**.
- 2층도 걷는 면은 y = 0 (계단은 문처럼 순간이동). 2층 계단 구멍 아래(y 0 ~ −4)에 1층 계단 윗부분이 보이게 만들어요.
- 집 사이 13.4 m, 두 층 사이 22.2 m — 서로 안 보여요. 마을(±95)·추모관(292.5 ~ 307.5)과도 멀어요.

| 집 | 1층 원점 | 2층 원점 | 계단 |
|---|---|---|---|
| 1 | (360, 0) | (360, 30) | A |
| 2 | (384, 0) | (384, 30) | B |
| 3 | (408, 0) | (408, 30) | C |
| 4 | (432, 0) | (432, 30) | D |
| 5 | (456, 0) | (456, 30) | A |
| 6 | (480, 0) | (480, 30) | C |
| 7 | (504, 0) | (504, 30) | B |
| 8 | (528, 0) | (528, 30) | D |
| 9 | (552, 0) | (552, 30) | A |
| 10 | (576, 0) | (576, 30) | C |

### 2.3 구역(area) 이름
- `house:<buildingId>:<층>` — 예: `house:house_3:2`. 만들기 `houseFloorArea(n, floor)`, 읽기 `parseHouseFloorArea(area)` (정확히 `house:house_1~10:1|2`만 받음).
- HUD 장소 이름 `houseFloorLabel` → "3번 집 · 2층".

### 2.4 바깥 창 → 안쪽 벽 (`exteriorToLocal`)
바깥 집 빌더(`parts_buildings.py` `house`)의 Frame은 로컬 x = 들어오는 사람의 오른쪽(안쪽 x와 같은 방향), 로컬 z = 문 밖 쪽이에요. 몸체는 x ±5.15, z −4.05(뒤) ~ 2.7(앞)으로 **실내(10.6 × 7.8)보다 작아서** 비례로 옮겨요: 앞벽 → 로컬 z 0, 뒷벽 → 7.8, 옆벽 → x 0 / 10.6. 예: 바깥 1층 앞 창(±2.55) → 로컬 x 2.68 / 7.92, 옆 창(z −0.875) → 로컬 z 4.13, 뒤 창(−2.2, 1.8) → 로컬 x 3.03 / 7.15. **HA·HB는 실제로 함께 나갈 바깥 빌더의 몸체 크기를 인자로 넘겨서** 써요(기본값 `EXTERIOR_BODY_DEFAULT`).

---

## 3. 방 치수 (`HOUSE_ROOM`)
실내 10.6 × 7.8 m, 벽 0.30 m, 층 높이 4.0 m, **천장 3.7 m**, 현관문 1.8 × 2.9 m(유리 양문), 방 사이 개구부 폭 ≥ 1.6 m·높이 2.6 m(문짝 없음), 통로 ≥ 0.9 m, 앉는 자리 앞 ≥ 1.0 m 비움. 경사 천장(2.9 m부터): 8번 2층, 10번 2층 (`HOUSE_LOW_CEILINGS`) — 카메라 한도는 천장(또는 대들보·경사 낮은 끝) − 0.25 m (`HOUSE_CAMERA`).

---

## 4. 계단·패드·도착 자리 (`HOUSE_STAIR`, `STAIR_PLANS`, `HOUSE_PLACES`)

계단: 챌판 17 × 0.235 m(= 4.0 m), 디딤판 16 × 0.34 m = 5.44 m, 폭 1.3 m, 난간 0.9 m. 2층 구멍 = 계단 자리 그대로(난간, 충돌 상자 높이 1.0), 구멍 아래 1층 계단 윗부분 **8단**을 다시 넣음(`wellSteps`).

모두 **로컬** 좌표 (세계 좌표는 `HOUSE_PLACES[n]`, `contract.json`의 `houses[].places`):

| 형 | 계단 자리 | 오르는 쪽 | 2층 참(landing) | 1층 패드 `stair__h<N>_up` | 2층 패드 `stair__h<N>_down` | 2층 도착 `spawn__h<N>_2` | 1층 도착 `spawn__h<N>_1s` |
|---|---|---|---|---|---|---|---|
| A | x 5.06~10.5, z 6.4~7.7 | 동 → 서 | x 4.06~5.06, z 6.4~7.7 | (9.85, 5.8) | (4.56, 7.05) 동쪽 봄 | (4.21, 7.05) | (9.85, 5.45) |
| B | x 0.1~5.54, z 6.4~7.7 | 서 → 동 | x 5.54~6.54, z 6.4~7.7 | (0.75, 5.8) | (6.04, 7.05) 서쪽 봄 | (6.39, 7.05) | (0.75, 5.45) |
| C | x 9.2~10.5, z 1.9~7.34 | 앞 → 뒤 | x 8.2~9.2, z 6.04~7.34 (꼭대기 옆) | (9.85, 1.3) | (8.7, 6.69) +x 봄 | (8.35, 6.69) | (9.85, 0.95) |
| D | x 0.1~1.4, z 1.9~7.34 | 앞 → 뒤 | x 1.4~2.4, z 6.04~7.34 (꼭대기 옆) | (0.75, 1.3) | (1.9, 6.69) −x 봄 | (2.25, 6.69) | (0.75, 0.95) |

- **A·B는 첫 단이 옆벽에 붙어 있어서** 1층 패드를 첫 단 "앞"이 아니라 **낮은 쪽 1.3 m 구간의 방 쪽(앞쪽 z)** 에 둬요. 계단을 바라보는 방향(로컬 +z)이 사용 방향. 처음 3~4단은 난간 없이 방 쪽에서 오르는 모양으로 만들어 주세요(HA·HB).
- **C·D는 꼭대기가 뒷벽 0.46 m 앞이라** 2층 참을 꼭대기 단의 **옆**(1.0 × 1.3 m)에 둬요. 구멍 난간은 참 쪽만 열려 있어요.
- 모든 1층 패드는 로컬 +z(계단 쪽)를 봐요. 도착 자리는 패드 중심에서 계단 반대쪽으로 0.35 m, **방 가운데(5.3, 3.9)를 바라봐요**.
- 현관: 나가기 패드 `door__h<N>_exit` = (5.3, 0.9), 반지름 0.7, 현관문 쪽(로컬 −z)을 봄. 들어온 자리 `spawn__h<N>_in` = (5.3, 3.1), 방 쪽을 봄(세계 yaw π). 들어온 자리에서는 나가기가 안 떠요(2.2 m).
- 패드 반지름 0.5 (`HOUSE_PAD_RADIUS`). **쓸 수 있는 곳(`padUsableFrom`)**: 반지름 안이면 언제나, 그 밖은 중심에서 반지름 + 1.3 m 안이면서 패드 축에서 옆으로 0.8 m 안, 패드보다 계단(문) 쪽으로 넘어가지 않은 곳. 추모관 문 규칙(`villageDoor.ts`)과 같은 모양이에요. 서버 `useStair`·나가기는 이 함수로 권위 있는 위치를 판정해요.
- **비워 둘 곳**(`houseKeepClear`, 생성기가 점검): 1층 = 현관 통로 x 4.3~6.3 · z 0~3.6, 나가기 패드, 1층 패드, 1층 도착 자리(반지름 0.45). 2층 = 참 전체, 2층 패드, 2층 도착 자리. 이 안에는 가구 `col__`가 들어오면 안 돼요(벽은 예외).

---

## 5. GLB 노드 이름 (`HOUSE_NODE`, `HOUSE_NODE_PATTERNS`)

house_N.glb 하나에 1·2층이 함께, **세계 좌표 그대로** 들어가요(추모관 memorial.glb처럼). 표식·상자·도우미는 **맨 위 노드(부모 없음)**, 보이는 메시는 층 묶음 아래에만.

| 노드 | 뜻 | 형식 |
|---|---|---|
| `floor__h<N>_1`, `floor__h<N>_2` | 그 층의 보이는 메시 전부를 담는 빈 노드(변환 없음). 클라이언트가 한 층만 그림 | 필수 |
| `stair__h<N>_up` / `stair__h<N>_down` | 1층 / 2층 계단 패드 중심, y 0, 회전 = 패드가 보는 방향 | 필수, 약속 자리 ±5 cm·±0.02 rad |
| `door__h<N>_exit` | 1층 나가기 패드 | 필수, 〃 |
| `spawn__h<N>_in`, `spawn__h<N>_2`, `spawn__h<N>_1s` | 들어온 자리 / 2층 도착 / 1층 도착, 회전 = 바라보는 방향 | 필수, 〃 |
| `ceil__h<N>_1`, `ceil__h<N>_2` | 실내 카메라용 천장 판(1 m 정육면체의 위치·크기, 아랫면 = 천장 3.7) — 추모관 `ceil__hall`과 같음 | 필수 |
| `col__h<N>_<층>_<이름>` | 충돌 상자 (이름 = 소문자·숫자·`_`; 벽 `wall_*`, 칸막이 `part_*`, 계단 `stair_*`, 구멍 `stairwell`) | 집마다 ≥ 20개 |
| `seat__h<N>_<층>_<k>` | 앉는 자리 표식, k = 층마다 0부터 빈칸 없이 | 설계표 개수 |

- 번호 N은 0 채움 없이(`h1`…`h10`). 스크립트 파일 이름만 `h01.py`처럼 두 자리.
- 노드 방향: Blender 빈 물체의 `rotation_euler.z = 세계 yaw`이면 glTF 노드의 +z가 그 방향을 봐요(`check-school-glb`의 `yawError`와 같음).
- 재질: 라이트맵을 받는 것은 `LM_*`, 직접 그리는 것(유리·등·창 밖 파노라마)은 `M_*` (추모관과 같은 규칙).

---

## 6. 앉는 자리 표식 (`HouseSeatMarker`)

### 6.1 종류·자세·다가가기
| 종류 `kind` | 가구 `furn` | 다가가기 `approach` | 비고 |
|---|---|---|---|
| `backed` (등받이) | chair, sofa, armchair(흔들의자·라운지·안락의자·라탄 의자), beanbag | `front` (앞 반평면만) | 식탁·책상 의자는 추모관처럼 옆에서도 (G: `furn === "chair"` 규칙 재사용) |
| `backless` (등받이 없음) | bench(평상·통나무 벤치·피아노 벤치), stool, barstool, ottoman, bed, windowseat | `both: true` → `any`(양쪽, 다가온 쪽을 봄) / `both: false` → `front` | **침대 가장자리·창가 좌석은 `both: false`** (침대 바깥·방 쪽만 봄) |
| `floor` (바닥) | cushion(방석), boryo(보료), floorsofa(바닥 소파·매트리스 소파) | `back > 0` → `front` / 방석 `back = 0` → `any` | **방석은 한 방향(상 쪽)만**, `both: false` |

- 자세 `pose`: `chair`(지금 앉기), `perch`(좌면 ≥ 0.6 m: 바 스툴·공방 스툴, 발 받침에 맞춘 다리 보정 — F), `floor`(양반다리 — F). `floor` 종류 ⇔ `floor` 자세.
- 좌면 높이 범위 (`HOUSE_SEAT_HEIGHTS`): chair 0.35~0.55, perch 0.6~0.75, floor 0.03~0.3. 좌석 폭 ≥ 0.38 m.

### 6.2 표식 형식
Blender 빈 물체 `seat__h<N>_<층>_<k>`를 **좌면 가운데**(세계 x, z, y = 좌면 높이)에 두고 `rotation_euler.z = 세계 yaw`(앉은 사람이 보는 쪽). **glTF 노드 extras**(Blender 사용자 속성, 참·거짓은 0/1)로 다음 12개를 꼭 넣어요 (`HOUSE_SEAT_EXTRAS`):

| 키 | 뜻 |
|---|---|
| `furn`, `kind`, `pose`, `approach` | 위 표 |
| `yaw` | 세계 yaw (노드 회전과 0.02 rad 안에서 같아야 함) |
| `edge` | 표식에서 앞 가장자리까지 (m, > 0) |
| `back` | 표식에서 등받이 면까지 (m; 등받이 없으면 0) |
| `width` | 좌석 폭 (m) |
| `group` | 함께 앉을 수 없는 자리 묶음 (기본: 자기 id `h<N>_<층>_<k>`) |
| `both` | 양쪽에서 앉기 (backless만) |
| `exitTurn` | 일어서는 쪽 (보는 쪽에서 돌린 각, 0 = 앞, π = 뒤) |
| `lean` | 등을 기대는 각 (rad; 등받이 없으면 0) |

- 위치는 노드 translation에서 읽고 extras에 다시 적지 않아요. 굽기 스크립트가 `export_extras=False`로 내보낸다면, 내보낸 뒤 좌석 노드에 extras를 붙이는 후처리를 꼭 해 주세요(K의 `bake_house.py`/`post_house.py`).
- 파이썬에서는 `HouseBuild.seat(floor, furn, lx, lz, y, local_yaw, edge, back, width, both, exit_turn, lean)` 하나로 만들어요 — kind·pose·approach·id·k는 자동.
- 점검·생성: `npx tsx --tsconfig server/tsconfig.json scripts/gen-house-seats.ts client/public/models/village/houses/house_N.glb` → `shared/src/village/generated/houses/house_N_seats.ts` (`HOUSE_N_SEAT_MARKERS`). 필수 노드·약속 자리·상자 수·이름·extras·규칙(`seatMarkerProblems`)·층마다 종류별 개수가 하나라도 틀리면 FAIL이고 파일을 안 써요.

### 6.3 집·층별 자리 수 (`HOUSE_SEAT_PLAN`, 합계 118 = 1층 77 + 2층 41)
| 집 | 1층 | 2층 | 합 |
|---|---|---|---|
| 1 | 등 8 | 무 3 · 등 1 | 12 |
| 2 | 등 7 · 무 2 | 등 3 · 무 3 | 15 |
| 3 | 등 6 · 무 2 | 등 2 · 바닥 2 | 12 |
| 4 | 등 2 · 바닥 5 (방석 4 + 보료 1) | 바닥 3 | 10 |
| 5 | 등 8 | 바닥 4 · 무 1 | 13 |
| 6 | 등 5 · 무 2 | 무 4 | 11 |
| 7 | 등 6 · 무 1 | 무 3 (높은 스툴, perch) | 10 |
| 8 | 바닥 4 · 무 2 | 바닥 2 · 등 2 | 10 |
| 9 | 등 8 · 무 3 (바 스툴, perch) | 바닥 3 · 무 1 | 15 |
| 10 | 등 4 · 무 2 | 무 4 | 10 |

종류 합계: 등 62 · 무 33 · 바닥 23.

### 6.4 전체 자리 목록의 순서와 `seatIndex`
- `VILLAGE_SEATS`(하나의 목록, 번호 = `Player.seatIndex`)에서 **집 자리는 맨 뒤**, 집 번호 → 층 → k 순(`compareHouseSeats`). 양쪽 앉기(`both`) 표식은 추모관처럼 앞·뒤 두 줄로 연달아.
- 지금 `Player.seatIndex`는 `int8`(최대 127) → **G가 `int16`으로** (`SEAT_INDEX_SCHEMA`). 클라이언트·서버를 **같이 배포**해야 해요. 카페·포치 번호를 쓰는 시험은 새 번호로.

---

## 7. 충돌 상자
- `col__h<N>_<층>_<이름>`: 회전 없는 1 m 정육면체(위치 = 가운데, 크기 = 크기), 부모 없음 — 기존 `scripts/extract-colliders.ts`가 그대로 읽어요:
  `npx tsx --tsconfig server/tsconfig.json scripts/extract-colliders.ts client/public/models/village/houses/house_N.glb HOUSE_N_COLLIDERS shared/src/village/generated/houses/house_N_colliders.ts`
- 높이 ≥ 1.6 m(벽·칸막이·장·책장·중문)는 자동으로 카메라 상자(`HOUSE_N_CAMERA_BOXES`), 낮은 가구는 아님.
- 벽 4면은 층마다 방 사각형 **바깥** 0.3 m (`HouseBuild.walls()`), 계단은 `HouseBuild.stair_colliders()`(1층: 낮은 4단 1.0 m + 나머지 3.7 m, 2층: 구멍 전체 1.0 m 난간).
- 충돌 = 보이는 것(`check_visual_collider.py` 재사용). 비워 둘 곳(4장)에는 가구 상자 금지.

---

## 8. 파일과 예산

| 파일 (client/public) | 내용 |
|---|---|
| `/models/village/houses/house_N.glb` | 1·2층 함께, Draco |
| `house_N_lm.webp` / `_lm_1k.webp` | 낮 라이트맵 2048 / 폰 1024 |
| `house_N_lm_night.webp` / `_lm_night_1k.webp` | 밤 라이트맵 |
| `house_N_view.webp` | 창 밖 파노라마, 위 낮 · 아래 밤, 2048 × 1024 |
| `/models/village/houses/houses_props.glb` | 공용 작은 소품(책·그릇·쿠션·장난감·잎), GPU 인스턴싱 — K |
| `shared/src/village/generated/houses/house_N_seats.ts`, `house_N_colliders.ts` | 생성 파일 (HA·HB가 다시 만듦) |
| `shared/src/village/generated/houses/index.ts` | 목록 — **G만** |

예산(`HOUSE_BUDGET`, G가 `check-school-glb`에 kind `house`로 넣음): house_N.glb ≤ 1.0 MB · ≤ 45,000 삼각형(col__ 제외) · 재질 ≤ 24 · 텍스처 ≤ 2048; houses_props.glb ≤ 0.6 MB · ≤ 25,000; 라이트맵 2048 ≤ 450 KB, 1k ≤ 230 KB; 한 층 그리기 호출 ≤ 120; 집 안 메모리 증가 ≤ 150 MB(폰); 입장 시간(캐시 없음 4G) 미리 받기 ≤ 2.5 s / 없이 ≤ 6 s, 8초 넘으면 포치로 돌려보냄; 나간 뒤 60초에 해제.

`check-school-glb`의 house 점검에 쓸 것: `houseRequiredNodes(n)`(필수 노드), `housePlacements(n)`(자리·방향, 허용 0.05 m), `HOUSE_MIN_COLLIDERS`, `houseKeepClear(n, 층)`(→ `clearDiscs`/상자), 천장 `ceil__h<N>_<층>`(y 3.7, 방 사각형).

---

## 9. 블록아웃 (G가 바로 시작하도록)

`client/public/models/village/houses/house_1.glb` (62 KB, Draco, 그림 `blockout_h1.jpg`: 1·2층 평면 + 눈높이 4컷, 자리 = 주황(등)·초록(무) 원뿔이 보는 쪽, 파란 고리 = 패드, 분홍 = 2.16 m 인형) — 1번 집(계단 A) 두 층을 상자로: 벽·창·현관문·중문·신발장·욕실 문, 거실(소파 3자리·라운지 체어·TV장·커피테이블), 주방(ㄱ자 싱크대·냉장고·4인 식탁), 계단 + 난간, 2층 구멍 + 난간 + 아래로 보이는 8단, 2층 침실(퀸 침대 가장자리 2·화장대 스툴·옷장·창가 책상 의자·책장). 노드는 5장 그대로, 자리 12개(1층 등 8, 2층 무 3·등 1), 상자 40개(카메라 상자 15개). **라이트맵 없음, `LM_` 재질 없음**(모두 `M_*` 단색) — G는 라이트맵이 없을 때도 그려지게 해 주세요.

- 생성 파일: `shared/src/village/generated/houses/house_1_seats.ts`, `house_1_colliders.ts` (위 명령으로 만든 것).
- 다시 만들기: `blender -b --factory-startup -P docs/designs/houses-interior/blockout_house.py -- [--out <glb>] [--render <폴더>]`.
- 블록아웃은 단순화라 1층 TV가 왼쪽 벽 창 앞에 걸려 있어요 — HA는 창 자리(2.4)를 피해 가구를 놓아 주세요.
- 2~10번 집은 블록아웃이 없어요. G는 1번 집으로 흐름을 끝까지 연결하고, 다른 집은 같은 좌표·노드 규칙이라 GLB만 바뀌면 돼요.

---

## 10. 덩어리별로 꼭 지킬 것

**K (공용 키트)** — `art/village/tools/houses/kit_*.py`
- 모든 가구 함수는 **로컬 좌표 + 로컬 yaw**를 받아 `houses_contract.py`의 `l2w`/`yaw_l2w`로 세계에 놓고, 충돌은 `HouseBuild.col`, 자리는 `HouseBuild.seat`로만 등록해요(직접 이름 짓지 않기).
- 껍데기 함수는 `HouseBuild.walls()`, `stair_colliders()`, 그리고 `contract.json`의 `stairPlans`(계단 자리·참·패드)를 그대로 써요. 1층 계단 A·B의 낮은 3~4단은 방 쪽이 열려 있어야 해요.
- 좌석 extras를 GLB에 남기는 굽기(`bake_house.py`)·후처리(`post_house.py`) — 6.2.
- 보이는 메시는 `HouseBuild.floor_root(층)` 아래로.

**HA / HB (집 1~5 / 6~10)** — `h01.py ~ h10.py`
- 자리 수·종류는 6.3 표 그대로(생성기가 막아요). 침대 가장자리·창가 좌석 `both=False`, 방석은 상 쪽 yaw + `both=False`, 너무 작은 가구는 자리 없음.
- 비워 둘 곳(4장)에 가구 금지. 창 위치는 `exteriorToLocal`로 바깥과 맞추기.
- 다 만들면 `gen-house-seats.ts`(PASS)와 `extract-colliders.ts`로 생성 파일 두 개를 다시 만들고 커밋. `index.ts`는 고치지 않아요.

**F (바닥 앉기 자세)**
- 자세 이름은 `HouseSeatPose`의 `floor`(양반다리)와 `perch`(바 스툴 다리 보정). 바닥 자리 좌면 높이 0.03~0.3 m, perch 0.6~0.75 m에서 엉덩이가 좌면, 발이 바닥/발받침에 닿게.
- 방석은 보는 방향이 고정(상 쪽), 보료·바닥 소파는 `back > 0`으로 등을 기대요(`lean`).

**G (게임 연결)**
- 구역 `house:<id>:<층>`(`houseFloorArea`/`parseHouseFloorArea`) — 지금 `villageLayout.ts`의 `houseArea`/`isHouseArea`/`buildingIdFromArea`를 층 붙은 형식에 맞게. 서버 지형(`villageGeometry`의 바깥 사각형·틈 막기)이 x 360 ~ 586.9, z −8.1 ~ 30.3까지 덮도록.
- 번호키: 맞으면 `HOUSE_PLACES[n].spawnIn`, 한 집 8명 제한(`HOUSE_POLICY.maxOccupants`, 두 층 합계), 기억 안 함. 나가기·계단은 `padUsableFrom` + 1초 1회 + 앉아 있으면 거절 + `spreadArrival`.
- 채팅은 같은 집 두 층, 모습은 같은 층.
- 자리: `generated/houses/index.ts`에서 집별 `HOUSE_N_SEAT_MARKERS`를 모아 `VILLAGE_SEATS` 맨 뒤에(`compareHouseSeats` 순서), `seatIndex` → `int16`. 지금의 절차 가구(`houseInterior.ts`)와 그 40자리는 지워요.
- 클라이언트: `houseFiles(n)`로 받기(미리 받기·해제·낮밤), 층마다 `ActiveMap`(`houseFloorBounds`, 카메라 한도 `HOUSE_ROOM.ceiling − HOUSE_CAMERA.ceilingPad`, 낮은 천장 `HOUSE_LOW_CEILINGS`), `floor__h<N>_<층>`으로 한 층만 표시.
- 안내원 "집 번호는 1004예요" 대사(Q1) — 나중에.

---

## 11. 알아 둘 점
- 실내(10.6 × 7.8)가 바깥 몸체(약 10.3 × 6.75)보다 커요. 게임 관례(추모관도 같음)라 창은 비례로 맞춰요(2.4).
- 로컬 → 세계가 거울(z 뒤집기)이라 방향은 꼭 `π − 로컬 yaw`. 메시를 거울로 뒤집지는 않아요(가구는 세계 yaw로 돌려서 놓음).
- 도착 자리에서 바로 그 패드를 쓸 수 있어요(추모관 문과 같음). 들어온 자리(현관)에서는 나가기가 안 떠요.
- 바 스툴 0.65 m는 `perch`, 피아노 벤치 0.5 m는 `chair`.

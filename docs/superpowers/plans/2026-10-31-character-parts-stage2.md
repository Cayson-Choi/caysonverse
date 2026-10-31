# 캐릭터 조립실 2단계 — 전체 부품 제작 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task (블렌더 한 개를 순서대로 다루므로 병렬 금지). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 1단계에서 발주자가 승인한 "Cayson 토이 피규어" 스타일로 설계 4장의 부품 전부와 AI 조교 옷을 만든다. 결과물은 `character.glb` 하나 + manifest, 그리고 렌더 점검 결과다.

**Architecture:** 블렌더 원본 `art/character/cayson-toy.blend`를 이어서 작업한다.
- 1단계 백업: `cayson-toy-stage1.blend`.
- 텍스트 블록 `toykit`의 도우미(`material`, `new_obj`, `ellipsoid_bm`, `capsule_bm`, `rbox_bm`, `merge_bms`, `skin`, `tag` 등)를 `exec(bpy.data.texts['toykit'].as_string(), ns)`로 불러와 쓴다.
- 머리 기준 좌표: 머리 중심 `HC=(0,-0.01,1.70)`, 반지름 `RX,RY,RZ=0.50,0.47,0.46`. 앞쪽은 −Y, 위쪽은 +Z.
- 모든 부품은 뼈대 `Rig`에 가중치를 주고(`skin`), 컬렉션 `Parts`에 둔다.
- 텍스처(얼굴·로고)는 헤드리스 Chrome 캔버스로 그린다. 1단계 생성기는 `<scratchpad>/textures/gen.html`, `gen.cjs`.

**Tech Stack:** Blender 5.2 LTS + MCP(`execute_blender_code`, `look`, `get_scene_info`), bpy/bmesh, glTF exporter, Node 24 + Playwright(텍스처·렌더 시트), three 0.185(미리보기).

**Spec:** `docs/superpowers/specs/2026-10-31-character-builder-design.md` (3장 스타일, 4장 부품, 5.1 자산, 5.3 NPC, 5.4 용량, 6장 렌더 점검)

## Global Constraints

- 1단계에서 승인된 스타일·비율·재질 느낌을 그대로 유지한다. 오리지널 디자인이어야 하며, 기존 장난감이나 게임 캐릭터를 베끼지 않는다.
- 메시 이름은 `slot__id`(소문자·밑줄)다.
- 색이 바뀌는 영역은 슬롯별 머티리얼 `mat_tint_<slot>`를 쓴다(`mat_tint_item` 포함). 고정색은 `mat_fixed_*`.
- 로고는 `mat_logo_white`를 쓴다. 단, 모자 로고는 `mat_logo_hat`으로 분리한다. 1단계에서는 티셔츠와 같은 머티리얼을 써서 색이 같이 바뀌었다.
- 교체 규칙
  - 웃옷은 `body__torso`, 바지는 `body__legs`, 신발은 `body__feet`를 덮는다(manifest `covers`).
  - 웃옷은 엉덩이 아래로 내려가지 않는다(로브도 엉덩이선에서 퍼지는 짧은 튜닉).
- 모자는 모든 머리 모양과 조합했을 때 머리카락이 모자 겉으로 뚫고 나오면 안 된다. 앞머리·옆머리가 모자 챙 아래로 보이는 건 괜찮다.
- 손에 드는 것은 `handslot.r` 뼈에 100% 묶는다(`skin(rigid='handslot.r')`).
- 동작 클립은 1단계와 같은 7개(Idle, Walking_A, Running_A, Sit_Chair_Down, Sit_Chair_Idle, Sit_Chair_StandUp, Jump_Full_Short).
- 최종 `art/character/export/character.glb`는 **3MB 이하**(설계 5.4). 넘으면 Decimate로 줄이고, 그래도 넘으면 Draco 압축으로 내보내되 manifest에 `"draco": true`를 적는다.
- 커밋은 하지 않는다. `art/`는 gitignore 대상이다. 저장소에 들어가는 것은 `scripts/check-character-glb.mjs` 변경뿐이며, 이것도 발주자 OK 전엔 커밋하지 않는다.
- Blender MCP 호출의 `user_prompt`에는 발주자 원문 "응, 이 느낌"을 넣는다.

## Review Focus

- **포니테일·양갈래 + 모자 조합에서 머리카락이 모자를 뚫는 것** → Task 7 렌더 점검에 "모자 6 × 머리 6" 정면·뒤 조합을 넣는다.
- **롱스커트·치마가 걷기·달리기·앉기에서 다리를 뚫거나 찢어지는 것** → Task 7에서 해당 바지 3종 × 세 동작을 렌더한다.
- **로브 소매·후드가 팔·머리를 뚫는 것** → Task 7에서 걷기·달리기를 렌더한다.
- **샌들에서 맨발 피부색이 피부색 선택을 따르지 않는 것** → 샌들의 발 부분은 `mat_skin`을 쓰고, Task 7에서 피부색 2가지로 확인한다.
- **소품이 손에서 떨어져 보이거나 몸을 관통하는 것**(달리기 팔 흔들기) → Task 7에서 소품 6종 × 달리기를 렌더한다.

---

### Task 1: 1단계 지적 사항 수정

**Files:** Modify `art/character/cayson-toy.blend`

- [ ] **Step 1:** 운동화 밑창을 얇게 만든다(높이 0.055 → 0.035, 발보다 1cm만 크게). 달리기 뒷모습에서 밑창이 덩어리로 보이지 않게 한다.
- [ ] **Step 2:** 바지 엉덩이 안쪽 면이 비치는 문제를 고친다. 면 방향을 다시 계산하고(`recalc_face_normals`), 겹친 내부 면을 지운다. 앉기 뒷모습에서 확인한다.
- [ ] **Step 3:** 배 쪽 옷 경계를 매끈하게 한다.
  - 바지 허리 부분을 티셔츠 안쪽으로 1cm 들어가게 줄인다.
  - 티셔츠 아랫단을 바지 허리보다 넓고 아래로 오게 한다.
- [ ] **Step 4:** 캡모자 돔과 머리카락의 관계를 고친다.
  - 모자 돔 크기 = 모든 머리 껍데기 중 가장 큰 것 + 1.5cm.
  - 모자를 쓰면 그 모자의 `hairCut` 높이 아래의 머리카락만 보이도록, 머리카락마다 "모자용" 변형 메시 `hair__<id>__hat`을 만든다. manifest `hatVariants`에 기록한다.
- [ ] **Step 5:** 포니테일을 둥글고 통통하게 한다. 끝으로 갈수록 얇아지게 하고, 머리끈 아래로 약간 휘게 한다.
- [ ] **Step 6:** 확인한다. `look`으로 달리기 뒷모습, 앉기 뒷모습, 정면, 캡+포니테일 뒷모습을 본다. 기대: 지적된 5가지가 사라진다.

### Task 2: 머리카락 3종 추가

**Interfaces:** Produces `hair__bob`(단발), `hair__curly`(곱슬), `hair__twintails`(양갈래). 각각 모자용 변형 `__hat`이 있다.

- [ ] **Step 1:** 단발을 만든다. 턱선까지 내려오는 둥근 껍데기 + 앞머리.
- [ ] **Step 2:** 곱슬을 만든다. 1단계 앞머리 방식의 둥근 덩어리 15~20개로 머리 전체를 덮는다.
- [ ] **Step 3:** 양갈래를 만든다. 짧은 머리 껍데기 + 양옆 꼬리 2개 + 머리끈(`mat_fixed_tie`).
- [ ] **Step 4:** 확인한다. 세 종류 각각 정면·3/4·뒤를 `look`으로 본다.

### Task 3: 얼굴 4종 추가

**Files:**
- Modify: `<scratchpad>/textures/gen.html`, `gen.cjs` — `face(kind)`에 `glasses`, `wow`, `calm`, `tongue` 추가
- Create: `art/character/textures/face_{glasses,wow,calm,tongue}.png`

**Interfaces:** Produces `face__glasses`, `face__wow`, `face__calm`, `face__tongue`. 1단계 `face__smile`과 같은 머리 앞면 패치(az ±0.75, el −0.50~0.26, 배율 1.006)를 쓴다.

- [ ] **Step 1:** 텍스처를 그린다.
  - 안경: 둥근 테 + 웃음
  - 놀람: 커진 눈 + 동그란 입
  - 차분: 반달 눈 + 작은 미소
  - 장난: 윙크 + 내민 혀(분홍)
- [ ] **Step 2:** 패치 메시를 만들어 붙이고, `head` 뼈에 100% 묶는다.
- [ ] **Step 3:** 확인한다. 4종을 피부색 2가지로 `look`으로 본다. 눈·입 색이 변하지 않아야 한다.

### Task 4: 모자 4종 추가

**Interfaces:** Produces `hat__beanie`(방울 털모자), `hat__catband`(고양이 귀 머리띠), `hat__crown`(왕관, 기본색 금색 `#D4A93A`), `hat__wizard`(마법사 모자). 모두 `head` 뼈에 100% 묶는다. 방울·고양이 귀 안쪽처럼 고정색 영역은 `mat_fixed_*`.

- [ ] **Step 1:** 털모자를 만든다. 돔 + 접힌 단 + 방울.
- [ ] **Step 2:** 고양이 귀 머리띠를 만든다. 머리띠는 머리카락 위를 지나고, 귀 안쪽은 분홍 고정색.
- [ ] **Step 3:** 왕관을 만든다. 둥근 띠 + 뾰족 5개 + 끝 구슬 + 앞 보석(빨강 고정). 머리 위에 얹힌다.
- [ ] **Step 4:** 마법사 모자를 만든다. 넓은 챙 + 살짝 휜 원뿔 + 별 장식(고정 노랑).
- [ ] **Step 5:** 확인한다. 모자 6종 × 머리 6종 조합의 뚫림은 Task 7에서 본다. 여기서는 모자별 정면·3/4을 본다.

### Task 5: 웃옷·바지·신발 추가

**Interfaces:**
- 웃옷 4종(몸통 뼈 목록 `['hips','spine','chest','upperarm.l','upperarm.r']`):
  - `top__hoodie`: 모자 달린 후드티, 앞주머니, 끈
  - `top__shirt_tie`: 깃 셔츠 + 넥타이(고정 빨강)
  - `top__suspenders`: 셔츠 + 멜빵(멜빵은 `mat_fixed_strap`)
  - `top__robe`: 엉덩이선에서 퍼지는 짧은 튜닉, 넓은 소매, 금색 단 장식
- 바지 4종(다리 뼈 목록 `['hips','upperleg.l','lowerleg.l','upperleg.r','lowerleg.r']`):
  - `bottom__shorts`: 반바지. 무릎 아래는 다리 피부 메시 포함, `mat_skin`
  - `bottom__skirt`: 무릎 위 치마. 아래는 피부
  - `bottom__longskirt`: 발목까지
  - `bottom__overalls`: 멜빵바지, 가슴판은 웃옷 위
- 신발 3종(발 뼈 `['foot.l','toes.l','foot.r','toes.r']`, top=1):
  - `shoes__boots`: 장화
  - `shoes__dress`: 구두
  - `shoes__sandals`: 샌들. 발등·발가락은 `mat_skin`

- [ ] **Step 1:** 웃옷 4종을 만든다. 1단계 티셔츠처럼 `body__torso` 모양을 바탕으로 부풀리고, 가중치는 몸통 뼈 목록으로 준다.
- [ ] **Step 2:** 바지 4종을 만든다.
  - 치마 2종은 다리 사이가 갈라지지 않게 원통형으로 만든다.
  - 가중치는 엉덩이 쪽은 `hips`, 아래로 갈수록 두 다리 뼈를 반반 섞는다.
  - 걷기에서 찢어지지 않는지 바로 확인한다.
- [ ] **Step 3:** 신발 3종을 만든다.
- [ ] **Step 4:** 확인한다. 각 부품을 Idle·Walking_A 1프레임씩 `look`으로 본다.

### Task 6: 손에 드는 것 6종 + AI 조교 옷

**Interfaces:**
- 소품(`handslot.r`에 100%, 색 영역 `mat_tint_item`):
  - `item__book`: 표지 색, 종이 흰색
  - `item__flag`: 천 색, 깃대 나무색
  - `item__wand`: 별 색, 막대 남색
  - `item__balloon`: 풍선 색, 끈 흰색. 손 위로 길게
  - `item__pencil`: 몸통 색, 심·지우개 고정
  - `item__mic`: 머리 색, 손잡이 남색
- AI 조교 옷: `top__android`, `bottom__android`, `shoes__android`
  - 흰 바탕 `mat_fixed_white` + 강조 줄무늬 `mat_tint_accent`. 조교별 강조색은 게임 코드가 칠한다.
  - manifest에서는 `npcOnly`로 표시해 조립실 목록에 나오지 않게 한다.

- [ ] **Step 1:** 소품 6종을 만든다. 손이 쥔 위치(`handslot.r` 원점)에 손잡이가 오게 한다.
- [ ] **Step 2:** AI 조교 옷 3종을 만든다(1단계 티셔츠·긴바지·운동화를 바탕으로 매끈한 안드로이드 느낌).
- [ ] **Step 3:** 확인한다. 소품 6종을 Idle·Running_A로 `look`으로 보고, 조교 옷을 정면으로 본다.

### Task 7: 내보내기, 자동 점검, 렌더 점검

**Files:**
- Create: `art/character/export/character.glb`
- Create: `art/character/export/character.manifest.json`
  - 구성: `slots`, `labels`(한글), `tintMaterials`, `covers`, `hatVariants`, `npcOnly`, `clips`, `maxBytes: 3145728`, `draco`
  - 슬롯 이름은 `hat, hair, face, top, bottom, shoes, item`. 얼굴 슬롯에 `none`은 없다.
- Modify: `scripts/check-character-glb.mjs`
  - `hatVariants`의 모든 `hair__<id>__hat`이 존재하는지 확인한다.
  - `npcOnly` 부품이 존재하는지 확인한다.
- Create: `art/character/renders/qa/*.png`, `art/character/renders/qa-sheet-*.png`

- [ ] **Step 1:** 점검 스크립트에 위 두 규칙을 추가한다. 실행해서 아직 `character.glb`가 없어 FAIL인지 확인한다.
  - Run: `node scripts/check-character-glb.mjs art/character/export/character.glb art/character/export/character.manifest.json`
- [ ] **Step 2:** 1단계와 같은 방법(NLA 트랙 + 선택 내보내기)으로 내보낸다. 크기가 3MB를 넘으면 Global Constraints 규칙대로 줄인다.
- [ ] **Step 3:** 점검 스크립트를 실행한다. Expected: PASS, 크기 ≤ 3MB.
- [ ] **Step 4:** 렌더 점검을 한다. 1단계 무대(`Stage` 컬렉션, `Cam`)로 저해상도(512×512, 16 샘플) 렌더를 찍는다.
  - (a) 모자 6 × 머리 6(정면·뒤)
  - (b) 바지 5 × {Walking_A, Running_A, Sit_Chair_Idle}
  - (c) 웃옷 5 × {Walking_A, Running_A}
  - (d) 소품 6 × Running_A
  - (e) 랜덤 조합 30개 × {Idle, Walking_A, Sit_Chair_Idle}
  - Playwright로 묶음 시트(`qa-sheet-a.png`…)를 만들어 직접 본다.
- [ ] **Step 5:** 뚫림·떠 보임·찢어짐을 목록으로 적고 고친다. 고친 부품은 해당 묶음만 다시 렌더해 확인한다.

### Task 8: 미리보기 갱신과 보고

**Files:** Modify `<scratchpad>/chars8/toy.ts`, `toy.html`(전체 manifest 반영, 소품 슬롯·프리셋 8개 추가)
- 프리셋 8개는 설계 4장에 있다: 왕·왕비·공주·왕자·마법사·학생·선생님·탐험가.
- `art/` 아래 GLB·manifest를 `<scratchpad>/chars8/art/`로 복사한다.

- [ ] **Step 1:** 뷰어에 소품 슬롯과 프리셋 버튼을 추가한다. 모자를 쓰면 `hatVariants` 메시로 바꾸는 규칙도 넣는다.
- [ ] **Step 2:** 헤드리스로 콘솔 오류가 없는지 확인한다. 프리셋 8개 스크린샷 시트를 만든다.
- [ ] **Step 3:** Aside로 `http://localhost:5299/toy.html`을 열고, 렌더 시트와 함께 보고한다(한국어).

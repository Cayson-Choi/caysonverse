# 캐릭터 조립실 1단계 — 스타일 시안 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 블렌더로 "Cayson 토이 피규어" 공통 몸 하나와 부품 6개를 만들어, 발주자가 스타일을 승인할 수 있는 렌더 이미지와 웹 미리보기를 내놓는다.

**Architecture:** KayKit Rig_Medium 뼈대와 동작 클립을 knight.glb에서 가져온다. 그 뼈대에 새 몸과 부품을 직접 모델링해 가중치를 준다. 결과는 GLB 하나로 내보내고, 임시 웹 뷰어(Three.js)와 블렌더 렌더로 보여 준다.
- 모델링은 Blender MCP의 `execute_blender_code`(bpy)로 한다.
- 게임 코드는 이 단계에서 바꾸지 않는다.

**Tech Stack:** Blender 5.2 LTS (MCP 애드온), bpy, glTF 2.0 exporter, three 0.185 (임시 뷰어), Node 24.

**Spec:** `docs/superpowers/specs/2026-10-31-character-builder-design.md` (3장 스타일, 4장 부품, 5.1 자산, 7장 1단계)

## Global Constraints

- 오리지널 디자인이어야 한다. 레고 미니피규어·로블록스 등 기존 장난감이나 게임 캐릭터를 베낀 모양은 금지한다.
- 뼈대는 KayKit Rig_Medium 그대로 쓴다. 뼈 이름과 위치를 바꾸지 않는다.
- 동작 클립은 Idle, Walking_A, Running_A, Sit_Chair_Down, Sit_Chair_Idle, Sit_Chair_StandUp, 점프 계열(knight.glb에 있는 이름 그대로)만 넣는다.
- 메시 이름 규칙은 `slot__id`다. 몸은 `body__base`, 얼굴 무늬는 `face__smile`처럼 짓는다.
- 몸은 교체식이다.
  - 웃옷 = 몸통 + 윗팔
  - 바지 = 엉덩이 + 다리
  - 신발 = 발
  - 머리와 손은 항상 피부.
- 색이 바뀌는 부분은 흰색/회색 바탕으로 칠한다(머티리얼 색으로 곱함). 로고·눈·입은 별도 머티리얼로 둔다.
- 피부색을 바꿔도 눈·입 색은 바뀌지 않아야 한다.
- 블렌더 원본은 `art/character/cayson-toy.blend`(gitignore 대상)에 저장한다.
- 내보낸 시안은 `art/character/export/character-spike.glb`(gitignore 대상)에 둔다. `client/public`에는 넣지 않는다.
- 커밋·푸시는 발주자 OK 없이 하지 않는다.

## Review Focus

- **앉기 자세에서 웃옷·바지가 몸에 묻히거나 뚫리는 것.** 의자에 앉은 사람이 그렇게 보이면 안 된다 → Task 5의 렌더 점검에 Sit_Chair_Idle 포즈를 넣는다.
- **걷기·달리기 중 팔이 몸통을 뚫는 것.** 넓은 웃옷에서 흔하다 → Task 5에서 Walking_A와 Running_A 중간 프레임을 렌더한다.
- **모자를 쓰면 머리카락이 모자 밖으로 뚫고 나오는 것** → Task 5에서 hat__cap과 두 머리 모양을 조합해 렌더한다.
- **게임 화면 크기에서 로고가 안 읽히는 것** → Task 6 웹 뷰어를 게임과 같은 카메라 거리 프리셋으로 확인한다.
- **파일이 커지는 것.** 목표는 시안 GLB 1MB 이하(부품 6개 기준) → Task 5 점검 스크립트로 크기를 출력한다.

---

### Task 1: 뼈대·동작만 남긴 블렌더 작업 파일

**Files:**
- Create: `art/character/cayson-toy.blend` (블렌더 원본, gitignore 대상)

**Interfaces:**
- Produces: 아마추어 객체 `Rig`(KayKit 뼈 이름 그대로), 액션 7~9개(위 Global Constraints의 클립), 빈 컬렉션 `Parts`

- [ ] **Step 1:** 새 씬에서 `client/public/models/knight.glb`를 가져온다.
- [ ] **Step 2:** KayKit 메시를 모두 지운다. 아마추어 `Rig`와 위 클립 액션만 남기고 나머지 액션은 지운다.
- [ ] **Step 3:** 확인한다. `get_scene_info`(query "Rig", fields details)로 뼈 수와 남은 액션 이름 목록을 출력한다.
  - 기대: 뼈 이름에 `head`, `chest`, `hips`, `handslot.r`(가져오기 후 이름 그대로)이 있다.
  - 기대: 액션은 목록의 클립만 있다.
- [ ] **Step 4:** `art/character/cayson-toy.blend`로 저장한다.

### Task 2: 공통 몸 `body__base`

**Files:**
- Modify: `art/character/cayson-toy.blend`

**Interfaces:**
- Consumes: `Rig`
- Produces: 메시 다음 다섯 개. 모두 `Rig`에 가중치가 들어 있다.
  - `body__head`: 머리+목
  - `body__hands`: 벙어리장갑 손 2개
  - `body__torso`: 기본 몸통·윗팔. 웃옷이 없을 때만 보임
  - `body__legs`: 기본 엉덩이·다리
  - `body__feet`: 기본 발
- Produces: 피부 머티리얼 `mat_skin`(흰 바탕, 머티리얼 색으로 피부색)

- [ ] **Step 1:** 뼈 위치를 읽어 몸 비율을 정한다.
  - `head` 뼈 높이에서 키를 계산한다.
  - 머리 지름은 키의 40~45%로 한다(현재 KayKit 머리 약 47%).
- [ ] **Step 2:** bpy로 모델링한다.
  - 머리: UV 구를 약간 눌린 모양으로.
  - 손: 동그란 벙어리장갑.
  - 몸통·다리·발: 둥근 박스에 서브디비전 레벨 1을 적용한다.
  - 면은 매끈하게(smooth shading).
- [ ] **Step 3:** 가중치를 준다.
  - 머리·손은 각각 `head`, `hand.*` 뼈에 100% 묶는다.
  - 몸통·다리는 자동 가중치를 준 뒤, 관절 경계를 손으로 보정한다.
- [ ] **Step 4:** 확인한다.
  - Idle·Walking_A·Sit_Chair_Idle 각 1프레임을 `look`으로 본다.
  - 기대: 메시가 뼈를 따라 움직이고 늘어지거나 찢어진 곳이 없다.
  - `get_scene_info`(fields weights)에서 "no deform bone" 정점이 0개여야 한다.

### Task 3: 얼굴 무늬 `face__smile`, `face__wink`

**Files:**
- Modify: `art/character/cayson-toy.blend`
- Create: `art/character/textures/face_smile.png`, `art/character/textures/face_wink.png` (512×256, 투명 배경)

**Interfaces:**
- Produces: 머리 앞면을 따르는 얇은 메시 `face__smile`, `face__wink`. 머티리얼 `mat_face_*`는 텍스처만 쓰고 색을 곱하지 않는다. `head` 뼈에 100% 묶는다.

- [ ] **Step 1:** 얼굴 텍스처를 그린다.
  - 큰 타원 눈(흰 하이라이트 2개), 작은 웃는 입, 분홍 볼터치.
  - 윙크는 왼눈을 ∩ 모양으로.
  - Pillow나 블렌더 이미지 API로 그린다.
- [ ] **Step 2:** 머리 앞면 부분을 복제해 0.3mm 띄운 얇은 메시에 텍스처를 붙인다.
- [ ] **Step 3:** 확인한다. 피부색을 갈색(#B07A52)으로 바꿔 `look`으로 본다. 기대: 눈·입·볼터치 색은 그대로다.

### Task 4: 부품 6개

**Files:**
- Modify: `art/character/cayson-toy.blend`
- Create: `art/character/textures/logo_cayson.png`
  - "Cayson" 워드마크, 투명 배경.
  - 글꼴은 OFL 라이선스(Nunito ExtraBold 등) — 글꼴 파일과 라이선스를 `art/character/fonts/`에 함께 둔다.

**Interfaces:**
- Consumes: `body__*` 비율
- Produces: 메시 다음 여섯 개. 모두 `Rig`에 가중치가 있고, 바뀌는 색 영역은 머티리얼 `mat_tint_<slot>`를 쓴다.
  - `hair__short`, `hair__ponytail`
  - `top__cayson_tee`: 가슴에 로고. 로고는 `mat_logo`
  - `bottom__pants`
  - `shoes__sneakers`
  - `hat__cap`: `head` 뼈에 붙는 고정 메시, 앞면에 로고

- [ ] **Step 1:** 머리카락 2종을 만든다. 머리 위에 1~2mm 띄워, 같은 공통 머리에 딱 맞게 한다.
- [ ] **Step 2:** 티셔츠를 만든다. `body__torso`를 복제해 약간 부풀린다(손목 쪽은 소매 길이만큼). 가중치는 몸통 것을 옮겨 받는다.
- [ ] **Step 3:** 긴바지(`body__legs` 기반)와 운동화(`body__feet` 기반)를 같은 방법으로 만든다.
- [ ] **Step 4:** 캡모자를 만든다. 두 머리카락 중 큰 쪽보다 1~2mm 크게 만들어 뚫림을 막는다.
- [ ] **Step 5:** 로고 텍스처를 만들어 티셔츠 가슴과 모자 앞면에 붙인다.
- [ ] **Step 6:** 확인한다. 모든 부품을 켠 상태로 Idle 프레임을 `look`(정면·3/4·뒤)으로 본다. 기대: 떠 보이거나 뚫린 곳이 없다.

### Task 5: 내보내기와 자동 점검

**Files:**
- Create: `art/character/export/character-spike.glb`
- Create: `art/character/export/character-spike.manifest.json` — `{ slots: { hair: ["short","ponytail"], face: ["smile","wink"], top: ["cayson_tee"], bottom: ["pants"], shoes: ["sneakers"], hat: ["cap"] }, tintable: { hair: true, top: true, bottom: true, shoes: true, hat: true, face: false }, clips: [...] }`
- Create: `scripts/check-character-glb.mjs`(노드 내장 모듈만 사용)

**Interfaces:**
- Produces: `node scripts/check-character-glb.mjs <glb> <manifest>`
  - 확인하는 것: 메시 이름, 클립 이름, 파일 크기, manifest 일치.
  - 통과 시 종료 코드 0, 불일치 시 1.

- [ ] **Step 1:** 점검 스크립트를 먼저 쓴다(실패하는 상태).
  - 확인 항목: manifest의 모든 `slot__id`가 GLB 메시 이름에 있는지, `body__*` 5개가 있는지, 클립 목록이 Global Constraints와 같은지.
  - 크기를 출력하고, 1MB를 넘으면 경고를 낸다.
- [ ] **Step 2:** 실행해서 실패를 확인한다.
  - Run: `node scripts/check-character-glb.mjs art/character/export/character-spike.glb art/character/export/character-spike.manifest.json`
  - Expected: GLB가 아직 없어 FAIL.
- [ ] **Step 3:** 블렌더에서 glTF를 내보낸다(GLB, 선택한 컬렉션, 애니메이션 포함, 머티리얼 내보내기). 그리고 manifest를 쓴다.
- [ ] **Step 4:** 다시 실행한다. Expected: PASS, 크기 출력.
- [ ] **Step 5:** 렌더 점검을 한다. 블렌더 EEVEE로 아래를 렌더해 `art/character/renders/`에 저장한다.
  - 자세: 정면, 3/4, 뒤, Walking_A 중간, Running_A 중간, Sit_Chair_Idle
  - 조합: hair×hat
  - 렌더를 직접 보고, Review Focus 항목(앉기·팔 뚫림·모자 뚫림)에 걸리는 곳이 없음을 확인한다.

### Task 6: 웹 미리보기와 발주자 확인

**Files:**
- Create: 임시 뷰어 (`<scratchpad>/chars8/toy.html`, `toy.ts`)
  - 지금 쓰는 미리보기 서버(`serve.cjs`, :5299)에 `/art/` 경로로 `art/character/export`를 서빙하도록 추가한다.

**Interfaces:**
- Consumes: `character-spike.glb`, manifest

- [ ] **Step 1:** 뷰어를 만든다.
  - manifest로 슬롯별 칩을 만들고, 부품 표시/숨김과 색 견본(옷 12색·머리 8색·피부 5색)을 넣는다.
  - 동작 버튼: 대기·걷기·달리기·앉기·점프.
  - 카메라 프리셋: 게임과 같은 거리.
- [ ] **Step 2:** 헤드리스 Chrome으로 렌더해 콘솔 오류가 없는지 확인한다(기존 shot 스크립트 방식).
- [ ] **Step 3:** Aside로 뷰어를 연다. 블렌더 렌더 이미지와 함께 발주자에게 보낸다.
  - 발주자가 "이 느낌"이라고 하면 2단계(전체 부품) 계획으로 넘어간다.
  - 수정 요청이 오면 Task 2~5를 고친다.

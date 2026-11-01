# 캐릭터 조립실 3단계 — 게임 코드 통합 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 2단계에서 만든 `character.glb` 하나로 학생이 입장 화면 "캐릭터 조립실"에서 부품·색·목소리를 골라 입장하고, 모든 화면이 같은 외형을 본다. AI 조교도 새 몸으로 바꾸고, 옛 KayKit 캐릭터 코드와 자산은 지운다.

**Architecture:**
- 외형은 uint8 15개(`Appearance`)다. 필드·범위·팔레트·기본값·프리셋·랜덤·검증은 `shared/src/appearance.ts` 한 곳에 둔다. 부품 수는 2단계 manifest를 옮긴 `shared/src/characterManifest.ts`(생성 파일)에서 계산한다. 서버·클라이언트·봇이 같은 함수를 쓴다.
- 클라이언트는 외형을 부품 id·색(`AvatarLook`)으로 푼다(`characterLook.ts`, 순수 모듈). `characterAvatar.ts`는 캐시된 GLTF를 `SkeletonUtils.clone`한 뒤 고른 부품만 남긴다.
  - 텍스처가 없는 부품(피부·옷·고정색)은 외형 색을 정점색으로 구운 SkinnedMesh 하나로 합친다.
  - 얼굴처럼 텍스처가 있는 부품만 따로 그린다.
  - 그래서 아바타 1명당 그리는 메시는 4개 이하다(예산 8).
- 조립실 미리보기·내 아바타·원격 아바타·NPC가 모두 `useAvatar` 훅 하나로 같은 조립 경로를 쓴다.

**Tech Stack:** Vite + React 19 + React Three Fiber 9 + three 0.185(`three/addons/utils/SkeletonUtils.js`, `three/addons/utils/BufferGeometryUtils.js`) + drei 10(`useGLTF`, `useAnimations`) + zustand · Colyseus 0.17 + @colyseus/schema 4 · vitest 4 · Playwright(`e2e/*.mjs`) · @colyseus/loadtest · Node 24

**Spec:** `docs/superpowers/specs/2026-10-31-character-builder-design.md` — 7장 3단계(게임 코드 통합). 근거는 5.2·5.3·5.4·6장이다.
- 자산 계약: `docs/superpowers/plans/2026-10-31-character-parts-stage2.md` Task 7, `scripts/check-character-glb.mjs`
- 선행 계획: `docs/superpowers/plans/2026-10-31-controls-ux.md`(병합된 결과 위에서 진행)

## Global Constraints

- 브랜치는 `feature/character-stage3`이다. 조작 개편(`feature/controls-ux`)이 main에 병합된 결과에서 만든다. 병합 전에는 시작하지 않는다.
- 커밋은 태스크마다 해도 된다. main 병합, GitHub 푸시, 배포는 매번 발주자 OK가 필요하다. 커밋 메시지 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`를 붙인다.
  - 예: `git commit -m "<제목>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`
- `npm install`·`npm ci`를 실행하지 않는다(EALLOWGIT). 새 의존성을 추가하지 않는다. 필요해지면 멈추고 발주자 승인을 받는다. `three/addons/*`는 이미 설치된 three 0.185에 들어 있다.
- Node 24(`engines.node >=24`).
- 매 태스크 끝에 루트에서 `npm run typecheck`와 `npm run test`가 모두 통과해야 한다. 이 계획이 명시해 지우는 테스트 말고는 기존 테스트를 유지한다.
- `shared/src/schema.ts`는 클라이언트·loadtest에서 `import type`으로만 쓴다. `appearance.ts`·`characterManifest.ts`는 schema를 import하지 않는 브라우저 안전 모듈이다.
- 용량 목표(설계 5.4):
  - 첫 접속 전체 다운로드 ≤ 8 MB(8,388,608 B)
  - `character.glb` ≤ 4.5 MB(4,718,592 B = manifest `maxBytes`. 프리셋 차림 부품 25개 추가로 3 MB에서 올렸다)
  - manifest `"draco": false`만 받는다. Draco 압축이면 외부 디코더가 필요하므로 멈추고 발주자에게 묻는다.
- 성능 목표:
  - 강의실 100명 장면에서 중급 모바일 30fps
  - 아바타 1명당 그리는 메시 ≤ 8(`MAX_DRAW_MESHES`)
  - 프레임 데이터는 React state·zustand에 넣지 않고, 매 프레임 경로에서 배열·객체를 새로 만들지 않는다(기존 규칙).
- 사용자에게 보이는 문구는 한국어, 식별자·파일명·명령은 영어.
- 예전에 저장된 값(`localStorage["cv.entry"]`의 `character`/`tint`)이나 망가진 값은 닉네임만 살리고, 외형은 `DEFAULT_APPEARANCE`로 바꾼다.
- 잘못된 외형으로 입장하면 거부한다. 문구는 `"외형 선택이 올바르지 않습니다"`(`APPEARANCE_ERROR`).
- `art/`는 gitignore 대상이고 main 체크아웃(`D:/Codex/cayson-games/caysonverse/art/character`)에만 있다.
  - 워크트리에서 실행하면 `--art <그 경로>`를 넘긴다.
  - 커밋하는 것은 `client/public/` 복사본과 생성된 `shared/src/characterManifest.ts`뿐이다.
- 지난 일회성 e2e(`e2e/task-*.mjs`, `e2e/task-ux-*.mjs`)는 고치지도 다시 돌리지도 않는다. 캐릭터 선택을 쓰는 task-05·v2-02·v2-05·v2-13은 낡은 증적으로 남는다. 새 검증은 `e2e/task-char-*.mjs`가 맡는다.
- 각 태스크의 커밋 단계에서는 그 태스크 **Files**에 적힌 파일만 `git add`한다. 제목은 단계에 적힌 문구를 쓰고, 위 trailer를 붙인다.
- 새 e2e 형식은 기존과 같다.
  - 독립 Playwright 스크립트, `CV_CLIENT_URL` 기본값 `http://localhost:5173`(프로덕션 번들을 재는 `task-char-load.mjs`만 `http://localhost:2567`)
  - 증적은 `.superpowers/sdd/evidence/task-char/`에 남긴다.
  - 콘솔·페이지 오류 0, 종료 코드 0이면 통과다.
- 동작 클립은 manifest `clips` 13개다. 기본 7개(Idle, Walking_A, Running_A, Sit_Chair_Down, Sit_Chair_Idle, Sit_Chair_StandUp, Jump_Full_Short), 롱스커트 변형 3개(Walking_A_LongSkirt, Running_A_LongSkirt, Jump_Full_Short_LongSkirt), 짧은 치마 변형 3개(Walking_A_ShortSkirt, Running_A_ShortSkirt, Jump_Full_Short_ShortSkirt)다.
  - 기본 7개의 이름은 조작 개편 후의 `CLIP` 값과 같다. 이름을 바꾸지 않는다.
  - 변형은 `CLIP`에 넣지 않는다. manifest `clipVariants`(하의 부품 id → 기본 클립 → 변형 클립)로만 고르고, 지금 매핑은 `longskirt`의 걷기·달리기·점프뿐이다.
  - 아바타 애니메이션 코드는 재생할 클립 이름을 항상 `clipFor(CLIP.x, look)`(Task 4)로 정한다. 롱스커트 아바타가 기본 클립을 그대로 재생하면 다리가 치마를 뚫는다(Review Focus 7).

## Review Focus

1. **같은 외형의 아바타 여럿 중 한 명이 나가면 남은 사람의 몸이 사라지는 것.** 프리셋 외형은 합친 지오메트리를 공유한다. 마지막 사용자가 나갈 때만 해제해야 한다. → Task 5 `keeps a shared solid geometry until its last avatar is released`
2. **연결이 끊겼다 돌아온 아바타의 얼굴이 네모 판으로 보이는 것.** 반투명(50%) 처리 뒤 투명도를 되돌릴 때 BLEND 재질까지 불투명으로 바꾸면 이렇게 된다. → Task 5 `setAvatarOpacity restores the authored BLEND state`, Task 10 데스크톱 12단계
3. **업데이트 전 저장값과 새로고침하지 않은 옛 탭.**
   - 옛 `cv.entry` 저장값이 있는 학생도 입장 화면이 정상으로 떠야 한다.
   - 옛 번들이 `{character, tint}`로 입장하면 서버는 한국어로 거부하고 멀쩡해야 한다.
   - → Task 6 `migrates a pre-builder { character, tint } identity…`, `rejects the pre-builder { character, tint } options`, Task 10 데스크톱 14단계
4. **서버가 보낸 외형에 이 클라이언트가 모르는 부품이 있는 것.** 서버가 더 새 manifest를 쓰는데 새로고침하지 않은 옛 탭이 받은 원격 외형이 대표적이다. 아무것도 안 그리거나 예외가 나면 안 되고, 그 슬롯의 기본 부품·색으로 보여야 한다. → Task 4 `falls back to the slot's default part and color for an index the client does not know (Review Focus 4)`
5. **휴대폰 조립실의 사용성 문제.** 가로 스크롤이 생기거나, 44px 미만 버튼이 있거나, 입장 버튼에 손이 닿지 않으면 안 된다. → Task 7 CSS 규칙, Task 10 모바일 1~3단계
6. **투구 계열 모자 밖으로 머리카락이 뚫고 나오는 것.** `knight_helmet`·`space_helmet`처럼 머리를 감싸는 모자는 어떤 머리 모양과 같이 써도 머리카락이 삐져나오면 안 된다(설계 4장). manifest `hatHidesHair`에 든 모자를 쓰면 머리카락 메시를 그리지 않는다. → Task 4 `hides the hair under a hatHidesHair helmet`, Task 10 데스크톱 6단계 투구 시트
7. **롱스커트 아바타가 달리거나 점프할 때 기본 동작이 재생되어 다리가 치마를 뚫는 것.** 롱스커트(공주 프리셋 포함)는 다리 움직임을 줄인 변형 클립(`*_LongSkirt`)으로 재생해야 한다. 클립 이름을 `clipFor` 없이 `CLIP.*` 그대로 재생하는 곳이 하나라도 있거나, 외형이 바뀐 뒤 클립을 다시 정하지 않으면 생긴다.
   - → Task 2 `clipVariants only names real bottom parts and real clips`
   - → Task 4 `clipFor plays the long-skirt variant for walk, run and jump (Review Focus 7)`, `clipFor keeps the base clip …`
   - → Task 10 데스크톱 11단계(공주 `clip` 단언, 동작 시트의 롱스커트 행)

---

## 파일 구조

| 파일 | 상태 | 책임 |
|---|---|---|
| `scripts/sync-character-assets.mjs` | 신규 | art/ → public 복사, 점검, manifest TS 생성 |
| `scripts/check-character-glb.mjs` | 추가(2단계 산출) | GLB ↔ manifest 점검 |
| `shared/src/characterManifest.ts` | 생성 | 2단계 manifest를 타입 있는 상수로 |
| `shared/src/appearance.ts` | 신규 | 외형 필드·범위·팔레트·기본값·프리셋·랜덤·검증 |
| `shared/src/constants.ts` | 수정 | 범위 재수출. `CHARACTER_COUNT`·`TINT_*` 삭제(Task 9) |
| `shared/src/schema.ts` | 수정 | `Player`의 `character`·`tint` → 외형 15필드 |
| `server/src/rooms/joinValidation.ts`, `WorldRoom.ts` | 수정 | 외형 검사·기록 |
| `client/src/game/characterLook.ts` | 신규 | 외형 → 부품·색, 보이는 메시, 모르는 부품 폴백, 롱스커트 변형 클립 해석 `clipFor`(순수) |
| `client/src/game/characterAvatar.ts` | 신규 | 복제·가지치기·합치기·투명도·지오메트리 캐시(three) |
| `client/src/game/useAvatar.ts` | 신규 | GLTF 로딩 + 조립·해제 훅, DEV 프로브 |
| `client/src/game/RenderStatsProbe.tsx` | 신규 | DEV `__cvRenderInfo` |
| `client/src/ui/builderOptions.ts`, `BuilderPreview.tsx`, `BuilderPanel.tsx`, `builder.css` | 신규 | 조립실 |
| `client/src/ui/EntryScreen.tsx`, `entry.css`, `validation.ts` | 수정 | 조립실 배치, 외형 검증 |
| `client/src/net/identityCache.ts`, `connection.ts`, `resilience.ts`, `chatSync.ts` | 수정 | 외형 저장·전송·재입장, 목소리 성별 |
| `client/src/stores/appStore.ts` | 수정 | `Identity.appearance` |
| `client/src/game/remoteStore.ts`, `remoteSync.ts`, `debug.ts` | 수정 | 원격 외형 |
| `client/src/game/LocalPlayer.tsx`, `RemotePlayer.tsx`, `RemotePlayers.tsx`, `WorldScene.tsx` | 수정 | `useAvatar`로 교체 |
| `client/src/game/npcLook.ts`, `NpcCharacter.tsx` | 수정 | 안드로이드 옷 + 강조색 + 헤일로 |
| `client/public/models/character.glb`, `client/public/brand/cayson-logo-white.png` | 신규 | 자산(로고는 조립실 제목 전용) |
| `client/public/models/{knight,barbarian,mage,rogue,crown}.glb`, `client/src/game/{avatar,royalPalette,royalAttachments}.ts`, `royalPalette.test.ts`, `characterConfig.test.ts`, `scripts/dump-uv-cells.mjs` | 삭제 | 옛 캐릭터 |
| `loadtest/bot.ts` | 수정 | 랜덤 외형 입장 |
| `e2e/task-char-load.mjs`, `task-char-perf.mjs`, `task-char-builder.mjs` | 신규 | 검증 |
| `docs/design.md`, `docs/loadtest.md`, `client/public/models/LICENSE.md` | 수정 | 문서 |

## 바뀌는 기존 테스트

- `server/src/rooms/joinValidation.test.ts`
  - "character / tint" describe를 "appearance"로 바꾼다.
  - 닉네임 테스트의 `base`는 `{ appearance: DEFAULT_APPEARANCE }`로 바꾼다(Task 6).
- `server/src/rooms/WorldRoom.integration.test.ts`
  - `VALID_JOIN`·`JOIN_A`·`JOIN_B`·`ADMIN_JOIN`과 인라인 `character: N, tint: M`을 모두 `appearance: …`로 바꾼다.
  - `:98-99` 단언은 `pickAppearance(player)`로 바꾼다(Task 6).
- `client/src/net/identityCache.test.ts`: 새 형식으로 다시 쓴다(Task 6).
- `client/src/ui/validation.test.ts`: `CHARACTER_COUNT`·`TINT_COUNT`·왕실 케이스를 지우고 외형 케이스를 넣는다(Task 6).
- `client/src/game/remoteStore.test.ts`, `client/src/stores/appStore.test.ts`, `client/src/net/resilience.test.ts`: 리터럴의 `character: 0, tint: 0`을 `appearance: DEFAULT_APPEARANCE`로 바꾼다(Task 6).
- `client/src/game/characterConfig.test.ts`, `client/src/game/royalPalette.test.ts`: 파일을 삭제한다(Task 9).

## 스펙 대응표

| 스펙 | 태스크 |
|---|---|
| 5.2 스키마·`JoinOptions`·`validateJoinOptions`·재접속 캐시·옛 저장값 | 3, 6 |
| 5.3 GLB 1회 로드·`SkeletonUtils.clone`·숨긴 부품 안 그림·`cloneTinted` 대체 | 2, 4, 5, 6 |
| 5.3 조립실(3D 미리보기·칩·견본·프리셋 8·랜덤·목소리·모바일) | 3, 7 |
| 5.3 AI 조교 4명 | 8 |
| 5.3 정리(KayKit GLB 4개·`royalPalette`·`royalAttachments`·왕관 GLB) | 9 |
| 5.4 용량·성능 | 1, 5, 11 |
| 3장 조립실 제목의 Cayson 로고 | 7 |
| 4장 부품·팔레트·왕관·티아라 금색·목소리·랜덤·마지막 외형 기억·프리셋 | 3, 6, 7 |
| 6장 자동 테스트(범위·직렬화·재접속 캐시·manifest↔GLB·기존 테스트) | 2, 3, 6 |
| 6장 렌더 점검(게임 렌더러로) | 10 |
| 6장 부하 테스트(랜덤 외형 봇, 30분) | 6, 11 |

---

### Task 1: 교체 전 기준선 — 렌더 통계 훅, 측정 스크립트, KayKit 수치

"100명 성능이 지금보다 나빠지지 않는다"(설계 2장)와 "첫 접속 18MB → 8MB"를 같은 방법으로 앞뒤 비교하기 위해, 캐릭터를 바꾸기 전에 측정한다.

**Files:**
- Create: `client/src/game/RenderStatsProbe.tsx`
- Modify: `client/src/game/WorldScene.tsx` — Canvas 안에 `{import.meta.env.DEV && <RenderStatsProbe />}`
- Create: `e2e/task-char-load.mjs`, `e2e/task-char-perf.mjs`
- Modify: `docs/loadtest.md` — 새 절 "캐릭터 조립실 재측정 (2026-10-31)"의 표 뼈대와 KayKit 열

**Interfaces:**
- Consumes(조작 개편): `e2e/task-ux-perf.mjs`의 강의실 진입 루틴과 CPU 4× 스로틀 방식, `npm run loadtest -- --zone lectureHall`, `__cv.getRemotes()`
- Produces:

```ts
// RenderStatsProbe.tsx (DEV 전용, null 렌더)
export function RenderStatsProbe(): null;
// window.__cvRenderInfo(): { calls: number; triangles: number; geometries: number; textures: number }
```

- 측정 스크립트 규칙:
  - 둘 다 `--baseline`이면 라벨 `kaykit`으로 기록만 하고, 아니면 라벨 `toy`로 기록하고 게이트를 판정한다.
  - 결과는 `.superpowers/sdd/evidence/task-char/{load,perf}-<라벨>.json`에 남긴다.
- `task-char-load.mjs` — 프로덕션 번들 첫 접속 바이트:
  - 대상: `CV_CLIENT_URL` 기본 `http://localhost:2567`(서버가 `client/dist`를 서빙)
  - 새 컨텍스트, CDP `Network.enable` + `Network.setCacheDisabled { cacheDisabled: true }`. `Network.loadingFinished`의 `encodedDataLength`를 모두 더한다(웹소켓 프레임은 들어가지 않는다).
  - 측정 구간: 첫 페이지 열기 → `button.cv-submit`이 보임 → networkidle → `input.cv-input[placeholder="2~12자"]`에 "용량측정" 입력 → 입장 → 10 s 대기 + networkidle
  - 기록: 합계, URL별 상위 15개
  - 게이트(`toy`만):
    - 합계 ≤ 8,388,608
    - `/models/character.glb` 응답 ≤ 3,145,728
    - `knight|barbarian|mage|rogue|crown`.glb 요청 0건
- `task-char-perf.mjs` — 강의실 100명 렌더:
  - 375×812, `isMobile`, `hasTouch`, CDP `Emulation.setCPUThrottlingRate { rate: 4 }`
  - "성능측정"으로 입장한다. 강의실 진입은 `e2e/task-ux-perf.mjs`의 루틴을 그대로 옮겨 쓴다.
  - `__cv.getRemotes().length >= 100`을 기다린다.
  - 20 s 동안 다음을 잰다.
    - rAF fps: 평균, 하위 5%
    - 1 s마다 `__cvRenderInfo()`
    - `performance.memory.usedJSHeapSize`
    - `window.__cvAvatars`가 있으면(Task 5 이후) 항목 수, 최대 `drawMeshes`, 평균 `triangles`
  - 게이트(`toy`만):
    - `__cvAvatars` 항목 ≥ 100
    - 최대 `drawMeshes` ≤ 8
    - 평균 `calls` ≤ `perf-kaykit.json`의 평균 `calls`
    - fps는 나란히 기록만 한다. headless 값은 참고용이고, 30fps는 Task 11의 발주자 실기기 확인으로 판정한다.

- [ ] **Step 1: 훅 구현.**
  - `useFrame`(priority 0. 양수 priority는 R3F 자동 렌더를 끈다)에서 `gl.info.render.calls/triangles`와 `gl.info.memory.geometries/textures`를 모듈 객체에 복사한다(할당 없음).
  - `window.__cvRenderInfo`는 그 복사본을 돌려준다. 언마운트 때 지운다.
- [ ] **Step 2: 스크립트 2개 작성**(위 규칙 그대로).
- [ ] **Step 3: 첫 접속 기준선.**
  - `npm run build` → `NODE_ENV=production node server/dist/index.cjs` → `node e2e/task-char-load.mjs --baseline`
  - Expected: `load-kaykit.json`이 생기고, 합계는 약 18 MB(설계 2장 "약 18MB")
- [ ] **Step 4: 100명 기준선.**
  - `npm run dev`를 띄우고, 다른 터미널에서 `npm run loadtest -- --numClients 100 --duration 300 --zone lectureHall`
  - 실행 중에 `node e2e/task-char-perf.mjs --baseline`
  - Expected: `perf-kaykit.json`(calls·triangles·fps·heap)
- [ ] **Step 5: 기록.** `docs/loadtest.md` 새 절에 표(행: 첫 접속 바이트, character GLB 바이트, 평균 draw calls, 평균 triangles, fps 평균/하위 5%, JS heap)를 만들고 KayKit 열을 채운다.
- [ ] **Step 6: 통과 확인.** `npm run typecheck && npm run test` PASS.
- [ ] **Step 7: 커밋.**

```bash
git add client/src/game/RenderStatsProbe.tsx client/src/game/WorldScene.tsx e2e/task-char-load.mjs e2e/task-char-perf.mjs docs/loadtest.md
git commit -m "test: 캐릭터 교체 전 첫 접속 용량·강의실 100명 렌더 기준선 (캐릭터 3단계 Task 1)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: 자산 동기화, 타입 manifest, GLB 일치 테스트

**Files:**
- Create: `scripts/sync-character-assets.mjs`
- Add: `scripts/check-character-glb.mjs`(2단계 산출물. 브랜치에 없으면 main 체크아웃에서 복사한다)
- Create(생성물): `shared/src/characterManifest.ts`, `client/public/models/character.glb`, `client/public/brand/cayson-logo-white.png`(조립실 제목 전용)
- Test: `shared/src/characterManifest.test.ts`

**Interfaces:**
- Produces(`shared/src/characterManifest.ts`, 머리 주석 `// GENERATED by scripts/sync-character-assets.mjs — do not edit`):

```ts
export interface CharacterManifestShape {
  slots: Record<string, readonly string[]>; slotLabels: Record<string, string>;
  labels: Record<string, Record<string, string>>; tintMaterials: Record<string, string>;
  defaultColors: Record<string, Record<string, string>>;
  covers: Record<string, string>; hatVariants: Record<string, string>; hairCut: number; hatHidesHair: readonly string[];
  npcOnly: Record<string, readonly string[]>;
  clips: readonly string[];                                        // 기본 7 + 롱스커트 변형 3 = 10
  clipVariants: Record<string /* bottom 부품 id */, Record<string /* 기본 클립 */, string /* 변형 클립 */>>; // 지금: longskirt → *_LongSkirt 3개, skirt·petal_skirt → *_ShortSkirt 3개(보폭 유지, 무릎 접힘만 제한)
  maxBytes: number; draco: boolean;
}
export const CHARACTER_MANIFEST = { /* character.manifest.json 그대로 */ } as const satisfies CharacterManifestShape;
export type CharacterSlot = keyof typeof CHARACTER_MANIFEST.slots; // "hat"|"hair"|"face"|"top"|"bottom"|"shoes"|"item"
export const CHARACTER_SLOTS: readonly CharacterSlot[];          // manifest slots 순서
export const BODY_MESHES = ["body__head", "body__hands", "body__torso", "body__legs", "body__feet"] as const;
```

- `node scripts/sync-character-assets.mjs [--art <dir>]`(기본값 `<repo>/art/character`):
  1. `check-character-glb.mjs`를 `<art>/export/character.glb`와 `character.manifest.json`으로 실행한다. 실패하면 종료 코드 1. 이 점검은 `clipVariants`의 기본 클립과 변형 클립이 GLB에 모두 있는지도 본다.
  2. `draco !== false`이면 종료 코드 1. 메시지: "Draco GLB는 디코더가 필요 — 발주자 승인 전 금지".
  3. 다음과 같이 복사한다.
     - `export/character.glb` → `client/public/models/character.glb`
     - `art/brand/cayson-logo-white.png`(`<art>`의 형제 폴더. 곧 `<art>/../brand/cayson-logo-white.png`) → `client/public/brand/cayson-logo-white.png` (조립실 제목에만 쓴다)
  4. TS 파일을 쓰고, 복사한 파일 크기를 출력한다.

- [ ] **Step 0: 선행 확인.** 2단계 Task 7·8이 끝났어야 한다(렌더 점검 수정 완료, 발주자 보고 완료).
  - Run: `node scripts/check-character-glb.mjs <art>/export/character.glb <art>/export/character.manifest.json`
  - Expected: `PASS`, 그리고 manifest에 `"draco": false`. 아니면 멈추고 보고한다.
  - **프리셋 전용 부품(설계 4장)이 manifest와 GLB에 모두 들어 있어야 Task 3을 시작한다.** 각 슬롯의 기존 id 뒤에 아래 순서로 붙는다. 없으면 멈추고 2단계 자산 쪽에 보고한다(이 계획에서 자산을 고치지 않는다).
    - hat: `tiara`, `safari`, `knight_helmet`, `pirate_hat`, `space_helmet`, `flower_crown`
    - top: `prince_coat`, `gown_top`, `explorer_vest`, `armor`, `pirate_stripe`, `spacesuit`, `petal_top`
    - bottom: `space_pants`, `petal_skirt`
    - shoes: `tall_boots`, `wizard_shoes`, `hiking_boots`, `space_boots`
    - item: `scepter`, `rose`, `staff`, `map`, `wooden_sword`, `telescope`
    - `defaultColors.hat.tiara`는 `"#D4A93A"`(금색. crown과 같다)
    - 위 부품이 모두 있는지는 아래 GLB 일치 테스트가 확인한다. 첫 테스트가 부품마다 메시 노드를 보고, 부품 수 고정 테스트가 슬롯별 개수(hat 11, top 12, bottom 7, shoes 8, item 12)와 금색 기본값을 고정한다.
  - **롱스커트 변형 클립도 manifest와 GLB에 모두 들어 있어야 한다.** manifest `clips` 13개(기본 7개 + `*_LongSkirt` 3개 + `*_ShortSkirt` 3개)와 `clipVariants`(longskirt → `*_LongSkirt`, skirt·petal_skirt → `*_ShortSkirt`)가 있어야 한다. 없으면 멈추고 2단계 자산 쪽에 보고한다. 클립 일치는 아래 GLB 일치 테스트가 확인한다.
- [ ] **Step 1: 실패하는 테스트 작성.** 테스트는 `shared/`에서 실행되므로 경로는 `resolve(process.cwd(), "../client/public/…")`로 잡는다. GLB JSON 청크는 `buf.readUInt32LE(12)` 길이만큼 `buf.subarray(20, …)`에서 읽는다.

```ts
it("ships every manifest part, hat variant, npcOnly part and body mesh as a mesh node");
const BASE_CLIPS = ["Idle", "Walking_A", "Running_A", "Sit_Chair_Down", "Sit_Chair_Idle", "Sit_Chair_StandUp", "Jump_Full_Short"];
const VARIANT_CLIPS = ["Walking_A_LongSkirt", "Running_A_LongSkirt", "Jump_Full_Short_LongSkirt", "Walking_A_ShortSkirt", "Running_A_ShortSkirt", "Jump_Full_Short_ShortSkirt"];
it("ships exactly the manifest clips: the 7 base clips plus the 3 long-skirt variants", () => {
  expect([...CHARACTER_MANIFEST.clips].sort()).toEqual([...BASE_CLIPS, ...VARIANT_CLIPS].sort()); // 13개. 기본 7개 이름은 바뀌지 않는다
  expect(gltf.animations.map((a) => a.name).sort()).toEqual([...CHARACTER_MANIFEST.clips].sort());
});
it("clipVariants only names real bottom parts and real clips", () => {
  const variants: Record<string, Record<string, string>> = CHARACTER_MANIFEST.clipVariants;
  for (const [bottom, map] of Object.entries(variants)) {
    expect(CHARACTER_MANIFEST.slots.bottom).toContain(bottom);       // 키 = 실제 bottom 부품 id
    for (const [base, variant] of Object.entries(map)) {
      expect(BASE_CLIPS).toContain(base);                            // 기본 클립(= CLIP 값)만 키가 된다
      expect(CHARACTER_MANIFEST.clips).toContain(variant);           // 변형도 manifest·GLB에 실제로 있다
      expect(variant).not.toBe(base);
    }
  }
  expect(variants).toEqual({ longskirt: { Walking_A: "Walking_A_LongSkirt", Running_A: "Running_A_LongSkirt", Jump_Full_Short: "Jump_Full_Short_LongSkirt" } });
});
it("stays within maxBytes (4.5 MB) and is not Draco-compressed", () => {
  expect(CHARACTER_MANIFEST.maxBytes).toBe(4_718_592);
  expect(statSync(GLB).size).toBeLessThanOrEqual(CHARACTER_MANIFEST.maxBytes);
  expect(CHARACTER_MANIFEST.draco).toBe(false);
  expect(gltf.extensionsUsed ?? []).not.toContain("KHR_draco_mesh_compression");
});
it("meets the merge preconditions: identity part transforms, one skin, indexed primitives");
// 부품 노드(이름이 /^(body|hat|hair|face|top|bottom|shoes|item)__/)마다 translation/rotation/scale 없음,
// skin === 0, 모든 primitive에 indices 있음, 속성은 POSITION/NORMAL/JOINTS_0/WEIGHTS_0(+TEXCOORD_0)
it("classifies every material: only mat_face_* is textured", () => {
  // 이름은 /^mat_(skin|tint_\w+|fixed_\w+|face_\w+)$/, baseColorTexture 유무 ⇔ face,
  // tintMaterials의 값이 모두 GLB 재질로 존재
});
it("pins the v1 part counts (spec §4) and the crown and tiara gold defaults", () => {
  expect(CHARACTER_SLOTS).toEqual(["hat", "hair", "face", "top", "bottom", "shoes", "item"]);
  expect(Object.fromEntries(CHARACTER_SLOTS.map((s) => [s, CHARACTER_MANIFEST.slots[s].length])))
    .toEqual({ hat: 11, hair: 5, face: 6, top: 12, bottom: 7, shoes: 8, item: 12 });
  expect(CHARACTER_MANIFEST.defaultColors.hat.crown).toBe("#D4A93A");
  expect(CHARACTER_MANIFEST.defaultColors.hat.tiara).toBe("#D4A93A");
  expect(CHARACTER_MANIFEST.npcOnly).toEqual({ top: ["android"], bottom: ["android"], shoes: ["android"] });
});
```

- [ ] **Step 2: 실패 확인.** `npm run test -w shared -- characterManifest` → FAIL(모듈·파일 없음)
- [ ] **Step 3: 동기화 스크립트 구현 후 실행.** `node scripts/sync-character-assets.mjs`(워크트리면 `--art`). Expected: 점검 PASS, 크기 출력(GLB ≤ 4.5 MB)
- [ ] **Step 4: 통과 확인.** `npm run test -w shared && npm run typecheck` PASS
- [ ] **Step 5: 커밋.**

```bash
git add scripts/sync-character-assets.mjs scripts/check-character-glb.mjs shared/src/characterManifest.ts shared/src/characterManifest.test.ts client/public/models/character.glb client/public/brand/cayson-logo-white.png
git commit -m "feat: 조립식 캐릭터 GLB와 타입 manifest, 조립실 제목 로고 복사, GLB 일치 테스트 (캐릭터 3단계 Task 2)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: 외형 모델 — `shared/src/appearance.ts`

**Files:**
- Create: `shared/src/appearance.ts`, Test: `shared/src/appearance.test.ts`
- Modify: `shared/src/constants.ts` — `export { APPEARANCE_FIELDS, APPEARANCE_RANGES } from "./appearance";`(설계 5.2 "shared/constants.ts의 단일 소스")

**Interfaces:**
- Consumes: `CHARACTER_MANIFEST`, `CharacterSlot`, `CHARACTER_SLOTS`(Task 2)
- Produces:

```ts
export const APPEARANCE_FIELDS = ["hat", "hatColor", "hair", "hairColor", "face", "skin", "top", "topColor",
  "bottom", "bottomColor", "shoes", "shoesColor", "item", "itemColor", "voice"] as const;
export type AppearanceField = (typeof APPEARANCE_FIELDS)[number];
export type Appearance = Record<AppearanceField, number>;       // 슬롯 필드 = 부품 인덱스(필드 이름 = 슬롯 이름)
export interface PaletteColor { hex: string; label: string }
export const CLOTHES_PALETTE: readonly PaletteColor[];          // 12
export const HAIR_PALETTE: readonly PaletteColor[];             // 8
export const SKIN_PALETTE: readonly PaletteColor[];             // 5
export const OPTIONAL_SLOTS: readonly CharacterSlot[];          // ["hat", "hair", "item"] — 인덱스 0 = 없음
export const SLOT_OPTIONS: Record<CharacterSlot, readonly (string | null)[]>; // 선택 슬롯은 [null, ...manifest], 나머지는 manifest 그대로
export const SLOT_COLOR_FIELD: Record<CharacterSlot, AppearanceField>;
// hat→hatColor, hair→hairColor, face→skin, top→topColor, bottom→bottomColor, shoes→shoesColor, item→itemColor
export function paletteFor(field: AppearanceField): readonly PaletteColor[]; // 옷 5필드→CLOTHES, hairColor→HAIR, skin→SKIN
export const VOICE_GENDERS = ["male", "female"] as const;
export type VoiceGender = (typeof VOICE_GENDERS)[number];
export const APPEARANCE_RANGES: Readonly<Record<AppearanceField, number>>; // SLOT_OPTIONS·팔레트·VOICE_GENDERS 길이에서 계산
export const APPEARANCE_ERROR = "외형 선택이 올바르지 않습니다";
export function appearanceFromIds(parts: Record<CharacterSlot, string | null>, colors: Omit<Appearance, CharacterSlot>): Appearance;
export const DEFAULT_APPEARANCE: Readonly<Appearance>;
export function validateAppearance(value: unknown): Appearance | null; // 15필드 모두 [0, range) 정수여야 함, 그 15필드만 담은 새 객체
export function pickAppearance(src: Readonly<Record<AppearanceField, number>>): Appearance; // Player 등에서 15필드 복사
export function randomAppearance(rand: () => number): Appearance;  // 필드마다 min(range−1, floor(rand()·range))
export function withPart(a: Appearance, slot: CharacterSlot, index: number): Appearance; // manifest.defaultColors가 있으면 그 색으로
export interface AppearancePreset {
  id: string; label: string;
  parts: Record<CharacterSlot, string | null>;
  colors: Pick<Appearance, "hatColor" | "hairColor" | "topColor" | "bottomColor" | "shoesColor" | "itemColor">;
}
export const APPEARANCE_PRESETS: readonly AppearancePreset[];
export function applyPreset(a: Appearance, p: AppearancePreset): Appearance; // 부품·색만 바꾸고 skin·voice는 유지
export function voiceGender(index: number): VoiceGender;          // 0→male, 1→female, 그 밖→male
```

- **팔레트**(1단계 승인 뷰어 값, 순서가 인덱스다):
  - CLOTHES:
    - 0 빨강 `#E53E3E`, 1 주황 `#F6873F`, 2 노랑 `#F6C445`, 3 연두 `#8BCF5A`
    - 4 초록 `#2F9E62`, 5 하늘 `#4FB3E8`, 6 파랑 `#2F6FDE`, 7 남색 `#2D3A75`
    - 8 보라 `#8B5CF6`, 9 분홍 `#F07AAE`, 10 흰색 `#F7F7F2`, 11 금색 `#D4A93A`
  - HAIR:
    - 0 검정 `#2B2420`, 1 진갈색 `#4A3226`, 2 갈색 `#8A5A3B`, 3 금발 `#F0C060`
    - 4 주황 `#E07A3A`, 5 분홍 `#F49AC1`, 6 파랑 `#5B8DEF`, 7 회색 `#B8B8B8`
  - SKIN: `#FFDCC2`, `#F5C9A0`, `#E0A47A`, `#B07A52`, `#7A4E33`. 라벨은 "피부색 1"~"피부색 5"다.
- **`DEFAULT_APPEARANCE`**(1단계 시안 기본 외형):
  - 부품: 모자 없음, short, smile, tee, pants, sneakers, 소품 없음
  - 색: hatColor 2, hairColor 1, skin 0, topColor 6, bottomColor 7, shoesColor 0, itemColor 2
  - voice 0
- **프리셋 8개**(설계 4장 "프리셋 캐릭터 8개"를 그대로 따른다. 모두 동화·모험 주인공이고, 모자·머리·웃옷·바지·신발·소품을 모두 갖춘다(null 없음). 색은 CLOTHES·HAIR 인덱스. 프리셋은 skin·voice를 바꾸지 않는다):

| id | label | hat / 색 | hair / 색 | face | top / 색 | bottom / 색 | shoes / 색 | item / 색 |
|---|---|---|---|---|---|---|---|---|
| prince | 왕자 | crown / 11 | short / 3 | smile | prince_coat / 6 | pants / 10 | tall_boots / 7 | scepter / 11 |
| princess | 공주 | tiara / 11 | twintails / 2 | wink | gown_top / 9 | longskirt / 9 | dress / 10 | rose / 0 |
| knight | 기사 | knight_helmet / 0 | short / 1 | smile | armor / 0 | pants / 7 | tall_boots / 7 | wooden_sword / 2 |
| wizard | 마법사 | wizard / 8 | curly / 7 | calm | robe / 8 | pants / 7 | wizard_shoes / 8 | staff / 5 |
| fairy | 요정 | flower_crown / 9 | bob / 5 | wink | petal_top / 3 | petal_skirt / 3 | sandals / 9 | wand / 2 |
| explorer | 탐험가 | safari / 11 | ponytail / 2 | glasses | explorer_vest / 4 | shorts / 11 | hiking_boots / 1 | map / 2 |
| pirate | 해적 | pirate_hat / 7 | curly / 0 | tongue | pirate_stripe / 0 | shorts / 7 | tall_boots / 7 | telescope / 11 |
| astronaut | 우주비행사 | space_helmet / 10 | short / 1 | wow | spacesuit / 10 | space_pants / 10 | space_boots / 6 | flag / 6 |

- [ ] **Step 1: 실패하는 테스트 작성.**

```ts
it("lists the 15 spec fields in spec order (spec §5.2)");
it("derives every range from the manifest and palettes (spec §4)", () =>
  expect(APPEARANCE_RANGES).toEqual({ hat: 12, hatColor: 12, hair: 6, hairColor: 8, face: 6, skin: 5, top: 12,
    topColor: 12, bottom: 7, bottomColor: 12, shoes: 8, shoesColor: 12, item: 13, itemColor: 12, voice: 2 }));
it("puts 없음 first only on hat, hair and item", () => {
  for (const s of ["hat", "hair", "item"] as const) expect(SLOT_OPTIONS[s][0]).toBeNull();
  for (const s of ["face", "top", "bottom", "shoes"] as const) expect(SLOT_OPTIONS[s]).not.toContain(null);
});
it("validateAppearance accepts every field at 0 and at range − 1");
it("validateAppearance rejects −1, range, 1.5, \"0\", NaN, a missing field, null, arrays and numbers", () => {
  for (const f of APPEARANCE_FIELDS) for (const bad of [-1, APPEARANCE_RANGES[f], 1.5, "0", NaN])
    expect(validateAppearance({ ...DEFAULT_APPEARANCE, [f]: bad })).toBeNull();
});
it("validateAppearance returns a fresh object holding exactly the 15 fields", () =>
  expect(Object.keys(validateAppearance({ ...DEFAULT_APPEARANCE, evil: 1 })!).sort()).toEqual([...APPEARANCE_FIELDS].sort()));
it("DEFAULT_APPEARANCE is valid and is the stage-1 look"); // SLOT_OPTIONS[s][DEFAULT[s]]가 위 기본 부품
it("randomAppearance stays valid and reaches both ends of every range", () => {
  expect(randomAppearance(() => 0)).toEqual(Object.fromEntries(APPEARANCE_FIELDS.map((f) => [f, 0])));
  expect(randomAppearance(() => 0.999999)).toEqual(Object.fromEntries(APPEARANCE_FIELDS.map((f) => [f, APPEARANCE_RANGES[f] - 1])));
  // 시드 LCG 500회 → 전부 validateAppearance !== null
});
it("withPart: choosing the crown or the tiara paints it gold; other hats keep the chosen color", () => {
  for (const gold of ["crown", "tiara"])
    expect(withPart({ ...DEFAULT_APPEARANCE, hatColor: 3 }, "hat", SLOT_OPTIONS.hat.indexOf(gold)).hatColor).toBe(11);
  expect(withPart({ ...DEFAULT_APPEARANCE, hatColor: 3 }, "hat", SLOT_OPTIONS.hat.indexOf("cap")).hatColor).toBe(3);
});
it("8 presets in spec order with the spec's parts (spec §4)", () => {
  expect(APPEARANCE_PRESETS.map((p) => p.label)).toEqual(["왕자", "공주", "기사", "마법사", "요정", "탐험가", "해적", "우주비행사"]);
  // 표의 핵심 칸: 왕자 crown+prince_coat(파랑 6)+pants+tall_boots+scepter, 공주 tiara+gown_top(9)+longskirt(9)+dress+rose,
  // 기사 knight_helmet+armor+pants+tall_boots+wooden_sword, 마법사 wizard+robe+wizard_shoes+staff,
  // 요정 flower_crown+petal_top+petal_skirt+sandals+wand, 탐험가 safari+explorer_vest+shorts+hiking_boots+map,
  // 해적 pirate_hat+pirate_stripe+shorts+tall_boots+telescope, 우주비행사 space_helmet+spacesuit+space_pants+space_boots+flag
  // 모든 프리셋은 7개 슬롯이 모두 null이 아니다(모자·머리·얼굴·웃옷·바지·신발·소품을 다 갖춘다).
  for (const p of APPEARANCE_PRESETS) for (const s of CHARACTER_SLOTS) expect(p.parts[s]).not.toBeNull();
});
it("applyPreset keeps skin and voice, and every preset id resolves to a valid appearance");
it("voiceGender maps 0 → male, 1 → female, anything else → male");
it("constants re-exports the very same ranges object (single source)", () =>
  expect(ConstantsRanges).toBe(APPEARANCE_RANGES));
```

- [ ] **Step 2: 실패 확인.** `npm run test -w shared -- appearance` → FAIL
- [ ] **Step 3: 구현.**
  - 프리셋과 기본값은 id로 적고, `appearanceFromIds`가 모듈 초기화 때 인덱스로 바꾼다. 그래서 manifest 순서가 바뀌어도 안전하다.
  - `withPart`는 `CHARACTER_MANIFEST.defaultColors[slot]?.[id]`의 hex를 `paletteFor(SLOT_COLOR_FIELD[slot])`에서 대소문자 무시로 찾아 쓴다. 없으면 색을 그대로 둔다.
- [ ] **Step 4: 통과 확인.** `npm run test -w shared && npm run typecheck` PASS
- [ ] **Step 5: 커밋.** `feat: 외형 15필드 모델 — 범위·팔레트·기본값·프리셋 8·랜덤·검증 (캐릭터 3단계 Task 3)`

### Task 4: 외형 해석 — `client/src/game/characterLook.ts`(순수)

**Files:**
- Create: `client/src/game/characterLook.ts`, Test: `client/src/game/characterLook.test.ts`

**Interfaces:**
- Consumes: `CHARACTER_MANIFEST`(`clips`·`clipVariants` 포함), `CHARACTER_SLOTS`, `CharacterSlot`(Task 2), `Appearance`, `DEFAULT_APPEARANCE`, `SLOT_OPTIONS`, `SLOT_COLOR_FIELD`, `APPEARANCE_PRESETS`, `applyPreset`, 팔레트(Task 3), `CLIP`(constants)
- Produces:

```ts
export type TintKey = keyof typeof CHARACTER_MANIFEST.tintMaterials; // skin|hair|hat|top|bottom|shoes|item|accent
export const TINT_KEYS: readonly TintKey[];                         // manifest 순서
export interface AvatarLook { parts: Record<CharacterSlot, string | null>; colors: Record<TintKey, string> }
export const PLAYER_ACCENT = "#FFFFFF";                             // 플레이어는 accent 부품을 입지 않는다
export function lookFromAppearance(a: Appearance): AvatarLook;     // 범위 밖 인덱스(부품·색)는 그 슬롯의 DEFAULT_APPEARANCE 부품·색으로 대체한다. 던지지 않는다
export function visibleParts(parts: AvatarLook["parts"]): string[]; // 그릴 부품 노드 이름, 정렬
export function solidColorFor(materialName: string, look: AvatarLook): string | null; // 틴트 재질이면 그 색, 고정색이면 null
export function lookKey(look: AvatarLook): string;                  // `${부품 7개 ?? "-"}|${색 8개 대문자}`
export function clipFor(base: string, look: AvatarLook): string;    // CHARACTER_MANIFEST.clipVariants[look.parts.bottom]?.[base] ?? base
```

보이는 부품 규칙(설계 5.1 교체식 + 2단계 `covers`·`hatVariants`·`hatHidesHair`). `hatHidesHair`(지금 `knight_helmet`, `space_helmet`)는 머리를 다 감싸는 모자라서, 쓰면 머리카락 메시를 아예 그리지 않는다:

```ts
export function visibleParts(parts: AvatarLook["parts"]): string[] {
  const out = ["body__head", "body__hands"];                      // 머리·손은 항상 피부
  for (const [slot, body] of Object.entries(CHARACTER_MANIFEST.covers))
    if (parts[slot as CharacterSlot] === null) out.push(body);     // 덮는 부품이 없을 때만 맨몸(NPC·예외 대비)
  for (const slot of CHARACTER_SLOTS) {
    const id = parts[slot];
    if (id === null) continue;
    if (slot === "hair" && parts.hat !== null && CHARACTER_MANIFEST.hatHidesHair.includes(parts.hat)) continue; // 투구·헬멧: 머리 숨김
    out.push(slot === "hair" && parts.hat !== null
      ? (CHARACTER_MANIFEST.hatVariants as Record<string, string>)[id] // 모자를 쓰면 모자용 머리
      : `${slot}__${id}`);
  }
  return out.sort();
}
```

모르는 인덱스 규칙(Review Focus 4): 클라이언트의 `SLOT_OPTIONS`·팔레트보다 큰 인덱스를 받아도(옛 탭 + 더 새 서버 manifest) 부품이 `undefined`가 되어 아무것도 안 그리거나 예외가 나면 안 된다. `lookFromAppearance`가 그 필드만 `DEFAULT_APPEARANCE`의 값으로 바꿔서 해석한다(다른 필드는 그대로).

클립 해석 규칙(Review Focus 7): 롱스커트처럼 발목까지 오는 하의는 기본 걷기·달리기·점프로 재생하면 다리가 치마를 뚫는다. 그래서 아바타가 재생하는 클립 이름은 모두 `clipFor`를 거친다. `clipFor`는 이 모듈이 소유하며, 아바타 애니메이션 코드(Task 6 LocalPlayer·RemotePlayer, Task 7 미리보기, Task 8 조교)가 쓴다.

```ts
export function clipFor(base: string, look: AvatarLook): string {
  const bottom = look.parts.bottom;                                // null(맨다리)·모르는 id면 변형 없음
  const variants = bottom === null ? undefined
    : (CHARACTER_MANIFEST.clipVariants as Record<string, Record<string, string> | undefined>)[bottom];
  return variants?.[base] ?? base;                                 // 변형이 없는 클립(Idle·Sit_*)은 기본 그대로
}
```

- `base`는 `CLIP` 값(기본 7개)이다. 반환값은 항상 manifest `clips`에 있는 이름이다.
- 순수 함수이고 할당이 없다. 외형이 바뀌면 `look`이 바뀌므로, 호출한 쪽은 `look`이 바뀔 때 클립 이름을 다시 정해야 한다(Task 6·7에서 규칙으로 못박는다).

- [ ] **Step 1: 실패하는 테스트 작성.**

```ts
const look = (parts: Partial<AvatarLook["parts"]>) => ({ ...lookFromAppearance(DEFAULT_APPEARANCE), parts: { ...lookFromAppearance(DEFAULT_APPEARANCE).parts, ...parts } });
it("default look shows body head/hands, never the covered torso/legs/feet", () =>
  expect(visibleParts(lookFromAppearance(DEFAULT_APPEARANCE).parts)).toEqual(
    ["body__hands", "body__head", "bottom__pants", "face__smile", "hair__short", "shoes__sneakers", "top__tee"]));
it("a hat swaps the hair for its hat variant; taking the hat off restores it", () => {
  expect(visibleParts(look({ hat: "cap", hair: "ponytail" }).parts)).toEqual(expect.arrayContaining(["hat__cap", "hair__ponytail__hat"]));
  expect(visibleParts(look({ hat: "cap", hair: "ponytail" }).parts)).not.toContain("hair__ponytail");
  expect(visibleParts(look({ hat: null, hair: "ponytail" }).parts)).toContain("hair__ponytail");
});
it("bald + hat shows no hair mesh at all");
it("hides the hair under a hatHidesHair helmet (Review Focus 6)", () => {
  for (const hat of CHARACTER_MANIFEST.hatHidesHair) {
    const v = visibleParts(look({ hat, hair: "ponytail" }).parts);
    expect(v).toContain(`hat__${hat}`);
    expect(v.some((p) => p.startsWith("hair__"))).toBe(false);
  }
  expect(visibleParts(look({ hat: "cap", hair: "ponytail" }).parts)).toContain("hair__ponytail__hat"); // 일반 모자는 그대로
});
it("an empty covering slot shows its body mesh (covers rule)", () =>
  expect(visibleParts(look({ top: null, bottom: null, shoes: null }).parts)).toEqual(expect.arrayContaining(["body__torso", "body__legs", "body__feet"])));
it("every option of every slot, with and without a hat, names a mesh the manifest ships");
it("falls back to the slot's default part and color for an index the client does not know (Review Focus 4)", () => {
  // 서버가 더 새 manifest를 써서 이 클라이언트의 SLOT_OPTIONS·팔레트보다 큰 인덱스를 보낸 경우
  const base = lookFromAppearance(DEFAULT_APPEARANCE);
  const l = lookFromAppearance({ ...DEFAULT_APPEARANCE, top: 99, topColor: 99, hat: 99, hatColor: 99, item: 99 });
  expect(l.parts).toEqual(base.parts);                           // top/hat/item 모두 기본 부품 (undefined 없음)
  expect(l.colors).toEqual(base.colors);
  expect(visibleParts(l.parts)).toEqual(visibleParts(base.parts)); // 빈 몸이나 예외가 아니다
  // 아는 필드는 그대로: 모르는 top 옆의 shoes는 바뀌지 않는다
  expect(lookFromAppearance({ ...DEFAULT_APPEARANCE, top: 99, shoes: 1 }).parts.shoes).toBe(SLOT_OPTIONS.shoes[1]);
});
it("solidColorFor maps tint materials to the look and leaves fixed colors alone", () => {
  const l = lookFromAppearance(DEFAULT_APPEARANCE);
  expect(solidColorFor("mat_tint_top", l)).toBe(l.colors.top);
  expect(solidColorFor("mat_skin", l)).toBe(l.colors.skin);
  expect(solidColorFor("mat_fixed_gold", l)).toBeNull();
});
it("lookFromAppearance maps indices through SLOT_OPTIONS and the palettes");
it("lookKey is equal for equal looks and changes with any part or color");
it("every CLIP name exists in the manifest clips", () => {
  for (const c of Object.values(CLIP)) expect(CHARACTER_MANIFEST.clips).toContain(c);
});
it("clipFor plays the long-skirt variant for walk, run and jump (Review Focus 7)", () => {
  const skirt = look({ bottom: "longskirt" });
  expect(clipFor("Running_A", skirt)).toBe("Running_A_LongSkirt");
  expect(clipFor("Walking_A", skirt)).toBe("Walking_A_LongSkirt");
  expect(clipFor("Jump_Full_Short", skirt)).toBe("Jump_Full_Short_LongSkirt");
  const princess = APPEARANCE_PRESETS.find((p) => p.id === "princess")!;  // 공주는 longskirt를 입는다
  expect(clipFor(CLIP.run, lookFromAppearance(applyPreset(DEFAULT_APPEARANCE, princess)))).toBe("Running_A_LongSkirt");
});
it("clipFor keeps the base clip for pants, for clips without a variant, and for an unknown or empty bottom (Review Focus 7)", () => {
  expect(clipFor("Running_A", look({ bottom: "pants" }))).toBe("Running_A");              // 바지 + 달리기
  expect(clipFor("Idle", look({ bottom: "longskirt" }))).toBe("Idle");                    // 롱스커트 + 변형 없는 클립
  expect(clipFor("Sit_Chair_Idle", look({ bottom: "longskirt" }))).toBe("Sit_Chair_Idle");
  expect(clipFor("Running_A", look({ bottom: "future_bottom" }))).toBe("Running_A");      // 모르는 하의 id
  expect(clipFor("Running_A", look({ bottom: null }))).toBe("Running_A");                 // 하의 없음(null)
  // 모르는 하의 인덱스(Review Focus 4)는 lookFromAppearance가 기본 하의로 바꾸므로 기본 클립이 나온다
  expect(clipFor("Running_A", lookFromAppearance({ ...DEFAULT_APPEARANCE, bottom: 99 }))).toBe("Running_A");
});
it("clipFor always returns a clip the manifest ships, for every bottom and every CLIP", () => {
  for (const bottom of SLOT_OPTIONS.bottom) for (const base of Object.values(CLIP))
    expect(CHARACTER_MANIFEST.clips).toContain(clipFor(base, look({ bottom })));
});
```

- [ ] **Step 2: 실패 확인.** `npm run test -w client -- characterLook` → FAIL
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 통과 확인.** `npm run test -w client && npm run typecheck` PASS
- [ ] **Step 5: 커밋.** `feat: 외형 → 부품·색 해석, 모자용 머리·덮개 규칙, 모르는 인덱스 기본값 폴백, 롱스커트 변형 클립 해석 (캐릭터 3단계 Task 4)`

### Task 5: 아바타 조립 — `characterAvatar.ts` + `useAvatar.ts`

**Files:**
- Create: `client/src/game/characterAvatar.ts`, Test: `client/src/game/characterAvatar.test.ts`(node 환경, three 객체만 사용)
- Create: `client/src/game/useAvatar.ts`

**Interfaces:**
- Consumes: `AvatarLook`, `visibleParts`, `solidColorFor`, `lookKey`(Task 4)
- Produces:

```ts
// characterAvatar.ts — React·drei 없음
export interface AvatarAssets { scene: Object3D }
export interface BuiltAvatar {
  root: Object3D;                                   // 씬에 붙일 복제본(뼈 + 남은 메시)
  materials: Material[];                            // 이 아바타 소유(합친 재질·얼굴·decorate가 넣은 것). 해제·반투명 대상
  parts: string[];                                  // visibleParts 결과
  solidKey: string;                                 // 합친 지오메트리 캐시 키(= lookKey)
  drawMeshes: number;                               // root 아래 보이는 Mesh 수
  triangles: number;                                // 그 메시들의 삼각형 합
}
export const MAX_DRAW_MESHES = 8;
export const SOLID_ROUGHNESS = 0.45;
export const AVATAR_BOUNDS = { center: [0, 1, 0], radius: 3 } as const; // 기존 BOUNDS_* 그대로
export function buildAvatar(assets: AvatarAssets, look: AvatarLook, decorate?: (a: BuiltAvatar) => void): BuiltAvatar;
export function releaseAvatar(a: BuiltAvatar): void;            // 재질 dispose + 지오메트리 refcount −1
export function setAvatarOpacity(a: BuiltAvatar, opacity: number): void;
export function solidGeometryRefs(key: string): number;         // 0 = 해제·캐시에서 빠짐

// useAvatar.ts
export const CHARACTER_MODEL_URL = "/models/character.glb";
export interface AvatarProbeEntry { parts: string[]; drawMeshes: number; triangles: number; clip: string | null } // clip = 지금 재생 중인 클립 이름(보고 전·보고하지 않는 아바타는 null)
export const avatarProbe: Map<string, AvatarProbeEntry>;        // DEV: window.__cvAvatars = () => Object.fromEntries(avatarProbe)
export function reportAvatarClip(probeId: string | undefined, clip: string): void; // DEV 전용. 항목이 있을 때만 clip을 기록한다. 클립이 바뀔 때 한 번 부른다(매 프레임 아님)
export function useAvatar(look: AvatarLook, opts?: { probeId?: string; decorate?: (a: BuiltAvatar) => void }):
  { avatar: BuiltAvatar; animations: AnimationClip[] };
export function preloadCharacterAssets(): void;                 // useGLTF.preload
```

조립 알고리즘(시그니처와 테스트만으로는 정해지지 않는 부분):

```ts
export function buildAvatar(assets, look, decorate) {
  const root = cloneSkinned(assets.scene);                        // three/addons/utils/SkeletonUtils.js clone
  const keep = new Set(visibleParts(look.parts));
  // 부품 노드 = 이름이 /^(body|hat|hair|face|top|bottom|shoes|item)__/인 가장 바깥 노드.
  // 다중 재질 부품은 Group(이름 = 부품명) 아래에 자식 Mesh가 있다.
  const partNodes = outermostPartNodes(root);
  for (const n of partNodes) if (!keep.has(n.name)) n.removeFromParent(); // 숨긴 부품은 아예 뺀다(행렬 갱신 비용도 없앰)
  const kept = partNodes.filter((n) => keep.has(n.name));
  const holder = kept[0].parent!;                                // 아마추어(Task 2 테스트: 부품 변환은 항등)
  const materials: Material[] = [];
  const solids: SkinnedMesh[] = []; let skeleton: Skeleton | undefined;
  for (const node of kept) node.traverse((o) => {
    const mesh = o as SkinnedMesh; if (!mesh.isSkinnedMesh) return;
    skeleton ??= mesh.skeleton;
    const src = mesh.material as MeshStandardMaterial;
    if (!src.map) { solids.push(mesh); return; }                 // 피부·틴트·고정색 → 합치기
    const mat = src.clone(); materials.push(mat);                // 얼굴: 아바타별 재질
    mesh.material = mat;
    mesh.bind(skeleton, mesh.bindMatrix);                        // 아바타당 Skeleton 1개 → 뼈 텍스처 갱신 1회
  });
  const key = lookKey(look);
  const geometry = acquireSolidGeometry(key, () => mergeSolids(solids, look));
  const solidMat = new MeshStandardMaterial({ vertexColors: true, roughness: SOLID_ROUGHNESS, metalness: 0 });
  materials.push(solidMat);
  const solid = new SkinnedMesh(geometry, solidMat); solid.name = "avatar__solid";
  holder.add(solid); solid.bind(skeleton!, solids[0].bindMatrix);
  for (const m of solids) m.removeFromParent();
  // 남은 Mesh 모두: castShadow = true, SkinnedMesh는 boundingSphere = new Sphere(AVATAR_BOUNDS…)
  const built = { root, materials, parts: [...keep].sort(), solidKey: key, drawMeshes: 0, triangles: 0 };
  decorate?.(built);                                             // NPC 헤일로 등. 재질은 built.materials에 넣는다
  for (const m of built.materials) m.userData.base = { transparent: m.transparent, depthWrite: m.depthWrite, opacity: m.opacity };
  built.drawMeshes = /* root 아래 visible Mesh 수 */; built.triangles = /* index.count / 3 합 */;
  return built;
}
```

- `mergeSolids(solids, look)` 규칙:
  - primitive마다 새 `BufferGeometry`를 만든다.
    - `position`·`normal`·`index`는 원본을 참조한다.
    - `skinIndex`는 `Uint16BufferAttribute`로 바꾼다.
    - `skinWeight`는 정규화 정수면 `getX()`로 풀어 `Float32BufferAttribute`로 바꾼다. 그래서 primitive마다 형식이 달라도 합쳐진다.
    - `color`(Float32, 3)에는 `solidColorFor(재질 이름, look)`가 있으면 `new Color(hex)`(선형 변환은 ColorManagement가 한다), 없으면 원본 `material.color`를 채운다.
  - `mergeGeometries(list, false)`(`three/addons/utils/BufferGeometryUtils.js`)가 null이면 부품 이름을 담은 Error를 던진다.
- 지오메트리 캐시: `Map<string, { geometry; refs }>`. `acquireSolidGeometry(key, build)`는 +1이다. `releaseSolidGeometry(key)`는 −1이고, 0이 되면 `geometry.dispose()` 후 캐시에서 뺀다. `nametag.ts`의 참조 카운트와 같은 방식이다.
- `setAvatarOpacity(a, o)`: 재질마다 `base = userData.base`를 읽어 다음처럼 바꾼다.
  - `transparent = base.transparent || o < 1`
  - `depthWrite = o < 1 ? false : base.depthWrite`
  - `opacity = base.opacity × o`
  - `needsUpdate = true`
- `useAvatar` 규칙:
  - `useGLTF(CHARACTER_MODEL_URL)`를 쓴다.
  - 조립은 `useMemo(() => buildAvatar(…), [scene, lookKey(look)])`로 한다.
  - `useEffect`에서 DEV 프로브를 기록하고(`clip: null`로 시작), 정리할 때 `releaseAvatar`와 프로브 삭제를 한다. 외형이 바뀌어 다시 조립하면 `clip`은 null로 돌아가므로, 호출한 쪽이 새 `look`으로 클립을 다시 정해 `reportAvatarClip`을 부른다. 호출한 쪽의 애니메이션 effect는 `useAvatar` 호출보다 뒤에 선언한다(같은 컴포넌트의 effect는 선언 순서대로 실행되므로 프로브 기록 뒤에 보고된다).
  - `animations`는 GLB의 클립 전부(기본 7 + 변형 3)다. 그중 무엇을 재생할지는 호출한 쪽이 `clipFor`(Task 4)로 정한다. `useAvatar`는 고르지 않는다.
  - StrictMode 개발 모드에서 `useMemo`가 두 번 호출되어 생기는 누수는 기존 `cloneTinted`와 같은 수준으로 받아들인다(개발 전용).

- [ ] **Step 1: 실패하는 테스트 작성.** 테스트 안에 도우미 `fakeScene()`을 둔다.
  - 구조: `Rig`(Object3D) ─ Bone `root` ─ Bone `head`
  - 각 부품은 삼각형 1개짜리 SkinnedMesh다. 속성은 `position`·`normal`·`skinIndex`(Uint8)·`skinWeight`(Float32)·`index`, `new Skeleton([root, head])`에 바인딩한다.
  - 단일 재질 부품:
    - `body__head`·`body__hands`·`body__torso`·`body__legs`·`body__feet`: `mat_skin`
    - `hair__short`·`hair__short__hat`·`hair__ponytail`·`hair__ponytail__hat`: `mat_tint_hair`
    - `top__tee`, `hat__cap`, `bottom__pants`, `bottom__shorts`, `shoes__sneakers`, `item__book`: 해당 틴트 재질 하나뿐(티셔츠·캡 포함)
    - `face__smile`: `mat_face_smile`(map 있음, `transparent: true`, `depthWrite: false`)
  - 다중 재질 부품(Group + 자식 2개. 자식 이름은 GLTFLoader처럼 `<부품>_1`, `<부품>_2`):
    - `top__hoodie`: [`mat_tint_top`, `mat_fixed_white`]
  - 테스트용 외형 `CAP_WHITE_TEE`는 프리셋과 무관하게 테스트 안에서 직접 정의한다(`lookFromAppearance(appearanceFromIds(parts, colors))`).
    - 부품: hat cap, hair short, face smile, top tee, bottom shorts, shoes sneakers, item book
    - 색: hatColor 6(파랑), hairColor 0, topColor 10(흰색), bottomColor 7, shoesColor 0, itemColor 0, skin 0, voice 0

```ts
it("keeps only the visible parts and merges every untextured primitive into one solid mesh", () => {
  const a = buildAvatar(assets, CAP_WHITE_TEE);
  expect(a.parts).toEqual(visibleParts(CAP_WHITE_TEE.parts));
  expect(meshNames(a.root).sort()).toEqual(["avatar__solid", "face__smile"]); // 티셔츠·캡은 틴트 재질뿐이라 solid에 합쳐진다
  expect(a.drawMeshes).toBe(2);
  expect(a.drawMeshes).toBeLessThanOrEqual(MAX_DRAW_MESHES);
});
it("bakes look colors into the solid vertex colors and keeps fixed colors", () => {
  // 피부 정점 = new Color(look.colors.skin), 후드티 흰 끈 정점 = mat_fixed_white.color (후드티 외형으로 한 번 더)
});
it("drives every kept skinned mesh from one skeleton");
it("lists every material it renders, so ghost opacity reaches all of them"); // root의 모든 메시 재질 ⊆ a.materials
it("keeps a shared solid geometry until its last avatar is released (Review Focus 1)", () => {
  const a = buildAvatar(assets, L), b = buildAvatar(assets, L);
  expect(solidOf(a).geometry).toBe(solidOf(b).geometry);
  expect(solidGeometryRefs(lookKey(L))).toBe(2);
  const disposed = vi.fn(); solidOf(a).geometry.addEventListener("dispose", disposed);
  releaseAvatar(a); expect(disposed).not.toHaveBeenCalled();
  releaseAvatar(b); expect(disposed).toHaveBeenCalledTimes(1);
  expect(solidGeometryRefs(lookKey(L))).toBe(0);
});
it("setAvatarOpacity restores the authored BLEND state (Review Focus 2)", () => {
  setAvatarOpacity(a, 0.5);
  for (const m of a.materials) { expect(m.transparent).toBe(true); expect(m.opacity).toBeCloseTo(0.5); }
  setAvatarOpacity(a, 1);
  expect(faceMaterial(a).transparent).toBe(true);  expect(faceMaterial(a).depthWrite).toBe(false);
  expect(solidOf(a).material.transparent).toBe(false); expect((solidOf(a).material as Material).depthWrite).toBe(true);
});
it("counts decorate() meshes and materials", () => {
  const a = buildAvatar(assets, L, (b) => { const m = new MeshStandardMaterial(); b.materials.push(m); b.root.add(new Mesh(new BufferGeometry(), m)); });
  expect(a.drawMeshes).toBe(3);
});
it("does not mutate the cached source scene"); // 두 번 조립 후 fakeScene 부품 노드 수·재질 그대로
```

- [ ] **Step 2: 실패 확인.** `npm run test -w client -- characterAvatar` → FAIL
- [ ] **Step 3: 구현.** `characterAvatar.ts`(위 알고리즘)를 먼저, `useAvatar.ts`를 그다음에 만든다. 아직 이 모듈을 쓰는 곳은 없다.
- [ ] **Step 4: 통과 확인.** `npm run test -w client && npm run typecheck` PASS
- [ ] **Step 5: 커밋.** `feat: 조립식 아바타 — 부품 가지치기, 정점색 한 메시로 합치기, 공유 지오메트리 refcount (캐릭터 3단계 Task 5)`

### Task 6: 외형 전송으로 전환 — 스키마·서버·클라이언트·봇

`character`·`tint`를 외형 15필드로 바꾸고, 내 아바타와 원격 아바타를 `useAvatar`로 그린다. 입장 화면은 이 태스크에서 임시 상태다. 저장된 외형(없으면 기본)을 그대로 보내고, 조립 UI는 Task 7에서 붙인다.

**Files:**
- Modify: `shared/src/schema.ts`(Player 필드와 클래스 주석), Test: `shared/src/schema.smoke.test.ts`
- Modify: `server/src/rooms/joinValidation.ts`, Test: `joinValidation.test.ts`
- Modify: `server/src/rooms/WorldRoom.ts:221-222`, Test: `WorldRoom.integration.test.ts`
- Modify: `client/src/net/identityCache.ts`(+test), `client/src/net/connection.ts`(`JoinParams`), `client/src/net/resilience.ts`(`phaseFreshJoin`의 `baseParams`)와 `resilience.test.ts:107`
- Modify: `client/src/stores/appStore.ts`(`Identity`)와 `appStore.test.ts:6,48`
- Modify: `client/src/ui/validation.ts`(+test), `client/src/ui/EntryScreen.tsx`(임시)
- Modify: `client/src/game/remoteStore.ts`(+test), `remoteSync.ts:72-77`, `debug.ts`(`RemoteView`)
- Modify: `client/src/net/chatSync.ts:23,42`, `client/src/game/chatVoice.ts`(`ChatVoiceGender = VoiceGender`, 머리 주석)
- Modify: `client/src/game/LocalPlayer.tsx`, `RemotePlayer.tsx`, `RemotePlayers.tsx`, `WorldScene.tsx`
- Modify: `loadtest/bot.ts:48-49,186-195`

**Interfaces:**
- Consumes: `Appearance`, `APPEARANCE_FIELDS`, `APPEARANCE_ERROR`, `DEFAULT_APPEARANCE`, `validateAppearance`, `pickAppearance`, `randomAppearance`, `voiceGender`(Task 3), `lookFromAppearance`, `clipFor`(Task 4), `useAvatar`, `setAvatarOpacity`, `preloadCharacterAssets`, `reportAvatarClip`(Task 5), 조작 개편의 `CLIP.run`·`CLIP.jump`·`gaitRef`·점프 재생·이름표 등록(상태 판단은 바꾸지 않는다. 믹서에 넘기는 클립 이름만 `clipFor`를 거친다)
- Produces:

```ts
// schema.ts — Player: character/tint 삭제, APPEARANCE_FIELDS 순서로 @type("uint8") 15개(기본 0). 서버가 입장 때 모두 쓴다.
// joinValidation.ts
export interface JoinOptions { nickname: string; appearance: Appearance }
export function validateJoinOptions(options: unknown): JoinOptions | JoinError; // 닉네임 → 외형 순, 외형 오류 = APPEARANCE_ERROR
// WorldRoom.onJoin: for (const f of APPEARANCE_FIELDS) player[f] = result.appearance[f];
// connection.ts
export interface JoinParams { nickname: string; appearance: Appearance; adminCode?: string }
// identityCache.ts — 같은 키 "cv.entry"
export interface CachedIdentity { nickname: string; appearance: Appearance }
export function loadIdentity(): CachedIdentity; // appearance = validateAppearance(parsed.appearance) ?? DEFAULT_APPEARANCE
// appStore.ts
export interface Identity { nickname: string; appearance: Appearance; sessionId: string }
// validation.ts
export interface EntryInput { nickname: string; appearance: Appearance }
// remoteStore.ts — RemotePlayerRecord: character/tint 대신 appearance: Appearance (remoteSync가 pickAppearance(player))
// debug.ts — RemoteView: character 대신 appearance: Appearance
// LocalPlayer props: character/tint 대신 appearance: Appearance
```

- 바뀌는 동작:
  - chatSync: 보낸 사람의 목소리는 `voiceGender(sender?.voice ?? DEFAULT_APPEARANCE.voice)`로 정한다. 서버 `/api/npc-voice`(`server/src/npc/voice.ts`)의 `male`/`female` 계약은 그대로다.
  - LocalPlayer·RemotePlayer:
    - `useGLTF(preset.model)`·왕관 로딩·`cloneTinted`·자체 재질 dispose를 지운다.
    - 대신 `const look = useMemo(() => lookFromAppearance(appearance), [appearance])`, `const { avatar, animations } = useAvatar(look, { probeId: sessionId })`를 쓴다. 나머지 동작(믹서·걷기/달리기·점프·앉기·이름표·말풍선)은 그대로 둔다. 단, 클립 이름은 아래 규칙을 따른다.
    - **클립 이름 해석(Review Focus 7).** 두 컴포넌트가 재생하는 모든 클립(Idle·걷기·달리기·점프·앉기 클립)은 `clipFor(CLIP.x, look)`로 이름을 정한 뒤 믹서에 넘긴다. 롱스커트면 걷기·달리기·점프가 `*_LongSkirt`로 바뀌고, 나머지는 기본 그대로다.
    - 걷기/달리기/점프/앉기 *상태 판단*과 `gaitRef` 값은 기본 이름(`CLIP.*`) 기준 그대로 둔다. 해석은 재생 직전에만 한다.
    - **외형이 바뀌면 클립을 다시 정한다.** `appearance`가 바뀌면(원격 외형 변경, 재접속 뒤 다른 외형) `useAvatar`가 몸을 새로 조립한다. 그러므로 클립을 고르는 effect·함수의 의존성에 `look`을 넣고, 지금 상태(예: 달리기 중)의 클립을 새 `look`으로 다시 구해 이어서 재생한다. 액션 캐시와 "이미 재생 중인지" 비교(점프 끝 감지 포함)는 기본 이름이 아니라 해석된 이름으로 한다. 이를 놓치면 옷을 바꾼 뒤에도 예전 클립이 계속 재생되거나 점프가 끝나지 않는다.
    - 클립이 바뀔 때마다 `reportAvatarClip(sessionId, 해석된 이름)`을 한 번 부른다(Task 10 단언용. 매 프레임 호출 금지). 이 effect는 `useAvatar` 호출 뒤에 선언한다.
  - RemotePlayer의 `applyOpacity(avatar.materials, …)`는 `setAvatarOpacity(avatar, …)`로 바꾸고, 지역 함수 `applyOpacity`는 지운다.
  - RemotePlayers는 `CHARACTERS` preload 반복을 지우고 `preloadCharacterAssets()`를 부른다.
  - WorldScene: `<LocalPlayer appearance={identity.appearance} …/>`.
  - EntryScreen(임시):
    - `appearance` 상태를 `loadIdentity().appearance`로 시작한다.
    - 캐릭터 그리드·색 견본·왕실 안내를 지운다.
    - `validateEntry({ nickname, appearance })`와 `preloadCharacterAssets()`를 쓴다.
  - 봇은 `client.join(WORLD_ROOM, { nickname, appearance: randomAppearance(Math.random) })`로 입장한다.

- [ ] **Step 1: 실패하는 테스트 작성.**

```ts
// schema.smoke.test.ts
it("Player appearance fields default to 0 and round-trip a full look"); // 15필드를 range−1로 → encodeAll → decode → 같음

// joinValidation.test.ts (describe "validateJoinOptions — appearance")
it("accepts DEFAULT_APPEARANCE and every field at range − 1");
it("rejects each field at −1, at its range, as 1.5, as \"0\" and as NaN with APPEARANCE_ERROR");
it("rejects a missing field, and a missing, null or array appearance");
it("rejects the pre-builder { character, tint } options (stale client bundle, Review Focus 3)", () =>
  expect(rejected({ nickname: "test", character: 0, tint: 0 }).error).toBe("외형 선택이 올바르지 않습니다"));
it("keeps only the 15 appearance fields (extra keys dropped)");

// WorldRoom.integration.test.ts
it("syncs all 15 appearance fields to other clients"); // alice가 range−1 외형으로 입장 → bob의 state에서 pickAppearance(alice) 같음
it("rejects a join without appearance");

// identityCache.test.ts
it("returns { nickname: '', appearance: DEFAULT_APPEARANCE } when nothing is stored");
it("round-trips a saved appearance");
it("migrates a pre-builder { character, tint } identity to DEFAULT_APPEARANCE, keeping the nickname (spec §5.2)", () => {
  localStorage.setItem(KEY, JSON.stringify({ nickname: "케이슨", character: 5, tint: 3 }));
  expect(loadIdentity()).toEqual({ nickname: "케이슨", appearance: DEFAULT_APPEARANCE });
});
it("replaces a corrupt or out-of-range appearance with DEFAULT_APPEARANCE as a whole");
it("never throws on malformed JSON");

// validation.test.ts
it("accepts a valid nickname + appearance and trims the nickname");
it("rejects an invalid appearance with \"외형 선택이 올바르지 않습니다\"");

// remoteStore.test.ts
it("keeps the synced appearance on the record and in getRemotes()");
```

- [ ] **Step 2: 실패 확인.** `npm run test` → 새 테스트 FAIL. `npm run typecheck`는 바꾼 타입을 쓰는 곳에서 FAIL.
- [ ] **Step 3: 구현.**
  - 위 Files 순서대로 바꾼다.
  - integration 테스트 고정값 `VALID_JOIN`은 `{ nickname: "케이슨", appearance: { ...DEFAULT_APPEARANCE, top: 1, topColor: 2 } }`이다. 나머지는 `appearance: DEFAULT_APPEARANCE`이다.
  - 다 바꾼 뒤 `rg -n "\.character\b|\.tint\b|character:|tint:" client/src server/src shared/src loadtest`의 결과는 다음만 남아야 한다.
    - `characterConfig.test.ts`, `avatar.ts`, `constants.ts`(CHARACTERS 정의), `NpcCharacter.tsx`·`npcLook.ts`(Task 8·9에서 정리)
    - 텍스트 글자 수를 뜻하는 `chat.ts`·`bubbleWrap`·`voice.ts`·`index.ts`
- [ ] **Step 4: 통과 확인.**
  - `npm run typecheck && npm run test` PASS
  - `npm run bot -w loadtest -- --room world --numClients 10 --endpoint http://localhost:2567`을 60 s 돌린다. Expected: join 10/10, 오류 0
- [ ] **Step 5: 눈으로 확인.** `npm run dev`, 두 탭에서 한다.
  - 각 탭 devtools에서 `localStorage["cv.entry"]`에 서로 다른 외형을 넣고 입장한다.
  - 서로 외형이 맞게 보이는지 본다. 걷기, Shift 달리기, Space 점프, 의자 앉기·일어서기, 말풍선, 이모지가 그대로인지 본다.
  - `__cvAvatars()`에서 모든 항목의 `drawMeshes ≤ 4`인지 본다.
  - 공주 프리셋 외형(Task 3 `applyPreset`으로 만든 값을 `localStorage["cv.entry"]`에 넣는다)으로 입장해 걷기·Shift 달리기·Space 점프를 한다. `__cvAvatars()[sid].clip`이 `Walking_A_LongSkirt`·`Running_A_LongSkirt`·`Jump_Full_Short_LongSkirt`이고 다리가 치마를 뚫지 않는지 본다. 다른 탭에서 보는 같은 아바타(원격 경로)도 같다.
  - voice 1인 쪽의 채팅을 다른 탭이 들을 때 `/api/npc-voice` 요청 본문이 `"gender":"female"`인지 본다.
- [ ] **Step 6: 커밋.** `feat: Player 외형 15필드 동기화 — 서버 범위 검증, 재접속 캐시 이전, useAvatar로 내·원격 아바타 조립, 목소리 성별 (캐릭터 3단계 Task 6)`

### Task 7: 입장 화면 "캐릭터 조립실"

**Files:**
- Create: `client/src/ui/builderOptions.ts`, Test: `client/src/ui/builderOptions.test.ts`
- Create: `client/src/ui/BuilderPreview.tsx`, `client/src/ui/BuilderPanel.tsx`, `client/src/ui/builder.css`
- Modify: `client/src/ui/EntryScreen.tsx`, `client/src/ui/entry.css`(`.cv-characters`, `.cv-character*`, `.cv-swatch:disabled*`, `.cv-swatch-note` 삭제. 카드 폭·배치 변경)

**Interfaces:**
- Consumes: `Appearance`, `SLOT_OPTIONS`, `SLOT_COLOR_FIELD`, `paletteFor`, `withPart`, `applyPreset`, `APPEARANCE_PRESETS`, `randomAppearance`, `PaletteColor`(Task 3), `CHARACTER_MANIFEST.slotLabels`·`labels`(Task 2), `lookFromAppearance`, `lookKey`, `clipFor`(Task 4), `useAvatar`(Task 5), `CLIP.idle`
- Produces:

```ts
// builderOptions.ts
export interface ChipOption { index: number; label: string }
export const NONE_LABELS = { hat: "없음", hair: "민머리", item: "없음" } as const;
export function partChips(slot: CharacterSlot): ChipOption[];     // SLOT_OPTIONS 순서, 이름은 manifest labels
export function colorLabel(slot: CharacterSlot): string;           // face → "피부색", 나머지 "색"
export function showSwatches(a: Appearance, slot: CharacterSlot): boolean; // 선택 슬롯이 없음이면 false
export const VOICE_OPTIONS: readonly ChipOption[];                 // [{0,"남자 목소리"},{1,"여자 목소리"}]
export const BUILDER_COPY = { title: "캐릭터 조립실", presets: "추천 캐릭터", random: "🎲 랜덤", voice: "목소리",
  dragHint: "끌어서 돌려 보세요", loading: "캐릭터를 불러오는 중…" } as const;
export const PREVIEW_CAMERA = { fov: 30, distance: 5.6, eyeY: 1.8, targetY: 1.3 } as const;
export const PREVIEW_DRAG_SPEED = 0.01;  // rad/px
export const PREVIEW_START_YAW = 0.5;
// BuilderPreview.tsx
export function BuilderPreview(props: { appearance: Appearance }): JSX.Element;
// BuilderPanel.tsx
export function BuilderPanel(props: { appearance: Appearance; onChange: (next: Appearance) => void }): JSX.Element;
```

- 화면 구성(바인딩):
  - 순서: 앱 제목 → 닉네임 → 조립실 → 관리자 → 메시지 → 입장 버튼
  - 조립실 제목은 `<h2 className="cv-builder-title"><img src="/brand/cayson-logo-white.png" alt="Cayson" height="28" /> 캐릭터 조립실</h2>`이다(설계 3장 "입장 화면 조립실 제목"에 로고).
  - `.cv-builder`: 폭 ≥ 720px면 `grid-template-columns: 340px 1fr`(미리보기 | 패널), 카드 폭 `min(920px, 100%)`. 좁으면 한 줄로 쌓고 미리보기 높이는 `clamp(220px, 38vh, 340px)`.
- `BuilderPreview`:
  - 배경 `#efe6da`, 둥근 모서리 16px
  - Canvas 설정: `dpr={[1, 2]}`, 카메라 `PREVIEW_CAMERA`
  - 조명(1단계 승인 뷰어 값): hemisphere `0xfff6ea`/`0x9a7a5a` 1.6, directional `0xffffff` 2.4 at (3, 7, 5)
  - 인형은 Canvas 안 `<Suspense fallback={null}>` 아래의 `<PreviewFigure key={lookKey(look)} />`이다. `useAvatar(look, { probeId: "preview" })` + `useAnimations`로 `clipFor(CLIP.idle, look)`을 반복한다(Idle은 변형이 없어 결과가 `CLIP.idle`이지만, 클립 이름은 어디서나 `clipFor`를 거친다). 외형이 바뀌면 key가 바뀌어 새 믹서로 다시 마운트되므로 클립 이름도 새 `look`으로 다시 정해진다.
  - 회전: 포인터 드래그로 `yaw += dx × PREVIEW_DRAG_SPEED`(ref, React state 금지). 카메라는 `(sin(yaw)·distance, eyeY, cos(yaw)·distance)`에서 `(0, targetY, 0)`을 본다.
  - 컨테이너에 `touch-action: pan-y`를 준다. 가로로 끌면 돌아가고, 세로로 끌면 페이지가 스크롤된다.
  - 인형이 처음 그려질 때까지 DOM 위에 `BUILDER_COPY.loading`을 띄우고, 그 뒤에는 `dragHint`를 띄운다.
  - DEV: `window.__cvPreview = () => ({ yaw })`
- `BuilderPanel`:
  - 위쪽: 프리셋 8개 `.cv-preset` 버튼, `.cv-random` 버튼(외형을 `{ ...randomAppearance(Math.random), voice: 지금 voice }`로 바꿈)
  - 슬롯 탭 7개(`role="tablist"`, 이름은 `CHARACTER_MANIFEST.slotLabels`, 줄바꿈 허용)
  - 지금 탭의 칩 `.cv-chip`(`aria-pressed`, 누르면 `withPart`)
  - `showSwatches`면 `colorLabel` + 견본 `.cv-swatch`(`aria-label`은 팔레트 라벨, `aria-pressed`). 그리드는 `repeat(6, 44px)`, 간격 8px.
  - 목소리 `.cv-voice-option` 2개(`role="radio"`)
- 크기 규칙: 모든 버튼(칩·견본·프리셋·랜덤·목소리·탭)은 최소 44×44px(기존 입장 화면 터치 하한)이다.
  - 프리셋 줄은 좁은 화면에서 자기 안에서만 가로 스크롤한다(`overflow-x: auto`).
  - 페이지 전체에는 가로 스크롤이 없어야 한다.
  - 입장 버튼은 좁은 화면에서 `position: sticky; bottom: 0`이다.
- EntryScreen:
  - 바뀔 때마다 `onChange` → `setAppearance` + `dismissMessages()`를 부른다.
  - 입장할 때 `saveIdentity({ nickname, appearance })`를 부른다(설계 4장 "마지막 외형 기억". 편집 중 매번 저장하지는 않는다).

- [ ] **Step 1: 실패하는 테스트 작성.**

```ts
it("hair chips start with 민머리 and use the manifest names", () => {
  expect(partChips("hair")[0]).toEqual({ index: 0, label: "민머리" });
  expect(partChips("hair")).toHaveLength(6);
  expect(partChips("hat").find((c) => c.label === "왕관")?.index).toBe(SLOT_OPTIONS.hat.indexOf("crown"));
});
it("face has 6 chips and no 없음; its color is 피부색 with the 5 skin swatches", () => {
  expect(partChips("face").map((c) => c.label)).not.toContain("없음");
  expect(colorLabel("face")).toBe("피부색");
  expect(paletteFor(SLOT_COLOR_FIELD.face)).toBe(SKIN_PALETTE);
});
it("hides swatches for an empty optional slot", () =>
  expect(showSwatches({ ...DEFAULT_APPEARANCE, hat: 0 }, "hat")).toBe(false));
it("voice options are 남자 목소리 / 여자 목소리 at 0 / 1");
```

- [ ] **Step 2: 실패 확인.** `npm run test -w client -- builderOptions` → FAIL
- [ ] **Step 3: 구현.** `builderOptions.ts` → `BuilderPanel` → `BuilderPreview` → EntryScreen 배치 → CSS 순서로 한다.
- [ ] **Step 4: 통과 확인.** `npm run test && npm run typecheck && npm run build` PASS
- [ ] **Step 5: 눈으로 확인.** 1280×800과 375×812 스크린샷을 찍는다.
  - 마법사 모자 끝(약 2.73 m)과 발이 모두 미리보기 안에 들어와야 한다. 안 들어오면 `PREVIEW_CAMERA.distance`만 조정한다.
  - 칩을 누르는 즉시 미리보기가 바뀌어야 한다.
  - 휴대폰 화면에 가로 스크롤이 없어야 한다.
- [ ] **Step 6: 커밋.** `feat: 입장 화면 캐릭터 조립실 — 3D 미리보기·슬롯 칩·색 견본·프리셋 8·랜덤·목소리, 휴대폰 배치 (캐릭터 3단계 Task 7)`

### Task 7b: 조립실 새 디자인 — 밝은 하늘 정원 무대 (2026-11-01 추가)

**왜:**
- 발주자(2026-11-01): "이 화면이 좀 촌스러워 시중에 진짜 게임 배경과 ui/ux를 적용해봐", 이어서 "밝은게 낫지 않을까?".
- 그래서 시안을 만들어 보여 줬다. 밝은 하늘 정원 무대 위에 유리 패널을 얹은 화면이고, 배경은 ChatGPT로 만든 A안이다. 이 태스크는 그 시안대로 만든다.
- 조립실은 caysonverse의 모든 체험이 같이 쓰는 입구다(방탈출 스펙 14장 "기존 월드와 다른 체험"). 그래서 학교 이름이나 학교 장식을 넣지 않는다.

**시안 자료:** 모두 main 체크아웃의 gitignore 폴더 `D:\Codex\cayson-games\caysonverse\art\` 아래에 있다. 워크트리에서는 절대 경로로 읽는다.
- `builder-concept\design-note.md`: 배치·부품·상태·움직임·클래스 매핑을 적은 글이다. **이 글이 화면 요구사항이다.** 아래 "시안과 다르게 정한 것"만 이 글과 다르다.
- `builder-concept\mockup-desktop.png`(1280×800)와 `mockup-phone.png`(390×844), 그리고 각각의 `@2x`·`@3x`: 목표 화면이다.
- `builder-concept\mockup.html` + `mockup.css`: 참고용 정적 구현이다. 가져다 써도 된다. 단 견본은 design-note 매핑 표대로 인라인 `background` + `box-shadow` 링으로 그린다(`--c`·`::before` 방식은 쓰지 않는다).
- `builder-concept\assets\bg-desktop.{avif,webp}`, `bg-phone.{avif,webp}`: 배포용 배경이다(A안).
- `builder-concept\tools\render.html`: three.js로 부품 그림을 그린 참고 코드다.
- `fonts\Jua-Regular.ttf` + `fonts\OFL.txt`: SIL OFL 1.1 글꼴이다(google/fonts).

**Files:**
- Modify:
  - `client/src/ui/EntryScreen.tsx`, `BuilderPreview.tsx`, `BuilderPanel.tsx`, `builder.css`, `entry.css`
  - `client/src/ui/builderOptions.ts`(+ test), `client/index.html`(맞는 배경 한 장·글꼴 preload)
  - `LICENSE.md`(Jua OFL, 배경 그림 출처)
  - `docs/superpowers/specs/2026-10-31-character-builder-design.md` 5.3 "입장 화면"(새 배치 요약 3~6줄)
- Create:
  - `client/src/ui/builderThumbs.ts`(+ 순수 부분 test), `client/src/ui/BuilderIcons.tsx`(인라인 SVG: 탭 7개·회전·목소리·열쇠)
  - `client/public/entry/bg-desktop.avif|webp`, `client/public/entry/bg-phone.avif|webp`
  - `client/public/fonts/jua-builder.woff`, `client/public/fonts/OFL-Jua.txt`
  - `scripts/subset-builder-font.mjs`, 글꼴 글자 범위 test(파일 이름은 구현자가 정하고 보고서에 적는다)

**Interfaces:**
- Consumes: Task 7의 모든 것(`BUILDER_COPY`, `PREVIEW_CAMERA`, `partChips`, `colorLabel`, `showSwatches`, `VOICE_OPTIONS`, `BuilderPreview`, `BuilderPanel`), `useAvatar`·`assembleAvatar`·`retainAvatar`·`releaseAvatarSoon`(Task 5), `lookFromAppearance`·`visibleParts`·`lookKey`·`clipFor`(Task 4), `APPEARANCE_PRESETS`·`paletteFor`·`SLOT_COLOR_FIELD`(Task 3), `preloadCharacterAssets`.
- Produces: Task 7의 이름과 시그니처를 모두 유지한다.
  - `BUILDER_COPY`에는 키를 더할 수 있다. `PREVIEW_CAMERA` 값은 새 무대에 맞게 바꿀 수 있다.
  - DEV 훅 `__cvPreview()`(`yaw`, `setYaw`, `setClip`)와 `__cvAvatars().preview`를 유지한다. `PREVIEW_PROBE_ID`도 그대로다.
  - **design-note "Mapping" 표가 바인딩이다.** Task 7의 클래스 이름·role·aria 속성·글자 노드는 그대로 둔다. Task 10과 기존 E2E가 이것으로 찾는다.
  - 바뀌는 것은 CSS와 감싸는 요소뿐이다.

**시안과 다르게 정한 것** **[내 결정]**
1. **부품 그림과 프리셋 얼굴 그림은 실행 중에 그린다.** 빌드 때 미리 굽지 않는다.
   - 이유
     - 첫 화면 용량 여유가 약 315 KB뿐이다(투영 8,073,587 B, 한도 8,388,608 B). 미리 구운 그림만 약 235 KB다.
     - GLB가 바뀌어도 그림이 저절로 맞는다.
     - 지금 고른 색으로 칠할 수 있다.
   - 그리는 방법
     - 미리보기 Canvas의 WebGL 렌더러 하나로 그린다. **두 번째 WebGL 컨텍스트를 만들지 않는다.**
     - 칩 그림은 부품 하나를 지금 그 슬롯의 색으로 칠한다. 프리셋 그림은 그 프리셋 외형 전체의 상반신이다.
     - 크기: 칩 128×128(64 CSS px에 2배), 프리셋 160×160.
   - 캐시와 순서
     - 칩은 (부품, 색), 프리셋은 프리셋 id로 캐시한다. 같은 키는 다시 그리지 않는다.
     - 한 프레임에 최대 2장만 그린다. 지금 탭 것부터 그린다.
   - 그림이 아직 없거나 실패하면 지금처럼 이름만 있는 칩(빈 타일)으로 보인다. 미리보기가 실패해도(PreviewBoundary) 마찬가지다.
   - 그림은 `alt=""` 또는 `aria-hidden`이다. 버튼의 이름은 그대로 라벨 글자다.
   - 썸네일 전용 객체는 캐시에 담은 뒤 해제한다. `__cvAvatars()` 항목 수를 늘리면 안 된다(미리보기 1개만).
2. **글꼴**
   - Jua는 화면에 고정된 글자에만 쓴다. 제목·탭·칩 이름·프리셋 이름·버튼·안내가 여기에 든다. 닉네임 입력과 오류 문구는 지금 글꼴 그대로다.
   - `scripts/subset-builder-font.mjs`가 필요한 글자만 뽑는다.
     - `pyftsubset`(이 PC의 Python fontTools 4.66)을 `--flavor=woff`로 부른다. brotli가 없어 woff2는 못 만든다.
     - 글자 목록은 manifest labels·slotLabels·프리셋 이름·`BUILDER_COPY`·목소리·버튼 문구에서 모은다.
     - 원본 경로는 `--font <ttf>`로 받는다. 기본값은 `<repo>/art/fonts/Jua-Regular.ttf`다(`sync-character-assets.mjs`의 `--art`와 같은 방식).
   - 테스트 하나가 화면 고정 문구의 모든 글자가 subset 글자 목록에 들어 있는지 확인한다. 글자 목록 파일은 스크립트가 같이 쓴다.
   - 목표 크기는 25 KB 이하다. `@font-face`에 `font-display: swap`을 준다.
   - 외부 글꼴 주소(Google Fonts 등)는 쓰지 않는다. 학생 접속이 외부로 나가지 않게 하기 위해서다.
3. **배경**
   - `<picture>` 또는 `image-set()`으로 기기마다 한 장만 받는다. AVIF를 먼저 쓰고 WebP로 대체한다.
   - 가로가 세로 이상인 화면은 desktop 그림, 세로 화면은 phone 그림을 쓴다.
   - 그림이 오기 전에는 크림·라벤더 바탕색과 작은 LQIP를 보인다. `preload`는 맞는 한 장만 한다.
4. **무대 맞춤**
   - 인형 발이 배경 받침대 윗면에 놓이게 한다. 윗면 중심은 넓은 그림 (0.500, 0.701), 세로 그림 (0.500, 0.437)이다.
   - 방법은 자유다. 예를 들어 배경과 무대를 비율이 고정된 상자 하나에 넣을 수 있다.
   - 확인 화면: 1280×800, 1440×900, 1920×1080, 1024×768, 820×1180, 390×844, 375×812, 360×740, 320×568.
   - 각 화면에서 발과 받침대 윗면의 차이가 받침대 윗면 두께의 절반 이하이고, 인형이 패널이나 버튼에 가리지 않아야 한다.
   - 마법사 모자 끝(약 2.73 m)이 잘리지 않아야 한다.
5. **휴대폰 아래 시트**
   - 시트 안에서 스크롤한다. 손잡이를 톡 누르거나 위아래로 끌면 높이가 47% ↔ 88%로 바뀐다. `prefers-reduced-motion`이면 움직임 없이 바로 바뀐다.
   - 입장 버튼은 시트 아래에 고정(sticky)이고, 그 뒤에 페이드를 깐다.
   - **Ruling S22:** Task 10 모바일 4단계의 "세로 드래그 → `scrollY` 증가"는 이렇게 읽는다. "세로로 끌면 미리보기는 돌지 않고, 조립실의 스크롤 상자(시트나 페이지)가 스크롤된다."
6. **관리자**: 위쪽 바 오른쪽의 알약 버튼 "관리자이신가요?"다. 누르면 코드 입력이 작은 유리 팝오버로 열린다. 문구와 동작은 지금 그대로다.
7. **닉네임 이름판**
   - 인형 아래에 둔다. `input.cv-input`, `maxLength=12`, label은 그대로다.
   - placeholder는 "이름을 지어 주세요 (2~12자)"다(`NICKNAME_MIN` 2, `NICKNAME_MAX` 12).
   - 터치 기기에서는 `autoFocus`를 빼서 키보드가 무대를 덮지 않게 한다.
8. **회전 버튼 ⟲ ⟳**: 누를 때마다 ±π/4만큼 200 ms 동안 부드럽게 돈다. 값은 yaw ref에 쓴다. `aria-label`은 "왼쪽으로 돌리기"·"오른쪽으로 돌리기"다.
9. **움직임**
   - design-note "Motion" 절 그대로 하되, transform·opacity만 쓴다. `prefers-reduced-motion`이면 모두 끈다.
   - 프리셋이나 랜덤을 누르면 인형이 500 ms 동안 한 바퀴 돈다. 점프 클립은 쓰지 않는다(클립 상태를 바꾸지 않기 위해서다).
10. **Task 7 보류 항목을 같이 고친다**(ledger "Task 7: minor (deferred)")
    - 데스크톱 첫 화면에서 목소리 줄이 입장 버튼 밑에 반쯤 가려진다. 새 배치(왼쪽 패널 아래)로 없앤다.
    - `.cv-chips`가 늘 3줄 높이를 차지해 얼굴 탭에 빈칸이 생긴다.
    - PreviewBoundary가 lookKey가 바뀌어도 다시 시도하지 않는다. lookKey가 바뀌면 리셋한다.
    - `onPointerMove`에 마우스 `buttons === 0` 가드가 없다.
    - 목소리 radiogroup에 화살표 키 이동(roving tabindex)이 없다.
    - `preloadCharacterAssets`를 입장할 때만 부른다. 조립실이 뜰 때 부른다.
    - `identityCache` 머리 주석이 오래됐다.
11. **로고**: 위쪽 바 왼쪽의 Cayson 배지와 "캐릭터 조립실"이 조립실 제목이다(설계 3장: 로고는 조립실 제목에만). 다른 곳에는 로고도 학교 이름도 넣지 않는다.
12. **배경 그림 출처**: `LICENSE.md`에 적는다. "ChatGPT(OpenAI) 이미지 생성, 발주자 계정, 2026-11-01, A안. 데스크톱 그림의 글자 같은 무늬는 손으로 흐리게 지움." 상업 판매 조건 확인은 출시 전에 발주자에게 묻는 항목으로 보고서에 남긴다.

**용량·성능 기준**
- 첫 화면에 더해지는 용량(배경 한 장 + 글꼴 + 아이콘·CSS)은 데스크톱 AVIF 기준 120 KB 이하다. 실제 바이트를 보고서에 적는다.
- 1280×800과 375×812(CPU 4배 느리게)에서 모든 탭을 한 번씩 연 뒤, 긴 프레임(> 50 ms) 수와 미리보기 회전 중 평균 프레임 시간을 보고한다.

- [ ] **Step 1: 실패하는 테스트 작성.** 다음을 확인한다.
  - `builderThumbs`의 순수 부분: 캐시 키, 지금 탭 우선 순서, 프레임당 2장 큐.
  - 글꼴 글자 범위.
  - `builderOptions`에 새로 더한 것.
- [ ] **Step 2: 실패 확인.** `npm run test -w client` → 새 테스트 FAIL
- [ ] **Step 3: 구현.** 다음 순서로 한다.
  1. 자산 복사와 글꼴 subset
  2. 배치와 CSS
  3. 썸네일
  4. 움직임
  5. 보류 항목
- [ ] **Step 4: 통과 확인.** `npm run test && npm run typecheck && npm run build` PASS
- [ ] **Step 5: 브라우저 확인.** 설치된 Chrome과 Playwright로 한다. 스크립트는 스크래치 폴더에 두고, 개발 서버는 `npm run dev`(서버 :2567, 클라이언트 :5173)다.
  - 위 9개 화면 크기의 스크린샷을 찍는다. 1280×800과 390×844는 시안과 나란히 놓은 비교 그림도 만든다.
  - 프리셋 8개·랜덤·탭 7개·칩·견본·목소리를 모두 눌러 본다. 키보드로 Tab 순서·focus-visible·탭 화살표·목소리 화살표를 확인한다.
  - 320×568과 375×812에서 가로 스크롤이 없고, 버튼이 모두 44×44 이상이며 서로 겹치지 않는다. 입장 버튼은 화면 안에 있다(Task 10 모바일 3단계).
  - `prefers-reduced-motion`을 켜고 한 번 더 본다.
  - 콘솔 오류가 0이고, StrictMode에서 `__cvAvatars` 항목이 새지 않는다.
  - 회귀: 입장 경로를 쓰는 기존 E2E인 `node e2e/task-char-load.mjs`, `node e2e/task-ux-desktop.mjs`, `node e2e/task-ux-mobile.mjs`가 통과한다.
- [ ] **Step 6: 커밋.** `feat: 조립실 새 디자인 — 밝은 하늘 정원 무대·유리 패널·부품 그림 카드·이름판·휴대폰 아래 시트 (캐릭터 3단계 Task 7b)`

### Task 8: AI 조교 NPC — 새 몸 + 안드로이드 옷

**Files:**
- Modify: `client/src/game/npcLook.ts`
  - 지울 것: `getNpcTexture`, `androidCells`, `NPC_HIDE_NODES`, `SHELL_WHITE`, `buildPaletteTexture` import
  - 남길 것: `NPC_ACCENTS`, `attachNpcAccessories`
- Test: `client/src/game/npcLook.test.ts`
- Modify: `client/src/game/NpcCharacter.tsx` — `mage.glb` 로딩·preload, `cloneTinted`, 아틀라스 교체, 자체 dispose를 지운다. 이름표 등록은 그대로 둔다.

**Interfaces:**
- Consumes: `AvatarLook`, `visibleParts`, `solidColorFor`, `clipFor`(Task 4), `useAvatar`(Task 5), `SKIN_PALETTE`(Task 3)
- Produces:

```ts
export const NPC_HAIR_COLOR = "#4A5160";                    // 기존 SLATE
export const NPC_HAIR: Record<NpcId, string> = { hall: "short", lobby: "bob", gallery: "ponytail", maze: "curly" };
export function npcLook(id: NpcId): AvatarLook;
// parts: hat null, hair NPC_HAIR[id], face "smile", top/bottom/shoes "android", item null
// colors: skin SKIN_PALETTE[0].hex, hair NPC_HAIR_COLOR, accent NPC_ACCENTS[id], 나머지 "#FFFFFF"
```

- NpcCharacter가 재생하는 클립 이름도 `clipFor(base, npcLook(id))`를 거친다. 조교의 하의는 `android`라 변형이 없어서 결과는 기본 클립과 같다.
- 이름·위치·강조색은 바꾸지 않는다(설계 5.3). 머리 모양·얼굴·피부는 [내 결정]이다. 조교끼리 머리 모양으로도 구별된다.
- 헤일로: `useAvatar(look, { probeId: \`npc:${npc.id}\`, decorate: (a) => attachNpcAccessories(a.root, NPC_ACCENTS[npc.id], a.materials) })`로 붙인다.
  - 조립할 때 한 번만 붙어야 한다. 별도 `useMemo`에 두면 StrictMode에서 두 번 붙는다.
  - 머리 뼈 기준 높이 0.95(안테나)·1.1(링)은 그대로 쓴다. 새 몸의 머리 꼭대기는 머리 뼈 위 약 0.92 m다(2단계 GLB 실측: `head` 뼈 y 1.241, `body__head` 최대 y 2.16).

- [ ] **Step 1: 실패하는 테스트 작성.**

```ts
it("every assistant wears the npcOnly android outfit and its own accent", () => {
  for (const id of Object.keys(NPC_ACCENTS) as NpcId[]) {
    const l = npcLook(id);
    expect([l.parts.top, l.parts.bottom, l.parts.shoes]).toEqual(["android", "android", "android"]);
    expect(CHARACTER_MANIFEST.npcOnly.top).toContain("android");
    expect(solidColorFor("mat_tint_accent", l)).toBe(NPC_ACCENTS[id]);
  }
});
it("assistants show no hat, no item and no bare torso/legs/feet");
it("the four assistants differ by hair as well as accent", () =>
  expect(new Set(Object.values(NPC_HAIR)).size).toBe(4));
it("assistants never get a long-skirt variant clip", () => {
  for (const id of Object.keys(NPC_ACCENTS) as NpcId[])
    for (const c of Object.values(CLIP)) expect(clipFor(c, npcLook(id))).toBe(c);
});
```

- [ ] **Step 2: 실패 확인.** `npm run test -w client -- npcLook` → FAIL
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 통과 확인.** `npm run test && npm run typecheck` PASS
- [ ] **Step 5: 눈으로 확인.** 조교 4명을 각 방에서 정면으로 찍는다.
  - 흰 안드로이드 옷의 강조 줄무늬가 조교별 색이어야 한다.
  - 헤일로 링이 머리 위에 떠 있어야 한다.
  - "AI 조교" 이름표가 그대로여야 한다.
  - `__cvAvatars()["npc:hall"].drawMeshes`는 4(합친 몸 + 얼굴 + 안테나 + 링)다.
- [ ] **Step 6: 커밋.** `feat: AI 조교를 새 몸으로 — 안드로이드 옷·조교별 강조색·기존 헤일로 (캐릭터 3단계 Task 8)`

### Task 9: 옛 캐릭터 코드·자산 제거

**Files:**
- Delete:
  - `client/public/models/knight.glb`, `barbarian.glb`, `mage.glb`, `rogue.glb`, `crown.glb`
  - `client/src/game/avatar.ts`, `royalPalette.ts`, `royalPalette.test.ts`, `royalAttachments.ts`, `characterConfig.test.ts`
  - `scripts/dump-uv-cells.mjs`(KayKit 아틀라스 전용)
- Modify: `client/src/game/constants.ts`
  - 지울 것: `RoyalId`, `CrownConfig`, `CharacterPreset`, `CHARACTERS`, `HIDEABLE_NODES`, `CROWN_MODEL`, `CROWN_BASE_SCALE`, `CROWN_RIM_Y`, `crownLocalScale`
  - 남길 것: `HEAD_BONE_NAME`. `CLIP` 주석은 "character.glb의 manifest clips"로 고친다.
- Modify: `shared/src/constants.ts` — `CHARACTER_COUNT`, `TINT_COUNT`, `TINT_COLORS` 삭제
- Modify: `client/public/models/LICENSE.md`를 다시 쓴다.
  - `character.glb`: Cayson 토이 피규어. 이 저장소의 오리지널 메시·텍스처다. 뼈대(Rig_Medium)와 기본 동작 클립 7개는 KayKit Adventurers Character Pack 1.0(Kay Lousberg, CC0 1.0, 기존 출처 URL)에서 가져왔다. 롱스커트용 변형 클립 3개(`Walking_A_LongSkirt`, `Running_A_LongSkirt`, `Jump_Full_Short_LongSkirt`)는 위 KayKit 클립(CC0)을 바탕으로 이 저장소의 아트 작업에서 다리 움직임만 줄여 만든 파생 클립이다.
  - 로고(`../brand/cayson-logo-white.png`, 조립실 제목에만 쓴다): Fredoka 700(SIL OFL 1.1)로 만든 "Cayson" 워드마크다. 1단계 텍스처 생성기 `gen.html`의 `meta.font`로 확인했다.
  - 가구 절(`furniture/LICENSE.md`)은 그대로 둔다.

**Interfaces:**
- Consumes: Task 6·8 이후 이 심볼들을 쓰는 곳은 없다.

- [ ] **Step 1: 지우고 고친다.**
- [ ] **Step 2: 남은 참조 확인.**
  - Run: `rg -n "royal|Royal|CHARACTERS\b|CHARACTER_COUNT|TINT_COUNT|TINT_COLORS|cloneTinted|HIDEABLE_NODES|CROWN_|crownLocalScale|(knight|barbarian|mage|rogue|crown)\.glb|__cvRoyal" client/src server/src shared/src loadtest scripts`
  - Expected: 0줄. `e2e/`의 옛 일회성 스크립트와 `docs/`는 검사 대상이 아니다.
- [ ] **Step 3: 통과 확인.** `npm run typecheck && npm run test && npm run build` PASS
  - `client/dist/models`에 `character.glb`, `LICENSE.md`, `furniture/`만 있어야 한다.
  - `du -sh client/dist`가 Task 1 전(약 19 MB)보다 작아야 한다.
- [ ] **Step 4: 커밋.** `refactor: KayKit 캐릭터 GLB 4개·왕관·왕실 팔레트/장신구 코드 제거, 자산 라이선스 갱신 (캐릭터 3단계 Task 9)`

### Task 10: E2E — 조립실 → 입장 → 다른 화면에서 같은 외형

**Files:**
- Create: `e2e/task-char-builder.mjs`(데스크톱 1280×800 단계 + 모바일 375×812 단계)

**Interfaces:**
- Consumes(DEV 훅):
  - `__cvAvatars()`(항목: `parts`·`drawMeshes`·`triangles`·`clip`), `__cvPreview()`(Task 5·7)
  - `__cv.getRemotes()`의 `appearance`(Task 6), `__cv.getPos/sit/stand/dropConnection`
  - `__cvRenderInfo()`(Task 1)
  - 의자 이동·앉기 루틴은 `e2e/task-ux-desktop.mjs` 5단계에서 옮겨 온다.
- 실행 준비: `npm run dev`(서버 :2567, 클라이언트 :5173)

데스크톱(탭 A·B는 각각 새 컨텍스트):

1. A 입장 화면:
   - `.cv-builder-preview canvas`가 보인다.
   - `__cvAvatars().preview.parts`가 기본 외형의 7개 부품 목록과 같다(Task 4 첫 테스트의 배열).
   - `"body__torso"`는 없다.
2. 프리셋 "기사":
   - parts에 `hat__knight_helmet`, `top__armor`, `shoes__tall_boots`, `item__wooden_sword`가 있고, `hair__`로 시작하는 부품은 없다(투구가 머리를 숨김).
   - `hair__short`는 없다.
3. 탭 "머리카락" → 칩 "포니테일" → parts에 `hair__ponytail__hat`이 생긴다.
   - 탭 "모자" → 칩 "없음" → `hair__ponytail`이 있고 `hair__ponytail__hat`은 없다.
4. 탭 "웃옷":
   - 견본 "흰색" → 그 견본 `aria-pressed="true"`, parts는 그대로(색만 바뀐다)
   - 견본 "남색" → 그 견본 `aria-pressed="true"`, "흰색" 견본은 `"false"`
5. 탭 "모자" → 칩 "왕관" → 견본 "금색"이 `aria-pressed="true"`(왕관 기본 금색). 칩 "티아라"도 같다(티아라 기본 금색).
6. 렌더 점검 시트(설계 6장, 게임 렌더러로):
   - 프리셋 8개를 하나씩 누르며 미리보기 영역을 스크린샷으로 찍는다.
   - 🎲 랜덤을 30회 누르며 매번 찍는다. 그때마다 `preview.drawMeshes ≤ 8`이고, 목소리 `aria-checked`는 그대로다. parts가 바뀐 횟수 ≥ 25다.
   - 찍은 PNG를 data URL 격자 HTML로 묶어 `builder-presets-sheet.png`, `builder-random-sheet.png`를 만든다.
   - 투구 시트(Review Focus 6): `knight_helmet`과 `space_helmet` 각각에 머리 5종을 하나씩 씌워 미리보기를 찍고 `builder-helmet-sheet.png`로 묶는다. 어느 머리 모양에서도 머리카락이 투구·헬멧 밖으로 삐져나오면 안 된다(사람이 확인).
7. 목소리 "여자 목소리" → `aria-checked="true"`.
8. 미리보기 위에서 마우스로 가로 200 px 끌기 → `__cvPreview().yaw` 변화 2.0 ± 0.2 rad.
9. A가 "조립A"로 입장한다.
   - `__cvAvatars()[A.sid].parts`가 입장 직전 `preview.parts`와 같다.
   - B는 기본 외형의 "조립B"로 입장한다.
   - B에서 `getRemotes()`의 A `appearance`가 A의 `localStorage["cv.entry"].appearance`와 같다.
   - B의 `__cvAvatars()[A.sid].parts`가 A 자신의 parts와 같다.
   - B의 모든 항목이 `drawMeshes ≤ 8`이다.
10. 목소리: A가 "안녕 조립실"을 보낸다. B에서 `/api/npc-voice` 요청 본문의 `gender`가 `"female"`이다(`page.on("request")`).
11. 동작: B 화면에서 A를 찍는다.
    - A W 1 s(걷기), Shift+W(달리기), Space(점프)
    - 의자 앉기(옮겨 온 루틴) → `getRemotes()`의 A `seatIndex >= 0` → 일어서기
    - 각 장면 스크린샷. 뚫림·떠 보임은 사람이 확인한다.
    - A의 하의는 위 2번에서 고른 기사 프리셋의 `pants`라 변형 없이 기본 클립이 재생된다(대조군). B의 `__cvAvatars()[A.sid].clip`이 걷기 `Walking_A`, 달리기 `Running_A`, 점프 `Jump_Full_Short`이다.
    - 롱스커트(Review Focus 7): 새 컨텍스트 C가 프리셋 "공주"(`longskirt`)로 "조립C"에 입장한다. B 화면에서 C를 찍는다.
      - C W 1 s → B의 `__cvAvatars()[C.sid].clip`이 `Walking_A_LongSkirt`, Shift+W → `Running_A_LongSkirt`, Space → `Jump_Full_Short_LongSkirt`, 멈춤 → `Idle`이다. 점프는 짧으므로 Space 직후 100 ms 간격으로 폴링해 한 번이라도 보이면 통과다.
      - 같은 값을 C 자신의 화면 `__cvAvatars()[C.sid].clip`에서도 단언한다(내 아바타와 원격 아바타 두 경로 모두).
    - 장면 스크린샷을 `builder-motion-sheet.png`로 묶는다. 행: A 걷기·달리기·점프·앉기 / C(공주 롱스커트) 걷기·달리기·점프. 롱스커트 행에서 다리가 치마를 뚫지 않는지 사람이 확인한다. C는 이 단계가 끝나면 닫는다.
12. 재접속(Review Focus 2):
    - A `__cv.dropConnection()` → B에서 A `connected === false` 스크린샷
    - 복귀 → B의 `__cvAvatars()[A.sid].parts` 그대로 → 복귀 후 정면 스크린샷. 얼굴이 네모 판이 아니어야 한다.
13. A 새로고침 → 입장 화면 닉네임 "조립A", `preview.parts`가 9단계 parts와 같다(마지막 외형 기억).
14. 예전 저장값(Review Focus 3):
    - 새 컨텍스트에서 `addInitScript`로 `localStorage["cv.entry"] = '{"nickname":"옛사람","character":5,"tint":3}'`를 넣는다.
    - 닉네임 "옛사람", `preview.parts`가 기본 외형과 같다 → 입장에 성공한다.
15. 조교: `__cvAvatars()["npc:hall"].parts`에 `top__android`, `bottom__android`, `shoes__android`가 있다. 강의실 조교 스크린샷.

모바일(375×812, `isMobile`, `hasTouch`):

1. 입장 화면:
   - `document.documentElement.scrollWidth ≤ 375`
   - `.cv-builder-preview` 높이 ≥ 200이고, 위쪽 812 px 안에서 시작한다.
2. 보이는 `.cv-chip`, `.cv-swatch`, `.cv-preset`, `.cv-random`, `.cv-voice-option`, 탭이 모두 44×44 이상이고 서로 겹치지 않는다(Review Focus 5).
3. `.cv-submit`을 `scrollIntoViewIfNeeded`한 뒤 bounding box가 화면 안에 있다.
4. 미리보기 위 가로 터치 드래그(합성 `pointerType: "touch"`) → yaw가 바뀐다. 세로 드래그 → `scrollY`가 커진다(pan-y).
5. 프리셋 "마법사" 톡 → 입장 → `__cvAvatars()[self].parts`에 `hat__wizard`, `top__robe`, `shoes__wizard_shoes`, `item__staff`가 있다.
6. 스크린샷 3장: 입장 위쪽, 스크롤한 아래쪽, 월드.

- [ ] **Step 1: 스크립트 작성.** 단언은 위 목록 그대로 쓰고, 단계마다 스크린샷을 남긴다.
- [ ] **Step 2: 실행.** `node e2e/task-char-builder.mjs` → 종료 코드 0. 실패하면 원인 태스크로 돌아가 고친 뒤 다시 돌린다.
- [ ] **Step 3: 시트 확인.** 프리셋·랜덤·투구 시트와 동작 시트(롱스커트 행 포함)를 직접 본다. 뚫림·떠 보임·찢어짐·색 이상을 목록으로 적는다.
  - 코드 문제(정점색·가지치기·`clipFor` 누락)는 여기서 고친다.
  - 모델 문제는 2단계 자산 수정으로 넘기고 발주자에게 알린다. 롱스커트 행에서 `clip`이 `*_LongSkirt`인데도 다리가 치마를 뚫으면 변형 클립 자체의 문제이므로 모델 문제로 본다.
- [ ] **Step 4: 회귀 확인.** `npm run test && npm run typecheck` PASS
- [ ] **Step 5: 커밋.** `test: 조립실→입장→원격 외형 일치·롱스커트 동작·재접속·옛 저장값·휴대폰 E2E (캐릭터 3단계 Task 10)`

### Task 11: 용량·100명 성능·100봇 30분 재측정 + 문서 + 발주자 확인

**Files:**
- Modify: `docs/loadtest.md`(Task 1 표의 Cayson 토이 열, 30분 부하 결과)
- Modify: `docs/design.md`
  - 5장: Player 스키마 줄을 외형 15필드로, 재접속 문구를 "닉네임·외형"으로
  - 6장: "캐릭터 GLB 4종"·"색상 틴트" 줄을 GLB 1개 + 조립·정점색 합치기·아바타당 메시 ≤ 4로
  - 7장: KayKit은 뼈대·기본 동작 클립 7개만(롱스커트 변형 클립 3개는 이 저장소에서 추가)
  - 17·28장 머리에 "⚠️ 2026-10-31 캐릭터 조립실(36장)로 대체"
  - 31·34장의 조교 외형 줄을 안드로이드 옷 + 강조색 + 헤일로로
  - 새 36장 "캐릭터 조립실 (2026-10-31)": 외형 필드, 조립 방식, 조립실, 프리셋, 롱스커트 변형 클립(`clipVariants`·`clipFor`), 측정 결과 요약

**Interfaces:**
- Consumes: `e2e/task-char-load.mjs`, `e2e/task-char-perf.mjs`, `perf-kaykit.json`, `load-kaykit.json`(Task 1), `loadtest/measure.mjs`

- [ ] **Step 1: 첫 접속 용량.**
  - `npm run build` → `NODE_ENV=production node server/dist/index.cjs` → `node e2e/task-char-load.mjs`
  - Expected: PASS(합계 ≤ 8,388,608, `character.glb` ≤ 3,145,728, 옛 GLB 요청 0)
- [ ] **Step 2: 강의실 100명 렌더.**
  - `npm run dev` + `npm run loadtest -- --numClients 100 --duration 300 --zone lectureHall` 실행 중에 `node e2e/task-char-perf.mjs`
  - Expected: PASS(아바타 ≥ 100, 최대 `drawMeshes` ≤ 8, 평균 calls ≤ KayKit 평균 calls)
  - fps·triangles·heap은 KayKit과 나란히 기록한다.
  - 아바타당 삼각형은 KayKit 약 5.7~7k, 토이 약 13~16k(2단계 GLB 실측)다. 그래서 triangles 증가를 표에 꼭 남긴다.
- [ ] **Step 3: 100봇 30분 부하**(설계 6장). `docs/loadtest.md` 1절 절차 그대로 한다.
  - `NODE_ENV=production node server/dist/index.cjs`
  - `node loadtest/measure.mjs --pid <PID> --duration 1860 --interval 5 --out measure-char.csv`
  - `npm run loadtest -- --numClients 100 --duration 1830`
  - 기존 게이트로 판정한다: p95 CPU < 50%(1 vCPU), 최대 RSS < 400 MB, 클라이언트당 다운스트림 ≤ 30 KB/s, join 100/100, 끊김 0, 오류 0.
- [ ] **Step 4: 문서 갱신**(위 Files). `npm run typecheck && npm run test && npm run build` PASS
- [ ] **Step 5: 발주자 확인 요청**(설계 7장 4단계 전 중간 확인). 한국어로 보고한다.
  - 보고에 넣을 것: 프리셋·랜덤 시트, 동작 스크린샷, 용량·성능 표
  - 실제 휴대폰으로 확인받을 것:
    - 조립실을 쓸 수 있는가
    - 강의실 100봇 장면이 끊기지 않는가
  - 실기기 30fps에 못 미치면 원인 후보(아바타당 삼각형 2배)와 선택지를 보고한다. 선택지는 2단계 자산에 Decimate를 적용해 아바타당 약 8k 삼각형으로 줄이는 것이다. 이 계획 안에서 자산을 고치지 않는다.
  - 결과를 `docs/loadtest.md`에 한 줄로 남긴다.
- [ ] **Step 6: 커밋.** `docs: 캐릭터 조립실 용량·100명 렌더·100봇 30분 재측정과 기획 36장 (캐릭터 3단계 Task 11)`

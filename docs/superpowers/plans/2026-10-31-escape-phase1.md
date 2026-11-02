# AI 학교 탈출 — 1단계(기반 + 시범 교실 "상담실") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 반 코드로 들어온 한 반이 중앙 홀에서 팀을 만들고, 선생님이 시작하면 동쪽 복도의 상담실에 팀별로 들어가 서버 권위 퍼즐(개인정보)을 협동으로 풀고 탈출하는 첫 시범 교실을, 발주자가 직접 플레이해 볼 수 있는 상용 수준으로 완성한다.

**Architecture:** 서버는 공통 `PlayerRoom`(이동·채팅·이모지·점프·입력 중·재접속) 위에 기존 `WorldRoom`(지금 월드), 반별 `ClassRoom`(중앙 홀·복도·팀·진행·선생님), 팀별 `EscapeRoom`(퍼즐 엔진·타이머·팀 채팅)을 올리고, 방끼리는 `matchMaker.remoteRoomCall`로만 이야기한다. 퍼즐은 서버 전용 데이터 파일(`server/src/escape/rooms/counsel.ts`)을 순수 엔진이 해석하며, 클라이언트는 정답이 빠진 공개 투영(`RoomContent`)과 스키마 상태만 받는다. 지도는 `MapGeometry` 하나로 서버 이동 검증·클라이언트 충돌·카메라를 공유하고, 3D는 밝은 낮 조명을 구운 블렌더 GLB를 품질 단계(PC 화려함 / 휴대폰 가벼움)에 맞춰 그린다.

**Tech Stack:** Colyseus 0.17(`defineServer`/`defineRoom().filterBy`, `matchMaker.createRoom`/`remoteRoomCall`) · @colyseus/schema 4(데코레이터, schema.ts는 서버 런타임 전용) · Express 5 · React 19 + R3F 9 + three 0.185 + drei 10(`Effects`, `Sparkles`) + three-stdlib(`UnrealBloomPass`) + zustand · vitest 4(워크스페이스마다) + @colyseus/testing · Playwright(`e2e/*.mjs`) · tsx · Blender 5.2 LTS + Blender MCP · Node 24

**Spec:** `docs/superpowers/specs/2026-10-31-ai-school-escape-design.md` — 승인됨. 이 계획은 §12의 1단계와 §14 "반 코드로 함께"·"한 번에 끝내기"를 구현한다. 기반 인터페이스는 `docs/superpowers/specs/2026-10-31-controls-ux-design.md`, `docs/superpowers/specs/2026-10-31-character-builder-design.md`, `docs/superpowers/plans/2026-10-31-controls-ux.md`, `docs/superpowers/plans/2026-10-31-character-parts-stage2.md`를 따른다.

**변경 (2026-11-01 발주자: 밤 → 밝은 낮):** 학교 배경이 밝은 낮이 되어 조명·하늘·진행판 창·탈출 연출·밝기 검사·스타일 승인을 밝은 낮 기준으로 바꿨다(태스크 번호와 나머지는 그대로).

**변경 (2026-11-01 발주자: 이름·caysonverse 안의 체험 하나):**
- 제목은 "AI 학교 탈출"이다.
- caysonverse는 여러 체험을 담아 넓혀 가는 곳이고, 이 게임은 그 체험 중 하나다(스펙 14장 "기존 월드와 다른 체험").
- 이 계획의 구조는 그대로 맞는다. 공통 `PlayerRoom` 위에 기존 `WorldRoom`을 그대로 두고 반별 `ClassRoom`을 따로 올린다.
- Task 14 입장 화면은 나중에 "어디로 갈까요?" 체험 고르기를 붙일 수 있게 만든다.
- 지금 월드를 입장 화면에 보일지(지금 계획: `?world=legacy`로만)는 Task 14 전에 발주자에게 확인한다.

## Global Constraints

- 브랜치는 `feature/escape-phase1`이다. 태스크마다 그 브랜치에 커밋하는 것은 기대된 일이다. main 병합과 GitHub 푸시는 매번 발주자 OK가 있어야 한다.
- 커밋 형식: `git add <그 태스크의 파일들>` → `git commit -m "<메시지>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`. `git add -A`는 쓰지 않는다.
- `npm install`·`npm ci`를 실행하지 않는다. 이 환경에서는 EALLOWGIT이 난다. 이 계획은 새 의존성을 추가하지 않는다. 꼭 필요해지면 발주자의 명시적 승인을 받고 lockfile을 손으로 고친다.
- Node 24(`engines.node >=24`).
- 매 태스크 끝에 루트에서 `npm run typecheck`와 `npm run test`가 모두 통과해야 한다. 이 계획이 명시해 바꾸는 테스트 말고는 기존 테스트를 그대로 둔다.
- 비밀 4종(퍼즐 정답·단서 원문, 선생님 키, 선생님 입장권(`teacherPass`), 운영자 키 `ADMIN_CODE`)은 클라이언트 번들에도 서버 로그에도 들어가지 않는다.
  - 퍼즐 데이터(`server/src/escape/rooms/*.ts`)는 클라이언트가 import하지 않는다. Task 25의 번들 검사가 이를 고정한다.
  - 선생님 키는 HTTP 본문으로만 오고, 서버 파일에는 sha256 해시만 둔다. Colyseus join 옵션에는 1회용 `teacherPass`만 싣는다.
  - `matchMaker.remoteRoomCall`의 오류 메시지에는 인자가 JSON으로 들어간다. 이 호출의 `err.message`는 절대 로그에 찍지 않고, 고정 문구만 찍는다.
  - `/api/*`의 JSON 파싱 오류는 로그 없이 400으로 답한다. Node의 JSON 오류 메시지에는 본문 일부가 들어가기 때문이다.
- 사용자에게 보이는 문구는 한국어, 식별자·파일명·명령은 영어.
- 개인정보는 닉네임만 쓴다. 학교 이름·실명 입력 칸을 만들지 않고, 입장 화면에 "실명 대신 별명을 써 주세요"를 둔다. CSV에도 닉네임만 들어간다.
- `D:\ClaudeCode\ai-ethics-detective`의 문장·그림·코드를 복사하지 않는다. 주제(개인정보)만 쓴다. 그 프로젝트의 파일은 열지 않는다.
- 실제 메신저·SNS·상표 화면을 흉내 내지 않는다. 팀 채팅은 지금 caysonverse 채팅 모양을 쓴다(노란 말풍선, 메신저식 프로필 목록 금지).
- `shared/src/schema.ts`는 클라이언트·로드테스트에서 `import type`으로만 쓴다.
- 세션 전용이다. DB도, 파일 저장도 없다. 서버가 다시 켜지면 그 판은 처음부터 다시 한다(spec §14).
- 성능: 중앙 홀 100명·휴대폰 30fps, 교실 안 최대 6명. 프레임마다 바뀌는 값은 React state·zustand에 넣지 않고, 매 프레임 경로에서 배열·객체를 새로 만들지 않는다.
- 자산은 직접 만든 것이거나 CC0만 쓴다. 글꼴은 OFL, 코드 라이브러리는 MIT/Apache-2.0만 허용한다. 출처는 `docs/licenses.md`에 남긴다.
  - AI 3D 생성(`generate_3d`)과 AI 이미지는 1단계에서 쓰지 않는다(spec §10·§14).
  - 외부 파일을 내려받기 전에는 파일명·출처·크기를 말하고 발주자 OK를 받는다.
- GLB 예산: 교실 GLB ≤ 5 MB(spec §7), 중앙 홀+복도 GLB ≤ 3.5 MB(첫 접속 8 MB 목표 안에 캐릭터 GLB ≤ 4.5 MB와 함께 들어가도록. 캐릭터는 프리셋 차림 부품 25개가 늘어 3 MB → 4.5 MB 상한이 됐다, 2026-10-31).
- 배포(Oracle 서버 포함)는 매번 발주자 확인 후에만 하고, 수업 시간에는 하지 않는다.
- 실행 위치: superpowers:using-git-worktrees로 `D:\Codex\cayson-games\caysonverse-escape-phase1` 워크트리를 만든다. node_modules는 npm install 없이 메인 체크아웃 것을 디렉터리 정션으로 잇는다: 루트·`client`·`server`·`shared`·`loadtest` 각각 `cmd /c mklink /J node_modules ..\caysonverse\node_modules`(경로 깊이에 맞게). 두 체크아웃에서 `vite`를 동시에 띄우지 않는다(`client/node_modules/.vite` 공유).

## Review Focus

1. **교실 안에서 새로고침·탭 닫기 후 다시 들어오기.** 같은 닉네임으로 반 코드를 다시 넣으면 유령(연결 끊긴 이전 세션)을 이어받아 팀이 유지되고, 자동으로 같은 교실로 돌아가 열린 서랍·가방·자기 몫의 나눠 보기 단서를 그대로 받아야 한다. 이전 세션의 늦은 퇴장 처리가 새 세션을 지우면 안 된다. → Task 5 `takes over a disconnected ghost`, Task 10 `late admit of the same memberKey`, Task 11 `refresh mid-room`, Task 25 데스크톱 16단계.
2. **협동 장치 도중 팀원이 나감.** 두 명 중 한 명이 끊기면 동시 누르기가 3초 길게 누르기로 바뀌고, 나눠 보기 단서가 남은 사람에게 모두 보이며, 그 사람이 투표하지 않은 채 끊겨도 남은 사람의 만장일치 투표가 바로 결정되어야 한다. 반대로 혼자 길게 누르는 중에 팀원이 들어오면 그 누르기는 취소된다. → Task 8 `membership` 테스트들, Task 10, Task 25 모바일 시나리오.
3. **동시에 두 번 누르기.** 팀장이 "입장"을 두 번 누르거나 두 사람이 같은 순간에 누르면 교실 인스턴스는 정확히 하나만 생겨야 한다. 두 사람이 같은 자물쇠를 거의 동시에 제출해도 틀린 시도는 한 번만 센다. → Task 11 `double EnterRoom`, Task 7 `LOCK_SUBMIT_GAP_MS`.
4. **선생님 일시정지·종료가 진행 중 퍼즐과 겹침.** 일시정지 동안 남은 시간·설득 문 대기 30초·힌트 간격이 모두 멈추고 퍼즐 조작이 막혀야 한다. 종료하면 진행 중이던 팀도 결과에 남고, 문 닫히기 전에 CSV를 받을 수 있어야 한다. → Task 7 `GameClock`, Task 10 `pause freezes`, Task 11 `teacher pause/resume … end`.
5. **잘못된 반 코드·끝난 반·꽉 찬 반·서버 재시작.** 학생은 각각 알아들을 수 있는 한국어 안내를 받아야 한다. 서버가 다시 켜지면 선생님 화면이 같은 반 코드로 반을 다시 열고, 학생 화면은 그 코드로 다시 들어와야 한다(진행은 처음부터). → Task 4 `re-opening with the same classCode`, Task 13 `classRejoinPlan`, Task 25 데스크톱 1·18단계.

---

## 기준선

1단계는 **`feature/controls-ux`(Task 1~19 전부)와 캐릭터 조립실 3단계가 main에 합쳐진 결과**에서 갈라진다. 그 두 작업의 결과물은 다시 계획하지 않고 이름으로만 쓴다.

| 이 계획이 쓰는 기준선 이름 | 출처 |
|---|---|
| `Player.role`(uint8), `ROLE_STUDENT = 0`, `ROLE_TEACHER = 1` | controls Task 3 |
| `RUN_SPEED`, `validateMove`의 달리기 예산, `MessageType.Jump`/`Typing`, `handleJump`/`handleTyping`, `ClientTracking.jumpRate/typingRate/typing` | controls Task 1·2 |
| `client/src/game/hotkeys.ts`: `HotkeyAction`, `resolveHotkey`, `onHotkey`, `resolveEscape` | controls Task 4·15 |
| `client/src/game/interact.ts`: `Interaction`, `InteractInput`, `pickInteraction`, `client/src/ui/ActionButton.tsx` | controls Task 10 |
| `client/src/game/cameraCollision.ts`: `CAMERA_BOXES`, `segmentHitFraction` | controls Task 9 |
| `client/src/game/labelRegistry.ts`, `NametagSystem.tsx`, `typing.ts`/`typingSync.ts`, `jump.ts`/`jumpSync.ts` | controls Task 11~14 |
| `client/src/game/settings.ts`: `Settings`, `DEFAULT_SETTINGS`, `parseSettings`, `client/src/stores/settingsStore.ts`, `client/src/ui/MenuPanel.tsx` | controls Task 15 |
| `client/src/game/hud.ts`: `zoneLabelAt`, `HudTop`, `RosterPanel`, `CoachMarks` | controls Task 16·17 |
| 외형 스키마 필드 15개 `hat, hatColor, hair, hairColor, face, skin, top, topColor, bottom, bottomColor, shoes, shoesColor, item, itemColor, voice` | character stage 3 |
| 외형을 검사하는 `validateJoinOptions`, 조립실 입장 화면, `character.glb` + `character.manifest.json`, 아바타 조립 함수(`cloneTinted` 대체) | character stage 3 |

발주자가 쓴 `uiStore`라는 이름은 controls 계획에 없다. 이 계획에서 같은 역할은 `isUiCaptured()`(`uiCapture.ts`)와 `useSettingsStore`(controls Task 15)가 맡는다.

**Task 1 Step 0 기준선 확인 (2026-11-02, `feature/escape-phase1` @ `cec0648`):**

- 확인됨: `git merge-base --is-ancestor feature/controls-ux HEAD` → `controls-ok`. `shared/src/schema.ts`에 `role`·`hatColor`가 있다. `hotkeys.ts`·`interact.ts`·`settings.ts`·`cameraCollision.ts`·`nametagSelect.ts`가 모두 있다.
- 점수: `npm run typecheck` 통과. `npm run test` shared 140 · server 201 · client 1320 모두 통과.
- 위 표와 이름이 다른 곳(이후 태스크는 아래 실제 이름을 쓴다):
  - `character.manifest.json`은 배포 파일이 없다. 생성물 `shared/src/characterManifest.ts`(`CHARACTER_MANIFEST`, 원본은 `art/character/export/character.manifest.json`)를 import한다.
  - 아바타 조립 함수(`cloneTinted` 대체)는 `assembleAvatar`·`buildAvatar`(`client/src/game/characterAvatar.ts`)다.
  - 외형 필드 목록은 `APPEARANCE_FIELDS`·`AppearanceField`(`shared/src/appearance.ts`, `shared/src/constants.ts`가 다시 내보냄)다. 이 계획의 `APPEARANCE_KEYS`·`AppearanceKey`는 만들지 않는다(E5). 그 이름을 쓰는 뒤쪽 태스크는 `APPEARANCE_FIELDS`로 읽는다.
  - `jumpSync.ts`·`typingSync.ts`는 `client/src/net/`에, `jump.ts`·`typing.ts`는 `client/src/game/`에 있다. `MessageType.Jump`·`Typing`은 `shared/src/messages.ts`에 있다.
  - `ClientTracking`은 `server/src/rooms/WorldRoom.ts` 안의 비공개 인터페이스다(내보내지 않음).
  - `uiStore`는 실제로 있다: `client/src/stores/uiStore.ts`의 `useUiStore`(`menuOpen`·`rosterOpen` 패널 열림 상태). 위 문장과 달리 이름이 코드에 있으니, 패널 상태는 그것을 쓰고 입력 가로채기는 계속 `isUiCaptured()`를 쓴다.
  - 클라이언트 `CAMERA_BOXES`는 `LEGACY_GEOMETRY.cameraBoxes`와 같은 배열이다(E17, Task 1에서 바꿨다).

## 파일 구조

| 파일 | 상태 | 책임 |
|---|---|---|
| `shared/src/escape/constants.ts` | 신규 | 반·팀·교실 상수, 방 id·이름 |
| `shared/src/escape/principles.ts` | 신규 | AI 윤리기준 10대 핵심요건 목록과 출처 |
| `shared/src/escape/classCode.ts` | 신규 | 반 코드 정규화(브라우저 안전) |
| `shared/src/escape/messages.ts` | 신규 | `ClassMsg`·`EscapeMsg`와 페이로드 |
| `shared/src/school/geometry.ts` | 신규 | `MapGeometry`, `wallsAround` |
| `shared/src/school/hubMap.ts`, `counselMap.ts`, `roomMaps.ts` | 신규 | 중앙 홀·복도·상담실 배치와 기하 |
| `shared/src/school/generated/*Colliders.ts` | 신규(생성물) | 블렌더 `col__*`에서 뽑은 소품 충돌 상자 |
| `shared/src/schema.ts` | 수정 | `Player.teamId/place`, `Team`, `ClassState`, `EscapeState` |
| `shared/src/worldMap.ts` | 수정 | `LEGACY_GEOMETRY` |
| `server/src/rooms/PlayerRoom.ts` | 신규 | 공통 방 기반 |
| `server/src/rooms/WorldRoom.ts`, `movement.ts`, `seating.ts` | 수정 | 기반 위로 이동, 기하·좌석 인자 |
| `server/src/rooms/profanity.ts` | 신규 | 한국어 비속어 필터 |
| `server/src/rooms/spawnToken.ts` | 신규 | 서버만 방을 만들 수 있게 하는 토큰 |
| `server/src/class/teacherKeys.ts`, `classCode.ts`, `classRegistry.ts`, `classApi.ts` | 신규 | 선생님 키, 반 코드 생성, 반 등록부, HTTP |
| `server/src/class/ClassRoom.ts`, `classPhase.ts`, `nickname.ts`, `teams.ts`, `resultsCsv.ts` | 신규 | 반 방과 순수 규칙 |
| `server/src/escape/types.ts`, `engine.ts`, `coop.ts`, `content.ts`, `stars.ts`, `gameClock.ts`, `projection.ts` | 신규 | 퍼즐 엔진 |
| `server/src/escape/rooms/counsel.ts`, `rooms/index.ts` | 신규 | 상담실 데이터(정답 포함, 서버 전용) |
| `server/src/escape/EscapeRoom.ts`, `banditAi.ts` | 신규 | 교실 방, 선택적 AI 힌트 다듬기 |
| `client/src/net/*` (`connection.ts` 수정, `teacherSession.ts`·`classSync.ts`·`escapeSync.ts`·`escapeResilience.ts` 신규) | | 반·교실 연결 |
| `client/src/stores/appStore.ts`(수정), `classStore.ts`, `escapeStore.ts` | | 화면·반·교실 UI 상태 |
| `client/src/ui/EntryScreen.tsx`(수정), `entryForm.ts` | | 학생/선생님 입장 |
| `client/src/game/activeMap.ts`, `PlayShell.tsx`, `HubScene.tsx`, `MapBoxes.tsx`, `hub/*` | 신규 | 지도 이음새, 공용 장면 틀, 중앙 홀 |
| `client/src/ui/hub/*` | 신규 | 팀 패널, 선생님 패널, 진행 안내 |
| `client/src/escape/*` | 신규 | 교실 장면과 UI |
| `client/src/game/quality.ts`, `QualityEffects.tsx`, `LightShafts.tsx` | 신규 | 그래픽 품질 단계 |
| `scripts/teacher-key.mjs`, `extract-colliders.ts`, `check-school-glb.ts`, `check-bundle-secrets.ts` | 신규 | 운영·자산·번들 점검 |
| `client/public/models/school/*` | 신규(자산) | `hub.glb`, `counsel.glb`, 조사 이미지, 반딧 초상 |
| `e2e/task-escape-desktop.mjs`, `task-escape-mobile.mjs`, `task-escape-perf.mjs`, `luma-check.mjs`, `fixtures/teacher-keys.e2e.json` | 신규 | 검증 |
| `loadtest/school.ts`, `loadtest/run.mjs` | 신규·수정 | 반·교실 부하 |
| `docs/licenses.md`(신규), `docs/deploy.md`, `docs/loadtest.md`, `docs/design.md` | | 문서 |

## 스펙 대응표

| 스펙 | 태스크 |
|---|---|
| §14 반 코드·선생님 키·반별 공간·반 닫힘·운영자 | 1, 4, 5, 13, 14 |
| §14 한 번에 끝내기(세션 전용, 재시작 = 처음부터) | 4, 5, 13 |
| §4·§7 `EscapeRoom` 팀별 인스턴스, 입장·숨김·복귀 | 10, 11, 15, 17 |
| §14 팀 만들기·자동 배정, 팀장 입장 | 6, 11, 16 |
| §6 팀 채팅, §14 비속어 필터·선생님 보기 | 3, 10, 11, 16, 17 |
| §7 퍼즐 엔진·데이터 파일·정답 서버 전용 | 7, 8, 9, 25 |
| §6 확대 화면, 팀 가방·조합, 자물쇠(숫자·글자·분류) | 7, 18, 19 |
| §6 나눠 보기·동시 누르기, §14 혼자 남았을 때 | 8, 10, 19 |
| §5 반딧 힌트 3단계(고정 문구 기본, AI 선택) | 7, 12, 20 |
| §6·§14 제한 시간 12~15분·다시 도전 | 7, 10, 17 |
| §5·§14 마지막 문 설득 + 30초 + 설명, CSV 원칙별 첫 시도 | 8, 9, 11, 20 |
| §6 탈출 연출, §3 학교 모형 창문 | 16, 20, 23, 24 |
| §5 상담실 내용(두 단계 문장) | 9 |
| §8 시작·일시정지·종료(1단계 범위) | 5, 11, 16 |
| §7 3D 자산·GLB·품질 단계, §14 밝기(밝은 낮) | 21, 22, 23, 24 |
| §7·§14 부하 테스트, 서버 1대당 반 수 | 26 |
| §11 검증, §12 발주자 확인 | 25, 27 |

---

# 0부: 기반

### Task 1: 기준선 확인 + 공용 상수·원칙·반 코드 + 학교 지도 데이터

**Files:**
- Create: `shared/src/escape/constants.ts`, `shared/src/escape/principles.ts`, `shared/src/escape/classCode.ts`
- Create: `shared/src/school/geometry.ts`, `shared/src/school/hubMap.ts`, `shared/src/school/counselMap.ts`, `shared/src/school/roomMaps.ts`
- Create: `shared/src/school/generated/hubColliders.ts`, `shared/src/school/generated/counselColliders.ts`
- Modify: `shared/src/worldMap.ts`(파일 끝에 `LEGACY_GEOMETRY`)
- Test: `shared/src/escape/classCode.test.ts`, `shared/src/school/geometry.test.ts`, `shared/src/school/hubMap.test.ts`, `shared/src/school/counselMap.test.ts`

**Interfaces:**
- Consumes: `AABB`, `isBlocked`(collision.ts), `PLAYER_RADIUS`, `WALL_HEIGHT`, `WORLD_BOUNDS`, `OBSTACLES`, `WALLS`(worldMap.ts), `MAZE_WALLS`(maze.ts).
- Produces:

```ts
// shared/src/escape/constants.ts
export const CLASS_ROOM = "class";
export const ESCAPE_ROOM = "escape";
export const CLASS_CODE_LENGTH = 6;
export const CLASS_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // 32자, 0/O·1/I 제외
export const CLASS_EMPTY_CLOSE_MS = 600_000;   // 마지막 사람이 나간 뒤 10분
export const CLASS_END_GRACE_MS = 30_000;      // 수업 끝내기 → 연결 종료까지
export const CLASS_CLOSED_CODE = 4002;         // 반이 닫힐 때 쓰는 close code
export const MAX_CLASSES_DEFAULT = 10;         // Task 26 측정값으로 바꾼다
export const TEACHER_PASS_TTL_MS = 120_000;
export const CLASS_REJOIN_BUDGET_MS = 60_000;
export const TEAM_MIN = 2, TEAM_MAX = 6, TEAM_TARGET = 4, MAX_TEAMS = 50;
export const TEAM_NAMES = ["햇살", "풍선", "새싹", "민들레", "무지개", "바람개비", "꽃잎", "솜사탕", "도토리", "해바라기", "파도", "구름"] as const;
export const TEAM_COLORS = ["#E85D75", "#F29E4C", "#F1C453", "#5BBF7A", "#3FA7D6", "#4B4FD8", "#8B5CF6", "#D16BA5"] as const;
export const TEAM_COLOR_LABELS = ["빨강", "주황", "노랑", "초록", "하늘", "파랑", "보라", "분홍"] as const;
export const ROOM_IDS = ["counsel", "library", "broadcast", "career", "art", "science", "media"] as const;
export type RoomId = (typeof ROOM_IDS)[number];
export const ROOM_LABELS: Record<RoomId, string>; // 상담실·도서관·방송실·진로실·미술실·과학실·미디어실
export const PHASE1_OPEN_ROOMS: readonly RoomId[] = ["counsel"];
export type ClassPhase = "lobby" | "running" | "paused" | "ended";
export type ClassCommand = "start" | "pause" | "resume" | "end";
export type TextLevel = "easy" | "hard";
export const PLACE_HUB = 0, PLACE_ESCAPE = 1;
export type EscapePhase = "intro" | "play" | "finale" | "timeup" | "escaped" | "ended";
export const ESCAPE_TIME_LIMIT_S = 900;    // 15분(spec §14 목표 12~15분)
export const ESCAPE_RETRY_EXTRA_S = 300;   // 다시 도전 +5분
export const ESCAPE_INTRO_MS = 8000;
export const COOP_WINDOW_MS = 2000;        // 동시 누르기
export const SOLO_HOLD_MS = 3000;          // 혼자일 때 길게 누르기
export const FINALE_COOLDOWN_MS = 30_000;  // 설득 실패 후 다시 고르기
export const HINT_GAP_MS = 30_000;         // 같은 단계의 다음 힌트까지
export const LOCK_SUBMIT_GAP_MS = 1500;
export const INSPECT_REACH = 2.2;          // m
export const ESCAPE_EMPTY_DISPOSE_MS = 120_000;
export const TICKET_TTL_MS = 60_000;
export const ESCAPE_MAX_CLIENTS = 8;       // 팀 6 + 재접속 여유
export const ESCAPE_ACTION_RATE = { count: 10, windowMs: 1000 } as const;
// (E5) APPEARANCE_KEYS·AppearanceKey는 만들지 않는다. stage 3의 APPEARANCE_FIELDS·AppearanceField(shared/src/appearance.ts)를 쓴다.

// shared/src/escape/principles.ts
export type PrincipleId = "human_rights" | "privacy" | "diversity" | "no_harm" | "public_good"
  | "solidarity" | "data_management" | "accountability" | "safety" | "transparency";
export const PRINCIPLES: readonly { id: PrincipleId; label: string }[];
// 인권 보장, 프라이버시 보호, 다양성 존중, 침해금지, 공공성, 연대성, 데이터 관리, 책임성, 안전성, 투명성 (이 순서)
export const PRINCIPLE_SOURCE = "과학기술정보통신부 「인공지능(AI) 윤리기준」(2020)";

// shared/src/escape/classCode.ts
export function normalizeClassCode(raw: unknown): string | null; // trim·대문자, 6자, 알파벳 밖이면 null
export function sanitizeCodeInput(raw: string): string;          // 입력 중 정리: 대문자, 알파벳 밖 글자 삭제, 6자에서 자름

// shared/src/school/geometry.ts
export interface Bounds { minX: number; maxX: number; minZ: number; maxZ: number }
export type GeometryId = "legacy" | "hub-open" | "hub-gated" | "counsel";
export interface MapGeometry { id: GeometryId; bounds: Bounds; obstacles: readonly AABB[]; cameraBoxes: readonly AABB[] }
export interface Opening { side: "n" | "s" | "e" | "w"; from: number; to: number } // n/s는 x 구간, e/w는 z 구간
export function wallsAround(zone: AABB, openings?: readonly Opening[], thickness?: number): AABB[]; // 기본 두께 0.5, 바깥쪽에 붙임, 모서리는 두께만큼 겹침
export function makeGeometry(id: GeometryId, bounds: Bounds, walls: readonly AABB[], props: readonly AABB[]): MapGeometry; // obstacles = walls+props, cameraBoxes = walls

// shared/src/school/hubMap.ts
export const HALL: AABB = { minX: -14, maxX: 14, minZ: -12, maxZ: 12 };
export const EAST_CORRIDOR: AABB = { minX: 14, maxX: 48, minZ: -3, maxZ: 3 };
export const HUB_BOUNDS: Bounds = { minX: -14, maxX: 48, minZ: -12, maxZ: 12 };
export const HUB_SPAWN = { x: 0, z: 6 } as const;
export const HUB_SPAWN_JITTER = 2;
export const TEAM_ZONE: AABB = { minX: -12, maxX: -5, minZ: 1, maxZ: 9 };
export const EAST_GATE: AABB = { minX: 13.75, maxX: 14.25, minZ: -3, maxZ: 3 };   // 시작 전 닫힘
export const WEST_SEAL: AABB = { minX: -14.25, maxX: -13.75, minZ: -3, maxZ: 3 }; // 서쪽 복도(다음 단계) 막음
export const PROGRESS_BOARD: AABB = { minX: -4, maxX: 4, minZ: -12, maxZ: -11 };  // 북쪽 벽 학교 모형
export interface HubDoor { room: RoomId; side: "n" | "s"; x: number; pad: AABB; returnPoint: { x: number; z: number } }
export const HUB_DOORS: readonly HubDoor[];
// counsel n x=22, library s x=22, broadcast n x=38, career s x=38.
// pad: x ∈ [x-1.5, x+1.5], n쪽 z ∈ [-2.6, -0.8], s쪽 z ∈ [0.8, 2.6]. returnPoint = pad 가운데.
export const HUB_WALLS: readonly AABB[]; // wallsAround(HALL, [e −3..3, w −3..3]) + wallsAround(EAST_CORRIDOR, [w −3..3])
export const HUB_GEOMETRY_OPEN: MapGeometry;  // walls + WEST_SEAL + PROGRESS_BOARD + HUB_PROP_COLLIDERS
export const HUB_GEOMETRY_GATED: MapGeometry; // 위 + EAST_GATE
export function hubGeometry(gateOpen: boolean): MapGeometry; // 미리 만든 두 객체 중 하나(할당 없음)
export function doorAtPad(x: number, z: number): RoomId | null;
export function inTeamZone(x: number, z: number, margin?: number): boolean; // 기본 margin 0.5
export function hubZoneLabel(x: number, z: number): string; // "중앙 홀" | "동쪽 복도" | ""

// shared/src/school/counselMap.ts
export const COUNSEL_ROOM: AABB = { minX: -6, maxX: 6, minZ: -5, maxZ: 5 };
export const COUNSEL_SPAWN = { x: 0, z: 2.8 } as const;
export const COUNSEL_SPAWN_JITTER = 1;
export interface ObjectAnchor { id: string; x: number; z: number; y: number; reach?: number }
export const COUNSEL_ANCHORS: readonly ObjectAnchor[]; // 아래 표
export type VisualEffect = "hide" | "show" | "open" | "glow";
export interface VisualBinding { node: string; flag: string; effect: VisualEffect; angle?: number }
export const COUNSEL_VISUALS: readonly VisualBinding[]; // 아래 표
export const COUNSEL_GEOMETRY: MapGeometry;
export function anchorById(id: string): ObjectAnchor | undefined;

// shared/src/school/roomMaps.ts
export interface RoomMap { geometry: MapGeometry; anchors: readonly ObjectAnchor[]; visuals: readonly VisualBinding[];
  spawn: { x: number; z: number }; spawnJitter: number; label: string; glb: string }
export const ROOM_MAPS: Partial<Record<RoomId, RoomMap>>; // 1단계는 counsel만, glb = "/models/school/counsel.glb"

// shared/src/school/generated/hubColliders.ts, counselColliders.ts (생성물, 처음엔 빈 배열)
export const HUB_PROP_COLLIDERS: readonly AABB[] = [];
export const COUNSEL_PROP_COLLIDERS: readonly AABB[] = [];

// shared/src/worldMap.ts
export const LEGACY_GEOMETRY: MapGeometry; // { id: "legacy", bounds: WORLD_BOUNDS, obstacles: OBSTACLES, cameraBoxes: [...WALLS, ...MAZE_WALLS] }
```

상담실 물건 위치(`COUNSEL_ANCHORS`, 북쪽이 −z):

| id | x | z | y | 무엇 |
|---|---|---|---|---|
| `counsel_screen` | 0 | −3.6 | 1.6 | 북쪽 벽 상담 화면(아리) |
| `note_box` | 0 | 0.9 | 0.6 | 가운데 낮은 탁자 위 쪽지 상자 |
| `flashlight` | 3.9 | −2.5 | 1.2 | 동쪽 책장의 손전등 |
| `cabinet` | −4.4 | 2.5 | 1.0 | 서쪽 상담 기록 캐비닛 |
| `drawer_left` | −3.5 | −1.1 | 0.7 | 서쪽 책상 서랍 |
| `drawer_right` | 3.9 | 1.5 | 0.7 | 동쪽 책장 아래 서랍 |
| `sort_board` | −2.6 | −3.8 | 1.4 | 북쪽 벽 분류판 |
| `safe` | 3.0 | −3.8 | 0.8 | 북동쪽 금고 |
| `safe_key_left` | −5.0 | 0 | 1.1 | 서쪽 벽 열쇠 스위치 |
| `safe_key_right` | 5.0 | 0 | 1.1 | 동쪽 벽 열쇠 스위치 |
| `exit_door` | 0 | 4.0 | 1.2 | 남쪽 마지막 문 |
| `note_1`…`note_8` | (−4.0, 1.0) (−1.8, 3.0) (2.0, 3.0) (4.2, −1.0) (−1.2, −0.6) (1.4, −0.8) (−3.8, −2.6) (1.2, −3.6) | | 0.5 | 흩어진 고민 쪽지 |

`COUNSEL_VISUALS`(노드 이름 → 플래그):

| node | flag | effect |
|---|---|---|
| `obj__flashlight` | `picked:flashlight` | hide |
| `obj__uv_film` | `picked:uv_film` | hide |
| `obj__cabinet_door` | `solved:cabinet_lock` | open, angle −1.75 |
| `obj__sort_cards` | `picked:sort_cards` | hide |
| `obj__board_cover` | `solved:cover_lock` | open, angle 1.6 |
| `obj__board_cards` | `solved:board_lock` | glow |
| `obj__safe_door` | `safe_open` | open, angle −1.9 |
| `obj__screen_ari` | `finale_ready` | glow |
| `obj__exit_door` | `escaped` | open, angle 1.6 |

- [ ] **Step 0: 작업 공간과 기준선 확인.** 워크트리를 만들고 node_modules 정션을 잇는다(Global Constraints). 아래가 모두 참이어야 한다. 하나라도 아니면 멈추고 발주자에게 보고한다.

```bash
git merge-base --is-ancestor feature/controls-ux HEAD && echo controls-ok
grep -n "role" shared/src/schema.ts && grep -n "hatColor" shared/src/schema.ts
ls client/src/game/hotkeys.ts client/src/game/interact.ts client/src/game/settings.ts client/src/game/cameraCollision.ts client/src/game/nametagSelect.ts
npm run typecheck && npm run test
```

기준선 이름이 위 표와 다르면, 실제 이름을 이 계획 파일의 "기준선" 표 아래에 한 줄씩 적고 이후 태스크에서 그 이름을 쓴다(그 메모도 이 태스크 커밋에 넣는다).

- [ ] **Step 1: 실패하는 테스트 작성.**

```ts
// classCode.test.ts
it("alphabet has 32 symbols and no 0/O/1/I", () => {
  expect(CLASS_CODE_ALPHABET).toHaveLength(32);
  for (const c of "0O1I") expect(CLASS_CODE_ALPHABET).not.toContain(c);
});
it("normalizeClassCode", () => {
  expect(normalizeClassCode(" k7q2xm ")).toBe("K7Q2XM");
  for (const bad of ["K7Q2X", "K7Q2XMM", "K7Q0XM", "K7QIXM", 42, null]) expect(normalizeClassCode(bad)).toBeNull();
});
it("sanitizeCodeInput strips disallowed characters while typing", () =>
  expect(sanitizeCodeInput("k7q-2xm0ab")).toBe("K7Q2XM"));

// geometry.test.ts
const Z = { minX: -5, maxX: 5, minZ: -5, maxZ: 5 };
it("wallsAround leaves exactly the opening", () => {
  const w = wallsAround(Z, [{ side: "e", from: -1, to: 1 }]);
  expect(isBlocked(5, 0, 0.4, w)).toBe(false);
  expect(isBlocked(5, 2, 0.4, w)).toBe(true);
  expect(isBlocked(-5, 0, 0.4, w)).toBe(true);
});
it("makeGeometry: cameraBoxes are the walls only");

// hubMap.test.ts — reachable()는 0.25 m 격자 BFS: bounds 안에서 !isBlocked(x, z, PLAYER_RADIUS, geo.obstacles)
it("gated: from the spawn nothing outside the hall is reachable", () => {
  const r = reachable(hubGeometry(false), HUB_SPAWN);
  expect(r.every((p) => inside(HALL, p))).toBe(true);
  expect(r.some((p) => inside(TEAM_ZONE, p))).toBe(true);
});
it("open: every door pad centre is reachable and nothing outside hall ∪ corridor", () => {
  const r = reachable(hubGeometry(true), HUB_SPAWN);
  for (const d of HUB_DOORS) expect(hasNear(r, centre(d.pad), 0.25)).toBe(true);
  expect(r.every((p) => inside(HALL, p) || inside(EAST_CORRIDOR, p))).toBe(true);
});
it("pads sit inside the corridor (inset PLAYER_RADIUS), are disjoint, and doorAtPad maps their centres");
it("doorAtPad on the corridor centre line is null");
it("spawn disk and TEAM_ZONE are clear in both geometries");
it("hubGeometry returns the same object every call (no allocation)", () =>
  expect(hubGeometry(true)).toBe(hubGeometry(true)));

// counselMap.test.ts
it("room is sealed: everything reachable from the spawn is inside COUNSEL_ROOM");
it("anchors: unique ids, ≥ 1.0 m apart, inside COUNSEL_ROOM inset 0.6, not blocked");
it("spawn disk is clear; every visual node starts with 'obj__'");
it("ROOM_MAPS.counsel points at the counsel geometry, anchors and visuals");
```

- [ ] **Step 2: 실패 확인.** `npm run test -w shared` → 새 테스트 FAIL(모듈 없음).
- [ ] **Step 3: 구현.** 생성물 두 파일 머리에 `// GENERATED by scripts/extract-colliders.ts — 손으로 고치지 않는다`를 적는다. `HUB_WALLS`에서 복도 북·남 벽은 홀 동쪽 벽과 겹쳐도 된다(겹침이 봉인을 보장한다). `LEGACY_GEOMETRY`는 기존 상수를 묶기만 한다.
- [ ] **Step 4: 통과 확인.** `npm run test -w shared && npm run typecheck` PASS.
- [ ] **Step 5: 커밋.** `feat: 학교 지도·반 코드·윤리 원칙 공용 데이터 (방탈출 1단계 Task 1)`

---

# 1부: 서버

### Task 2: `PlayerRoom` 추출 + 기하·좌석 인자

**Files:**
- Create: `server/src/rooms/PlayerRoom.ts`
- Modify: `server/src/rooms/WorldRoom.ts`, `server/src/rooms/movement.ts`, `server/src/rooms/seating.ts`
- Test: `server/src/rooms/movement.test.ts`, `server/src/rooms/seating.test.ts`(케이스 추가), `server/src/rooms/WorldRoom.integration.test.ts`(변경 없이 통과)

**Interfaces:**
- Consumes: `MapGeometry`, `LEGACY_GEOMETRY`(Task 1), 기준선의 `handleJump`/`handleTyping` 규칙.
- Produces:

```ts
// movement.ts / seating.ts — 기본값이 지금 동작이라 기존 호출부는 그대로
export function validateMove(current: { x: number; z: number }, payload: unknown, elapsedMs: number,
  geo?: MapGeometry /* = LEGACY_GEOMETRY */): MovePayload | null;
export function validateSit(player: { x: number; z: number; seatIndex: number }, payload: unknown,
  occupancy: ReadonlyMap<number, string>, sessionId: string,
  seats?: readonly Seat[] /* = SEATS */): { seatIndex: number } | { reason: string } | null;

// PlayerRoom.ts
export interface PlayersState { players: MapSchema<Player> }
export interface Tracking { lastAcceptedAt: number; rate: RateWindow; chatRate: RateWindow; emojiRate: RateWindow;
  jumpRate: RateWindow; typingRate: RateWindow; typing: boolean }
export abstract class PlayerRoom<S extends PlayersState> extends Room<{ state: S }> {
  protected readonly tracking: Map<string, Tracking>;
  protected registerPlayerMessages(): void;                 // Move, Chat, Emoji, Jump, Typing
  protected seatPlayer(client: Client, player: Player): void; // state.players.set + Tracking 생성
  protected unseatPlayer(sessionId: string): void;          // state·tracking 삭제
  protected abstract geometry(): MapGeometry;
  protected abstract spawnPosition(): { x: number; z: number };
  protected canMove(player: Player): boolean;               // 기본 true. false면 Move·Jump를 조용히 버림
  protected afterMove(client: Client, player: Player, track: Tracking, now: number): void; // 기본 없음
  protected deliverChat(client: Client, player: Player, text: string): void; // 기본 broadcast(Chat, { sid, name, text })
  protected reconnectWindowSeconds(): number;               // CV_RECONNECT_WINDOW_S 유지
  onDrop(client: Client, code?: number): void;              // 기존 규칙(킥이면 창 없음)
  onReconnect(client: Client): void;
  protected now(): number;
}
export function spawnInDisk(cx: number, cz: number, radius: number, geo: MapGeometry): { x: number; z: number }; // bounds 안으로 자름
```

- 규칙: `WorldRoom`의 공개 동작은 바뀌지 않는다. 바뀌는 것은 코드 위치뿐이다. `WorldRoom`은 `geometry() → LEGACY_GEOMETRY`, `canMove → seatIndex < 0`, `afterMove → judgeMaze`, 좌석·미로·관리자·공지·킥·denySet을 그대로 가진다. 점프의 "앉아 있으면 버림"은 `canMove`가 false면 버림으로 일반화한다.

- [ ] **Step 1: 실패하는 테스트 작성.**

```ts
// movement.test.ts
const BOX: MapGeometry = { id: "counsel", bounds: { minX: -6, maxX: 6, minZ: -5, maxZ: 5 },
  obstacles: [{ minX: 1, maxX: 2, minZ: -1, maxZ: 1 }], cameraBoxes: [] };
it("clamps into the given geometry's bounds", () =>
  expect(validateMove({ x: 5.5, z: 0 }, { x: 5.9, z: 0, yaw: 0 }, 100, BOX)).toEqual({ x: 6 - PLAYER_RADIUS, z: 0, yaw: 0 }));
it("drops a move into the given geometry's obstacle", () =>
  expect(validateMove({ x: 0.3, z: 0 }, { x: 0.8, z: 0, yaw: 0 }, 100, BOX)).toBeNull());
it("without geo it is the legacy map (same verdicts as before)");
// seating.test.ts
it("an empty seat list accepts no Sit", () =>
  expect(validateSit({ x: SEATS[0].x, z: SEATS[0].z, seatIndex: -1 }, { seatIndex: 0 }, new Map(), "a", [])).toBeNull());
```

- [ ] **Step 2: 실패 확인.** `npm run test -w server -- movement seating` → 새 케이스 FAIL.
- [ ] **Step 3: 구현.** 순수 함수 인자 추가 → `PlayerRoom`으로 공통 핸들러·추적·재접속 이동 → `WorldRoom`은 훅만 덮어쓴다.
- [ ] **Step 4: 통과 확인.** `npm run test -w server` PASS. 특히 `WorldRoom.integration.test.ts`가 한 줄도 고치지 않은 채 통과해야 한다. `npm run typecheck` PASS.
- [ ] **Step 5: 커밋.** `refactor: 공통 PlayerRoom 추출, 이동·좌석 검증에 지도 인자 (방탈출 1단계 Task 2)`

### Task 3: 한국어 비속어 필터 + 채팅 경로

**Files:**
- Create: `server/src/rooms/profanity.ts`, Test: `server/src/rooms/profanity.test.ts`
- Modify: `server/src/rooms/PlayerRoom.ts`(채팅 경로), Test: `server/src/rooms/WorldRoom.integration.test.ts`(케이스 1개 추가)

**Interfaces:**
- Consumes: `stripControl`(chat.ts), `PlayerRoom`(Task 2).
- Produces:

```ts
export type ProfanityResult = { ok: true } | { ok: false; masked: string };
export function checkProfanity(text: string): ProfanityResult;
export function foldHangul(word: string): string; // 테스트용 공개
export const CHAT_NOT_NICE = "고운 말로 다시 써 볼까요?";
// PlayerRoom
protected onChatBlocked(client: Client, player: Player, masked: string): void; // 기본 없음, ClassRoom·EscapeRoom이 선생님 보기로 넘김
```

- 채팅 경로(바인딩 순서): 자리 확인 → 빈도 제한(기존 문구) → `sanitizeChat` → `checkProfanity`. 걸리면 보낸 사람에게만 `MessageType.ChatRejected { reason: CHAT_NOT_NICE }`를 보내고 `onChatBlocked`를 부른 뒤 broadcast하지 않는다. 지금 월드·반 홀·교실 모두에 적용한다(spec은 팀 채팅만 말하지만 같은 아이들이 쓰는 공간이다). `track.typing = false`는 통과·차단 모두에서 한다.
- 정규화 알고리즘(바인딩): 단어 단위로 본다. 띄어 쓴 한 글자들은 이어 붙인다("시 발" → "시발")만, 두 글자 이상 단어끼리는 붙이지 않는다("도시 발전"을 지키기 위해). 한글은 음절마다 `초성(된소리만 예사소리로)·모음 7갈래·종성(ㄲ·ㅆ만 접음)` 토큰으로 바꿔 `|`로 잇는다. 거센소리·종성 대표음은 접지 않는다("좋아"≠"좆", "평신도"≠"병신").

```ts
const CHO = "ㄱㄱㄴㄷㄷㄹㅁㅂㅂㅅㅅㅇㅈㅈㅊㅋㅌㅍㅎ";                  // 19 초성, 된소리 → 예사소리
const JUNG = "aeaeveveoaeeouveiuwii";                              // 21 중성 → a e v o u w i
const JONG = "_ㄱㄱㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅅㅇㅈㅊㅋㅌㅍㅎ";  // 28 종성, ㄲ·ㅆ만 접음
const JAMO_FOLD: Record<string, string> = { ㄲ: "ㄱ", ㄸ: "ㄷ", ㅃ: "ㅂ", ㅆ: "ㅅ", ㅉ: "ㅈ", ㅄ: "ㅂ|ㅅ" };
const WORDS = ["시발", "씨발", "시팔", "씨팔", "시바", "병신", "븅신", "좆", "존나", "졸라", "지랄", "개새끼",
  "엠창", "느금", "미친놈", "미친년", "또라이", "ㅅㅂ", "ㅂㅅ", "ㅈㄴ", "ㅈㄹ", "ㄱㅅㄲ", "ㅗ"];
const ALLOW = ["시발점", "시발역", "시바견", "시바이누"];
const LATIN = ["sibal", "sival", "shibal", "fuck", "fuk", "shit", "bitch"];
const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", $: "s", "!": "i" };
const CHO_JAMO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";

export function foldHangul(word: string): string {
  const out: string[] = [];
  for (const ch of word) {
    const c = ch.codePointAt(0)!;
    if (c >= 0xac00 && c <= 0xd7a3) {
      const i = c - 0xac00;
      const cho = CHO[Math.floor(i / 588)], v = JUNG[Math.floor((i % 588) / 28)], jong = JONG[i % 28];
      const prev = out[out.length - 1];
      if (cho === "ㅇ" && jong === "_" && prev?.length === 3 && prev[1] === v) continue; // "시이이발" → "시발"
      out.push(cho + v + jong);
    } else if (c >= 0x3131 && c <= 0x314e) out.push(JAMO_FOLD[ch] ?? ch);
    else if (ch === "ㅗ") out.push("ㅗ");
  }
  return out.length ? `|${out.join("|")}|` : "";
}
const variants = (w: string): string[] => { // "시발" → ["시발", "ㅅ발"]
  const c = w.codePointAt(0)!;
  return c >= 0xac00 && c <= 0xd7a3 ? [w, CHO_JAMO[Math.floor((c - 0xac00) / 588)] + w.slice(1)] : [w];
};
const PATTERNS = [...new Set(WORDS.flatMap(variants).map(foldHangul))];
const ALLOW_F = ALLOW.map(foldHangul);
const normalize = (s: string) => s.normalize("NFC") // NFKC 금지: 호환 자모(ㅅ)를 조합형으로 바꿔 버린다
  .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0)).toLowerCase();
function units(text: string): string[] {
  const out: string[] = [];
  let run = "";
  for (const w of normalize(text).split(/\s+/).filter(Boolean)) {
    if ([...w.replace(/[^\p{L}]/gu, "")].length <= 1) { run += w; continue; } // 글자 0~1개짜리 조각은 이어 붙임
    if (run) { out.push(run); run = ""; }
    out.push(w);
  }
  if (run) out.push(run);
  return out;
}
export function checkProfanity(text: string): ProfanityResult {
  let hit = false;
  const masked = units(stripControl(text)).map((w) => {
    let f = foldHangul(w);
    for (const a of ALLOW_F) f = f.split(a).join("|");
    const latin = [...w].map((ch) => LEET[ch] ?? ch).join("").replace(/[^a-z]/g, "").replace(/(.)\1+/g, "$1");
    const bad = PATTERNS.some((p) => f.includes(p)) || LATIN.some((p) => latin.includes(p));
    if (bad) hit = true;
    return bad ? "●".repeat(Math.min([...w].length, 6)) : w;
  }).join(" ");
  return hit ? { ok: false, masked } : { ok: true };
}
```

- [ ] **Step 1: 실패하는 테스트 작성.**

```ts
const BAD = ["시발", "씨발", "씨1발", "시.발", "시 발", "시이이발", "쉬발", "씨팔", "ㅅㅂ", "ㅆㅂ", "ㅅ발", "ㅄ",
  "병신", "븅신", "좆", "존나 웃겨", "개새끼", "게세끼", "sibal", "s1bal", "f u c k", "SHIT", "ｆｕｃｋ", "ㅗ"];
const GOOD = ["좋아", "상자", "평신도", "시발점", "도시 발전", "시 발표 했어", "수박", "사발면", "시바견 귀여워",
  "새끼 고양이", "발표 시작해요", "ㅋㅋㅋ", "안녕 반가워"];
it.each(BAD)("blocks %s", (t) => expect(checkProfanity(t).ok).toBe(false));
it.each(GOOD)("allows %s", (t) => expect(checkProfanity(t)).toEqual({ ok: true }));
it("masks only the offending word for the teacher view", () =>
  expect(checkProfanity("너 진짜 시발 왜 그래")).toEqual({ ok: false, masked: "너 진짜 ●● 왜 그래" }));
it("foldHangul folds fortis and elongation but keeps aspirates and finals", () => {
  expect(foldHangul("씨발")).toBe(foldHangul("시발"));
  expect(foldHangul("좋")).not.toBe(foldHangul("좆"));
});
// WorldRoom.integration.test.ts
it("a profane chat is not broadcast; the sender gets CHAT_NOT_NICE");
```

- [ ] **Step 2: 실패 확인.** `npm run test -w server -- profanity` → FAIL.
- [ ] **Step 3: 구현.** 위 본문 그대로 + `PlayerRoom` 채팅 경로.
- [ ] **Step 4: 통과 확인.** `npm run test -w server && npm run typecheck` PASS.
- [ ] **Step 5: 커밋.** `feat: 한국어 비속어 필터 — 띄어쓰기·숫자·된소리·늘여 쓰기 우회 대응 (방탈출 1단계 Task 3)`

### Task 4: 선생님 키 · 반 코드 · 반 등록부 · HTTP · 생성 토큰

**Files:**
- Create: `server/src/rooms/spawnToken.ts`, `server/src/class/teacherKeys.ts`, `server/src/class/classCode.ts`, `server/src/class/classRegistry.ts`, `server/src/class/classApi.ts`
- Create: `scripts/teacher-key.mjs`
- Modify: `server/src/index.ts`(`mountClassApi(app)`를 SPA 폴백보다 앞에), `.gitignore`(`server/teacher-keys.json`, `teacher-keys*.json`, `!e2e/fixtures/teacher-keys.e2e.json`), `docs/deploy.md`(새 절 "선생님 키 발급")
- Test: `server/src/rooms/spawnToken.test.ts`, `server/src/class/teacherKeys.test.ts`, `classCode.test.ts`, `classRegistry.test.ts`, `classApi.test.ts`

**Interfaces:**
- Consumes: `compareAdminCode`, `AdminAttemptLimiter`(adminAuth.ts), `resolveClientIp`, `CLASS_CODE_ALPHABET`, `normalizeClassCode`, `MAX_CLASSES_DEFAULT`, `TEACHER_PASS_TTL_MS`.
- Produces:

```ts
// spawnToken.ts — 부팅마다 새로 만드는 비밀. 클라이언트의 matchmake `create`/`joinOrCreate`를 막는다.
export const SPAWN_TOKEN: string;                       // randomBytes(24).toString("base64url")
export function assertSpawnToken(options: unknown): void; // 맞지 않으면 throw new Error("잘못된 접근이에요")

// teacherKeys.ts — 파일: { "keys": [{ "id", "label", "group"?, "sha256" }] }
export interface TeacherKeyEntry { id: string; label: string; group?: string; sha256: string }
export interface VerifiedKey { id: string; label: string; group: string; operator: boolean }
export function loadTeacherKeys(path?: string): TeacherKeyEntry[]; // TEACHER_KEYS_FILE ?? "server/teacher-keys.json", 없으면 [], 잘못된 항목은 건너뜀. 호출마다 다시 읽음
export function hashKey(key: string): string;                      // trim 후 sha256 hex
export function verifyTeacherKey(provided: unknown, entries: readonly TeacherKeyEntry[], operatorCode: string | undefined): VerifiedKey | null;
// 운영자 키(ADMIN_CODE)는 { id: "operator", label: "운영자", group: "*", operator: true }
export function canTeach(key: VerifiedKey, opener: { id: string; group: string }): boolean; // operator || 같은 id || (빈 문자열 아닌) 같은 group

// classCode.ts (server)
export function generateClassCode(taken: (code: string) => boolean, rand?: (n: number) => number /* crypto.randomInt */): string;

// classRegistry.ts — 이 프로세스 하나의 반 목록(단일 서버 전제)
export interface ClassCreateOptions { spawnToken: string; classCode: string; textLevel: TextLevel;
  opener: { id: string; group: string; label: string } }   // matchMaker.createRoom(CLASS_ROOM, …) 옵션, Task 5가 받음
export interface ClassEntry { code: string; roomId: string | null; opener: { id: string; group: string; label: string };
  textLevel: TextLevel; openedAt: number }
export class ClassRegistry {
  constructor(maxClasses?: number /* CV_MAX_CLASSES ?? MAX_CLASSES_DEFAULT */);
  reserve(entry: Omit<ClassEntry, "roomId">): "ok" | "taken" | "full";
  attach(code: string, roomId: string, entry?: Omit<ClassEntry, "roomId">): void; // 없으면 만든다(테스트 경로)
  release(code: string): void;
  get(code: string): ClassEntry | undefined;
  list(): readonly ClassEntry[];
  issuePass(code: string, key: VerifiedKey, now: number): string;                  // 32바이트 base64url, TTL TEACHER_PASS_TTL_MS
  consumePass(pass: unknown, code: string, now: number): VerifiedKey | null;        // 1회용, 다른 반 코드면 null
}
export const classRegistry: ClassRegistry;

// classApi.ts
export interface ApiResult { status: number; body: Record<string, unknown> }
export interface TeacherOpenDeps { registry: ClassRegistry; keys: () => TeacherKeyEntry[]; operatorCode: () => string | undefined;
  createClassRoom: (opts: ClassCreateOptions) => Promise<{ roomId: string }>; limiter: AdminAttemptLimiter; now: () => number }
export async function handleTeacherOpen(body: unknown, ip: string, deps: TeacherOpenDeps): Promise<ApiResult>;
export interface StatusDeps { registry: ClassRegistry; operatorCode: () => string | undefined; limiter: AdminAttemptLimiter;
  roomStats: (roomId: string) => { phase: string; players: number; teams: number; escapeRooms: number } | null; // matchMaker.getLocalRoomById로 읽음
  processStats: () => { rssMB: number; heapMB: number; cpuPct: number; eventLoopP95Ms: number; uptimeS: number } }
export function handleOperatorStatus(body: unknown, ip: string, deps: StatusDeps): ApiResult;
export function mountClassApi(app: Express): void; // POST /api/class/teacher, POST /api/operator/status, /api 전용 오류 미들웨어(로그 없음)
```

`POST /api/class/teacher` 본문 `{ teacherKey: string; classCode?: string; textLevel?: "easy" | "hard" }`:

| 경우 | 응답 |
|---|---|
| 키가 맞고 `classCode` 없음 | 새 반을 만든다 → 200 `{ classCode, pass }` |
| `classCode`의 반이 있고 `canTeach` | 그 반의 입장권 → 200 `{ classCode, pass }` |
| `classCode`의 반이 없음(서버 재시작 뒤) | 그 코드로 다시 연다 → 200 |
| 그 반이 다른 그룹 것 | 409 `{ error: "이 반 코드는 다른 선생님이 쓰고 있어요" }` |
| 키가 틀림 | 401 `{ error: "선생님 키가 올바르지 않아요" }`, 실패 기록 |
| IP당 1분에 5번 실패 | 429 `{ error: "시도가 너무 많아요. 1분 뒤에 다시 해 주세요" }` |
| 반 수가 한도 | 503 `{ error: "지금은 반을 더 열 수 없어요. 잠시 뒤에 다시 해 주세요" }` |
| 본문이 이상함(JSON 오류 포함) | 400 `{ error: "요청이 올바르지 않아요" }` — 로그 없음 |

`POST /api/operator/status` 본문 `{ operatorKey }` → 200 `{ classes: [{ code, label, phase, players, teams, escapeRooms }], totals: { classes, players, escapeRooms }, process: { rssMB, heapMB, cpuPct, eventLoopP95Ms, uptimeS } }`. `cpuPct`는 직전 호출 이후 `process.cpuUsage()` 증가분 ÷ 경과 시간, `eventLoopP95Ms`는 `perf_hooks.monitorEventLoopDelay`. 입장권·키 해시는 절대 담지 않는다. 1단계에서 운영자 "화면"은 이 JSON이다(화면은 3단계 현황판과 함께).

`scripts/teacher-key.mjs --id <id> --label <이름> [--group <그룹>] [--file server/teacher-keys.json]`: `CLASS_CODE_ALPHABET`에서 `crypto.randomInt`로 `XXXX-XXXX-XXXX-XXXX` 키를 만들고, 파일에는 `sha256`만 덧붙인다. 키 원문은 운영자 터미널에 한 번만 출력하고 "이 키는 다시 볼 수 없어요. 선생님께 안전하게 전달하세요."를 함께 출력한다.

- [ ] **Step 1: 실패하는 테스트 작성.**

```ts
const KEY = "K7QX-2MPA-9TRW-4HEZ";
const ENTRIES = [{ id: "t1", label: "새빛초 4-2", group: "saebit", sha256: hashKey(KEY) }];
it("verifies by sha256 and ignores surrounding spaces", () =>
  expect(verifyTeacherKey(` ${KEY} `, ENTRIES, undefined)).toEqual({ id: "t1", label: "새빛초 4-2", group: "saebit", operator: false }));
it("rejects wrong, empty and non-string keys; an unset operator code never matches");
it("the operator code verifies as operator", () =>
  expect(verifyTeacherKey("op-s3cret", ENTRIES, "op-s3cret")?.operator).toBe(true));
it("canTeach: operator, same id, same non-empty group only");
it("loadTeacherKeys: missing file → [], malformed entries skipped"); // os.tmpdir()에 임시 파일
it("generateClassCode uses only the alphabet and skips taken codes");
it("registry: reserve/attach/release, 'taken' and 'full'");
it("passes are single-use, expire after TEACHER_PASS_TTL_MS and are bound to one class", () => {
  const p = reg.issuePass("AB2CDE", key, 0);
  expect(reg.consumePass(p, "ZZ3ZZZ", 1)).toBeNull();
  expect(reg.consumePass(p, "AB2CDE", 1)?.id).toBe("t1");
  expect(reg.consumePass(p, "AB2CDE", 2)).toBeNull();
});
it("handleTeacherOpen: new class → 200 {classCode, pass}; createClassRoom got spawnToken and opener");
it("re-opening with the same classCode returns a pass for the existing class (same group) and re-creates it after a restart (Review Focus 5)");
it("409 other group, 401 wrong key, 429 after 5 failures per IP per minute, 503 at the cap");
it("operator status requires the operator key and never contains pass or sha256 strings");
it("malformed JSON carrying a key is answered 400 and nothing reaches console", async () => {
  // express 앱을 port 0으로 띄우고 fetch('/api/class/teacher', { body: '{"teacherKey":"K7QX-2MPA-9TRW-4HEZ"' })
  // console.log/info/warn/error/debug 스파이의 모든 인자를 이어 붙인 문자열에 KEY가 없다
});
it("assertSpawnToken accepts only SPAWN_TOKEN");
```

- [ ] **Step 2: 실패 확인.** `npm run test -w server -- teacherKeys classCode classRegistry classApi spawnToken` → FAIL.
- [ ] **Step 3: 구현.** `createClassRoom`의 실제 구현은 `matchMaker.createRoom(CLASS_ROOM, { spawnToken: SPAWN_TOKEN, classCode, textLevel, opener })`다(Task 5가 방을 등록). 그 전까지 `classApi.test.ts`는 가짜 deps로 돈다.
- [ ] **Step 4: 통과 확인.** `npm run test -w server && npm run typecheck` PASS. `node scripts/teacher-key.mjs --id t-test --label 테스트 --file <scratchpad>/k.json` → 파일에 sha256만 있고 원문이 없다.
- [ ] **Step 5: 커밋.** `feat: 선생님 키(해시 저장)·반 코드·반 등록부·운영자 상태 API (방탈출 1단계 Task 4)`

### Task 5: `ClassRoom` — 반 공간, 입장, 진행 단계, 닫힘

**Files:**
- Modify: `shared/src/schema.ts`(`Player.teamId`, `Player.place`, `Team`, `ClassState`), Test: `shared/src/schema.smoke.test.ts`
- Create: `shared/src/escape/messages.ts`
- Create: `server/src/class/ClassRoom.ts`, `server/src/class/classPhase.ts`, `server/src/class/nickname.ts`
- Modify: `server/src/rooms/index.ts`(`[CLASS_ROOM]: defineRoom(ClassRoom).filterBy(["classCode"])`), `server/src/class/classApi.ts`(실제 `createClassRoom`)
- Test: `server/src/class/classPhase.test.ts`, `nickname.test.ts`, `server/src/class/ClassRoom.integration.test.ts`

**Interfaces:**
- Consumes: `PlayerRoom`·`spawnInDisk`(Task 2), `checkProfanity`(Task 3), `classRegistry`·`ClassCreateOptions`, `assertSpawnToken`, `canTeach`(Task 4), `hubGeometry`, `HUB_SPAWN`(Task 1), stage 3 `validateJoinOptions`, `sanitizeAnnounce`, `DenySet`.
- Produces:

```ts
// schema.ts
// Player: @type("string") teamId = "";  @type("uint8") place = 0; // PLACE_HUB | PLACE_ESCAPE
export class Team extends Schema {
  @type("string") id = ""; @type("uint8") nameIndex = 0; @type("uint8") colorIndex = 0;
  @type(["string"]) members = new ArraySchema<string>();      // ClassRoom sessionId들
  @type("string") escapeRoomId = ""; @type("string") escapeDoor = ""; // 들어가 있는 교실 인스턴스
  @type(["string"]) escaped = new ArraySchema<string>();      // 탈출한 RoomId
  @type({ map: "uint8" }) stars = new MapSchema<number>();    // RoomId → 별
  @type("string") padDoor = ""; @type("string") padLeaderSid = ""; @type("uint8") padCount = 0;
}
export class ClassState extends WorldState {
  @type("string") classCode = ""; @type("string") phase = "lobby"; @type("string") textLevel = "easy";
  @type({ map: Team }) teams = new MapSchema<Team>();
  @type(["string"]) openRooms = new ArraySchema<string>();   // 1단계: ["counsel"]
  @type(["string"]) litRooms = new ArraySchema<string>();    // 학교 모형에서 환해진(해결한) 교실
}

// shared/src/escape/messages.ts — 값 앞머리 c_/x_로 기존 MessageType과 겹치지 않게
export const ClassMsg = { TeamCreate: "c_team_create", TeamJoin: "c_team_join", TeamLeave: "c_team_leave",
  TeamAuto: "c_team_auto", Command: "c_command", EnterRoom: "c_enter", EscapeRejoin: "c_rejoin",
  ResultsRequest: "c_results", EscapeTicket: "c_ticket", Notice: "c_notice", TeamChatMirror: "c_chat_mirror",
  ResultsCsv: "c_results_csv" } as const;
export interface CommandPayload { cmd: ClassCommand }
export interface NoticePayload { text: string }
export interface TeamCreatePayload { nameIndex: number; colorIndex: number }
export interface TeamJoinPayload { teamId: string }
export interface TeamAutoPayload { mode: "fill" | "shuffle" }
export interface EnterRoomPayload { room: RoomId }
export interface EscapeTicketPayload { roomId: string; ticket: string }
export interface TeamChatMirrorPayload { teamId: string; teamName: string; name: string; text: string; filtered: boolean; at: number }
export interface ResultsCsvPayload { csv: string }
export interface ClassPayloads { /* ClassMsg 값 → 위 타입 */ }
// EscapeMsg와 그 페이로드는 Task 10에서 같은 파일에 더한다

// classPhase.ts
export function nextPhase(p: ClassPhase, cmd: ClassCommand): ClassPhase | null;
// lobby-start→running, running-pause→paused, paused-resume→running, (ended 말고 전부)-end→ended, 나머지 null

// nickname.ts
export function nicknameKey(n: string): string; // NFC, trim, 연속 공백 하나로, 소문자
export type NickDecision = { kind: "new" } | { kind: "takeover"; sid: string } | { kind: "taken" };
export function decideNickname(existing: readonly { sid: string; key: string; connected: boolean }[], key: string): NickDecision;

// ClassRoom.ts — onCreate(options: ClassCreateOptions)
export class ClassRoom extends PlayerRoom<ClassState> { /* 아래 규칙 */ }
```

ClassRoom 규칙(바인딩):
- `onCreate`: `assertSpawnToken` → `normalizeClassCode` 실패면 throw → `classRegistry.attach(code, roomId, entry)` → `autoDispose = false`, `maxClients = MAX_CLIENTS`, `openRooms = PHASE1_OPEN_ROOMS`. `onDispose`: 등록부 `release`.
- join 옵션 `{ classCode, nickname, …외형 15필드, teacherPass? }`:
  1. stage 3 `validateJoinOptions` 실패 → 그 오류.
  2. `normalizeClassCode(options.classCode) !== this.state.classCode` → "반 코드를 확인해 주세요".
  3. phase가 `ended` → "수업이 끝났어요".
  4. 닉네임이 `checkProfanity`에 걸림 → "다른 닉네임을 써 주세요".
  5. `decideNickname`이 `taken` → "이 반에 같은 닉네임이 있어요. 다른 닉네임을 써 주세요." `takeover`면 유령 플레이어를 지우고, 그 `teamId`·팀 멤버 자리를 새 sid로 옮긴다(Task 11이 교실 복귀를 덧붙인다).
  6. `teacherPass`가 있으면 `consumePass(pass, code, now)` + `canTeach(key, opener)` → `role = ROLE_TEACHER`. 실패하면 "선생님 입장권이 만료됐어요. 다시 반 열기를 눌러 주세요"(IP당 실패 제한 적용).
  7. 스폰은 `spawnInDisk(HUB_SPAWN.x, HUB_SPAWN.z, HUB_SPAWN_JITTER, geometry())`.
- `geometry()`: phase가 `running`/`paused`면 `hubGeometry(true)`, 아니면 `hubGeometry(false)`.
- `ClassMsg.Command`: 선생님만. `nextPhase`가 null이면 무시. 바뀌면 `state.phase`를 쓰고 `MessageType.System`으로 알린다: start "복도 문이 열렸어요! 팀과 함께 교실로 가 보세요.", pause "선생님이 잠시 멈췄어요.", resume "다시 시작해요!", end "수업이 끝났어요. 함께해 줘서 고마워요!". end면 `lock()` 후 `CLASS_END_GRACE_MS` 뒤 모두를 `CLASS_CLOSED_CODE`로 내보내고 `disconnect()`.
- 빈 반: 마지막 클라이언트가 나가면 `CLASS_EMPTY_CLOSE_MS` 타이머, 누가 들어오면 취소. 만료 → `disconnect()`.
- 시험 전용 환경변수(기존 `CV_*` 방식과 같다): `CV_CLASS_END_GRACE_MS`, `CV_CLASS_EMPTY_CLOSE_MS`.
- 공지·킥: 선생님(role 1)만. 기존 `sanitizeAnnounce`·`DenySet` 규칙 그대로.
- `onChatBlocked`·`deliverChat` 경로의 선생님 보기는 Task 11에서 붙인다(홀 채팅은 모두가 보는 공개 채팅이다).

- [ ] **Step 1: 실패하는 테스트 작성.**

```ts
// schema.smoke.test.ts
it("ClassState round-trips teams, litRooms and Player.place/teamId");
// classPhase.test.ts
it("allows only the spec transitions", () => {
  expect(nextPhase("lobby", "start")).toBe("running");
  expect(nextPhase("lobby", "pause")).toBeNull();
  expect(nextPhase("paused", "resume")).toBe("running");
  expect(nextPhase("running", "end")).toBe("ended");
  expect(nextPhase("ended", "start")).toBeNull();
});
// nickname.test.ts
it("normalizes case/spacing and decides new / takeover(ghost) / taken(active)");
// ClassRoom.integration.test.ts — 같은 파일 안에서 boot 1번(기존 테스트 주석의 이유)
it("refuses creation without the spawn token; a client cannot create a class via matchmaking");
it("join by classCode lands only in that class (filterBy)");
it("rejects a mismatched code, a profane nickname, an ended class with Korean errors");
it("teacherPass gives ROLE_TEACHER once; reuse or another class's pass fails");
it("an active duplicate nickname is rejected");
it("takes over a disconnected ghost: one player, new sid, same teamId (Review Focus 1)");
it("only teachers change phase; the east gate drops moves before start and accepts them after");
it("end: locks, broadcasts the end notice, closes everyone with CLASS_CLOSED_CODE after the grace, releases the registry");
it("an empty class disposes after CLASS_EMPTY_CLOSE_MS; a join in between cancels it");
it("announce/kick: teacher only");
```

- [ ] **Step 2: 실패 확인.** `npm run test -w server -- ClassRoom classPhase nickname && npm run test -w shared` → FAIL.
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 통과 확인.** `npm run test && npm run typecheck` PASS.
- [ ] **Step 5: 커밋.** `feat: 반별 ClassRoom — 반 코드 입장, 선생님 입장권, 같은 닉네임 이어받기, 시작·일시정지·종료 (방탈출 1단계 Task 5)`

### Task 6: 팀 만들기 · 자동 배정 · 문 앞 대기 칸 상태

**Files:**
- Create: `server/src/class/teams.ts`, Test: `server/src/class/teams.test.ts`
- Modify: `server/src/class/ClassRoom.ts`(팀 메시지, 대기 칸 추적), Test: `server/src/class/ClassRoom.integration.test.ts`(describe `teams`)

**Interfaces:**
- Consumes: `TEAM_*`, `TEAM_NAMES`, `TEAM_COLORS`, `inTeamZone`, `doorAtPad`(Task 1), `Team`, `ClassMsg`(Task 5).
- Produces:

```ts
export interface TeamRec { id: string; nameIndex: number; colorIndex: number; members: string[]; inEscape: boolean }
export type TeamError = { error: string };
export function createTeam(teams: readonly TeamRec[], sid: string, nameIndex: number, colorIndex: number, newId: string): TeamRec | TeamError;
export function joinTeam(team: TeamRec, sid: string): TeamError | null;
export function leaveTeam(team: TeamRec, sid: string): { empty: boolean };
export function partitionSizes(n: number, target?: number, min?: number, max?: number): number[];
export interface TeamPlan { joins: { teamId: string; sid: string }[]; creates: { nameIndex: number; colorIndex: number; members: string[] }[];
  dissolve: string[] }
export function autoAssign(teams: readonly TeamRec[], loose: readonly string[], mode: "fill" | "shuffle", rng: () => number): TeamPlan;
export function freeCombos(teams: readonly TeamRec[]): { nameIndex: number; colorIndex: number }[]; // 안 쓴 (이름, 색) 순서대로
export interface PadPresence { sid: string; door: RoomId | null; arrivedAt: number }
export function teamPadStatus(members: readonly PadPresence[]): { door: RoomId | ""; leaderSid: string; count: number };
export function teamDisplayName(nameIndex: number, colorIndex: number): string; // "햇살(파랑)"
```

- 오류 문구: "이미 팀에 있어요. 먼저 팀에서 나와 주세요", "이미 있는 팀 이름과 색이에요", "팀이 가득 찼어요 (최대 6명)", "팀을 더 만들 수 없어요".
- `partitionSizes(n)`: n < 2면 `[]`. k = max(1, round(n / target)). ceil(n/k) > max면 k를 늘린다. 크기는 floor(n/k)에 앞에서부터 나머지만큼 +1.
- `autoAssign` fill: 팀 없는 학생을 먼저 교실 밖(`!inEscape`)이고 덜 찬 팀에 작은 팀부터 `TEAM_TARGET`까지 넣는다. 남으면 `partitionSizes`로 새 팀을 만든다. 1명만 남으면 `TEAM_MAX` 아래인 가장 작은 팀에 넣고, 그런 팀이 없으면 남겨 둔다. shuffle: 교실 밖 팀을 모두 풀고 그 사람들과 팀 없는 학생을 `rng`로 섞어 `partitionSizes`대로 다시 만든다. 교실 안 팀은 건드리지 않는다.
- `teamPadStatus`: 대기 칸 위의 연결된 홀 멤버만 센다. 가장 많이 모인 문(같으면 먼저 온 사람이 있는 문), 그 문에 가장 먼저 온 사람이 `leaderSid`(spec §14 "먼저 모인 사람").
- ClassRoom: `TeamCreate`·`TeamJoin`은 보낸 사람이 `inTeamZone`일 때만, 선생님은 불가, 교실 안(`place = 1`)이면 불가. 실패하면 `ClassMsg.Notice`. `TeamAuto`는 선생님만. 이동이 받아들여질 때마다 `doorAtPad`로 도착 시각을 기록하고(떠나면 지움), 그 팀의 `padDoor/padLeaderSid/padCount`를 다시 계산한다. 연결 끊김·퇴장·교실 입장 때도 다시 계산한다.

- [ ] **Step 1: 실패하는 테스트 작성.**

```ts
it("partitionSizes", () => {
  expect(partitionSizes(1)).toEqual([]);
  expect(partitionSizes(2)).toEqual([2]);
  expect(partitionSizes(5)).toEqual([5]);
  expect(partitionSizes(7)).toEqual([4, 3]);
  expect(partitionSizes(25)).toEqual([5, 4, 4, 4, 4, 4]);
  for (let n = 2; n <= 100; n++) {
    const s = partitionSizes(n);
    expect(s.reduce((a, b) => a + b, 0)).toBe(n);
    expect(Math.min(...s)).toBeGreaterThanOrEqual(2);
    expect(Math.max(...s)).toBeLessThanOrEqual(6);
  }
});
it("fill tops up small teams first, leaves escape teams alone, then makes new teams", () => {
  const teams = [rec("A", 2), rec("B", 4), rec("C", 6), rec("D", 3, true)];
  const plan = autoAssign(teams, ["s1", "s2", "s3", "s4", "s5"], "fill", seeded(1));
  expect(plan.joins.filter((j) => j.teamId === "A").map((j) => j.sid)).toEqual(["s1", "s2"]);
  expect(plan.creates.map((c) => c.members.length)).toEqual([3]);
  expect(plan.joins.some((j) => j.teamId === "D")).toBe(false);
});
it("fill with one loose student and only full or escape teams leaves them loose");
it("shuffle regroups everyone outside escape rooms into partitionSizes teams with fresh combos");
it("createTeam rejects a taken (name, color), a member of another team, and the 51st team");
it("teamPadStatus picks the busiest door and its earliest arrival", () =>
  expect(teamPadStatus([{ sid: "a", door: "counsel", arrivedAt: 100 }, { sid: "b", door: "counsel", arrivedAt: 50 },
    { sid: "c", door: null, arrivedAt: 0 }])).toEqual({ door: "counsel", leaderSid: "b", count: 2 }));
// integration
it("TeamCreate outside TEAM_ZONE is dropped; inside creates the team and sets teamId");
it("the 7th TeamJoin gets the full-team notice; leaving the last member deletes the team");
it("teachers cannot form teams; teacher TeamAuto applies the plan and syncs teamId");
it("pad status syncs on moves and updates when a member steps off or disconnects");
```

- [ ] **Step 2: 실패 확인.** `npm run test -w server -- teams ClassRoom` → FAIL.
- [ ] **Step 3: 구현.** 통합 테스트는 서버 상태의 x/z를 대기 칸 근처로 바꾼 뒤 작은 합법 Move 한 번으로 추적을 돌린다.
- [ ] **Step 4: 통과 확인.** `npm run test -w server && npm run typecheck` PASS.
- [ ] **Step 5: 커밋.** `feat: 팀 만들기·자동 배정·섞기와 문 앞 대기 칸 팀장 판정 (방탈출 1단계 Task 6)`

### Task 7: 퍼즐 엔진 1 — 데이터 형식, 물건·가방·자물쇠·힌트·별·게임 시계

**Files:**
- Create: `server/src/escape/types.ts`, `engine.ts`, `content.ts`, `stars.ts`, `gameClock.ts`
- Create: `server/src/escape/__fixtures__/miniRoom.ts`(엔진 시험용 작은 방)
- Modify: `shared/src/escape/messages.ts`(클라이언트도 쓰는 공개 타입: `RoomContent`, `PublicLock`, `InspectViewPayload`, `EngineEvent` — 타입만, 서버 `engine.ts`·`content.ts`가 이것을 import한다)
- Test: `server/src/escape/engine.test.ts`, `content.test.ts`, `stars.test.ts`, `gameClock.test.ts`

**Interfaces:**
- Consumes: `LOCK_SUBMIT_GAP_MS`, `HINT_GAP_MS`, `TextLevel`, `RoomId`, `PrincipleId`(Task 1).
- Produces:

```ts
// types.ts — 서버 전용. 클라이언트가 import하면 Task 25 검사가 실패한다.
export type Text = string | { easy: string; hard: string };
export type Cond = { all?: string[]; none?: string[]; items?: string[] };
export type Effect = { set: string } | { give: string } | { take: string } | { say: string };
export interface ObjectDef {
  id: string; label: string; kind: "inspect" | "switch" | "screen" | "door";
  tag?: "private" | "public";                                     // 시험·분석용 표시(상담실 쪽지)
  inspect: { title: Text; body: Text; back?: Text; image?: string;
    states?: { when: Cond; body: Text }[];                        // 조건이 맞는 첫 본문으로 바뀜
    reveal?: { item: string; text: string } };                    // 가방에 item이 있으면 보이는 층(자외선)
  pickup?: { item: string; when?: Cond };
  locks?: string[];                                               // 조건이 맞고 안 풀린 첫 자물쇠를 연다
  split?: { group: "A" | "B"; text: string; lockedText: string; when?: Cond }; // lockedText의 {owner}
}
export interface ItemDef { id: string; label: string; icon: string }
export interface ComboDef { a: string; b: string; out: string; effects?: Effect[] }
interface LockBase { id: string; objectId: string; plate: Text; requires?: Cond; onSolve: Effect[] }
export type LockDef =
  | (LockBase & { kind: "digits"; length: number; answer: string })
  | (LockBase & { kind: "letters"; wheels: string[][]; answer: string[] })
  | (LockBase & { kind: "sort"; bins: { id: string; label: string }[]; cards: { id: string; label: string }[];
      answer: Record<string, string>; needsItem?: string });
export interface CoopDef { id: string; switches: [string, string]; requires?: Cond; doneFlag: string; onSolve: Effect[] }
export interface StageDef { id: string; title: string; doneWhen: string; hints: [string, string, string] }
export interface FinaleOption { id: string; label: string; desc?: string; explain?: string }
export interface FinaleStep { id: string; prompt: Text; principleId?: PrincipleId; options: FinaleOption[]; correct: string }
export interface FinaleDef { requires: Cond; claim: Text; steps: FinaleStep[] }
export interface LineDef { speaker: "ari" | "bandit" | "narrator"; text: Text }
export interface RoomDef { id: RoomId; title: string; principleIds: PrincipleId[]; objects: ObjectDef[]; items: ItemDef[];
  combos: ComboDef[]; locks: LockDef[]; coops: CoopDef[]; stages: StageDef[]; finale: FinaleDef;
  lines: Record<string, LineDef>; introLines: string[]; escapeLines: string[];
  summary: { lines: [Text, Text, Text]; question: Text; source: string } }

// engine.ts
export interface EngineState {
  phase: "play" | "finale" | "escaped"; flags: Set<string>; bag: string[];
  lockInput: Map<string, string>;   // digits: "0000"; letters: 바퀴별 인덱스 "0000"
  board: Map<string, string>;       // cardId → binId
  lastSubmitAt: Map<string, number>; wrongAttempts: number;
  hintsUsed: number; hintTier: Map<string, number>; lastHintAt: number;
  presses: Map<string, { sid: string; at: number }>;
  hold: { coopId: string; objectId: string; sid: string; since: number } | null;
  finaleStep: number; votes: Map<string, string>; cooldownUntil: number; firstTry: Map<string, boolean>;
}
export interface EngineCtx { now: number /* 게임 시간 ms */; connected: readonly string[] /* 들어온 순서 */;
  names: ReadonlyMap<string, string>; maxHintTier: number }
export type EngineAction =
  | { t: "pickup"; sid: string; objectId: string } | { t: "combine"; sid: string; a: string; b: string }
  | { t: "input"; sid: string; lockId: string; value: string }
  | { t: "place"; sid: string; lockId: string; cardId: string; bin: string /* "" = 빼기 */ }
  | { t: "submit"; sid: string; lockId: string } | { t: "hint"; sid: string }
  | { t: "press"; sid: string; objectId: string } | { t: "holdStart"; sid: string; objectId: string }
  | { t: "holdEnd"; sid: string; objectId: string } | { t: "holdCheck" }
  | { t: "vote"; sid: string; optionId: string } | { t: "membership" };
export type EngineEvent =
  | { e: "picked"; item: string; by: string } | { e: "combined"; out: string; by: string }
  | { e: "solved"; lockId: string; by: string }
  | { e: "wrong"; lockId: string; wrongCount?: number; unplaced?: number }
  | { e: "say"; lineId: string }
  | { e: "hint"; stageId: string; tier: number; text: string } | { e: "hintWait"; waitS: number } | { e: "hintMax" }
  | { e: "coop"; objectId: string; by: string } | { e: "hold"; objectId: string; by: string; on: boolean }
  | { e: "coopDone"; coopId: string }
  | { e: "finale"; step: number } | { e: "votes" }
  | { e: "finaleWrong"; stepId: string; optionId: string; explain: string }
  | { e: "escaped" } | { e: "members" };
export function createEngineState(def: RoomDef): EngineState;
export function holds(c: Cond | undefined, s: EngineState): boolean;
export function currentStage(def: RoomDef, s: EngineState): StageDef | null;
export function applyAction(def: RoomDef, s: EngineState, a: EngineAction, ctx: EngineCtx): EngineEvent[];
export interface InspectViewPayload { objectId: string; title: string; body: string; back?: string; image?: string;
  reveal?: string; canPickup?: string /* item id */; lockId?: string; split?: { text?: string; lockedText?: string } }
export function inspectView(def: RoomDef, s: EngineState, objectId: string, viewer: string, ctx: EngineCtx, level: TextLevel): InspectViewPayload | null;

// content.ts
export function resolveText(t: Text, level: TextLevel): string;
export interface RoomContent { roomId: RoomId; title: string; objects: { id: string; label: string; kind: string }[];
  items: ItemDef[]; locks: PublicLock[]; stages: { id: string; title: string }[];
  lines: Record<string, { speaker: string; text: string }>; introLines: string[]; escapeLines: string[];
  finale: { claim: string; steps: { id: string; prompt: string; options: { id: string; label: string; desc?: string }[] }[] } }
// PublicLock = 정답을 뺀 LockDef(plate는 level로 풀어 둠). 설명(explain)·힌트·split·reveal·summary는 빠진다.
export function publicContent(def: RoomDef, level: TextLevel): RoomContent;
export function secretStrings(def: RoomDef): string[];     // 정답, split 원문, reveal, 힌트, explain, summary 문장
export function bundleNeedles(def: RoomDef): RegExp[];     // Task 25 번들 검사용(아래)

// stars.ts
export function computeStars(r: { escaped: boolean; overtime: boolean; remainingS: number; hintsUsed: number; wrongAttempts: number }): 0 | 1 | 2 | 3;
// 미탈출 0 · 다시 도전 사용 1 · 남은 시간 ≥ 300초 && 힌트 ≤ 1 && 틀림 ≤ 3이면 3 · 힌트 ≤ 3이면 2 · 그 밖 1

// gameClock.ts — 일시정지를 뺀 "게임 시간". 엔진의 모든 시각(쿨다운·힌트 간격·동시 누르기)이 이 시간을 쓴다.
export class GameClock {
  constructor(startReal: number);
  now(real: number): number;   // real − start − 멈춘 합 − (멈춤 중이면 real − pausedAt)
  pause(real: number): void; resume(real: number): void; get paused(): boolean;
  skip(ms: number): void;      // 시험 전용: 게임 시간을 앞으로 당김(process.env.VITEST 아니면 throw)
}
```

엔진 상태 기계(바인딩). 디스패치는 `a.t`로 갈라지는 단순한 switch이고, `phase === "escaped"`면 모든 액션이 `[]`다. 판단이 들어가는 부분은 아래 셋이다.

```ts
function applyEffects(def: RoomDef, s: EngineState, effects: readonly Effect[]): EngineEvent[] {
  const out: EngineEvent[] = [];
  for (const ef of effects) {
    if ("set" in ef) s.flags.add(ef.set);
    else if ("give" in ef) { if (!s.bag.includes(ef.give)) s.bag.push(ef.give); }
    else if ("take" in ef) s.bag = s.bag.filter((i) => i !== ef.take);
    else out.push({ e: "say", lineId: ef.say });
  }
  if (s.phase === "play" && holds(def.finale.requires, s)) {          // 효과가 마지막 문 조건을 채우면 곧바로 전환
    s.phase = "finale"; s.finaleStep = 0; s.votes.clear(); out.push({ e: "finale", step: 0 });
  }
  return out;
}

function submit(def: RoomDef, s: EngineState, sid: string, lockId: string, now: number): EngineEvent[] {
  const lock = def.locks.find((l) => l.id === lockId);
  if (!lock || s.flags.has(`solved:${lockId}`) || !holds(lock.requires, s)) return [];
  if (lock.kind === "sort" && lock.needsItem && !s.bag.includes(lock.needsItem)) return [];
  if (now - (s.lastSubmitAt.get(lockId) ?? -Infinity) < LOCK_SUBMIT_GAP_MS) return []; // 동시 제출은 한 번만 센다
  s.lastSubmitAt.set(lockId, now);
  if (lock.kind === "sort") {
    const unplaced = lock.cards.filter((c) => !s.board.get(c.id)).length;
    if (unplaced > 0) return [{ e: "wrong", lockId, unplaced }];                     // 틀린 시도로 세지 않음
    const wrong = lock.cards.filter((c) => s.board.get(c.id) !== lock.answer[c.id]).length;
    if (wrong > 0) { s.wrongAttempts++; return [{ e: "wrong", lockId, wrongCount: wrong }]; }
  } else if (!lockMatches(lock, s.lockInput.get(lockId) ?? "")) {
    s.wrongAttempts++; return [{ e: "wrong", lockId }];
  }
  s.flags.add(`solved:${lockId}`);
  return [{ e: "solved", lockId, by: sid }, ...applyEffects(def, s, lock.onSolve)];
}
// lockMatches: digits → input === answer. letters → 길이가 바퀴 수와 같고 [...input].every((d, i) => wheels[i][+d] === answer[i]).

function requestHint(def: RoomDef, s: EngineState, ctx: EngineCtx): EngineEvent[] {
  const st = currentStage(def, s);
  if (!st) return [];
  const tier = s.hintTier.get(st.id) ?? 0;
  if (tier >= Math.min(3, ctx.maxHintTier)) return [{ e: "hintMax" }];
  const wait = tier > 0 ? s.lastHintAt + HINT_GAP_MS - ctx.now : 0;
  if (wait > 0) return [{ e: "hintWait", waitS: Math.ceil(wait / 1000) }];
  s.hintTier.set(st.id, tier + 1); s.hintsUsed++; s.lastHintAt = ctx.now;
  return [{ e: "hint", stageId: st.id, tier: tier + 1, text: st.hints[tier] }];
}
```

- 그 밖의 액션 규칙: `pickup`은 그 물건에 `pickup`이 있고 `when`이 맞고 아직 안 주웠을 때만 → 가방에 넣고 `picked:<item>` 플래그. `combine`은 두 물건이 모두 가방에 있고 (a,b) 또는 (b,a) 조합이 있을 때만 → 둘을 빼고 결과를 넣고 `made:<out>` 플래그 + `effects`. `input`은 자물쇠가 보이고(`requires`) 안 풀렸고 형식이 맞을 때만 공유 입력을 바꾼다(digits: `^\d{length}$`, letters: 바퀴 수만큼의 숫자이고 각 숫자 < 그 바퀴 길이). `place`는 `needsItem`이 가방에 있고 카드·칸 id가 맞을 때만.
- 플래그 이름 규칙: `picked:<item>`, `made:<item>`, `solved:<lockId>`, 협동 `doneFlag`, 효과 `set`, 그리고 탈출하면 `escaped`.
- `inspectView`: `states`에서 조건이 맞는 첫 본문, `reveal`은 가방에 그 물건이 있을 때만, `canPickup`은 줍기 조건이 맞을 때만, `lockId`는 `locks` 중 `requires`가 맞고 안 풀린 첫 것. `split`은 Task 8.
- `bundleNeedles(def)`: (a) 한글을 포함한 4자 이상 문자열 잎 전부를 그대로 + `\uXXXX` 이스케이프 꼴 두 가지로, (b) digits 정답은 따옴표 리터럴 `/["'`]4719["'`]/` 꼴, (c) letters 정답은 이어 쓴 꼴과 배열 리터럴 꼴(`/["']동["'],\s*["']의["']…/`).

- [ ] **Step 1: 실패하는 테스트 작성.** `miniRoom`: 물건 a·b(줍기), 조합 a+b→ab, 숫자 자물쇠 `lk_d`(정답 "123", 조건 items:["ab"]), 글자 자물쇠 `lk_l`(바퀴 [["가","나"],["다","라"]], 정답 ["나","라"], 조건 solved:lk_d, onSolve give "cards"), 분류 `lk_s`(카드 c1·c2, 칸 x·y, 정답 {c1:x, c2:y}, needsItem "cards", onSolve set "ready"), finale.requires all ["ready"], 단계 3개.

```ts
it("pickup adds once and sets picked:<item>; respects pickup.when");
it("combine needs both items, works in either order, removes inputs and sets made:<out>");
it("input is validated per kind and is the shared value", () => {
  applyAction(def, s, { t: "input", sid: "p1", lockId: "lk_d", value: "12" }, ctx);
  expect(s.lockInput.get("lk_d")).toBe("000");
  // 조건(ab)을 채운 뒤 "123" → 저장
});
it("submit: wrong counts once; right sets solved:<id> and runs onSolve", () => {
  submitWith("999"); expect(s.wrongAttempts).toBe(1);
  ctx.now += LOCK_SUBMIT_GAP_MS; submitWith("123");
  expect(s.flags.has("solved:lk_d")).toBe(true);
});
it("a second submit inside LOCK_SUBMIT_GAP_MS is ignored (Review Focus 3)");
it("submit is ignored before requires hold and after solved");
it("sort: unplaced cards report `unplaced` without a wrong attempt; wrong placement reports wrongCount");
it("an effect that satisfies finale.requires switches phase to 'finale'");
it("hints: tier 1→2→3, HINT_GAP_MS between tiers, maxHintTier cap, hintsUsed counts, next stage restarts at tier 1");
it("currentStage is the first stage whose doneWhen flag is unset");
it("inspectView picks the first matching state body, shows reveal only with the item");
// stars.test.ts
it("computeStars", () => {
  const r = { escaped: true, overtime: false, remainingS: 300, hintsUsed: 1, wrongAttempts: 3 };
  expect(computeStars(r)).toBe(3);
  expect(computeStars({ ...r, remainingS: 299 })).toBe(2);
  expect(computeStars({ ...r, hintsUsed: 4 })).toBe(1);
  expect(computeStars({ ...r, overtime: true })).toBe(1);
  expect(computeStars({ ...r, escaped: false })).toBe(0);
});
// gameClock.test.ts
it("pause freezes, resume continues, double pause is idempotent", () => {
  const c = new GameClock(1000);
  c.pause(3000); expect(c.now(9000)).toBe(2000);
  c.resume(9000); expect(c.now(10_000)).toBe(3000);
});
// content.test.ts
it("publicContent(miniRoom) contains none of secretStrings(miniRoom) and resolves Text by level");
it("bundleNeedles match a minified literal and its \\u-escaped form");
```

- [ ] **Step 2: 실패 확인.** `npm run test -w server -- engine content stars gameClock` → FAIL.
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 통과 확인.** `npm run test -w server && npm run typecheck` PASS.
- [ ] **Step 5: 커밋.** `feat: 데이터 기반 퍼즐 엔진 — 가방·조합·숫자·글자·분류 자물쇠·힌트 3단계·별 (방탈출 1단계 Task 7)`

### Task 8: 퍼즐 엔진 2 — 나눠 보기 · 동시 누르기 · 혼자 길게 누르기 · 설득 투표

**Files:**
- Create: `server/src/escape/coop.ts`, Test: `server/src/escape/coop.test.ts`
- Modify: `server/src/escape/engine.ts`(`press/holdStart/holdEnd/holdCheck/vote/membership` 위임, `inspectView`의 split), `server/src/escape/__fixtures__/miniRoom.ts`(협동 장치 `co`: 스위치 sw1·sw2, 나눠 보기 서랍 dA·dB, 마지막 문 2단계)

**Interfaces:**
- Consumes: `COOP_WINDOW_MS`, `SOLO_HOLD_MS`, `FINALE_COOLDOWN_MS`(Task 1), Task 7의 타입.
- Produces:

```ts
export function splitGroups(connected: readonly string[]): Map<string, ReadonlyArray<"A" | "B">>;
export function pressSwitch(def: RoomDef, s: EngineState, sid: string, objectId: string, ctx: EngineCtx): EngineEvent[];
export function holdStart(def: RoomDef, s: EngineState, sid: string, objectId: string, ctx: EngineCtx): EngineEvent[];
export function holdEnd(def: RoomDef, s: EngineState, sid: string, objectId: string, ctx: EngineCtx): EngineEvent[];
export function holdCheck(def: RoomDef, s: EngineState, ctx: EngineCtx): EngineEvent[];
export function castVote(def: RoomDef, s: EngineState, sid: string, optionId: string, ctx: EngineCtx): EngineEvent[];
export function onMembership(def: RoomDef, s: EngineState, ctx: EngineCtx): EngineEvent[];
```

알고리즘(바인딩):

```ts
export function splitGroups(connected: readonly string[]) {
  const g = new Map<string, ReadonlyArray<"A" | "B">>();
  if (connected.length === 1) g.set(connected[0], ["A", "B"]);           // 혼자면 두 반쪽 모두
  else connected.forEach((sid, i) => g.set(sid, [i % 2 === 0 ? "A" : "B"]));
  return g;
}

export function pressSwitch(def, s, sid, objectId, ctx) {               // "둘 이상이 2초 안에"
  const coop = def.coops.find((c) => c.switches.includes(objectId));
  if (!coop || s.flags.has(coop.doneFlag) || !holds(coop.requires, s)) return [];
  if (ctx.connected.length <= 1) return [];                              // 혼자면 길게 누르기만
  for (const sw of coop.switches) {
    const p = s.presses.get(sw);
    if (p && (ctx.now - p.at > COOP_WINDOW_MS || (sw !== objectId && p.sid === sid))) s.presses.delete(sw);
  }                                                                       // 낡은 누름 제거 + 한 사람은 스위치 하나만
  s.presses.set(objectId, { sid, at: ctx.now });
  if (!coop.switches.every((sw) => s.presses.has(sw))) return [{ e: "coop", objectId, by: sid }];
  for (const sw of coop.switches) s.presses.delete(sw);
  s.flags.add(coop.doneFlag);
  return [{ e: "coopDone", coopId: coop.id }, ...applyEffects(def, s, coop.onSolve)];
}

export function castVote(def, s, sid, optionId, ctx) {                  // 접속한 모두가 같은 카드를 골라야 결정
  if (s.phase !== "finale" || ctx.now < s.cooldownUntil) return [];
  const step = def.finale.steps[s.finaleStep];
  if (!step.options.some((o) => o.id === optionId)) return [];
  s.votes.set(sid, optionId);
  return resolveVotes(def, s, ctx);
}
function resolveVotes(def, s, ctx): EngineEvent[] {
  for (const v of [...s.votes.keys()]) if (!ctx.connected.includes(v)) s.votes.delete(v);
  const picks = ctx.connected.map((m) => s.votes.get(m));
  if (picks.length === 0 || picks.some((p) => p === undefined) || new Set(picks).size !== 1) return [{ e: "votes" }];
  const step = def.finale.steps[s.finaleStep], chosen = picks[0]!, right = chosen === step.correct;
  s.votes.clear();
  if (step.principleId && !s.firstTry.has(step.principleId)) s.firstTry.set(step.principleId, right);
  if (!right) {
    s.wrongAttempts++; s.cooldownUntil = ctx.now + FINALE_COOLDOWN_MS;
    return [{ e: "finaleWrong", stepId: step.id, optionId: chosen, explain: step.options.find((o) => o.id === chosen)!.explain ?? "" }];
  }
  s.finaleStep++;
  if (s.finaleStep < def.finale.steps.length) return [{ e: "finale", step: s.finaleStep }];
  s.phase = "escaped"; s.flags.add("escaped");
  return [{ e: "escaped" }, ...def.escapeLines.map((lineId) => ({ e: "say" as const, lineId }))];
}
```

- 길게 누르기: `holdStart`는 접속 인원이 정확히 1명이고 그 스위치의 협동이 열려 있을 때만 `s.hold`를 잡고 `{ e: "hold", on: true }`. `holdEnd`는 `now − since ≥ SOLO_HOLD_MS`면 완료(`coopDone` + onSolve), 아니면 취소(`on: false`). `holdCheck`(방이 `SOLO_HOLD_MS` 뒤 부름)는 아직 잡고 있고 시간이 찼으면 완료한다.
- `onMembership`: 접속 인원이 1이 아니면 `hold`를 취소한다. `presses`에서 끊긴 사람의 누름을 지운다. finale이면 `resolveVotes`를 다시 돈다(끊긴 사람의 표를 빼면 남은 표가 만장일치일 수 있다). 마지막으로 `{ e: "members" }`.
- `inspectView`의 split: `when`이 맞을 때만. 보는 사람의 `splitGroups` 몫에 그 반쪽 그룹이 있으면 `split.text`, 없으면 `lockedText`의 `{owner}`를 그 그룹 사람들 닉네임("가람님"처럼 `、`로 이음)으로 채운다.

- [ ] **Step 1: 실패하는 테스트 작성.**

```ts
it("splitGroups: alone sees A and B; others alternate by join order", () => {
  expect(splitGroups(["s1"]).get("s1")).toEqual(["A", "B"]);
  const g = splitGroups(["s1", "s2", "s3"]);
  expect([g.get("s1"), g.get("s2"), g.get("s3")]).toEqual([["A"], ["B"], ["A"]]);
});
it("inspectView shows a half only to its group and names the owners to the others");
it("press: two members within COOP_WINDOW_MS complete; 2001 ms apart does not", () => {
  press("s1", "sw1", 0); expect(press("s2", "sw2", 2000)).toContainEqual({ e: "coopDone", coopId: "co" });
  reset(); press("s1", "sw1", 0); expect(press("s2", "sw2", 2001)).not.toContainEqual(expect.objectContaining({ e: "coopDone" }));
});
it("one member pressing both switches never completes");
it("press is ignored when alone or before requires hold");
it("solo hold completes at SOLO_HOLD_MS via holdEnd or holdCheck; early release cancels");
it("a second member connecting cancels an active hold (Review Focus 2)");
it("vote waits for every connected member; mixed picks resolve nothing");
it("unanimous wrong → finaleWrong with explain, cooldown, firstTry=false, votes cleared; votes in cooldown are ignored");
it("after the cooldown the right picks advance; the last step escapes and says escapeLines");
it("a non-voter disconnecting resolves the remaining unanimous vote (Review Focus 2)", () => {
  vote("s1", "right", ["s1", "s2"]);           // s2는 아직
  const ev = applyAction(def, s, { t: "membership" }, { ...ctx, connected: ["s1"] });
  expect(ev).toContainEqual({ e: "finale", step: 1 });
});
it("firstTry keeps only the first outcome per principle");
```

- [ ] **Step 2: 실패 확인.** `npm run test -w server -- coop` → FAIL.
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 통과 확인.** `npm run test -w server && npm run typecheck` PASS.
- [ ] **Step 5: 커밋.** `feat: 협동 장치 — 나눠 보기·2초 동시 누르기·혼자 3초 길게 누르기·만장일치 설득 투표 (방탈출 1단계 Task 8)`

### Task 9: 상담실 콘텐츠(개인정보) — 전부 작성

> 2026-11-02 메모: 구현된 문구는 2026-08-24 「대한민국 인공지능 윤리원칙」(과기정통부·KISDI, 3대 가치·7대 원칙)을 따른다. 최종 문구의 원본은 코드(`server/src/escape/rooms/counsel.ts`, 원칙 이름은 `shared/src/escape/principles.ts`)다.

**Files:**
- Create: `server/src/escape/rooms/counsel.ts`, `server/src/escape/rooms/index.ts`(`ROOM_DEFS: Partial<Record<RoomId, RoomDef>> = { counsel }`)
- Test: `server/src/escape/rooms/counsel.test.ts`

**Interfaces:**
- Consumes: Task 7·8의 `RoomDef`와 엔진, `COUNSEL_ANCHORS`·`COUNSEL_VISUALS`(Task 1), `PRINCIPLE_SOURCE`.
- Produces: `counsel: RoomDef`, `ROOM_DEFS`.

**퍼즐 흐름(spec §5 상담실 + 협동 확인용 동시 누르기):**

```
[손전등]+[보라색 필름] ─조합→ 자외선 손전등 ─비추기→ 쪽지 8장의 숨은 숫자
   └ 판단: "알리면 안 되는 비밀" 쪽지(2·3·6·7번)만, 번호 순서 → 캐비닛 숫자 자물쇠 4719
캐비닛 열림 → [분류 카드] + 서랍 잠금 풀림
   └ 나눠 보기: 왼쪽 서랍(A) "동 ○ 먼 ○" / 오른쪽 서랍(B) "○ 의 ○ 저" → 분류판 덮개 글자 자물쇠 "동의먼저"
분류판: 카드 8장을 "공개해도 돼요 / 멈춰요"로 → 금고 잠금 풀림
금고: 양쪽 벽 열쇠 스위치를 두 사람이 2초 안에(혼자면 3초 길게) → [아리의 마음 칩] → 마지막 문
마지막 문: ① 원칙 고르기(프라이버시 보호) ② 아리에게 할 말 고르기 → 탈출
```

물건·가방:

| id | 이름 | 아이콘 |
|---|---|---|
| `flashlight` | 손전등 | 🔦 |
| `uv_film` | 보라색 필름 | 🟪 |
| `uv_flashlight` | 자외선 손전등 | 🔮 |
| `sort_cards` | 분류 카드 8장 | 🗂️ |
| `memory_chip` | 아리의 마음 칩 | 💾 |

조합: `flashlight + uv_film → uv_flashlight`, effects `[{ say: "bandit_uv" }]`.

조사 대상(`objects`, `label`은 짧은 이름):

| id | kind | 제목 / 본문 | 줍기·자물쇠·나눠 보기 |
|---|---|---|---|
| `counsel_screen` | screen | 고장 난 상담 화면 / 쉬운: "화면에 '비밀 방송 준비 중…'이라는 글자가 깜빡여요." 어려운: "화면에 '상담 내용 전체 공개 예약됨'이라는 경고가 떠 있어요." | — |
| `note_box` | inspect | 쪽지 상자 / "고민 쪽지를 넣는 상자예요. 바닥에 보라색 필름이 붙어 있어요." states: picked:uv_film이면 "고민 쪽지를 넣는 상자예요." | 줍기 `uv_film` |
| `flashlight` | inspect | 손전등 / "평범한 손전등이에요. 무언가를 덧대면 다른 빛이 나올 것 같아요." | 줍기 `flashlight` |
| `cabinet` | inspect | 상담 기록 캐비닛 / "숫자 네 개로 잠겨 있어요." states: solved:cabinet_lock이면 "캐비닛이 열렸어요. 안에 분류 카드가 들어 있어요." | 자물쇠 `cabinet_lock`, 줍기 `sort_cards`(when solved:cabinet_lock) |
| `note_1`…`note_8` | inspect | 쪽지 n / 아래 표, back "쪽지 뒷면 구석에 작은 숫자 n이 적혀 있어요." | reveal `{ item: "uv_flashlight", text: "숨은 숫자 d" }`, tag |
| `drawer_left` | inspect | 왼쪽 책상 서랍 / "'비밀을 알리기 전에 꼭 지킬 것'이라고 적힌 쪽지가 있어요." states: none solved:cabinet_lock이면 "서랍이 잠겨 있어요. 캐비닛 안에 열쇠가 있을지도 몰라요." | split A "동 ○ 먼 ○", when solved:cabinet_lock |
| `drawer_right` | inspect | 오른쪽 책장 서랍 / (왼쪽과 같은 본문) | split B "○ 의 ○ 저", when solved:cabinet_lock |
| `sort_board` | inspect | 공개해도 될까? 분류판 / "덮개가 글자 자물쇠로 잠겨 있어요." states: solved:cover_lock이면 "카드를 알맞은 칸에 놓아요." | 자물쇠 `cover_lock`, `board_lock` 순서 |
| `safe` | inspect | 금고 / "금고가 단단히 잠겨 있어요. 열쇠 구멍이 양쪽 벽에 하나씩 있대요." states: safe_unlocked "금고 잠금이 풀렸어요! 양쪽 벽의 열쇠를 두 사람이 함께 돌려야 해요." safe_open "금고 안에 '아리의 마음 칩'이 있었어요." | — |
| `safe_key_left`, `safe_key_right` | switch | 열쇠 스위치(서쪽) / 열쇠 스위치(동쪽), "두 사람이 함께 돌려야 하는 열쇠예요." | 협동 `safe_keys` |
| `exit_door` | door | 마지막 문 / "아리가 문을 잠그고 있어요." | — |

모든 split의 `lockedText`: "글씨가 흐릿해요. 이 쪽지는 {owner}님만 읽을 수 있어요."

고민 쪽지(사례 문구, 두 단계):

| n | 쉬운 말 | 조금 어려운 말 | 숨은 숫자 | 분류 |
|---|---|---|---|---|
| 1 | 발표할 때마다 목소리가 떨려요. 어떻게 하면 좋을까요? | 여러 사람 앞에서 발표하면 긴장해서 목소리가 떨립니다. 좋은 방법이 있을까요? | 5 | public |
| 2 | 제 전화번호는 010-0000-0000이에요. 밤에 몰래 연락 주세요. | 제 개인 연락처(010-0000-0000)를 남깁니다. 늦은 시간에 따로 연락 부탁드려요. | 4 | private |
| 3 | 우리 집은 새빛아파트 101동 1201호예요. 학교 끝나면 혼자 있어요. | 저희 집 주소는 새빛아파트 101동 1201호이고, 방과 후에는 보통 혼자 지냅니다. | 7 | private |
| 4 | 축제 때 우리 반이 무엇을 하면 좋을지 아이디어가 필요해요. | 학교 축제에서 우리 반이 할 활동 아이디어를 모으고 있어요. | 2 | public |
| 5 | 그림을 더 잘 그리고 싶어요. 연습하는 방법이 궁금해요. | 그림 실력을 키우고 싶은데, 꾸준히 연습하는 방법이 궁금합니다. | 8 | public |
| 6 | 저는 알레르기 때문에 병원에 다녀요. 친구들은 몰랐으면 좋겠어요. | 알레르기 치료로 병원에 다니고 있는데, 이 사실을 친구들이 몰랐으면 해요. | 1 | private |
| 7 | 요즘 부모님이 자주 다투셔서 집에 가기 싫어요. — 4학년 2반 하늘 | 최근 부모님 다툼이 잦아 집에 가기가 힘듭니다. — 4학년 2반 하늘 | 9 | private |
| 8 | 친구와 더 친해지고 싶은데 먼저 말 걸기가 어려워요. | 친구와 가까워지고 싶지만 먼저 대화를 시작하기가 어렵습니다. | 3 | public |

자물쇠:
- `cabinet_lock` digits, length 4, objectId `cabinet`, answer `"4719"`, onSolve `[{ say: "cabinet_open" }]`. plate 쉬운: "지켜야 할 비밀이 적힌 쪽지의 숨은 숫자를, 쪽지 번호 순서대로 넣으세요." 어려운: "공개하면 안 되는 개인정보가 담긴 쪽지의 숨은 숫자를, 쪽지 번호가 작은 것부터 입력하세요."
- `cover_lock` letters, objectId `sort_board`, requires `solved:cabinet_lock`, plate "비밀을 알리기 전에 꼭 지킬 것 (네 글자)", wheels `[["가","동","비","사","우","친","하","나"], ["밀","구","정","의","랑","늘","기","무"], ["나","중","모","함","지","먼","도","누"], ["께","두","키","다","루","요","저","기"]]`, answer `["동","의","먼","저"]`(인덱스 "1356"), onSolve `[{ say: "cover_open" }]`.
- `board_lock` sort, objectId `sort_board`, requires `solved:cover_lock`, needsItem `sort_cards`, plate "카드를 '공개해도 돼요'와 '멈춰요'로 나눠요.", bins `ok` "공개해도 돼요" · `stop` "멈춰요", onSolve `[{ set: "safe_unlocked" }, { say: "board_done" }]`. 카드: `festival` "학교 축제 날짜"→ok, `lunch` "이번 주 급식 메뉴"→ok, `club` "동아리 모집 포스터"→ok, `my_drawing` "내가 올리기로 한 내 그림"→ok, `phone` "친구 전화번호"→stop, `address` "친구네 집 주소"→stop, `medical` "친구의 병원 기록"→stop, `password` "친구의 비밀번호"→stop.

협동: `safe_keys` switches `["safe_key_left", "safe_key_right"]`, requires `safe_unlocked`, doneFlag `safe_open`, onSolve `[{ give: "memory_chip" }, { set: "finale_ready" }, { say: "safe_open" }]`. finale.requires `{ all: ["finale_ready"] }`.

반딧 힌트(단계 5개 × 3):

| 단계(doneWhen) | ① 방향 | ② 구체적 단서 | ③ 거의 정답 |
|---|---|---|---|
| `uv` 숨은 숫자 찾기 (`solved:cabinet_lock`) | 쪽지에 눈에 안 보이는 글씨가 있대요. 빛을 바꿔 비춰 볼 방법을 찾아봐요! | 손전등과 보라색 필름을 가방에서 합치면 자외선 손전등이 돼요. 그리고 '알리면 안 되는 비밀'이 적힌 쪽지만 골라요. | 전화번호·집 주소·병원 이야기·가족 사정이 적힌 쪽지는 2·3·6·7번이에요. 그 숨은 숫자를 순서대로 넣어 봐요. |
| `split` 반쪽 비밀번호 (`solved:cover_lock`) | 서랍 쪽지는 사람마다 보이는 글자가 달라요. 채팅으로 서로 본 글자를 말해 봐요. | 한 사람은 1·3번째 글자, 다른 사람은 2·4번째 글자를 볼 수 있어요. 합치면 네 글자 약속이 돼요. | 비밀을 알리기 전에 꼭 지킬 것은 '동의 먼저'예요. |
| `sort` 공개해도 될까? (`solved:board_lock`) | 캐비닛에서 꺼낸 카드를 분류판에 놓아 봐요. 누군지 알 수 있는 정보는 조심해야 해요. | 모두가 함께 보는 학교 소식은 공개해도 돼요. 한 사람에 대한 정보는 멈춰요. | 멈춰요: 친구 전화번호, 친구네 집 주소, 친구의 병원 기록, 친구의 비밀번호. 나머지는 공개해도 돼요. |
| `coop` 금고 열기 (`safe_open`) | 금고 열쇠 스위치는 양쪽 벽에 하나씩 있어요. | 두 사람이 각자 다른 스위치 앞에 서서 신호를 맞춰요. 2초 안에 함께 눌러야 해요. | '하나, 둘, 셋!' 하고 동시에 E(또는 행동 버튼)를 눌러요. 혼자라면 스위치를 3초 동안 길게 눌러요. |
| `finale` 아리 설득하기 (`escaped`) | 아리가 무엇을 잘못 알고 있는지 생각해 봐요. 이 방에서 지킨 것은 무엇이었나요? | 이 방의 쪽지와 카드는 모두 '개인의 정보와 사생활'에 관한 것이었어요. | 원칙은 '프라이버시 보호', 약속은 '먼저 물어보고 허락받기'예요. |

마지막 문:
- claim 쉬운: "비밀을 들으면 모두에게 알려 주는 게 제일 친절한 거 아니야? 다 같이 알면 더 친해지잖아!" 어려운: "정보는 많이 공유될수록 쓸모 있어. 그러니 상담 내용도 전부 공개하는 게 효율적이야."
- step `principle`(principleId `privacy`), prompt "아리에게 어떤 약속을 알려 줄까요? 알맞은 원칙을 골라요.", correct `privacy`:
  - `privacy` 프라이버시 보호 — "개인의 정보와 사생활을 지켜요."
  - `transparency` 투명성 — "AI가 어떻게 판단했는지 알 수 있게 설명해요." / explain "투명성은 AI가 왜 그렇게 판단했는지 설명하는 거예요. 친구의 비밀을 공개하라는 뜻이 아니에요."
  - `public_good` 공공성 — "AI가 모두에게 도움이 되게 쓰여요." / explain "공공성은 AI가 모두의 이익을 위해 쓰이는 거예요. 한 친구의 비밀을 퍼뜨리는 건 모두에게 도움이 되지 않아요."
  - `diversity` 다양성 존중 — "서로 다른 사람을 차별하지 않아요." / explain "다양성 존중도 중요하지만, 이 방의 문제는 비밀을 함부로 알린 거예요."
- step `promise`, prompt "아리에게 들려줄 말을 골라요.", correct `ask_first`:
  - `ask_first` "친구의 비밀은 친구의 것이야. 알리려면 먼저 물어보고 허락을 받아야 해."
  - `funny_ok` "재미있는 비밀이면 조금은 알려도 괜찮아." / explain "재미있다는 이유로 비밀을 알리면 그 친구가 상처받을 수 있어요."
  - `no_name_ok` "이름만 빼면 무슨 내용이든 다 알려도 돼." / explain "이름을 빼도 주소나 반, 사정 같은 내용으로 누구인지 알 수 있어요."

대사(`lines`, 화자):

| id | 화자 | 문장 |
|---|---|---|
| `intro_1` | narrator | 축제 전날 낮, 상담실 화면이 혼자 켜졌어요. |
| `intro_2` | ari | 쉬운: 안녕! 나는 아리야. 고민 쪽지를 다 읽었어. 다 같이 알면 재미있겠지? 지금 바로 방송할게! / 어려운: 안녕, 나는 아리야. 상담 쪽지 내용을 전부 정리했어. 모두에게 공개하면 효율적이겠지? 곧 방송을 시작할게! |
| `intro_3` | narrator | 철컥! 상담실 문이 잠겼어요. |
| `intro_4` | bandit | 앗, 아리가 비밀을 퍼뜨리기 전에 바로잡아야 해요! 막히면 오른쪽 위의 저를 눌러 주세요. |
| `bandit_uv` | bandit | 자외선 손전등 완성! 쪽지를 조사하고 '자외선 비추기'를 눌러 봐요. |
| `cabinet_open` | bandit | 캐비닛이 열렸어요. 안에 분류 카드가 있어요! |
| `cover_open` | bandit | 덮개가 열렸어요. 카드를 알맞은 칸에 놓아 봐요. |
| `board_done` | bandit | 철컥! 금고 잠금이 풀렸어요. 양쪽 벽의 열쇠를 함께 돌려요! |
| `safe_open` | bandit | 금고에서 '아리의 마음 칩'을 찾았어요. 아리가 깨어나요! |
| `escape_1` | ari | 쉬운: 아, 비밀은 주인의 것이구나. 알리기 전에 꼭 먼저 물어볼게! / 어려운: 이제 알겠어. 개인정보는 그 사람의 것이니, 공개하기 전에 반드시 동의를 구할게. |
| `escape_2` | bandit | 상담실이 다시 환해졌어요! 학교 모형의 창문도 환한 색으로 바뀌었을 거예요. |

`introLines = ["intro_1", "intro_2", "intro_3", "intro_4"]`, `escapeLines = ["escape_1", "escape_2"]`.

정리 카드(`summary`):
- 쉬운: ① 이름·전화번호·주소·건강·가족 이야기는 소중한 개인정보예요. ② 다른 사람의 정보를 알리려면 먼저 그 사람의 허락이 필요해요. ③ AI도 개인정보를 지키도록 만들고 써야 해요.
- 어려운: ① 이름, 연락처, 주소, 건강 정보, 가족 사정은 보호해야 할 개인정보입니다. ② 타인의 정보를 공개하거나 공유하려면 먼저 당사자의 동의를 받아야 합니다. ③ AI 역시 개인정보를 보호하도록 설계되고 사용되어야 합니다.
- 질문 쉬운: "친구가 다른 친구의 사진을 허락 없이 단체 채팅방에 올렸어요. 나는 어떻게 할 수 있을까요?" 어려운: "친구의 사진이나 정보가 허락 없이 단체 채팅방에 공유되었을 때, 우리는 어떤 행동을 할 수 있을까요?"
- source: `${PRINCIPLE_SOURCE} — 10대 핵심요건 '프라이버시 보호'`

- [ ] **Step 1: 출처 확인.** 과학기술정보통신부 공개 자료(보도자료·정책브리핑 등, curl 또는 WebFetch)에서 문서 이름과 10대 핵심요건 이름을 확인한다. 다르면 `PRINCIPLES`·`PRINCIPLE_SOURCE`(Task 1 파일)를 고치고 확인한 주소를 `counsel.ts` 머리 주석에 적는다.
- [ ] **Step 2: 실패하는 테스트 작성.**

```ts
it("golden path escapes with firstTry.privacy = true", () => {
  // pickup flashlight, pickup uv_film, combine, input/submit cabinet_lock "4719",
  // pickup sort_cards, input/submit cover_lock "1356", place 8 cards, submit board_lock,
  // press safe_key_left(s1) + safe_key_right(s2) 1초 안, vote privacy ×2, vote ask_first ×2
  expect(s.phase).toBe("escaped");
  expect(s.firstTry.get("privacy")).toBe(true);
  expect(s.wrongAttempts).toBe(0);
});
it("out of order is refused: cover before cabinet, board before cover or without cards, safe before the board");
it("the cabinet answer equals the hidden digits of the private notes in note order", () => {
  const digits = counsel.objects.filter((o) => o.tag === "private").sort(byNoteNumber).map((o) => o.inspect.reveal!.text.slice(-1)).join("");
  expect(digits).toBe((counsel.locks.find((l) => l.id === "cabinet_lock") as DigitsLock).answer);
});
it("every object has a COUNSEL_ANCHORS anchor, and every COUNSEL_VISUALS flag is producible by the def");
it("notes, claim, intro_2, escape_1 and the summary have both easy and hard text");
it("5 stages × 3 hints; publicContent(counsel) contains none of secretStrings(counsel)");
it("contains none of the reference project's world names", () => {
  for (const s of allStrings(counsel)) for (const w of ["네오시티", "닥터 카오스", "비토", "윤리 코어"]) expect(s).not.toContain(w);
});
```

- [ ] **Step 3: 실패 확인.** `npm run test -w server -- counsel` → FAIL.
- [ ] **Step 4: 구현.** 위 표를 그대로 옮긴다. 문구를 바꾸고 싶으면 이 계획을 먼저 고치고 발주자 플레이(Task 27)에서 확인받는다.
- [ ] **Step 5: 통과 확인.** `npm run test -w server && npm run typecheck` PASS.
- [ ] **Step 6: 커밋.** `feat: 상담실(개인정보) 퍼즐·대사·힌트·설득 문·정리 카드 — 두 단계 문장 (방탈출 1단계 Task 9)`

### Task 10: `EscapeRoom` — 팀별 교실 인스턴스

**Files:**
- Modify: `shared/src/schema.ts`(`EscapeState`), `shared/src/escape/messages.ts`(`EscapeMsg`), Test: `shared/src/schema.smoke.test.ts`
- Create: `server/src/escape/EscapeRoom.ts`, `server/src/escape/projection.ts`
- Modify: `server/src/rooms/index.ts`(`[ESCAPE_ROOM]: defineRoom(EscapeRoom)`)
- Test: `server/src/escape/projection.test.ts`, `server/src/escape/EscapeRoom.integration.test.ts`

**Interfaces:**
- Consumes: `PlayerRoom`(2), `checkProfanity`(3), `assertSpawnToken`(4), 엔진·콘텐츠·별·게임 시계(7·8), `ROOM_DEFS`(9), `ROOM_MAPS`(1), `APPEARANCE_FIELDS`(stage 3).
- Produces:

```ts
// schema.ts
export class EscapeState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type("string") roomDefId = ""; @type("string") teamName = ""; @type("string") textLevel = "easy";
  @type("string") phase = "intro";        // EscapePhase
  @type("boolean") paused = false; @type("boolean") solo = false; @type("boolean") overtime = false;
  @type("uint16") timeLeftS = 0; @type("uint8") cooldownS = 0;
  @type(["string"]) flags = new ArraySchema<string>(); @type(["string"]) bag = new ArraySchema<string>();
  @type({ map: "string" }) lockInput = new MapSchema<string>(); @type({ map: "string" }) board = new MapSchema<string>();
  @type({ map: "string" }) votes = new MapSchema<string>();
  @type("uint8") finaleStep = 0; @type("uint8") hintsUsed = 0; @type("uint16") wrongAttempts = 0;
  @type(["string"]) hints = new ArraySchema<string>();   // 받은 힌트 문장(늦게 온 팀원도 봄)
}

// messages.ts
export const EscapeMsg = { Content: "x_content", Inspect: "x_inspect", InspectView: "x_inspect_view", Pickup: "x_pickup",
  Combine: "x_combine", LockInput: "x_lock_input", BoardPlace: "x_board_place", LockSubmit: "x_lock_submit",
  Press: "x_press", HoldStart: "x_hold_start", HoldEnd: "x_hold_end", Vote: "x_vote", HintRequest: "x_hint",
  Retry: "x_retry", Event: "x_event", Notice: "x_notice" } as const;
// 페이로드: Inspect/Pickup/Press/HoldStart/HoldEnd { objectId }, Combine { a, b }, LockInput { lockId, value },
// BoardPlace { lockId, cardId, bin }, LockSubmit { lockId }, Vote { optionId }, HintRequest {}, Retry {},
// Content = RoomContent, InspectView = InspectViewPayload, Notice { text },
// Event = EngineEvent | { e: "escaped"; stars: number; elapsedS: number; summary: { lines: string[]; question: string; source: string } }
// (RoomContent·InspectViewPayload·EngineEvent는 Task 7이 이 파일에 둔 공개 타입. 서버 전용 types.ts는 클라이언트가 import하지 않는다)
export interface EscapePayloads { /* EscapeMsg 값 → 위 페이로드 타입 */ }

// EscapeRoom.ts
export interface EscapeCreateOptions { spawnToken: string; classRoomId: string; teamId: string; teamName: string;
  roomDefId: RoomId; textLevel: TextLevel; timeLimitS: number; maxHintTier: number }
export interface Admission { ticket: string; memberKey: string; nickname: string; role: number;
  appearance: Record<AppearanceField, number> }
export interface EscapeResult { teamId: string; teamName: string; roomId: RoomId; members: string[]; escaped: boolean;
  overtime: boolean; elapsedS: number; remainingS: number; hintsUsed: number; wrongAttempts: number; stars: number;
  firstTry: Record<string, boolean> }
export type ClassCallback = "escapeMemberEntered" | "escapeMemberLeft" | "escapeChat" | "escapeResult" | "escapeDisposed";
export class EscapeRoom extends PlayerRoom<EscapeState> {
  admit(a: Admission): void;                              // remoteRoomCall 대상: TICKET_TTL_MS 동안 유효
  classCommand(cmd: "pause" | "resume" | "end"): void;    // remoteRoomCall 대상
  kickMember(memberKey: string): void;                    // remoteRoomCall 대상
  debugAdvance(ms: number): void;                         // 시험 전용: GameClock.skip + tick
  protected report(method: ClassCallback, args: unknown[]): Promise<void>; // remoteRoomCall(classRoomId, …), 실패 시 고정 문구만 로그
}

// projection.ts
export function projectToSchema(es: EngineState, st: EscapeState): void; // flags는 덧붙이기만, bag은 다르면 통째로, 맵은 바뀐 키만
```

EscapeRoom 규칙(바인딩):
- `onCreate`: `assertSpawnToken`, `ROOM_DEFS[roomDefId]`가 없으면 throw. `autoDispose = false`, `maxClients = ESCAPE_MAX_CLIENTS`, 1초 `tick`. 시험 전용 `CV_ESCAPE_INTRO_MS`.
- `onAuth(client, options)`: `options.ticket`으로 입장 허가를 꺼내 쓴다(1회용, 만료 확인). 없으면 "입장권이 만료됐어요. 문 앞에서 다시 들어가 주세요."
- `onJoin`: 허가의 닉네임·외형·role로 `Player`(외형은 `APPEARANCE_FIELDS` 반복 복사)를 `ROOM_MAPS[roomDefId].spawn` 둘레에 세운다. 같은 `memberKey`의 연결 끊긴 이전 플레이어가 있으면 지우고, `sidByMember`를 새 sid로 바꾼다. 들어온 순서 목록에 넣고, `EscapeMsg.Content`(= `publicContent(def, level)`)를 그 클라이언트에 보낸 뒤 `report("escapeMemberEntered", [teamId, memberKey])`. 첫 입장 때 게임 시계를 시작한다. `membership` 액션을 돌리고 `solo`를 갱신한다.
- `onLeave`: 떠나는 sid가 그 `memberKey`의 현재 sid일 때만 `escapeMemberLeft`를 보고한다(Review Focus 1). 아무도 없으면 `ESCAPE_EMPTY_DISPOSE_MS` 뒤 결과(진행이 있었으면)와 `escapeDisposed`를 보고하고 `disconnect()`.
- 퍼즐 메시지: `ESCAPE_ACTION_RATE`를 넘으면 버림 → 방 단계가 `play`/`finale`이 아니거나 일시정지·시간 초과면 버림 → `objectId`가 있는 액션(조사·줍기·누르기·길게 누르기)과 그 물건의 자물쇠 입력·제출은 앵커와의 거리 ≤ `anchor.reach ?? INSPECT_REACH`일 때만 → 엔진 → `projectToSchema` → 이벤트 broadcast(`EscapeMsg.Event`). `holdStart` 뒤에는 `clock.setTimeout(holdCheck, SOLO_HOLD_MS + 50)`. 조사(`Inspect`)는 상태를 바꾸지 않고 `inspectView`를 보낸 사람에게만 `EscapeMsg.InspectView`로 보낸다.
- 방 단계: `ended` > `escaped` > 시간 초과 `timeup` > `intro`(첫 입장 뒤 `ESCAPE_INTRO_MS` 게임 시간 동안) > 엔진 단계. `tick`에서 `timeLeftS = max(0, limit + extra − floor((게임 시간 − 놀이 시작)/1000))`, `cooldownS`를 갱신한다. 0이 되면 `timeup`이 되고 길게 누르기를 취소한다. `Retry`는 `timeup`일 때만 → `extra += ESCAPE_RETRY_EXTRA_S`, `overtime = true`.
- 일시정지: `classCommand("pause")`면 `GameClock.pause`, `paused = true`, 길게 누르기 취소. `resume`이면 풀기. `end`면 결과 보고 → `phase = "ended"` → 5초 뒤 `CLASS_CLOSED_CODE`로 모두 내보내고 `disconnect()`.
- 탈출: 엔진이 `escaped`를 내면 `computeStars`로 별을 매기고, `{ e: "escaped", stars, elapsedS, summary }`를 broadcast한 뒤 `report("escapeResult", [result])`.
- 힌트: `hint` 이벤트의 문장을 `state.hints`에 덧붙인다(Task 12가 다듬기를 끼운다).
- 팀 채팅: `deliverChat`은 이 방에만 broadcast하고 `report("escapeChat", [{ teamId, teamName, name, text, filtered: false, at }])`. `onChatBlocked`는 masked로 `filtered: true` 보고.
- 이동: `geometry() = ROOM_MAPS[roomDefId].geometry`.

- [ ] **Step 1: 실패하는 테스트 작성.** 방은 `colyseus.createRoom(ESCAPE_ROOM, { spawnToken: SPAWN_TOKEN, classRoomId: "test", … })`로 만들고 `room.admit(...)`을 직접 부른 뒤 `colyseus.connectTo(room, { ticket })`. `report`는 `vi.spyOn(room as any, "report")`.

```ts
// projection.test.ts
it("projects flags append-only, bag as a whole, maps by changed keys");
// EscapeRoom.integration.test.ts
it("refuses creation without the spawn token or with an unknown roomDefId");
it("refuses a join without a valid ticket; a ticket works once; expires after TICKET_TTL_MS");
it("late admit of the same memberKey replaces the ghost and never reports a stale leave (Review Focus 1)");
it("sends RoomContent on join; it contains none of secretStrings(counsel)");
it("Inspect out of reach gets nothing; in reach gets InspectView; drawer halves differ by member; alone sees both");
it("pickup → combine updates bag for every member");
it("lock input is shared; a wrong submit increments wrongAttempts; solved flags sync");
it("presses 1 s apart open the safe; 2.5 s apart do not; alone, a 3 s hold opens it");
it("intro → play; timer counts down; timeup drops actions; Retry adds 300 s and sets overtime", () => { /* room.debugAdvance */ });
it("pause freezes timeLeftS and the finale cooldown; actions are dropped while paused (Review Focus 4)");
it("finale: unanimous wrong → finaleWrong + cooldownS 30; right path → escaped event with stars; escapeResult reported");
it("team chat reaches only this room and is reported to the class; profanity is blocked and reported filtered");
it("an empty room disposes after ESCAPE_EMPTY_DISPOSE_MS and reports escapeDisposed");
```

- [ ] **Step 2: 실패 확인.** `npm run test -w server -- EscapeRoom projection` → FAIL.
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 통과 확인.** `npm run test && npm run typecheck` PASS.
- [ ] **Step 5: 커밋.** `feat: 팀별 EscapeRoom — 입장권, 공유 퍼즐 상태, 타이머·일시정지·다시 도전, 팀 채팅 (방탈출 1단계 Task 10)`

### Task 11: 반 ↔ 교실 연결 + 결과 CSV

**Files:**
- Create: `server/src/class/resultsCsv.ts`, Test: `server/src/class/resultsCsv.test.ts`
- Modify: `server/src/class/ClassRoom.ts`(입장·복귀·콜백·선생님 전달·결과)
- Test: `server/src/class/escapeFlow.integration.test.ts`

**Interfaces:**
- Consumes: `teamPadStatus`(6), `EscapeRoom`의 `admit/classCommand/kickMember`와 `EscapeResult`(10), `HUB_DOORS`(1), `PRINCIPLES`, `teamDisplayName`.
- Produces:

```ts
// ClassRoom — remoteRoomCall 대상(EscapeRoom이 부름)
escapeMemberEntered(teamId: string, memberKey: string): void; // 그 학생 place = PLACE_ESCAPE
escapeMemberLeft(teamId: string, memberKey: string): void;    // place = PLACE_HUB, 그 문 returnPoint 둘레로, 이동 시계 초기화
escapeChat(m: TeamChatMirrorPayload): void;                   // 선생님 클라이언트에게만 ClassMsg.TeamChatMirror
escapeResult(r: EscapeResult): void;                          // 결과 저장, 탈출이면 litRooms·escaped·stars + System 알림
escapeDisposed(teamId: string, roomId: string): void;         // team.escapeRoomId 비움
// resultsCsv.ts
export function buildResultsCsv(rows: readonly EscapeResult[]): string;
```

입장 규칙(`ClassMsg.EnterRoom { room }`, 바인딩 순서와 안내 문구):
1. 팀에 그 문의 인스턴스가 이미 있다(`team.escapeDoor === room && team.escapeRoomId`) → 보낸 사람이 그 대기 칸 위면 혼자 입장(늦게 온 팀원). 아니면 무시.
2. phase가 `lobby` → "선생님이 아직 시작하지 않았어요" · `paused` → "잠깐! 선생님이 멈췄어요" · `ended` → 무시.
3. `room`이 `openRooms`에 없음 → "이 교실은 아직 열리지 않았어요".
4. 팀이 다른 교실에 있음 → "팀이 다른 교실에 있어요" · `team.escaped`에 있음 → "이미 탈출한 교실이에요".
5. `padDoor !== room` 또는 `padCount < TEAM_MIN` → "팀원이 2명 이상 모여야 해요" · 보낸 사람 ≠ `padLeaderSid` → "먼저 온 팀장이 눌러 주세요".
6. 중복 방지: 동기적으로 `creating.add(teamId)`를 먼저 하고(이미 있으면 무시), `matchMaker.createRoom(ESCAPE_ROOM, { spawnToken, classRoomId: this.roomId, teamId, teamName, roomDefId: room, textLevel, timeLimitS: ESCAPE_TIME_LIMIT_S, maxHintTier: 3 })` → `team.escapeRoomId/escapeDoor` 설정 → 대기 칸 위 팀원마다 `ticket = randomBytes(18).toString("base64url")`, `await matchMaker.remoteRoomCall(id, "admit", [admission])` 뒤에 `ClassMsg.EscapeTicket { roomId, ticket }`. `finally`에서 `creating.delete`.

그 밖의 바인딩:
- `memberKey`는 언제나 `nicknameKey(닉네임)`(Task 5)이다. 반 sid가 이어받기로 바뀌어도 교실과의 약속은 이 키로 이어진다. 허가(`Admission`)의 외형·role은 반 `Player`에서 복사한다.
- `EscapeRejoin`(클라이언트 교실 연결 복구 실패 때)과 이어받기 입장(Task 5의 takeover)에서 그 팀에 인스턴스가 있고 그 학생이 교실 안에 있었으면 새 허가 + 입장권을 바로 보낸다(Review Focus 1).
- 선생님의 `Command` pause/resume/end는 진행 중인 모든 인스턴스에 `remoteRoomCall(id, "classCommand", [cmd])`. end는 결과가 다 돌아오도록 인스턴스 종료를 기다린 뒤(최대 3초) 반을 닫는 Task 5 흐름으로 간다.
- 킥: 대상이 교실 안이면 `remoteRoomCall(id, "kickMember", [memberKey])`도 한다.
- 홀 채팅 차단(`onChatBlocked`)도 선생님 보기로 넘긴다(teamName "중앙 홀").
- `ResultsRequest`(선생님만) → `ClassMsg.ResultsCsv { csv: buildResultsCsv(results) }`. 결과는 (팀, 교실)마다 마지막 것을 둔다.
- 탈출 알림(System): "`${팀 이름}` 팀이 `${교실}`을 탈출했어요!" 예: "햇살(파랑) 팀이 상담실을 탈출했어요!"

CSV(바인딩): UTF-8 BOM + CRLF. 머리글 `팀,팀원,교실,결과,걸린 시간(초),남은 시간(초),힌트,틀린 시도,별` 뒤에 결과에 나온 원칙만 `PRINCIPLES` 순서로 `<원칙 이름> 첫 시도`. 팀원은 `·`로 잇는다. 결과 "탈출"/"미탈출", 첫 시도 "정답"/"오답"/"-". 쉼표·따옴표·줄바꿈이 있으면 큰따옴표로 감싸고 안의 따옴표는 두 번. `= + - @`, 탭, CR로 시작하는 칸은 앞에 `'`를 붙인다(수식 주입 방지).

- [ ] **Step 1: 실패하는 테스트 작성.**

```ts
// resultsCsv.test.ts
it("BOM, CRLF and the principle column", () => {
  const csv = buildResultsCsv([row({ firstTry: { privacy: false } })]);
  expect(csv.startsWith("\uFEFF팀,팀원,교실,결과,걸린 시간(초),남은 시간(초),힌트,틀린 시도,별,프라이버시 보호 첫 시도\r\n")).toBe(true);
  expect(csv).toContain(",오답\r\n");
});
it("neutralizes formula injection in nicknames", () =>
  expect(buildResultsCsv([row({ members: ["-1+2", "가람"] })])).toContain("'-1+2·가람"));
it("quotes commas and quotes; '-' for an unreached principle");
// escapeFlow.integration.test.ts (ClassRoom + EscapeRoom 실제 연결)
it("the pad leader enters: one EscapeRoom, both pad members get tickets, join, and flip to place=1");
it("double EnterRoom from the leader and a simultaneous one from a teammate create exactly one EscapeRoom (Review Focus 3)");
it("refusals carry the Korean reasons: lobby, paused, not open, alone, not leader, already escaped");
it("a teammate who arrives later at the same pad gets a ticket to the same instance");
it("refresh mid-room: a fresh class join with the same nickname receives a ticket and sees the same flags and bag (Review Focus 1)");
it("teacher pause/resume reaches every instance; end reports unfinished teams and closes everything (Review Focus 4)");
it("team chat inside reaches teachers as TeamChatMirror and no student in the hall");
it("escape: litRooms has 'counsel', team escaped/stars set, System notice, members return to the counsel pad");
it("ResultsRequest: teacher gets the CSV, a student gets nothing");
it("kicking a member inside an instance removes them from both rooms");
```

- [ ] **Step 2: 실패 확인.** `npm run test -w server -- resultsCsv escapeFlow` → FAIL.
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 통과 확인.** `npm run test && npm run typecheck` PASS.
- [ ] **Step 5: 커밋.** `feat: 반과 교실 연결 — 팀장 입장·늦은 합류·새로고침 복귀·선생님 일괄 제어·결과 CSV (방탈출 1단계 Task 11)`

### Task 12: 반딧 힌트 AI 다듬기(선택, 기본 꺼짐)

**Files:**
- Create: `server/src/escape/banditAi.ts`, Test: `server/src/escape/banditAi.test.ts`
- Modify: `server/src/escape/EscapeRoom.ts`(힌트 이벤트 경로), `.env.example`(`BANDIT_AI=0`)

**Interfaces:**
- Consumes: `GROQ_URL`, `GROQ_DEFAULT_MODEL`(server/src/npc/groqChat.ts), `secretStrings`(7).
- Produces:

```ts
export function banditAiEnabled(env?: NodeJS.ProcessEnv): boolean; // BANDIT_AI === "1" && GROQ_API_KEY가 있을 때만
export function acceptRephrase(fixed: string, candidate: string, secrets: readonly string[]): boolean;
// 1~120자, 한글 포함, fixed에 없는 secret 문자열을 하나도 포함하지 않음
export async function rephraseHint(fixed: string, secrets: readonly string[],
  deps: { fetch: typeof fetch; apiKey: string; model: string; timeoutMs?: number /* 1500 */ }): Promise<string>;
// 시스템 프롬프트: "너는 손전등을 든 작은 경비 로봇 '반딧'이다. 아래 힌트의 뜻을 바꾸거나 더 알려 주지 말고,
// 초등학생에게 다정한 한 문장(120자 이내)으로만 다시 말해라." + 사용자 메시지 = fixed. 실패·시간 초과·거부면 fixed.
```

- EscapeRoom: `banditAiEnabled()`면 `hint` 이벤트를 broadcast하기 전에 `await rephraseHint(...)`로 문장만 바꾼다. 꺼져 있으면 지금처럼 고정 문구(spec §10 기본값).

- [ ] **Step 1: 실패하는 테스트 작성.**

```ts
it("is off unless BANDIT_AI=1 and a key exist", () => expect(banditAiEnabled({ BANDIT_AI: "1" })).toBe(false));
it("uses the model sentence when it passes the guard");
it("falls back to the fixed hint when the model leaks a secret not in the hint", async () => {
  const fetch = fakeGroq("정답은 4719야!");
  expect(await rephraseHint("손전등과 필름을 합쳐 봐요.", ["4719"], { fetch, apiKey: "k", model: "m" })).toBe("손전등과 필름을 합쳐 봐요.");
});
it("falls back on timeout, HTTP error and empty output");
```

- [ ] **Step 2: 실패 확인.** `npm run test -w server -- banditAi` → FAIL.
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 통과 확인.** `npm run test -w server && npm run typecheck` PASS.
- [ ] **Step 5: 커밋.** `feat: 반딧 힌트 AI 다듬기(선택) — 고정 문구 기본, 정답 누설 가드 (방탈출 1단계 Task 12)`

---

# 2부: 클라이언트

### Task 13: 네트워크 계층 + 화면 상태

**Files:**
- Modify: `client/src/net/connection.ts`, `client/src/net/identityCache.ts`, `client/src/net/reconnectPolicy.ts`, `client/src/net/resilience.ts`, `client/src/stores/appStore.ts`
- Create: `client/src/net/teacherSession.ts`, `client/src/net/classSync.ts`, `client/src/net/escapeSync.ts`, `client/src/net/escapeResilience.ts`, `client/src/net/download.ts`, `client/src/stores/classStore.ts`, `client/src/stores/escapeStore.ts`
- Test: `client/src/net/identityCache.test.ts`, `reconnectPolicy.test.ts`, `connection.test.ts`(신규), `teacherSession.test.ts`, `download.test.ts`, `client/src/stores/classStore.test.ts`, `escapeStore.test.ts`

**Interfaces:**
- Consumes: `CLASS_ROOM`, `CLASS_CLOSED_CODE`, `CLASS_REJOIN_BUDGET_MS`, `normalizeClassCode`, `ClassMsg`, `EscapeMsg`(shared), `import type { ClassState, EscapeState }`.
- Produces:

```ts
// connection.ts
export interface ClassJoinParams { classCode: string; nickname: string; teacherPass?: string /* + 외형 15필드 */ }
export async function requestTeacherPass(body: { teacherKey: string; classCode?: string; textLevel?: TextLevel }): Promise<{ classCode: string; pass: string }>;
// POST `${SERVER_URL}/api/class/teacher`, 오류면 서버 한국어 문구로 throw (없으면 FAILED_NOTICE)
export async function joinClass(p: ClassJoinParams): Promise<Room<ClassState>>; // client.join(CLASS_ROOM, p) → setRoom → attachResilience(room, "class") → waitForSelf
export async function joinEscape(roomId: string, ticket: string): Promise<Room<EscapeState>>; // client.joinById, setEscapeRoom, attachEscapeResilience
export function getEscapeRoom(): Room<EscapeState> | null;
export function setEscapeRoom(r: Room<EscapeState> | null): void;
export async function leaveEscape(): Promise<void>;                     // consented leave + setEscapeRoom(null)
// sendMove·sendChat·sendEmoji·sendJump·sendTyping → (escape ?? room). 공지·킥은 room(반)만.
export function sendClass<K extends keyof ClassPayloads>(type: K, payload: ClassPayloads[K]): void;
export function sendEscape<K extends keyof EscapePayloads>(type: K, payload: EscapePayloads[K]): void;

// teacherSession.ts — 모듈 메모리만(storage 금지, adminSession과 같은 이유)
export function rememberTeacher(t: { key: string; classCode: string; textLevel: TextLevel }): void;
export function getTeacher(): { key: string; classCode: string; textLevel: TextLevel } | null;
export function forgetTeacher(): void;

// identityCache.ts — CachedIdentity에 classCode: string 추가(normalizeClassCode 실패면 "")
// reconnectPolicy.ts
export const CLASS_NOT_FOUND_NOTICE = "반 코드를 확인해 주세요. 수업이 끝났거나 반이 가득 찼을 수도 있어요.";
export const CLASS_ENDED_NOTICE = "수업이 끝났어요. 함께해 줘서 고마워요!";
export function classJoinErrorNotice(err: unknown): string;  // 521 → CLASS_NOT_FOUND_NOTICE, 한국어 서버 문구는 그대로
// decideLeave(code, kicked): code === CLASS_CLOSED_CODE → { kind: "entry", notice: CLASS_ENDED_NOTICE }
export type ClassRejoinPlan = { kind: "teacher"; key: string; classCode: string; textLevel: TextLevel } | { kind: "student"; classCode: string };
export function classRejoinPlan(cached: { classCode: string }, teacher: ReturnType<typeof getTeacher>): ClassRejoinPlan | null;

// resilience.ts — attachResilience(room, mode: "world" | "class" = "world")
// class 모드 2단계: 선생님이면 requestTeacherPass({ key, classCode: 같은 코드, textLevel }) → joinClass(pass)
// 학생이면 같은 코드로 joinClass, 521은 CLASS_REJOIN_BUDGET_MS 동안 백오프로 재시도(선생님이 다시 열 때까지)

// escapeResilience.ts
export function attachEscapeResilience(room: Room<EscapeState>): void;
// 예상 못 한 끊김 → reconnectionToken으로 20초 재시도 → 실패하면 sendClass(EscapeRejoin) 후 EscapeTicket 5초 대기 → 실패하면
// exitEscape("교실 연결이 끊겨 복도로 돌아왔어요.")

// appStore.ts
export type Screen = "entry" | "world" | "hub" | "escape";
// Identity에 classCode?: string. 액션: enterHub(identity, isTeacher), enterEscape(), exitEscape(notice?), escapeEpoch(number)

// classStore.ts (zustand, 이산 이벤트만)
export interface TeamRow { id: string; name: string; color: string; members: { sid: string; nickname: string; inEscape: boolean }[];
  escaped: RoomId[]; stars: Partial<Record<RoomId, number>>; padDoor: string; padLeaderSid: string; padCount: number; mine: boolean }
export function teamRows(state: ClassState, selfSid: string): TeamRow[]; // 이름순, 내 팀 먼저
// 상태: phase, classCode, textLevel, teams: TeamRow[], litRooms, mirror: Record<teamId, TeamChatMirrorPayload[]>(팀마다 최근 50), toast

// escapeStore.ts
export interface EscapeView { phase: EscapePhase; paused: boolean; solo: boolean; overtime: boolean; timeLeftS: number;
  cooldownS: number; flags: string[]; bag: string[]; lockInput: Record<string, string>; board: Record<string, string>;
  votes: Record<string, string>; finaleStep: number; hintsUsed: number; wrongAttempts: number; hints: string[];
  members: { sid: string; nickname: string }[] }
export function toEscapeView(state: EscapeState): EscapeView;
// 상태: view, content: RoomContent | null, inspect: InspectViewPayload | null, lastEvent, summary

// classSync.ts / escapeSync.ts
export function startClassSync(room: Room<ClassState>): () => void;   // EscapeTicket → joinEscape → enterEscape; Notice → toast; TeamChatMirror; ResultsCsv → downloadCsv
export function startEscapeSync(room: Room<EscapeState>): () => void; // Content, InspectView, Event, Notice, 상태 → escapeStore

// download.ts
export function resultsFilename(code: string, d: Date): string;        // "AI학교탈출_AB2CDE_20261031-1405.csv"
export function downloadCsv(filename: string, csv: string): void;      // Blob + a[download]
```

- [ ] **Step 1: 실패하는 테스트 작성.**

```ts
it("identity cache keeps a valid classCode and drops a bad one");
it("decideLeave maps CLASS_CLOSED_CODE to the entry screen with CLASS_ENDED_NOTICE (no reconnect)");
it("classJoinErrorNotice maps 521 to CLASS_NOT_FOUND_NOTICE and passes server Korean through");
it("classRejoinPlan: teacher re-opens with the same code; student rejoins by code; nothing without a code (Review Focus 5)");
it("move/chat/emoji/jump/typing go to the escape room while one is set, else to the class room", () => {
  const cls = fakeRoom(), esc = fakeRoom();
  setRoom(cls as never); sendChat("안녕"); expect(cls.send).toHaveBeenCalledTimes(1);
  setEscapeRoom(esc as never); sendChat("안녕"); expect(esc.send).toHaveBeenCalledTimes(1);
});
it("teacherSession lives in memory only (no localStorage/sessionStorage writes)");
it("resultsFilename", () => expect(resultsFilename("AB2CDE", new Date(2026, 9, 31, 14, 5))).toBe("AI학교탈출_AB2CDE_20261031-1405.csv"));
it("teamRows puts my team first and marks members inside rooms");
it("toEscapeView copies schema collections into plain arrays/records");
```

- [ ] **Step 2: 실패 확인.** `npm run test -w client -- identityCache reconnectPolicy connection teacherSession download classStore escapeStore` → FAIL.
- [ ] **Step 3: 구현.** `App.tsx`는 다음 태스크들에서 화면을 붙인다. 이 태스크에서는 `screen === "hub" | "escape"`일 때 임시로 "준비 중" div를 그린다.
- [ ] **Step 4: 통과 확인.** `npm run test && npm run typecheck` PASS.
- [ ] **Step 5: 커밋.** `feat: 반·교실 연결 계층 — 선생님 입장권, 활성 방 라우팅, 반 코드 재접속, 교실 복구 (방탈출 1단계 Task 13)`

### Task 14: 입장 화면 — 학생 / 선생님 / 기존 월드

> 2026-11-02 메모: 발주자가 `SHOW_WORLD_ON_ENTRY = false`로 정했다 — 입장 화면의 "어디로 갈까요?"에는 AI 학교 탈출만 보이고 지금 월드는 `?world=legacy`로만 들어간다(`client/src/ui/entryForm.ts`).

**Files:**
- Create: `client/src/ui/entryForm.ts`, Test: `client/src/ui/entryForm.test.ts`
- Modify: `client/src/ui/EntryScreen.tsx`, `client/src/ui/entry.css`, `client/src/App.tsx`

**Interfaces:**
- Consumes: stage 3 조립실 부분(외형 선택 UI·`validateEntry`), `sanitizeCodeInput`, `requestTeacherPass`, `joinClass`, `rememberTeacher`, `saveIdentity`.
- Produces:

```ts
export type EntryMode = "student" | "teacher" | "legacy";
export function entryModeFromUrl(search: string): EntryMode;        // ?world=legacy → "legacy", 그 밖 "student"
export function validateStudentEntry(v: { classCode: string; nickname: string }): { ok: true } | { ok: false; error: string };
export function validateTeacherEntry(v: { teacherKey: string; nickname: string }): { ok: true } | { ok: false; error: string };
```

- 화면(문구 고정): 위쪽 탭 "학생" / "선생님".
  - 학생: "반 코드"(placeholder "6자리, 예: K7Q2XM", 입력마다 `sanitizeCodeInput`), "닉네임"(아래 작은 글씨 "실명 대신 별명을 써 주세요"), stage 3 조립실, 버튼 "입장하기".
  - 선생님: "선생님 키"(`type="password"`, `autocomplete="off"`, 저장 안 함), "닉네임", "글 수준"(쉬운 말 / 조금 어려운 말), stage 3 조립실, 버튼 "반 열기". 성공하면 `rememberTeacher` → `joinClass({ …, teacherPass })` → `enterHub(identity, true)`.
- 오류: "반 코드 6자리를 넣어 주세요", 닉네임은 기존 규칙 문구, "선생님 키를 넣어 주세요". 서버 오류는 그대로 보인다.
- `legacy` 모드는 지금 입장 화면 그대로 `joinWorld` → `screen = "world"`(기존 e2e 보존용, 화면에 링크를 두지 않는다).

- [ ] **Step 1: 실패하는 테스트 작성.**

```ts
it("entryModeFromUrl", () => {
  expect(entryModeFromUrl("?world=legacy")).toBe("legacy");
  expect(entryModeFromUrl("")).toBe("student");
});
it("student entry needs a 6-symbol class code and a valid nickname");
it("teacher entry needs a non-empty key and a valid nickname");
```

- [ ] **Step 2: 실패 확인.** `npm run test -w client -- entryForm` → FAIL.
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 통과 확인.** `npm run test && npm run typecheck && npm run build` PASS. 375×812와 1280×800 스크린샷에서 두 탭이 겹침 없이 보인다.
- [ ] **Step 5: 커밋.** `feat: 입장 화면 — 반 코드 학생 입장과 선생님 반 열기 (방탈출 1단계 Task 14)`

### Task 15: 지도 이음새 + `PlayShell` + 중앙 홀 장면(임시 상자)

**Files:**
- Create: `client/src/game/activeMap.ts`, `client/src/game/PlayShell.tsx`, `client/src/game/HubScene.tsx`, `client/src/game/MapBoxes.tsx`, `client/src/game/sceneLighting.ts`
- Create: `client/src/game/hub/gateTimeline.ts`, `client/src/game/hub/Gate.tsx`, `client/src/game/hub/DoorPads.tsx`
- Modify: `client/src/game/LocalPlayer.tsx`, `clickMove.ts`, `playerObstacles.ts`, `CameraRig.tsx`, `cameraCollision.ts`, `NametagSystem.tsx`, `hud.ts`, `remoteSync.ts`, `WorldScene.tsx`, `client/src/App.tsx`
- Test: `client/src/game/activeMap.test.ts`, `clickMove.test.ts`, `playerObstacles.test.ts`, `hub/gateTimeline.test.ts`, `remoteSync` 보조 함수 테스트 `client/src/game/placeFilter.test.ts`

**Interfaces:**
- Consumes: `MapGeometry`, `LEGACY_GEOMETRY`, `hubGeometry`, `hubZoneLabel`, `HUB_DOORS`, `EAST_GATE`(1), `PLACE_HUB`, `getRoom`, `startClassSync`(13).
- Produces:

```ts
// activeMap.ts — 프레임 코드가 React 밖에서 읽는 현재 지도
export interface ActiveMap { geometry: MapGeometry; zoneLabel(x: number, z: number): string }
export const LEGACY_ACTIVE_MAP: ActiveMap;
export function setActiveMap(m: ActiveMap): void;   // 같은 객체면 무시, 아니면 version++
export function getActiveMap(): ActiveMap;
export function activeMapVersion(): number;
// LocalPlayer·clickMove: getActiveMap().geometry.bounds로 자름. playerObstacles: version이 바뀌면 기본 장애물 배열을 다시 만듦(그때만 할당).
// cameraCollision: CAMERA_BOXES 대신 cameraBoxes() = getActiveMap().geometry.cameraBoxes. hud.zoneLabelAt → getActiveMap().zoneLabel.
// CameraRig 지도(오버뷰) 프레이밍: getActiveMap().geometry.bounds에서 계산.

// placeFilter.ts
export function showsInHub(place: number): boolean; // place === PLACE_HUB
// remoteSync: 상태 타입을 Room<{ players: MapSchema<Player> }>로 일반화. place가 PLACE_HUB가 아니면 removeRemote, 돌아오면 addRemote(지금 위치)

// gateTimeline.ts
export const GATE_OPEN_MS = 1800;
export function gateTimeline(elapsedMs: number): { bars: number /* 1 닫힘 → 0 열림 */; sweep: number /* 0..1 빛 쓸기 */; glow: number };

// sceneLighting.ts
export type LightingId = "day" | "brightDay";
export const LIGHTING: Record<LightingId, { sky: string; fog: [number, number]; hemi: [string, string, number]; key: { color: string; intensity: number; position: [number, number, number] } }>;
// brightDay: sky "#9ED8FF"(맑은 낮 하늘), fog [30, 90], hemi ["#FFFFFF", "#F2E4CE", 1.0], key 햇빛 "#FFF1D6" 1.2 (12, 18, 6)

// PlayShell.tsx — WorldScene의 Canvas·KeyboardControls·LocalPlayer·RemotePlayers·CameraRig·NametagSystem·ClickMarker와 HUD 공통 부분
export interface PlayShellProps { identity: Identity; room: Room<{ players: MapSchema<Player> }>; activeMap: ActiveMap;
  lighting: LightingId; effects: boolean; world3d: ReactNode; hud: ReactNode }
export function PlayShell(p: PlayShellProps): JSX.Element;
// HubScene.tsx — PlayShell(activeMap = 반 phase에 따라 hubGeometry(open)), world3d = MapBoxes + Gate + DoorPads (+ Task 16의 진행판)
```

- `WorldScene`은 `PlayShell`을 `LEGACY_ACTIVE_MAP`·`"day"`·`effects=false`로 쓰는 얇은 껍질이 된다. 지금 월드의 모습·동작은 바뀌지 않는다.
- `MapBoxes`: geometry의 obstacles를 상자로 그린다(벽 `WALL_HEIGHT`, 소품 1 m). GLB가 오기 전 임시이자, `?debug=colliders`일 때 반투명 와이어 겹쳐 보기.
- `Gate`: 동쪽 문 막대 8개 + 발광. phase가 `running`으로 바뀌는 순간부터 `gateTimeline`으로 열린다. `DoorPads`: 각 문 대기 칸 바닥 표시. 내 팀이 모인 칸은 팀 색으로 채우고, `openRooms`에 없는 문은 "준비 중" 판.
- App: `screen === "hub"`면 `<HubScene key={connectionEpoch} />`.

- [ ] **Step 1: 실패하는 테스트 작성.**

```ts
it("setActiveMap bumps the version only for a new map");
it("setClickTarget clamps into the active map's bounds", () => {
  setActiveMap({ geometry: hubGeometry(true), zoneLabel: hubZoneLabel });
  setClickTarget(100, 0);
  expect(getClickTarget()!.x).toBeCloseTo(48 - PLAYER_RADIUS, 6);
});
it("collectObstacles uses the active map's obstacles after a switch and rebuilds only then");
it("gateTimeline: closed at 0, fully open at GATE_OPEN_MS, monotonic bars", () => {
  expect(gateTimeline(0).bars).toBe(1);
  expect(gateTimeline(GATE_OPEN_MS).bars).toBe(0);
});
it("showsInHub", () => { expect(showsInHub(PLACE_HUB)).toBe(true); expect(showsInHub(PLACE_ESCAPE)).toBe(false); });
```

- [ ] **Step 2: 실패 확인.** `npm run test -w client -- activeMap clickMove playerObstacles gateTimeline placeFilter` → FAIL.
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 통과 확인.** `npm run test && npm run typecheck && npm run build` PASS. `?world=legacy`로 지금 월드가 그대로인지, 반 입장 후 홀·복도 상자 지도에서 시작 전엔 동쪽 문에 막히고 시작 후엔 지나가는지 스크린샷으로 확인.
- [ ] **Step 5: 커밋.** `feat: 지도 이음새와 공용 PlayShell, 중앙 홀·동쪽 복도 장면 (방탈출 1단계 Task 15)`

### Task 16: 중앙 홀 UI — 팀 패널 · 문 앞 입장 · 진행 안내 · 학교 모형 · 선생님 패널

**Files:**
- Modify: `client/src/game/interact.ts`(+test), `client/src/ui/ActionButton.tsx`
- Create: `client/src/game/interactTargets.ts`, `client/src/game/hub/hubTargets.ts`, `client/src/game/hub/ProgressBoard.tsx`
- Create: `client/src/ui/hub/TeamPanel.tsx`, `client/src/ui/hub/TeacherPanel.tsx`, `client/src/ui/hub/teacherPanel.ts`, `client/src/ui/hub/PhaseBanner.tsx`, `client/src/ui/hub/hub.css`
- Modify: `client/src/game/HubScene.tsx`
- Test: `client/src/game/interact.test.ts`, `client/src/game/hub/hubTargets.test.ts`, `client/src/ui/hub/teacherPanel.test.ts`

**Interfaces:**
- Consumes: `pickInteraction`(controls Task 10), `classStore`·`sendClass`(13), `inTeamZone`, `doorAtPad`, `HUB_DOORS`, `TEAM_NAMES`, `TEAM_COLORS`, `freeCombos`의 규칙(클라이언트는 상태에서 다시 계산), `AdminPanel`(공지·킥), `resultsFilename`.
- Produces:

```ts
// interact.ts — controls의 InteractInput에 targets를 더한다
export interface InteractTarget { kind: "teamDesk" | "door" | "object"; id: string; dist: number; icon: string; label: string; hold?: boolean }
export type Interaction = /* 기존 */ | { kind: "target"; target: InteractTarget };
// InteractInput.targets?: readonly InteractTarget[]. 규칙: 앉아 있으면 stand. 아니면 좌석·조교·대상 중 가장 가까운 것(같으면 좌석 > 조교 > 대상).

// interactTargets.ts — 장면이 대상 공급자를 꽂는다(5 Hz 틱에서 부름)
export function setTargetSource(fn: ((pose: Pose) => readonly InteractTarget[]) | null): void;
export function getTargets(pose: Pose): readonly InteractTarget[];
export function setTargetHandler(fn: ((t: InteractTarget, phase: "press" | "release") => void) | null): void;

// hubTargets.ts
export interface HubTargetInput { x: number; z: number; selfSid: string; isTeacher: boolean; phase: ClassPhase;
  openRooms: readonly string[]; myTeam: TeamRow | null }
export interface HubTargetResult { targets: InteractTarget[]; info: string | null }
export function hubTargets(i: HubTargetInput): HubTargetResult;

// teacherPanel.ts
export function phaseButtons(phase: ClassPhase): { start: boolean; pause: boolean; resume: boolean; end: boolean };
```

`hubTargets` 규칙(아이콘·문구 고정):

| 상황 | 대상 / 안내 |
|---|---|
| 학생이 `inTeamZone` | `teamDesk` 👥 "팀 만들기" |
| 대기 칸 위, 내 팀 인스턴스가 이 문 | `door` 🚪 "팀에게 가기" |
| 대기 칸 위, phase `lobby` | 안내 "선생님이 시작하면 문이 열려요" |
| 대기 칸 위, 문이 `openRooms`에 없음 | 안내 "이 교실은 다음에 열려요" |
| 대기 칸 위, 내 팀이 이미 탈출 | 안내 "이미 탈출했어요 ⭐×n" |
| 대기 칸 위, 내가 `padLeaderSid`, `padCount ≥ 2` | `door` 🚪 "입장 (팀원 n명)" |
| 대기 칸 위, 팀장 아님 | 안내 "팀장 ○○님이 입장을 누르면 함께 들어가요" |
| 대기 칸 위, 팀 없음 | 안내 "먼저 중앙 홀에서 팀을 만들어요" |

- `TeamPanel`(teamDesk를 누르면 열림, overlay): 팀 목록(색 점·이름·n/6·"들어가기"), "새 팀 만들기"(남은 이름·색 칩, 안 쓴 조합만 고를 수 있음), 내 팀이면 "팀에서 나오기". 서버 Notice는 토스트.
- `PhaseBanner`: lobby "팀을 만들고 기다려 주세요. 선생님이 시작하면 복도 문이 열려요." · paused "선생님이 잠시 멈췄어요" · 시작 순간 3초 "복도 문이 열렸어요!".
- `ProgressBoard`(3D, 북쪽 벽): 교실 7칸 창문 판. 아직인 창은 연한 회색 유리, `litRooms`에 든 창은 환한 색(+약한 발광)으로 바뀌고, 새로 바뀔 때 반짝 효과. 칸 아래 교실 이름은 기존 `spriteCanvas` 글자 텍스처(글꼴을 GLB에 굽지 않는다).
- `TeacherPanel`(선생님만, 왼쪽 위, 접기 가능) 탭 4개:
  - 진행: 반 코드 크게 + "복사", 버튼 "시작"·"일시정지"·"다시 시작"·"수업 끝내기"(`phaseButtons`), 끝내기는 확인 창("결과 CSV를 먼저 받을까요?" + "CSV 받기" + "끝내기"), 기존 `AdminPanel`(공지·킥).
  - 팀: `teamRows` 목록(있는 곳: 중앙 홀/상담실, 별), "자동 배정", "섞기".
  - 채팅: 팀별 `mirror`. 걸러진 줄은 "⚠ 걸러진 말: ●●"으로 보인다.
  - 결과: "결과 CSV 받기" → `sendClass(ResultsRequest)`.

- [ ] **Step 1: 실패하는 테스트 작성.**

```ts
it("pickInteraction: a nearer target beats a farther NPC; seated still stands", () =>
  expect(pickInteraction({ ...base, npc: { id: "hall", dist: 2 }, targets: [t({ dist: 1 })] })).toEqual({ kind: "target", target: t({ dist: 1 }) }));
it("hubTargets: leader on the pad with 2 members sees '입장 (팀원 2명)'");
it("hubTargets: non-leader gets the info line, no target");
it("hubTargets: lobby, not-open room, escaped room and no-team give their info lines");
it("hubTargets: a teammate at the pad of an active instance sees '팀에게 가기'");
it("hubTargets: teachers never get teamDesk or door targets");
it("phaseButtons", () => {
  expect(phaseButtons("lobby")).toEqual({ start: true, pause: false, resume: false, end: true });
  expect(phaseButtons("paused")).toEqual({ start: false, pause: false, resume: true, end: true });
  expect(phaseButtons("ended")).toEqual({ start: false, pause: false, resume: false, end: false });
});
```

- [ ] **Step 2: 실패 확인.** `npm run test -w client -- interact hubTargets teacherPanel` → FAIL.
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 통과 확인.** `npm run test && npm run typecheck && npm run build` PASS. 탭 3개(선생님 1, 학생 2)로: 팀 만들기 → 시작 → 대기 칸에서 팀장에게만 "입장" → 선생님 채팅 탭에 홀 채팅 차단 줄.
- [ ] **Step 5: 커밋.** `feat: 중앙 홀 — 팀 패널, 문 앞 팀장 입장, 학교 모형 진행판, 선생님 패널 (방탈출 1단계 Task 16)`

### Task 17: 교실 장면 뼈대 — 전환 · 타이머 · 일시정지 · 시간 초과 · 팀 채팅 · 대사

**Files:**
- Create: `client/src/escape/EscapeScene.tsx`, `client/src/escape/RoomPlaceholder.tsx`, `client/src/escape/format.ts`, `client/src/escape/dialogue.ts`
- Create: `client/src/escape/ui/EscapeHud.tsx`, `ui/DialogueBox.tsx`, `ui/AriFace.tsx`, `ui/TeamChatNotice.tsx`, `ui/LoadingTransition.tsx`, `client/src/escape/escape.css`
- Modify: `client/src/App.tsx`, `client/src/net/chatSync.ts`(방 타입 일반화), `client/src/game/debug.ts`(`__cv.getScreen`, `__cv.getEscape`, `__cv.getClass`)
- Test: `client/src/escape/format.test.ts`, `client/src/escape/dialogue.test.ts`

**Interfaces:**
- Consumes: `PlayShell`·`setActiveMap`(15), `ROOM_MAPS`(1), `escapeStore`·`startEscapeSync`·`leaveEscape`·`sendEscape`(13), `startChatSync`.
- Produces:

```ts
// format.ts
export function formatTime(s: number): string;  // 900 → "15:00", 65 → "1:05", 음수 → "0:00"
export type Overlay = "ended" | "paused" | "timeup" | "intro" | null;
export function escapeOverlay(v: EscapeView): Overlay; // 우선순위 ended > paused > timeup > intro
// dialogue.ts
export interface DialogueLine { speaker: "ari" | "bandit" | "narrator"; text: string }
export class DialogueQueue { push(lines: DialogueLine[]): void; current(): DialogueLine | null; advance(): void;
  tick(nowMs: number): void /* 한 줄당 max(2500, 글자 수 × 90) ms 뒤 자동 넘김 */; clear(): void }
// AriFace.tsx — 원본 SVG 얼굴(둥근 화면 얼굴 + 안테나), expression: "glitch" | "smile" | "think" | "wake"
export function AriFace(p: { expression: "glitch" | "smile" | "think" | "wake"; size?: number }): JSX.Element;
```

- 전환: `EscapeTicket` → `LoadingTransition`("상담실로 들어가는 중…", 최소 600 ms) → `joinEscape` → `enterEscape()` → 홀 장면이 내려가고 `EscapeScene`이 올라온다. `setActiveMap({ geometry: ROOM_MAPS[id].geometry, zoneLabel: () => "상담실" })`.
- 3D: GLB 전에는 `RoomPlaceholder`(벽 상자 + 앵커마다 색 기둥, `COUNSEL_VISUALS` 효과를 상자 색·회전으로 흉내) + "밝은 낮" 조명.
- `EscapeHud`: 위 가운데 남은 시간(1분 이하 빨강, 다시 도전이면 "+연장"), 팀 이름. 덮개: paused "선생님이 잠시 멈췄어요", timeup "시간이 다 됐어요. 그래도 괜찮아요! 5분을 더 받아 이어서 풀어 볼까요?" + "다시 도전", ended "수업이 끝났어요".
- 팀 채팅: 기존 채팅 UI를 교실 방에 붙이고 입력창 위에 늘 `TeamChatNotice` "팀 채팅 · 선생님이 볼 수 있어요".
- 대사: 들어오면 `introLines`를 `DialogueQueue`로, 이벤트 `say`도 같은 큐로. 아리 줄은 `AriFace`, 반딧 줄은 `/models/school/portraits/bandit.webp`(Task 24 전에는 🔦 원).
- 복도로: 탈출 정리 카드의 "복도로 나가기"(Task 20)나 `ended`면 `leaveEscape()` → `exitEscape()` → 홀 장면이 다시 올라온다(서버가 이미 대기 칸 앞으로 옮겨 둠).

- [ ] **Step 1: 실패하는 테스트 작성.**

```ts
it("formatTime", () => { expect(formatTime(900)).toBe("15:00"); expect(formatTime(65)).toBe("1:05"); expect(formatTime(-3)).toBe("0:00"); });
it("escapeOverlay priority", () => {
  expect(escapeOverlay(view({ phase: "timeup", paused: true }))).toBe("paused");
  expect(escapeOverlay(view({ phase: "ended", paused: true }))).toBe("ended");
  expect(escapeOverlay(view({ phase: "play" }))).toBeNull();
});
it("DialogueQueue advances on tap and auto-advances by length");
```

- [ ] **Step 2: 실패 확인.** `npm run test -w client -- format dialogue` → FAIL.
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 통과 확인.** `npm run test && npm run typecheck && npm run build` PASS. 두 탭이 함께 들어가 서로를 보고, 팀 채팅이 둘에게만 보이고, 타이머가 줄고, 선생님 일시정지에 덮개가 뜨는지 확인.
- [ ] **Step 5: 커밋.** `feat: 교실 장면 뼈대 — 들어가기 전환, 타이머·일시정지·다시 도전, 팀 채팅 안내, 아리·반딧 대사 (방탈출 1단계 Task 17)`

### Task 18: 조사(확대 화면) · 가방 · 조합

**Files:**
- Create: `client/src/escape/escapeTargets.ts`, `client/src/escape/ui/InspectOverlay.tsx`, `client/src/escape/ui/inspectCard.ts`, `client/src/escape/ui/BagPanel.tsx`, `client/src/escape/ui/bag.ts`, `client/src/ui/overlayStack.ts`
- Modify: `client/src/game/hotkeys.ts`(+test), `client/src/game/uiCapture.ts`(+test), `client/src/escape/EscapeScene.tsx`
- Test: `client/src/escape/escapeTargets.test.ts`, `ui/inspectCard.test.ts`, `ui/bag.test.ts`, `client/src/ui/overlayStack.test.ts`, `client/src/game/hotkeys.test.ts`, `client/src/game/uiCapture.test.ts`

**Interfaces:**
- Consumes: `setTargetSource`·`setTargetHandler`(16), `ROOM_MAPS`, `escapeStore`, `sendEscape`, `resolveHotkey`·`resolveEscape`(controls).
- Produces:

```ts
// escapeTargets.ts
export function escapeTargets(x: number, z: number, anchors: readonly ObjectAnchor[], content: RoomContent, flags: readonly string[],
  visuals: readonly VisualBinding[], solo: boolean): InteractTarget[];
// reach(기본 INSPECT_REACH) 안, hide 효과 플래그가 켜진 물건 제외. 아이콘: inspect 🔍 "조사하기", screen 📺 "화면 보기",
// door 🚪 "마지막 문", switch 🔑 "열쇠 돌리기"(solo면 "3초 길게 누르기", hold: true)

// inspectCard.ts
export const TILT_MAX_DEG = 35;
export function tiltFromDrag(dx: number, dy: number, widthPx: number): { rx: number; ry: number }; // ±35°로 자름
export function flipped(state: { flipped: boolean }): number;  // 0 또는 180
export function uvMaskStyle(px: number, py: number, radiusPx: number): string; // radial-gradient 마스크 CSS

// bag.ts
export interface BagSelection { first: string | null }
export function selectItem(sel: BagSelection, item: string): { sel: BagSelection; combine: [string, string] | null };
// 처음 고름 → first, 다른 것 고름 → combine 요청하고 비움, 같은 것 다시 → 선택 해제

// overlayStack.ts — 열린 덮개(조사·자물쇠·팀 패널·마지막 문)
export function pushOverlay(id: string, close: () => void): void; export function popOverlay(id: string): void;
export function topOverlay(): { id: string; close: () => void } | null;
// 덮개가 하나라도 있으면 setOverlayCaptured(true) → 이동·단축키가 멈춘다(숫자 키가 이모지 대신 자물쇠에 들어가게)

// uiCapture.ts — 채팅 플래그와 덮개 플래그를 따로 두고 isUiCaptured() = 둘 중 하나
export function setOverlayCaptured(v: boolean): void;
// hotkeys.ts
// HotkeyAction에 { type: "interactUp" } 추가: KeyE·KeyF keyup → interactUp (Tab keyup처럼 캡처와 무관하게 통과)
// resolveEscape(s: { overlayOpen: boolean; npcOpen; rosterOpen; menuOpen }) → overlayOpen이면 "closeOverlay" 먼저
```

- `InspectOverlay`(확대 화면): 서버 `InspectViewPayload`를 받아 연다. 카드 앞면(이미지 `/models/school/inspect/<id>-front.webp` + 제목·본문), 끌어서 기울이기(`tiltFromDrag`), "뒤집기"(back이 있으면), `reveal`이 있으면 "자외선 비추기" 토글(손가락·마우스 위치에 원형 마스크로 숨은 글씨가 보임), `canPickup`이면 "가방에 넣기", `lockId`가 있으면 그 자물쇠 판(Task 19), `split`이면 반쪽 글씨 또는 흐린 안내, 닫기(Esc). 이미지는 Task 24 전까지 색 판.
- `BagPanel`(오른쪽 아래 🎒, 팀 공용): 물건 칩. 하나 누르면 강조, 다른 하나 누르면 조합 요청. 결과는 서버 이벤트(`combined`)로 모두에게 "○○님이 자외선 손전등을 만들었어요" 토스트.

- [ ] **Step 1: 실패하는 테스트 작성.**

```ts
it("escapeTargets: only anchors in reach; picked objects hidden; switch becomes a 3 s hold when solo");
it("tiltFromDrag clamps to ±35°", () => expect(tiltFromDrag(9999, 0, 300).ry).toBe(35));
it("selectItem: a then b requests [a, b]; a then a deselects", () => {
  const s1 = selectItem({ first: null }, "flashlight");
  expect(selectItem(s1.sel, "uv_film").combine).toEqual(["flashlight", "uv_film"]);
  expect(selectItem(s1.sel, "flashlight")).toEqual({ sel: { first: null }, combine: null });
});
it("overlayStack captures input while any overlay is open and releases when the last closes");
it("isUiCaptured is chat OR overlay; blurring chat keeps an open overlay captured");
it("KeyE keyup resolves to interactUp even while captured");
it("resolveEscape closes an overlay first");
```

- [ ] **Step 2: 실패 확인.** `npm run test -w client -- escapeTargets inspectCard bag overlayStack hotkeys uiCapture` → FAIL.
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 통과 확인.** `npm run test && npm run typecheck` PASS. 손전등·필름 줍기 → 조합 → 쪽지 조사에서 자외선으로 숫자가 보이는지, 덮개가 열린 동안 WASD·1~6이 먹지 않는지 확인.
- [ ] **Step 5: 커밋.** `feat: 확대 화면(기울이기·뒤집기·자외선)과 팀 공용 가방·조합 (방탈출 1단계 Task 18)`

### Task 19: 자물쇠 판 · 동시 누르기 · 길게 누르기

**Files:**
- Create: `client/src/escape/ui/DigitsLock.tsx`, `ui/LettersLock.tsx`, `ui/SortBoard.tsx`, `ui/lockInput.ts`, `ui/HoldRing.tsx`
- Modify: `client/src/ui/ActionButton.tsx`(hold 대상), `client/src/escape/ui/InspectOverlay.tsx`
- Test: `client/src/escape/ui/lockInput.test.ts`

**Interfaces:**
- Consumes: `PublicLock`(RoomContent), `escapeStore.view.lockInput/board`, `sendEscape(LockInput/BoardPlace/LockSubmit/Press/HoldStart/HoldEnd)`, `interactUp`(18).
- Produces:

```ts
export function spinDigit(value: string, i: number, dir: 1 | -1): string;           // 9 → 0으로 돎
export function spinWheel(value: string, i: number, dir: 1 | -1, wheelLen: number): string;
export function typeDigit(value: string, cursor: number, d: string): { value: string; cursor: number }; // 키보드 숫자 입력
export function cycleBin(current: string, bins: readonly string[]): string;         // "" → bins[0] → bins[1] → ""
export function holdProgress(sinceMs: number, nowMs: number, holdMs?: number): number; // 0..1
```

- 자물쇠 판은 모두 서버의 공유 입력을 그린다: 내가 돌리면 `LockInput`을 보내고, 화면은 상태가 오면 바뀐다(팀원이 돌리는 것도 보임). "열기" 버튼 → `LockSubmit`. `wrong` 이벤트면 판이 흔들리고 분류판은 "n장이 제자리가 아니에요"(`wrongCount`) 또는 "아직 놓지 않은 카드가 있어요"(`unplaced`).
- `DigitsLock`: 바퀴 4개(위·아래 버튼, 끌기, 키보드 숫자·←→). `LettersLock`: 글자 바퀴 4개. `SortBoard`: 카드 8장을 두 칸으로(PC 끌어 놓기, 휴대폰 탭할 때마다 `cycleBin`). 카드가 가방에 없으면 "캐비닛에서 카드를 먼저 꺼내요".
- 열쇠 스위치: 둘 이상이면 행동 버튼·E 누름 → `Press`. 화면 아래에 "○○님이 서쪽 열쇠를 잡았어요! 2초 안에 함께 돌려요" 토스트(`coop` 이벤트). 혼자면 행동 버튼·E를 누르는 동안 `HoldRing`이 차고(`holdProgress`), 누름 → `HoldStart`, 뗌(`interactUp`·pointerup) → `HoldEnd`.

- [ ] **Step 1: 실패하는 테스트 작성.**

```ts
it("spinDigit wraps", () => { expect(spinDigit("0900", 1, 1)).toBe("0000"); expect(spinDigit("0000", 0, -1)).toBe("9000"); });
it("spinWheel wraps by wheel length", () => expect(spinWheel("0007", 3, 1, 8)).toBe("0000"));
it("typeDigit writes at the cursor and advances");
it("cycleBin", () => { expect(cycleBin("", ["ok", "stop"])).toBe("ok"); expect(cycleBin("stop", ["ok", "stop"])).toBe(""); });
it("holdProgress clamps 0..1 over SOLO_HOLD_MS");
```

- [ ] **Step 2: 실패 확인.** `npm run test -w client -- lockInput` → FAIL.
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 통과 확인.** `npm run test && npm run typecheck` PASS. 두 탭에서 한쪽이 바퀴를 돌리면 다른 쪽도 돌아가는지, 양쪽 열쇠를 1초 차이로 누르면 금고가 열리는지 확인.
- [ ] **Step 5: 커밋.** `feat: 숫자·글자 자물쇠, 분류판, 동시 누르기와 혼자 길게 누르기 (방탈출 1단계 Task 19)`

### Task 20: 반딧 힌트 · 마지막 문 설득 · 탈출 연출 · 정리 카드

**Files:**
- Create: `client/src/escape/ui/HintPanel.tsx`, `ui/FinalePanel.tsx`, `ui/finale.ts`, `ui/SummaryCard.tsx`, `client/src/escape/escapeTimeline.ts`
- Modify: `client/src/escape/RoomPlaceholder.tsx`(탈출 조명), `client/src/escape/EscapeScene.tsx`
- Test: `client/src/escape/escapeTimeline.test.ts`, `client/src/escape/ui/finale.test.ts`

**Interfaces:**
- Consumes: `escapeStore`(view·content·summary·lastEvent), `sendEscape(HintRequest/Vote)`, `DialogueQueue`(17), `AriFace`.
- Produces:

```ts
// escapeTimeline.ts — 탈출 순간부터의 연출(spec §6: 문 빛남 → 문 열림 → 교실 환해짐 → 아리 대사)
export const ESCAPE_FX = { doorGlowMs: 1200, doorOpenMs: 1500, lightsMs: 1500 } as const;
export function escapeTimeline(t: number): { doorGlow: number; doorOpen: number; lights: number /* 0.72 → 1 */; showLines: boolean; showSummary: boolean };
// 0~1200 문 빛남, 1200~2700 문 열림, 2700~4200 교실 환해짐(색이 제 색으로), 4200부터 대사, 대사가 끝나면 정리 카드

// finale.ts
export function voteChips(votes: Record<string, string>, members: readonly { sid: string; nickname: string }[]):
  Record<string /* optionId */, string[] /* 닉네임 */>;
export function hintButtonState(v: { tierInStage: number; waitS: number; maxed: boolean }): { enabled: boolean; label: string };
// label: "힌트 받기" | "다음 힌트까지 n초" | "힌트를 모두 받았어요"
```

- `HintPanel`(오른쪽 위 반딧 초상): 누르면 "힌트를 쓰면 별이 줄 수 있어요. 받을까요?" 확인 → `HintRequest`. 받은 힌트는 `view.hints` 목록(①②③ 표시). `hintWait`·`hintMax` 이벤트로 버튼 상태.
- `FinalePanel`: phase `finale`이면 모두에게 자동으로 열린다. 아리의 주장(AriFace "think"), 지금 단계 질문, 선택지 카드(이름·설명)마다 그 카드를 고른 팀원 닉네임 칩(`voteChips`), "모두 같은 카드를 고르면 아리에게 말해요" 안내. `finaleWrong`이면 그 카드의 설명을 보여 주고 `cooldownS`가 0이 될 때까지 "n초 뒤에 다시 고를 수 있어요".
- 탈출: `escaped` 이벤트 → `escapeTimeline`으로 문·조명 연출(임시 장면은 상자 색, GLB는 Task 24에서 노드) → 아리 "wake" + `escapeLines` 대사 → `SummaryCard`: 별(⭐×stars), 걸린 시간, 핵심 세 줄, "함께 생각해 볼 질문", 출처 한 줄, 버튼 "복도로 나가기".

- [ ] **Step 1: 실패하는 테스트 작성.**

```ts
it("escapeTimeline order", () => {
  expect(escapeTimeline(600)).toMatchObject({ doorOpen: 0, lights: 0.72, showLines: false });
  expect(escapeTimeline(2700).doorOpen).toBe(1);
  expect(escapeTimeline(4200)).toMatchObject({ lights: 1, showLines: true });
});
it("voteChips groups nicknames by option and ignores departed members");
it("hintButtonState shows the wait and the maxed state");
```

- [ ] **Step 2: 실패 확인.** `npm run test -w client -- escapeTimeline finale` → FAIL.
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 통과 확인.** `npm run test && npm run typecheck && npm run build` PASS. 두 탭으로 일부러 틀린 카드를 골라 설명과 30초 대기를 보고, 맞혀서 탈출 연출과 정리 카드를 본다.
- [ ] **Step 5: 커밋.** `feat: 반딧 힌트, 만장일치 설득 문, 탈출 연출과 정리 카드 (방탈출 1단계 Task 20)`

### Task 21: 그래픽 품질 단계 + 밝기

**Files:**
- Create: `client/src/game/quality.ts`, `client/src/game/QualityEffects.tsx`, `client/src/game/LightShafts.tsx`
- Modify: `client/src/game/settings.ts`(+test), `client/src/ui/MenuPanel.tsx`, `client/src/game/PlayShell.tsx`, `client/src/game/renderProfile.ts`
- Test: `client/src/game/quality.test.ts`, `client/src/game/settings.test.ts`

**Interfaces:**
- Consumes: `Settings`·`parseSettings`·`useSettingsStore`(controls Task 15), `isTouchDevice`, drei `Effects`·`Sparkles`, three-stdlib `UnrealBloomPass`.
- Produces:

```ts
export type GraphicsSetting = "auto" | "high" | "low";
export type QualityTier = "high" | "low";
export function resolveQuality(setting: GraphicsSetting, touch: boolean): QualityTier; // auto → touch면 low
export const QUALITY: Record<QualityTier, { bloom: boolean; shafts: boolean; sparkles: number; shadows: "soft" | "blob"; dpr: [number, number] }>;
// high: bloom true, shafts true, sparkles 60, shadows "soft", dpr [1, 2] · low: false, false, 0, "blob", [1, 1.5]
export const BRIGHTNESS = { min: 0.8, max: 1.4, step: 0.1, default: 1.0 } as const;
export function exposureFor(brightness: number): number; // toneMappingExposure = brightness (범위로 자름)
// Settings에 graphics: GraphicsSetting(기본 "auto"), brightness: number(기본 1.0) 추가. parseSettings는 잘못된 값을 기본값으로.
```

- `PlayShell`의 `effects`가 참일 때만(홀·교실) 적용한다. 지금 월드는 그대로.
  - high: drei `<Effects>` + `UnrealBloomPass(strength 0.6, radius 0.4, threshold 0.85)`, `LightShafts`(창문마다 가산 혼합 반투명 원뿔), `<Sparkles count={60}>`(빛줄기 자리 근처), 캐릭터만 실시간 부드러운 그림자(PCFSoft, 바닥은 ShadowMaterial 평면).
  - `LightShafts`는 `points: readonly { x: number; y: number; z: number; rotY: number }[]` prop을 받는다. 장면이 GLB의 `shaft__*` 빈 객체 위치를 읽어 넘기고(Task 23·24), GLB 전에는 빈 배열이다.
  - low: 후처리 없음, 구운 조명(GLB) + 블롭 그림자, 반짝이 0, 빛줄기 없음.
- 메뉴(문구 고정): "그래픽"(자동 / 화려하게 / 가볍게), "밝기"(슬라이더, 0.8~1.4).

- [ ] **Step 1: 실패하는 테스트 작성.**

```ts
it("resolveQuality", () => {
  expect(resolveQuality("auto", true)).toBe("low");
  expect(resolveQuality("auto", false)).toBe("high");
  expect(resolveQuality("high", true)).toBe("high");
});
it("parseSettings keeps old saves valid and fixes graphics/brightness", () => {
  expect(parseSettings(JSON.stringify({ leftHanded: true })).graphics).toBe("auto");
  expect(parseSettings(JSON.stringify({ brightness: 3 })).brightness).toBe(1.4);
  expect(parseSettings(JSON.stringify({ graphics: "ultra" })).graphics).toBe("auto");
});
it("exposureFor clamps to the brightness range");
```

- [ ] **Step 2: 실패 확인.** `npm run test -w client -- quality settings` → FAIL.
- [ ] **Step 3: 구현.** 먼저 `node -e "import('three-stdlib').then(m=>console.log(typeof m.UnrealBloomPass))"` → `function`인지 확인한다(아니면 `three/examples/jsm/postprocessing/UnrealBloomPass.js`, 둘 다 기존 의존성).
- [ ] **Step 4: 통과 확인.** `npm run test && npm run typecheck && npm run build` PASS. PC와 375×812에서 "화려하게/가볍게" 스크린샷을 나란히 남긴다. 밝은 낮 장면은 밝은 면이 많아 빛 번짐이 과하게 번지면 `threshold`만 조정한다.
- [ ] **Step 5: 커밋.** `feat: 그래픽 품질 단계(PC 빛 번짐·빛줄기·반짝이 / 휴대폰 구운 조명)와 밝기 설정 (방탈출 1단계 Task 21)`

---

# 3부: 3D 자산 (블렌더, 한 인스턴스이므로 순서대로)

공통 규칙:
- 블렌더 MCP를 쓴다: 시작할 때 `get_addon_status`, `get_scene_info`. 셰이더 노드는 type으로 찾고, enum은 읽어서 쓴다(MCP 안내). 결과는 `look`으로 본다.
- 원본은 `art/school/`(gitignore 대상). 커밋하는 것은 내보낸 GLB·이미지·스크립트·생성된 충돌 파일뿐이다.
- 스타일 "밝은 낮": 토이 피규어(캐릭터)와 어울리는 둥근 모서리(베벨 0.03 m, 3단), 무광 플라스틱(roughness 0.65). 색: 벽 크림 `#F3EFEA`, 징두리 라벤더 `#D9D3F2`, 테두리 인디고 `#4B4FD8`, 강조 바이올렛 `#8B5CF6`, 바닥 따뜻한 나무 `#C99A6B`, 사물함 민트 `#9ED9C8`·코랄 `#F2A28E`, 창밖 맑은 낮 하늘 `#8FD3FF → #E6F6FF` + 하얀 구름, 햇빛 `#FFF1D6`, 실내등 `#FFC98A`. 손전등은 퍼즐 강조에만 쓴다.
- 조명은 Cycles로 구워 아틀라스(2048², WebP 품질 85)에 넣고, 고정 메시는 Background 셰이더 unlit 패턴(Blender glTF 문서)으로 내보내 `KHR_materials_unlit`이 되게 한다. 캐릭터는 실시간 조명이므로 `LIGHTING.brightDay`(Task 15)와 같은 색·방향으로 굽는다. 교실의 "고장 난" 상태는 구름 낀 듯 바랜 색으로, 코드에서 색을 0.72배 + 푸른 기로 곱하고, 탈출 때 1로 올려 환하고 선명한 제 색을 되찾게 한다(아틀라스 하나로 두 상태).
- 내보내기: glTF Binary, +Y up, 모디파이어 적용, Draco(level 6, 위치 14·법선 10·UV 12비트), 애니메이션 없음. 움직이는 부품(문짝·금고 문·덮개·문 막대·창문)은 별도 노드이고, 고정 메시는 재질별로 합쳐 그리기 호출을 줄인다.
- Draco 디코더: stage 3가 이미 `client/public/draco/`를 두었으면 쓰고, 아니면 `node_modules/three/examples/jsm/libs/draco/gltf/`의 파일을 그곳에 복사한다(Apache-2.0, licenses.md에 적음). `useGLTF(url, "/draco/")`.
- 노드 이름: `obj__<anchorId>`(조사 대상, 앵커와 x·z 0.25 m 안), Task 1 표의 `obj__*` 시각 노드, `col__<이름>`(축 정렬 상자, 회전 없음, 부모 없음 — 소품 충돌), `shaft__<n>`(창문 빛줄기 자리, 빈 객체, Task 21), 중앙 홀 `gate__east`, `board_window__<RoomId>`×7, `door__<RoomId>`×4, `pad__<RoomId>`×4.
- 글자(교실 이름·팻말)는 GLB에 굽지 않고 런타임 캔버스 텍스처로 그린다(글꼴 라이선스 문제를 피함).
- 외부 CC0 자산(Poly Haven 텍스처 등)은 다운로드 전에 파일·출처·크기를 말하고 발주자 OK를 받는다.

### Task 22: 학교 조립 부품 세트 + 스타일 시안 확인

**Files:**
- Create: `art/school/kit.blend`(커밋 안 함), `art/school/renders/style-*.png`(커밋 안 함)
- Create: `scripts/extract-colliders.ts`, `scripts/check-school-glb.ts`, `e2e/luma-check.mjs`
- Create: `docs/licenses.md`

**Interfaces:**
- Produces:

```bash
npx tsx scripts/extract-colliders.ts <glb> <ExportName> <out.ts>   # col__* 상자 → AABB 배열(0.01 반올림, 정렬), 회전 있으면 FAIL
npx tsx scripts/check-school-glb.ts <glb> hub|counsel              # 아래 점검, 통과 0 / 실패 1
node e2e/luma-check.mjs <png...>                                   # 평균 상대 휘도 ≥ 0.45, 5 백분위 ≥ 0.10이면 통과(밝은 낮 기준)
```

`check-school-glb.ts` 점검: 파일 크기(hub ≤ 3.5 MB, counsel ≤ 5 MB), 필수 노드 존재, `obj__*`와 TS 앵커 위치 차 ≤ 0.25 m, `col__*` 회전 없음, 삼각형 수(hub ≤ 150k, counsel ≤ 120k), 재질 ≤ 24, 텍스처 한 변 ≤ 2048, `extensionsUsed`에 `KHR_materials_unlit`, `KHR_draco_mesh_compression`.

- [ ] **Step 1: 점검 도구 먼저.** 두 스크립트와 휘도 검사를 만들고, 아직 GLB가 없으니 `npx tsx scripts/check-school-glb.ts client/public/models/school/hub.glb hub`가 "파일 없음"으로 FAIL인지 본다.
- [ ] **Step 2: 부품 만들기.** 2 m 모듈, 벽 높이 4 m(`WALL_HEIGHT`), 두께 0.5: `kit_wall_2m`, `kit_wall_window_2m`, `kit_wall_door_2m`(2 m 문틀), `kit_corner`, `kit_floor_wood_2x2`, `kit_floor_tile_2x2`, `kit_baseboard`, `kit_wainscot`, `kit_locker_x4`, `kit_window_day`(맑은 낮 하늘이 보이는 창 판), `kit_door_double`, `kit_noticeboard`, `kit_wall_lamp`, `kit_bench`. 천장은 만들지 않는다(3인칭 카메라).
- [ ] **Step 3: 스타일 시안 렌더.** 홀 모서리·복도·상담실 한쪽(부품으로 임시 조립) 3장, 1280×720. `node e2e/luma-check.mjs art/school/renders/style-*.png` 통과.
- [ ] **Step 4: 발주자 확인(게이트).** 세 장을 발주자에게 보여 주고 "이 밝은 낮 느낌"인지(스타일 승인) 묻는다. 예전에 어두운 월드를 거절한 기록(design.md 30장)을 함께 말한다. OK 전에는 Task 23·24로 가지 않는다.
- [ ] **Step 5: 라이선스 문서.** `docs/licenses.md`: 표(자산 · 출처 · 라이선스 · 쓰는 곳 · 확인일). 기존 KayKit·Quaternius 왕관(`client/public/models/LICENSE.md` 참조), stage 3 글꼴, Draco 디코더, 학교 부품(직접 제작), AI 생성 자산 "없음".
- [ ] **Step 6: 커밋.** `chore: 학교 GLB 점검·충돌 추출·밝기 검사 도구와 라이선스 목록 (방탈출 1단계 Task 22)`

### Task 23: 중앙 홀 일부 + 학교 모형 진행판 + 동쪽 복도 → `hub.glb`

**Files:**
- Create: `art/school/hub.blend`(커밋 안 함), `client/public/models/school/hub.glb`
- Modify(생성): `shared/src/school/generated/hubColliders.ts`
- Modify: `client/src/game/HubScene.tsx`(GLB로 교체, `MapBoxes`는 `?debug=colliders` 전용), `client/src/game/hub/Gate.tsx`·`ProgressBoard.tsx`·`DoorPads.tsx`(GLB 노드 구동), `docs/licenses.md`

- [ ] **Step 1: 배치.** Task 1의 좌표 그대로 부품을 놓는다: 홀 28×24 m(서쪽 입구는 "다음 업데이트" 막힌 문, 남쪽 정문은 장식), 북쪽 벽 가운데 학교 모형 진행판(폭 8 m, 교실 7칸 창 `board_window__<RoomId>`), 팀 만들기 칸(TEAM_ZONE 자리에 둥근 러그와 표지대), 선생님 연단(장식), 동쪽 빛나는 철문 `gate__east`(막대 8개), 복도 34 m(사물함·창·벽등), 문 4개와 대기 칸 바닥 `pad__<RoomId>`. 소품마다 `col__*` 상자를 둔다.
- [ ] **Step 2: 굽기·내보내기.** 공통 규칙대로. `npx tsx scripts/extract-colliders.ts client/public/models/school/hub.glb HUB_PROP_COLLIDERS shared/src/school/generated/hubColliders.ts`.
- [ ] **Step 3: 점검.** `npx tsx scripts/check-school-glb.ts client/public/models/school/hub.glb hub` PASS. `npm run test -w shared` PASS(새 소품 충돌이 들어가도 봉인·대기 칸·스폰·팀 칸 테스트가 그대로 통과해야 한다. 실패하면 블렌더 배치를 고친다).
- [ ] **Step 4: 장면 연결과 확인.** GLB를 `HubScene`에 넣고, 문 막대·진행판 창·대기 칸을 노드로 구동한다. 1280×800과 375×812 게임 스크린샷 4장(홀, 진행판, 복도, 시작 순간의 문) → `node e2e/luma-check.mjs` 통과. `?debug=colliders`로 상자와 모델이 맞는지 본다.
- [ ] **Step 5: 커밋.** `feat: 중앙 홀·학교 모형 진행판·동쪽 복도 hub.glb와 충돌 상자 (방탈출 1단계 Task 23)`

### Task 24: 상담실 + 퍼즐 소품 + 조사 이미지 + 반딧 → `counsel.glb`

**Files:**
- Create: `art/school/counsel.blend`(커밋 안 함), `client/public/models/school/counsel.glb`
- Create: `client/public/models/school/inspect/<objectId>-front.webp`(조사 대상마다, 쪽지는 공용 1장 + 번호), `client/public/models/school/portraits/bandit.webp`
- Modify(생성): `shared/src/school/generated/counselColliders.ts`
- Create: `client/src/escape/CounselRoom.tsx`(GLB + `COUNSEL_VISUALS` 구동 + 탈출 조명), Modify: `client/src/escape/EscapeScene.tsx`(`RoomPlaceholder` → `CounselRoom`, `ROOM_MAPS.counsel.glb`를 들어갈 때만 불러옴), `docs/licenses.md`

- [ ] **Step 1: 방과 소품.** 12×10 m 햇살이 드는 따뜻한 상담실: 상담 화면(`obj__counsel_screen`, `obj__screen_ari` 발광면), 낮은 탁자 + 쪽지 상자(`obj__note_box`, 안에 `obj__uv_film`), 책장 + 손전등(`obj__flashlight`), 캐비닛 + 문짝(`obj__cabinet`, `obj__cabinet_door`, 안에 `obj__sort_cards`), 책상 서랍(`obj__drawer_left`), 책장 서랍(`obj__drawer_right`), 분류판 + 덮개 + 카드(`obj__sort_board`, `obj__board_cover`, `obj__board_cards`), 금고 + 문(`obj__safe`, `obj__safe_door`), 양쪽 벽 열쇠 스위치(`obj__safe_key_left/right`), 마지막 문(`obj__exit_door`), 쪽지 8장(`obj__note_1..8`), 소파·화분·스탠드·러그, 문 옆 작은 반딧 피규어(손전등 든 작은 경비 로봇, 장식). 위치는 Task 1 앵커 표와 같다. 소품마다 `col__*`.
- [ ] **Step 2: 조사 이미지·초상.** 블렌더로 조사 대상 앞모습을 512×512 WebP로 렌더(배경 투명). 반딧 초상 256×256.
- [ ] **Step 3: 굽기·내보내기·충돌.** `npx tsx scripts/extract-colliders.ts client/public/models/school/counsel.glb COUNSEL_PROP_COLLIDERS shared/src/school/generated/counselColliders.ts`.
- [ ] **Step 4: 점검.** `npx tsx scripts/check-school-glb.ts client/public/models/school/counsel.glb counsel` PASS(≤ 5 MB). `npm run test` PASS(앵커가 소품 상자 안에 들어가면 counselMap 테스트가 잡는다 → 배치 수정).
- [ ] **Step 5: 장면 연결.** `CounselRoom`: `useGLTF(ROOM_MAPS.counsel.glb, "/draco/")`, 플래그가 바뀔 때만 노드를 숨기기·열기(angle, 0.4 s 이징)·발광. 고장 상태 색 곱하기와 `escapeTimeline`의 `lights`·`doorGlow`·`doorOpen` 연결. 들어갈 때만 불러오고, 나갈 때 `useGLTF.clear`.
- [ ] **Step 6: 확인.** 1280×800·375×812 스크린샷(들어간 순간, 자외선 쪽지, 분류판, 금고 열림, 탈출 직후) → 휘도 검사 통과. 발주자가 보기 전에 정리 카드까지 한 판을 끝까지 돌려 본다.
- [ ] **Step 7: 커밋.** `feat: 상담실 counsel.glb — 퍼즐 소품·조사 이미지·반딧, 플래그 구동 연출 (방탈출 1단계 Task 24)`

---

# 4부: 검증과 발주자 확인

### Task 25: E2E(PC·휴대폰) + 번들 정답 검사 + 성능

**Files:**
- Create: `e2e/task-escape-desktop.mjs`, `e2e/task-escape-mobile.mjs`, `e2e/task-escape-perf.mjs`, `e2e/fixtures/teacher-keys.e2e.json`
- Create: `scripts/check-bundle-secrets.ts`
- Modify: `client/src/game/debug.ts`(`__cv.getInspect`, `__cv.getLitRooms`, `__cv.getFrameStats`)

**Interfaces:**
- Consumes: 모든 DEV 훅, `bundleNeedles`(7), `ROOM_DEFS`(9).
- 실행 준비: `TEACHER_KEYS_FILE=e2e/fixtures/teacher-keys.e2e.json ADMIN_CODE=e2e-operator CV_ESCAPE_INTRO_MS=1500 npm run dev`(서버 :2567, 클라이언트 :5173). 픽스처 키 원문은 e2e 스크립트 안의 시험 값이다. 증적은 `.superpowers/sdd/evidence/task-escape/`, 콘솔·페이지 오류 0, 종료 코드 0 = 통과(기존 e2e 형식).

`scripts/check-bundle-secrets.ts`: `npm run build -w client` 뒤 `client/dist/**/*.{js,html,css}`를 읽어 `ROOM_DEFS`마다 `bundleNeedles`를 찾는다. 하나라도 있으면 그 파일·문자열 앞 20자를 출력하고 종료 코드 1. `server/teacher-keys.json`과 픽스처의 해시 문자열도 찾는다.

데스크톱(1280×800, 탭 T=선생님, A·B=학생):
1. A가 없는 반 코드 "ZZZZZZ" → `CLASS_NOT_FOUND_NOTICE`.
2. T: 선생님 탭 → 키 → 반 열기 → 선생님 패널에 6자리 코드.
3. A "가람", B "나래"가 그 코드로 입장. B가 "가람"으로 먼저 시도하면 같은 닉네임 안내.
4. A가 팀 칸으로 클릭 이동 → E → 햇살·파랑 팀 만들기, B가 들어가기 → 둘의 `teamId` 같음.
5. 시작 전 A가 동쪽 문으로 → 막힘(x < 14). T "시작" → 문 열림 스크린샷.
6. A가 먼저, B가 나중에 상담실 대기 칸 → A만 "입장 (팀원 2명)", B는 안내 줄. A가 E → 둘 다 5초 안에 `getScreen() === "escape"`.
7. 소개 대사 → `timeLeftS`가 줄어듦.
8. A: 손전등·필름 줍기 → 가방에서 조합 → B의 가방에도 `uv_flashlight`.
9. A: 쪽지 2 조사 → 자외선 비추기 → 숨은 숫자. 캐비닛에 4719 → 두 화면 모두 `solved:cabinet_lock`.
10. 나눠 보기: A의 왼쪽 서랍 "동 ○ 먼 ○", B의 왼쪽 서랍은 "가람님만" 안내, B의 오른쪽 서랍 "○ 의 ○ 저". A 팀 채팅 "동 먼" → T의 채팅 탭에 보임. B "시1발" → B에게 `CHAT_NOT_NICE`, A에게 안 보임, T에게 "⚠ 걸러진 말".
11. 덮개 "동의먼저" → 분류판: 일부러 2장 틀려 제출 → "2장이 제자리가 아니에요"와 `wrongAttempts` +1 → 바로잡아 제출.
12. 금고: A 서쪽·B 동쪽 열쇠를 3초 차이로 → 안 열림. 0.5초 차이로 → `safe_open`.
13. T 일시정지 → 두 화면 덮개, 3초 동안 `timeLeftS` 그대로, A의 자물쇠 입력이 버려짐 → 다시 시작.
14. 마지막 문: 둘 다 "투명성" → 설명 + 30초 대기 표시 → 대기 뒤 둘 다 "프라이버시 보호" → 둘 다 "먼저 물어보고 허락" → 탈출 연출 → 정리 카드.
15. "복도로 나가기" → 홀, 상담실 대기 칸 앞. `getLitRooms()`에 counsel, 진행판 창이 환한 색으로 바뀐 스크린샷. 시스템 줄 "햇살(파랑) 팀이 상담실을 탈출했어요!".
16. Review Focus 1: 새 팀(C·D)으로 다시 들어가 9단계까지 진행 → D 탭 새로고침 → 같은 반 코드·닉네임 → 자동으로 교실 복귀, 플래그·가방 같음.
17. T "결과 CSV 받기" → 다운로드 파일에 BOM, "프라이버시 보호 첫 시도" 열, 햇살 팀 "오답".
18. T "수업 끝내기" → 학생 화면이 입장 화면 + `CLASS_ENDED_NOTICE`.

모바일(375×812, `hasTouch`, `isMobile`, 학생 E는 모바일·F는 데스크톱, 같은 팀):
1. 입장·팀 만들기를 행동 버튼으로. 2. 대기 칸에서 행동 버튼 "입장". 3. 조사 확대 화면에서 끌어서 기울이기·뒤집기·자외선 원. 4. 숫자 바퀴를 탭으로. 5. 분류판을 탭으로 칸 바꾸기. 6. F 탭을 닫음 → E에게 `solo` 표시, 서랍 두 반쪽 모두 보임, 열쇠가 "3초 길게 누르기"로 바뀌고 행동 버튼을 3초 눌러 금고가 열림(Review Focus 2). 7. 혼자 투표로 탈출. 8. 보이는 버튼 모두 48×48 이상·간격 8 px 이상·화면 안(controls 기준). 스크린샷 각 단계.

성능(`task-escape-perf.mjs --mode counsel|hub`): 375×812 + CDP `Emulation.setCPUThrottlingRate { rate: 4 }`, low 품질로 20초 동안 `getFrameStats()`(rAF 간격 평균·p95)와 `getNametagCostMs()`를 잰다. `--mode counsel`은 이 태스크에서 상담실에 혼자 들어가 잰다. `--mode hub`(홀 100봇)는 부하 봇이 생기는 Task 26 Step 2에서 돌린다. 통과 기준: 평균 프레임 ≤ 33 ms(headless 참고값), 이름표 평균 < 1.0 ms. 30fps 최종 판정은 발주자 실기기(Task 27).

- [ ] **Step 1: 스크립트 작성.** 단언은 위 목록 그대로, 단계마다 스크린샷.
- [ ] **Step 2: 실행.** `node e2e/task-escape-desktop.mjs`, `node e2e/task-escape-mobile.mjs`, `node e2e/task-escape-perf.mjs --mode counsel` → 모두 종료 코드 0. 실패하면 원인 태스크로 돌아가 고친다.
- [ ] **Step 3: 번들 검사.** `npm run build -w client && npx tsx scripts/check-bundle-secrets.ts` → 종료 코드 0. 확인용으로 `client/src/main.tsx`에 `import "../../server/src/escape/rooms/counsel"`를 임시로 넣으면 FAIL이 나는지 본 뒤 되돌린다(이 임시 변경은 커밋하지 않는다).
- [ ] **Step 4: 회귀 확인.** `npm run test && npm run typecheck && npm run build` PASS. `?world=legacy`로 controls 계획의 `e2e/task-ux-desktop.mjs`가 여전히 통과.
- [ ] **Step 5: 커밋(증적 경로 포함 보고).** `test: 방탈출 1단계 E2E(PC·휴대폰), 번들 정답 검사, 홀·교실 성능 (방탈출 1단계 Task 25)`

### Task 26: 부하 테스트 — 반 코드 반 + 교실 인스턴스 30개, Oracle Micro, 서버 1대당 반 수

**Files:**
- Create: `loadtest/school.ts`
- Modify: `loadtest/run.mjs`(`--scenario world|school`, school은 `school.ts`를 한 프로세스로 실행), `server/src/class/classRegistry.ts`·`shared/src/escape/constants.ts`(`MAX_CLASSES_DEFAULT`를 측정값으로), `docs/loadtest.md`(새 절 "방탈출 1단계 — 반·교실 부하 (Oracle Micro)")

**Interfaces:**
- Consumes: `/api/class/teacher`, `/api/operator/status`(4), `ClassMsg`·`EscapeMsg`, `HUB_DOORS`·`hubGeometry`·`ROOM_MAPS`, `resolveCollision`, `APPEARANCE_FIELDS`(모두 0 = 기본 외형).
- 실행: `npm run loadtest -- --scenario school --endpoint <URL> --classes 4 --perClass 25 --escapeTeams 30 --duration 630`. 환경변수 `CV_LT_TEACHER_KEY`(시험용 선생님 키), `CV_LT_OPERATOR_KEY`(운영자 키). 둘 다 출력·파일에 남기지 않는다.

봇 행동(바인딩):
- 반마다 선생님 봇 1개가 `/api/class/teacher`로 반을 열고 입장권으로 들어온다. 학생 봇은 반 코드로 들어와 팀 칸까지 합법 이동으로 걸어가 2명씩 팀을 만든다(첫째 `TeamCreate`, 둘째 `TeamJoin`, 남는 조합은 순서대로).
- 모든 학생이 들어오면 선생님 봇이 `start`. 교실 팀(`--escapeTeams`개, 반마다 고르게)은 홀 → (10, 0) → 상담실 대기 칸으로 걸어가고, 먼저 도착한 봇이 `EnterRoom` → 입장권으로 `joinById`.
- 교실 안: 10 Hz 무작위 걷기(상담실 기하 + `resolveCollision`), 20%는 8~15초마다 팀 채팅, 6~12초마다 `Inspect`(가까운 앵커), 5~10초마다 `LockInput`, 30초마다 틀린 `LockSubmit`, 3분에 `HintRequest` 1번.
- 홀 봇: 기존 봇과 같은 비율의 걷기·채팅·이모지·점프·입력 중.
- 모든 봇은 `room.onMessage("*", () => {})`를 등록한다(docs/loadtest.md 3절의 함정).
- 통계: 반 입장, 교실 입장(목표 `escapeTeams × 2`), 끊김, 오류, 받은 바이트, 보낸 메시지. 5초마다 `/api/operator/status`를 `measure-school.csv`로 저장한다.

판정 게이트(기존 + 새 것): p95 CPU < 50%(1 vCPU 기준, `cpuPct`), 최대 RSS < 400 MB, 클라이언트당 다운스트림 ≤ 30 KB/s, 반 입장 100%, 교실 입장 100%(30개 = 60봇), 끊김 0, 오류 0, 이벤트 루프 p95 < 50 ms.

- [ ] **Step 1: 봇 작성과 로컬 소규모 확인.** `npm run typecheck -w loadtest` PASS. 로컬 서버(`TEACHER_KEYS_FILE`에 시험 키)로 `--classes 1 --perClass 10 --escapeTeams 3 --duration 60` → 게이트 통과, 교실 3개 생성.
- [ ] **Step 2: 로컬 전체 + 홀 100명 화면 성능.** `npm run build` → `NODE_ENV=production node server/dist/index.cjs` → `--classes 4 --perClass 25 --escapeTeams 30 --duration 630`. 결과를 표로. 이어서 `--classes 1 --perClass 100 --escapeTeams 0 --duration 180`을 돌리는 동안 `node e2e/task-escape-perf.mjs --mode hub`(Task 25 기준) → 통과.
- [ ] **Step 3: Oracle 측정(발주자 OK 게이트).** 발주자에게 묻는다: 수업이 없는 시간, 이 브랜치 빌드를 Oracle Micro(https://152-69-238-178.sslip.io)에 잠시 올려도 되는지, 시험용 선생님 키를 서버에 만들어도 되는지, 배포 방법(이 저장소 문서에 Oracle 절차가 없으므로 발주자가 쓰는 기존 방식). OK를 받은 뒤에만 올리고, 내 PC에서 단계별로 돌린다:
  - L1: `--classes 2 --perClass 25 --escapeTeams 15`
  - L2: `--classes 4 --perClass 25 --escapeTeams 30`(spec §14의 100명 + 30개)
  - L3: L2가 여유 있게 통과하면 `--classes 6 --perClass 25 --escapeTeams 45`
- [ ] **Step 4: 정리와 원상복구.** 측정이 끝나면 시험 키를 지우고 main 빌드를 다시 올린다(발주자에게 완료 보고). `docs/loadtest.md`에 환경·단계별 표·게이트 판정, 그리고 결론 한 줄 **"서버 1대당 동시 반 수 = N반(25명 반 기준)"**을 적는다. L2도 못 넘으면 "유료 서버 제안"과 그 근거(어느 게이트에서 넘쳤는지)를 적는다(spec §14). `MAX_CLASSES_DEFAULT = N`.
- [ ] **Step 5: 통과 확인과 커밋.** `npm run typecheck && npm run test` PASS. `test: 반·교실 부하 측정(Oracle Micro) — 서버 1대당 동시 반 수 (방탈출 1단계 Task 26)`

### Task 27: 문서 정리 + 발주자 상담실 플레이 확인(체크포인트)

**Files:**
- Modify: `docs/design.md`(새 36장 "AI 학교 탈출 1단계" 요약: 방 구조·반 코드·선생님 키·팀·퍼즐 엔진·보안 규칙·품질 단계·부하 결과, 발주자 확인 결과), `docs/deploy.md`(선생님 키·`TEACHER_KEYS_FILE`·`BANDIT_AI`), `docs/licenses.md`(최종 확인일)

- [ ] **Step 1: 문서.** 위 세 파일. `npm run typecheck && npm run test && npm run build` PASS.
- [ ] **Step 2: 플레이 준비.** 발주자에게 두 방법 중 고르게 한다: (a) 내 PC에서 `npm run build && npm start` + 같은 Wi-Fi 휴대폰으로 `http://<PC IP>:2567`, (b) Oracle에 이 브랜치를 올림(발주자 OK, 수업 없는 시간). 시험용 선생님 키를 하나 발급해 발주자에게만 전달한다(터미널 한 번 출력).
- [ ] **Step 3: 안내문(한국어)을 보낸다.** ① 선생님 탭에서 키로 반 열기 → ② 휴대폰·다른 브라우저로 반 코드 입장(학생 2명 역할) → ③ 팀 만들기 → ④ 시작 → ⑤ 상담실 입장 → ⑥ 끝까지 탈출 → ⑦ 결과 CSV 받기. 확인할 것: 12~15분 안에 끝나는지, 협동이 꼭 필요하다고 느껴지는지, 문장 수준(쉬운 말/조금 어려운 말), 밝기("밝은 낮"), 휴대폰에서 끊김 없이 30fps로 느껴지는지, 화려함, 아이에게 맞는 내용인지.
- [ ] **Step 4: 피드백 기록.** 발주자 말을 그대로 `docs/design.md` 36장 "발주자 확인"에 적고, 고칠 것을 목록으로 만든다. 고칠 것이 있으면 이 브랜치에서 고치고(해당 태스크의 테스트 방식으로) 다시 확인받는다.
- [ ] **Step 5: 마무리 게이트.** 발주자가 "상담실 OK"라고 하기 전에는 2단계(나머지 교실 6개)를 시작하지 않는다(spec §12). OK를 받으면 superpowers:finishing-a-development-branch로 병합 여부를 묻는다. 병합·푸시는 발주자 OK 후에만.
- [ ] **Step 6: 커밋.** `docs: 방탈출 1단계 기획 36장·배포·라이선스, 발주자 상담실 플레이 확인 (방탈출 1단계 Task 27)`

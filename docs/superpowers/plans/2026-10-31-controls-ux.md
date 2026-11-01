# 조작·카메라·이름표 UI/UX 개편 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 학생이 설명 없이 30초 안에 걷고·둘러보고·말할 수 있도록, 3D 게임 공통 관례에 맞춰 PC·휴대폰 조작, 카메라, 이름표, HUD를 하나의 체계로 다시 짠다.

**Architecture:** 모든 규칙(단축키 표, 조이스틱 구간, 카메라 이징, 스프링 암, 상호작용 우선순위, 이름표 선택·쌓기, 설정 파싱, 첫 안내 상태)은 three·DOM이 없는 순수 모듈에 두고 vitest로 고정한다. React 컴포넌트와 `useFrame`은 그 함수를 부르기만 하고, 프레임마다 바뀌는 값은 ref·모듈 변수에 둔다(design 6장). 서버는 이동 예산의 기준 속도를 달리기 속도로 올리고, 점프·입력 중을 이모지처럼 broadcast 이벤트로 보내며, 선생님 표시는 서버만 쓰는 `Player.role`로 동기화한다.

**Tech Stack:** Vite + React 19 + React Three Fiber 9 + three 0.185 + drei(KeyboardControls) + zustand · Colyseus 0.17 + @colyseus/schema 4 · vitest 4(워크스페이스마다) · Playwright(`e2e/*.mjs`) · @colyseus/loadtest(`loadtest/bot.ts`) · Node 24

**Spec:** `docs/superpowers/specs/2026-10-31-controls-ux-design.md` — 승인됨. ⚠️ 표시된 번복(모바일 1인칭 D-패드와 1인칭 시선 동행 제거, 선생님 `role` 동기화)도 승인 범위다.

## Global Constraints

- Node 24(`engines.node >=24`). 새 런타임 의존성 추가 금지. `nipplejs`는 제거한다(Task 7).
- 커밋: 발주자가 `feature/controls-ux` 브랜치에서 태스크마다 커밋하는 것을 승인했다(2026-10-31). main 병합과 GitHub 푸시는 매번 발주자 OK가 필요하다. 커밋 메시지 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`를 붙인다.
- 매 태스크 끝에 루트에서 `npm run typecheck`와 `npm run test`가 모두 통과해야 한다. 이 계획이 명시해 지우는 테스트 말고는 기존 테스트를 전부 유지한다.
- 성능 목표는 모바일 30fps, 아바타 100명이다. 프레임 데이터는 React state·zustand에 넣지 않고, 매 프레임 경로에서 배열·객체를 새로 만들지 않는다.
- 사용자에게 보이는 문구는 한국어, 식별자·파일명·명령은 영어.
- 터치 버튼은 터치 영역 최소 48px, 버튼 사이 간격 최소 8px. 화면 왼쪽 가장자리 24px 안쪽은 조이스틱이 반응하지 않는다(왼손잡이 모드는 오른쪽 가장자리).
- PC 키: WASD·방향키 걷기, Shift 누르는 동안 달리기(걷기의 1.6배), Space 점프, 마우스 드래그(왼쪽·오른쪽 버튼)와 Z/C 시점, R 카메라 뒤로 정렬, 휠 줌, 바닥 짧은 클릭 이동, E(F도 같음) 상호작용, Enter 또는 `/` 채팅 열기(Enter 보내기, Esc 닫기), 1~6 이모지, Tab 누르는 동안 접속자 목록, M 지도, V 1/3인칭, Esc 메뉴.
- 채팅·관리자 입력이 키보드를 쥔 동안(`isUiCaptured()`)과 자동반복(`e.repeat`)에는 단축키가 반응하지 않는다(예외는 Esc와 Tab 떼기, Task 4).
- 서버 권위: y는 서버 고정이다(스키마에 y 없음). 점프와 입력 중은 상태가 아니라 broadcast 이벤트다. 점프(1.0 m, 0.8초)는 0.8초에 1번, 입력 중(켜기)은 3초에 1번으로 제한한다. 클라이언트는 걷기/달리기 상태를 보내지 않는다.
- 이동 검증 예산 = `RUN_SPEED(= MOVE_SPEED × 1.6) × 경과시간 × MOVE_SPEED_SLACK(1.5)`. 기존 규칙에서 기준 속도만 바뀐다.
- `Player.role`(uint8, 0 학생 / 1 선생님)은 서버가 관리자 코드 인증에 성공했을 때만 1로 쓴다. join 옵션이나 클라이언트 메시지로는 바뀌지 않는다.
- `shared/src/schema.ts`는 클라이언트·로드테스트에서 `import type`으로만 쓴다.
- 동작 클립: 달리기 `Running_A`(0.800 s), 점프 `Jump_Full_Short`(1.167 s). 2026-10-31에 knight·barbarian·mage·rogue GLB의 JSON 청크로 네 모델 모두에 있음을 확인했다.
- 이름표는 25 m부터 서서히 사라져 30 m에서 0이 된다. 글자 화면 높이는 12~16px. 표시 대상은 화면 안 가장 가까운 15명과 말하는 사람과 선생님이다.
- 미로 골 귀환은 지금 규칙(design 34)을 유지한다. 행동 버튼과 E로 순간이동하지 않는다.
- 과거 일회성 e2e 스크립트(`e2e/task-*.mjs`)는 고치지도 다시 돌리지도 않는다(task-v2-14 선례). D-패드·👁 버튼·T 키·`.cv-sit-btn`을 쓰는 task-10, task-v2-05/08/09/10은 낡은 증적으로 남는다. 새 검증은 Task 18·19의 새 스크립트가 맡는다.

## Review Focus

1. **채팅(또는 관리자 공지) 입력 중 단축키 누수.** 입력창에 `w a s d e f r z c v m 1~6`, Space, Shift, Tab을 쳐도 걷기·달리기·점프·앉기·시점·이모지·지도·접속자 목록이 하나도 반응하지 않고 글자만 들어가야 한다. → Task 4 `hotkeys.test.ts`, Task 5 `uiCapture.test.ts`, Task 8(Z/C 가드), Task 18 데스크톱 6단계.
2. **마우스로 누른 HUD 버튼에 포커스가 남은 채 Space나 Enter.** 이모지·지도 버튼을 클릭한 뒤 Space를 누르면 점프만 하고 그 버튼이 다시 눌리면 안 된다. → Task 4(Space·Enter·Tab `preventDefault`), Task 10·16(버튼이 포커스를 가져가지 않음), Task 18 데스크톱 4단계.
3. **조이스틱을 쥔 채 두 번째 손가락.** 왼손으로 걷는 중에 오른손으로 드래그·핀치·두 번 톡을 해도 걷기는 계속되고 시점만 바뀌어야 한다. 조이스틱 구역에 닿은 두 번째 손가락은 무시한다. → Task 7 `stick pointer ownership`, Task 18 모바일 4단계.
4. **앉은 상태에서 Space, Shift, 조이스틱 끝까지.** 앉은 아바타는 로컬에서도 서버에서도 깡총 뛰지 않고, 이동 입력은 지금처럼 일어서기 1회로 이어져야 한다. → Task 2 `drops a Jump from a seated player`, Task 11 `localJump refuses while seated`, Task 18 데스크톱 5단계.
5. **"…" 입력 중 표시가 남는 경우.** 보낸 사람이 탭을 닫거나 순단·강퇴되어 끄기 이벤트가 오지 않아도 "…"는 `TYPING_TTL_MS`(5 s) 안에 사라지고, 그 사람이 채팅을 보내면 바로 사라져야 한다. → Task 12 `TypingRegistry` 테스트.

---

## 파일 구조

| 파일 | 상태 | 책임 |
|---|---|---|
| `shared/src/constants.ts` | 수정 | 달리기·점프·입력 중·role 상수 |
| `shared/src/messages.ts` | 수정 | `Jump`, `Typing` 메시지와 페이로드 |
| `shared/src/schema.ts` | 수정 | `Player.role` |
| `server/src/rooms/movement.ts` | 수정 | 달리기 속도 예산 |
| `server/src/rooms/typing.ts` | 신규 | 입력 중 페이로드 검증(순수) |
| `server/src/rooms/WorldRoom.ts` | 수정 | `handleJump`, `handleTyping`, role 설정 |
| `client/src/game/hotkeys.ts` | 신규 | 단축키 표, Esc 우선순위, window 구독 도우미 |
| `client/src/game/gait.ts` | 신규 | 걷기/달리기 속도와 클립 선택 |
| `client/src/game/joystick.ts` | 수정 | 다이내믹 조이스틱 구역·세기·포인터 소유 |
| `client/src/game/cameraControls.ts` | 신규 | Z/C 회전, 뒤로 정렬, 궤도 이징, 따라가기, 줌 |
| `client/src/game/tapGesture.ts` | 신규 | 두 번 톡, 시점 쪽 판정 |
| `client/src/game/cameraCollision.ts` | 신규 | 선분-벽 판정(스프링 암·이름표 가림 공용) |
| `client/src/game/ClickMarker.tsx` | 신규 | 클릭 이동 목적지 표시 |
| `client/src/game/interact.ts` | 신규 | 앉기/일어서기/대화 우선순위 |
| `client/src/game/jump.ts` | 신규 | 점프 레지스트리, 높이 곡선, 로컬 점프 규칙 |
| `client/src/game/typing.ts` | 신규 | 입력 중 송신기와 수신 레지스트리 |
| `client/src/game/nametagLayout.ts` | 신규 | 이름표 크기 제한, 거리 페이드 |
| `client/src/game/nametagSelect.ts` | 신규 | 표시 대상 선택, 겹침 쌓기, 나눠 돌리기 |
| `client/src/game/labelRegistry.ts` | 신규 | React 밖 이름표 등록부 |
| `client/src/game/NametagSystem.tsx` | 신규 | 이름표 전역 프레임 루프 |
| `client/src/game/settings.ts` | 신규 | 설정 파싱, 버튼 크기 |
| `client/src/game/hud.ts` | 신규 | 공간 이름, 접속자 줄, 이모지 부채꼴 배치 |
| `client/src/game/coach.ts` | 신규 | 첫 안내 상태 기계 |
| `client/src/game/OverviewLabels.tsx` | 신규 | 지도 모드 방 이름 |
| `client/src/net/jumpSync.ts`, `typingSync.ts` | 신규 | broadcast → 레지스트리 |
| `client/src/stores/settingsStore.ts`, `coachStore.ts` | 신규 | 설정(localStorage), 안내 진행 |
| `client/src/ui/ActionButton.tsx`, `JumpButton.tsx`, `EmojiFan.tsx`, `HudTop.tsx`, `HudButton.tsx`, `RosterPanel.tsx`, `MenuPanel.tsx`, `CoachMarks.tsx` + `action.css`, `hud.css`, `menu.css`, `coach.css` | 신규 | HUD |
| `client/src/game/dpad.ts`, `dpad.test.ts`, `client/src/ui/TouchDpad.tsx`, `dpad.css`, `SitPrompt.tsx`, `NpcPrompt.tsx`, `ViewToggle.tsx` | 삭제 | 대체됨 |
| `e2e/task-ux-desktop.mjs`, `task-ux-mobile.mjs`, `task-ux-perf.mjs` | 신규 | 검증 |
| `loadtest/bot.ts`, `loadtest/run.mjs`, `docs/loadtest.md`, `docs/design.md` | 수정 | 부하 테스트, 문서 |

## 바뀌는 기존 테스트

- `client/src/game/dpad.test.ts`: 파일 삭제(D-패드 제거, Task 6).
- `client/src/game/viewMode.test.ts`: `lookYawForDir`·`stepFollowYaw` describe 삭제. constants 테스트에서 `FP_FOLLOW_RATE` 단언 삭제(Task 6).
- `client/src/game/viewState.test.ts`: reset 기대값에서 `dragging` 삭제(Task 6), `orbitGoal: null, savedOrbit: null` 추가(Task 8).
- `client/src/game/uiCapture.test.ts`: `MoveKeys` 리터럴에 `run` 추가(Task 5).
- `client/src/game/remoteStore.test.ts`: 레코드 리터럴에 `role: 0` 추가(Task 3).
- `server/src/rooms/movement.test.ts`: `budget()` 도우미가 `RUN_SPEED`를 쓴다(Task 1). 단언은 그대로.
- `server/src/rooms/WorldRoom.integration.test.ts`: 단언 변경 없음. 유휴 상한 테스트 주석 "~3 m" → "~4.8 m"(Task 1), 관리자 테스트 주석을 "isAdmin 마커는 비공개, role만 공개"로(Task 3).
- 나머지(`joystick.test.ts`, `input.test.ts`, `locomotion.test.ts`, `clickMove.test.ts`, `bubbleRegistry.test.ts` 등)는 그대로 통과해야 하고 새 케이스만 붙는다.

## 스펙 대응표

| 스펙 | 태스크 |
|---|---|
| §2 PC 조작 | 4, 5, 8, 10, 11, 15, 16 |
| §3 휴대폰 조작, 크기·접근성 | 6, 7, 8, 10, 11, 15, 16 |
| §4 카메라 | 8, 9, 16(지도) |
| §5 서버·네트워크, 동작 클립 | 1, 2, 3, 5, 11, 12 |
| §6 이름표 | 13, 14, 15 |
| §7 HUD·첫 안내 | 16, 17 |
| §8 검증 | 각 태스크 단위 테스트, 18, 19 |

---

# 1단계: 조작·카메라 + 서버

### Task 1: 달리기 속도 — 공유 상수 + 서버 이동 검증

**Files:**
- Modify: `shared/src/constants.ts` (`MOVE_SPEED_SLACK` 다음에 추가. `MOVE_ELAPSED_CEIL_MS` 주석의 "~3 m"를 "RUN_SPEED × 0.5 × 1.5 ≈ 4.8 m"로)
- Modify: `server/src/rooms/movement.ts:52`
- Test: `server/src/rooms/movement.test.ts`
- Modify(주석만): `server/src/rooms/WorldRoom.integration.test.ts:145-176`

**Interfaces:**
- Produces: `RUN_SPEED_MULTIPLIER = 1.6`, `RUN_SPEED = MOVE_SPEED * RUN_SPEED_MULTIPLIER`(6.4 m/s), 둘 다 `@caysonverse/shared/constants`.

- [ ] **Step 1: 실패하는 테스트 작성.** `budget()` 도우미의 `MOVE_SPEED`를 `RUN_SPEED`로 바꾸고 아래를 추가한다.

```ts
describe("validateMove — run speed (controls-ux §5)", () => {
  it("pins the run multiplier at 1.6", () => {
    expect(RUN_SPEED).toBeCloseTo(MOVE_SPEED * 1.6, 9);
  });
  it("accepts a run step the old walk budget dropped", () => {
    const d = MOVE_SPEED * 0.1 * MOVE_SPEED_SLACK + 0.1; // > 0.6 m (old cap)
    expect(validateMove(ORIGIN, { x: d, z: 0, yaw: 0 }, 100)).not.toBeNull();
  });
  it("drops a step just beyond RUN_SPEED × elapsed × slack", () => {
    const d = RUN_SPEED * 0.1 * MOVE_SPEED_SLACK + 0.01;
    expect(validateMove(ORIGIN, { x: d, z: 0, yaw: 0 }, 100)).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인.** `npm run test -w server -- movement` → "accepts a run step…"와 "accepts a move exactly at the speed budget"이 FAIL.
- [ ] **Step 3: 구현.** `movement.ts` 3단계 예산을 `RUN_SPEED * (elapsed / 1000) * MOVE_SPEED_SLACK`로 바꾸고, 파일 머리 주석에 "기준 속도 = 달리기 속도(controls-ux §5)"를 적는다.
- [ ] **Step 4: 통과 확인.** `npm run test -w server` PASS(유휴 상한 통합 테스트의 10 m 드롭과 1 m 수용은 그대로), `npm run typecheck` PASS.
- [ ] **Step 5: stage + 보고.** 제안 커밋 `feat: 달리기 속도만큼 서버 이동 검증 예산 확대 (조작 개편 Task 1)`. 발주자 OK 후에만 커밋.

### Task 2: 점프·입력 중 이벤트 — 서버

**Files:**
- Modify: `shared/src/constants.ts`, `shared/src/messages.ts`
- Create: `server/src/rooms/typing.ts`, Test: `server/src/rooms/typing.test.ts`
- Modify: `server/src/rooms/WorldRoom.ts` (`ClientTracking` :70, `onCreate` :131, `onJoin`의 추적 생성 :206-212, 새 핸들러 2개, `handleChat`)
- Test: `server/src/rooms/WorldRoom.integration.test.ts` (새 describe `WorldRoom jump/typing (integration)`)

**Interfaces:**
- Produces(shared): `JUMP_RATE = { count: 1, windowMs: 600 } as const`, `JUMP_DURATION_MS = 600`, `TYPING_RATE = { count: 1, windowMs: 3000 } as const`, `TYPING_TTL_MS = 5000`. `MessageType.Jump = "jump"`, `MessageType.Typing = "typing"`. `type JumpPayload = Record<string, never>`, `interface JumpBroadcast { sid: string }`, `interface TypingPayload { on: boolean }`, `interface TypingBroadcast { sid: string; on: boolean }`. 넷 다 `MessagePayloads`에 등록한다.
- Produces(server): `validateTypingPayload(payload: unknown): boolean | null`.

서버 규칙(바인딩):
- `handleJump`: 플레이어나 추적이 없으면 드롭. `seatIndex >= 0`이면 조용히 드롭. `jumpRate.tryAccept(now)`가 실패하면 조용히 드롭. 통과하면 `broadcast(Jump, { sid })`. 페이로드 내용은 읽지 않는다.
- `handleTyping`: 검증 실패면 드롭. `on: true`는 `typingRate`(3000 ms당 1회)를 넘으면 조용히 드롭하고, 통과하면 `track.typing = true` 후 broadcast. `on: false`는 `track.typing`이 true일 때만 broadcast하고 false로 바꾼다. 끄기는 빈도 제한을 받지 않는다(반드시 전달돼야 하므로).
- 채팅이 수락되면 `track.typing = false`. 받는 쪽은 Chat을 받으면 스스로 "…"를 지운다(Task 12).
- `ClientTracking`에 `jumpRate: RateWindow`, `typingRate: RateWindow`, `typing: boolean`을 더한다.

- [ ] **Step 1: 실패하는 테스트 작성.**

```ts
// typing.test.ts
it("accepts only a boolean `on`", () => {
  expect(validateTypingPayload({ on: true })).toBe(true);
  expect(validateTypingPayload({ on: false })).toBe(false);
  for (const bad of [null, undefined, 1, "on", {}, { on: 1 }, { on: "true" }])
    expect(validateTypingPayload(bad)).toBeNull();
});

// WorldRoom.integration.test.ts — 기존 이모지 테스트와 같은 alice/bob 패턴
it("relays a Jump to every client tagged with the sender's sid");   // 두 클라이언트 모두 [{ sid: alice.sessionId }]
it("drops a second Jump inside JUMP_RATE.windowMs — one broadcast"); // 연속 2회 → 길이 1
it("drops a Jump from a seated player");                             // room.state.players.get(sid)!.seatIndex = 1 후 Jump → 0건
it("relays typing on then off to everyone");                         // [{ sid, on: true }, { sid, on: false }]
it("rate-limits typing ON to 1 per 3 s but never drops the OFF");    // on, on, off → [on, off]
it("drops an OFF from a sender that was not typing, and malformed payloads"); // {on:false}, {on:"yes"} → 0건
```

- [ ] **Step 2: 실패 확인.** `npm run test -w server` → 새 테스트 FAIL(메시지 미등록).
- [ ] **Step 3: 구현.** 상수, 메시지, `typing.ts`, 두 핸들러. 핸들러 주석은 `handleEmoji`처럼 바인딩 순서를 적는다.
- [ ] **Step 4: 통과 확인.** `npm run test -w server && npm run test -w shared && npm run typecheck` PASS.
- [ ] **Step 5: stage + 보고.** 제안 커밋 `feat: 점프·입력 중 broadcast 이벤트와 서버 빈도 제한 (조작 개편 Task 2)`.

### Task 3: 선생님 `role` 동기화

**Files:**
- Modify: `shared/src/constants.ts`, `shared/src/schema.ts`(Player 필드와 클래스 주석), Test: `shared/src/schema.smoke.test.ts`
- Modify: `server/src/rooms/WorldRoom.ts:195-204`(onJoin), `AdminMarker` 주석
- Test: `server/src/rooms/WorldRoom.integration.test.ts`(`WorldRoom admin` describe에 추가)
- Modify: `client/src/game/remoteStore.ts`, `client/src/game/remoteSync.ts`, `client/src/game/debug.ts`(`RemoteView`), Test: `client/src/game/remoteStore.test.ts`

**Interfaces:**
- Produces: `ROLE_STUDENT = 0`, `ROLE_TEACHER = 1`. `Player.role`(`@type("uint8")`, 기본 0). `RemotePlayerRecord.role: number`. `getRemotes()`의 각 항목에 `role`.
- 규칙: `onJoin`의 `player.role = isAdmin ? ROLE_TEACHER : ROLE_STUDENT` 한 줄 말고는 role을 쓰는 코드가 없다. 클라이언트는 `onAdd` 때 한 번만 읽는다(세션 동안 바뀌지 않으므로 리스너 없음). 재접속 1단계(토큰)는 상태를 그대로 유지하고, 2단계(새 join)는 관리자 코드 재인증 결과로 다시 정해진다.

- [ ] **Step 1: 실패하는 테스트 작성.**

```ts
// schema.smoke.test.ts
it("Player.role defaults to 0 and round-trips 1"); // new Player() → 0; role = 1; encodeAll → decode → 1

// WorldRoom.integration.test.ts
it("syncs role=1 for an admin join and 0 for a normal join, visible to OTHER clients", async () => {
  // ADMIN_CODE 설정 → 학생 bob 입장 → 선생님 입장
  // expect(bob.state.players.get(adminSid).role).toBe(ROLE_TEACHER); bob 자신은 ROLE_STUDENT
});
it("ignores a client-supplied role in join options", async () => {
  // connectTo(room, { ...JOIN_A, role: 1 }) → role === ROLE_STUDENT
});
it("no client message changes role", async () => {
  // 학생이 Move {x, z, yaw, role: 1}, Chat, Emoji, Sit, Stand를 보낸 뒤에도 role === ROLE_STUDENT
});

// remoteStore.test.ts
it("keeps the synced role on the record and in getRemotes()"); // addRemote({ ..., role: 1 }) → getRemotes()[0].role === 1
```

- [ ] **Step 2: 실패 확인.** 세 워크스페이스 테스트 → 새 테스트 FAIL. `remoteStore.test.ts`의 기존 리터럴에는 `role: 0`을 넣어 typecheck를 맞춘다.
- [ ] **Step 3: 구현.** 스키마 클래스 주석의 "관리자 표시는 상태에 없음"을 "`isAdmin` 마커는 서버 전용, 공개되는 것은 role뿐(controls-ux §5)"으로 고친다.
- [ ] **Step 4: 통과 확인.** `npm run test && npm run typecheck` PASS. 기존 "상태에 isAdmin 문자열이 없다" 단언도 그대로 통과한다.
- [ ] **Step 5: stage + 보고.** 제안 커밋 `feat: Player.role 동기화 — 관리자 인증 때만 서버가 선생님으로 표시 (조작 개편 Task 3)`.

### Task 4: 단축키 표 + 기존 키 처리 옮기기

**Files:**
- Create: `client/src/game/hotkeys.ts`, Test: `client/src/game/hotkeys.test.ts`
- Modify: `client/src/game/CameraRig.tsx:269-295`(V/M/Esc), `client/src/ui/EmojiPalette.tsx:57-69`(1~6), `client/src/ui/ChatInput.tsx:64-75`(Enter와 `/`)

**Interfaces:**
- Produces:

```ts
export type HotkeyAction =
  | { type: "jump" } | { type: "interact" } | { type: "recenter" }
  | { type: "toggleView" } | { type: "toggleMap" } | { type: "menu" }
  | { type: "openChat" } | { type: "emoji"; index: number }
  | { type: "roster"; show: boolean };
export interface KeyLike {
  type: "keydown" | "keyup"; code: string; repeat: boolean;
  isComposing: boolean; defaultPrevented: boolean;
}
export function resolveHotkey(e: KeyLike, uiCaptured: boolean): HotkeyAction | null;
export function hotkeyPreventsDefault(a: HotkeyAction): boolean; // jump, openChat, roster(show)
export function onHotkey(fn: (a: HotkeyAction, e: KeyboardEvent) => void): () => void;
```

- 표(`code` 기준): `Space`→jump, `KeyE`·`KeyF`→interact, `KeyR`→recenter, `KeyV`→toggleView, `KeyM`→toggleMap, `Escape`→menu, `Enter`·`NumpadEnter`·`Slash`→openChat, `Digit1`~`Digit6`→emoji 0~5, `Tab` keydown→roster show, keyup→roster hide.
- keydown은 `defaultPrevented`, `isComposing`, `repeat`, `uiCaptured` 중 하나라도 참이면 null. **`Escape`만은 uiCaptured여도 통과**한다(조교 대화창 입력 중 Esc로 닫기 유지). 채팅창 Esc는 ChatInput이 preventDefault 후 blur하므로 defaultPrevented → null이 된다. keyup은 Tab만 roster hide로 바꾸고, 이것도 uiCaptured와 상관없다.
- `onHotkey`는 window keydown·keyup을 듣고 `hotkeyPreventsDefault`가 참이면 `e.preventDefault()`를 부른다. 포커스가 남은 버튼의 Space·Enter 재활성, Tab 포커스 이동, `/` 빠른 찾기를 막는다.
- T(조교 대화)는 Task 10에서 E로 합치며 지운다. 이 태스크에서는 건드리지 않는다.

- [ ] **Step 1: 실패하는 테스트 작성.**

```ts
const kd = (code: string, o: Partial<KeyLike> = {}): KeyLike =>
  ({ type: "keydown", code, repeat: false, isComposing: false, defaultPrevented: false, ...o });

it("maps the spec key table", () => {
  expect(resolveHotkey(kd("Space"), false)).toEqual({ type: "jump" });
  expect(resolveHotkey(kd("KeyF"), false)).toEqual({ type: "interact" });
  expect(resolveHotkey(kd("Slash"), false)).toEqual({ type: "openChat" });
  expect(resolveHotkey(kd("Digit6"), false)).toEqual({ type: "emoji", index: 5 });
  expect(resolveHotkey(kd("Tab"), false)).toEqual({ type: "roster", show: true });
  // KeyE, KeyR, KeyV, KeyM, Escape, Enter, NumpadEnter, Digit1도 같은 표로 확인
});
it("returns null for every key except Escape while the UI owns the keyboard (Review Focus 1)", () => {
  for (const code of ["Space", "KeyE", "KeyF", "KeyR", "KeyV", "KeyM", "Enter", "Slash", "Digit1", "Tab"])
    expect(resolveHotkey(kd(code), true)).toBeNull();
  expect(resolveHotkey(kd("Escape"), true)).toEqual({ type: "menu" });
  expect(resolveHotkey(kd("Escape", { defaultPrevented: true }), true)).toBeNull();
});
it("ignores auto-repeat and IME composition");
it("Tab keyup hides the roster even while captured");
it("cancels the browser default for jump, openChat and roster (Review Focus 2)", () => {
  expect(hotkeyPreventsDefault({ type: "jump" })).toBe(true);
  expect(hotkeyPreventsDefault({ type: "openChat" })).toBe(true);
  expect(hotkeyPreventsDefault({ type: "emoji", index: 0 })).toBe(false);
});
```

- [ ] **Step 2: 실패 확인.** `npm run test -w client -- hotkeys` → FAIL(모듈 없음).
- [ ] **Step 3: 구현.** `hotkeys.ts`를 만들고 세 리스너를 `onHotkey`로 옮긴다. CameraRig: toggleView(overview 중이면 무시), toggleMap, menu → `clearClickTarget()`. EmojiPalette: emoji → `fire(index)`. ChatInput: openChat → 이미 포커스면 무시, 아니면 `input.focus()`(preventDefault 덕분에 `/`가 입력되지 않는다).
- [ ] **Step 4: 통과 확인.** `npm run test -w client && npm run typecheck` PASS.
- [ ] **Step 5: stage + 보고.** 제안 커밋 `refactor: 단축키 표를 순수 모듈로 모으고 '/' 채팅 열기 추가 (조작 개편 Task 4)`.

### Task 5: 달리기 — 입력·속도·동작

**Files:**
- Modify: `client/src/game/constants.ts`(`CLIP` :213, `MoveControl` :248, `MOVE_KEYS` :251, 원격 달리기 문턱), `client/src/game/input.ts`, `client/src/game/uiCapture.ts`, `client/src/game/locomotion.ts`
- Create: `client/src/game/gait.ts`, Test: `client/src/game/gait.test.ts`
- Test: `client/src/game/uiCapture.test.ts`, `client/src/game/locomotion.test.ts`
- Modify: `client/src/game/LocalPlayer.tsx`(속도 :295-296, idle/walk 크로스페이드), `client/src/game/RemotePlayer.tsx`(걷기 판정 :206-217), `client/src/game/WorldScene.tsx`(`moveInput`), `client/src/ui/TouchJoystick.tsx`(prop 타입만), `client/src/game/debug.ts`

**Interfaces:**
- Produces:

```ts
// constants.ts
export type MoveControl = "forward" | "backward" | "left" | "right" | "run" | "camLeft" | "camRight";
// MOVE_KEYS에 추가: { name: "run", keys: ["ShiftLeft", "ShiftRight"] },
//                  { name: "camLeft", keys: ["KeyZ"] }, { name: "camRight", keys: ["KeyC"] }
CLIP.run = "Running_A";
export const RUN_ON_SPEED = 5.6;  // m/s, 원격 walk→run
export const RUN_OFF_SPEED = 4.8; // m/s, 원격 run→walk

// input.ts
export interface MoveKeys { forward: boolean; backward: boolean; left: boolean; right: boolean; run: boolean }
export type DirKeys = Omit<MoveKeys, "run">;               // readIntent(keys: DirKeys) — 기존 테스트 리터럴 그대로
export interface MoveInput extends Intent { run: boolean } // WorldScene의 공유 moveInput

// uiCapture.ts — guardMoveKeys(keys: MoveKeys, uiCaptured: boolean): MoveKeys (captured면 run까지 모두 false)

// gait.ts
export type Gait = "idle" | "walk" | "run";
export function moveSpeed(run: boolean): number;     // MOVE_SPEED 또는 RUN_SPEED
export function gaitFor(moving: boolean, run: boolean): Gait;
export function gaitClip(g: Gait): string;           // CLIP.idle | CLIP.walk | CLIP.run
export const remoteGaitProbe: Map<string, Gait>;     // DEV 전용, RemotePlayer가 DEV에서만 기록

// locomotion.ts
export function nextGait(current: Gait, speed: number): Gait; // nextWalking 유지 + RUN_ON/OFF 히스테리시스

// debug.ts — window.__cv.getGait(): Gait, window.__cv.getRemoteGaits(): Record<string, Gait>
```

- 달리기 의도 = `keys.run || moveInput.run`. 클릭 이동도 Shift를 누르고 있으면 달린다. 속도는 `moveSpeed(run)`로만 정한다. 앉은 동안의 이동 입력은 지금처럼 일어서기 1회.
- LocalPlayer: `movingRef` 대신 `gaitRef: Gait`. loco 상태에서 `gaitFor(moving, run)`가 바뀌면 `gaitClip(이전)`을 fadeOut, `gaitClip(다음)`을 fadeIn. `installDebugHook`에 5번째 인자 `getGait`를 더한다.
- RemotePlayer: `runAction`을 바인딩하고 `walkingRef`를 `gaitRef` + `nextGait(gaitRef, speed)`로 바꾼다. mixer 규칙의 "걷는 중"은 `gait !== "idle"`.

- [ ] **Step 1: 실패하는 테스트 작성.**

```ts
// gait.test.ts
expect(moveSpeed(false)).toBe(MOVE_SPEED);
expect(moveSpeed(true)).toBeCloseTo(RUN_SPEED, 9);
expect([gaitFor(false, true), gaitFor(true, false), gaitFor(true, true)]).toEqual(["idle", "walk", "run"]);
expect(gaitClip("run")).toBe("Running_A");

// locomotion.test.ts
it("nextGait: walk→run above RUN_ON_SPEED, back below RUN_OFF_SPEED, holds in the band", () => {
  expect(nextGait("walk", RUN_ON_SPEED + 0.01)).toBe("run");
  expect(nextGait("run", (RUN_ON_SPEED + RUN_OFF_SPEED) / 2)).toBe("run");
  expect(nextGait("run", RUN_OFF_SPEED - 0.01)).toBe("walk");
  expect(nextGait("run", 0.1)).toBe("idle");
});
it("a remote walking at MOVE_SPEED with ±30% interpolation jitter never shows the run cycle", () => {
  let g: Gait = "walk";
  for (const s of [2.8, 5.2, 3.1, 5.0, 4.4]) { g = nextGait(g, s); expect(g).not.toBe("run"); }
});

// uiCapture.test.ts (Review Focus 1)
it("zeroes run too while captured — Shift held while typing never runs", () => {
  expect(guardMoveKeys({ ...held, run: true }, true)).toEqual({ ...none, run: false });
});
```

- [ ] **Step 2: 실패 확인.** `npm run test -w client` → 새 테스트 FAIL.
- [ ] **Step 3: 구현.** `TouchJoystick`은 이 태스크에서 prop 타입만 `MoveInput`으로 바꾸고 `run = false`를 쓴다(Task 7에서 교체).
- [ ] **Step 4: 통과 확인.** `npm run test && npm run typecheck` PASS. `npm run dev`에서 Shift+W로 달리기 동작과 속도를 눈으로 확인.
- [ ] **Step 5: stage + 보고.** 제안 커밋 `feat: Shift 달리기(×1.6)와 Running_A 동작, 원격은 보간 속도로 판정 (조작 개편 Task 5)`.

### Task 6: 1인칭 D-패드·시선 동행 제거 (⚠️ 승인된 번복)

**Files:**
- Delete: `client/src/game/dpad.ts`, `client/src/game/dpad.test.ts`, `client/src/ui/TouchDpad.tsx`, `client/src/ui/dpad.css`
- Modify: `client/src/game/viewMode.ts`(`FP_FOLLOW_RATE`, `Dir2`, `lookYawForDir`, `stepFollowYaw` 삭제와 머리 주석), `client/src/game/viewMode.test.ts`
- Modify: `client/src/game/viewState.ts`(`dragging` 삭제), `client/src/game/viewState.test.ts`
- Modify: `client/src/game/CameraRig.tsx:208,248`(`dragging` 쓰기 삭제), `client/src/game/LocalPlayer.tsx:302-308`(FP 분기에서 시선 동행 삭제, 몸 yaw = fpYaw만 유지), `client/src/game/WorldScene.tsx`(`TouchMoveControl` 삭제, `<TouchJoystick>`을 바로 렌더)

**Interfaces:**
- Produces: 1인칭 이동 = 시선 기준 전진·후진·옆걸음(`worldDirection(intent, fpYaw)` 그대로). 시선은 드래그와 Z/C로만 돈다. PC의 A/D도 1인칭에서 옆걸음이 된다.

- [ ] **Step 1: 바뀌는 테스트부터 정리.** `dpad.test.ts` 삭제. `viewMode.test.ts`에서 `lookYawForDir`·`stepFollowYaw` describe와 `FP_FOLLOW_RATE` 단언 삭제(그 테스트 이름은 "exposes a ~0.3s overview blend"로). `viewState.test.ts` reset 기대값에서 `dragging` 삭제.
- [ ] **Step 2: 실패 확인.** `npm run typecheck` → 지운 심볼을 쓰는 코드에서 FAIL.
- [ ] **Step 3: 구현.** 위 파일 정리. `rg "stepFollowYaw|lookYawForDir|FP_FOLLOW_RATE|dragging|dpad|TouchDpad" client/src` 결과가 0줄이어야 한다.
- [ ] **Step 4: 통과 확인.** `npm run test && npm run typecheck` PASS. "1인칭에서 A를 누르면 시선은 그대로이고 옆으로 걷는다"는 Task 18 데스크톱 3단계가 고정한다.
- [ ] **Step 5: stage + 보고.** 제안 커밋 `refactor: 1인칭 D-패드·시선 동행 제거, 일반 3D 게임식 옆걸음 (조작 개편 Task 6, 기획 20·21장 대체)`.

### Task 7: 다이내믹 조이스틱 (nipplejs 대체)

**Files:**
- Modify: `client/src/game/joystick.ts`(기존 `joystickIntent`, `JOYSTICK_DEAD_ZONE` 유지), Test: `client/src/game/joystick.test.ts`
- Rewrite: `client/src/ui/TouchJoystick.tsx`, `client/src/ui/touch.css`
- Modify: `client/package.json`(`npm uninstall nipplejs -w client`)

**Interfaces:**
- Consumes: `MoveInput`, `Gait`(Task 5).
- Produces:

```ts
export const STICK_EDGE_PX = 24;
export const STICK_RADIUS_PX = 56;
export const STICK_RUN_FORCE = 0.9;   // 끝까지 밀면 달리기
export const STICK_RUN_RELEASE = 0.8; // 달리는 중에는 0.8 밑으로 내려야 걷기(깜빡임 방지)
export function isStickZone(x: number, y: number, vw: number, vh: number, leftHanded?: boolean): boolean;
// 오른손: STICK_EDGE_PX <= x < vw/2 && y >= vh/2 · 왼손: vw/2 <= x < vw - STICK_EDGE_PX && y >= vh/2
export function stickReading(ox: number, oy: number, x: number, y: number, radiusPx?: number):
  { vector: JoystickVector; force: number }; // DOM 좌표 입력, vector.y는 위가 +, force = min(1, 거리/반지름), 거리 0이면 0
export function stickGait(force: number, wasRunning: boolean): Gait;
export interface StickState { pointerId: number | null; ox: number; oy: number; running: boolean }
export function createStickState(): StickState;
export function stickDown(s: StickState, id: number, x: number, y: number, vw: number, vh: number, leftHanded: boolean): boolean;
export function stickMove(s: StickState, id: number, x: number, y: number): MoveInput | null; // 내 포인터가 아니면 null
export function stickUp(s: StickState, id: number): boolean;                                   // 내 포인터면 해제하고 true
```

- 컴포넌트: `.cv-stick-zone`(아래 왼쪽 사분면 `left:0; bottom:0; width:50vw; height:50vh`, 왼손 모드면 오른쪽, `touch-action:none`)의 pointerdown → `stickDown`. 가장자리 띠는 false라 이벤트만 삼키고 아무 일도 없다. move와 up은 window에서 듣는다. 받침·손잡이 div는 ref로 `style.transform`만 바꾼다(React state 금지). 손을 떼면 숨기고 `moveInput`을 0, `run = false`로. 언마운트 때도 0으로. `leftHanded`는 prop(기본 false, Task 15에서 설정과 연결).
- 채팅 버튼과 오른쪽 아래 묶음은 z-index가 더 높아서 자기 터치를 가져간다.

- [ ] **Step 1: 실패하는 테스트 작성.**

```ts
describe("isStickZone", () => {
  it("excludes the 24px left edge strip", () => {
    expect(isStickZone(23, 700, 375, 812)).toBe(false);
    expect(isStickZone(24, 700, 375, 812)).toBe(true);
  });
  it("is only the lower-left quarter", () => {
    expect(isStickZone(200, 700, 375, 812)).toBe(false);
    expect(isStickZone(100, 300, 375, 812)).toBe(false);
  });
  it("mirrors in left-handed mode (right edge strip excluded)", () => {
    expect(isStickZone(375 - 23, 700, 375, 812, true)).toBe(false);
    expect(isStickZone(300, 700, 375, 812, true)).toBe(true);
  });
  it("uses the live viewport (landscape after rotation)", () => {
    expect(isStickZone(100, 300, 812, 375)).toBe(true);
  });
});
describe("stickReading / stickGait (walk vs run bands)", () => {
  it("a half-radius drag upward reads forward with force 0.5"); // stickReading(0, 0, 0, -28) → vector ≈ (0, 1), force 0.5
  it("past the rim clamps force to 1");
  it("bands: <0.15 idle, 0.15–0.9 walk, ≥0.9 run; running holds until <0.8", () => {
    expect(stickGait(0.1, false)).toBe("idle");
    expect(stickGait(0.5, false)).toBe("walk");
    expect(stickGait(0.9, false)).toBe("run");
    expect(stickGait(0.85, true)).toBe("run");
    expect(stickGait(0.79, true)).toBe("walk");
  });
});
describe("stick pointer ownership (Review Focus 3)", () => {
  it("ignores a second pointer down while active");  // stickDown(id 2) → false, s.pointerId === 1
  it("ignores moves and ups from other pointers");    // stickMove(id 2) → null, stickUp(id 2) → false
  it("a full-radius drag yields run: true; release resets"); // stickMove(id 1, …).run === true; stickUp(id 1) → true, pointerId null
});
```

- [ ] **Step 2: 실패 확인.** `npm run test -w client -- joystick` → FAIL.
- [ ] **Step 3: 구현.** 순수 함수 → 컴포넌트 재작성 → `npm uninstall nipplejs -w client`.
- [ ] **Step 4: 통과 확인.** `npm run test && npm run typecheck && npm run build` PASS. 375×812 터치 에뮬에서 누른 자리에 스틱이 생기고, 살짝 밀면 걷고, 끝까지 밀면 달리고, 떼면 사라지는지 확인.
- [ ] **Step 5: stage + 보고.** 제안 커밋 `feat: 누른 자리에 생기는 다이내믹 조이스틱 — 걷기/달리기 구간, 왼쪽 24px 제외 (조작 개편 Task 7)`.

### Task 8: 카메라 조작 — Z/C, R 정렬, 두 번 톡, 부드러운 따라가기·줌, 목적지 표시

**Files:**
- Create: `client/src/game/cameraControls.ts`, `client/src/game/tapGesture.ts`(테스트 각각), `client/src/game/ClickMarker.tsx`
- Modify: `client/src/game/viewState.ts`, `client/src/game/viewState.test.ts`, `client/src/game/CameraRig.tsx`, `client/src/game/WorldScene.tsx`(ClickMarker 마운트)

**Interfaces:**
- Consumes: `onHotkey` recenter(Task 4), `useKeyboardControls`의 `camLeft`/`camRight`(Task 5), `stepYaw`·`normalizeAngle`(yaw.ts), `applyZoom`, `SNAP_DISTANCE`, `getClickTarget`.
- Produces:

```ts
// cameraControls.ts
export const CAMERA_KEY_YAW_RATE = 2.2;   // rad/s, Z/C 누르는 동안
export const ORBIT_EASE = { yawRate: 10, pitchRate: 2, distRate: 12, eps: 1e-3 } as const;
export const ZOOM_SMOOTH_RATE = 12;       // 1/s
export const FOLLOW_SMOOTH_RATE = 14;     // 1/s, 3인칭 따라가기
export const CAMERA_LOOK_LIFT = 0.25;     // m, 머리보다 조금 위를 바라봄
export function stepKeyYaw(yaw: number, left: boolean, right: boolean, dt: number, rate?: number): number; // Z(left) → yaw 증가 = 시야가 왼쪽으로
export function recenterYaw(bodyYaw: number): number;    // normalizeAngle(bodyYaw + π): 카메라를 몸 뒤로
export interface OrbitGoal { yaw?: number; pitch?: number; distance?: number }
export function stepOrbitToward(orbit: Orbit, goal: OrbitGoal, dt: number): boolean; // 제자리 수정, 지정한 필드가 모두 eps 안이면 true
export function smoothToward(current: number, target: number, dt: number, rate?: number): number; // target + (current − target)·e^(−rate·dt)
export function stepFollow(cur: { x: number; z: number }, tx: number, tz: number, dt: number): void; // 지수 추종, SNAP_DISTANCE보다 벌어지면 바로 맞춤
export function pinchZoomDelta(prevSpreadPx: number, currSpreadPx: number): number; // (prev − curr) × CAMERA.pinchSpeed

// tapGesture.ts
export const DOUBLE_TAP_MS = 300;
export const DOUBLE_TAP_PX = 30;
export interface TapRecord { t: number; x: number; y: number }
export function isDoubleTap(prev: TapRecord | null, next: TapRecord): boolean;
export function isLookHalf(x: number, vw: number, leftHanded?: boolean): boolean; // 오른손이면 x >= vw/2

// viewState.ts
viewState.orbitGoal: OrbitGoal | null;
viewState.savedOrbit: Orbit | null;            // resetViewMode가 둘 다 null로
export function requestRecenter(bodyYaw: number): void; // TP에서만 orbitGoal = { yaw: recenterYaw(bodyYaw) }
export function cancelOrbitGoal(): void;
```

CameraRig 배선:
- **카메라는 저절로 돌지 않는다.** `orbit.yaw`를 바꾸는 곳은 드래그, Z/C, `orbitGoal`(R, 두 번 톡, 앉기) 셋뿐이다.
- 매 프레임: `isUiCaptured()`가 아니면 Z/C로 TP는 `orbit.yaw`, FP는 `viewState.fpYaw`를 `stepKeyYaw`로 돌린다. TP에서 누르면 `cancelOrbitGoal()`. `orbitGoal`이 있으면 `stepOrbitToward`, 끝나면 null.
- TP 따라가기: `follow` ref에 `stepFollow(follow, pose.x, pose.z, dt)`를 하고 TP 자세의 기준점으로 쓴다(FP 눈 위치는 pose 그대로). 바라보는 높이는 `HEAD_HEIGHT + CAMERA_LOOK_LIFT`.
- 부드러운 줌: `renderDist` ref = `smoothToward(renderDist, orbit.distance, dt)`를 TP 자세 계산에 쓴다. `orbit.distance`는 사용자의 줌 의도로 남아 `applyZoom`·FP 진입 규칙이 그대로다. 핀치는 `pinchZoomDelta`로 delta를 만든다.
- 드래그·휠·핀치는 `cancelOrbitGoal()`.
- 터치 짧은 탭(`pointerType === "touch"`이고 `isClick`): `isLookHalf`이면 `isDoubleTap(lastTap, tap)` → 기다리던 탭 이동 타이머를 취소하고 `requestRecenter(pose.yaw)`. 아니면 `DOUBLE_TAP_MS` 뒤에 바닥 클릭 이동을 실행한다(타이머는 언마운트 때 정리). 시점 쪽이 아닌 탭과 마우스 클릭은 지금처럼 바로 이동한다.
- `ClickMarker`: Canvas 안의 평평한 링 메시. `getClickTarget()`이 있으면 그 자리(y = 0.02)에 보이고 없으면 숨는다. ref로만 갱신.

- [ ] **Step 1: 실패하는 테스트 작성.**

```ts
it("recenterYaw puts the camera behind the body: TP forward equals body facing", () => {
  for (const b of [-2.5, 0, 0.7, 3]) {
    const f = worldDirection({ forward: 1, right: 0 }, recenterYaw(b));
    expect(f.x).toBeCloseTo(Math.sin(b), 6);
    expect(f.z).toBeCloseTo(Math.cos(b), 6);
  }
});
it("recenter half-turn finishes within 0.35 s at 60 fps, then stops (spec §8 멈춤 시간)", () => {
  const o = { yaw: 0, pitch: 0.35, distance: 6 };
  const goal = { yaw: Math.PI - 0.01 };
  let t = 0, done = false;
  while (!done && t < 1) { done = stepOrbitToward(o, goal, 1 / 60); t += 1 / 60; }
  expect(done).toBe(true);
  expect(t).toBeLessThanOrEqual(0.35);
  expect(stepOrbitToward(o, goal, 1 / 60)).toBe(true);
  expect(o.yaw).toBeCloseTo(goal.yaw, 3);
});
it("stepKeyYaw: Z turns left (+), C right (−), both cancel, wraps");
it("smoothToward converges without overshoot and holds at dt = 0");
it("stepFollow lags smoothly and snaps on a jump larger than SNAP_DISTANCE");
it("pinch range: spreading clamps at minDistance then enters FP; pinching in clamps at maxDistance", () => {
  const BAND = { min: CAMERA.minDistance, max: CAMERA.maxDistance }; // CameraRig의 ZOOM_BAND와 같음
  resetViewMode();
  const o = { yaw: 0, pitch: 0.35, distance: 6 };
  for (let i = 0; i < 50; i++) applyZoom(o, pinchZoomDelta(200, 260), BAND);
  expect(viewState.mode).toBe("fp");
  expect(o.distance).toBe(CAMERA.minDistance);
  for (let i = 0; i < 200; i++) applyZoom(o, pinchZoomDelta(260, 200), BAND);
  expect(viewState.mode).toBe("tp");
  expect(o.distance).toBe(CAMERA.maxDistance);
});
it("isDoubleTap: within 300 ms and 30 px only; a null prev is never a double", () => {
  expect(isDoubleTap({ t: 0, x: 0, y: 0 }, { t: 300, x: 30, y: 0 })).toBe(true);
  expect(isDoubleTap({ t: 0, x: 0, y: 0 }, { t: 301, x: 0, y: 0 })).toBe(false);
  expect(isDoubleTap({ t: 0, x: 0, y: 0 }, { t: 100, x: 31, y: 0 })).toBe(false);
  expect(isDoubleTap(null, { t: 0, x: 0, y: 0 })).toBe(false);
});
// viewState.test.ts
it("requestRecenter sets a yaw goal in TP and is a no-op in FP and overview");
it("cancelOrbitGoal clears it; resetViewMode clears orbitGoal and savedOrbit");
```

- [ ] **Step 2: 실패 확인.** `npm run test -w client` → FAIL.
- [ ] **Step 3: 구현.** 순수 함수 → viewState → CameraRig 배선(위 목록) → ClickMarker.
- [ ] **Step 4: 통과 확인.** `npm run test && npm run typecheck` PASS. PC에서 Z/C, R, 휠, 바닥 클릭 목적지 링을 확인하고, 터치 에뮬에서 오른쪽 두 번 톡(정렬)과 한 번 톡(0.3 s 뒤 이동)을 확인.
- [ ] **Step 5: stage + 보고.** 제안 커밋 `feat: Z/C 시점·R 뒤로 정렬·두 번 톡·부드러운 따라가기와 줌·목적지 표시 (조작 개편 Task 8)`.

### Task 9: 벽 뒤 당겨오기(스프링 암) + 앉기 카메라

**Files:**
- Create: `client/src/game/cameraCollision.ts`, Test: `client/src/game/cameraCollision.test.ts`
- Modify: `client/src/game/viewState.ts`(+test), `client/src/game/constants.ts`(`SEAT_CAM`), `client/src/game/CameraRig.tsx`(TP 자세 :325-332), `client/src/game/LocalPlayer.tsx`(앉기·일어서기 확정 분기)

**Interfaces:**
- Consumes: `recenterYaw`, `OrbitGoal`, `stepOrbitToward`(Task 8), `WALLS`·`WALL_HEIGHT`(worldMap), `MAZE_WALLS`(maze), `SEAT_YAW`.
- Produces:

```ts
// cameraCollision.ts
export const CAMERA_BOXES: readonly AABB[]; // [...WALLS, ...MAZE_WALLS], 높이 0..WALL_HEIGHT인 벽
export const SPRING = { minDist: 0.6, pad: 0.2, returnRate: 6 } as const;
export function segmentHitFraction(ax: number, ay: number, az: number, bx: number, by: number, bz: number,
  boxes?: readonly AABB[], height?: number): number; // 처음 들어가는 t ∈ [0, 1), 막힘 없으면 1
export function springArmDistance(headX: number, headY: number, headZ: number,
  camX: number, camY: number, camZ: number, desired: number, boxes?: readonly AABB[]): number;
export function stepSpringDistance(current: number, target: number, dt: number): number; // 들어올 땐 즉시, 나갈 땐 returnRate m/s

// constants.ts
export const SEAT_CAM = { pitch: 0.22, distance: 3.2 } as const;

// viewState.ts
export function beginSeatCamera(orbit: Orbit, seatYaw: number): void;
// savedOrbit이 없을 때만 저장. TP: orbitGoal = { yaw: recenterYaw(seatYaw), ...SEAT_CAM }. FP: fpYaw = recenterYaw(seatYaw)
export function endSeatCamera(): void; // TP: orbitGoal = savedOrbit. 언제나 savedOrbit = null
```

- `segmentHitFraction`: 상자마다 x, y(0..height), z 세 축 slab 판정을 한다. 시작점 A를 품은 상자는 건너뛴다(벽에 붙은 머리가 카메라를 0으로 접지 않도록). 선분의 XZ 경계 상자와 겹치지 않는 상자는 미리 거른다.
- `springArmDistance`: 막히면 `max(SPRING.minDist, t × desired − SPRING.pad)`, 아니면 `desired`.
- CameraRig: 미로 캡·세로 화면 보정을 거친 거리로 원하는 카메라 위치를 구하고 `springArmDistance` → `stepSpringDistance` 결과를 TP 자세에 쓴다. FP 가중치 1에서는 영향이 없다.
- LocalPlayer: `seated && !wasSeated` 분기에서 `beginSeatCamera(orbit, s.yaw)`, `!seated && wasSeated`에서 `endSeatCamera()`.

- [ ] **Step 1: 실패하는 테스트 작성.**

```ts
const WALL = { minX: -5, maxX: 5, minZ: 4, maxZ: 4.3 };
it("returns 1 when clear", () => expect(segmentHitFraction(0, 1.4, 0, 0, 1.4, -10, [WALL])).toBe(1));
it("hits a wall between head and camera at the right fraction", () =>
  expect(segmentHitFraction(0, 1.4, 0, 0, 1.4, 10, [WALL])).toBeCloseTo(0.4, 6));
it("passes over a wall when the segment is above WALL_HEIGHT", () =>
  expect(segmentHitFraction(0, 5, 0, 0, 5, 10, [WALL])).toBe(1));
it("ignores a box that contains the start point");
it("springArmDistance pulls in front of the wall by SPRING.pad, floored at SPRING.minDist", () => {
  expect(springArmDistance(0, 1.4, 0, 0, 1.4, 10, 10, [WALL])).toBeCloseTo(3.8, 6);
  expect(springArmDistance(0, 1.4, 0, 0, 1.4, 10, 10, [{ ...WALL, minZ: 0.05, maxZ: 0.3 }])).toBe(SPRING.minDist);
});
it("stepSpringDistance snaps in and eases out at SPRING.returnRate", () => {
  expect(stepSpringDistance(6, 2, 0.016)).toBe(2);
  expect(stepSpringDistance(2, 6, 0.1)).toBeCloseTo(2.6, 6);
});
// viewState.test.ts
it("beginSeatCamera saves the orbit once and aims the TP goal behind the seat at SEAT_CAM");
it("endSeatCamera makes the saved orbit the goal and clears it");
it("in FP, sitting snaps the look to the screen (+X)"); // enterFp(0); beginSeatCamera(o, SEAT_YAW); worldDirection({forward:1,right:0}, fpYaw) ≈ (1, 0)
```

- [ ] **Step 2: 실패 확인.** `npm run test -w client` → FAIL.
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 통과 확인.** `npm run test && npm run typecheck` PASS. 로비 벽 쪽으로 카메라를 돌려 벽 앞으로 당겨지는지, 강의실 의자에 앉으면 뒤에서 스크린을 보는 각도로 바뀌고 일어서면 돌아오는지 스크린샷으로 확인한다(어색하면 `SEAT_CAM` 값만 조정).
- [ ] **Step 5: stage + 보고.** 제안 커밋 `feat: 스프링 암으로 벽 뒤 카메라 당김, 앉으면 스크린 보는 각도 (조작 개편 Task 9)`.

### Task 10: 상호작용 통합 — E/F와 상황 행동 버튼

**Files:**
- Create: `client/src/game/interact.ts`, Test: `client/src/game/interact.test.ts`
- Create: `client/src/ui/ActionButton.tsx`, `client/src/ui/action.css`
- Delete: `client/src/ui/SitPrompt.tsx`, `client/src/ui/NpcPrompt.tsx`. `sit.css`·`npc.css`에서 `.cv-sit-*`, `.cv-npc-btn`, `.cv-npc-hint` 규칙 삭제(조교 대화창 규칙은 유지)
- Modify: `client/src/game/WorldScene.tsx`

**Interfaces:**
- Consumes: `onHotkey` interact(Task 4), `nearestFreeSeat`·`SEATS`, `nearestNpc`·`npcDistance`·`NPC_TALK_RADIUS`·`NPC_CLOSE_RADIUS`, `useNpcStore`, `sendSit`·`sendStand`.
- Produces:

```ts
export type Interaction = { kind: "sit"; seatIndex: number } | { kind: "stand" } | { kind: "talk"; npc: NpcId };
export interface InteractInput {
  seated: boolean;
  seat: { index: number; dist: number } | null;
  npc: { id: NpcId; dist: number } | null;
  npcPanelOpen: boolean;
}
export function pickInteraction(i: InteractInput): Interaction | null;
// 앉아 있으면 stand. 의자와 조교가 둘 다 있으면 가까운 쪽(같으면 sit). 대화창이 열려 있으면 talk 제외. 아무것도 없으면 null.
export function interactionIcon(i: Interaction): "🪑" | "💬";
export function interactionLabel(i: Interaction): string; // "앉기" | "일어서기" | "조교와 대화"
export function ActionButton(props: { pose: Pose; seat: SeatState }); // 대상 없으면 null 렌더
```

- `ActionButton`은 SitPrompt·NpcPrompt의 5 Hz 근접 틱, 조교에게서 멀어지면 대화창 자동 닫기, `SitRejected` → 채팅 로그 시스템 줄을 그대로 옮겨 하나로 합친다. E/F(interact)는 지금 대상을 실행한다. T 키는 지운다. 미로 포털은 대상이 아니다.
- 터치: 점프 버튼 위 60px 원형(아이콘 + 작은 글자). PC: 오른쪽 아래 작은 버튼 `<kbd>E</kbd> 앉기`(마우스로도 누름).
- 버튼은 `onPointerDown={(e) => e.preventDefault()}`로 포커스를 가져가지 않는다(Review Focus 2).

- [ ] **Step 1: 실패하는 테스트 작성.**

```ts
const base: InteractInput = { seated: false, seat: null, npc: null, npcPanelOpen: false };
it("seated → stand, whatever is nearby", () =>
  expect(pickInteraction({ ...base, seated: true, npc: { id: "hall", dist: 1 } })).toEqual({ kind: "stand" }));
it("the nearer of seat and NPC wins; a tie goes to sit", () => {
  expect(pickInteraction({ ...base, seat: { index: 3, dist: 1.2 }, npc: { id: "hall", dist: 2.5 } }))
    .toEqual({ kind: "sit", seatIndex: 3 });
  expect(pickInteraction({ ...base, seat: { index: 3, dist: 1.4 }, npc: { id: "hall", dist: 0.9 } }))
    .toEqual({ kind: "talk", npc: "hall" });
});
it("no talk while that panel is open; nothing nearby → null");
it("icons and Korean labels", () => {
  expect(interactionIcon({ kind: "talk", npc: "hall" })).toBe("💬");
  expect(interactionLabel({ kind: "stand" })).toBe("일어서기");
});
```

- [ ] **Step 2: 실패 확인.** `npm run test -w client -- interact` → FAIL.
- [ ] **Step 3: 구현.** WorldScene의 `<SitPrompt>`·`<NpcPrompt>`를 `<ActionButton pose={pose} seat={seat} />` 하나로 바꾼다.
- [ ] **Step 4: 통과 확인.** `npm run test && npm run typecheck` PASS. 의자 옆 E로 앉고 다시 E로 일어서기, 조교 옆 F로 대화창 열기.
- [ ] **Step 5: stage + 보고.** 제안 커밋 `feat: E/F와 상황 행동 버튼으로 앉기·대화 통합 (조작 개편 Task 10)`.

### Task 11: 점프

**Files:**
- Create: `client/src/game/jump.ts`, Test: `client/src/game/jump.test.ts`
- Create: `client/src/net/jumpSync.ts`, `client/src/ui/JumpButton.tsx`(스타일은 `action.css`)
- Modify: `client/src/net/connection.ts`(`sendJump`), `client/src/game/constants.ts`(`CLIP.jump`), `client/src/game/LocalPlayer.tsx`, `client/src/game/RemotePlayer.tsx`, `client/src/game/WorldScene.tsx`, `client/src/game/debug.ts`(`getJumps()`)
- Modify(문서): `docs/superpowers/specs/2026-10-31-character-builder-design.md` §5.1. "점프 계열"을 `Jump_Full_Short`로, "동작 클립 5개"를 7개(Idle, Walking_A, Running_A, Jump_Full_Short, Sit_Chair_Down, Sit_Chair_Idle, Sit_Chair_StandUp)로 고친다(controls-ux §5 "그 설계 5.1에 반영한다").

**Interfaces:**
- Consumes: `JUMP_RATE`, `JUMP_DURATION_MS`, `MessageType.Jump`, `JumpBroadcast`(Task 2), `onHotkey` jump(Task 4), `gaitClip`(Task 5).
- Produces:

```ts
export const JUMP_HEIGHT_M = 0.45;
export const JUMP_CLIENT_COOLDOWN_MS = JUMP_RATE.windowMs + 50; // 네트워크 흔들림 여유: 서버가 버릴 점프를 로컬에서 보여 주지 않음
CLIP.jump = "Jump_Full_Short";
export interface JumpEntry { sid: string; startedAt: number; seq: number }
export class JumpRegistry {
  set(sid: string, now: number): void; get(sid: string, now: number): JumpEntry | null;
  remove(sid: string): void; clear(): void; snapshot(now: number): JumpEntry[];
}
export const jumpRegistry: JumpRegistry;
export function jumpOffsetY(elapsedMs: number): number; // 4h·t(1 − t), t = elapsed / JUMP_DURATION_MS, 범위 밖은 0
export function localJump(sid: string, seated: boolean, now: number, send: () => void): boolean;
export function resetLocalJump(): void;                 // LocalPlayer 마운트·언마운트 때

// jumpSync.ts
export function startJumpSync(room: Room<WorldState>, selfSid: string): () => void; // 내 sid 메아리는 무시(이미 로컬 재생)
// connection.ts
export function sendJump(): void;
```

- 내 점프는 누르는 즉시 로컬에서 재생하고(`localJump`) 서버로 보낸다. 다른 화면은 broadcast를 받아 재생한다.
- 재생(LocalPlayer·RemotePlayer 공통): 프레임마다 `jumpRegistry.get(sid, now)` → 아바타 그룹 `position.y = jumpOffsetY(now − startedAt)`(화면 표시만이고 서버 y는 그대로). 새 `seq`면 `CLIP.jump`를 한 번 재생하되 `timeScale = clip.duration / (JUMP_DURATION_MS / 1000)`(≈1.94), 끝나면 지금 gait 클립으로 크로스페이드. RemotePlayer는 점프 중을 transient로 보고 mixer를 매 프레임 돌린다. 언마운트 때 `jumpRegistry.remove(sid)`.
- Space(PC)는 LocalPlayer의 `onHotkey` jump가, `JumpButton`(터치 전용 72px)은 `localJump(sid, seat.index >= 0, performance.now(), sendJump)`를 부른다.

- [ ] **Step 1: 실패하는 테스트 작성.**

```ts
it("jumpOffsetY: 0 at both ends, peak JUMP_HEIGHT_M at the midpoint, 0 outside", () => {
  expect(jumpOffsetY(0)).toBe(0);
  expect(jumpOffsetY(JUMP_DURATION_MS / 2)).toBeCloseTo(JUMP_HEIGHT_M, 6);
  expect(jumpOffsetY(JUMP_DURATION_MS)).toBe(0);
  expect(jumpOffsetY(-1)).toBe(0);
  expect(jumpOffsetY(900)).toBe(0);
});
it("registry: active for JUMP_DURATION_MS, a re-jump bumps seq, then expires");
it("localJump refuses while seated (Review Focus 4) and inside the client cooldown", () => {
  resetLocalJump();
  const sent: number[] = [];
  const send = () => sent.push(1);
  expect(localJump("me", true, 1000, send)).toBe(false);
  expect(localJump("me", false, 1000, send)).toBe(true);
  expect(sent).toHaveLength(1);
  expect(jumpRegistry.get("me", 1001)).not.toBeNull();
  expect(localJump("me", false, 1000 + JUMP_RATE.windowMs, send)).toBe(false);
  expect(localJump("me", false, 1000 + JUMP_CLIENT_COOLDOWN_MS, send)).toBe(true);
});
```

- [ ] **Step 2: 실패 확인.** `npm run test -w client -- jump` → FAIL.
- [ ] **Step 3: 구현.** 클립 이름 재확인(네 줄 모두 `true true`여야 함):
  `node -e "const fs=require('fs');for(const m of ['knight','barbarian','mage','rogue']){const b=fs.readFileSync('client/public/models/'+m+'.glb');const j=JSON.parse(b.subarray(20,20+b.readUInt32LE(12)));const n=j.animations.map(a=>a.name);console.log(m,n.includes('Jump_Full_Short'),n.includes('Running_A'))}"`
- [ ] **Step 4: 통과 확인.** `npm run test && npm run typecheck` PASS. 두 탭에서 Space → 양쪽 모두 1.0 m, 0.8 s 깡총. 앉은 채 Space → 아무 일 없음.
- [ ] **Step 5: stage + 보고.** 제안 커밋 `feat: Space·점프 버튼 깡총 — 이벤트 방송, 서버 y 고정 유지 (조작 개편 Task 11)`.

### Task 12: 입력 중 표시 — 보내기·받기

**Files:**
- Create: `client/src/game/typing.ts`, Test: `client/src/game/typing.test.ts`
- Create: `client/src/net/typingSync.ts`
- Modify: `client/src/net/connection.ts`(`sendTyping`), `client/src/ui/ChatInput.tsx`, `client/src/ui/Chat.tsx`(sync 시작), `client/src/game/RemotePlayer.tsx`(언마운트 때 remove), `client/src/game/debug.ts`(`getTyping()`)

**Interfaces:**
- Consumes: `TYPING_RATE`, `TYPING_TTL_MS`, `MessageType.Typing`, `TypingBroadcast`(Task 2).
- Produces:

```ts
export interface TypingSender { onInput(nowMs: number, nonEmpty: boolean): void; stop(): void }
export function createTypingSender(send: (on: boolean) => void, intervalMs?: number): TypingSender;
// 비어 있지 않은 입력이고 now − lastOnAt ≥ intervalMs(처음엔 −∞)이면 send(true) — 서버 제한(3 s당 1회)을 그대로 따른다.
// 입력이 비면 켜져 있을 때만 send(false). stop()도 켜져 있을 때만 send(false).
export class TypingRegistry {
  set(sid: string, now: number): void; remove(sid: string): void; clear(): void;
  isTyping(sid: string, now: number): boolean; // 마지막 ON 뒤 TYPING_TTL_MS가 지나면 false
  snapshot(now: number): string[];
}
export const typingRegistry: TypingRegistry;
// typingSync.ts
export function startTypingSync(room: Room<WorldState>): () => void; // on → set, off → remove, Chat 수신 → remove(m.sid), 정리 때 clear
// connection.ts
export function sendTyping(on: boolean): void;
```

- ChatInput: `onChange` → `sender.onInput(performance.now(), value.trim().length > 0)`. 보내기, blur, 언마운트 → `sender.stop()`.

- [ ] **Step 1: 실패하는 테스트 작성.**

```ts
it("ON at the first keystroke, heartbeat at most once per TYPING_RATE.windowMs, OFF when cleared", () => {
  const sent: boolean[] = [];
  const s = createTypingSender((on) => sent.push(on));
  s.onInput(0, true); s.onInput(100, true); s.onInput(2999, true);
  expect(sent).toEqual([true]);
  s.onInput(3000, true);
  expect(sent).toEqual([true, true]);
  s.onInput(3100, false);
  expect(sent).toEqual([true, true, false]);
});
it("mirrors the server limit: an ON right after an OFF waits for the 3 s window"); // on@0, off@500, input@1000 → 없음, input@3000 → ON
it("stop() sends exactly one OFF, and nothing when not typing");
it("registry expires TYPING_TTL_MS after the last ON — sender vanished (Review Focus 5)", () => {
  const r = new TypingRegistry();
  r.set("a", 0);
  expect(r.isTyping("a", TYPING_TTL_MS - 1)).toBe(true);
  expect(r.isTyping("a", TYPING_TTL_MS)).toBe(false);
});
it("remove() clears at once (chat received or avatar left); clear() on teardown");
```

- [ ] **Step 2: 실패 확인.** `npm run test -w client -- typing` → FAIL.
- [ ] **Step 3: 구현.** "…"를 그리는 일은 Task 14의 이름표가 한다.
- [ ] **Step 4: 통과 확인.** `npm run test && npm run typecheck` PASS. 두 탭: A가 입력하면 B의 `__cv.getTyping()`에 A가 있고, A가 보내면 바로 빠진다.
- [ ] **Step 5: stage + 보고.** 제안 커밋 `feat: 채팅 입력 중 이벤트 보내기·받기 (조작 개편 Task 12)`.

# 2단계: 이름표·말풍선

### Task 13: 이름표 모양·뱃지·크기 제한·거리 페이드

**Files:**
- Modify: `client/src/game/nametag.ts`(전면 개편), `client/src/game/constants.ts`(`NAMETAG_MAX_DIST` :354 삭제·대체), `client/src/game/npc.ts`(`NPC_TAG_TEXT`), `client/src/game/NpcCharacter.tsx`, `client/src/game/RemotePlayer.tsx`(:96, :229-231)
- Create: `client/src/game/nametagLayout.ts`, Test: `client/src/game/nametagLayout.test.ts`

**Interfaces:**
- Consumes: `ROLE_TEACHER`, `RemotePlayerRecord.role`(Task 3).
- Produces:

```ts
// constants.ts
export const NAMETAG_FADE_START = 25;  // m, 여기서부터 서서히
export const NAMETAG_FADE_END = 30;    // m, 0
export const NAMETAG_TEXT_PX = { min: 12, max: 16 } as const;
export const NAMETAG_FADE_RATE = 4;    // 불투명도/초 — 갑자기 사라지지 않게
export const NAMETAG_BASE_HEIGHT_M = 0.30;
export const NAMETAG_FONT_PX = 48;
export const NAMETAG_PAD_Y_PX = 14;
export const NAMETAG_TEXT_FRACTION = NAMETAG_FONT_PX / (NAMETAG_FONT_PX + 2 * NAMETAG_PAD_Y_PX);

// nametag.ts
export type NametagBadge = "none" | "teacher" | "ai";
export interface Nametag {
  sprite: Sprite;
  setHeight(heightM: number): void;  // 폭은 지금 변형의 가로세로 비율
  setOpacity(opacity: number): void; // 0.01 이하면 sprite.visible = false
  setOffsetY(offsetM: number): void; // NAMETAG_HEIGHT + offset
  setHighlight(on: boolean): void;   // 테두리 강조 변형
  setTyping(on: boolean): void;      // 끝에 " …"가 붙은 변형
  dispose(): void;
}
export function createNametag(text: string, badge?: NametagBadge): Nametag;

// nametagLayout.ts
export function nametagWorldHeight(distM: number, fovRad: number, viewportHpx: number): number;
export function distanceFade(distM: number): number;
export function stepOpacity(current: number, target: number, dt: number, rate?: number): number;

// npc.ts
export const NPC_TAG_TEXT = "조교"; // "AI" 뱃지와 합쳐 "AI 조교"로 읽힘
```

- 모양: 흰 둥근 캡슐(`rgba(255,255,255,0.92)`), 진한 글씨 `#1d1b2e` 굵기 600. 선생님: 3px 색 테두리 `#e0a100`과 앞에 "👑 ". AI: 앞에 "AI" 알약(배경 `#5b4bd8`, 흰 글씨). 강조: 4px 테두리 `#4f8cff`. 색은 새 세계관 디자인이 정해지면 바뀐다(spec §7).
- 텍스처 캐시 키는 `badge|highlight|typing|text`이고 지금처럼 참조 카운트로 마지막 소유자가 해제한다. 변형은 처음 쓸 때 만든다.
- `nametagWorldHeight`: 자연 글자 px = `NAMETAG_BASE_HEIGHT_M × NAMETAG_TEXT_FRACTION × vpH / (2·d·tan(fov/2))`(d는 0.5 m 하한)를 `NAMETAG_TEXT_PX` 범위로 자른 뒤, 같은 식을 거꾸로 써서 월드 높이로 돌린다.
- 이 태스크에서는 RemotePlayer가 아바타마다 `distanceFade`, `nametagWorldHeight`, `stepOpacity`를 적용한다(20 m 즉시 숨김 대체). 전역 선택은 Task 14가 맡는다.

- [ ] **Step 1: 실패하는 테스트 작성.**

```ts
const FOV = (55 * Math.PI) / 180;
const textPx = (h: number, d: number, vpH: number) =>
  (h * NAMETAG_TEXT_FRACTION * vpH) / (2 * Math.max(d, 0.5) * Math.tan(FOV / 2));
it("keeps projected text within 12–16 px at every distance (spec §6)", () => {
  for (const vpH of [812, 800]) for (const d of [0.5, 1, 3, 8, 15, 25, 40]) {
    const px = textPx(nametagWorldHeight(d, FOV, vpH), d, vpH);
    expect(px).toBeGreaterThanOrEqual(12 - 1e-6);
    expect(px).toBeLessThanOrEqual(16 + 1e-6);
  }
});
it("returns the natural size where it already fits the band"); // 그 거리에서는 NAMETAG_BASE_HEIGHT_M 그대로
it("distanceFade: 1 up to 25 m, 0.5 at 27.5 m, 0 from 30 m", () => {
  expect(distanceFade(25)).toBe(1);
  expect(distanceFade(27.5)).toBeCloseTo(0.5, 6);
  expect(distanceFade(30)).toBe(0);
});
it("stepOpacity moves NAMETAG_FADE_RATE per second and never overshoots", () => {
  expect(stepOpacity(1, 0, 0.1)).toBeCloseTo(0.6, 6);
  expect(stepOpacity(0.1, 0, 0.1)).toBe(0);
});
```

- [ ] **Step 2: 실패 확인.** `npm run test -w client -- nametagLayout` → FAIL.
- [ ] **Step 3: 구현.** NpcCharacter는 `createNametag(NPC_TAG_TEXT, "ai")`, RemotePlayer는 `createNametag(nickname, record.role === ROLE_TEACHER ? "teacher" : "none")`.
- [ ] **Step 4: 통과 확인.** `npm run test && npm run typecheck` PASS. 선생님·조교·학생 이름표를 가까이, 15 m, 27 m에서 스크린샷.
- [ ] **Step 5: stage + 보고.** 제안 커밋 `feat: 흰 캡슐 이름표와 선생님 👑·AI 뱃지, 글자 12~16px, 25 m 페이드 (조작 개편 Task 13)`.

### Task 14: 이름표 시스템 — 선택·겹침 쌓기·가림·말풍선 붙이기

**Files:**
- Create: `client/src/game/nametagSelect.ts`, Test: `client/src/game/nametagSelect.test.ts`
- Create: `client/src/game/labelRegistry.ts`, `client/src/game/NametagSystem.tsx`
- Modify: `client/src/game/RemotePlayer.tsx`(Task 13의 아바타별 페이드를 지우고 등록), `client/src/game/NpcCharacter.tsx`(pinned로 등록), `client/src/game/useSpeechBubble.ts`, `client/src/game/bubbleSprite.ts`(`heightM` 노출), `client/src/game/WorldScene.tsx`(Canvas 안에 `<NametagSystem />`), `client/src/game/constants.ts`, `client/src/game/debug.ts`

**Interfaces:**
- Consumes: `Nametag`, `nametagWorldHeight`, `distanceFade`, `stepOpacity`(Task 13), `segmentHitFraction`·`CAMERA_BOXES`(Task 9), `smoothToward`(Task 8), `typingRegistry`(Task 12), `bubbleRegistry`.
- Produces:

```ts
// constants.ts
export const NAMETAG_CAP = 15;
export const NAMETAG_SELECT_INTERVAL_MS = 200; // 선택·쌓기는 5 Hz
export const NAMETAG_OCCLUSION_PER_FRAME = 8;  // 가림 검사는 프레임마다 8명씩
export const NAMETAG_OCCLUDED_OPACITY = 0.35;
export const NAMETAG_HIGHLIGHT_MS = 1000;
export const DECLUTTER = { maxSteps: 3, gapPx: 2 } as const;
export const BUBBLE_GAP_M = 0.06;

// nametagSelect.ts
export type NametagMode = "all" | "nearby" | "off";
export interface NametagCandidate { id: string; dist: number; onScreen: boolean; speaking: boolean; pinned: boolean }
export function selectNametags(c: readonly NametagCandidate[], mode: NametagMode, cap?: number): Set<string>;
export interface TagRect { id: string; x: number; y: number; w: number; h: number; dist: number } // 화면 px, 중심
export function declutter(rects: readonly TagRect[], maxSteps?: number, gapPx?: number): Map<string, number>; // 위로 올릴 px
export function roundRobinIndices(cursor: number, total: number, count: number): number[];

// labelRegistry.ts
export interface LabelEntry { id: string; anchor: Object3D; tag: Nametag; pinned: boolean; bubbleAnchor: { y: number } }
export function registerLabel(e: LabelEntry): () => void;
export function labelEntries(): readonly LabelEntry[]; // 등록·해제 때만 새 배열
export function setNametagMode(m: NametagMode): void;   // 기본 "nearby", Task 15에서 설정과 연결
export function getNametagMode(): NametagMode;

// useSpeechBubble.ts — 말풍선 y = (anchor?.y ?? BUBBLE_BASE_HEIGHT) + bubble.heightM / 2, 매 프레임
export function useSpeechBubble(sessionId: string, groupRef: RefObject<Group | null>, anchor?: { y: number }): void;

// debug.ts
// __cv.getNametags(): { id: string; selected: boolean; opacity: number; occluded: boolean }[]
// __cv.getNametagCostMs(): number  // 최근 120프레임 평균
```

선택 규칙(spec §6: 가까운 15명 ∪ 말하는 사람 ∪ 선생님):

```ts
export function selectNametags(cands, mode, cap = NAMETAG_CAP) {
  const out = new Set<string>();
  if (mode === "off") return out;
  const eligible = cands.filter((c) => c.onScreen && c.dist < NAMETAG_FADE_END);
  if (mode === "all") { for (const c of eligible) out.add(c.id); return out; }
  for (const c of eligible) if (c.speaking || c.pinned) out.add(c.id);
  const byDist = [...eligible].sort((a, b) => a.dist - b.dist || (a.id < b.id ? -1 : 1));
  for (const c of byDist.slice(0, cap)) out.add(c.id);
  return out;
}
```

겹침 쌓기(가까운 이름표가 자리를 지키고 먼 이름표가 위로 비켜 쌓인다):

```ts
export function declutter(rects, maxSteps = DECLUTTER.maxSteps, gapPx = DECLUTTER.gapPx) {
  const order = [...rects].sort((a, b) => a.dist - b.dist || (a.id < b.id ? -1 : 1));
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  const lifts = new Map<string, number>();
  for (const r of order) {
    let lift = 0;
    for (let step = 0; ; step++) {
      const y = r.y - lift; // 화면 y는 아래로 커지므로 올리기 = y 감소
      const hit = placed.some(
        (p) => Math.abs(p.x - r.x) * 2 < p.w + r.w && Math.abs(p.y - y) * 2 < p.h + r.h + 2 * gapPx,
      );
      if (!hit || step === maxSteps) break;
      lift += r.h + gapPx;
    }
    placed.push({ x: r.x, y: r.y - lift, w: r.w, h: r.h });
    lifts.set(r.id, lift);
  }
  return lifts;
}
```

NametagSystem 한 프레임(Vector3·Frustum·후보 배열은 재사용해서 할당 없음):
1. 등록된 이름표마다 머리 위치(`anchor` 월드 위치 + `NAMETAG_HEIGHT`), 카메라 거리, 화면 안 여부(Frustum)를 갱신한다.
2. `NAMETAG_SELECT_INTERVAL_MS`마다: `speaking = bubbleRegistry.get(id, now) !== null`, `pinned` = 선생님·조교·내 이름표로 후보를 만들어 `selectNametags`를 돌리고, 선택된 이름표를 화면에 투영해 `declutter`. px는 `px × 2·d·tan(fov/2) / vpH`로 m가 된다.
3. 매 프레임 `roundRobinIndices`로 8개씩 `segmentHitFraction(카메라, 머리, CAMERA_BOXES) < 1`을 보고 가림 표시를 갱신한다.
4. 이름표마다: 목표 불투명도 = 선택됨 ? `distanceFade(d) × (가림 ? NAMETAG_OCCLUDED_OPACITY : 1)` : 0을 `stepOpacity`로 따라가고, `setHeight(nametagWorldHeight(...))`, 올림 값은 `smoothToward`로 부드럽게 `setOffsetY`, `setTyping(typingRegistry.isTyping(id, now))`, 말풍선 seq가 바뀌면 `NAMETAG_HIGHLIGHT_MS` 동안 `setHighlight(true)`, `bubbleAnchor.y = NAMETAG_HEIGHT + offset + height / 2 + BUBBLE_GAP_M`.
5. 이 루프에 걸린 시간을 `getNametagCostMs`용 링버퍼에 기록한다(DEV에서만).

- [ ] **Step 1: 실패하는 테스트 작성.**

```ts
const cand = (i: number, o: Partial<NametagCandidate> = {}): NametagCandidate =>
  ({ id: `p${String(i).padStart(3, "0")}`, dist: 1 + i * 0.2, onScreen: true, speaking: false, pinned: false, ...o });

it("100 on-screen students → exactly the 15 nearest", () => {
  const s = selectNametags(Array.from({ length: 100 }, (_, i) => cand(i)), "nearby");
  expect(s.size).toBe(15);
  expect(s.has("p000")).toBe(true);
  expect(s.has("p015")).toBe(false);
});
it("adds far speakers and teachers on top of the nearest 15", () => {
  const c = Array.from({ length: 100 }, (_, i) => cand(i));
  c[90] = cand(90, { speaking: true });
  c[95] = cand(95, { pinned: true });
  const s = selectNametags(c, "nearby");
  expect(s.size).toBe(17);
  expect(s.has("p090") && s.has("p095")).toBe(true);
});
it("never shows off-screen or ≥ 30 m candidates, even speakers");
it("mode 'all' keeps every eligible; mode 'off' shows none");
it("declutter: separate tags stay put; the farther of two overlapping lifts by h + gap; a third stacks above both", () => {
  const a = { id: "a", x: 100, y: 100, w: 80, h: 20, dist: 5 };
  const b = { ...a, id: "b", x: 110, dist: 6 };
  const c = { ...a, id: "c", x: 105, dist: 7 };
  const l = declutter([c, b, a]);
  expect(l.get("a")).toBe(0);
  expect(l.get("b")).toBe(22);
  expect(l.get("c")).toBe(44);
});
it("declutter gives up after maxSteps lifts (bounded work)");
it("roundRobinIndices visits every label and wraps", () => {
  expect(roundRobinIndices(8, 10, 8)).toEqual([8, 9, 0, 1, 2, 3, 4, 5]);
  expect(roundRobinIndices(0, 0, 8)).toEqual([]);
});
```

- [ ] **Step 2: 실패 확인.** `npm run test -w client -- nametagSelect` → FAIL.
- [ ] **Step 3: 구현.** 순수 함수 → 등록부 → NametagSystem → 등록(RemotePlayer는 `pinned = role === ROLE_TEACHER`, NPC는 `pinned = true`) → 말풍선 앵커 연결.
- [ ] **Step 4: 통과 확인.** `npm run test && npm run typecheck` PASS. 두 탭으로 확인: 벽 뒤 이름표가 흐려지고, 말하면 테두리가 1초 강조되며 말풍선이 이름표 바로 위에 붙고, 입력 중이면 "…"가 보인다.
- [ ] **Step 5: stage + 보고.** 제안 커밋 `feat: 이름표 선택(가까운 15명+말하는 사람+선생님)·겹침 쌓기·가림 흐림·말풍선 연결 (조작 개편 Task 14)`.

# 3단계: HUD·설정·첫 안내

### Task 15: 설정 저장소 + 메뉴(Esc)

**Files:**
- Create: `client/src/game/settings.ts`, Test: `client/src/game/settings.test.ts`
- Create: `client/src/stores/settingsStore.ts`, `client/src/ui/MenuPanel.tsx`, `client/src/ui/menu.css`
- Modify: `client/src/game/hotkeys.ts`(+test: `resolveEscape`), `client/src/ui/NpcChatPanel.tsx:56-62`(자체 Esc 리스너 삭제), `client/src/ui/TouchJoystick.tsx`·`client/src/game/CameraRig.tsx`(왼손잡이, 감도), `client/src/game/labelRegistry.ts`(모드), `client/src/game/LocalPlayer.tsx`(내 이름표), `client/src/game/WorldScene.tsx`(html 클래스와 CSS 변수)

**Interfaces:**
- Consumes: `NametagMode`, `registerLabel`, `setNametagMode`(Task 14), `isStickZone`의 `leftHanded`(Task 7), `isLookHalf`(Task 8), `toggleViewMode`.
- Produces:

```ts
// settings.ts
export type ButtonSize = "small" | "medium" | "large";
export interface Settings {
  buttonSize: ButtonSize; leftHanded: boolean; lookSensitivity: number;
  nametagMode: NametagMode; showOwnNametag: boolean; coachDone: boolean;
}
export const DEFAULT_SETTINGS: Settings; // "medium", false, 1, "nearby", false, false
export const SENSITIVITY = { min: 0.5, max: 2, step: 0.25 } as const;
export const BUTTON_SCALE: Record<ButtonSize, number>; // 0.85 / 1 / 1.25
export const MIN_TOUCH_PX = 48;
export const MIN_GAP_PX = 8;
export function parseSettings(raw: string | null): Settings; // 필드마다 검증: 숫자는 범위로 자르고 step에 맞추고, 잘못된 값·타입은 기본값
export function buttonPx(basePx: number, size: ButtonSize): number; // max(48, round(base × scale))

// settingsStore.ts — localStorage "cv-settings-v1" (soundStore처럼 try/catch)
export const useSettingsStore: UseBoundStore<StoreApi<{ settings: Settings; update(p: Partial<Settings>): void }>>;

// hotkeys.ts
export type EscapeAction = "closeNpc" | "closeRoster" | "closeMenu" | "openMenu";
export function resolveEscape(s: { npcOpen: boolean; rosterOpen: boolean; menuOpen: boolean }): EscapeAction;
```

- 적용: `<html>`에 `cv-left-handed` 클래스와 `--cv-btn-scale` 변수를 둔다. 드래그 회전 = `CAMERA.dragSpeed × lookSensitivity`. 이름표 모드는 `setNametagMode`로 보낸다. `showOwnNametag`이면 LocalPlayer가 자기 이름표를 pinned로 등록한다(`appStore.isAdmin`이면 teacher 뱃지).
- 메뉴 문구(고정): 제목 "메뉴". 설정: "버튼 크기"(작게/보통/크게), "왼손잡이 모드", "시점 감도"(슬라이더), "이름표 보기"(모두/가까운 사람만/끄기), "내 이름표 보기". 보기: "1인칭으로 보기 (V)". 도움말: "조작 안내 다시 보기"(Task 17에서 연결). "닫기" 버튼.
- 메뉴는 ☰ 버튼(Task 16)과 Esc로 연다. Esc는 `resolveEscape` 한 곳에서만 처리한다: 조교 대화창 → 접속자 목록 → 메뉴 순으로 닫고, 열린 것이 없으면 메뉴를 연다.

- [ ] **Step 1: 실패하는 테스트 작성.**

```ts
it("defaults for null, bad JSON and non-objects", () => {
  for (const raw of [null, "{", "42", "[]"]) expect(parseSettings(raw)).toEqual(DEFAULT_SETTINGS);
});
it("keeps valid fields and fixes invalid ones per field", () => {
  expect(parseSettings(JSON.stringify({ leftHanded: true, lookSensitivity: 9, nametagMode: "loud", buttonSize: "large" })))
    .toEqual({ ...DEFAULT_SETTINGS, leftHanded: true, lookSensitivity: 2, buttonSize: "large" });
  expect(parseSettings(JSON.stringify({ lookSensitivity: 1.1 })).lookSensitivity).toBe(1);
});
it("buttonPx never drops below 48 px", () => {
  expect(buttonPx(56, "small")).toBe(48);
  expect(buttonPx(72, "small")).toBe(61);
  expect(buttonPx(72, "large")).toBe(90);
});
it("resolveEscape: NPC panel first, then roster, then the menu toggle", () => {
  expect(resolveEscape({ npcOpen: true, rosterOpen: true, menuOpen: true })).toBe("closeNpc");
  expect(resolveEscape({ npcOpen: false, rosterOpen: true, menuOpen: false })).toBe("closeRoster");
  expect(resolveEscape({ npcOpen: false, rosterOpen: false, menuOpen: true })).toBe("closeMenu");
  expect(resolveEscape({ npcOpen: false, rosterOpen: false, menuOpen: false })).toBe("openMenu");
});
```

- [ ] **Step 2: 실패 확인.** `npm run test -w client -- settings hotkeys` → FAIL.
- [ ] **Step 3: 구현.** 접속자 목록 열림 여부는 Task 16 전까지 늘 false다.
- [ ] **Step 4: 통과 확인.** `npm run test && npm run typecheck` PASS. 설정을 바꾸고 새로고침해도 유지되는지, 왼손잡이 모드에서 조이스틱이 오른쪽에 생기는지 확인.
- [ ] **Step 5: stage + 보고.** 제안 커밋 `feat: Esc 메뉴와 설정 — 버튼 크기·왼손잡이·시점 감도·이름표 보기 (조작 개편 Task 15)`.

### Task 16: HUD 배치 — 위 정보·버튼, 채팅 버튼, 오른쪽 아래 묶음, 접속자 목록, 지도 방 이름

**Files:**
- Create: `client/src/game/hud.ts`, Test: `client/src/game/hud.test.ts`
- Create: `client/src/ui/HudTop.tsx`, `client/src/ui/HudButton.tsx`, `client/src/ui/RosterPanel.tsx`, `client/src/ui/EmojiFan.tsx`, `client/src/ui/hud.css`, `client/src/game/OverviewLabels.tsx`
- Delete: `client/src/ui/ViewToggle.tsx`(1인칭은 V, 핀치, 메뉴로)
- Modify: `client/src/ui/OverviewToggle.tsx`·`SoundToggle.tsx`(HudTop 안의 `HudButton`으로), `client/src/ui/EmojiPalette.tsx`(`useEmojiFire()` 훅으로 분리, PC 한 줄 팔레트 유지), `client/src/ui/ChatInput.tsx`와 `chat.css`(터치: 💬 버튼), `client/src/ui/ChatLog.tsx`와 `chat.css`(PC 로그를 왼쪽 아래로), `view.css`·`sound.css`·`emoji.css`·`touch.css`·`admin.css`·`action.css`(아래 표), `client/src/game/WorldScene.tsx`

**Interfaces:**
- Consumes: `buttonPx`, `MIN_TOUCH_PX`, `MIN_GAP_PX`, `useSettingsStore`(Task 15), `onHotkey` roster(Task 4), `resolveEscape`의 `rosterOpen`, `getRoster`·`getRemoteRecord`(role), `ZONES`, `OV_VIS_BLEND`.
- Produces:

```ts
// hud.ts
export const ZONE_LABELS: Record<keyof typeof ZONES, string>; // maze "미로방", lounge "로비", lectureHall "강의실", gallery "AI 갤러리"
export function zoneLabelAt(x: number, z: number): string;    // gallery → maze → lectureHall → lounge 순서로 판정, 밖이면 ""
export interface RosterRow { sid: string; nickname: string; teacher: boolean; self: boolean }
export function rosterRows(self: RosterRow, remotes: readonly RosterRow[]): RosterRow[]; // 선생님 → 나 → 나머지(localeCompare "ko")
export function fanRadius(btnPx: number, count: number): number; // 위로 편 반원(180°)에서 이웃 버튼 중심 거리 ≥ btn + MIN_GAP_PX
export function fanPositions(count: number, radiusPx: number): { dx: number; dy: number }[]; // 180°(왼쪽) → 0°(오른쪽), dy는 위가 −
export function clampFanCenterX(cx: number, radiusPx: number, btnPx: number, vw: number): number; // 부채가 화면 밖으로 안 나가게

// HudButton.tsx — <button className="cv-hud-btn" onPointerDown={(e) => e.preventDefault()} …> (Review Focus 2)
```

배치 표(터치, 오른손 기준. 왼손 모드는 좌우 반전. 모든 버튼에 `--cv-btn-scale` 적용, 최소 48px, 간격 8px):

| 자리 | 요소 |
|---|---|
| 왼쪽 위 | 공간 이름 · 👥 접속자 수(누르면 접속자 목록). 그 아래 채팅 로그 토글(터치)과 관리자 패널 |
| 가운데 위 | 공지 배너(그대로) |
| 오른쪽 위 | 🗺 지도 · 🔊 소리 · ☰ 메뉴 (각 48px, 간격 8px) |
| 왼쪽 아래 사분면 | 조이스틱 구역(보이지 않음) |
| 아래 가운데 | 💬 채팅 버튼 56px. 누르면 입력창이 키보드 바로 위에 붙음(기존 `--cv-kbd-inset`) |
| 오른쪽 아래 | 점프 72px(가장자리), 그 위 행동 60px, 왼쪽 옆 이모지 56px(누르면 6개가 위로 반원) |

- PC: 왼쪽 위 정보·관리자 패널, 오른쪽 위 🗺🔊☰, 채팅 입력창은 아래 가운데(지금처럼 늘 보임), 채팅 로그는 왼쪽 아래(입력창 위), 오른쪽 아래에 이모지 한 줄과 작은 행동 버튼.
- 터치 채팅 버튼: 입력창은 늘 마운트해 두고(접힘 = `opacity:0; pointer-events:none`) 버튼 `onClick` 안에서 동기적으로 `input.focus()`를 부른다. iOS는 사용자 제스처 안의 focus에서만 키보드를 띄운다. blur되면 다시 접는다.
- 접속자 목록: PC는 Tab 누르는 동안, 터치는 👥를 누르면 토글. 줄은 `rosterRows`, 선생님 앞에 👑, 내 뒤에 "(나)". 제목 "접속자 N명".
- 지도(M, 🗺): 기존 오버뷰에 `OverviewLabels`가 각 방 가운데에 이름 스프라이트를 띄운다(오버뷰 블렌드 > `OV_VIS_BLEND`일 때만). 내 위치는 기존 `OverviewMarker`.

- [ ] **Step 1: 실패하는 테스트 작성.**

```ts
it("zoneLabelAt names the four rooms", () => {
  expect(zoneLabelAt(-15, 0)).toBe("로비");
  expect(zoneLabelAt(15, 0)).toBe("강의실");
  expect(zoneLabelAt(-15, -26)).toBe("AI 갤러리");
  expect(zoneLabelAt(-48, 0)).toBe("미로방");
  expect(zoneLabelAt(500, 500)).toBe("");
});
it("rosterRows: teachers first, then me, then Korean order");
it("emoji fan keeps every button size at least 8 px apart (spec §3)", () => {
  for (const size of ["small", "medium", "large"] as const) {
    const b = buttonPx(56, size);
    const p = fanPositions(6, fanRadius(b, 6));
    for (let i = 1; i < p.length; i++)
      expect(Math.hypot(p[i].dx - p[i - 1].dx, p[i].dy - p[i - 1].dy)).toBeGreaterThanOrEqual(b + MIN_GAP_PX - 1e-6);
  }
});
it("clampFanCenterX keeps the fan inside a 375 px screen", () => {
  const b = 56, r = fanRadius(b, 6), cx = clampFanCenterX(247, r, b, 375);
  expect(cx + r + b / 2).toBeLessThanOrEqual(375 - MIN_GAP_PX + 1e-9);
  expect(cx - r - b / 2).toBeGreaterThanOrEqual(MIN_GAP_PX - 1e-9);
});
```

- [ ] **Step 2: 실패 확인.** `npm run test -w client -- hud` → FAIL.
- [ ] **Step 3: 구현.** 순수 함수 → HudButton → HudTop, RosterPanel, EmojiFan, ChatInput → CSS 정리 → WorldScene 조립. 실측 크기·간격은 Task 18 모바일 11단계가 고정한다.
- [ ] **Step 4: 통과 확인.** `npm run test && npm run typecheck && npm run build` PASS. 375×812와 1280×800 스크린샷에서 겹침이 없다.
- [ ] **Step 5: stage + 보고.** 제안 커밋 `feat: HUD 재배치 — 위 정보·지도·소리·메뉴, 채팅 버튼, 오른쪽 아래 점프·행동·이모지, 접속자 목록 (조작 개편 Task 16)`.

### Task 17: 첫 안내 코치마크

**Files:**
- Create: `client/src/game/coach.ts`, Test: `client/src/game/coach.test.ts`
- Create: `client/src/stores/coachStore.ts`, `client/src/ui/CoachMarks.tsx`, `client/src/ui/coach.css`
- Modify: `client/src/ui/ChatInput.tsx`(보내기 → `talked`), `client/src/ui/MenuPanel.tsx`("조작 안내 다시 보기" → `restart`), `client/src/game/WorldScene.tsx`

**Interfaces:**
- Consumes: `useSettingsStore`의 `coachDone`(Task 15), `isTouchDevice`, `viewState`, `orbit`, `pose`.
- Produces:

```ts
export type CoachStep = "move" | "look" | "talk" | "done";
export type CoachEvent = "moved" | "looked" | "talked" | "skip" | "restart";
export const COACH_MOVE_M = 1.5;
export const COACH_LOOK_RAD = 0.6;
export function nextCoachStep(step: CoachStep, ev: CoachEvent): CoachStep; // 맞는 행동만 다음으로, skip → done, restart → move
export interface CoachProgress { startX: number; startZ: number; lookAccum: number; lastYaw: number }
export function detectCoachEvent(step: CoachStep, p: CoachProgress, x: number, z: number, viewYaw: number): CoachEvent | null; // lookAccum 누적, 랩 안전
export function coachCopy(step: Exclude<CoachStep, "done">, touch: boolean): { title: string; body: string };
// coachStore.ts — { step: CoachStep; report(ev: CoachEvent): void }
```

문구(고정):

| 단계 | 제목 | 휴대폰 | PC |
|---|---|---|---|
| move | ① 움직이기 | 화면 왼쪽 아래를 누른 채 밀어 보세요. 끝까지 밀면 달려요. | W A S D(또는 방향키)로 걸어 보세요. Shift를 누르면 달려요. |
| look | ② 둘러보기 | 화면 오른쪽을 한 손가락으로 끌어 보세요. 두 손가락으로 벌리면 확대돼요. | 마우스를 끌거나 Z·C 키로 둘러보세요. 휠로 확대해요. |
| talk | ③ 말하기 | 아래 💬 버튼을 눌러 인사해 보세요. | Enter 또는 / 를 누르고 인사해 보세요. |

- `coachDone`이 false면 처음 입장 때 ①부터 띄운다. 5 Hz로 `detectCoachEvent`를 돌리고(viewYaw는 TP면 `orbit.yaw`, FP면 `fpYaw`), 채팅 보내기는 ChatInput이 `report("talked")`를 부른다. "건너뛰기" 버튼이 있다. done이 되면 `update({ coachDone: true })`. 카드는 해당 조작 근처(① 왼쪽 아래, ② 오른쪽, ③ 아래 가운데 위)에 띄우되 조작을 가리지 않는다.

- [ ] **Step 1: 실패하는 테스트 작성.**

```ts
it("advances only on the matching real action", () => {
  expect(nextCoachStep("move", "moved")).toBe("look");
  expect(nextCoachStep("look", "looked")).toBe("talk");
  expect(nextCoachStep("talk", "talked")).toBe("done");
});
it("ignores out-of-order actions (talking during ① does not skip ahead)", () =>
  expect(nextCoachStep("move", "talked")).toBe("move"));
it("skip ends from any step; restart returns to ①");
it("detects moved after ≥ 1.5 m and looked after ≥ 0.6 rad accumulated, wrap-safe across ±π");
it("copy is Korean for both devices", () => expect(coachCopy("move", true).title).toBe("① 움직이기"));
```

- [ ] **Step 2: 실패 확인.** `npm run test -w client -- coach` → FAIL.
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 통과 확인.** `npm run test && npm run typecheck` PASS. 새 브라우저 프로필에서 ① → ② → ③ → 사라짐, 새로고침하면 안 나옴, 메뉴에서 다시 보기.
- [ ] **Step 5: stage + 보고.** 제안 커밋 `feat: 첫 입장 3단계 안내 — 움직이기·둘러보기·말하기 (조작 개편 Task 17)`.

# 4단계: 검증

### Task 18: E2E — PC 1280×800 + 휴대폰 375×812

**Files:**
- Create: `e2e/task-ux-desktop.mjs`, `e2e/task-ux-mobile.mjs`. 기존 e2e 형식을 따른다: 독립 Playwright, `CV_CLIENT_URL` 기본 `http://localhost:5173`, 증적은 `.superpowers/sdd/evidence/task-ux/`, 콘솔·페이지 오류 0, 종료 코드 0 = 통과.

**Interfaces:**
- Consumes(DEV 훅): `__cv.getPos/getOrbit/getView/getRemotes/getBubbles/getEmojis`(기존), `getGait/getRemoteGaits`(Task 5), `getJumps`(Task 11), `getTyping`(Task 12), `getNametags/getNametagCostMs`(Task 14), `__cvClickTarget`.
- 실행 준비: `ADMIN_CODE=e2e-teacher npm run dev`(서버 :2567, 클라이언트 :5173).

데스크톱(탭 A·B, 필요하면 C):
1. 걷기: W 1 s → 속도 `MOVE_SPEED` ±20%, `getGait() === "walk"`.
2. 달리기: Shift+W 1 s → 속도 `RUN_SPEED` ±20%, `"run"`. B의 `getRemoteGaits()[A]`가 1 s 안에 `"run"`. B가 보는 A 위치와 A의 위치 차가 1 m 미만(서버가 달리기 이동을 버리지 않음).
3. 1인칭 옆걸음: V 후 A 1 s → `fpYaw` 변화 < 0.01, 이동 방향이 시선과 수직.
4. 점프: Space → A·B 모두에 A의 점프(B는 500 ms 안). 300 ms 안에 Space 두 번 → B는 1번. 이모지 버튼을 마우스로 클릭한 뒤 Space → 이모지 추가 방송 0건(Review Focus 2).
5. 앉기: `SEATS[1]` 하차점 근처 바닥을 클릭해 이동(목적지 링 스크린샷) → E → `seatIndex === 1`, 1 s 뒤 `orbit.yaw`가 `recenterYaw(SEAT_YAW)` ±0.1 → Space → 점프 0건(Review Focus 4) → E → 일어섬, `orbit.yaw`가 앉기 전 값 ±0.1.
6. 채팅: `/` → 입력창 포커스, 값 ""(`/`가 들어가지 않음). "안녕 wasd e1"을 치는 동안 이동·점프·앉기·이모지 0(Review Focus 1). B의 `getTyping()`에 A. Enter → B에 말풍선 "안녕 wasd e1", B의 typing에서 A 빠짐.
7. 이모지: 2 → B의 `getEmojis()`에 `{ sid: A, index: 1 }`.
8. 카메라: Z 0.5 s → yaw 약 +1.1, C로 반대. R → 0.4 s 안에 `orbit.yaw`가 `recenterYaw(pose.yaw)` ±0.05.
9. Esc → `.cv-menu` 보임 → Esc → 숨김. Tab 누르는 동안 `.cv-roster` 보임, 떼면 숨김.
10. 선생님: C가 `adminCode: "e2e-teacher"`로 입장 → B의 `getRemotes()`에서 C의 `role === 1`, `getNametags()`에서 C selected.

모바일(375×812, `hasTouch`, `isMobile`. 터치는 task-v2-14 `touchDrag`처럼 `pointerType: "touch"` 합성 PointerEvent):
1. 입장 직후 스틱이 안 보인다.
2. `.cv-stick-zone`의 (110, 640)을 누르고 위로 20 px → 걷기 속도 ±25%, 60 px → 달리기 속도 ±25%, 떼면 정지와 스틱 숨김.
3. (10, 640)을 누르고 끌기 → 이동 0(가장자리 24px).
4. Review Focus 3: 스틱(포인터 1)을 쥔 채 오른쪽 절반에서 포인터 2 드래그 → `orbit.yaw` 변화와 이동 지속. 스틱 구역에 포인터 3 → 무시(이동 방향 그대로).
5. 오른쪽 절반 핀치 → `orbit.distance`가 바뀌고 [2.5, 18] 안.
6. 오른쪽 절반 두 번 톡 → `orbit.yaw ≈ recenterYaw(pose.yaw)`, `__cvClickTarget()` null. 바닥 한 번 톡 → 300 ms 뒤 클릭 목표 생김.
7. 점프 버튼 → 내 점프.
8. 의자 근처 → 행동 버튼에 🪑 → 톡 → 앉음 → 톡 → 일어섬.
9. 💬 → `document.activeElement`가 채팅 입력창 → 입력하고 Enter → 내 말풍선.
10. 이모지 버튼 → 6개 펼침 → 하나 톡 → 방송되고 접힘.
11. 배치: 보이는 `.cv-hud-btn`, `.cv-action-btn`, 점프·이모지·채팅 버튼이 모두 48×48 이상, 서로 간격 8 px 이상, 겹침 0, 화면 안. 버튼 크기 "크게"와 왼손잡이 모드로 다시(왼손이면 스틱 구역이 오른쪽). 스크린샷 3장.
12. 첫 안내: 새 컨텍스트에서 ① → 스틱 이동 → ② → 드래그 → ③ → 채팅 → 사라짐 → 새로고침 후 없음.

- [ ] **Step 1: 스크립트 작성.** 단언은 위 목록 그대로, 단계마다 스크린샷.
- [ ] **Step 2: 실행.** `node e2e/task-ux-desktop.mjs`와 `node e2e/task-ux-mobile.mjs` → 둘 다 종료 코드 0. 실패하면 원인 태스크로 돌아가 고친 뒤 다시 돌린다.
- [ ] **Step 3: 회귀 확인.** `npm run test && npm run typecheck` PASS.
- [ ] **Step 4: stage + 보고(증적 경로 포함).** 제안 커밋 `test: 조작 개편 E2E — PC·휴대폰 입장→걷기→달리기→점프→앉기→채팅→이모지 (조작 개편 Task 18)`.

### Task 19: 100명 성능·100봇 부하 재측정 + 문서

**Files:**
- Modify: `loadtest/bot.ts`, `loadtest/run.mjs`(`--zone` → `CV_BOT_ZONE`)
- Create: `e2e/task-ux-perf.mjs`
- Modify: `docs/loadtest.md`(새 절 "조작 개편 재측정 (2026-10-31)"), `docs/design.md`(5장 Player 스키마와 전송 표에 role·점프·입력 중, 6장 "20m 밖 닉네임 숨김"을 25 m 페이드와 선택 규칙으로, 20·21장 머리에 "⚠️ 2026-10-31 조작 개편(35장)으로 대체", 새 35장 요약)

**Interfaces:**
- Consumes: `RUN_SPEED`, `JUMP_RATE`, `TYPING_RATE`, `MessageType.Jump/Typing`, `ZONES`, `__cv.getNametagCostMs`.
- 봇 행동(실사용 비율):
  - 달리기: 새 목표를 뽑을 때마다 `RUN_LEG_CHANCE = 0.3` 확률로 그 구간을 `RUN_SPEED`로 간다(`stepLen = RUN_SPEED × MOVE_INTERVAL_MS / 1000`).
  - 점프: 봇의 `JUMP_CHANCE = 0.2`가 `JUMP_INTERVAL_MS = [4000, 10000]`마다 `Jump` 1건(800 ms 제한보다 훨씬 느림).
  - 입력 중: 채팅하는 봇(기존 20%)이 채팅 1.5~3 s 전에 `Typing { on: true }`, 채팅 뒤 `{ on: false }`.
  - 통계에 `jumpsSent`, `typingSent`를 더한다. `CV_BOT_ZONE=lectureHall`이면 목표를 `ZONES.lectureHall` 안에서만 뽑는다(교실 100명 장면).

- [ ] **Step 1: 봇 수정과 소규모 확인.** `npm run typecheck -w loadtest` PASS. `npm run bot -w loadtest -- --room world --numClients 10 --endpoint http://localhost:2567`를 60 s → 절단·오류 0, `jumpsSent`와 `typingSent` > 0.
- [ ] **Step 2: 100봇 재측정.** `docs/loadtest.md` 1절 절차 그대로: `npm run build` → `NODE_ENV=production node server/dist/index.cjs` → `node loadtest/measure.mjs --pid <PID> --duration 660 --interval 5 --out measure.csv` → `npm run loadtest -- --numClients 100 --duration 630`. 기존 게이트로 판정: p95 CPU < 50%(1 vCPU), 최대 RSS < 400 MB, 클라이언트당 다운스트림 ≤ 30 KB/s, join 100/100, 절단 0, 오류 0. 결과를 이전 측정과 나란히 새 절에 표로 남긴다.
- [ ] **Step 3: 교실 장면 성능.** `npm run loadtest -- --numClients 100 --duration 180 --zone lectureHall` 실행 중에 `node e2e/task-ux-perf.mjs`: 375×812 모바일 에뮬 + CDP `Emulation.setCPUThrottlingRate { rate: 4 }`로 강의실에 들어가 20 s 동안 `getNametagCostMs()`와 rAF fps를 샘플링한다. 통과 기준: 이름표 시스템 평균 < 1.0 ms/프레임, p95 < 2.0 ms("모두" 모드 수치도 참고로 기록). headless fps는 참고값이고, 30fps 목표는 발주자 실기기 확인으로 판정한다.
- [ ] **Step 4: 문서 갱신.** 위 Files. `npm run typecheck && npm run test && npm run build` PASS.
- [ ] **Step 5: 발주자 확인 요청(spec §8).** 실제 휴대폰으로 30초 안에 걷기·둘러보기·말하기가 되는지, 교실 100봇 장면에서 끊김이 느껴지는지. 결과를 `docs/loadtest.md` 새 절에 한 줄로 남긴다.
- [ ] **Step 6: stage + 보고.** 제안 커밋 `test: 달리기·점프·입력 중을 넣은 100봇 재측정과 교실 이름표 성능, 기획 35장 (조작 개편 Task 19)`.

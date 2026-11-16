# 추모관 2차 W0 계약 (W1~W5가 함께 쓰는 약속)

- 2026-11-16, 브랜치 `feat/mem-b`(B단계와 같이 들어감). 설계: `design.md` 3·4·5·9장.
- **고치지 말고 더하기만 해요.** 바꿀 게 생기면 W0 담당(가장 똑똑한 모델)에게 먼저 알려요.

## 1. 파일

| 파일 | 내용 | 누가 고치나 |
|---|---|---|
| `shared/src/memorial/constants.ts` | 모든 제한 숫자(방명록 80자·하루 1/10/30, 꽃 24시간·5다발·하루 1/20, 신고 3건, 공유 코드 8자, 추모식 일요일 20:00·단계 길이, 앨범 5장, 기기 6대, 상품 목록 시드) | W0만 |
| `shared/src/memorial/types.ts` | API 몸통과 방 메시지 모양(아래 3장) | W0만, 필드 더하기는 각 갈래가 알리고 |
| `shared/src/memorial/messages.ts` | 방 메시지 이름 `MemorialMsg`/`MemorialServerMsg`(모두 `Mem` 접두어), HTTP 경로 `MEMORIAL_API` | W0만 |
| `shared/src/memorial/occasions.ts` | F1 순수 규칙 `occasionsOn(오늘KST, 날짜, 켠 날)`, 문구 `occasionLine` | W1이 써요 |
| `shared/src/memorial/ceremony.ts` | F4 순수 일정 `ceremonyAt(now, 이름수)`, `ceremonyPhases`, `weekCeremonyStart` | W3이 써요 |
| `shared/src/memorial/kst.ts`, `codes.ts`, `validate.ts` | 한국 시간, Crockford 코드, 칸 정보 검사 | 같이 써요 |
| `server/src/db/migrations/001_core.ts` | B단계 표(주인·열쇠·초대·칸·모심·사진·꾸미기·추모 흔적·상품·값·주문·권리) | 고치지 않음 |
| `server/src/db/migrations/002_memorial2.ts` | 2차 표(claim_stats, guestbook, report, block, share_link, ceremony, garden_spot 16자리) | 고치지 않음, 새 칸은 `003_…` 새 파일 |
| `server/src/clock.ts` | `serverNow()` — `CV_FAKE_NOW`(ISO 또는 `+3d`, `-2h+30m`)를 따르는 시계 | 같이 써요 |
| `server/src/memorial/service.ts` | `memorial()` 한 개, `ownerOf(keyHash)`, `emit(slotId, fields)`→ 모든 방 홀에 `MemClaimUpdated`, `publicView`/`mineView` | W1이 더해요 |
| `server/src/memorial/api.ts` | `mountMemorialApi` 라우터(B단계 경로). 2차 경로는 **새 파일 `server/src/memorial/<기능>Api.ts`에 만들고 여기서 한 줄로 등록** | W1·W5 |
| `server/src/memorial/textFilter.ts` | `textIsNice` = 욕설 + 광고 모양(링크·전화·9자리 숫자·@·오픈채팅·6번 반복) | W1이 방명록에 그대로 |

## 2. 규칙

- 시각은 늘 `serverNow()`(서버 KST). 클라이언트 시계를 믿지 않아요. 시험은 `CV_FAKE_NOW`로만 옮겨요(운영 금지, 켜져 있으면 시작 로그에 경고).
- 주인 확인: HTTP는 `Authorization: Device <키>` → `deviceKeyHash(req)` → `memorial().ownerOf(hash)`. 방은 입장 때 받은 해시를 `room.memorialKeyHash(sessionId)`로 읽어요(재접속에도 그대로). 키 원문은 어디에도 남기지 않아요.
- 주인은 언제나 `owner.id`. 기기·복구 코드·(나중) 계정은 모두 `owner_key` 줄이에요. 칸·사진·권리·공유 코드는 `owner`나 `claim`에 붙여요(기기에 붙이지 않기). 합치기는 `store.mergeOwners(from, to)`.
- 가진 것은 모두 `entitlement`(source `free|beta|krw|coin|grant`). 화면은 권리만 읽어요. 값은 `price`(지금은 FREE 줄만). 유료 후보는 `catalog`에 `active=0`으로만 있어요.
- 문구: "~해요", 느낌표·이모지 없음. 슬픈 화면(추모식, 그날 띠, 방명록, 공유 페이지)에는 값·상점 금지.
- 걸린 글은 저장·로그하지 않아요. 오류 몸통은 `{ error, message }`(한국어 한 줄).
- 홀 안 꽃·추모식 촛불 위치 검사는 `candleCubby`와 같은 방식(`area === "hall"`, `CANDLE_REACH_M`). 모신 칸도 "채워진 칸"이에요(`memorial().isClaimed`).

## 3. 메시지와 API (모양은 `types.ts`)

방(Colyseus, `VillageRoom.ts`에는 등록 한 줄만):

| 이름 | 방향 | 몸통 | 갈래 |
|---|---|---|---|
| `MemPlaceFlower` | C→S | `PlaceFlowerPayload { target, sku }` | W1 |
| `MemFlowerPlaced` / `MemFlowerState` | S→홀 / S→한 명 | `FlowerPlacedPayload` / `FlowerStatePayload` | W1 |
| `MemTodayState` | S→모두 | `MemorialTodayPayload { date, items }`(공개만) | W1 |
| `MemCeremonyState` | S→모두 | `CeremonyStatePayload { ceremonyId, phase, phaseEndsAt, serverNow, names?, moreNames?, participants }` | W3 |
| `MemCeremonyLight` / `MemCeremonyLit` | C→S / S→홀 | `{}` / `CeremonyLitPayload { by, total }` | W3 |
| `MemClaimUpdated` | S→모든 방의 홀 | `ClaimUpdatedPayload { slotId, fields }` → 클라는 `GET /claims/:slotId` | **B단계에 있음** |

HTTP(`MEMORIAL_API`): B단계에 있는 것 — `hall`, `me`, `claims`(POST), `claimBySlot`(GET), `claim`(PATCH), `photos`(POST, 원본 바이트 `image/jpeg|png|webp` ≤ 2 MB), `invite`, `join`, `recover`, `device`(DELETE), `adminReview`, `adminPhoto`. 2차가 만들 것 — `album`, `photo`(PATCH/DELETE), `days`, `guestbook`, `guestbookEntry`, `blocks`, `reports`, `share`, `shareView`, `shareFlower`.

클라이언트(B단계에 있음, 2차가 씀): `client/src/village/memorial/` — `memorialApi`(인증 헤더 붙는 fetch), `claimsStore`(`useClaims`, `refreshSlot`, `claimFor`, `isMine`), `memorialSheets`(`openSheet`), `MEM_COPY`, `deviceKey`. 칸 카드(`CubbyView.tsx`)에는 탭 자리만 더해요.

## 4. 시험

- 순수 함수 시험: `shared/src/memorial/memorial.test.ts`(기념일 2/29·연도 모름·49/100일, 추모식 단계·이름 40 넘음, 코드, 칸 검사).
- 서버: `server/src/memorial/*.test.ts`(저장소·사진·API), `server/src/rooms/VillageRoom.memorial.integration.test.ts`(포트 2577). 새 통합 시험은 **새 포트**(2578~)를 써요.
- 서버 시험은 `new Memorial(testConfig(tempDir()), () => clock.t)`로 시계를 손에 쥐고, 방 시험은 `setMemorialForTest(m)`로 끼워요(`testUtil.ts`).
- 화면 시험 예: `e2e/memorial-claim.mjs`(PC 1280×800 + iPhone 13 375×812, 낮·밤).

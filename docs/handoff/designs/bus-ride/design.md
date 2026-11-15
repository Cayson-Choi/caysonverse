# 버스 안 자유 탑승 설계 (feat/bus-ride, base main 7c81a1c)

## 한국어 요약

- **지금 상태(main)**: 탑승하면 서버가 고정 자리 하나(`Player.busSeat` 0..27)를 주고, 캐릭터는 그 자리에 고정된다. 카메라는 고정 샷 하나(`transitCamera.ts riderShot`)라서 창밖은 한쪽만 보이고, 움직이거나 앉고 서기를 바꿀 수 없다. 오너 요청 (1)(2)(3)은 아직 안 되어 있다.
- **탑승 모델**: 탑승객은 "달리는 버스 좌표계 안의 사람"이 된다. 서버에는 버스 기준 좌표(앞쪽 `ahead`, 문 쪽 `right`, 방향)를 둔다. 통로 걷기(WASD·조이스틱)는 서버가 버스 내부 충돌 상자로 검사한다. 빈 좌석이나 기둥 옆 손잡이 자리에 다가가 E(폰은 버튼)를 누르면 앉거나 잡고 선다. 등받이 좌석은 앞에서만 앉을 수 있다. 다시 E를 누르면 일어난다. 타는 곳은 앞문 안쪽이고, 내릴 때는 정차 중에만 중문 바깥 인도로 나간다. 다른 사람도 같은 필드를 받아서 버스 안에서 걷고 앉고 서는 모습이 보인다.
- **카메라**: 버스 안에서도 마을과 같은 3인칭 궤도 카메라를 쓰되, 버스 좌표계에 붙인다(버스가 돌면 같이 돈다). PC는 마우스 드래그·휠, 폰은 한 손가락 드래그·핀치로 좌우·앞뒤 모든 창을 본다. 휠·핀치를 끝까지 당기면 1인칭(눈높이)이 된다. 처음 탄 사람에게는 "화면을 끌어서 창밖을 둘러보세요" 안내를 한 번 띄우고, `◀ 왼쪽 창 | 앞 | 오른쪽 창 ▶` 빠른 시점 버튼도 준다. 카메라는 실내 껍데기(벽·천장·바닥) 안에서만 움직이고, 좌석 등받이에 닿으면 앞으로 당겨진다. 카메라와 내 머리 사이에 있거나 렌즈 0.6 m 안에 있는 기둥·손잡이·끈은 반투명하게 사라져서 팔이나 얼굴을 가르지 않는다.
- **버스 크기**: 길이(9 m)와 폭(2.5 m)은 바꿀 수 없다. 바깥 차로(R34–37)와 중앙선 규칙에 꽉 맞기 때문이다. 대신 **높이만 키운다**. 서 있는 꼬마 아바타의 모자 끝은 0.34+2.69 = 3.03 m인데 지금 천장은 2.50 m이고 머리(2.52 m)가 이미 천장에 닿는다. 그래서 천장을 3.15 m, 창 위 끝을 2.75 m, 문 위 끝을 3.05 m, 지붕선 TOP을 3.45 m로 올리고 전체 높이는 3.3 m에서 약 3.75 m가 된다. 실내 좌석은 2+2를 1+1(뒤 끝줄 3석)로 바꾸고 좌석 폭을 0.62 m로 넓혀 통로 폭 약 1.1 m(아바타 반지름 0.4)를 확보한다. 도로·정류장·차선 자세는 바뀌지 않는다. 카메라 상자 높이만 바뀐다.
- **후속 수정(4)**: 정차 버스 충돌을 고정 슬라이스 상자에서 **현재 버스 자세의 정확한 직사각형 + 사이드미러 2개(달리는 버스와 같은 코드)**로 바꾼다. 그러면 버스가 없을 때 정류장에 투명벽이 남지 않고, 뒤쪽 0.3 m 허공벽이 사라지며, 달리는 버스에도 미러 충돌이 생긴다. 'E 버스 타기 · 10분 뒤 출발'은 버스가 정차해 있고 탑승이 열렸을 때만 행동(E)으로 보인다. 그 밖에는 키 없는 안내 칩("다음 버스 7분 뒤 · 출발 3분 전부터 탑승")만 보인다. 기둥이 팔을 가르는 문제와 폰 세로 화면을 좌석과 얼굴이 가리는 문제는 새 카메라로 해결한다.
- **가로등·깃발 기둥**: main에서 확인했다. 충돌이 **없다**. `villageColliders.ts`에 `col__lamp`와 `col__banner`가 없고, parts_props.py `lamp()`와 `banners()`가 col 상자를 만들지 않는다. 광장 가로등 5개(r 28), 순환도로 바깥 인도 가로등(r 38.4, 최대 18개), 광장 배너(깃발) 기둥 8개(r 26, 6.6 m)가 모두 통과된다. 신호등 기둥처럼 shared 코드에서 위치를 계산해 충돌 상자를 더하고, GLB 메시 위치와 맞는지 테스트한다. 마을 리베이크는 하지 않는다.
- **실내 디테일**: Aside로 실제 사진 6장을 참고했다. 앞쪽 저상부 1+1, 노란 계단 뒤 높은 뒷부분, 파랑·회색 좌석, 분홍 임산부 배려석, 중문 맞은편 휠체어 공간(접이식 좌석·노란 가로봉), 노랑(구형)·흰회색(신형) 수직봉, 천장 가로 레일과 고리 손잡이, 어깨 높이 빨간 하차벨, 운전석 칸막이의 교통카드 단말기와 화면, 회색 얼룩무늬 고무 바닥, 흰 천장의 긴 조명과 원형 공조구, 검정 창틀, 창 위 노선도·광고, 전면 LED 다음 정류장 표시기를 Blender로 만든다.
- **마일스톤**: M1 충돌 수정과 가로등·깃발 기둥 → M2 Blender 버스(키 높이·실내) → M3 서버 탑승 모델 → M4 클라이언트 걷기·앉기·서기와 원격 표시 → M5 카메라 → M6 e2e(2 클라이언트), 스크린샷, 실사 비교.

---

## English spec (for the sonnet builder)

Worktree `D:/Codex/cayson-games/caysonverse-busride`, branch `feat/bus-ride`. Rules (owner): keep what works on main (yield/brake/horn, push-out, 3-min boarding, lane pose R 35.4), Blender-modelled only (no runtime primitive props), real-photo feel, first-timer UX on PC + phone, every visible seat sit-able, backed seats from the front only, backless seats from either side. One Blender and one browser at a time, vitest `--maxWorkers=2 --testTimeout=30000`, never `npm install`, back up `build_bus.py` before editing (to `.../scratchpad/busride2/backup/`).

### Facts read on main 7c81a1c
- Bus frame: build_bus.py `xf` = m back from the nose (0..9), `X` = across (+ = door side), heights from the ground. Shared code uses `ahead = 4.5 - xf`, `right = X` (`busSeats.ts`, `busBody.ts busLocal`).
- Cabin now: floor 0.34 (xf < 5.85), steps to 0.545 and 0.75 (rear xf 6.15..8.70), ceiling 2.50, inner half-width `wi` 1.195, ceiling rails at X ±0.42 at h 2.0 with straps down to 1.67, poles to 2.50, doors `DOORS = [(0.40,1.49),(4.35,5.75)]` with glass up to 2.13/2.05 and frame top ~2.2, windows sill 1.28 and top ~2.2, `TOP` (roof edge) 3.02, pods to ~3.3, seats 0.43 wide in 2+2.
- Avatar: `PLAYER_RADIUS` 0.4, head top 2.18, hat tip 2.69, sit contact 0.39 (`sitPose.ts`). On the 0.34 floor a standing avatar's head is at 2.52 and the hat at 3.03, both through the 2.50 ceiling and the 2.0 rails. A seated avatar needs about 1.0 m of width (hands on knees reach ±0.5).
- Colliders: `buildVillageGeometry` always adds `busParkedColliders` (z-slices of the turned rect, camera boxes 3.3 tall) and `busMirrorColliders` (via `villageGeometry` extra), even while the bus is on the lap. That is the invisible wall. The moving bus uses `pushOutOfBus` (rect only, no mirrors) on the client (`playerObstacles.ts`) and on the server (`VillageRoom.tickBus/afterMove`, only while `inTransit`).
- No lamp or banner colliders exist (generated list has no `col__lamp*` or `col__banner*`). Sources are `art/village/tools/parts_props.py lamp_positions()` (plaza `L.plaza.lamps` at r 28, plus `38.4·(cos,sin)` for k in 0..17 at `a = 2π(k+0.5)/18`, skipping angles within 7° of any lane's first two points and the bus-stop box `|x-38|<3 && -11<z<-1`; base radius 0.17) and `banners()` (angles −100, −80, −50, −20, 30, 55, 125, 150 deg at r 26.0; base radius 0.12).

### (c) Bus size: taller, same footprint
The plan stays 9.0 × 2.5 m because `busFootprint`, `BUS_LANE_RADIUS`, transit.test lane checks, the kerb and the centre line are all at their limits (a longer or wider bus crosses the yellow line or the kerb on R 35.4). Raise the upper body in build_bus.py:

| item | now | new |
|---|---|---|
| floor (low / rear) | 0.34 / 0.75 | 0.34 / 0.75 (unchanged; rear step heights unchanged) |
| window sill | 1.28 | 1.28 |
| window glass top (side windows, windscreen top, rear window) | ~2.20 | **2.75** |
| door opening top (frame), glass top | 2.19 / 2.13 | **3.05 / 2.98** |
| ceiling (`ceiling` poly, ducts) | 2.50 | **3.15** (ducts 3.12 under the side edges) |
| roof edge `TOP` | 3.02 | **3.45** |
| roof pods top | ~3.3 | **~3.75** |

Implement this as a remap of every height `h > 1.28`: `h' = 1.28 + (h - 1.28) · k`, with `k` per band so that the table holds. Window band 1.28→2.20 maps to 1.28→2.75. The band above it (2.20→3.02) maps to 2.75→3.45. The LED destination sign, wipers and mirrors are kept relative to the windscreen. The mirror heads stay at 1.5–2.2 (head height, as now). Update `HS`, `TOP`, `ARCH_TOP_ST` users, `OPEN_DEPTH` users, `doors()` defs, and `cabin()` heights accordingly. Keep the 2026-11-11 exterior as the minimum bar: same livery, decals, lamps and proportions per band. Render an exterior side-by-side (before/after plus the reference photo) for the controller.

Code impact:
- `villageLayout.ts BUS_HEIGHT` becomes 3.75 (used only by the new camera OBB, see (d)).
- Overhead and jump headroom inside the bus: jumping is disabled aboard.
- `server/src/tools/villageBus.test.ts` reads the GLB, so update its height and mirror expectations.
- Road, stop, shelter, lane pose and `TRANSIT.parked`: no change. The shelter roof (underside 3.3) is over the pad, not the lane, so check that it does not overlap the bus footprint (it does not today).

### (f) Interior rebuild (Blender, build_bus.py `cabin()` and `seat()`), from the Aside reference photos
References (Aside, 2026-11-15): ko.wikipedia.org/wiki/저상버스, kbsecuritynews.com/72456, m.blog.naver.com/travia_blog/221139224264, hyundai.com Elec City interior gallery, jjan.kr/article/20220303580375, theindigo.co.kr/archives/26009. Seen in the photos: front low floor with 1+1 seats or priority seats, raised rear behind 1–2 yellow-edged steps, blue or grey moulded seats, pink pregnant-priority seat, wheelchair bay opposite the middle door (folding seats, yellow horizontal bar), vertical poles (yellow/red on older buses, white/grey on Elec City), ceiling longitudinal rails with black or red ring straps, red stop buttons at shoulder height on poles and window pillars, card terminal plus screen on the driver's partition, grey speckled rubber floor, white ceiling with long light strips and round vents, black window frames, route map and ads over the windows.

Seat table (new `seat()` sizes: cushion 0.56 wide × 0.42 deep at surface 0.45 over its floor, shell 0.62 wide, backrest 0.62 wide; the cushion top stays 0.452 so `BUS_SEAT_SURFACE` is unchanged). All seats are forward-facing (backed) unless marked otherwise:

| id | xf | X | floor | kind |
|---|---|---|---|---|
| L1 | 2.35 | −0.86 | 0.80 (axle platform) | backed, teal |
| L2 | 3.25 | −0.86 | 0.34 | backed, pink pregnant-priority seat (임산부 배려석) |
| L3 | 4.10 | −0.86 | 0.34 | backed, yellow (priority) |
| W1, W2 | 4.65, 5.30 | −0.93 | 0.34 | folding side seat facing +X (the aisle), backed against the wall, approached from the aisle side only |
| R1 | 2.35 | 0.86 | 0.80 | backed, teal |
| R2 | 3.40 | 0.86 | 0.34 | backed, yellow (priority) |
| RL1, RR1 | 6.70 | ∓0.86 | 0.75 | backed, blue |
| RL2, RR2 | 7.55 | ∓0.86 | 0.75 | backed, blue |
| B1..B3 | 8.35 | −0.70, 0, 0.70 | 0.75 | backed back row, blue, 0.62 apart |

That gives 15 seats. Aisle clear width is 1.10 m between X −0.55 and +0.55, about 1.19 m at the wheel housings. The driver's seat is not sit-able. It is behind the partition and is not a passenger seat, so it does not break "every visible seat sit-able": it gets the existing driver figure if there is one, or stays empty behind the screen.

Fixtures:
- **Vertical stanchions** (white-grey Elec City style with yellow hand bands): at (X ±0.56, xf 3.0, 3.85, 6.25, 7.15) and (X 0.9, xf 1.55 / 4.30 / 5.80 by the doors). Every pole is a separate named object `pole_<k>` (for camera fading). Diameter 0.035, from floor to ceiling 3.15.
- **Ceiling rails**: X ±0.60 at h 2.85 from xf 1.6 to 8.0. Straps (`strap_<side>_<k>`, black ring handles, ring bottom at 2.45) every 0.5 m over the low floor only. They hang beside a standing avatar's head (head half-width about 0.35 at X 0), never over the aisle centre.
- **Stop buttons**: red buttons with a lit ring and "하차" text at h 1.5 on every pole and on the window pillars by each seat (L1..RR2, B*), as `stop_btn_<k>` (material `stop_red`, emissive toggled later if wanted).
- **Displays**: a front LED next-stop display (amber dot-matrix "다음 정류장 케이슨마을") above the windscreen inside at h 2.85–3.05, a 24" monitor over the middle door, and a route-map strip and ads (atlas regions) above the side windows between 2.80 and 3.10.
- **Card terminals**: at the front door (driver partition, black body with orange rim and screen) and the middle door (post at X 0.95, xf 5.83).
- **Middle door**: yellow step nose, a "하차문 / 내리는 문" sticker, door sensor bar and amber lamps at 3.0.
- **Wheelchair bay**: the opposite the middle door (xf 4.4–5.8, X −1.2..−0.5): blue floor marking with the wheelchair pictogram, a yellow horizontal bar at h 0.9, belt reels, and the 2 folding seats W1/W2.
- **Floor**: grey speckled rubber (new atlas region), with yellow edges on the rear steps.
- **Ceiling**: white, with two long LED strips at X ±0.35, round vents every 1.2 m, CCTV domes at the front and the middle door, black window frames.
- **Riders' hold spots**: positions next to poles where an avatar stands with one hand on the pole (see `BUS_HOLDS`).

Export also writes `art/village/export/village_bus_cabin.json`, the authoritative bus-local data that the shared code is generated from, so TS never re-derives the model:
```jsonc
{
  "seats":  [{ "id":"L1","xf":2.35,"X":-0.86,"floor":0.80,"facing":0,     "backed":true }],   // facing: rad in bus frame, 0 = forward (+ahead), +PI/2 = towards +X (doors)
  "holds":  [{ "id":"H1","xf":3.0,"X":-0.25,"floor":0.34,"pole":"pole_0","facing":0 }],
  "poles":  [{ "name":"pole_0","xf":3.0,"X":-0.56,"z0":0.34,"z1":3.15,"r":0.0175 }],
  "straps": [{ "name":"strap_l_0","xf":1.9,"X":-0.60,"z0":2.45,"z1":2.85 }],
  "seatBacks":[{ "seat":"L1","min":[aheadMin,rightMin,hMin],"max":[...] }],
  "solids": [{ "id":"seat_L1","min":[ahead,right],"max":[ahead,right] }],                       // walk colliders, plan boxes in bus-local m
  "floor":  [{ "xf0":0.32,"xf1":5.85,"h":0.34 },{ "xf0":5.85,"xf1":6.15,"h":0.545 },{ "xf0":6.15,"xf1":8.70,"h":0.75 }],
  "ceiling":3.15, "innerHalfWidth":1.195, "doors":[[0.40,1.49],[4.35,5.75]]
}
```
`scripts/gen-bus-cabin.ts` turns it into `shared/src/village/generated/busCabin.ts` (the same pattern as extract-colliders: header "GENERATED", 0.001 rounding).

### (a) Riding model
**Schema (`shared/src/schema.ts` Player, +4 fields → 29 fields):**
```ts
@type("int8")    busSeat = -1;   // KEEP name; new meaning: -1 = not aboard; 0 = aboard and free (walking or standing in the aisle);
                                 //   1..SEATS = seated in BUS_SEATS[busSeat-1]; SEATS+1..SEATS+HOLDS = holding BUS_HOLDS[busSeat-SEATS-1]
@type("float32") busAhead = 0;   // bus-local root position (m ahead of the bus centre)
@type("float32") busRight = 0;   // bus-local (m towards the doors)
@type("float32") busYaw = 0;     // bus-local facing (rad, 0 = bus forward), normalised to [-PI, PI]
```
(`busSeat >= 0` still means aboard, so `transitSync.ts`, `remoteStore` and `selfBusRide` keep their aboard tests. Grep all `busSeat` users and switch the "place" reads to `busPlaceOf(busSeat)`.)

**Shared `shared/src/village/busCabin.ts`** (new, pure; consumes generated/busCabin.ts):
```ts
export interface BusSeat { id: string; ahead: number; right: number; floor: number; facing: number; backed: boolean }
export interface BusHold { id: string; ahead: number; right: number; floor: number; facing: number; pole: string }
export const BUS_SEATS: readonly BusSeat[]; export const BUS_HOLDS: readonly BusHold[];
export const BUS_ENTRY = { ahead: 3.45, right: 0.55, yaw: Math.PI }; // just inside the front door, facing back down the aisle (xf 1.05)
export const BUS_EXIT_ZONE: { aheadMin: -1.35, aheadMax: 0.25, rightMin: 0.35, rightMax: 1.2 }; // in front of the middle door
export function cabinFloorAt(ahead: number, right: number): number;            // from "floor"
export function cabinBlocked(ahead: number, right: number, r = 0.4): boolean;  // outside the walls (|right| > 1.195 - r, ahead outside [-4.15+r, 4.18-r]) or overlapping a solid (seats, wheel housings, driver partition xf<1.35 & right<-0.2, dashboard, fare posts, poles r 0.05)
export function stepInCabin(from: {ahead:number;right:number}, want: {ahead:number;right:number}, r = 0.4): {ahead:number;right:number}; // slide along solids (axis-separated), never into one
export function seatApproachOk(seat: BusSeat, ahead: number, right: number): boolean; // dist to seat front point <= 1.0 m AND (backed ? in front: dot((p - seatPos),(facingDir)) > 0.05 : either side)
export function nearestFreeSpot(ahead, right, takenSeats: Set<number>, takenHolds: Set<number>): { kind:"seat"|"hold"; index:number; dist:number } | null; // within 1.0 m, approach rule respected
export function seatStandUpSpot(seat: BusSeat): { ahead:number; right:number; yaw:number }; // 0.55 m in front of the cushion (aisle), not blocked
export function busPlaceOf(busSeat: number): { kind:"free"|"seat"|"hold"; index:number };
export function busLocalToWorld(bus: TransitPose, ahead, right, out?): {x,z}; // existing busRiderPose math, generalised
```
`busSeats.ts`: keep `busRiderPose`, rewritten on top of busCabin (seat, hold or free pose), and keep `busDismountSpot` (spread by a hash of the session index instead of the slot). Delete `BUS_PLACES`/`freeBusSlot` once nothing uses them, and update busSeats.test.ts.

**Messages (`shared/src/village/messages.ts` / MessageType):**
- `BusMove { ahead, right, yaw, t }`: about 10 Hz while aboard and free. Validation in `server/src/rooms/busCabinMove.ts validateBusMove(prev, payload, dtMs)`: finite numbers, a speed of at most `WALK_SPEED × 1.5` in bus-local m/s with the existing move-clock budget pattern, the endpoint not `cabinBlocked`, and the segment checked with `stepInCabin`. On failure, silently snap back by echoing the current fields. Refused if `busSeat !== 0`.
- `BusSit { kind: "seat" | "hold", index }`: valid if aboard and free, the spot is free (no other rider has `busSeat` equal to it), and `seatApproachOk` (or within 0.8 m for a hold). On success, set busSeat and snap `busAhead/busRight/busYaw` to the spot. Otherwise send `BusRejected { reason }` ("다른 사람이 앉아 있어요" / "앞쪽에서 앉을 수 있어요").
- `BusStand {}`: from a seat or hold to free, placed at `seatStandUpSpot` (or the hold spot itself).
- Existing `BusRide { action: "board" | "leave" }`, kept:
  - `board`: as now, but `busSeat = 0` and the pose is `BUS_ENTRY`.
  - `leave`: only while the bus is not `inTransit`. It is accepted from anywhere aboard (simple for first-timers), and the client offers it prominently when the rider is in `BUS_EXIT_ZONE` or at the end of a lap. The server puts the rider at `busDismountSpot` (unchanged). The lap end auto-dismount stays.
- The server keeps `player.x/z/yaw` = world pose of the rider every `tickBus`. That keeps proximity, chat bubbles and interest correct. Only write when the change is > 2 cm, to limit patches. `canMove` still drops world `Move` and `Jump` aboard.

**Clients:**
- `LocalPlayer.tsx`: when `selfBusRide.slot === 0`, read WASD or the joystick relative to the camera's yaw in the bus frame. Integrate a bus-local position with `stepInCabin` (prediction) and send `BusMove`. The avatar faces its walk direction, uses the walk animation, and its y is `cabinFloorAt`. Running is off and jumping is off. For a seat or hold, play the sit or hold pose (a new `HOLD_POSE` clip, or a procedural arm raise to the pole at shoulder height, built in the character pipeline, not a runtime primitive). Reconcile with the server echo (snap if > 0.5 m off).
- Interaction prompts: `villageTargets.ts` gains `villageBusCabinTarget(...)`:
  - nearest free seat or hold → "E 앉기" or "E 손잡이 잡기" (touch "앉기" or "잡기");
  - seated or holding → "E 일어나기";
  - in the exit zone, or anywhere when parked → "E 내리기" (priority over sit when parked and in the exit zone).
  Click or tap on a seat mesh walks the avatar there (reuse click-to-move in bus-local) and then sits. Free seats glow faintly (outline) only while you are aboard and free, so first-timers see what is sit-able.
- `RemotePlayer.tsx` / `remoteSync.ts` / `remoteStore.ts`: listen to `busAhead`, `busRight`, `busYaw` and `busSeat`. Interpolate in the bus-local frame (100 ms buffer, the same playout idea), then convert with the client's own rendered bus pose (`getTransitRenderPose()`), so remotes never jitter against the bus. Choose the walk, idle, sit or hold animation from the speed and `busSeat`.

### (b) Camera inside the bus (`client/src/village/transitCamera.ts` rewritten, plus CameraRig hook)
- **State**: `busCam = { yaw, pitch, dist }`, where yaw is relative to the bus heading. Default on boarding is `yaw = PI` (behind the avatar, looking forward down the aisle), `pitch = -0.18`, and `dist` 2.0 on PC or 2.3 on a portrait phone.
- **Input**: reuse CameraRig's orbit drag handlers (mouse drag / right-drag on PC, one-finger drag on touch outside the joystick, the wheel and pinch for dist). While aboard they write to `busCam` instead of `orbit`. `dist` is clamped to [0, 2.6]; at dist < 0.35 the camera snaps to first person (eye at head height minus 0.25, own avatar hidden via the existing `group.visible` rule). Pitch is clamped to [-0.9, 0.5].
- **Quick views (UI)**: a small pill above the ride panel with `◀ 왼쪽` / `앞` / `오른쪽 ▶` / `뒤`. A tap eases `busCam.yaw` over 400 ms to show that window side from the avatar's side (left = −PI/2 + small offset, etc.). Keyboard Q and E are already used, so use `[` / `]` or ← → arrow keys while seated. A first-ride hint toast appears once per device (localStorage, try/catch): "화면을 끌어서 창밖을 둘러보세요 · 빈 자리를 눌러 앉을 수 있어요".
- **Placement**: target = the avatar's head (bus-local) + 0.1 up. The desired eye is target + spherical(yaw, pitch, dist). The spring arm casts target→eye against:
  1. the cabin shell box, ahead [-4.10, 4.10] (wider at the front so the windscreen is reachable), right ±1.12, h [floor+0.3, 3.05];
  2. `seatBacks` boxes (generated).
  It stops 0.12 m short of the first hit. Poles and straps never stop the arm.
- **Never clipped by thin things**: every frame, any `pole_*`, `strap_*` or `stop_btn_*` object whose segment is within 0.6 m of the eye, or within 0.15 m of the eye→head or eye→chest segment (reuse `segmentDistance`), gets its material swapped to a shared fading clone (opacity → 0.15 over 150 ms, `depthWrite false`), and is restored after. The camera near plane is 0.05 aboard. Delete `riderShot`/`searchShot` and the fixed `CABIN_BARS` table, which is replaced by generated `poles`/`straps`.
- FOV: keep `riderFov` (68 / 78 portrait).
- Leaving restores the world orbit exactly as now (`fovBeforeRideRef`).

### (d) Follow-up fixes
1. **Invisible wall at the empty stop / parked rear slices 0.3 m out / no mirror collision on the moving bus**: one body for both states.
   - `busBody.ts`: add `BUS_MIRRORS` (two bus-local rects: ahead [4.40, 4.87], right ±[1.15, 1.52]; from `BUS_MIRROR_REACH`) and `busShapes()`. `busClearance` / `pushOutOfBus` work on the union: iterate up to 3 times, pushing out of the deepest overlapping shape. The mirror rects push sideways or backwards, never ahead.
   - `villageLayout.ts`: `buildVillageGeometry` no longer adds `busParkedColliders`, and `villageGeometry` no longer adds `busMirrorColliders` (keep both functions for tests and boarding-area maths, or delete busParkedColliders if unused).
   - Server: `movingBusPose` becomes `busBodyPose(now)` and returns the pose whatever the status (parked included). `tickBus` and `afterMove` push against it always.
   - Client `playerObstacles.ts`: the same, with the rendered bus pose.
   - Camera: CameraRig's spring arm adds a ray-vs-OBB test against the bus body (bus-local slab test, height 0..`BUS_HEIGHT` 3.75) for the parked and the moving bus.
   - `BusDriver` (`busDrive.ts`): the look-ahead uses the body plus the mirror ahead reach (4.87 m), so it brakes 1.5 m before mirrors too.
2. **'E 버스 타기 · 10분 뒤 출발' while the bus is away**: `villageBusTarget` returns an actionable target only when `boardingNow && !busOnRoad`. Otherwise it returns `{ kind: "info", ... }`, which the HUD draws as a key-less chip ("🚌 다음 버스 7분 뒤 · 출발 3분 전부터 탈 수 있어요"; while the bus is on the road: "🚌 버스 운행 중 · 7분 뒤 출발"). It takes no E key, no button and no priority over seats. If the InteractTarget type has no info kind, add `informational: true` and make the key binding and the touch button skip it.
3. **Pole crossing the arm / phone portrait dominated by the seat and face**: solved by (b). The e2e asserts it (see (g)).

### (e) Lamps and flag poles (confirmed passable on main)
New `shared/src/village/streetPoles.ts`:
- `lampSpots()`: plaza lamps from `VILLAGE_LAYOUT.plaza.lamps`, plus ring lamps computed exactly like `parts_props.py lamp_positions()` from `VILLAGE_LAYOUT.lanes`.
- `bannerSpots()`: the 8 angles at r 26.
- `streetPoleColliders()`: square AABBs, half 0.20 for lamps (base r 0.17) and 0.15 for banners (base r 0.12), rounded 1e-6.

Add them in `buildVillageGeometry` next to `signalPoleColliders()` (obstacles only, not camera boxes). Test (`server/src/tools/villageProps.test.ts`, the same GLB-reading approach as villageBus.test.ts): the `lamps` and `banners` meshes' vertex clusters near the ground (y < 0.4) each sit inside one collider, with the counts equal. Also check that nothing blocks the bus lane, the crossings, the pad or the lanes (`isBlocked` of the lane centre lines false). Then check e2e: walking into a lamp and into a banner pole stops the avatar.

### (g) Tests, e2e, milestones
Unit (vitest):
- busCabin.test: generated data matches the GLB (villageBus.test reads the GLB's `pole_*`, seat nodes and `ceiling` height); seats are not blocked in the aisle; a standing avatar's head and hat (2.52 / 3.03) are under the ceiling (3.15); the aisle allows r 0.4 from the entry to every seat's approach point and the exit zone (grid BFS); approach rules (a backed seat from behind is rejected, folding seats from the aisle only).
- busBody.test: mirrors push; a parked pose pushes; no push 0.05 m behind the rear; rear clearance exact (the regression for the 0.3 m).
- villageLayout.test: the geometry has no bus slices, and streetPoleColliders are included.
- transitRuntime / VillageRoom integration: board → busSeat 0 at the entry; BusMove accepted or rejected (speed, walls, seat); BusSit taken → rejection; backed from behind → rejection; Stand; leave refused inTransit; lap-end auto-dismount; x/z follow the bus.
- villageTargets.test: no actionable board target while away or closed, the info chip instead.

e2e (2 browsers sequentially in one Chromium with 2 contexts; `e2e/lib/common.mjs`; extend `village-bus-rider.mjs`, new `village-bus-cabin.mjs`; evidence in `scratchpad/busride2/<label>/`):
1. A and B board.
2. A walks to L2 and sits; B tries L2 → notice; B holds H1.
3. B's screen shows A seated (`__cv` remote record busSeat and world pose inside the bus footprint).
4. While moving: drag the camera left/right/back on PC (A) and on a 390×844 touch viewport (B). Screenshots show both side windows, the front and the rear. Assert via `__cvThree` that the camera stays inside the cabin box and that no faded pole is drawn between the camera and the head.
5. A stands up and walks; the walk stays in the aisle.
6. The bus stops; both press leave → on the pad.
7. With the bus away, walk through the empty stop lane area (no wall) and confirm no 'E' prompt.
8. Bump into a lamp and a banner pole → blocked.
9. The bus yields to a person on the road (regression of main).
LOOK at every screenshot, and compare the interior with the reference photos side by side.

Milestones (commit each, Korean message, explicit paths):
- **M1**: collision fixes (d1, d2) plus street poles (e), with tests.
- **M2**: Blender bus: taller body, new cabin, `village_bus_cabin.json`, GLB, renders against the references, villageBus.test.
- **M3**: shared busCabin plus the generator, schema fields, server messages and validation, with integration tests.
- **M4**: client walk, sit and hold aboard, prompts, seat highlight, and remote rendering.
- **M5**: in-bus orbit camera, quick views, the hint, and pole fading.
- **M6**: e2e on 2 clients, phone and PC screenshots, a full test run, and a report for the controller.

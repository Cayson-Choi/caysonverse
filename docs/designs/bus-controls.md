# 버스 안 조작과 카메라 (bus controls) — 2026-11-18

Owner's words (this round):

1. "버스안에서 이동이 잘 안되고 카메라의 각도를 올리고 내리고 하는게 잘 안돼 바닥을 더 보고 싶은데 못보는 경우도 많아"
2. "1인칭뷰가 아닐때 뭔가 카메라 각도 바꾸고 이동하는 것도 어렵다" (screenshot: third person in the bus, the lens jammed behind the
   crowned head, which fills half the screen)
3. "정류장에서 줌인을 하다보면 이렇게 캐릭터 내부까지 들어가 있는 상태가 되기도 해" (screenshot: the whole screen is the inside of the head)
4. "버스에 탔을 때 뭔가 조작이 불편한데 어떻게 하는게 좋을지 잘 생각해봐"

Evidence (before / after, PC 1280x800 and phone 375x812): `.superpowers/sdd/evidence/buscam/` (e2e/bus-controls.mjs, `--before`
on the old build).

## 1. What the old code did (measured)

| | old behaviour | effect |
|---|---|---|
| Bus, first person | look pitch clamp `FP_PITCH_MAX` 1.2 rad (69°) | the floor at the feet never comes into view; seated you see the seat in front, not the floor |
| Bus, third person — tilt | the drag changed `orbit.pitch`, mapped to an elevation clamped to 0.3–0.8 rad and then capped again by the ceiling (`asin((top − head)/arm)`, ≈0.19 rad standing). The look direction itself was computed from a "frame the rider in a lower corner" rule, not from the drag | the vertical drag did almost nothing: the view could not be tilted down to the floor or up to the ceiling |
| Bus, third person — position | the lens was put on the aisle's centre line in front of or behind the rider, 2.6–3.2 m, then clipped by the shell; a side view kept the lens on the aisle and turned only the look | near a cabin end, beside a seat or standing (head 0.6 m under the ceiling) the arm was clipped to ~1 m right behind the 1 m-wide chibi head: the owner's "huge crowned head fills half the screen". The look direction did not follow the yaw exactly, so W / the stick did not walk "where I look" |
| Bus, walking | keys / stick only; a click or tap anywhere but a seat did nothing | on a phone the only way down the aisle was the stick in a 0.75 m aisle |
| Bus stop / outdoors | the spring arm pulls the camera in front of a wall (the parked bus counts as one). The own body is hidden when `cameraProbe.distance < 1.8` — but that probe is the *wanted* zoom distance (≥ 3.2 m), never the shortened arm | the hide rule never fired: with the bus behind, the lens ended 0.1–0.6 m from the pivot, inside the head (measured: camera inside the head box, body drawn — the owner's screenshot 3) |

## 2. How games handle tight vehicle interiors

- **Over-the-shoulder (OTS) aim camera** (Gears, The Last of Us, GTA's tight interiors, Fortnite): the camera looks exactly where the
  player aims (yaw + pitch from the drag); the character sits off to one side, so it never covers the middle of the picture; a short
  spring arm pulls in at walls.
- **Spring arm + hide owner when close** (Unreal's SpringArm, Roblox's "zoom to occlusion" + local transparency): when a wall pushes the
  camera into the character, the character is hidden (or dithered) instead of being looked through.
- **First person as the comfortable default inside** (train / bus interiors in sims, Roblox vehicle seats): the cabin is too small for
  an orbit, first person shows the windows best.
- **Explicit, predictable toggles**: one button / key switches first ↔ third person; the camera never moves by itself.

## 3. The design

### 3.1 First person (the default on boarding — unchanged)

- Eye at the rider's head (standing or seated: window height), the look follows the drag.
- **Pitch range: −86° (up) … +80° (down)** — `FP_PITCH_MAX` 1.2 → 1.4 rad everywhere first person is used. Looking down shows the
  floor at the feet. (The rides keep their own 69° limit: their cameras clamp it themselves and the drag is held to it on a ride, so
  there is no dead zone.)

### 3.2 Third person in the bus = over-the-shoulder

- **Pivot**: the head's real centre (the chibi's 1 m head runs from its head bone at 1.22 m to its top at 2.19 m: centre 1.7 m
  standing, 1.75 m seated over the floor), +0.35 m up and **0.55 m to the right shoulder** (the side flips to the left — eased —
  when the right side has no room, e.g. a seat by the right wall looking to the front). On a portrait phone the left shoulder is
  preferred and the offset is 0.33 m: the narrow screen is only ~40° wide and the ride panel covers its left half, so the rider
  stands right of the middle there; and the arm is 1.3× longer (as the village's portrait pull-back), or the body fills the screen.
- **Look = the aim**: the camera looks exactly along the player's yaw and pitch (the same pair as first person), so
  - the vertical drag tilts the view from 43° up to 80° down — the floor is in view;
  - W / the stick walks exactly where the view looks;
  - first ↔ third person keeps the same aim (the pitch is copied across the toggle; the yaw already was).
- **Arm**: the zoom picks 2.5–3.5 m (the village zoom 3.2–10 m mapped onto it; zooming in past the least goes to first person as
  everywhere). The arm is a spring arm against the **cabin shell** only (walls, ceiling, the ends; never seats or riders — owner
  2026-11-16), and never lower than 1.15 m over the floor (no lens behind a seat back).
- **Under the ceiling the lens slides back instead of diving into the head**: a standing head is only 0.86 m under the camera's
  ceiling (the roof 3.15 m, the lens 0.25 m under it). A lens cut short along its own line would end at the head; instead it stays
  at the ceiling and backs off horizontally as far as the arm — but on a steep look down only so far that the head stays in the
  picture (within 26° of the middle). Looking up, the same at the lowest height the lens may take.
- **Too close → hidden, cleanly**: closer than **2.3 m to the head's centre** the own body is hidden; it shows again past 2.5 m (no
  flicker); on a portrait phone 2.65 / 2.9 m (its narrow screen shows a near body bigger). The chibi head is 1.1 m tall: at 1.6 m it
  fills half the picture (the owner's screenshot), at 2.3 m about a third of a PC's height. The view is then a clean look past the
  shoulder: out of a window, straight down at the floor, against an end wall. No half-transparent ghost head (indoor review r5/r9:
  a faded head near the lens is a big see-through disc). The general rule (3.5) also holds.
- Result: looking along the bus the rider stands to one side of the picture, 2.3–3.5 m away, the aisle and both window rows in view;
  looking out of a window the lens meets the wall and the body is hidden — the window fills the view.

### 3.3 Walking in the bus

- Keys / stick: camera-relative (now true in third person too, since the look is the aim). The aisle slide (stepInCabin) is kept.
- **New: tap / click the aisle floor to walk there** (like the village's click-to-walk). A tap on a seat still walks to it (no
  auto-sit: owner 2026-11-17). A tap on floor inside a seat block walks to the aisle beside it. Seated, a floor tap stands the rider
  up and walks there. A key or the stick takes over at once.

### 3.4 Seats, standing, the panel

- Sit / stand: unchanged — walk up (or tap the seat) and press E / 앉기; any move key, the stick or a floor tap stands up.
- The camera does not move by itself on sitting or standing (owner 2026-11-10); boarding starts in first person looking to the front.
- The panel keeps the four quick views (◀ 왼쪽 창 · 앞 · 오른쪽 창 ▶ · 뒤): one tap to look out of a side, useful on a phone. It
  gains a plain **"👁 3인칭으로 보기 / 1인칭으로 보기"** button (the top-bar 👁 icon was not obvious to a first-time rider; on a phone
  "👁 3인칭 / 1인칭", sharing a row with 하차 so the panel is no taller), and the hint says what works: drag to look (up/down too),
  tap the floor to walk, tap a seat to go to it.

### 3.5 Everywhere: the camera never sits in the avatar

- Every frame the own avatar measures the drawn camera's distance to its head and body (`selfGap.ts`: an upright capsule from
  0.9 m to 1.7 m over the feet — the head's centre — 0.6 m round: the 1 m head with its hair and crown).
- Closer than **0.6 m** to it, the own body is hidden (shown again past 0.75 m) — at the bus stop, against any wall, indoors. This
  replaces the outdoor rule that read the wanted zoom (never under 3.2 m) and so never fired. The player's own least zoom never
  triggers it at any tilt (unit-tested); only a wall pulling the spring arm in does. The indoor rules (seat framing, 1 m hide, the
  shoulder fade) stay as they were.
- The spring arm still keeps the lens in front of walls (buildings, the parked bus); the bus shell keeps the bus lens inside the cabin.

### 3.6 Not changed

- The village third-person orbit's tilt range (−6° … 69°): the camera looks down at the avatar from above, the ground is already in
  view; going past it would put the lens over the head where the yaw turns unstable.
- Rides (coaster, carousel, wheel), the overview map, seat framing indoors, houses and lots.

## 4. Code

- `client/src/village/transitCamera.ts` — the bus camera: first person, the over-the-shoulder third person (pivot, aim, shell arm,
  ceiling slide, shoulder side), `busSelfHidden`.
- `client/src/game/selfGap.ts` — the camera's gap to the own head and body, the hide / show bands (0.6 m; 0.9 m outdoors).
- `client/src/game/CameraRig.tsx` — the bus pitch range on the drag, the aim carried across the first / third person toggle, the
  shoulder easing, floor taps in the bus (`busFloorUnderRay`), the rides' drag held at their own 69°.
- `client/src/game/LocalPlayer.tsx` — the body hidden by the gap rule (anywhere) and in the bus by `busSelfHidden`; the floor-tap
  walk (`busWalkGoal`).
- `client/src/village/VillageScene.tsx` — the ride panel's 1인칭 / 3인칭 button and hint.

## 5. Verification

- Unit: `transitCamera.test.ts` (the aim is the drag's yaw and pitch in both views, the lens inside the shell everywhere, never in the
  head, the rider shown looking along the bus, the shoulder side), `selfGap.test.ts` (the least zoom never hides at any tilt, a
  spring arm pulled to the head does), `busSeatPick.test.ts`, `viewMode.test.ts`.
- E2E `e2e/bus-controls.mjs` (PC and `--phone`; `--before` measures the old build): the bus stop zoomed in at 6 yaws x 3 tilts and
  by the wheel, first person down to 80° and up, third person tilt down / up, every quick view and a full turn, zoomed in, the
  keys / stick down and up the aisle, a floor tap, seated third person.

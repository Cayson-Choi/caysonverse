# 케이슨 마을 1단계 (구경 버전) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a player builds a toy character, types a nickname, presses 입장하기 and walks straight into a realistic Korean countryside village. The village has a plaza with a big zelkova tree, a ring road, glowing empty building plots, a stream with a wooden bridge and a pavilion, and the first building: a pet memorial hall with a roof and a ceiling. Inside the hall the camera stays under the ceiling, and visitors look at sample decorated cubbies and empty ones. There is no login and no payment.

**Architecture:**
- **Server:** a new `VillageRoom` (a `PlayerRoom` subclass) shards about 30 players per room with `joinOrCreate`.
- **One map, two areas:** the village area and the hall interior area, placed far apart in the same coordinate space. A validated `UseDoor` message teleports a player between them.
- **Rendering:** the client draws only the area the local player is in.
- **Indoor camera:** a per-area camera limit (max height under the ceiling, max distance) plus ceiling camera boxes.
- **Art:** built in Blender by script, exported to `village.glb` and `memorial.glb` with baked lightmaps, using the existing GLB → collider → lightmap pipeline.

**Tech Stack:** Colyseus 0.17 + @colyseus/schema 4, Express 5, React 19 + R3F 9 + three 0.185 + drei 10, zustand, vitest, Playwright (installed Chrome), Blender 5.2 CLI (`C:/Program Files/Blender Foundation/Blender 5.2/blender.exe`), Cycles GPU for bakes.

**Spec:** `docs/superpowers/specs/2026-11-03-cayson-village-design.md`. Its §12 "1단계 구경 버전" is the scope; §11-1 holds the controller's calls.

## Global Constraints

- **Character:** keep the toy-figure character and the existing builder unchanged (owner, 2026-11-03).
- **Scope:** no login, no payment, no photo upload, no item shop in phase 1 (owner, 2026-11-03).
- **Entry:** 입장하기 goes straight to the village with no code and no destination sheet. AI 학교 탈출 stays reachable only by `?experience=escape`. The legacy world stays reachable only by `?world=legacy`. Neither gets any other change.
- **Art realism:** realistic materials and light, following real Korean countryside references.
  - Before modelling, read the controller's reference brief (`art/village/references.md`), which comes from Aside image searches.
  - Every art task ends with a side-by-side comparison against those references.
- **Asset sources:**
  - Hand-made in Blender, plus CC0 assets from Poly Haven (https://polyhaven.com) only.
  - Every downloaded asset gets a row in `docs/licenses.md` (name, URL, licence, date).
  - No AI-generated 3D models or textures.
- **Collision:** server collision is 2D axis-aligned boxes; walkable ground is flat (y = 0).
  - Slopes, hills, mountains and the waterfall are outside the walkable bounds, as a visual backdrop only.
  - Collider nodes are `col__<name>` unrotated unit cubes, extracted by `scripts/extract-colliders.ts`.
- **Budgets:**
  - `village.glb` ≤ 8 MB, ≤ 260k triangles, textures ≤ 2048².
  - `memorial.glb` ≤ 6 MB, ≤ 200k triangles before instancing (cubby props are instanced at runtime, not baked into the GLB).
  - First entry into the village downloads ≤ 15 MB in total on a phone, character included.
  - Phone tier at 4× CPU throttle: mean frame ≤ 33 ms with 30 players in the village, and ≤ 33 ms in the hall.
  - Brightness: `e2e/luma-check.mjs`, mean ≥ 0.45 and p5 ≥ 0.10 on daytime scene frames; night frames follow Task 7A's bar.
- **Quiet hall:** inside the memorial hall, emoji and jump are refused server-side, and chat stays on.
- **UI copy:** Korean, friendly "~요" tone, gentle and respectful in the memorial. No exclamation marks in memorial copy.
- **Repo rules:**
  - No `npm install` / `npm ci`.
  - Commit only on `feature/cayson-village`, with `git -c user.name="Cayson-Choi" -c user.email="cayson0127@gmail.com"` and the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Never `git add -A`.
  - Never stash or switch branches.
  - Integration-test ports: the next free one is 2574.
- **Don't touch:** `WorldRoom`, the legacy world, `ClassRoom`, `EscapeRoom`, and the escape game's behaviour.

## Review Focus

1. **A door used twice quickly, or from too far away.** The server refuses it, so no one ends up in a wall or between areas. Test: `UseDoor` beyond 2.5 m is refused, and a second `UseDoor` within 1 s is refused.
2. **A full room (30).** The 31st player lands in a new shard and still sees the same village. Test: an integration test joins 31 clients and asserts 2 rooms.
3. **Reconnect after a phone sleeps while inside the hall.** The player comes back in the hall, not at the village gate. Test: a dropped client reconnecting within the window keeps `area = "hall"` and its position.
4. **The camera inside the hall never shows the sky through the ceiling.** It holds at any orbit pitch and when backing into a corner. Test: a unit test over `indoorCameraClamp` that sweeps pitch and distance.
5. **Players in the other area are invisible and cost nothing.** No nametag, no chat bubble, no draw calls. Test: a scene-level test that remote players filtered by area are not mounted.

---

### Task 1: Village layout as shared data

**Files:**
- Create: `shared/src/village/villageLayout.ts`, `shared/src/village/villageLayout.test.ts`
- Create: `scripts/export-village-layout.ts` (writes `art/village/layout.json` for the Blender scripts)

**Interfaces:**
- Produces: the type `VillageLayout` and the constant `VILLAGE_LAYOUT` with these exact values:
  - `walkBounds`: x −60..60, z −60..60
  - `spawn` (owner 2026-11-03, start at the central fountain plaza): (0, 9), facing north toward the fountain (−z), jitter 2.5
  - `plaza` (owner 2026-11-03, a big fountain plaza at the centre): `fountain` centre (0, 0), round basin of 12 m outer diameter, collider 9 × 9; `paving` disk of radius 17 (visual only); `zelkova` with a round deck at (−12, −10), collider 5 × 5
  - `ringRoad`: radius 20, width 5 (visual only)
  - `stream`: runs along z = 30 from x = −60 to 60, water width 6, bank colliders on both sides except the bridge gap x −2..2
  - `bridge`: x −2..2, z 27..33, walkable
  - `pavilion` (정자): centre (−14, 36), 5 × 5 collider
  - `plots`: six plots, 16 × 16, ids `plot_n` (0, −40) = memorial hall, `plot_ne` (36, −22), `plot_e` (40, 10), `plot_w` (−40, 10), `plot_nw` (−36, −22), `plot_s` (30, 44). Each plot except `plot_n` has `sign: "곧 지어져요"` and an upcoming label: `plot_w` 도서관, `plot_e` 학교, `plot_ne` 성당, `plot_nw` 절, `plot_s` 교회.
  - `memorial.exterior`: footprint 14 × 12 centred (0, −42); door pad at (0, −35.6), radius 1.6
  - `memorial.interior`: area origin (300, 0), room 9 × 12 (x 295.5..304.5, z −6..6), ceiling height 3.4; inside door pad (300, 5.2), radius 1.4; inside spawn (300, 4.2) facing −z
  - `sceneryHouses`: five 9 × 7 footprints at (−46, 40), (−30, 50), (46, −46), (52, 30), (−52, −44), non-enterable
  - `areas`: `"village"` = walkBounds, `"hall"` = the interior rectangle
- Consumes: `makeGeometry` and `wallsAround` from `shared/src/school` / `geometry.ts` (as `hubMap.ts` does).

- [ ] **Step 1: Write failing tests** in `villageLayout.test.ts`. The spawn is ≥ 1.4 m from every collider. Every plot and the door pad are reachable from the spawn on a 0.5 m grid flood fill over `isBlocked`, crossing the stream only by the bridge. The interior spawn and the inside door pad are reachable inside the hall area. No collider overlaps the bridge walkway.
- [ ] **Step 2: Run** `npx vitest run shared/src/village` → FAIL.
- [ ] **Step 3: Implement** `villageLayout.ts`. Add `"village"` to the `GeometryId` union in `shared/src/geometry.ts`. Export `villageGeometry` built from the layout (greybox colliders now; Task 7 swaps in generated ones).
- [ ] **Step 4: Implement** `export-village-layout.ts`, which runs `npx tsx scripts/export-village-layout.ts` → `art/village/layout.json`.
- [ ] **Step 5: Run** `npx vitest run shared/src/village` and `npm run typecheck` → PASS.
- [ ] **Step 6: Commit** `feat: 케이슨 마을 배치 데이터와 지도 불변식 (케이슨 마을 1단계 Task 1)`.

### Task 2: VillageRoom on the server

**Files:**
- Create: `server/src/rooms/VillageRoom.ts`, `server/src/rooms/VillageRoom.integration.test.ts` (port 2574)
- Modify: `server/src/rooms/index.ts`, `shared/src/constants.ts` (`VILLAGE_ROOM = "village"`, `VILLAGE_MAX_CLIENTS = 30`), the `Player` schema (`area: string`, default `"village"`)

**Interfaces:**
- Produces:
  - Room name `village`, registered for `joinOrCreate` so a full room spills into a new shard.
  - Join options `{ nickname, appearance }`, validated like `WorldRoom` minus the admin and kick parts.
  - Message `VillageMsg.UseDoor = "UseDoor"`, payload `{}`.
    - Allowed when the player is within the door pad radius + 0.9 m.
    - Rate-limited to 1 per second per client.
    - The server sets the position to the other side's spawn and flips `player.area`.
  - `area`-aware quiet mode: `Emoji` and `Jump` are refused while `area === "hall"`.
  - `autoDispose` true; default 20 s reconnect window.
- Consumes: the `PlayerRoom` base, `villageGeometry`, and `VILLAGE_LAYOUT` (Task 1).

- [ ] **Step 1: Write failing integration tests.**
  - Join → spawn near (0, 52), `area` "village".
  - Walk legally to the door pad → `UseDoor` → `area` "hall", position (300, 4.2).
  - `UseDoor` from 5 m away → refused (no change).
  - Two `UseDoor` within 1 s → second refused.
  - Inside the hall: emoji and jump refused, chat delivered.
  - 31 clients → 2 room instances.
  - A drop + reconnect within the window keeps `area` "hall".
- [ ] **Step 2: Run** `npx vitest run server/src/rooms/VillageRoom.integration.test.ts` → FAIL.
- [ ] **Step 3: Implement** `VillageRoom.ts`. Teleport by setting position directly in the `UseDoor` handler, so the speed check doesn't see a jump. Also reset the movement tracker for that client so the next `Move` from the new spot is valid.
- [ ] **Step 4: Run** the tests above, plus `npm run typecheck && npm run test` → PASS.
- [ ] **Step 5: Commit** `feat: 케이슨 마을 서버 방 — 30명씩 나누기, 문 이동, 추모관 조용한 모드 (케이슨 마을 1단계 Task 2)`.

### Task 3: Entry goes straight to the village

**Files:**
- Modify: `client/src/ui/entryForm.ts` (`entryModeFromUrl` adds `"escape"` for `?experience=escape`; the default mode becomes `"village"`), `client/src/ui/EntryScreen.tsx` (in village mode, 입장하기 joins the village directly without opening the destination sheet), `client/src/stores/appStore.ts` (`Screen` adds `"village"`, plus `enterVillage`), `client/src/App.tsx`, `client/src/net/connection.ts` (`joinVillage` uses `joinOrCreate(VILLAGE_ROOM)`; the room mode adds `"village"`), `client/src/net/resilience.ts` (mode `"village"`; the fresh rejoin uses `joinOrCreate`), the related tests (`entryForm.test.ts` and others)
- Modify: `scripts/subset-builder-font.mjs` input text, if any new Korean title uses the Jua subset font. Re-run it.

**Voice removal (owner 2026-11-03: "음성은 빼버려 음성이 너무 기계음 같아서 안좋아"):**
- The builder's 목소리 section (남자/여자 목소리) is removed from `BuilderPanel` and `builderOptions`.
- Chat is never read aloud. `chatVoice.ts` / `tts.ts` / `chatSync.ts` stop speaking, behind one flag, `CHAT_VOICE_ENABLED = false`.
- The sound toggle no longer mentions voice.
- The appearance field for voice stays in the schema (the server and old saves still send it) but is ignored.
- Legacy-world NPC voices (`npcVoice.ts`) are out of scope; the world stays untouched.
- Tests: the builder renders no 목소리 section, and an incoming chat line triggers no speech call.

**Interfaces:**
- Produces: `joinVillage(opts): Promise<Room<WorldState>>`, `useAppStore.enterVillage()`, screen `"village"`.
- Consumes: Task 2's room name and join options.

- [ ] **Step 1: Write failing unit tests.** Default entry mode is `"village"`. `?experience=escape` → `"escape"`, which shows the old destination sheet. `?world=legacy` is unchanged. A village-mode submit calls `joinVillage` and `enterVillage` and never opens the sheet.
- [ ] **Step 2: Run** the client tests → FAIL. **Step 3: Implement.** **Step 4:** `npm run typecheck && npm run test` → PASS.
- [ ] **Step 5: Commit** `feat: 입장하기를 누르면 바로 케이슨 마을로 (케이슨 마을 1단계 Task 3)`.

### Task 4: Village scene (greybox), areas and doors

**Files:**
- Create: `client/src/village/VillageScene.tsx`, `client/src/village/villageArea.ts` (+ test), `client/src/village/DoorFade.tsx`, `client/src/village/PlotMarkers.tsx` (glowing plot outlines + sign text)
- Modify: `client/src/game/sceneLighting.ts` (`LightingId` adds `"village"`: afternoon sun, sky colour, fog 60–220 m), `client/src/game/activeMap.ts` (sets the village map), the remote-player rendering path (filter by `area`)

**Interfaces:**
- Produces:
  - `localArea(): "village" | "hall"`, read from the local player's state.
  - `RemotePlayers` mounts only players whose `area` equals the local area.
  - Door targets are registered via `interactTargets.setTargetSource`: label "추모관 들어가기" outside, "밖으로 나가기" inside. E or the action button sends `UseDoor`; a 0.4 s fade covers the teleport.
- Consumes: PlayShell (as `HubScene` uses it), Task 1 layout, Task 2 messages.

- [ ] **Step 1: Write failing tests.** Area filter: a remote in the other area is not mounted. Door target appears within the radius only. Plot marker labels come from the layout.
- [ ] **Step 2: FAIL. Step 3: Implement** with `MapBoxes` greybox geometry, so the village is walkable before the art exists. **Step 4:** tests + typecheck PASS. Then a manual check in `npm run dev`: walk spawn → bridge → plot sign → door → inside → out.
- [ ] **Step 5: Commit** `feat: 케이슨 마을 장면 뼈대 — 구역 나누기, 추모관 문, 빈 부지 표시 (케이슨 마을 1단계 Task 4)`.

### Task 5: Indoor camera

**Files:**
- Create: `client/src/game/indoorCamera.ts` (+ test)
- Modify: `client/src/game/CameraRig.tsx` (replace the maze-only clamp call with the area clamp; keep the maze behaviour identical through the same function), `client/src/game/activeMap.ts` (`ActiveMap.cameraLimit?: { maxY: number; maxDistance: number; overview: boolean }`), `shared/src/geometry.ts` (`CameraBox.minY?: number` for ceiling slabs)

**Interfaces:**
- Produces: `indoorCameraClamp(desired: Vector3, target: Vector3, limit): Vector3`. For the hall the limit is `{ maxY: 3.1, maxDistance: 3.6, overview: false }`.
- Consumes: Task 4 area. When the local area is "hall", `activeMap.cameraLimit` is the hall limit.

- [ ] **Step 1: Write failing tests.** Sweep pitch 0..1.2 and distance 2.5..18: the camera y is always ≤ 3.1 and the distance ≤ 3.6. The maze clamp gives the same results as before for its cases (golden values). The overview toggle is refused while `overview: false`.
- [ ] **Step 2: FAIL. Step 3: Implement. Step 4: PASS** + typecheck.
- [ ] **Step 5: Commit** `feat: 건물 안 카메라 — 천장 아래에 머물기 (케이슨 마을 1단계 Task 5)`.

### Task 6: Village art (Blender) — references first

**Files:**
- Create: `art/village/references.md` (controller writes it before dispatch; it is git-ignored like `art/`), `art/village/tools/build_village.py`, `art/village/tools/bake_village.py`, `art/village/export/village.glb` + `village_lm.webp`
- Copy to: `client/public/models/village/village.glb`, `client/public/models/village/village_lm.webp`
- Modify: `scripts/lib/schoolSpec.ts` → add a `village` kind to `scripts/check-school-glb.ts` with the budgets in Global Constraints, `docs/licenses.md`

**Style target (owner, 2026-11-03):** `art/village/refs/owner_village_style.webp` comes first; the Korean countryside refs supply natural detail only. That means:
- the fountain plaza with a polished **crescent-moon sculpture**, flower-bed rings, cherry blossoms, street lamps and banner poles;
- a ring road with sidewalks, a bus stop and a parked village bus;
- small colourful houses and a café with awnings as non-enterable scenery;
- the next plot (도서관) dressed **under construction** (scaffold + yellow crane);
- a wooden arched footbridge over a rocky creek with small cascades;
- a waterfall cliff and a lake with a pavilion in the backdrop;
- golden-hour sun, low at the back right.

**Content (all positions from `art/village/layout.json`):**
- Flat walkable ground: grass, dirt and concrete village lanes, the ring road (asphalt with worn edges).
- Plaza: a big round fountain at the centre: a stone basin 12 m across with a tiered centrepiece and water jets, plus wide stone paving (radius 17) and benches. At the edge, one big old zelkova (느티나무) with a round wooden deck.
- Stone walls (돌담) along two lanes.
- Stream: smooth granite rocks (너럭바위), water surface with subtle normal map, reeds, a flat wooden bridge with rails.
- 정자: a traditional pavilion with a tiled roof and red-brown pillars.
- Six plots: mowed grass, a thin emissive outline strip (glow), and a small wooden sign post. The sign text itself is runtime (Task 4).
- Five scenery houses: rural homes, some with coloured metal roofs (blue/red/green), one hanok with a tiled roof; doors closed.
- Memorial hall exterior on `plot_n`: low modern building, white render + wood cladding, large windows, flat or low-pitched roof, entrance canopy, garden and lawn with a few trees (수목장 feel).
- Backdrop outside the walk bounds: rolling hills, forested low mountains, a waterfall on a rock face (west), a lake with a pavilion (north-east). No collision; heavy fog-friendly LOD.
- Trees: CC0 bark/leaf textures as alpha-card canopies; ≤ 60 trees inside bounds.
- `col__*` boxes for every solid thing on the walkable ground. `col__` names match Task 1 ids where they exist.

- [ ] **Step 1:** The controller writes `art/village/references.md` with Aside search results: aerial rural village, 느티나무 쉼터 평상, 개울 너럭바위 나무다리, 정자, 돌담길, 시골집 함석지붕, 반려동물 추모공원 외관. Include what to copy (proportions, materials, colours).
- [ ] **Step 2:** `build_village.py` builds the scene from `layout.json`. `bake_village.py` bakes a 2048 lightmap (Cycles GPU) for the static scene.
- [ ] **Step 3:** Export, then run `npx tsx scripts/check-school-glb.ts client/public/models/village/village.glb village` → PASS.
- [ ] **Step 4:** Render 4 reference-comparison frames (plaza, stream + bridge, plots, hall exterior), each beside its reference screenshot. Write the paths into the report.
- [ ] **Step 5: Commit** (the client model files, the check-tool kind and the licence rows; `art/` stays ignored) `feat: 케이슨 마을 모델 — 느티나무 광장·개울·빈 부지·추모관 외관 (케이슨 마을 1단계 Task 6)`.

### Task 7: Village model in the game

**Files:**
- Create: `client/src/village/VillageModel.tsx`, `client/src/village/villageModelPrep.ts` (+ test)
- Modify: `client/src/village/VillageScene.tsx`
- Generate: `shared/src/village/generated/villageColliders.ts` via `npx tsx scripts/extract-colliders.ts client/public/models/village/village.glb VILLAGE_COLLIDERS shared/src/village/generated/villageColliders.ts`
- Modify: `shared/src/village/villageLayout.ts` (`villageGeometry` uses the generated colliders; Task 1 invariants must still pass)

**Interfaces:**
- Consumes: the `LM_*` lightmap recipe and Draco path from `hubModelPrep.ts`, and the lazy `useGLTF` pattern from `HubModel.tsx`.

**Also in Task 7 (from the Task 6 review):**
- **Far plane:** `village_sky` (radius 1,400 m) and the backdrop (±1,100 m) exceed `CAMERA_FAR` 200 (`client/src/game/constants.ts`) and the fog range of 35..100. Use a per-scene far plane of about 1,600 for the village, or draw the dome and backdrop camera-relative at ≤190 m with `depthWrite` off. Test that the dome is never clipped.
- **Loading:** `EXT_mesh_gpu_instancing` must load; the leaves use MASK with double sides; `M_water`/`M_waterfall` use BLEND; `M_sky` has no fog and `toneMapped: false`.
- **Look:**
  - `M_water` uses a real water look at runtime: a normal-map ripple, sky reflection (environment) and Fresnel. Flat turquoise is not acceptable.
  - Bring exposure, fog and tone mapping to the luma bar.

- [ ] **Step 1: Failing tests.** The prep hides `col__*`, applies the lightmap to `LM_*`, makes the plot outline material emissive, and keeps backdrop materials fog-free. The Task 1 invariants pass with the generated colliders.
- [ ] **Step 2: FAIL. Step 3: Implement. Step 4: PASS**, then `node e2e/luma-check.mjs` on 4 in-game frames (both tiers) → PASS.
- [ ] **Step 5: Commit** `feat: 케이슨 마을 모델을 게임에 — 라이트맵·충돌 상자 (케이슨 마을 1단계 Task 7)`.

### Task 7A: Day and night on real Korean time (owner 2026-11-03)

The owner's words: "시간에 따라서 해가 떴다가 지고 야간에는 가로등과 건물에 불이 켜지고" and "실제 한국 시간과 같게 해야지".

**Files:**
- Create: `shared/src/village/sunClock.ts` (+ test), `client/src/village/DayNight.tsx`, `client/src/village/dayNightBlend.ts` (+ test)
- Create: `art/village/tools/bake_village.py --night` (night bake reusing the Task 6 script) → `client/public/models/village/village_lm_night.webp`
- Modify: `client/src/village/villageModelPrep.ts` (two lightmaps, a blend uniform), `client/src/game/sceneLighting.ts` (the village lighting follows the clock), server join payload (`serverTimeMs`, so a client's wrong clock can't change the time of day)

**Interfaces:**
- Produces:
  - `sunAt(utcMs: number): { elevationDeg: number; azimuthDeg: number }` for the village latitude/longitude 36.5° N, 127.8° E (central Korea), using a standard solar-position formula. The date matters, so sunrise and sunset move with the seasons. Times are evaluated in Asia/Seoul.
  - `phaseAt(elevationDeg): { day: number; night: number }` gives the blend weights:
    - day = 1 above +8°, night = 1 below −8°, with a smooth ramp between (dawn and dusk);
    - golden-hour tint between −2° and +12°.
- Behaviour:
  - The sun light direction, sky colour, fog colour and exposure follow the clock, updated every 10 s with smooth easing.
  - The baked lightmap blends between day and night.
  - When night > 0.3, `M_lamp`, `M_window` and the fountain lights turn on (emissive, plus bloom on the high tier).
  - Inside the memorial hall it is always warm indoor light; its windows show the outdoor sky for the current time.
  - The time comes from the server: the client stores the offset to `serverTimeMs` and uses it.
- Consumes: Task 6 materials (`M_lamp`, `M_window`, `light__*` empties) and Task 7 prep.

- [ ] **Step 1: Failing tests.**
  - `sunAt` matches published sunrise and sunset for Seoul on 2026-06-21 and 2026-12-21 within ±10 minutes (elevation crosses 0). Store the expected times in the test with their source.
  - Midday elevation is higher in June than in December.
  - The `phaseAt` ramps behave as specified.
  - The blend weights are fed to the material.
  - A client clock that is 3 h wrong still shows the server's time of day.
- [ ] **Step 2: FAIL. Step 3:** Bake the night lightmap (moonlight, lamps and windows on) with the Task 6 script's night flag, and implement. **Step 4:** Tests + luma check: day frames pass the usual bar. Night frames get their own bar: mean ≥ 0.18 and lanes readable (p50 of the walkable area ≥ 0.15). Document it.
- [ ] **Step 5: Commit** `feat: 케이슨 마을 낮과 밤 — 실제 한국 시간, 밤에는 가로등·창문 불빛 (케이슨 마을 1단계 Task 7A)`.

### Task 8: Memorial hall interior art

**Files:**
- Create: `art/village/tools/build_memorial.py`, `bake_memorial.py`, `art/village/export/memorial.glb` + `memorial_lm.webp`
- Create: `art/village/tools/build_props.py` → `client/public/models/village/memorial_props.glb`. These are one mesh each: wood urn, ceramic urn, photo frame (photo on its own material slot), house frame, LED tealight, plush bear, flower bunch, stone jar, name card.
- Copy to `client/public/models/village/`; add a `memorial` kind to the check tool.

**Content:**
- From the approved concept (`scratchpad` `hall_v2.py`, render `v2final3`): white walls, light oak floor, white lacquer cubby wall (back) and light oak cubby wall (right), LED strips.
- A flat ceiling with recessed downlights and a skylight panel, windows with a garden backdrop card, a lounge sofa and table, a bench, a memorial table with flowers.
- Cubby grid: 20 × 7 on the back wall and 18 × 7 on the right wall, each cell 0.40 m and frame 0.025 m.
  - An `anchor__cubby_<wall>_<row>_<col>` empty sits at each cubby's opening centre. The runtime places props there.
- `col__*` for walls, furniture and the cubby walls. The ceiling (y 3.4) gets a `ceil__hall` node that Task 9 turns into a camera ceiling.

- [ ] **Step 1:** Controller adds interior references to `references.md` (the 2026-11-03 columbarium searches).
- [ ] **Step 2:** Build, bake and export; then `check-school-glb … memorial` → PASS.
- [ ] **Step 3:** Render 2 comparison frames next to `v2final3` and the reference screenshots.
- [ ] **Step 4: Commit** `feat: 추모관 실내 모델과 칸 소품 — 라이트맵·칸 위치 (케이슨 마을 1단계 Task 8)`.

### Task 9: Memorial hall in the game

**Files:**
- Create: `client/src/village/MemorialHall.tsx`, `client/src/village/cubbyProps.ts` (+ test), `client/src/village/sampleCubbies.ts`, `client/src/village/CubbyView.tsx` (close-up card), `client/src/village/memorialRelease.ts`
- Modify: `client/src/village/VillageScene.tsx` (render the hall when the local area is "hall"), `shared/src/village/villageLayout.ts` (interior colliders generated from `memorial.glb`, plus ceiling camera boxes with `minY` 3.3)
- Server: `VillageMsg.LightCandle { cubby: string }`. The server checks that the player is in the hall and within 1.5 m of that cubby anchor, then broadcasts `CandleLit { cubby, by }` to the hall. Rate limit 1 per 5 s. Nothing is stored.

**Interfaces:**
- Produces:
  - `SAMPLE_CUBBIES`: 60% of cubbies filled. Seed-stable choice of props per cubby, a name from a fixed list, years, and a photo index into `client/public/village/sample-photos/` (generated placeholder portraits until the owner OKs CC0 photos).
  - `layoutCubbyProps(anchors, samples) → InstancedMesh` data, one instanced mesh per prop type.
  - `CubbyView`: standing within 1.2 m of a filled cubby and pressing E opens a card with photo, name, years and one line. Its 촛불 켜기 button sends `LightCandle`, and everyone in the hall sees a small flame in that cubby for 60 s.
  - An empty cubby shows "곧 이 자리에 우리 아이를 모실 수 있어요".
- Consumes: Tasks 4, 5 and 8.

- [ ] **Step 1: Failing tests.**
  - Prop layout gives one instanced mesh per type, with counts matching the samples.
  - Empty cubbies get no props.
  - `CubbyView` copy has no "!".
  - Server: `LightCandle` far from a cubby is refused; it is rate-limited; it is broadcast only to hall players.
- [ ] **Step 2: FAIL. Step 3: Implement.** Loading `memorial.glb` happens on entering the hall, and release happens on leaving (the `counselRelease` pattern). **Step 4: PASS** + luma check on 3 hall frames.
- [ ] **Step 5: Commit** `feat: 추모관 안 — 예시 칸 소품·가까이 보기·촛불 켜기 (케이슨 마을 1단계 Task 9)`.

### Task 9A: Guide NPCs with natural voice (owner 2026-11-03)

The owner's words: "채팅 읽어주기에서는 빼고 그냥 어느 건물 또는 npc에게 문의할 때만 음성이 나오도록 하자 진짜 사람이 말하는 것 같은 음성이 나오도록."

**Files:**
- Create: `shared/src/village/guides.ts` (+ test), `client/src/village/GuideNpc.tsx`, `client/src/village/GuideDialog.tsx`, `client/public/village/voice/*.m4a`
- Create: `art/village/voice/make_voice.*` (offline generation script, git-ignored like `art/`)
- Modify: `docs/licenses.md` (voice engine and licence)

**Interfaces:**
- Produces: `GUIDES`, two guides.
  - `plaza_guide` (마을 안내원) stands at (5, 12) facing the spawn.
  - `hall_desk` (추모관 안내 데스크) stands inside the hall at (302.8, 4.0) facing −x.
  - Each guide has 3–4 fixed questions and answers in Korean ("~요" tone, gentle in the hall). Each answer has a `voice` file id.
- Behaviour:
  - Walk within 2.2 m → action button "문의하기" → a question list.
  - Choosing a question shows the answer text and plays its voice clip. A second press skips the clip; the sound toggle mutes it.
  - Only the asking player hears it.
  - NPCs use the existing toy figure with a fixed appearance and a name tag "안내원".
- Consumes: Task 4 targets, Task 9 hall.

- [ ] **Step 1:** The controller checks the commercial licence of the candidate engines and picks one, recording the ruling in the ledger. The candidates are VoxCPM2 on the owner's PC and cloud TTS (CLOVA Voice, ElevenLabs, OpenAI).
- [ ] **Step 2:** Write failing tests: guide data (ids unique, each answer has a voice id, and that file exists in `client/public/village/voice/`), dialog behaviour (one clip at a time, skip, muted when the sound is off), and no voice on chat.
- [ ] **Step 3:** Generate the clips offline (24 kHz mono AAC, ≤ 60 KB each) and listen-check them. Then implement and run the tests to PASS.
- [ ] **Step 4: Commit** `feat: 마을 안내원·추모관 안내 데스크 — 문의하면 자연스러운 음성 (케이슨 마을 1단계 Task 9A)`.

### Task 10: Performance and download budget

**Files:**
- Create: `e2e/village-perf.mjs` (phone 375×812, 4× throttle, low tier, 20 s window; modes `village` and `hall`; reuses `e2e/lib/escape.mjs` helpers)
- Modify: `loadtest/` adds a `--scenario village` (30 bots per shard walking, chatting, using the door), with `docs/loadtest.md` §10.

- [ ] **Step 1:** Run 30 bots + perf `village` twice, and perf `hall` twice. The gates are in Global Constraints. If a gate fails, apply the cheapest fix first and record what changed:
  - tree card count
  - draw-call merging
  - prop instancing
  - texture size
- [ ] **Step 2:** First-load bytes from the entry screen to the village and then to the hall (phone, production build) ≤ 15 MB in total.
- [ ] **Step 3: Commit** `test: 케이슨 마을 성능·다운로드 측정 (케이슨 마을 1단계 Task 10)`.

### Task 11: E2E — PC and phone

**Files:**
- Create: `e2e/village-desktop.mjs`, `e2e/village-mobile.mjs`

Steps both scripts check:
1. Entry → 입장하기 → village, with no sheet.
2. A second player sees the first one.
3. Walk to the bridge, then across.
4. A plot sign reads "곧 지어져요 · 도서관".
5. The hall door, then the fade.
6. Inside: camera y ≤ 3.1 at full orbit pitch, and the ceiling is visible in the frame.
7. Emoji refused inside.
8. A filled cubby → card → 촛불 켜기, which the other player sees.
9. An empty cubby shows the coming-soon line.
10. Back out through the door.
11. Phone layout: buttons ≥ 48 px, gaps ≥ 8 px.
12. No unexpected console errors.

- [ ] **Step 1:** Write both scripts, then run each twice in a row → all pass.
- [ ] **Step 2: Commit** `test: 케이슨 마을 E2E — PC·휴대폰 (케이슨 마을 1단계 Task 11)`.

### Task 12: Docs, deploy gate and owner walk-through

**Files:**
- Modify: `docs/design.md` (new chapter 38 "케이슨 마을 1단계"), `docs/deploy.md` (village room, budgets), `docs/licenses.md` (final check date)

- [ ] **Step 1:** Docs; `npm run typecheck && npm run test && npm run build` → PASS.
- [ ] **Step 2:** The controller asks the owner before merging into main, pushing and deploying, following the 2026-11-02 deploy steps: Oracle update, client build, Vercel prod.
- [ ] **Step 3:** The owner walks the village on PC and phone. The owner's words go into design ch.38, "발주자 확인".
- [ ] **Step 4: Commit** `docs: 케이슨 마을 1단계 기획·배포·라이선스 (케이슨 마을 1단계 Task 12)`.

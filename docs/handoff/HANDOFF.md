# Caysonverse handoff — continue on another computer

Written 2026-11-15 by the Claude Code session that has run this project so far. A new Claude Code session on another computer should read this whole file first, then the files it points to, and continue from **section 4**.

## 1. What this project is

Caysonverse is a browser 3D world. Today it is only **케이슨 마을 (Cayson Village)**: a realistic Korean countryside village that you can walk around with chibi avatars. The owner sells it commercially, so a pet memorial hall comes first, then paid niches and decorations.

**Repo layout:** monorepo.
- `client/`: React Three Fiber / three.js, Vite
- `server/`: Colyseus, Node
- `shared/`: rules and data used by both client and server
- e2e scripts in `e2e/`, run with Playwright against local dev servers

**Live:**
- client on Vercel: https://caysonverse.vercel.app
- server on an Oracle VM behind Caddy (see `docs/deploy.md`)
- `main` is what is live (last deploy: main `7c81a1c`, 2026-11-15)

## 2. Owner's rules (apply to everything)

The full list of owner requests and principles is in [`VILLAGE-TODO.md`](VILLAGE-TODO.md). Read it first and keep it updated: add new requests, mark finished ones. The most important rules:

1. **Reply to the owner in Korean.** This covers every message, question and summary. Code, commits and docs may be English, and commit messages so far are Korean.
2. **Real-world look.** Find real photos first, build to match, and show the result side by side with the reference. Make everything volumetric and detailed, never flat cards. The 2026-11-11 bus is the **minimum** quality bar. Build models in **Blender** from scripts (`art-tools/`). Never use AI 3D generators, and never use real brands or logos.
3. **UX easy first.** A first-time player must manage on PC and on phone (iPhone 13 portrait) without friction. Test as that player.
4. **Seats:** every seat must be sit-able. Seats without a back can be used from either side. Backed seats (sofa, plaza bench) are used from the front only.
5. **Done means seen in the game.** Say "done" only after checking real game screenshots. After a piece passes review, **deploy it right away** and report to the owner with screenshots. No pre-approval is needed for deploys.
6. **Thorough over fast,** but save tokens. Design and review on the strongest model; implementation agents can use a cheaper model (sonnet). Reviews stay strict. If the same problem fails twice, the strong model fixes it itself.
7. **Give builders the full test sweep up front.** For example, every seat/stand spot × every click target, every camera spot × yaw × pitch, on PC and phone, day and night. The builder must pass it before handing over, so reviews confirm results instead of discovering problems one round at a time. The memorial took 9 rounds without this.
8. Git:
   - commit only the files you changed
   - never `git add -A`
   - never commit secrets
   - commit as `Cayson-Choi`, with the trailer `Co-Authored-By: Claude ... <noreply@anthropic.com>`
9. **Never print secrets.** These include the server env file, SSH keys and the teacher key. This repo is **PUBLIC**.
10. **Never permanently delete anything** (files, posts, data) without the owner's OK.
11. Before restarting the live server, check that 0 players are connected (`docs/deploy.md`).
12. **Web browsing** (real-photo research): the owner uses the **Aside** browser agent on the original computer. Use whatever browser tool the new machine has.
13. **Machine memory is limited.** Run at most about 4 browser-heavy agents at once, and one browser per workflow. Always stop dev servers and test browsers you started.

## 3. Branches

| Branch | State | What it is |
|---|---|---|
| `main` | live (7c81a1c) | village with trees fixed, bus parked in its lane, riders inside the bus, bus yields to avatars, boarding opens 3 minutes before departure |
| `feat/memorial-m1` | **round 9 fix committed, NOT reviewed** (7935b5a) | pet memorial hall rebuild, Stage A (new Blender interior and 31 seats) |
| `feat/bus-ride` | **round 2 fix stopped mid-way** (37bf28a is a WIP commit) | B13: walk inside the bus, sit or stand, look out of all windows, interior detail |

`feat/memorial-m1` and `feat/bus-ride` both branch from an older main. Merge or rebase them onto the current `main` before deploying, and expect real conflicts in the bus and village files.

## 4. What to do next (in this order)

### 4.1 Memorial Stage A: review round 9, then deploy
- **Design:** [`designs/memorial/design.md`](designs/memorial/design.md). It was approved by the owner, who said "니가 알아서 해봐". The mockups are in the same folder.
- **History:** [`designs/memorial/review-history.md`](designs/memorial/review-history.md) holds every builder report and reviewer finding for rounds 1–8.
- **Round 8 status:** the tech review passed. The visual review found one major:
  - after standing up from the north letter chairs (letter_n0 and letter_n1), clicking the exit or the hall centre was "unreachable" and nothing happened
- **Round 9** (commits 56b0df8 and 7935b5a) fixed that:
  - pathfinding grid
  - a short hint when a target cannot be reached
  - letter chairs can be picked with the click ray
  - small exit ring
  - wider phone arrival view
- **Next step:** run a fresh visual and tech review of round 9. Use the reviewer checklist in `workflows/memorial-stage-a-b.js` (`review:A-visual` and `review:A-tech`) as the reference. Run the full sweep on PC and iPhone 13:
  - from every seat stand spot and every approach spot, click the exit, the hall centre and every seat
  - camera sweep: 7 spots × 8 yaws × pitch 0.2–1.0
  - all 31 seats can be sat on
  - close-up view of the top and bottom rows
  - candle
  - day and night
  - 0 console errors
- **If it passes:**
  1. merge `feat/memorial-m1` into `main`
  2. run all unit tests, typecheck and the e2e village suite
  3. deploy the server and the client
  4. run the prod smoke test
  5. report to the owner in Korean with screenshots
- **Known minors,** to fix later:
  - entrance glass door looks like a flat panel
  - floor has no gloss
  - letter chair, kiosk and mailbox detail is below the bus bar
  - `check-school-glb village` fails on collider boxes. This was already true on main and is not a defect of this branch.

### 4.2 Memorial Stage B (starts after Stage A is live)
The spec is in `workflows/memorial-stage-a-b.js` (Stage B part) and in VILLAGE-TODO A9.
- put the Maltese sample photo in the one example niche: [`designs/memorial/option1_maltese.png`](designs/memorial/option1_maltese.png)
- real photo upload with review before it goes public
- choose props from the guide
- "우리 아이 칸 바로가기" (shortcut to my pet's niche)
- candles last 1 hour and show who lit them
- persistence: candles and niches must survive a server restart, and purchases must survive updates

### 4.3 Bus ride B13: finish round 2, review, deploy
- **Design:** [`designs/bus-ride/design.md`](designs/bus-ride/design.md)
- **History:** [`designs/bus-ride/review-history.md`](designs/bus-ride/review-history.md)
- **Round 1 review (fail):**
  - other passengers' heads cover the in-bus view
  - first-time riders can't choose to stand at a grab handle
  - poles cross the avatar in third person
  - interior is not detailed enough next to real low-floor bus photos
  - a server/client walk mismatch
  - passengers overlap
  - no rate limit on bus messages
- **Round 2:** a0828ac and a767e70 fixed most of these. 37bf28a is the unfinished part: `busCabin` changes and tests.
- **Next step:**
  1. finish and verify the WIP
  2. run all tests
  3. run a fresh visual review (compare the interior with real low-floor city bus photos) and a tech review
  4. if it passes, merge onto current `main`, deploy and report
- **Owner's words** for this feature:
  - "버스 안에서 캐릭터는 창문의 왼쪽 오른쪽을 다 볼 수 있어야 해 … 의자에 앉을 수도 있고 서있을 수도 있어야 해"
  - "버스 탑승은 출발 3분전부터 탑승이 가능하도록 하자"

### 4.4 After that (see VILLAGE-TODO for everything)
- houses stages 2–4: 10 different interiors, 2nd floor, furniture, enter with code 1004
- cafe parasol and shelter post block the camera at some angles
- gap in the yellow centre line at the bus bay: fix in `art-tools/make_textures.py` `bay_zone` at the next village art rebuild
- fishing lake
- the queue in VILLAGE-TODO sections 2–3

## 5. Art pipeline (Blender)

The Blender scripts that build the live GLBs are in [`art-tools/`](art-tools/). On the original computer they live in a git-ignored `art/village/tools/` folder.

**Scripts:**
- `build_village.py` and `parts_*.py`: the village
- `build_bus.py` and `make_bus_textures.py`: the bus, including the in-progress cabin
- `build_busstop.py`, `build_signals.py`
- `build_memorial.py`, `bake_memorial.py`, `bake_cubby.py`, `post_memorial.py`, `make_memorial_textures.py`: the memorial
- `vlib.py`: shared helpers

**Setup:**
- Put the scripts in `art/village/tools/` (that folder is git-ignored).
- The scripts also need large source assets: CC0 textures and HDRIs in `art/village/downloads/`, plus `refs/` and `fonts/`. These are not in git. The owner can copy them over from the original computer (private bundle, below).
- Run them with headless Blender (`blender -b -P <script>`). Read each script's header for its arguments and output path. The exported GLBs go to `client/public/models/village/`.

## 6. Deploy

The steps are in [`docs/deploy.md`](../deploy.md).

**Server (Oracle VM over SSH):**
1. `git fetch --depth 1 origin main && git reset --hard FETCH_HEAD`
2. `npm ci --workspace=server`
3. `npm run build -w server`
4. `sudo systemctl restart caysonverse`, only after checking that 0 players are connected

**Client:**
1. build with `VITE_SERVER_URL=<server url> npm run build -w client`
2. mirror `client/dist` into the Vercel deploy folder
3. run `vercel deploy --prod --yes --scope <team>` from inside that folder (not with `--cwd`)

**After deploy:** check that the live `index.html` references the new `assets/index-*.js`, and run a smoke test on 2 PC pages and 1 phone page.

The SSH key, server env file and Vercel login live only on the original computer. **The owner must set them up on the new computer themselves.** Never print or commit them.

## 7. Private bundle (not on GitHub, because this repo is public)

The owner keeps a private folder copied from the original computer. It holds:
- `claude-memory/`: the previous session's memory notes. Copy them into the new machine's Claude Code project memory folder, or just read them. They repeat the rules above in more detail and include deploy specifics.
- `CLAUDE.md` (global instructions): Korean replies, Aside browsing, blog rules.
- `art-assets/`: `art/village/downloads`, `refs`, `fonts` for the Blender pipeline.

## 8. Workflow scripts (reference)

[`workflows/`](workflows/) holds the multi-agent workflow scripts used so far. They contain the exact build and review prompts and acceptance checklists:
- `memorial-stage-a-b.js`
- `bus-ride-b13.js`

Paths inside them point to the original computer's temp folders, so use them as checklists, not as runnable scripts.

# Star Post: notes for the next AI

Gravity-slingshot delivery game for Oddvale Games. One launch (angle + power), then deterministic physics. Read the hub's `GAME_GUIDE.md` for the hosting rules. No build step, no dependencies.

## Architecture
```
index.html        page shell (from the kit template); How to play / Controls cards
src/physics.js    DOM-free simulation: compileLevel, createFlight, step, puff, fly, previewPath. Fixed step DT = 1/120
src/solver.js     headless launch search (grid over angle x power), local window, one-puff search, path turning
src/levels.js     the 30 campaign levels + sector names (pure data)
src/daily.js      Daily delivery generator (seeded), levelHash for snapshots
src/save.js       save schema + sanitize, star rule, unlock rule, daily records, streaks, share text (DOM-free)
src/render.js     canvas renderer: camera (rotates the world a quarter turn on portrait), sprites, trail, particles
src/ui.js         DOM overlays in the stage: HUD, control bar, toast, title / levels / result / menu / daily cards
src/audio.js      synth sounds through the kit's sfx
src/main.js       game flow, input (pointer + keyboard), main loop, ?debug hook
tools/lab.mjs     search one level or fly one launch, with an ASCII picture
tools/scout.mjs   find long curvy safe launches on a level skeleton (to hang rings and a dock on)
tests/            node tests (node --test tests/), about a minute because every level and 60 dailies are searched
```
Everything that decides an outcome (physics, solver, levels, daily, save) is DOM-free and shared with the tests.

## Physics rules (src/physics.js)
- Field 1000 x 640 world units. Angles are stored in tenths of a degree (`a10`, 0 = +x, growing towards +y), power in tenths (`p10`, 100..1000); launch speed = `p10 * 0.4` units/s. Time is counted in steps.
- Gravity per body: `mu / (d^2 + s^2)` towards the body (softened near the surface), fading smoothly to zero between 60% and 100% of the field radius `f` (default `r + 70 * sqrt(|m|)`). Outside every field you fly straight. `m` is in units of 1e6. Repulsor stars have negative `m`.
- Velocity Verlet, one acceleration evaluation per step. Moving bodies follow circular orbits as a function of the step count, so they stand still while you aim and start at launch: the same launch always gives the same flight.
- Determinism matters: only + - * / and Math.sqrt, plus our own `dsin`/`dcos`. Do not introduce Math.sin, Math.hypot, Math.pow etc. into physics.js or daily.js; engines may differ in the last bit and the daily would diverge between browsers.
- Events per step, in order: solid bodies (crash, or reflect off rubber), wormholes, boost gates, rings, dock, lost (3 s outside the field, or `maxT` seconds, default 40).
- The preview is `previewPath`, which runs the same `step`, so it always equals the flight (there is a test).

## Level format (src/levels.js)
```js
{ name, hint, start: [x, y], dock: [x, y], dockR?: 30,
  planets: [{ x, y, r, m, kind?: 'planet' | 'rubber' | 'star', f?, orbit?: { cx, cy, R, period, phase } }],
  rings: [[x, y, r?]], rocks: [[x, y, r]], gates: [[x, y, degrees, boost?]], worms: [[x1, y1, x2, y2]],
  ordered?: true,       // numbered rings, only in order
  puffs?: n,            // mid-flight kicks (PUFF_DV each)
  preview: seconds,     // how far the dotted aim line looks ahead
  par: seconds,         // 3 stars = every letter and docked inside this
  sol: [a10, p10] }     // a launch that delivers everything (tests check it; the debug hook uses it)
```
Save data is keyed by a slug of the level name (`levelKey`), so renaming a level orphans its stars: add an `id` with the old slug if you must rename. Reordering is safe for stars but changes what is unlocked.

### How the levels were designed, and how to add one
1. Write the skeleton (start, planets, gadgets) with no rings or dock.
2. `node tools/scout.mjs src/levels.js <n> [minSeconds] [top] [minTurn] [maxTurn] [B|G|W]` lists curvy, safe launches with a position every 0.5 s and a neighbour count `nb` (bigger = more forgiving). The last argument demands a bounce, gate or wormhole on the path.
3. Put rings on that path and the dock at its end (never where the path passed earlier), store the launch as `sol`.
4. `node tools/lab.mjs <n>` searches every launch and prints the dock window, the full window, the fastest lines and a picture. `node tools/lab.mjs <n> <deg> <power>` flies one launch.
5. Run the tests. `tests/levels.test.js` prints the window table and enforces the bands.

## Balance
"Window" = how much of the 360 x 90 aim space wins, in degree x power units (whole space 32400), on a 1 degree x 2 power grid. Bands enforced by `tests/levels.test.js` since 1.1.0:
- Full-delivery window at least **24 / 14 / 12** for sectors 1 / 2 / 3, and at most 250 / 200 / 150 for levels with letters (no gifts).
- Dock window at least **60** everywhere (one star should never take care).
- Sector medians of the full window must strictly fall (now 45, 31, 21; were 26, 29, 17).
- The stored `sol` must sit in a pocket: its `localWindow` full window (0.2 degree x 0.5 power cells, +-6 degrees x +-8 power) at least 2.5. Several 1.0 sols were knife edges (0.4-1.8).
- Headline bodies must matter: removing Rebound's top moon or planet leaves at most 60% of the full window; removing Bank Shot's moon or planet, or Push and Pull's star or planet, at most 25%.

Why these floors: 12 units is 6 cells of the 1 degree x 2 power grid, a patch of roughly 2 degrees x 6 power. The nudge buttons move 0.5 degrees and 0.5 power (keyboard fine aim 0.1 degrees), so even the tightest sector 3 level has several nudge steps of slack around a winning line, and the preview (1.2 s or more) shows you are on it. Below about 8 units the old levels needed sub-nudge precision. Sector 1 starts at twice that, sector 2 in between; Bulk Mail is the one sector 2 level that only reached 14 (see weak spots).

### Before / after (1.1.0 retune)
| # | Level | Dock before | Dock after | Full before | Full after | Par before | Par after | What changed |
|---|---|---|---|---|---|---|---|---|
| 1 | First Class | 554 | 554 | 554 | 554 | 3.5 | 3.5 | - |
| 2 | Round the Bend | 176 | 176 | 176 | 176 | 3.5 | 3.5 | - |
| 3 | First Post | 158 | 160 | 28 | 70 | 4 | 3.5 | ring moved onto the bend; it is the first letter in the game |
| 4 | Back Door | 518 | 518 | 134 | 134 | 3 | 3 | - |
| 5 | Return to Sender | 1764 | 2154 | 16 | 38 | 6.5 | 6 | planet nudged and heavier (9.5), ring 38, dock moved, dockR 44 |
| 6 | Loop the Loop | 1620 | 1620 | 28 | 44 | 6 | 6 | ring moved |
| 7 | Mind the Gravel | 26 | 80 | 24 | 46 | 5 | 4.5 | planet moved down and heavier (7.8), ring and dock moved |
| 8 | Slalom | 158 | 182 | 14 | 26 | 5 | 4.5 | second planet nudged, rings and dock moved, dockR 40 |
| 9 | Threading | 124 | 134 | 18 | 38 | 4.5 | 3 | planets nudged (first one 5.2), second ring 36, dock moved |
| 10 | Special Delivery | 2878 | 2718 | 6 | 26 | 6.5 | 8 | planets nudged (middle 6.5), rings moved, last ring 36, dock moved, dockR 46 |
| 11 | Boing | 92 | 92 | 92 | 92 | 4.5 | 4.5 | - |
| 12 | Rebound | 2132 | 1644 | 102 | 46 | 3.5 | 3 | planet moved and heavier (6) so it matters; ring and dock moved |
| 13 | Express Lane | 474 | 354 | 14 | 30 | 4 | 4 | ring and dock moved |
| 14 | Tailwind | 46 | 80 | 32 | 32 | 5 | 4.5 | rings and dock moved, dockR 42 |
| 15 | Puff School | 1044 | 1044 | 26 | 26 | 5 | 5 | - |
| 16 | Bank Shot | 644 | 722 | 82 | 46 | 4 | 4 | ring and dock moved so the planet is needed |
| 17 | Rubber Room | 764 | 764 | 92 | 92 | 5 | 5 | - |
| 18 | Scrapyard | 2214 | 2050 | 6 | 26 | 6.5 | 6.5 | planet nudged and heavier (9.5), first ring 36, dock moved |
| 19 | By the Numbers | 3526 | 3448 | 12 | 20 | 5.5 | 5.5 | ring 2 bigger (36), dock moved, dockR 36 |
| 20 | Bulk Mail | 260 | 512 | 4 | 14 | 5 | 4.5 | moon bigger (r 100), first planet lighter (4.5), small planet nudged and r 40 / m 4.5, rings and dock moved, dockR 36, preview 1.8 |
| 21 | Moving Day | 166 | 166 | 28 | 28 | 5 | 5 | - |
| 22 | Moonlighting | 1586 | 1680 | 12 | 20 | 6.5 | 6 | rings and dock moved |
| 23 | Shortcut | 100 | 100 | 78 | 78 | 4 | 4 | - |
| 24 | In One Ear | 20 | 484 | 12 | 20 | 4.5 | 4 | rings and dock moved |
| 25 | Shove | 424 | 424 | 94 | 94 | 4 | 4 | - |
| 26 | Push and Pull | 1124 | 1172 | 78 | 40 | 4 | 6 | planet moved in (619, 466) and lighter (5.5), rings and dock moved: the route now swings round it |
| 27 | Clockwork | 254 | 254 | 22 | 22 | 7 | 7 | - |
| 28 | Night Shift | 1092 | 1180 | 4 | 14 | 7.5 | 7 | rings and dock moved, preview 1.2 |
| 29 | The Long Way Round | 1702 | 1698 | 10 | 14 | 7 | 5.5 | rings and dock moved, last ring 40, dockR 42, preview 1.2 |
| 30 | Last Post | 242 | 324 | 4 | 16 | 7.5 | 6 | rings and dock moved, middle ring 42, preview 1.2 |

Retuned levels carry `rev: 2`. Save data stores the rev with a best time (`best[key].r`, only when > 1); on load a best from another rev is dropped and the stars are kept, so a retune never leaves a meaningless best time beside a new par. Bump `rev` again if you change a level's layout.

How it was tuned: rings and the dock never change a trajectory (only the dock ends one), so a scratch tool flew every launch on the test grid once, cached the paths, and annealed ring/dock positions and sizes (and, for the hardest levels, small planet moves and mass changes, re-flying after each) towards a target window, then re-checked everything with the real `search`. `sol` was then picked as the full launch with the biggest local window, and par recomputed with the rule below.

- Difficulty also comes from the preview shrinking (5 s down to 1.2 s) and from moving parts. Ring radius is 34 in sector 1, 30 in sector 2, 28 in sector 3, bigger where a level needed it; widen a ring or the dock (`dockR`) to ease a level.
- Par = the smaller of (designer route x 1.08 + 0.2) and (fastest full line x 1.5 + 0.5), rounded up to 0.5 s. So three stars always exist but sometimes need a quicker line than the obvious one.
- Every level's full delivery is proven without puffs; puffs (sector 2 level 5 onwards) are a correction tool, never required. `searchWithPuff` exists in the solver if you want a level that needs one.
- Remaining weak spots: Bulk Mail (14) is below the rest of sector 2 because the moon bounce after a planet hook is chaotic; Night Shift, The Long Way Round and Last Post sit at 14-16; Last Post's best single line has a local window of only 2.7; Rebound's two rubber moons are each needed by only about a third to a half of winning launches. None of this has been playtested by a person.
- Unlocking: a level is open if either of the two before it has a star, so one level can always be skipped.

## Daily delivery (src/daily.js)
- Seed: `hashString('star-post:' + 'YYYY-MM-DD')`, local date. 2-3 planets (sometimes a rubber moon), 2-3 rings, no puffs, 1.6 s preview.
- Built on a seeded launch that draws a curvy safe path; then proven: the launch delivers everything, its local window is 2-9.5, the coarse global search finds a full delivery with a window of at most 260, and with gravity off no launch delivers everything.
- Score: launches until the first full delivery (then flight time). After that the day is free play and the record never changes. Streak = consecutive finished days.
- **Snapshot rule:** `tests/daily.test.js` pins the layout hash of four dates. Any change to daily.js, to physics.js constants or maths, or to the kit rng changes everyone's daily. Do not update the hashes casually; if you must, say so in CHANGELOG.md and never mid-day for a date that is already live.

## Player input (`kit/talk.js`)
The hub's anonymous player-input widgets (copy of the kit, do not edit). `showDailyDone` calls `dailyTalk` into the `[data-talk]` slot `ui.dailyDone` returns, with `key` = the daily's date and `score` = `launch * 1000 + flight tenths` (both capped at 999), so lower is better and ties on launches go to the quicker flight, the same order as the daily's own rule. API board `delivery`, the default. Boot calls `tellUs` into `#tell-us`. Both stay hidden when the API (`/api/v1/`) is unreachable.

## Phones and full screen
- `wireChrome({ stage })` (kit) gives native full screen or the iPhone focus mode; both set `.stage.is-full`. `src/game.css` pads the HUD and bar with `env(safe-area-inset-*)` there and keeps the HUD clear of the kit's exit button; it also sizes the kit's "Play full screen" icon (missing from `kit/shell.css`).
- `fit()` in main.js re-fits the canvas and measures the HUD and bar against the canvas rect into `R.insets` (the canvas is inset by the safe areas in full screen). It runs on stage resize, so turning the phone re-lays out the field.
- Pointer: the dead zone is 8 px for a mouse and 20 px for touch; coming back inside it after a live pull sets `G.aimBack` ("Let go here to cancel"). A second pointer cancels the pull or the slow-motion puff; `pointercancel` and `lostpointercapture` cancel without firing.
- `haptic()` on launch, crash and dock.

## Testing in a browser
`?debug` exposes `window.__game`: `advance(seconds)` steps the game clock without animation frames, `goto(i)`, `daily()`, `aim(a10, p10)`, `solve()` (aims the full-delivery launch), `launch()`, `retry()`, `puff(dx, dy)`, `act(name, arg)` (same as pressing a UI button), `state()`.

## Backlog
- A sandbox / free-flight mode with a level editor that shares a code.
- Daily archive (must never touch the streak) and a share image of the trail.
- More campaign sectors: rings that orbit, one-way gates, twin capsules.
- Levels that truly need a puff (prove with `searchWithPuff`), and a "no puffs used" badge.
- Trail gallery: keep the prettiest three-star trail per level and show it in the level select.
- Colour-blind check of the speed-coloured trail (speed is cosmetic, so it is not a blocker).

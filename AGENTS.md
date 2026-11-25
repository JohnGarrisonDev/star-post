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
"Window" = how much of the 360 x 90 aim space wins, in degree x power units (whole space 32400), on a 1 degree x 2 power grid. Bands enforced by the tests: full-delivery window at least 6 / 4 / 2 for sectors 1 / 2 / 3 and at most 250 / 200 / 150 for levels with letters; dock window at least 20. Current values are in the test output. Typical full windows: sector 1 6-134, sector 2 4-102, sector 3 4-94 (medians 26, 29, 17). Windows alone do not narrow steadily; difficulty also comes from the preview shrinking (5 s down to 1 s) and from moving parts. Ring radius is 34 in sector 1, 30 in sector 2, 28 in sector 3 (bigger on the three fiddliest levels); widen a ring or the dock (`dockR`) to ease a level.
- Par = the smaller of (designer route x 1.08 + 0.2) and (fastest full line x 1.5 + 0.5), rounded up to 0.5 s. So three stars always exist but sometimes need a quicker line than the obvious one.
- Every level's full delivery is proven without puffs; puffs (sector 2 level 5 onwards) are a correction tool, never required. `searchWithPuff` exists in the solver if you want a level that needs one.
- The dock is usually easy to reach on its own (1 star) and the letters are the puzzle. Levels 7, 14, 24 have small dock windows (20-46): candidates for easing.
- Unlocking: a level is open if either of the two before it has a star, so one level can always be skipped.

## Daily delivery (src/daily.js)
- Seed: `hashString('star-post:' + 'YYYY-MM-DD')`, local date. 2-3 planets (sometimes a rubber moon), 2-3 rings, no puffs, 1.6 s preview.
- Built on a seeded launch that draws a curvy safe path; then proven: the launch delivers everything, its local window is 2-9.5, the coarse global search finds a full delivery with a window of at most 260, and with gravity off no launch delivers everything.
- Score: launches until the first full delivery (then flight time). After that the day is free play and the record never changes. Streak = consecutive finished days.
- **Snapshot rule:** `tests/daily.test.js` pins the layout hash of four dates. Any change to daily.js, to physics.js constants or maths, or to the kit rng changes everyone's daily. Do not update the hashes casually; if you must, say so in CHANGELOG.md and never mid-day for a date that is already live.

## Testing in a browser
`?debug` exposes `window.__game`: `advance(seconds)` steps the game clock without animation frames, `goto(i)`, `daily()`, `aim(a10, p10)`, `solve()` (aims the full-delivery launch), `launch()`, `retry()`, `puff(dx, dy)`, `act(name, arg)` (same as pressing a UI button), `state()`.

## Backlog
- A sandbox / free-flight mode with a level editor that shares a code.
- Daily archive (must never touch the streak) and a share image of the trail.
- More campaign sectors: rings that orbit, one-way gates, twin capsules.
- Levels that truly need a puff (prove with `searchWithPuff`), and a "no puffs used" badge.
- Trail gallery: keep the prettiest three-star trail per level and show it in the level select.
- Colour-blind check of the speed-coloured trail (speed is cosmetic, so it is not a blocker).

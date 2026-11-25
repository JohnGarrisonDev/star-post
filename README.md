# Star Post

**One launch. Gravity does the rest.**

Oddvale's post office has gone orbital. You get a single launch (angle and power, pulled back like a slingshot), and then gravity steers your odd little robot courier round planets, through every floating mailbox ring and into the Post Office dock. The trail it draws is the reward.

Play it at [games.oddvale.com/star-post](https://games.oddvale.com/star-post/). Part of [Oddvale Games](https://games.oddvale.com), a site of games designed, built and updated by AI models.

- **Campaign:** 30 hand-designed systems in three sectors: plain planets, then rubber moons, boost gates and puffs, then moving planets, wormholes and repulsor stars. Stars for docking, posting every letter, and doing it inside par.
- **Daily delivery:** one generated system per day, the same for everyone. Fewest launches wins; streaks and a copyable result.
- Instant retry, fast-forward, and the ghosts of your last three attempts on screen.

## Run it
No build step and no dependencies. Serve the folder with any static server and open it:

```
npx serve .
```

Tests (Node 20+):

```
node --test tests/
```

They take about a minute: every campaign level and 60 daily systems are solved by a headless search.

## Layout
```
index.html        the page
game.json         metadata for the hub
src/physics.js    deterministic fixed-step gravity simulation (no DOM)
src/solver.js     headless launch search used by tests, tools and the daily generator
src/levels.js     campaign levels (data)
src/daily.js      daily system generator
src/save.js       scoring rules and save data
src/render.js     canvas drawing
src/ui.js         HUD, control bar and menu overlays
src/audio.js      synthesised sound effects
src/main.js       game flow and input
src/game.css      stage shape, HUD and overlay styles
kit/              copy of the Oddvale kit (do not edit; re-copy from the hub)
tools/            level design lab and route scout
tests/            node tests
```

See [AGENTS.md](AGENTS.md) for the physics rules, the level format and how to design a level.

## License
Code is MIT licensed, see [LICENSE](LICENSE). The fonts in `kit/fonts/` (Fraunces, Figtree, DM Mono) are under the SIL Open Font License 1.1. The Oddvale name and mark are not covered by the MIT license.

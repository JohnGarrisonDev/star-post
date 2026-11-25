import test from 'node:test'
import assert from 'node:assert/strict'
import { LEVELS, SECTORS } from '../src/levels.js'
import { compileLevel, fly, isFull, FIELD, STEPS_PER_SEC } from '../src/physics.js'
import { search, localWindow } from '../src/solver.js'
import { levelKey } from '../src/save.js'

// Winning-window bands in degree x power units (the whole aim space is 360 x 90 = 32400), measured on a
// 1 degree x 2 power grid: [min full window, max full window (levels with letters), min dock window].
// Later sectors are tighter, but no level drops below its sector's floor. See AGENTS.md, "Balance" (retuned in 1.1.0).
const BANDS = [[24, 250, 60], [14, 200, 60], [12, 150, 60]]
// The stored launch (sol) must sit in a real pocket, not on a knife edge: its local full window on the fine grid
// (0.2 degree x 0.5 power cells, +-6 degrees x +-8 power around it) must be at least this.
const SOL_LOCAL_MIN = 2.5

test('30 levels in 3 sectors, well formed, unique names', () => {
  assert.equal(LEVELS.length, 30); assert.equal(SECTORS.length, 3)
  assert.equal(new Set(LEVELS.map(levelKey)).size, 30)
  for (const [i, l] of LEVELS.entries()) {
    assert.ok(l.name && l.hint && l.par > 0 && l.preview > 0, `level ${i + 1} has name, hint, par, preview`)
    for (const p of [l.start, l.dock, ...l.rings]) assert.ok(p[0] > 20 && p[0] < FIELD.w - 20 && p[1] > 20 && p[1] < FIELD.h - 20, `level ${i + 1}: everything is inside the field`)
    if (i >= 10) assert.ok(l.preview <= 2.5, 'later levels get a shorter preview')
  }
})

test('every level is solvable by search: dock reachable, full delivery reachable, windows inside the band', () => {
  const rows = [], medians = []
  for (let sec = 0; sec < 3; sec++) {
    const fulls = []
    for (let i = sec * 10; i < sec * 10 + 10; i++) {
      const l = LEVELS[i], comp = compileLevel(l), [minFull, maxFull, minDock] = BANDS[sec]
      const r = search(comp, { aStep: 10, pStep: 20 })
      rows.push(`${String(i + 1).padStart(2)} ${l.name.padEnd(20)} dock ${String(r.dockWindow).padStart(5)}  full ${String(r.fullWindow).padStart(4)}  fastest full ${r.bestFull ? (r.bestFull.n / STEPS_PER_SEC).toFixed(1) : '-'}s  par ${l.par}s`)
      assert.ok(r.dock > 0 && r.dockWindow >= minDock, `${l.name}: dock window ${r.dockWindow} >= ${minDock}`)
      assert.ok(r.full > 0 && r.fullWindow >= minFull, `${l.name}: full window ${r.fullWindow} >= ${minFull}`)
      if (l.rings.length) assert.ok(r.fullWindow <= maxFull, `${l.name}: full window ${r.fullWindow} is not a gift (<= ${maxFull})`)
      assert.ok(r.bestFull.n / STEPS_PER_SEC <= l.par, `${l.name}: three stars are possible (fastest ${r.bestFull.n / STEPS_PER_SEC}s <= par ${l.par}s)`)
      fulls.push(r.fullWindow)
    }
    fulls.sort((a, b) => a - b); medians.push((fulls[4] + fulls[5]) / 2)
  }
  console.log('winning windows (deg x power):\n' + rows.join('\n') + `\nsector medians of the full window: ${medians.join(', ')}`)
  assert.ok(medians[0] > medians[1] && medians[1] > medians[2], `sector medians narrow steadily (${medians.join(', ')})`)
})

test("the designer's launch (sol) delivers everything, and is not fragile", () => {
  for (const l of LEVELS) {
    if (!l.sol) continue
    const comp = compileLevel(l), s = fly(comp, l.sol[0], l.sol[1])
    assert.ok(isFull(comp, s), `${l.name}: sol works`)
    const w = localWindow(comp, l.sol[0], l.sol[1]).fullWindow
    assert.ok(w >= SOL_LOCAL_MIN, `${l.name}: local window round sol ${w.toFixed(1)} >= ${SOL_LOCAL_MIN}`)
  }
})

// Levels whose headline needs a particular body: take that body out and most of the full window must go.
// [level name, planet index, max share of the full window left without it]
const NEEDS = [['Rebound', 0, 0.6], ['Rebound', 2, 0.6], ['Bank Shot', 0, 0.25], ['Bank Shot', 1, 0.25], ['Push and Pull', 0, 0.25], ['Push and Pull', 1, 0.25]]
test('headline bodies matter: removing them closes most of the full window', () => {
  for (const [name, k, max] of NEEDS) {
    const l = LEVELS.find((x) => x.name === name)
    const full = search(compileLevel(l), { aStep: 10, pStep: 20 }).fullWindow
    const without = search(compileLevel({ ...l, planets: l.planets.filter((_, j) => j !== k) }), { aStep: 10, pStep: 20 }).fullWindow
    assert.ok(without <= full * max, `${name}: without body ${k} the full window is ${without} of ${full}`)
  }
})

test('letters need gravity or gadgets: no level with rings is solved by a plain straight line', () => {
  for (const l of LEVELS) {
    if (!l.rings.length) continue
    const flat = compileLevel({ ...l, planets: [], gates: [], worms: [] })
    assert.equal(search(flat, { aStep: 10, pStep: 300 }).full, 0, l.name)
  }
})

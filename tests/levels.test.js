import test from 'node:test'
import assert from 'node:assert/strict'
import { LEVELS, SECTORS } from '../src/levels.js'
import { compileLevel, fly, isFull, FIELD, STEPS_PER_SEC } from '../src/physics.js'
import { search } from '../src/solver.js'
import { levelKey } from '../src/save.js'

// Winning-window bands in degree x power units (the whole aim space is 360 x 90 = 32400), measured on a
// 1 degree x 2 power grid: [min full window, max full window (levels with letters), min dock window].
// Later sectors are allowed to be tighter. See AGENTS.md, "Balance".
const BANDS = [[6, 250, 20], [4, 200, 20], [2, 150, 20]]

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
  assert.ok(medians[0] >= medians[2], 'the last sector is no easier than the first')
})

test("the designer's launch (sol) delivers everything", () => {
  for (const l of LEVELS) {
    if (!l.sol) continue
    const comp = compileLevel(l), s = fly(comp, l.sol[0], l.sol[1])
    assert.ok(isFull(comp, s), `${l.name}: sol works`)
  }
})

test('letters need gravity or gadgets: no level with rings is solved by a plain straight line', () => {
  for (const l of LEVELS) {
    if (!l.rings.length) continue
    const flat = compileLevel({ ...l, planets: [], gates: [], worms: [] })
    assert.equal(search(flat, { aStep: 10, pStep: 300 }).full, 0, l.name)
  }
})

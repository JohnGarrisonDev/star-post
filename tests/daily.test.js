import test from 'node:test'
import assert from 'node:assert/strict'
import { generateDaily, levelHash, dailySeed } from '../src/daily.js'
import { compileLevel, fly, isFull, FIELD } from '../src/physics.js'
import { search, turning } from '../src/solver.js'

// If this test fails you changed the generator or the physics, which changes the daily system for every player.
// Only update these hashes on purpose, and say so in CHANGELOG.md.
const SNAPSHOTS = { '2026-11-24': '1d4928d9', '2026-12-25': 'e8ec6267', '2027-02-14': 'c1c71494', '2028-02-29': 'd804de33' }

test('daily systems are pinned: fixed dates give fixed layouts', () => {
  for (const [date, hash] of Object.entries(SNAPSHOTS)) assert.equal(levelHash(generateDaily(date)), hash, date)
  assert.notEqual(dailySeed('2026-11-24'), dailySeed('2026-11-25'))
})

test('60 days of dailies: always solvable by search, never a straight shot, sensibly sized windows', () => {
  let d = new Date(2026, 10, 24)
  for (let k = 0; k < 60; k++) {
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const l = generateDaily(date), comp = compileLevel(l)
    assert.ok(l.rings.length >= 2 && l.rings.length <= 3 && l.planets.length >= 2, date)
    for (const p of [l.start, l.dock, ...l.rings]) assert.ok(p[0] >= 40 && p[0] <= FIELD.w - 40 && p[1] >= 40 && p[1] <= FIELD.h - 40, `${date}: inside the field`)
    for (const v of [...l.start, ...l.dock, ...l.rings.flat(), ...l.planets.flatMap((p) => [p.x, p.y, p.r])]) assert.ok(Number.isInteger(v), `${date}: integer layout`)
    assert.ok(isFull(comp, fly(comp, l.sol[0], l.sol[1])), `${date}: the designed launch delivers everything`)
    assert.ok(turning(comp, l.sol[0], l.sol[1]) >= 120, `${date}: the route curves`)
    const r = search(comp, { aStep: 10, pStep: 20 })
    assert.ok(r.full >= 1 && r.fullWindow <= 300, `${date}: full window ${r.fullWindow}`)
    assert.ok(r.dockWindow >= 20, `${date}: dock window ${r.dockWindow}`)
    assert.equal(search(compileLevel(l, { noGravity: true }), { aStep: 10, pStep: 300 }).full, 0, `${date}: no straight-line solution`)
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
  }
})

test('generation is repeatable (fresh module state gives the same level)', async () => {
  const again = await import('../src/daily.js?fresh=1')
  assert.equal(again.levelHash(again.generateDaily('2026-12-25')), levelHash(generateDaily('2026-12-25')))
})

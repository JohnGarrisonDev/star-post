import test from 'node:test'
import assert from 'node:assert/strict'
import { LEVELS } from '../src/levels.js'
import { defaults, sanitize, levelKey, starsFor, isOpen, frontier, recordDock, dailyLaunch, dailyFlight, liveStreak, prevDate, dateStr, shareText, recentDays, totalStars } from '../src/save.js'

const K = (i) => levelKey(LEVELS[i])

test('sanitize survives junk of every kind', () => {
  const messy = { stars: { nope: 3, [K(0)]: 99, [K(1)]: -4 }, best: { [K(0)]: { t: 'fast' }, [K(1)]: { t: 2.345, full: 1 } }, aims: { [K(0)]: [99999, -5], daily: ['a', 2] }, cur: { kind: 'x', i: 2 }, daily: { bad: {}, '2026-11-24': { tries: -3, done: true, launch: 9, t: 'x' }, '2026-11-23': { tries: 4, done: true, launch: 9, t: 6.04, letters: 3 } }, streak: -2, bestStreak: 1e12, lastDaily: 'yesterday' }
  for (const junk of [null, undefined, 42, 'x', [], { stars: 'no', best: 7, aims: [1], daily: 'x', cur: 5, streak: 'many' }, messy]) {
    const d = sanitize(junk, LEVELS)
    assert.deepEqual(Object.keys(d).sort(), Object.keys(defaults()).sort())
    for (const v of Object.values(d.stars)) assert.ok(v >= 1 && v <= 3)
  }
  const d = sanitize(messy, LEVELS)
  assert.deepEqual(d.stars, { [K(0)]: 3 })
  assert.deepEqual(d.best, { [K(1)]: { t: 2.35, full: true } })
  assert.deepEqual(d.aims, { [K(0)]: [3599, 100] })
  assert.equal(d.cur, null); assert.equal(d.streak, 0); assert.equal(d.lastDaily, null)
  assert.deepEqual(d.daily['2026-11-24'], { tries: 0, done: false, launch: 0, t: 0, letters: 0 })
  assert.deepEqual(d.daily['2026-11-23'], { tries: 4, done: true, launch: 4, t: 6, letters: 3 })
  assert.equal(d.daily.bad, undefined)
  assert.deepEqual(sanitize(JSON.parse(JSON.stringify(d)), LEVELS), d, 'clean data passes through unchanged')
})

test('stars: 1 dock, 2 all letters, 3 all letters inside par', () => {
  const l = { rings: [[1, 1], [2, 2]], par: 5 }
  assert.equal(starsFor(l, 1, 2), 1); assert.equal(starsFor(l, 2, 5.01), 2); assert.equal(starsFor(l, 2, 5), 3)
  assert.equal(starsFor({ rings: [], par: 3 }, 0, 2.9), 3); assert.equal(starsFor({ rings: [], par: 3 }, 0, 3.5), 2)
})

test('unlocking: clear a level to open the next, and one level may always be skipped', () => {
  const d = defaults()
  assert.ok(isOpen(d, LEVELS, 0) && isOpen(d, LEVELS, 1) && !isOpen(d, LEVELS, 2))
  d.stars[K(1)] = 1
  assert.ok(isOpen(d, LEVELS, 2) && isOpen(d, LEVELS, 3) && !isOpen(d, LEVELS, 4))
  assert.equal(frontier(d, LEVELS), 0)
  d.stars[K(0)] = 2; assert.equal(frontier(d, LEVELS), 2); assert.equal(totalStars(d), 3)
})

test('recordDock keeps the best stars and the best time, and a full delivery beats a faster empty one', () => {
  const d = defaults(), l = LEVELS[2]
  let r = recordDock(d, l, 0, 2.0); assert.equal(r.stars, 1); assert.equal(r.newBest, false)
  r = recordDock(d, l, 1, 9.0); assert.equal(r.stars, 2); assert.ok(r.newBest); assert.deepEqual(d.best[K(2)], { t: 9, full: true })
  r = recordDock(d, l, 0, 1.5); assert.equal(d.stars[K(2)], 2); assert.equal(d.best[K(2)].t, 9)
  r = recordDock(d, l, 1, l.par - 0.5); assert.equal(r.stars, 3); assert.ok(r.newStars); assert.equal(d.best[K(2)].t, l.par - 0.5)
})

test('daily: launches count until solved, streaks need consecutive days', () => {
  const d = defaults()
  assert.equal(prevDate('2026-03-01'), '2026-02-28'); assert.equal(prevDate('2027-01-01'), '2026-12-31'); assert.match(dateStr(), /^\d{4}-\d{2}-\d{2}$/)
  dailyLaunch(d, '2026-11-24'); assert.equal(dailyFlight(d, '2026-11-24', { full: false, letters: 2, t: 4 }), false)
  dailyLaunch(d, '2026-11-24'); dailyLaunch(d, '2026-11-24')
  assert.equal(dailyFlight(d, '2026-11-24', { full: true, letters: 3, t: 11.23 }), true)
  assert.deepEqual(d.daily['2026-11-24'], { tries: 3, done: true, launch: 3, t: 11.2, letters: 3 })
  dailyLaunch(d, '2026-11-24'); assert.equal(dailyFlight(d, '2026-11-24', { full: true, letters: 3, t: 5 }), false)
  assert.equal(d.daily['2026-11-24'].launch, 3, 'free play after solving never changes the result')
  assert.equal(d.daily['2026-11-24'].tries, 3)
  assert.equal(d.streak, 1)
  dailyLaunch(d, '2026-11-25'); dailyFlight(d, '2026-11-25', { full: true, letters: 2, t: 6 }); assert.equal(d.streak, 2)
  assert.equal(liveStreak(d, '2026-11-26'), 2); assert.equal(liveStreak(d, '2026-11-27'), 0)
  dailyLaunch(d, '2026-11-28'); dailyFlight(d, '2026-11-28', { full: true, letters: 2, t: 6 }); assert.equal(d.streak, 1); assert.equal(d.bestStreak, 2)
  assert.equal(shareText('2026-11-24', d.daily['2026-11-24'], 3), 'Star Post 2026-11-24 · all 3 letters · launch #3 · 11.2s\ngames.oddvale.com/star-post')
  const days = recentDays(d, '2026-11-28', 7); assert.equal(days.length, 7); assert.equal(days[6].date, '2026-11-28'); assert.equal(days[2].rec.launch, 3)
})

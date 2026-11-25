// Daily delivery: one procedurally generated system per calendar date, the same for everyone.
// Method: seed -> scatter planets -> try launches until one draws a long, curvy, safe path -> hang 2-3 mailbox
// rings on that path and put the dock at its end. So a full solution exists by construction, and the generator
// then proves it with the same headless search the campaign tests use, and throws away systems that are too
// fiddly, too easy, or solvable in a straight line (gravity switched off).
// Determinism: only seeded integers from the kit rng and the deterministic physics. No Math.random, no trig, no sort.
// CHANGING ANYTHING HERE (or in physics.js) CHANGES EVERYONE'S DAILY: the snapshot test in tests/ guards it.
import { makeRng, hashString } from '../kit/kit.js'
import { compileLevel, createFlight, step, fly, isFull, FIELD, STEPS_PER_SEC } from './physics.js'
import { search, localWindow } from './solver.js'

export const DAILY_RING_R = 30, DAILY_DOCK_R = 34
const NAMES_A = ['Wobble', 'Biscuit', 'Tangle', 'Noodle', 'Pickle', 'Doily', 'Crumpet', 'Fidget', 'Mitten', 'Gravy', 'Button', 'Waffle', 'Bobbin', 'Teapot', 'Sprocket', 'Marble']
const NAMES_B = ['Reach', 'Loop', 'Drift', 'Corner', 'Junction', 'Hollow', 'Bend', 'Crossing', 'Run', 'Circuit']

export const dailySeed = (date) => hashString('star-post:' + date)
const d2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by)

/** One attempt. Returns a level or null. */
function attempt(rng) {
  // planets
  const nP = 2 + rng.int(2), planets = []
  for (let tries = 0; planets.length < nP && tries < 60; tries++) {
    const p = { x: 280 + rng.int(54) * 10, y: 110 + rng.int(43) * 10, r: 32 + rng.int(10) * 2, m: 4 + rng.int(9) * 0.5 }
    let ok = true
    for (const q of planets) { const gap = p.r + q.r + 170; if (d2(p.x, p.y, q.x, q.y) < gap * gap) ok = false }
    if (ok) planets.push(p)
  }
  if (planets.length < 2) return null
  if (rng.int(4) === 0) { const p = planets[planets.length - 1]; p.kind = 'rubber'; p.m = 0; p.r += 14 }
  // start, on the left edge, clear of every planet
  const start = [70 + rng.int(8) * 10, 100 + rng.int(45) * 10]
  for (const p of planets) { const gap = p.r + 170; if (d2(p.x, p.y, start[0], start[1]) < gap * gap) return null }
  const skeleton = compileLevel({ start, dock: [-9999, -9999], planets, rings: [] })
  const nRings = 2 + rng.int(2)

  for (let k = 0; k < 40; k++) {
    const a10 = (3600 + (rng.int(281) - 140) * 5) % 3600, p10 = 300 + rng.int(51) * 10
    const tDock = 3.6 + rng.int(36) * 0.1
    const marks = []
    for (let i = 0; i < nRings; i++) marks.push(Math.round((0.9 + (tDock - 1.7) * (i + 0.5 + (rng.int(41) - 20) / 100) / nRings) * STEPS_PER_SEC))
    // fly the skeleton and watch the path
    const s = createFlight(skeleton, a10, p10), nDock = Math.round(tDock * STEPS_PER_SEC)
    const xs = [], ys = [], rings = []
    let turn = 0, ok = true
    while (s.n < nDock) {
      const vx = s.vx, vy = s.vy
      step(skeleton, s)
      if (s.status !== 'fly' || s.x < 45 || s.x > FIELD.w - 45 || s.y < 45 || s.y > FIELD.h - 45) { ok = false; break }
      const m = Math.sqrt((vx * vx + vy * vy) * (s.vx * s.vx + s.vy * s.vy))
      if (m > 1e-9) { const sn = (vx * s.vy - vy * s.vx) / m; turn += (sn < 0 ? -sn : sn) * 57.3 }
      if (s.n % 6 === 0) { xs.push(s.x); ys.push(s.y) }
      for (let i = 0; i < nRings; i++) if (marks[i] === s.n) rings[i] = [Math.round(s.x), Math.round(s.y), DAILY_RING_R]
    }
    if (!ok || turn < 150 || rings.length < nRings) continue
    const dock = [Math.round(s.x), Math.round(s.y)]
    // spacing rules: nothing on top of anything else, and the path must not brush the dock early
    let fine = d2(dock[0], dock[1], start[0], start[1]) > 200 * 200
    const pts = [...rings, dock]
    for (let i = 0; i < pts.length && fine; i++) {
      if (d2(pts[i][0], pts[i][1], start[0], start[1]) < 110 * 110) fine = false
      for (let j = i + 1; j < pts.length; j++) if (d2(pts[i][0], pts[i][1], pts[j][0], pts[j][1]) < 90 * 90) fine = false
      for (const p of planets) { const gap = p.r + 42; if (d2(pts[i][0], pts[i][1], p.x, p.y) < gap * gap) fine = false }
    }
    const early = xs.length - 8
    for (let i = 0; i < early && fine; i++) if (d2(xs[i], ys[i], dock[0], dock[1]) < (DAILY_DOCK_R + 14) * (DAILY_DOCK_R + 14)) fine = false
    if (!fine) continue

    const level = { start, dock, dockR: DAILY_DOCK_R, planets, rings, preview: 1.6, puffs: 0, sol: [a10, p10] }
    // proof 1: the designed launch really delivers everything
    const comp = compileLevel(level)
    if (!isFull(comp, fly(comp, a10, p10))) continue
    // proof 2: it is forgiving enough to find, but not a gift
    const near = localWindow(comp, a10, p10, { aSpan: 20, pSpan: 30, aStep: 5, pStep: 10 })
    if (near.fullWindow < 2 || near.fullWindow > 9.5) continue
    // proof 3: the headless search finds a full delivery too, and not too much of the sky wins
    const wide = search(comp, { aStep: 20, pStep: 40 })
    if (wide.full < 1 || wide.fullWindow > 260) continue
    // proof 4: no straight-line answer when gravity is switched off
    const flat = search(compileLevel(level, { noGravity: true }), { aStep: 10, pStep: 300 })
    if (flat.full > 0) continue
    level.window = { near: near.fullWindow, wide: wide.fullWindow, dock: wide.dockWindow }
    return level
  }
  return null
}

const cache = new Map()
/** The system for a date string 'YYYY-MM-DD'. Always returns a solvable level (deterministic). */
export function generateDaily(date) {
  if (cache.has(date)) return cache.get(date)
  const rng = makeRng(dailySeed(date))
  let level = null
  for (let i = 0; i < 400 && !level; i++) level = attempt(rng)
  if (!level) level = { start: [100, 320], dock: [870, 488], dockR: DAILY_DOCK_R, planets: [{ x: 480, y: 330, r: 44, m: 6 }], rings: [[476, 198, DAILY_RING_R], [690, 322, DAILY_RING_R]], preview: 1.6, puffs: 0, sol: [3350, 600] } // never reached in testing; a safe fallback
  level.name = `${NAMES_A[rng.int(NAMES_A.length)]} ${NAMES_B[rng.int(NAMES_B.length)]}`
  level.date = date
  level.hint = 'One system a day. Fewest launches to post every letter and dock.'
  level.par = 0
  if (cache.size > 8) cache.clear()
  cache.set(date, level)
  return level
}

/** Stable fingerprint of a level's layout, for the snapshot test. */
export function levelHash(level) {
  const flat = [level.start, level.dock, level.planets.map((p) => [p.x, p.y, p.r, p.m, p.kind || '']), level.rings, level.sol]
  return hashString(JSON.stringify(flat)).toString(16)
}

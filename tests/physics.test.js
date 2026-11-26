import test from 'node:test'
import assert from 'node:assert/strict'
import { DT, compileLevel, createFlight, step, puff, fly, previewPath, replayPath, pullAt, dsin, dcos, landing, speedOf, LOST_STEPS, PUFF_DV, DOCK_R } from '../src/physics.js'

const far = [-9999, -9999]
const base = (o = {}) => ({ start: [100, 320], dock: far, planets: [], rings: [], ...o })

test('dsin and dcos match Math within 1e-9 and are exact at 0', () => {
  for (let i = -2000; i <= 2000; i++) { const x = i * 0.01; assert.ok(Math.abs(dsin(x) - Math.sin(x)) < 1e-9); assert.ok(Math.abs(dcos(x) - Math.cos(x)) < 1e-9) }
  assert.equal(dsin(0), 0); assert.ok(Math.abs(dcos(0) - 1) < 1e-15)
})

test('a flight is deterministic: same launch, same final state, bit for bit', () => {
  const lvl = base({ planets: [{ x: 480, y: 330, r: 44, m: 6 }, { x: 760, y: 200, r: 30, m: 3 }] })
  const a = fly(compileLevel(lvl), 3350, 600), b = fly(compileLevel(lvl), 3350, 600)
  assert.deepEqual([a.x, a.y, a.vx, a.vy, a.n, a.status], [b.x, b.y, b.vx, b.vy, b.n, b.status])
})

test('with no gravity the capsule flies dead straight at launch speed', () => {
  const comp = compileLevel(base())
  const s = createFlight(comp, 0, 500)
  for (let i = 0; i < 120; i++) step(comp, s)
  assert.ok(Math.abs(s.x - (100 + speedOf(500))) < 1e-6); assert.ok(Math.abs(s.y - 320) < 1e-9)
})

test('a circular orbit stays circular for 40 periods (stability of the integrator)', () => {
  const comp = compileLevel({ start: [500 + 90, 320], dock: far, planets: [{ x: 500, y: 320, r: 40, m: 6, f: 400 }], rings: [], maxT: 10000 })
  const b = comp.bodies[0], r0 = 90, v = Math.sqrt(pullAt(b, r0) * r0)
  const s = createFlight(comp, 900, 100); s.vx = 0; s.vy = v
  const period = (2 * Math.PI * r0) / v, steps = Math.round((40 * period) / DT)
  let lo = Infinity, hi = 0
  for (let i = 0; i < steps; i++) { step(comp, s); s.out = 0; const d = Math.hypot(s.x - 500, s.y - 320); lo = Math.min(lo, d); hi = Math.max(hi, d) }
  assert.equal(s.status, 'fly')
  assert.ok(hi - lo < r0 * 0.01, `radius wandered ${lo.toFixed(3)}..${hi.toFixed(3)}`)
  assert.ok(Math.abs(Math.hypot(s.vx, s.vy) - v) < v * 0.01, 'speed (energy) is conserved')
})

test('the aim preview equals the flown path exactly', () => {
  const comp = compileLevel(base({ planets: [{ x: 480, y: 330, r: 44, m: 6 }, { r: 20, m: 2, orbit: { cx: 700, cy: 300, R: 90, period: 6, phase: 40 } }], gates: [[300, 250, 20]], preview: 4 }))
  const pre = previewPath(comp, 3350, 600, 480, 4)
  const s = createFlight(comp, 3350, 600), pts = [s.x, s.y]
  while (s.status === 'fly' && s.n < 480) { step(comp, s); if (s.n % 4 === 0 || s.status !== 'fly') pts.push(s.x, s.y) }
  assert.ok(pts.length > 100)
  assert.deepEqual(pre.pts, pts); assert.equal(pre.end, s.status)
})

test('gravity pulls towards a planet, a repulsor star pushes away, and both stop at the field edge', () => {
  const c1 = compileLevel(base({ planets: [{ x: 300, y: 420, r: 30, m: 4 }] }))
  const s1 = createFlight(c1, 0, 400); for (let i = 0; i < 60; i++) step(c1, s1)
  assert.ok(s1.y > 320, 'bent towards the planet')
  const c2 = compileLevel(base({ planets: [{ x: 300, y: 420, r: 30, m: 4, kind: 'star' }] }))
  const s2 = createFlight(c2, 0, 400); for (let i = 0; i < 60; i++) step(c2, s2)
  assert.ok(s2.y < 320, 'pushed away from the star')
  assert.equal(pullAt(c1.bodies[0], c1.bodies[0].f + 1), 0)
  assert.ok(pullAt(c1.bodies[0], 60) > pullAt(c1.bodies[0], 120))
})

test('hitting a planet or a rock is a crash; a rubber moon reflects', () => {
  const crash = fly(compileLevel(base({ planets: [{ x: 400, y: 320, r: 40, m: 2 }] })), 0, 500)
  assert.equal(crash.status, 'crash'); assert.ok(crash.x < 400)
  assert.equal(fly(compileLevel(base({ rocks: [[400, 320, 16]] })), 0, 500).status, 'crash')
  const comp = compileLevel(base({ planets: [{ x: 400, y: 320, r: 40, m: 0, kind: 'rubber' }] })), ev = []
  const s = createFlight(comp, 0, 500, ev)
  for (let i = 0; i < 400 && s.status === 'fly'; i++) step(comp, s)
  assert.equal(ev.filter((e) => e.type === 'bounce').length, 1)
  assert.ok(s.vx < 0 && Math.abs(s.vy) < 1e-6, 'head-on bounce comes straight back')
  assert.ok(Math.abs(Math.hypot(s.vx, s.vy) - 200) < 1e-6, 'no speed lost')
})

test('rings deliver once, in order when numbered, and the dock ends the flight', () => {
  const lvl = base({ rings: [[300, 320], [500, 320]], dock: [800, 320] })
  const s = fly(compileLevel(lvl), 0, 500)
  assert.equal(s.status, 'dock'); assert.equal(s.nGot, 2); assert.ok(Math.abs(s.dockSpeed - 200) < 1e-6)
  assert.ok(s.x > 800 - DOCK_R - 2 && s.x < 800 - DOCK_R + 2, 'captured at the edge of the dock radius')
  const miss = fly(compileLevel(base({ rings: [[300, 400]], dock: [800, 320] })), 0, 500)
  assert.equal(miss.status, 'dock'); assert.equal(miss.nGot, 0)
  const ordered = fly(compileLevel({ ...lvl, rings: [[500, 320], [300, 320]], ordered: true }), 0, 500)
  assert.equal(ordered.nGot, 1, 'ring 2 came first and stayed shut')
})

test('boost gates add speed along their arrow, once per pass', () => {
  const comp = compileLevel(base({ gates: [[300, 320, 0, 100]] })), ev = []
  const s = createFlight(comp, 0, 500, ev); for (let i = 0; i < 240; i++) step(comp, s)
  assert.equal(ev.filter((e) => e.type === 'boost').length, 1); assert.ok(Math.abs(s.vx - 300) < 1e-9)
})

test('wormholes move the capsule to the partner and keep its velocity', () => {
  const comp = compileLevel(base({ worms: [[300, 320, 700, 100]] })), ev = []
  const s = createFlight(comp, 0, 500, ev); for (let i = 0; i < 200; i++) step(comp, s)
  assert.equal(ev.filter((e) => e.type === 'warp').length, 1, 'no ping-pong')
  assert.ok(Math.abs(s.y - 100) < 1e-9 && s.x > 700); assert.ok(Math.abs(s.vx - 200) < 1e-9)
})

test('puffs push, are limited, and default to straight ahead', () => {
  const comp = compileLevel(base({ puffs: 2 }))
  const s = createFlight(comp, 0, 500)
  assert.ok(puff(comp, s)); assert.ok(Math.abs(s.vx - (200 + PUFF_DV)) < 1e-9)
  assert.ok(puff(comp, s, 0, 5)); assert.ok(Math.abs(s.vy - PUFF_DV) < 1e-9)
  assert.equal(puff(comp, s), false); assert.equal(s.puffsUsed, 2)
})

test('leaving the field for three seconds is lost in space; a stuck orbit runs out of battery', () => {
  const s = fly(compileLevel(base()), 1800, 500)
  assert.equal(s.status, 'lost'); assert.equal(s.why, 'far'); assert.equal(s.out, LOST_STEPS + 1)
  const comp = compileLevel({ start: [590, 320], dock: far, planets: [{ x: 500, y: 320, r: 40, m: 6, f: 400 }], rings: [], maxT: 5 })
  const o = createFlight(comp, 900, 100); o.vx = 0; o.vy = Math.sqrt(pullAt(comp.bodies[0], 90) * 90)
  while (o.status === 'fly') step(comp, o)
  assert.equal(o.status, 'lost'); assert.equal(o.why, 'time'); assert.equal(o.n, 600)
})

test('landing ratings follow arrival speed', () => {
  assert.equal(landing(80).id, 'feather'); assert.equal(landing(150).id, 'neat'); assert.equal(landing(250).id, 'firm'); assert.equal(landing(400).id, 'thump')
})

test('a stored run (launch + puffs) replays exactly like the live flight: the best ghost', async () => {
  const { LEVELS } = await import('../src/levels.js')
  const l = LEVELS.find((x) => x.name === 'Puff School'), comp = compileLevel(l)
  // fly it the way the game does: step, and between steps puff (once straight ahead, once sideways)
  const s = createFlight(comp, l.sol[0], l.sol[1]), log = []
  while (s.status === 'fly') {
    if (s.n === 90) { log.push(s.n, s.vx, s.vy); puff(comp, s) }
    if (s.n === 200) { log.push(s.n, 0.6, -0.8); puff(comp, s, 0.6, -0.8) }
    step(comp, s)
  }
  const r = replayPath(comp, l.sol[0], l.sol[1], log, 6)
  assert.equal(r.status, s.status); assert.equal(r.n, s.n); assert.equal(r.nGot, s.nGot)
  assert.equal(r.pts[r.pts.length - 2], s.x); assert.equal(r.pts[r.pts.length - 1], s.y)
  const plain = replayPath(comp, l.sol[0], l.sol[1]), f = fly(comp, l.sol[0], l.sol[1])
  assert.equal(plain.n, f.n); assert.equal(plain.status, 'dock')
})

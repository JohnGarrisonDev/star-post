// Star Post physics: DOM-free, deterministic, fixed timestep.
// One capsule, point gravity from each body, velocity Verlet. Everything here uses only + - * / and Math.sqrt
// (plus our own sine), so a flight gives bit-identical results in every browser and in node. That is what lets
// the aim preview match the real flight exactly, and the daily generator make the same system for everyone.
//
// Units: the play field is FIELD.w x FIELD.h world units. Angles are stored in tenths of a degree (a10, 0..3599,
// 0 = +x, growing towards +y) and launch power in tenths (p10, 100..1000). Time is counted in steps (n) of DT.

export const DT = 1 / 120
export const STEPS_PER_SEC = 120
export const FIELD = { w: 1000, h: 640 }
export const CAP_R = 7            // capsule radius
export const PUFF_DV = 30         // speed added by one puff
export const LOST_STEPS = 360     // 3 s outside the field = lost in space
export const DEFAULT_MAX_T = 40   // seconds before the capsule's battery runs flat
export const RING_R = 26
export const DOCK_R = 30
export const GATE_R = 24
export const WORM_R = 18
export const P_MIN = 100, P_MAX = 1000
export const speedOf = (p10) => p10 * 0.4 // power 10..100 -> 40..400 units/s

const PI = 3.141592653589793, TAU = 6.283185307179586, HALF_PI = 1.5707963267948966
/** Deterministic sine (radians): range reduction and a fixed polynomial, no Math.sin. */
export function dsin(x) {
  x -= TAU * Math.round(x / TAU)
  if (x > HALF_PI) x = PI - x
  else if (x < -HALF_PI) x = -PI - x
  const q = x * x
  return x * (1 + q * (-1 / 6 + q * (1 / 120 + q * (-1 / 5040 + q * (1 / 362880 + q * (-1 / 39916800 + q * (1 / 6227020800 + q * (-1 / 1307674368000 + q * (1 / 355687428096000 + q * (-1 / 121645100408832000))))))))))
}
export const dcos = (x) => dsin(x + HALF_PI)
export const rad10 = (a10) => a10 * (PI / 1800)
export const normA10 = (a) => ((Math.round(a) % 3600) + 3600) % 3600
export const clampP10 = (p) => Math.max(P_MIN, Math.min(P_MAX, Math.round(p)))

/** Default gravity field radius for a body: pull fades smoothly to nothing here. */
export const fieldRadius = (r, m) => Math.round(r + 70 * Math.sqrt(Math.abs(m)))

/**
 * Turn level data into the flat structure the simulation uses.
 * Level: { start:[x,y], dock:[x,y], planets:[{x,y,r,m,kind?,f?,orbit?}], rings:[[x,y,r?]], rocks:[[x,y,r]],
 *          gates:[[x,y,deg,boost?]], worms:[[x1,y1,x2,y2]], ordered?, puffs?, preview?, maxT? }
 * planet kind: 'planet' (default), 'rubber' (bounces), 'star' (repulsor: m is made negative).
 * orbit: { cx, cy, R, period (s, negative = other way), phase (deg) }.
 */
export function compileLevel(lvl, { noGravity = false } = {}) {
  const bodies = []
  for (const p of lvl.planets || []) {
    const kind = p.kind || 'planet'
    let m = p.m ?? 0
    if (kind === 'star') m = -Math.abs(m)
    const mu = noGravity ? 0 : m * 1e6
    const f = p.f ?? fieldRadius(p.r, m)
    const o = p.orbit
    bodies.push({
      kind, x: p.x ?? 0, y: p.y ?? 0, r: p.r, m, mu, f, f0: f * 0.6, f2: f * f, s2: (p.r * 0.45) * (p.r * 0.45),
      hit: p.r + CAP_R * 0.6, look: p.look || null,
      orbit: o ? { cx: o.cx, cy: o.cy, R: o.R, w: TAU / o.period, ph: (o.phase || 0) * (PI / 180), period: o.period } : null,
    })
  }
  for (const k of lvl.rocks || []) bodies.push({ kind: 'rock', x: k[0], y: k[1], r: k[2] ?? 14, m: 0, mu: 0, f: 0, f0: 0, f2: 0, s2: 1, hit: (k[2] ?? 14) + CAP_R * 0.5, orbit: null, look: null })
  const worms = []
  for (const w of lvl.worms || []) { const i = worms.length; worms.push({ x: w[0], y: w[1], to: i + 1, pair: i >> 1 }, { x: w[2], y: w[3], to: i, pair: i >> 1 }) }
  const comp = {
    lvl, bodies,
    moving: bodies.some((b) => b.orbit),
    start: { x: lvl.start[0], y: lvl.start[1] },
    dock: { x: lvl.dock[0], y: lvl.dock[1], r: lvl.dockR ?? DOCK_R },
    rings: (lvl.rings || []).map((r) => ({ x: r[0], y: r[1], r: r[2] ?? RING_R })),
    gates: (lvl.gates || []).map((g) => ({ x: g[0], y: g[1], deg: g[2], dx: dcos(g[2] * PI / 180), dy: dsin(g[2] * PI / 180), boost: g[3] ?? 110 })),
    worms,
    ordered: !!lvl.ordered,
    puffs: lvl.puffs || 0,
    maxSteps: Math.round((lvl.maxT || DEFAULT_MAX_T) * STEPS_PER_SEC),
    previewSteps: Math.round((lvl.preview ?? 2) * STEPS_PER_SEC),
    px: new Float64Array(bodies.length), py: new Float64Array(bodies.length), pn: -1,
  }
  for (let i = 0; i < bodies.length; i++) { comp.px[i] = bodies[i].x; comp.py[i] = bodies[i].y }
  place(comp, 0)
  return comp
}

/** Put every moving body where it is at step n (cached in comp.px / comp.py). */
export function place(comp, n) {
  if (comp.pn === n) return
  comp.pn = n
  if (!comp.moving) return
  const t = n * DT, B = comp.bodies
  for (let i = 0; i < B.length; i++) {
    const o = B[i].orbit
    if (!o) continue
    const a = o.ph + o.w * t
    comp.px[i] = o.cx + o.R * dcos(a); comp.py[i] = o.cy + o.R * dsin(a)
  }
}

const A = { x: 0, y: 0 }
/** Gravity at (x, y) for the body positions currently placed. Result in the shared A. */
function accel(comp, x, y) {
  let ax = 0, ay = 0
  const B = comp.bodies, px = comp.px, py = comp.py
  for (let i = 0; i < B.length; i++) {
    const b = B[i]
    if (b.mu === 0) continue
    const dx = px[i] - x, dy = py[i] - y, d2 = dx * dx + dy * dy
    if (d2 >= b.f2 || d2 < 1e-9) continue
    const d = Math.sqrt(d2)
    let k = b.mu / ((d2 + b.s2) * d)
    if (d > b.f0) { const u = (b.f - d) / (b.f - b.f0); k *= u * u * (3 - 2 * u) }
    ax += dx * k; ay += dy * k
  }
  A.x = ax; A.y = ay
}
/** Strength of the pull at distance d from body b (used by tests and the renderer). */
export function pullAt(b, d) {
  if (d >= b.f) return 0
  let a = b.mu / (d * d + b.s2)
  if (d > b.f0) { const u = (b.f - d) / (b.f - b.f0); a *= u * u * (3 - 2 * u) }
  return a
}

/** A new flight: the capsule leaves the start at angle a10 and power p10. events: pass an array to collect them. */
export function createFlight(comp, a10, p10, events = null) {
  const sp = speedOf(p10), a = rad10(a10)
  const s = {
    x: comp.start.x, y: comp.start.y, vx: sp * dcos(a), vy: sp * dsin(a), ax: 0, ay: 0, n: 0,
    status: 'fly', why: '', got: new Uint8Array(comp.rings.length), nGot: 0, out: 0,
    worm: -1, gate: -1, puffsLeft: comp.puffs, puffsUsed: 0, dockSpeed: 0, bounces: 0, ev: events,
  }
  place(comp, 0); accel(comp, s.x, s.y); s.ax = A.x; s.ay = A.y
  return s
}
export function cloneFlight(s) { return { ...s, got: s.got.slice(), ev: null } }

/** A puff: a small kick. dx,dy = direction (need not be unit); omitted = straight ahead. Returns false if none left. */
export function puff(comp, s, dx, dy) {
  if (s.status !== 'fly' || s.puffsLeft <= 0) return false
  if (dx === undefined || (dx === 0 && dy === 0)) { dx = s.vx; dy = s.vy }
  const d = Math.sqrt(dx * dx + dy * dy)
  if (d < 1e-9) return false
  s.vx += PUFF_DV * dx / d; s.vy += PUFF_DV * dy / d
  s.puffsLeft--; s.puffsUsed++
  if (s.ev) s.ev.push({ type: 'puff', x: s.x, y: s.y, dx: dx / d, dy: dy / d })
  return true
}

/** Advance one fixed step. Mutates s. */
export function step(comp, s) {
  if (s.status !== 'fly') return
  const h = DT
  s.x += s.vx * h + 0.5 * s.ax * h * h
  s.y += s.vy * h + 0.5 * s.ay * h * h
  const n = s.n + 1
  place(comp, n)
  accel(comp, s.x, s.y)
  s.vx += 0.5 * (s.ax + A.x) * h; s.vy += 0.5 * (s.ay + A.y) * h
  s.ax = A.x; s.ay = A.y; s.n = n
  const ev = s.ev

  // solid bodies: crash, or bounce off rubber
  const B = comp.bodies, px = comp.px, py = comp.py
  for (let i = 0; i < B.length; i++) {
    const b = B[i], dx = s.x - px[i], dy = s.y - py[i], d2 = dx * dx + dy * dy
    if (d2 >= b.hit * b.hit) continue
    if (b.kind === 'rubber') {
      const d = Math.sqrt(d2) || 1, nx = dx / d, ny = dy / d, vn = s.vx * nx + s.vy * ny
      s.x = px[i] + nx * b.hit; s.y = py[i] + ny * b.hit
      if (vn < 0) { s.vx -= 2 * vn * nx; s.vy -= 2 * vn * ny }
      accel(comp, s.x, s.y); s.ax = A.x; s.ay = A.y
      s.bounces++
      if (ev) ev.push({ type: 'bounce', x: s.x, y: s.y, i, speed: -vn })
      if (s.bounces > 40) { s.status = 'crash'; s.why = 'rubber'; if (ev) ev.push({ type: 'crash', x: s.x, y: s.y, i }); return }
    } else {
      s.status = 'crash'; s.why = b.kind
      if (ev) ev.push({ type: 'crash', x: s.x, y: s.y, i })
      return
    }
  }
  // wormholes: hop to the partner, keep velocity; no hopping back until we have left it
  const W = comp.worms
  if (W.length) {
    if (s.worm >= 0) {
      const w = W[s.worm], dx = s.x - w.x, dy = s.y - w.y
      if (dx * dx + dy * dy > WORM_R * WORM_R) s.worm = -1
    } else {
      for (let i = 0; i < W.length; i++) {
        const w = W[i], dx = s.x - w.x, dy = s.y - w.y
        if (dx * dx + dy * dy >= WORM_R * WORM_R) continue
        const o = W[w.to]
        if (ev) ev.push({ type: 'warp', x: s.x, y: s.y, tx: o.x + dx, ty: o.y + dy, i })
        s.x = o.x + dx; s.y = o.y + dy; s.worm = w.to
        accel(comp, s.x, s.y); s.ax = A.x; s.ay = A.y
        break
      }
    }
  }
  // boost gates: a kick along the arrow each time we enter
  const G = comp.gates
  if (G.length) {
    let inside = -1
    for (let i = 0; i < G.length; i++) {
      const g = G[i], dx = s.x - g.x, dy = s.y - g.y
      if (dx * dx + dy * dy < GATE_R * GATE_R) { inside = i; break }
    }
    if (inside >= 0 && inside !== s.gate) {
      const g = G[inside]
      s.vx += g.dx * g.boost; s.vy += g.dy * g.boost
      if (ev) ev.push({ type: 'boost', x: s.x, y: s.y, i: inside })
    }
    s.gate = inside
  }
  // mailbox rings
  const R = comp.rings
  for (let i = 0; i < R.length; i++) {
    if (s.got[i]) continue
    if (comp.ordered && i !== s.nGot) continue
    const r = R[i], dx = s.x - r.x, dy = s.y - r.y
    if (dx * dx + dy * dy < r.r * r.r) {
      s.got[i] = 1; s.nGot++
      if (ev) ev.push({ type: 'deliver', x: r.x, y: r.y, i, count: s.nGot })
    }
  }
  // the dock
  {
    const dx = s.x - comp.dock.x, dy = s.y - comp.dock.y
    if (dx * dx + dy * dy < comp.dock.r * comp.dock.r) {
      s.status = 'dock'; s.dockSpeed = Math.sqrt(s.vx * s.vx + s.vy * s.vy)
      if (ev) ev.push({ type: 'dock', x: comp.dock.x, y: comp.dock.y, speed: s.dockSpeed })
      return
    }
  }
  // lost in space
  if (s.x < 0 || s.x > FIELD.w || s.y < 0 || s.y > FIELD.h) {
    if (++s.out > LOST_STEPS) { s.status = 'lost'; s.why = 'far'; if (ev) ev.push({ type: 'lost', x: s.x, y: s.y }) }
  } else s.out = 0
  if (s.status === 'fly' && n >= comp.maxSteps) { s.status = 'lost'; s.why = 'time'; if (ev) ev.push({ type: 'lost', x: s.x, y: s.y }) }
}

/** Fly a launch to its end (no puffs unless given as [[step, dx, dy], ...] sorted by step). Returns the final state. */
export function fly(comp, a10, p10, puffs = null) {
  const s = createFlight(comp, a10, p10)
  let k = 0
  while (s.status === 'fly') {
    if (puffs) while (k < puffs.length && puffs[k][0] === s.n) { puff(comp, s, puffs[k][1], puffs[k][2]); k++ }
    step(comp, s)
  }
  return s
}
export const isFull = (comp, s) => s.status === 'dock' && s.nGot === comp.rings.length

/**
 * Replay a whole run (launch plus puffs given flat as [n, dx, dy, n, dx, dy, ...]) and sample its path every `every`
 * steps: { pts: [x0, y0, ...], status, n, nGot }. Same steps as fly(), so a stored run replays exactly (the best ghost).
 */
export function replayPath(comp, a10, p10, flatPuffs = [], every = 6) {
  const s = createFlight(comp, a10, p10), pts = [s.x, s.y]
  let k = 0
  while (s.status === 'fly') {
    while (k + 2 < flatPuffs.length && flatPuffs[k] === s.n) { puff(comp, s, flatPuffs[k + 1], flatPuffs[k + 2]); k += 3 }
    step(comp, s)
    if (s.n % every === 0 || s.status !== 'fly') pts.push(s.x, s.y)
  }
  return { pts, status: s.status, n: s.n, nGot: s.nGot }
}

/** The path a launch would take for `steps` steps, sampled every `every` steps: flat [x0,y0,x1,y1,...]. Stops when the flight ends. */
export function previewPath(comp, a10, p10, steps = comp.previewSteps, every = 4) {
  const s = createFlight(comp, a10, p10), pts = [s.x, s.y]
  while (s.status === 'fly' && s.n < steps) {
    step(comp, s)
    if (s.n % every === 0 || s.status !== 'fly') pts.push(s.x, s.y)
  }
  return { pts, end: s.status, n: s.n }
}

/** How neat a docking was, from the arrival speed. */
export function landing(speed) {
  if (speed < 110) return { id: 'feather', name: 'Feather-soft', rank: 3 }
  if (speed < 190) return { id: 'neat', name: 'Neat', rank: 2 }
  if (speed < 290) return { id: 'firm', name: 'Firm', rank: 1 }
  return { id: 'thump', name: 'Thump', rank: 0 }
}

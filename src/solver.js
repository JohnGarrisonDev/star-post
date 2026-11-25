// Headless launch search, shared by the level tests, the design tools and the daily generator.
// It flies every launch on a grid of angle x power and counts which ones dock and which ones deliver everything.
// "Window" = how much of the angle/power space wins, in degree x power units (the whole space is 360 x 90 = 32400).
import { createFlight, step, puff, fly, isFull, P_MIN, P_MAX, STEPS_PER_SEC } from './physics.js'

/**
 * Grid search. Steps are in tenths (aStep 10 = 1 degree, pStep 10 = 1 power).
 * Returns { flights, dock, full, dockWindow, fullWindow, bestDock, bestFull, fulls } where best* = { a, p, n } (fastest)
 * and fulls = every winning launch [a, p, n] when keep is true.
 */
export function search(comp, { aStep = 10, pStep = 20, aMin = 0, aMax = 3599, pMin = P_MIN, pMax = P_MAX, keep = false } = {}) {
  const out = { flights: 0, dock: 0, full: 0, dockWindow: 0, fullWindow: 0, bestDock: null, bestFull: null, fulls: keep ? [] : null, docks: keep ? [] : null }
  const cell = (aStep / 10) * (pStep / 10)
  for (let a = aMin; a <= aMax; a += aStep) {
    for (let p = pMin; p <= pMax; p += pStep) {
      const a10 = ((a % 3600) + 3600) % 3600
      const s = fly(comp, a10, p)
      out.flights++
      if (s.status !== 'dock') continue
      out.dock++
      if (!out.bestDock || s.n < out.bestDock.n) out.bestDock = { a: a10, p, n: s.n }
      if (keep) out.docks.push([a10, p, s.n, s.nGot])
      if (s.nGot === comp.rings.length) {
        out.full++
        if (!out.bestFull || s.n < out.bestFull.n) out.bestFull = { a: a10, p, n: s.n }
        if (keep) out.fulls.push([a10, p, s.n])
      }
    }
  }
  out.dockWindow = out.dock * cell; out.fullWindow = out.full * cell
  return out
}

/** Winning window around one known launch, on a fine grid: how forgiving is this particular line? */
export function localWindow(comp, a10, p10, { aSpan = 60, pSpan = 80, aStep = 2, pStep = 5 } = {}) {
  let full = 0, dock = 0
  for (let a = a10 - aSpan; a <= a10 + aSpan; a += aStep) {
    for (let p = Math.max(P_MIN, p10 - pSpan); p <= Math.min(P_MAX, p10 + pSpan); p += pStep) {
      const s = fly(comp, ((a % 3600) + 3600) % 3600, p)
      if (s.status === 'dock') { dock++; if (s.nGot === comp.rings.length) full++ }
    }
  }
  const cell = (aStep / 10) * (pStep / 10)
  return { full, dock, fullWindow: full * cell, dockWindow: dock * cell }
}

const DIRS = [[1, 0], [0.7071, 0.7071], [0, 1], [-0.7071, 0.7071], [-1, 0], [-0.7071, -0.7071], [0, -1], [0.7071, -0.7071]]
/**
 * Search with one puff: for each launch on a (coarser) grid, try a puff every `tStep` seconds in 8 directions.
 * Returns the first/fastest full solution found: { a, p, puffs: [[n, dx, dy]], n } or null, plus a count.
 */
export function searchWithPuff(comp, { aStep = 30, pStep = 50, aMin = 0, aMax = 3599, pMin = P_MIN, pMax = P_MAX, tStep = 0.25, tMax = 12, stopAtFirst = false } = {}) {
  let best = null, count = 0
  const every = Math.max(1, Math.round(tStep * STEPS_PER_SEC)), last = Math.round(tMax * STEPS_PER_SEC)
  for (let a = aMin; a <= aMax; a += aStep) {
    for (let p = pMin; p <= pMax; p += pStep) {
      const base = createFlight(comp, a, p)
      while (base.status === 'fly' && base.n <= last) {
        if (base.n > 0 && base.n % every === 0) {
          for (const d of DIRS) {
            const s = { ...base, got: base.got.slice() }
            puff(comp, s, d[0], d[1])
            while (s.status === 'fly') step(comp, s)
            if (isFull(comp, s)) {
              count++
              if (!best || s.n < best.n) best = { a, p, puffs: [[base.n, d[0], d[1]]], n: s.n }
              if (stopAtFirst) return { best, count }
            }
          }
        }
        step(comp, base)
      }
    }
  }
  return { best, count }
}

/** Total turning of a launch's path in degrees (0 = dead straight). Used to reject boring daily systems. */
export function turning(comp, a10, p10) {
  const s = createFlight(comp, a10, p10)
  let turn = 0
  while (s.status === 'fly') {
    const vx = s.vx, vy = s.vy
    step(comp, s)
    const cross = vx * s.vy - vy * s.vx, dot = vx * s.vx + vy * s.vy
    const m = Math.sqrt((vx * vx + vy * vy) * (s.vx * s.vx + s.vy * s.vy))
    if (m > 1e-9 && dot > 0) { const sn = cross / m; turn += Math.abs(sn) * (1 + sn * sn / 6) * 57.29577951308232 }
  }
  return turn
}

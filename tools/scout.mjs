// Route scout (dev only): finds launches that stay in the field for a while and curve a lot, to build levels on.
//   node tools/scout.mjs <file.mjs exporting DRAFTS | levels> <index 1-based> [minSeconds=4] [top=8] [minTurn=0] [maxTurn=9999]
// It ignores the level's rings and dock, flies every launch on a 1 degree x 2 power grid and prints the curviest
// distinct ones with a position per second, so you can drop rings and a dock onto the path.
import { pathToFileURL } from 'node:url'
import { compileLevel, createFlight, step, FIELD } from '../src/physics.js'

const [file, idx, minS = '4', top = '8', minTurn = '0', maxTurn = '9999', need = ''] = process.argv.slice(2)
const mod = await import(pathToFileURL(file).href)
const list = mod.DRAFTS || mod.LEVELS
const lvl = { ...list[Number(idx) - 1], rings: [], dock: [-9999, -9999] }
const comp = compileLevel(lvl)
const res = []
for (let a = 0; a < 3600; a += 10) for (let p = 200; p <= 1000; p += 20) {
  const s = createFlight(comp, a, p), ev = []; s.ev = ev
  let turn = 0, n = 0
  const pts = []
  while (s.status === 'fly' && s.n < 14 * 120) {
    const vx = s.vx, vy = s.vy
    step(comp, s)
    if (s.x < 30 || s.x > FIELD.w - 30 || s.y < 30 || s.y > FIELD.h - 30) break
    const m = Math.sqrt((vx * vx + vy * vy) * (s.vx * s.vx + s.vy * s.vy))
    if (m > 0) turn += Math.abs(Math.asin(Math.max(-1, Math.min(1, (vx * s.vy - vy * s.vx) / m)))) * 57.3
    n = s.n
    if (n % 60 === 0) pts.push(`${Math.round(s.x)},${Math.round(s.y)}`)
  }
  if (s.status === 'crash') continue
  if (need && !ev.some((e) => ({ bounce: 'B', boost: 'G', warp: 'W' })[e.type] === need)) continue
  if (n / 120 >= Number(minS) && turn >= Number(minTurn) && turn <= Number(maxTurn)) res.push({ a, p, t: n / 120, turn, pts, evs: ev.filter((e) => e.type !== 'lost').map((e) => ({ bounce: 'B', boost: 'G', warp: 'W' })[e.type] || '').join('') })
}
// cluster size = neighbours with similar duration and turning (a proxy for a forgiving route)
for (const r of res) r.nb = res.filter((o) => Math.abs(o.a - r.a) <= 20 && Math.abs(o.p - r.p) <= 40 && Math.abs(o.turn - r.turn) < 25).length
res.sort((x, y) => (y.nb * 30 + y.turn) - (x.nb * 30 + x.turn))
const seen = [], out = []
for (const r of res) { if (seen.some((o) => Math.abs(o.a - r.a) <= 60 && Math.abs(o.p - r.p) <= 100)) continue; seen.push(r); out.push(r); if (out.length >= Number(top)) break }
console.log(`${lvl.name}: ${res.length} candidates`)
for (const r of out) console.log(`a ${r.a / 10} p ${r.p / 10}  ${r.t.toFixed(1)}s turn ${Math.round(r.turn)} nb ${r.nb} ${r.evs}\n    ${r.pts.join(' ')}`)

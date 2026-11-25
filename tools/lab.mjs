// Level design lab (dev only).
//   node tools/lab.mjs 7            search level 7 (1-based): windows, fastest lines, ASCII picture of the best line
//   node tools/lab.mjs 7 123.5 62   fly level 7 at 123.5 degrees, power 62: picture, events, positions every 0.5 s
//   node tools/lab.mjs 7 123.5 62 nograv|fine
// Use it to place rings and docks on a path you like, then re-run the search to check the window.
import { LEVELS } from '../src/levels.js'
import { compileLevel, createFlight, step, place, FIELD, STEPS_PER_SEC } from '../src/physics.js'
import { search, localWindow } from '../src/solver.js'

const [no, aArg, pArg, ...rest] = process.argv.slice(2)
const lvl = LEVELS[Number(no) - 1]
if (!lvl) { console.log('levels:', LEVELS.map((l, i) => `${i + 1} ${l.name}`).join(' | ')); process.exit(0) }
const comp = compileLevel(lvl)

export function picture(comp, a10, p10) {
  const W = 100, H = 32, g = Array.from({ length: H }, () => Array(W).fill(' '))
  const put = (x, y, c, soft) => { const cx = Math.floor(x / 10), cy = Math.floor(y / 20); if (cx >= 0 && cx < W && cy >= 0 && cy < H && !(soft && g[cy][cx] !== ' ')) g[cy][cx] = c }
  place(comp, 0)
  comp.bodies.forEach((b, i) => {
    for (let a = 0; a < 360; a += 4) { if (b.f) put(comp.px[i] + b.f * Math.cos(a / 57.3), comp.py[i] + b.f * Math.sin(a / 57.3), '.', true) }
    for (let rr = 0; rr <= b.r; rr += 5) for (let a = 0; a < 360; a += 6) put(comp.px[i] + rr * Math.cos(a / 57.3), comp.py[i] + rr * Math.sin(a / 57.3), b.kind === 'rubber' ? '%' : b.kind === 'star' ? '+' : b.kind === 'rock' ? '#' : '@')
  })
  comp.gates.forEach((q) => put(q.x, q.y, '>'))
  comp.worms.forEach((w, i) => put(w.x, w.y, 'wW'[i & 1]))
  const events = []
  if (a10 != null) {
    const s = createFlight(comp, a10, p10, events)
    while (s.status === 'fly') { step(comp, s); if (s.n % 3 === 0) put(s.x, s.y, s.n % 120 < 3 ? String(Math.floor(s.n / 120) % 10) : '*', false) }
    events.push({ end: s.status, why: s.why, t: (s.n / STEPS_PER_SEC).toFixed(2), got: s.nGot, speed: Math.round(s.dockSpeed) })
  }
  comp.rings.forEach((r, i) => put(r.x, r.y, String.fromCharCode(97 + i)))
  put(comp.dock.x, comp.dock.y, 'D'); put(comp.start.x, comp.start.y, 'S')
  return { text: '+' + '-'.repeat(W) + '+\n' + g.map((r) => '|' + r.join('') + '|').join('\n') + '\n+' + '-'.repeat(W) + '+', events }
}

if (aArg === undefined) {
  const t0 = Date.now()
  const r = search(comp, { aStep: 10, pStep: 10, keep: true })
  console.log(`${lvl.name}: ${r.flights} flights in ${Date.now() - t0} ms`)
  console.log(`dock window ${r.dockWindow}  full window ${r.fullWindow}  (deg x power)`)
  const fmt = (b) => b ? `${b.a / 10} deg, power ${b.p / 10}, ${(b.n / 120).toFixed(2)} s` : 'none'
  console.log('fastest dock:', fmt(r.bestDock), '| fastest full:', fmt(r.bestFull))
  // clusters of full solutions: group by rounded angle
  const groups = new Map()
  for (const [a, p, n] of r.fulls) { const k = Math.round(a / 100) * 10 + ':' + Math.round(p / 100) * 10; const g = groups.get(k) || { c: 0, a: 0, p: 0, n: 0 }; g.c++; g.a += a; g.p += p; g.n += n; groups.set(k, g) }
  const top = [...groups.entries()].sort((x, y) => y[1].c - x[1].c).slice(0, 8)
  for (const [, g] of top) console.log(`  full cluster: ${g.c} cells around ${(g.a / g.c / 10).toFixed(1)} deg, power ${(g.p / g.c / 10).toFixed(1)}, ~${(g.n / g.c / 120).toFixed(1)} s`)
  const dg = new Map()
  for (const [a, p, n, got] of r.docks) { const k = Math.round(a / 100) * 10 + ':' + Math.round(p / 100) * 10; const g = dg.get(k) || { c: 0, a: 0, p: 0, n: 0, got: 0 }; g.c++; g.a += a; g.p += p; g.n += n; g.got += got; dg.set(k, g) }
  for (const [, g] of [...dg.entries()].sort((x, y) => y[1].c - x[1].c).slice(0, 5)) console.log(`  dock cluster: ${g.c} cells around ${(g.a / g.c / 10).toFixed(1)} deg, power ${(g.p / g.c / 10).toFixed(1)}, ~${(g.n / g.c / 120).toFixed(1)} s, avg letters ${(g.got / g.c).toFixed(1)}`)
  const b = r.bestFull || r.bestDock
  if (b) console.log(picture(comp, b.a, b.p).text)
  else console.log(picture(comp).text)
} else {
  const a10 = Math.round(Number(aArg) * 10), p10 = Math.round(Number(pArg) * 10)
  const c2 = rest.includes('nograv') ? compileLevel(lvl, { noGravity: true }) : comp
  const pic = picture(c2, a10, p10)
  console.log(pic.text)
  console.log(pic.events.map((e) => JSON.stringify(e, (k, v) => typeof v === 'number' ? Math.round(v * 10) / 10 : v)).join('\n'))
  const s = createFlight(c2, a10, p10)
  const rows = []
  while (s.status === 'fly') { step(c2, s); if (s.n % 60 === 0) rows.push(`${(s.n / 120).toFixed(1)}s (${Math.round(s.x)},${Math.round(s.y)}) v${Math.round(Math.sqrt(s.vx * s.vx + s.vy * s.vy))}`) }
  console.log(rows.join('  '))
  if (rest.includes('fine')) console.log('local window:', localWindow(comp, a10, p10))
  void FIELD
}

// Star Post entry point: wires physics, renderer, UI, audio and save data together and owns the game flow.
import { C, makeStore, wireChrome, haptic } from '../kit/kit.js'
import { LEVELS, SECTORS } from './levels.js'
import { DT, STEPS_PER_SEC, LOST_STEPS, compileLevel, createFlight, step, puff, previewPath, landing, normA10, clampP10 } from './physics.js'
import { search } from './solver.js'
import { generateDaily } from './daily.js'
import { createRenderer, colIndex } from './render.js'
import { createUI } from './ui.js'
import { audio } from './audio.js'
import { dailyTalk, tellUs } from '../kit/talk.js'
import { SLUG, defaults, sanitize, levelKey, starRule, fmtT, isOpen, totalStars, frontier, recordDock, dateStr, dailyRec, dailyLaunch, dailyFlight, liveStreak, recentDays, shareText } from './save.js'

const stage = document.getElementById('stage'), canvas = document.getElementById('game')
const store = makeStore(SLUG, defaults())
{ const clean = sanitize(store.data, LEVELS); for (const k of Object.keys(store.data)) delete store.data[k]; Object.assign(store.data, clean) }
const data = store.data
const R = createRenderer(canvas), fx = R.fx
const TRAIL_MAX = 1700, TRAIL_EVERY = 3, ATTRACT = 9
const LETTER_COLS = [C.paper, C.yellow, C.pink, C.mint]

// G: everything about the current session that is not saved
const G = {
  mode: 'title', kind: 'campaign', i: 0, lvl: null, comp: null, key: '', date: null,
  phase: 'aim', flight: null, events: [], aim: { a10: 0, p10: 500, live: false }, preview: null, ghosts: [],
  trail: { x: new Float32Array(TRAIL_MAX), y: new Float32Array(TRAIL_MAX), c: new Uint8Array(TRAIL_MAX), n: 0 },
  acc: 0, fast: false, slow: false, aimBack: false, endT: 0, puffAim: null, flame: 0, sector: 0, quiet: false, pending: null,
}
const ui = createUI(stage, { onAction, onNudge, onFast: (on) => { G.fast = on } })
const sectorOf = (i) => Math.floor(i / 10)
const labelOf = () => (G.kind === 'daily' ? `Daily · ${G.date}` : `${sectorOf(G.i) + 1}-${(G.i % 10) + 1} · par ${fmtT(G.lvl.par)}`)

// ---------- levels
function setLevel(lvl) {
  G.lvl = lvl; G.comp = compileLevel(lvl); G.key = G.kind === 'daily' ? G.date : levelKey(lvl)
  G.phase = 'aim'; G.flight = null; G.trail.n = 0; G.ghosts = []; G.endT = 0; G.fast = false; G.slow = false; G.puffAim = null; G.pending = null
  fx.clear(); R.cam.snap = true
}
function loadLevel(kind, i) {
  G.mode = 'play'; G.kind = kind; G.i = i; G.quiet = false
  if (kind === 'daily') { G.date = dateStr(); setLevel(generateDaily(G.date)) } else setLevel(LEVELS[i])
  const saved = data.aims[G.key]
  if (saved) { G.aim.a10 = saved[0]; G.aim.p10 = saved[1]; G.ghosts = [ghostOf(saved[0], saved[1])] } // the last attempt, redrawn after a reload
  else { const dx = G.lvl.dock[0] - G.lvl.start[0], dy = G.lvl.dock[1] - G.lvl.start[1]; G.aim.a10 = normA10(Math.atan2(dy, dx) * 1800 / Math.PI / 10) * 10 % 3600; G.aim.p10 = 500 }
  G.aim.live = false
  store.set({ cur: { kind, i } })
  ui.hide()
  ui.hud({ show: true, label: labelOf(), name: G.lvl.name, daily: kind === 'daily' })
  ui.bar('aim'); aimChanged(false)
  ui.toast(G.lvl.hint, 5200)
  stats(); fit()
}
function ghostOf(a10, p10) { return Float32Array.from(previewPath(G.comp, a10, p10, G.comp.maxSteps, TRAIL_EVERY * 2).pts) }
function aimChanged(sound = true) {
  G.aim.a10 = normA10(G.aim.a10); G.aim.p10 = clampP10(G.aim.p10)
  G.preview = previewPath(G.comp, G.aim.a10, G.aim.p10)
  ui.aim(G.aim.a10, G.aim.p10)
  if (sound) audio.tick()
}
function stats() {
  const f = G.flight
  ui.stats({ letters: f ? f.nGot : 0, total: G.comp.rings.length, time: fmtT(f ? f.n / STEPS_PER_SEC : 0), tries: G.kind === 'daily' ? Math.max(1, dailyRec(data, G.date).tries + (G.phase === 'aim' && !dailyRec(data, G.date).done ? 1 : 0)) : null })
}

// ---------- flying
function launch() {
  if (G.mode !== 'play' || G.phase !== 'aim' || ui.screen) return
  G.events.length = 0
  G.flight = createFlight(G.comp, G.aim.a10, G.aim.p10, G.events)
  G.phase = 'fly'; G.trail.n = 0; G.acc = 0; G.flame = 1; G.aim.live = false
  data.aims[G.key] = [G.aim.a10, G.aim.p10]; data.launches++
  if (G.kind === 'daily') dailyLaunch(data, G.date)
  store.save()
  ui.toast('')
  ui.bar('fly', { puffs: G.flight.puffsLeft, puffsMax: G.comp.puffs })
  audio.launch(G.aim.p10 / 10); haptic(12)
  fx.burst(G.comp.start.x, G.comp.start.y, 'dot', 8, C.paper, 90)
  stats()
}
function retry() {
  if (G.mode !== 'play') return
  if (G.phase !== 'aim') {
    if (G.trail.n > 4) { const t = G.trail, pts = new Float32Array(Math.ceil(t.n / 2) * 2); for (let i = 0, k = 0; i < t.n; i += 2) { pts[k++] = t.x[i]; pts[k++] = t.y[i] } G.ghosts.unshift(pts); G.ghosts.length = Math.min(G.ghosts.length, 3) }
    G.phase = 'aim'; G.flight = null; G.trail.n = 0; G.endT = 0; G.puffAim = null; G.slow = false; G.pending = null
    ui.bar('aim'); aimChanged(false); stats()
  }
}
function doPuff(dx, dy) {
  if (G.phase !== 'fly' || !G.flight) return
  if (!G.comp.puffs) return
  if (!puff(G.comp, G.flight, dx, dy)) { audio.noPuff(); return }
  G.flame = 1
  ui.bar('fly', { puffs: G.flight.puffsLeft, puffsMax: G.comp.puffs })
}
function handleEvents() {
  const quiet = G.quiet
  for (const e of G.events) {
    if (e.type === 'deliver') { fx.pop('r' + e.i); fx.burst(e.x, e.y, 'letter', 7, LETTER_COLS, 150); fx.burst(e.x, e.y, 'star', 5, C.yellow, 110); if (!quiet) { audio.deliver(e.count); stats() } }
    else if (e.type === 'bounce') { fx.pop('b' + e.i); fx.burst(e.x, e.y, 'dot', 5, C.pink, 100); if (!quiet) audio.bounce(e.speed) }
    else if (e.type === 'boost') { fx.pop('g' + e.i); fx.burst(e.x, e.y, 'dot', 6, C.mint, 150); if (!quiet) audio.boost() }
    else if (e.type === 'warp') { fx.pop('w' + e.i); fx.burst(e.x, e.y, 'dot', 6, C.blue, 100); fx.burst(e.tx, e.ty, 'dot', 6, C.pink, 100); if (!quiet) audio.warp() }
    else if (e.type === 'puff') { fx.puff(e.x, e.y, e.dx, e.dy); if (!quiet) audio.puff() }
    else if (e.type === 'crash') { fx.burst(e.x, e.y, 'star', 9, [C.yellow, C.paper, C.orange], 150); fx.pop('b' + e.i); fx.shake(5); if (!quiet) { audio.bonk(); haptic(50) } }
    else if (e.type === 'lost') { if (!quiet) audio.lost() }
    else if (e.type === 'dock') { if (!quiet) haptic([15, 60, 15]); fx.burst(e.x, e.y, 'star', 10, [C.yellow, C.mint, C.paper], 170); fx.stamp(e.x, e.y, 'POSTED'); fx.shake(3) }
  }
  G.events.length = 0
}
function simStep() {
  const f = G.flight, t = G.trail
  step(G.comp, f)
  if (f.n % TRAIL_EVERY === 0 && t.n < TRAIL_MAX) { t.x[t.n] = f.x; t.y[t.n] = f.y; t.c[t.n] = colIndex(Math.sqrt(f.vx * f.vx + f.vy * f.vy)); t.n++ }
  if (G.events.length) handleEvents()
  if (f.status !== 'fly') flightEnded()
}
function flightEnded() {
  const f = G.flight, full = f.status === 'dock' && f.nGot === G.comp.rings.length, t = f.n / STEPS_PER_SEC
  G.fast = false; G.slow = false; G.puffAim = null
  if (G.mode === 'title') { G.phase = f.status === 'dock' ? 'docked' : 'crash'; G.endT = 1.6; return }
  if (f.status === 'dock') {
    G.phase = 'docked'; G.endT = 0.9
    const left = G.comp.rings.length - f.nGot
    if (G.kind === 'daily') {
      const wasDone = dailyRec(data, G.date).done
      const fresh = dailyFlight(data, G.date, { full, letters: f.nGot, t })
      store.save()
      audio.dock(full ? 3 : 1)
      if (fresh) G.pending = () => showDailyDone(true)
      else { ui.toast(full ? `Posted again in ${fmtT(t)}.` : `Docked, but ${left} ${left === 1 ? 'letter is' : 'letters are'} still aboard. Post them all, then dock.`, 3600); G.endT = 1.3; G.pending = retry }
      void wasDone
    } else {
      const res = recordDock(data, G.lvl, f.nGot, t)
      store.save()
      audio.dock(res.stars)
      G.pending = () => showResult(res, t, f)
    }
  } else {
    if (G.kind === 'daily') { dailyFlight(data, G.date, { full: false, letters: f.nGot, t }); store.save() }
    G.phase = f.status === 'crash' ? 'crash' : 'lost'; G.endT = f.status === 'crash' ? 0.75 : 1.0
    G.pending = retry
    if (f.status === 'lost') ui.toast(f.why === 'time' ? 'The battery ran flat. Try a shorter route.' : 'Lost in space. Stay inside the dotted border.', 2600)
  }
  ui.bar('fly', { puffs: 0, puffsMax: G.comp.puffs })
}
const QUIPS = {
  3: ['Signed, sealed, delivered, early.', 'The sorting robots are applauding. Quietly.', 'A beautiful curve. Frame that trail.'],
  2: ['Every letter posted. Now do it quicker.', 'All delivered. Par is still out there.', 'Full round. The clock was not impressed.'],
  1: ['Docked, but the mailbag is still full.', 'Home safe. The letters would like a word.', 'A landing. Next time, bring the post.'],
}
function showResult(res, t, f) {
  const total = G.comp.rings.length, hasNext = G.i + 1 < LEVELS.length, best = data.best[G.key]
  ui.result({
    label: `System ${sectorOf(G.i) + 1}-${(G.i % 10) + 1}`, name: G.lvl.name, stars: res.stars,
    title: res.stars === 3 ? 'First class!' : res.stars === 2 ? 'All posted' : total ? 'Docked' : 'Docked, a bit late',
    quip: total || res.stars === 3 ? QUIPS[res.stars][(G.i + f.n) % 3] : 'Safe and sound. Now beat the clock.',
    time: fmtT(t), par: fmtT(G.lvl.par), letters: f.nGot, total, landing: landing(f.dockSpeed).name,
    best: best && !res.newBest ? fmtT(best.t) : '', newBest: res.newBest, hasNext, rule: res.stars === 1 && total ? `post ${total === 1 ? 'the letter' : `all ${total} letters`} for 2 stars` : `beat ${fmtT(G.lvl.par)} for 3 stars`,
  })
  for (let k = 0; k < res.stars; k++) setTimeout(() => audio.star(k), 250 + k * 140)
}
function showDailyDone(fresh) {
  const rec = dailyRec(data, G.date)
  const talkEl = ui.dailyDone({ date: G.date, name: G.lvl.name, rec, total: G.comp.rings.length, streak: liveStreak(data, G.date), bestStreak: data.bestStreak, days: recentDays(data, G.date), fresh })
  // Anonymous difficulty vote and "you beat N%". Score follows the daily's own ranking: fewest launches, ties to the
  // shorter flight, so launches x 1000 + flight time in tenths (lower is better; flights end by 40 s).
  dailyTalk(talkEl, { game: 'star-post', key: G.date, score: Math.min(999, rec.launch) * 1000 + Math.min(999, Math.round(rec.t * 10)), compact: true })
}

// ---------- title and menus
function showTitle() {
  G.mode = 'title'; G.kind = 'campaign'; G.quiet = true
  store.set({ cur: null })
  setLevel(LEVELS[ATTRACT]); startAttract()
  ui.hud({ show: false }); ui.toast('')
  const today = dateStr(), nx = frontier(data, LEVELS)
  ui.title({ next: `${sectorOf(nx) + 1}-${(nx % 10) + 1} ${LEVELS[nx].name}`, stars: totalStars(data), maxStars: LEVELS.length * 3, today, rec: data.daily[today], streak: liveStreak(data, today), bestStreak: data.bestStreak, days: recentDays(data, today) })
}
function startAttract() { const s = G.lvl.sol; G.events.length = 0; G.flight = createFlight(G.comp, s[0], s[1], G.events); G.phase = 'fly'; G.trail.n = 0 }
function showLevels(sector = G.sector) {
  G.sector = sector
  const list = []
  for (let i = sector * 10; i < sector * 10 + 10 && i < LEVELS.length; i++) {
    const l = LEVELS[i], k = levelKey(l), b = data.best[k]
    list.push({ i, no: (i % 10) + 1, name: l.name, open: isOpen(data, LEVELS, i), stars: data.stars[k] || 0, best: b ? fmtT(b.t) : '', par: fmtT(l.par) })
  }
  ui.levels({ sectors: SECTORS, levels: list, sector })
}
function onAction(act, arg) {
  audio.click()
  if (act === 'play') loadLevel('campaign', frontier(data, LEVELS))
  else if (act === 'daily') { loadLevel('daily', 0); if (dailyRec(data, G.date).done) showDailyDone(false) }
  else if (act === 'levels') { if (G.mode === 'play') G.sector = sectorOf(G.i); showLevels() }
  else if (act === 'sector') showLevels(Number(arg))
  else if (act === 'level') { if (isOpen(data, LEVELS, Number(arg))) loadLevel('campaign', Number(arg)) }
  else if (act === 'title') showTitle()
  else if (act === 'menu') openMenu()
  else if (act === 'resume') { ui.hide(); if (G.mode !== 'play') showTitle(); else if (G.phase === 'docked' && !G.pending) retry() }
  else if (act === 'retry') { ui.hide(); retry() }
  else if (act === 'next') { if (G.i + 1 < LEVELS.length) loadLevel('campaign', G.i + 1); else showLevels() }
  else if (act === 'launch') launch()
  else if (act === 'puff') doPuff()
  else if (act === 'copy') copyResult()
}
function openMenu() {
  if (G.mode !== 'play') return
  if (ui.screen === 'menu') { ui.hide(); return }
  if (ui.screen) return
  ui.menu({ label: labelOf(), name: G.lvl.name, hint: G.lvl.hint, rule: G.kind === 'daily' ? 'Fewest launches to post every letter and dock. Ties go to the shorter flight.' : starRule(G.lvl), daily: G.kind === 'daily' })
}
function copyResult() {
  const text = shareText(G.date, dailyRec(data, G.date), G.comp.rings.length)
  const fallback = () => { try { const t = document.createElement('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0'; stage.appendChild(t); t.select(); const ok = document.execCommand('copy'); t.remove(); ui.copied(ok) } catch { ui.copied(false) } }
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => ui.copied(true), fallback)
  else fallback()
}
function onNudge(kind, repeat) {
  if (G.mode !== 'play' || G.phase !== 'aim' || ui.screen) return
  if (kind === 'a-') G.aim.a10 -= 5; else if (kind === 'a+') G.aim.a10 += 5
  else if (kind === 'p-') G.aim.p10 -= repeat ? 10 : 5; else if (kind === 'p+') G.aim.p10 += repeat ? 10 : 5
  aimChanged()
}

// ---------- input: pointer
// Press anywhere and pull back: the launch goes the other way, so the finger never sits on the aim line.
// Cancel a pull: bring the finger back to where it started (a bigger dead zone on touch), or touch with a second finger.
let pid = null, sx = 0, sy = 0, dead = 8
const maxPull = () => { const r = canvas.getBoundingClientRect(); return Math.max(110, Math.min(240, Math.min(r.width, r.height) * 0.42)) }
function cancelPointer() {
  if (pid === null) return
  try { canvas.releasePointerCapture(pid) } catch { /* not captured */ }
  pid = null
  if (G.phase === 'aim' && (G.aim.live || G.aimBack)) { G.aim.live = false; G.aimBack = false; aimChanged(false); ui.toast('Launch cancelled.', 1400) }
  else if (G.phase === 'fly' && G.slow) { G.slow = false; G.puffAim = null; ui.toast('Puff cancelled.', 1400) }
}
canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== undefined && e.button > 0) return
  if (G.mode !== 'play' || ui.screen) return
  if (pid !== null) { if (e.pointerId !== pid) { cancelPointer(); e.preventDefault() } return } // a second finger cancels
  if (G.phase === 'crash' || G.phase === 'lost') retry() // no waiting: grab and go again
  if (G.phase === 'docked') return
  pid = e.pointerId; sx = e.clientX; sy = e.clientY; dead = e.pointerType === 'mouse' ? 8 : 20; G.aimBack = false
  try { canvas.setPointerCapture(e.pointerId) } catch { /* synthetic events have no capture */ }
  if (G.phase === 'fly' && G.comp.puffs && G.flight.puffsLeft > 0) G.slow = true
  e.preventDefault()
})
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId !== pid) return
  const dx = e.clientX - sx, dy = e.clientY - sy, len = Math.hypot(dx, dy)
  if (G.phase === 'aim') {
    if (len < dead) { if (G.aim.live) { G.aim.live = false; G.aimBack = true } return }
    G.aimBack = false
    const d = R.toWorldDir(-dx, -dy)
    const a10 = normA10(Math.round(Math.atan2(d[1], d[0]) * 1800 / Math.PI / 5) * 5), p10 = clampP10(Math.round((100 + ((len - dead) / maxPull()) * 900) / 5) * 5)
    const changed = a10 !== G.aim.a10 || p10 !== G.aim.p10 || !G.aim.live
    G.aim.a10 = a10; G.aim.p10 = p10; G.aim.live = true
    if (changed) aimChanged()
  } else if (G.phase === 'fly' && G.slow) {
    if (len > 16) { const d = R.toWorldDir(dx, dy), m = Math.hypot(d[0], d[1]); G.puffAim = [d[0] / m, d[1] / m] } else G.puffAim = null
  }
})
const release = (e, fire) => {
  if (e.pointerId !== pid) return
  pid = null
  if (G.phase === 'aim') { const go = fire && G.aim.live; G.aim.live = false; G.aimBack = false; if (go) launch() }
  else if (G.phase === 'fly') { const pa = G.puffAim, was = G.slow; G.slow = false; G.puffAim = null; if (fire && was) { if (pa) doPuff(pa[0], pa[1]); else doPuff() } }
}
canvas.addEventListener('pointerup', (e) => release(e, true))
canvas.addEventListener('pointercancel', (e) => release(e, false))
canvas.addEventListener('lostpointercapture', (e) => release(e, false)) // no-op after pointerup (pid is already cleared)
canvas.addEventListener('contextmenu', (e) => e.preventDefault())

// ---------- input: keyboard
const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
  const onButton = e.target instanceof HTMLElement && e.target.closest('button, a')
  if (k === 'Escape') { if (G.mode === 'play') { if (ui.screen === 'menu' || !ui.screen) openMenu(); e.preventDefault() } return }
  if (G.mode !== 'play' || ui.screen) return
  if (onButton && (k === 'Enter' || k === ' ')) return
  if (k === 'r') { retry(); e.preventDefault(); return }
  if (k === 'f') { G.fast = true; e.preventDefault(); return }
  if (G.phase === 'crash' || G.phase === 'lost') { if (ARROWS[k] || k === ' ' || k === 'Enter') { retry(); e.preventDefault() } }
  if (G.phase === 'aim') {
    const fine = e.shiftKey
    if (k === 'ArrowLeft' || k === 'a') G.aim.a10 -= fine ? 1 : 10
    else if (k === 'ArrowRight' || k === 'd') G.aim.a10 += fine ? 1 : 10
    else if (k === 'ArrowUp' || k === 'w') G.aim.p10 += fine ? 1 : 10
    else if (k === 'ArrowDown' || k === 's') G.aim.p10 -= fine ? 1 : 10
    else if (k === ' ' || k === 'Enter') { if (!e.repeat) launch(); e.preventDefault(); return }
    else return
    aimChanged(); e.preventDefault()
  } else if (G.phase === 'fly') {
    if (k === ' ' || k === 'Enter') { if (!e.repeat) doPuff(); e.preventDefault() }
    else if (ARROWS[k]) { if (!e.repeat) { const d = R.toWorldDir(ARROWS[k][0], ARROWS[k][1]); doPuff(d[0], d[1]) } e.preventDefault() }
  }
})
window.addEventListener('keyup', (e) => { if (e.key.toLowerCase() === 'f') G.fast = false })

// ---------- main loop
let lastT = 0
function update(dt) {
  R.update(dt)
  G.flame = Math.max(0, G.flame - dt * 3)
  if (G.phase === 'fly' && G.flight && !(ui.screen && G.mode === 'play')) {
    G.acc += dt * (G.fast ? 4 : G.slow ? 0.3 : 1)
    let guard = 0
    while (G.acc >= DT && G.phase === 'fly' && guard++ < 60) { G.acc -= DT; simStep() }
    if (G.phase !== 'fly') G.acc = 0
    if (G.mode === 'play') stats()
  } else if (G.endT > 0 && !(ui.screen && G.mode === 'play')) {
    G.endT -= dt
    if (G.endT <= 0) { if (G.mode === 'title') startAttract(); else { const p = G.pending; G.pending = null; if (p) p() } }
  }
}
function view() {
  const f = G.flight
  return {
    comp: G.comp, n: f ? f.n : 0, flight: f, phase: G.phase, aim: G.aim, preview: G.phase === 'aim' && G.mode === 'play' ? G.preview : null,
    ghosts: G.ghosts, trail: G.trail, got: f ? f.got : null, nGot: f ? f.nGot : 0, alpha: G.phase === 'fly' ? G.acc : 0, flame: G.flame, puffAim: G.puffAim,
    warn: G.mode === 'play' && G.phase === 'fly' && f && f.out > 20 ? `Out of range: ${((LOST_STEPS - f.out) / STEPS_PER_SEC).toFixed(1)}s` : G.mode === 'play' && G.phase === 'fly' && G.slow ? 'Slow motion: let go to puff' : G.mode === 'play' && G.phase === 'aim' && G.aimBack ? 'Let go here to cancel' : '',
  }
}
function frame(now) {
  requestAnimationFrame(frame)
  if (document.hidden) { lastT = now; return }
  const dt = Math.min(0.05, Math.max(0, (now - lastT) / 1000)); lastT = now
  update(dt)
  R.draw(view())
}
document.addEventListener('visibilitychange', () => { lastT = performance.now(); G.fast = false; G.slow = false })
/** Re-fit the canvas and keep the camera clear of the HUD and the control bar (they grow by the safe areas in full screen). */
function fit() {
  R.resize()
  const c = canvas.getBoundingClientRect(), hud = stage.querySelector('.hud'), bar = stage.querySelector('.bar')
  R.insets.top = hud && !hud.hidden ? Math.max(8, hud.getBoundingClientRect().bottom - c.top + 4) : 50
  R.insets.bottom = bar && !bar.hidden ? Math.max(8, c.bottom - bar.getBoundingClientRect().top + 6) : 66
}
window.addEventListener('resize', fit)
if (typeof ResizeObserver === 'function') new ResizeObserver(fit).observe(stage)
document.addEventListener('fullscreenchange', fit)

wireChrome({ stage })
tellUs(document.getElementById('tell-us'), { game: 'star-post', issueUrl: 'https://github.com/JohnGarrisonDev/star-post/issues/new?template=feedback.yml' })
fit()
if (data.cur && (data.cur.kind === 'daily' || isOpen(data, LEVELS, data.cur.i))) { loadLevel(data.cur.kind, data.cur.i); if (G.kind === 'daily' && dailyRec(data, G.date).done) showDailyDone(false) } else showTitle()
requestAnimationFrame((t) => { lastT = t; frame(t) })

// ---------- debug hook (only with ?debug in the URL): drive the game without waiting for animation frames
if (new URLSearchParams(location.search).has('debug')) {
  window.__game = {
    G, data, ui, R,
    /** advance the game clock by `seconds` in 1/60 s frames and draw once */
    advance(seconds = 1) { const n = Math.round(seconds * 60); for (let i = 0; i < n; i++) update(1 / 60); R.draw(view()); return this.state() },
    state() { const f = G.flight; return { mode: G.mode, kind: G.kind, i: G.i, name: G.lvl && G.lvl.name, phase: G.phase, screen: ui.screen, aim: [G.aim.a10, G.aim.p10], t: f ? f.n / STEPS_PER_SEC : 0, got: f ? f.nGot : 0, status: f ? f.status : null, puffs: f ? f.puffsLeft : null, ghosts: G.ghosts.length, trail: G.trail.n } },
    goto(i) { loadLevel('campaign', i) }, daily() { loadLevel('daily', 0) }, title: showTitle, levels: showLevels,
    aim(a10, p10) { G.aim.a10 = a10; G.aim.p10 = p10; aimChanged(false) }, launch, retry, puff: doPuff, act: onAction,
    /** aim at a full-delivery launch (the designer's, else a search) */
    solve() { let s = G.lvl.sol; if (!s) { const r = search(G.comp, { aStep: 10, pStep: 10 }); s = r.bestFull ? [r.bestFull.a, r.bestFull.p] : null } if (s) this.aim(s[0], s[1]); return s },
    draw() { fit(); R.draw(view()) },
  }
}

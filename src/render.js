// Canvas renderer for Star Post: space, planets, mailboxes, the dock, the capsule, trails and particles.
// The world is FIELD.w x FIELD.h; on a portrait canvas the whole world is turned a quarter turn (world +x = screen up)
// so levels fill a phone. Sprites are always drawn upright; only directions go through the camera.
import { C, FONT, fitCanvas, drawOddFace } from '../kit/kit.js'
import { FIELD, CAP_R, GATE_R, WORM_R, place, rad10 } from './physics.js'

const PLANET_COLS = [C.orange, C.mint, C.blue, C.pink, C.yellow]
const SHADE = 'rgba(23,19,31,.22)'
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

// speed -> colour ramp for the trail (slow blue, then mint, yellow, orange, fast pink)
const STOPS = [[80, [91, 91, 255]], [140, [47, 214, 163]], [200, [255, 201, 60]], [270, [255, 91, 46]], [360, [255, 143, 199]]]
export const N_COLS = 24
export const TRAIL_COLS = Array.from({ length: N_COLS }, (_, i) => {
  const v = 80 + (280 * i) / (N_COLS - 1)
  let k = 0
  while (k < STOPS.length - 2 && v > STOPS[k + 1][0]) k++
  const [v0, a] = STOPS[k], [v1, b] = STOPS[k + 1], u = Math.max(0, Math.min(1, (v - v0) / (v1 - v0)))
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * u)},${Math.round(a[1] + (b[1] - a[1]) * u)},${Math.round(a[2] + (b[2] - a[2]) * u)})`
})
export const colIndex = (speed) => Math.max(0, Math.min(N_COLS - 1, Math.round(((speed - 80) / 280) * (N_COLS - 1))))

export function createRenderer(canvas) {
  const g = canvas.getContext('2d')
  let W = 1, H = 1, dpr = 1
  const insets = { top: 50, bottom: 66 }
  const cam = { rot: false, s: 1, fx: FIELD.w / 2, fy: FIELD.h / 2, cx: 0, cy: 0, ts: 1, tfx: FIELD.w / 2, tfy: FIELD.h / 2, snap: true, shx: 0, shy: 0 }
  let shake = 0, time = 0
  const stars = []
  { let a = 12345; const r = () => { a = (Math.imul(a, 1103515245) + 12345) | 0; return ((a >>> 8) & 0xffff) / 65536 }
    for (let i = 0; i < 80; i++) stars.push({ u: r(), v: r(), d: 0.15 + r() * 0.5, s: 0.7 + r() * 1.6, c: r() < 0.15 ? C.yellow : r() < 0.3 ? C.pink : C.paper, tw: r() * 6 }) }
  const parts = [] // { kind, x, y, vx, vy, life, max, col, rot, vr, size }
  const MAX_PARTS = 160
  const stamps = [] // { x, y, t, text }
  const pops = new Map() // body/ring index -> time left (squash animation)

  function resize() { const f = fitCanvas(canvas); W = f.w; H = f.h; dpr = f.dpr; cam.snap = true }
  const X = (wx, wy) => cam.cx + cam.shx + (cam.rot ? (wy - cam.fy) : (wx - cam.fx)) * cam.s
  const Y = (wx, wy) => cam.cy + cam.shy + (cam.rot ? -(wx - cam.fx) : (wy - cam.fy)) * cam.s
  const ang = (a) => (cam.rot ? a - Math.PI / 2 : a)
  /** screen delta -> world direction (not scaled) */
  const toWorldDir = (dx, dy) => (cam.rot ? [-dy, dx] : [dx, dy])

  function frame(focus) {
    cam.rot = H > W * 1.05
    cam.cx = W / 2; cam.cy = insets.top + (H - insets.top - insets.bottom) / 2
    const aw = W - 16, ah = H - insets.top - insets.bottom - 12
    let x0 = -10, x1 = FIELD.w + 10, y0 = -10, y1 = FIELD.h + 10
    if (focus) { const m = 70; x0 = Math.max(-900, Math.min(x0, focus.x - m)); x1 = Math.min(FIELD.w + 900, Math.max(x1, focus.x + m)); y0 = Math.max(-900, Math.min(y0, focus.y - m)); y1 = Math.min(FIELD.h + 900, Math.max(y1, focus.y + m)) }
    const fw = x1 - x0, fh = y1 - y0
    // Never let the scale reach zero or go negative (a hidden or collapsed stage is 1px tall), or canvas arcs throw.
    cam.ts = Math.max(0.01, cam.rot ? Math.min(aw / fh, ah / fw) : Math.min(aw / fw, ah / fh))
    cam.tfx = (x0 + x1) / 2; cam.tfy = (y0 + y1) / 2
    if (cam.snap) { cam.s = cam.ts; cam.fx = cam.tfx; cam.fy = cam.tfy; cam.snap = false }
  }
  function update(dt) {
    time += dt
    const k = 1 - Math.exp(-dt * 5)
    cam.s += (cam.ts - cam.s) * k; cam.fx += (cam.tfx - cam.fx) * k; cam.fy += (cam.tfy - cam.fy) * k
    if (shake > 0) { shake = Math.max(0, shake - dt * 18); cam.shx = (Math.random() - 0.5) * shake; cam.shy = (Math.random() - 0.5) * shake } else { cam.shx = cam.shy = 0 }
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i]
      p.life -= dt
      if (p.life <= 0) { parts[i] = parts[parts.length - 1]; parts.pop(); continue }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 1 - dt * 1.6; p.vy *= 1 - dt * 1.6; p.rot += p.vr * dt
    }
    for (let i = stamps.length - 1; i >= 0; i--) { stamps[i].t += dt; if (stamps[i].t > 1.6) stamps.splice(i, 1) }
    for (const [k2, v] of pops) { if (v - dt <= 0) pops.delete(k2); else pops.set(k2, v - dt) }
  }
  const fx = {
    burst(x, y, kind, n, col, speed = 120) {
      if (reduced()) n = Math.ceil(n / 3)
      for (let i = 0; i < n && parts.length < MAX_PARTS; i++) {
        const a = Math.random() * 6.283, v = speed * (0.35 + Math.random() * 0.75)
        parts.push({ kind, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.5 + Math.random() * 0.6, max: 1.1, col: Array.isArray(col) ? col[i % col.length] : col, rot: a, vr: (Math.random() - 0.5) * 8, size: 3 + Math.random() * 3 })
      }
    },
    puff(x, y, dx, dy) { for (let i = 0; i < 6 && parts.length < MAX_PARTS; i++) parts.push({ kind: 'dot', x, y, vx: -dx * (60 + Math.random() * 80) + (Math.random() - 0.5) * 50, vy: -dy * (60 + Math.random() * 80) + (Math.random() - 0.5) * 50, life: 0.35 + Math.random() * 0.25, max: 0.6, col: C.paper, rot: 0, vr: 0, size: 3 + Math.random() * 3 }) },
    stamp(x, y, text) { stamps.push({ x, y, t: 0, text }) },
    pop(key) { pops.set(key, 0.45) },
    shake(n) { if (!reduced()) shake = Math.min(7, Math.max(shake, n)) },
    clear() { parts.length = 0; stamps.length = 0; pops.clear() },
  }

  // ---------- pieces
  function starShape(x, y, r, points, inner, rot = 0) {
    g.beginPath()
    for (let i = 0; i < points * 2; i++) { const a = rot + (i * Math.PI) / points, rr = i % 2 ? r * inner : r; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) }
    g.closePath()
  }
  function drawBackground() {
    g.fillStyle = C.night; g.fillRect(0, 0, W, H)
    const still = reduced()
    for (const s of stars) {
      const ox = (cam.rot ? cam.fy : cam.fx) * s.d * cam.s * 0.25, oy = (cam.rot ? -cam.fx : cam.fy) * s.d * cam.s * 0.25
      const x = (((s.u * W - ox) % W) + W) % W, y = (((s.v * H - oy) % H) + H) % H
      g.globalAlpha = (0.25 + s.d * 0.7) * (still ? 1 : 0.75 + 0.25 * Math.sin(time * 1.3 + s.tw))
      g.fillStyle = s.c
      if (s.s > 1.9) { starShape(x, y, s.s * 2, 4, 0.35); g.fill() } else g.fillRect(x - s.s / 2, y - s.s / 2, s.s, s.s)
    }
    g.globalAlpha = 1
    // the edge of the delivery zone
    g.strokeStyle = 'rgba(167,157,181,.28)'; g.lineWidth = 1.5; g.setLineDash([3, 9])
    const xa = X(0, 0), ya = Y(0, 0), xb = X(FIELD.w, FIELD.h), yb = Y(FIELD.w, FIELD.h)
    g.strokeRect(Math.min(xa, xb), Math.min(ya, yb), Math.abs(xb - xa), Math.abs(yb - ya)); g.setLineDash([])
  }
  function drawField(b, x, y) {
    if (!b.mu) return
    const s = cam.s, push = b.mu < 0, col = push ? '255,201,60' : '251,246,236'
    g.fillStyle = `rgba(${col},.045)`; g.beginPath(); g.arc(x, y, b.f * s, 0, 7); g.fill()
    g.fillStyle = `rgba(${col},.04)`; g.beginPath(); g.arc(x, y, b.f0 * s, 0, 7); g.fill()
    g.strokeStyle = `rgba(${col},.3)`; g.lineWidth = 1.5; g.setLineDash([2, 7]); g.beginPath(); g.arc(x, y, b.f * s, 0, 7); g.stroke(); g.setLineDash([])
    // a ripple drifting in (pull) or out (push), so the direction is readable
    const n = Math.abs(b.m) >= 6 ? 3 : 2
    for (let i = 0; i < n; i++) {
      let u = reduced() ? (i + 0.5) / n : ((time * 0.16 + i / n) % 1)
      const rr = b.r + (b.f - b.r) * (push ? u : 1 - u)
      g.strokeStyle = `rgba(${col},${(0.2 * Math.sin(u * Math.PI)).toFixed(3)})`; g.lineWidth = 1.5
      g.beginPath(); g.arc(x, y, rr * s, 0, 7); g.stroke()
    }
  }
  function drawBody(b, i, x, y) {
    const s = cam.s, pop = pops.get('b' + i) || 0, sq = 1 + Math.sin(pop * 14) * pop * 0.5
    const r = b.r * s * sq
    if (b.kind === 'rock') {
      g.fillStyle = '#4a4058'; g.strokeStyle = C.muted; g.lineWidth = 1.5
      g.beginPath()
      for (let k = 0; k < 7; k++) { const a = (k / 7) * 6.283 + i, rr = r * (0.78 + 0.22 * Math.sin(i * 3.7 + k * 2.3)); g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) }
      g.closePath(); g.fill(); g.stroke()
      g.fillStyle = 'rgba(23,19,31,.35)'; g.beginPath(); g.arc(x - r * 0.2, y + r * 0.15, r * 0.22, 0, 7); g.fill()
      return
    }
    if (b.kind === 'star') {
      g.fillStyle = C.plum2; starShape(x + 3, y + 4, r * 1.45, 8, 0.62, time * 0.3); g.fill()
      g.fillStyle = C.yellow; starShape(x, y, r * 1.45, 8, 0.62, time * 0.3); g.fill()
      g.fillStyle = C.orange; g.beginPath(); g.arc(x, y, r * 0.62, 0, 7); g.fill()
      g.strokeStyle = C.ink; g.lineWidth = Math.max(1.5, r * 0.09); g.lineCap = 'round'
      g.beginPath(); g.moveTo(x - r * 0.3, y - r * 0.12); g.lineTo(x - r * 0.08, y - r * 0.02); g.moveTo(x + r * 0.3, y - r * 0.12); g.lineTo(x + r * 0.08, y - r * 0.02); g.moveTo(x - r * 0.16, y + r * 0.28); g.lineTo(x + r * 0.16, y + r * 0.28); g.stroke()
      return
    }
    const seed = Math.round(b.r * 3 + (b.orbit ? b.orbit.R : b.x * 0.7 + b.y * 1.3) + i * 5)
    const col = b.kind === 'rubber' ? C.pink : PLANET_COLS[[0, 1, 2, 4][seed % 4]]
    g.fillStyle = C.plum2; g.beginPath(); g.arc(x + 4, y + 5, r, 0, 7); g.fill()
    g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill()
    g.save(); g.beginPath(); g.arc(x, y, r, 0, 7); g.clip()
    g.fillStyle = SHADE; g.beginPath(); g.arc(x + r * 0.45, y + r * 0.5, r * 1.05, 0, 7); g.fill()
    if (b.kind === 'rubber') {
      g.strokeStyle = 'rgba(251,246,236,.75)'; g.lineWidth = Math.max(2, r * 0.09)
      g.beginPath(); g.arc(x, y, r * 0.72, 3.5, 4.9); g.stroke()
      g.beginPath(); g.arc(x, y, r * 0.72, 5.15, 5.4); g.stroke()
    } else {
      const feat = seed % 3
      if (feat === 0) { g.fillStyle = 'rgba(23,19,31,.2)'; for (const [cx, cy, cr] of [[-0.4, -0.3, 0.2], [0.25, 0.1, 0.28], [-0.2, 0.5, 0.14], [0.5, -0.5, 0.12]]) { g.beginPath(); g.arc(x + cx * r, y + cy * r, cr * r, 0, 7); g.fill() } }
      else if (feat === 1) { g.fillStyle = 'rgba(251,246,236,.3)'; g.fillRect(x - r, y - r * 0.5, 2 * r, r * 0.22); g.fillRect(x - r, y + r * 0.05, 2 * r, r * 0.34) }
      else { g.fillStyle = 'rgba(251,246,236,.28)'; g.beginPath(); g.arc(x - r * 0.5, y - r * 0.55, r * 0.5, 0, 7); g.fill() }
    }
    g.restore()
    if (b.kind === 'rubber') {
      g.strokeStyle = C.paper; g.lineWidth = 2; g.setLineDash([5, 5]); g.beginPath(); g.arc(x, y, r + 4, 0, 7); g.stroke(); g.setLineDash([])
      drawOddFace(g, x, y + r * 0.05, r * 0.95, { ink: C.ink, eye: C.paper })
    } else if (b.r >= 30) {
      const feat = seed % 5
      if (feat < 2) { // a sleepy eye
        g.strokeStyle = C.ink; g.lineWidth = Math.max(2, r * 0.07); g.lineCap = 'round'
        g.beginPath(); g.arc(x - r * 0.25, y - r * 0.05, r * 0.2, 0.2, Math.PI - 0.2); g.stroke()
        g.beginPath(); g.arc(x + r * 0.3, y - r * 0.05, r * 0.2, 0.2, Math.PI - 0.2); g.stroke()
      } else if (feat === 2) drawOddFace(g, x - r * 0.05, y, r * 0.9, { ink: C.ink, eye: C.paper })
      if (seed % 4 === 1) { // a ring round the middle
        g.strokeStyle = C.paper; g.lineWidth = Math.max(2, r * 0.1)
        g.beginPath(); g.ellipse(x, y + r * 0.1, r * 1.5, r * 0.34, -0.3, 0.25, Math.PI - 0.25); g.stroke()
      }
    }
  }
  function drawRing(r, i, got, ordered, next) {
    const x = X(r.x, r.y), y = Y(r.x, r.y), s = cam.s, rr = r.r * s, pop = pops.get('r' + i) || 0
    const k = 1 + Math.sin(pop * 16) * pop * 0.6
    g.lineWidth = Math.max(2.5, rr * 0.13)
    if (got) { g.strokeStyle = C.mint; g.globalAlpha = 0.55; g.beginPath(); g.arc(x, y, rr * k, 0, 7); g.stroke(); g.globalAlpha = 1 }
    else {
      g.strokeStyle = ordered && !next ? C.muted : C.yellow
      g.setLineDash([rr * 0.5, rr * 0.28]); g.lineDashOffset = reduced() ? 0 : -time * 14
      g.beginPath(); g.arc(x, y, rr, 0, 7); g.stroke(); g.setLineDash([]); g.lineDashOffset = 0
    }
    // the mailbox
    const m = Math.max(7, rr * 0.42) * k
    g.fillStyle = C.plum2; g.fillRect(x - m * 0.12 + 2, y + m * 0.3, m * 0.24, m * 0.9)
    g.fillStyle = C.muted; g.fillRect(x - m * 0.12, y + m * 0.3, m * 0.24, m * 0.8)
    g.fillStyle = got ? C.mint : C.blue
    g.beginPath(); g.moveTo(x - m, y + m * 0.45); g.lineTo(x - m, y - m * 0.1); g.arc(x - m * 0.45, y - m * 0.1, m * 0.55, Math.PI, Math.PI * 1.5); g.lineTo(x + m, y - m * 0.65); g.lineTo(x + m, y + m * 0.45); g.closePath(); g.fill()
    g.fillStyle = C.ink; g.fillRect(x - m * 0.75, y - m * 0.02, m * 0.6, m * 0.14)
    g.fillStyle = C.orange // the flag: up while waiting, down when posted
    if (got) g.fillRect(x + m * 0.35, y + m * 0.05, m * 0.6, m * 0.22)
    else { g.fillRect(x + m * 0.55, y - m * 1.2, m * 0.14, m * 0.9); g.fillRect(x + m * 0.55, y - m * 1.2, m * 0.5, m * 0.34) }
    if (ordered) {
      g.font = `800 ${Math.max(11, rr * 0.55)}px ${FONT.body}`; g.textAlign = 'center'; g.textBaseline = 'middle'
      const lx = x - rr * 0.8, ly = y - rr * 0.8, lr = Math.max(8, rr * 0.36)
      g.fillStyle = got ? C.mint : next ? C.yellow : C.muted; g.beginPath(); g.arc(lx, ly, lr, 0, 7); g.fill()
      g.fillStyle = C.ink; g.fillText(String(i + 1), lx, ly + 1)
    }
  }
  function drawDock(d, docked) {
    const x = X(d.x, d.y), y = Y(d.x, d.y), s = cam.s, r = d.r * s
    g.strokeStyle = docked ? C.mint : C.orange; g.lineWidth = 2; g.setLineDash([4, 6]); g.lineDashOffset = reduced() ? 0 : time * 10
    g.beginPath(); g.arc(x, y, r, 0, 7); g.stroke(); g.setLineDash([]); g.lineDashOffset = 0
    g.fillStyle = 'rgba(255,91,46,.1)'; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill()
    const u = Math.max(9, r * 0.5)
    g.fillStyle = C.plum2; g.fillRect(x - u * 1.1 + 3, y - u * 0.5 + 4, u * 2.2, u * 1.5)
    g.fillStyle = C.paper; g.fillRect(x - u * 1.1, y - u * 0.5, u * 2.2, u * 1.5)
    g.fillStyle = C.orange; g.beginPath(); g.moveTo(x - u * 1.35, y - u * 0.5); g.lineTo(x, y - u * 1.45); g.lineTo(x + u * 1.35, y - u * 0.5); g.closePath(); g.fill()
    g.fillStyle = C.ink; g.fillRect(x - u * 0.28, y + u * 0.2, u * 0.56, u * 0.8)
    g.fillStyle = C.blue; g.fillRect(x - u * 0.9, y - u * 0.2, u * 0.42, u * 0.42); g.fillRect(x + u * 0.48, y - u * 0.2, u * 0.42, u * 0.42)
    g.fillStyle = C.paper; g.font = `500 ${Math.max(7, u * 0.42)}px ${FONT.mono}`; g.textAlign = 'center'; g.textBaseline = 'middle'
    g.fillText('POST', x, y - u * 0.78)
  }
  function drawGate(q, i) {
    const x = X(q.x, q.y), y = Y(q.x, q.y), r = GATE_R * cam.s, pop = pops.get('g' + i) || 0
    const a = ang(q.deg * Math.PI / 180)
    g.save(); g.translate(x, y); g.rotate(a)
    g.fillStyle = 'rgba(47,214,163,.14)'; g.beginPath(); g.arc(0, 0, r * (1 + pop), 0, 7); g.fill()
    g.strokeStyle = C.mint; g.lineWidth = 2; g.beginPath(); g.arc(0, 0, r, 0, 7); g.stroke()
    g.lineWidth = Math.max(2.5, r * 0.16); g.lineCap = 'round'; g.lineJoin = 'round'
    const sl = reduced() ? 0 : ((time * 1.6) % 1) * r * 0.5
    for (let k = -1; k <= 1; k++) { const cx = k * r * 0.5 + sl - r * 0.25; g.globalAlpha = 1 - Math.abs(cx / r) * 0.9; g.beginPath(); g.moveTo(cx - r * 0.2, -r * 0.38); g.lineTo(cx + r * 0.18, 0); g.lineTo(cx - r * 0.2, r * 0.38); g.stroke() }
    g.restore(); g.globalAlpha = 1
  }
  function drawWorm(w, i) {
    const x = X(w.x, w.y), y = Y(w.x, w.y), r = WORM_R * cam.s, col = [C.blue, C.pink, C.mint][w.pair % 3], pop = pops.get('w' + i) || 0
    g.fillStyle = C.ink; g.beginPath(); g.arc(x, y, r * (1 + pop), 0, 7); g.fill()
    g.strokeStyle = col; g.lineCap = 'round'
    for (let k = 0; k < 3; k++) { const a = (reduced() ? 0 : time * (2.2 - k * 0.5)) + k * 2.1; g.lineWidth = Math.max(2, r * 0.16); g.beginPath(); g.arc(x, y, r * (1.05 - k * 0.28), a, a + 3.6); g.stroke() }
    g.fillStyle = col; g.font = `500 ${Math.max(9, r * 0.6)}px ${FONT.mono}`; g.textAlign = 'center'; g.textBaseline = 'middle'
    g.fillText('AB'[i & 1], x, y - r - Math.max(8, r * 0.5))
  }
  function capsuleSize() { return Math.max(CAP_R * 1.5 * cam.s, 8.5) }
  function drawCapsule(wx, wy, heading, { flame = 0, blink = false, sad = false } = {}) {
    const x = X(wx, wy), y = Y(wx, wy), r = capsuleSize()
    g.save(); g.translate(x, y); g.rotate(ang(heading))
    if (flame > 0) { g.fillStyle = C.yellow; g.beginPath(); g.moveTo(-r * 1.2, -r * 0.45); g.lineTo(-r * (1.9 + flame * (0.6 + Math.random() * 0.5)), 0); g.lineTo(-r * 1.2, r * 0.45); g.closePath(); g.fill() }
    g.fillStyle = C.pink // fins
    g.beginPath(); g.moveTo(-r * 0.5, -r * 0.7); g.lineTo(-r * 1.55, -r * 1.25); g.lineTo(-r * 1.2, -r * 0.2); g.closePath(); g.fill()
    g.beginPath(); g.moveTo(-r * 0.5, r * 0.7); g.lineTo(-r * 1.55, r * 1.25); g.lineTo(-r * 1.2, r * 0.2); g.closePath(); g.fill()
    g.fillStyle = C.orange // nose
    g.beginPath(); g.moveTo(r * 0.9, -r * 0.8); g.quadraticCurveTo(r * 2.2, 0, r * 0.9, r * 0.8); g.closePath(); g.fill()
    g.fillStyle = C.paper; g.strokeStyle = C.ink; g.lineWidth = Math.max(1.2, r * 0.12) // body
    g.beginPath(); g.ellipse(0, 0, r * 1.35, r * 0.95, 0, 0, 7); g.fill(); g.stroke()
    g.restore()
    g.fillStyle = '#fffdf8'; g.strokeStyle = C.ink; g.lineWidth = Math.max(1, r * 0.1)
    g.beginPath(); g.arc(x, y, r * 0.72, 0, 7); g.fill(); g.stroke()
    drawOddFace(g, x, y + r * 0.04, r * 1.05, { blink, look: sad ? -0.3 : 0.54, lookY: sad ? 0.8 : 0.38 })
  }
  function dots(pts, stride, radius, style, alpha, fade) {
    g.fillStyle = style
    const n = pts.length / 2
    for (let i = 0; i < n; i += stride) {
      g.globalAlpha = fade ? alpha * (1 - 0.75 * (i / n)) : alpha
      g.beginPath(); g.arc(X(pts[i * 2], pts[i * 2 + 1]), Y(pts[i * 2], pts[i * 2 + 1]), radius, 0, 7); g.fill()
    }
    g.globalAlpha = 1
  }
  function drawTrail(tr) {
    const n = tr.n, rad = Math.max(1.6, 2.6 * cam.s)
    for (let c = 0; c < N_COLS; c++) {
      let any = false
      for (let i = 0; i < n; i++) {
        if (tr.c[i] !== c) continue
        if (!any) { g.beginPath(); any = true }
        const x = X(tr.x[i], tr.y[i]), y = Y(tr.x[i], tr.y[i])
        g.moveTo(x + rad, y); g.arc(x, y, rad, 0, 7)
      }
      if (any) { g.fillStyle = TRAIL_COLS[c]; g.fill() }
    }
  }
  function drawParts() {
    for (const p of parts) {
      const x = X(p.x, p.y), y = Y(p.x, p.y), a = Math.min(1, p.life * 3), sz = p.size * Math.max(0.8, cam.s * 1.4)
      g.globalAlpha = a; g.fillStyle = p.col
      if (p.kind === 'star') { starShape(x, y, sz * 1.5, 4, 0.4, p.rot); g.fill() }
      else if (p.kind === 'letter') {
        g.save(); g.translate(x, y); g.rotate(p.rot); g.scale(1, Math.cos(p.rot * 2.5))
        g.fillStyle = C.paper; g.fillRect(-sz * 1.4, -sz, sz * 2.8, sz * 2)
        g.strokeStyle = p.col; g.lineWidth = 1.5; g.beginPath(); g.moveTo(-sz * 1.4, -sz); g.lineTo(0, sz * 0.2); g.lineTo(sz * 1.4, -sz); g.stroke(); g.restore()
      } else { g.beginPath(); g.arc(x, y, sz * 0.6, 0, 7); g.fill() }
    }
    g.globalAlpha = 1
    for (const st of stamps) {
      const x = X(st.x, st.y), y = Y(st.x, st.y) - 46 * Math.max(0.8, cam.s)
      const k = st.t < 0.14 ? 2.2 - (st.t / 0.14) * 1.2 : 1, a = st.t > 1.2 ? 1 - (st.t - 1.2) / 0.4 : 1
      g.save(); g.translate(x, y); g.rotate(-0.16); g.scale(k, k); g.globalAlpha = Math.max(0, a)
      g.font = `500 13px ${FONT.mono}`; g.textAlign = 'center'; g.textBaseline = 'middle'
      const w = g.measureText(st.text).width + 20
      g.strokeStyle = C.orange; g.lineWidth = 2.5; g.fillStyle = 'rgba(20,16,27,.8)'
      g.beginPath(); g.roundRect(-w / 2, -13, w, 26, 6); g.fill(); g.stroke()
      g.fillStyle = C.orange; g.fillText(st.text, 0, 1); g.restore()
    }
    g.globalAlpha = 1
  }

  /** Draw one frame. v: see main.js view(). */
  function draw(v) {
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    const comp = v.comp
    frame(v.flight && v.phase !== 'aim' ? v.flight : null)
    drawBackground()
    if (!comp) return
    place(comp, v.n)
    const B = comp.bodies
    // orbits of moving bodies
    for (const b of B) if (b.orbit) { g.strokeStyle = 'rgba(167,157,181,.35)'; g.lineWidth = 1.2; g.setLineDash([2, 6]); g.beginPath(); g.arc(X(b.orbit.cx, b.orbit.cy), Y(b.orbit.cx, b.orbit.cy), b.orbit.R * cam.s, 0, 7); g.stroke(); g.setLineDash([]) }
    for (let i = 0; i < B.length; i++) drawField(B[i], X(comp.px[i], comp.py[i]), Y(comp.px[i], comp.py[i]))
    for (let i = 0; i < comp.worms.length; i += 2) { // a faint thread between partners
      const a = comp.worms[i], b = comp.worms[i + 1]
      g.strokeStyle = 'rgba(167,157,181,.16)'; g.lineWidth = 1; g.setLineDash([1, 8]); g.beginPath(); g.moveTo(X(a.x, a.y), Y(a.x, a.y)); g.lineTo(X(b.x, b.y), Y(b.x, b.y)); g.stroke(); g.setLineDash([])
    }
    comp.worms.forEach(drawWorm)
    comp.gates.forEach(drawGate)
    // launch pad
    { const x = X(comp.start.x, comp.start.y), y = Y(comp.start.x, comp.start.y), r = capsuleSize() * 1.9
      g.strokeStyle = 'rgba(251,246,236,.45)'; g.lineWidth = 1.5; g.setLineDash([3, 5]); g.beginPath(); g.arc(x, y, r, 0, 7); g.stroke(); g.setLineDash([]) }
    // old attempts, faintest first
    for (let i = v.ghosts.length - 1; i >= 0; i--) dots(v.ghosts[i], 2, Math.max(1.3, 1.9 * cam.s), C.paper, [0.34, 0.17, 0.09][i] || 0.08, false)
    for (let i = 0; i < B.length; i++) drawBody(B[i], i, X(comp.px[i], comp.py[i]), Y(comp.px[i], comp.py[i]))
    const got = v.got, nGot = v.nGot
    comp.rings.forEach((r, i) => drawRing(r, i, got && got[i], comp.ordered, i === nGot))
    drawDock(comp.dock, v.phase === 'docked')
    if (v.trail && v.trail.n) drawTrail(v.trail)

    if (v.phase === 'aim') {
      const a = rad10(v.aim.a10), dx = Math.cos(a), dy = Math.sin(a), sx = comp.start.x, sy = comp.start.y
      if (v.preview) {
        dots(v.preview.pts, 1, Math.max(1.8, 2.6 * cam.s), C.paper, 0.95, true)
        const p = v.preview.pts, ex = X(p[p.length - 2], p[p.length - 1]), ey = Y(p[p.length - 2], p[p.length - 1])
        if (v.preview.end === 'crash') { g.strokeStyle = C.orange; g.lineWidth = 3; g.lineCap = 'round'; g.beginPath(); g.moveTo(ex - 6, ey - 6); g.lineTo(ex + 6, ey + 6); g.moveTo(ex + 6, ey - 6); g.lineTo(ex - 6, ey + 6); g.stroke() }
        else if (v.preview.end === 'dock') { g.strokeStyle = C.mint; g.lineWidth = 3; g.beginPath(); g.arc(ex, ey, 9, 0, 7); g.stroke() }
      }
      // the pulled-back band: longer = more power
      const len = (18 + (v.aim.p10 / 10) * 0.75) / cam.s, bx = sx - dx * len, by = sy - dy * len
      g.strokeStyle = v.aim.live ? C.orange : 'rgba(255,91,46,.6)'; g.lineWidth = 3; g.lineCap = 'round'
      g.beginPath(); g.moveTo(X(sx, sy), Y(sx, sy)); g.lineTo(X(bx, by), Y(bx, by)); g.stroke()
      g.fillStyle = C.orange; g.beginPath(); g.arc(X(bx, by), Y(bx, by), 5, 0, 7); g.fill()
      drawCapsule(sx, sy, a, { blink: Math.floor(time * 0.4) % 7 === 3 && (time * 0.4) % 1 < 0.12 })
    } else if (v.flight) {
      const f = v.flight
      if (v.phase === 'fly' || v.phase === 'docked') {
        const ix = f.x + f.vx * v.alpha, iy = f.y + f.vy * v.alpha
        drawCapsule(v.phase === 'docked' ? comp.dock.x : ix, v.phase === 'docked' ? comp.dock.y : iy, Math.atan2(f.vy, f.vx), { flame: v.flame })
        if (v.puffAim) { // where a swipe would push
          const x = X(ix, iy), y = Y(ix, iy), sdx = cam.rot ? v.puffAim[1] : v.puffAim[0], sdy = cam.rot ? -v.puffAim[0] : v.puffAim[1]
          g.strokeStyle = C.yellow; g.lineWidth = 3; g.lineCap = 'round'; g.beginPath(); g.moveTo(x + sdx * 16, y + sdy * 16); g.lineTo(x + sdx * 44, y + sdy * 44); g.stroke()
          g.fillStyle = C.yellow; g.beginPath(); g.arc(x + sdx * 44, y + sdy * 44, 5, 0, 7); g.fill()
        }
      } else if (v.phase === 'lost' || v.phase === 'crash') drawCapsule(f.x, f.y, Math.atan2(f.vy, f.vx) + (v.phase === 'lost' && !reduced() ? time * 3 : 0.5), { sad: true, blink: v.phase === 'crash' })
    }
    drawParts()
    if (v.warn) {
      g.font = `500 13px ${FONT.mono}`; g.textAlign = 'center'; g.textBaseline = 'middle'
      const w = g.measureText(v.warn).width + 22, x = W / 2, y = insets.top + 22
      g.fillStyle = C.yellow; g.beginPath(); g.roundRect(x - w / 2, y - 13, w, 26, 13); g.fill()
      g.fillStyle = C.ink; g.fillText(v.warn, x, y + 1)
    }
  }
  return { resize, update, draw, fx, toWorldDir, cam, insets, get size() { return { W, H } }, worldToScreen: (x, y) => [X(x, y), Y(x, y)] }
}

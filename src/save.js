// Save data and scoring rules for Star Post. DOM-free: the store is passed in, so node tests can use a fake one.
// Shape (all under localStorage "oddvale:star-post"):
//   v: 1
//   stars:  { [levelKey]: 1..3 }
//   best:   { [levelKey]: { t: seconds of the best full delivery (or best docking if never full), full: bool } }
//   aims:   { [levelKey | 'daily']: [a10, p10] }   last aim per level, so a reload resumes where you were
//   cur:    { kind: 'campaign'|'daily', i }        what was being played (resume on reload), or null
//   daily:  { [date]: { tries, done, launch, t, letters } }
//   streak, bestStreak, lastDaily
import { P_MIN, P_MAX } from './physics.js'

export const SLUG = 'star-post'
export const defaults = () => ({ v: 1, stars: {}, best: {}, aims: {}, cur: null, daily: {}, streak: 0, bestStreak: 0, lastDaily: null, launches: 0 })
export const levelKey = (lvl) => lvl.id || lvl.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')

const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o)
const int = (v, lo, hi, d) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d)
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Make any blob safe to use: wrong types fall back to defaults, numbers are clamped, unknown levels dropped. */
export function sanitize(raw, levels) {
  const d = defaults()
  if (!isObj(raw)) return d
  const keys = new Set(levels.map(levelKey))
  if (isObj(raw.stars)) for (const k of Object.keys(raw.stars)) if (keys.has(k)) { const n = int(raw.stars[k], 0, 3, 0); if (n) d.stars[k] = n }
  if (isObj(raw.best)) for (const k of Object.keys(raw.best)) {
    const b = raw.best[k]
    if (keys.has(k) && isObj(b) && Number.isFinite(b.t) && b.t > 0 && b.t < 1000) d.best[k] = { t: Math.round(b.t * 100) / 100, full: !!b.full }
  }
  if (isObj(raw.aims)) for (const k of Object.keys(raw.aims)) {
    const a = raw.aims[k]
    if ((keys.has(k) || k === 'daily' || DATE_RE.test(k)) && Array.isArray(a) && Number.isFinite(a[0]) && Number.isFinite(a[1])) d.aims[k] = [int(a[0], 0, 3599, 0), int(a[1], P_MIN, P_MAX, 500)]
  }
  if (isObj(raw.cur) && (raw.cur.kind === 'campaign' || raw.cur.kind === 'daily')) d.cur = { kind: raw.cur.kind, i: int(raw.cur.i, 0, levels.length - 1, 0) }
  if (isObj(raw.daily)) {
    const dates = Object.keys(raw.daily).filter((k) => DATE_RE.test(k) && isObj(raw.daily[k])).sort().slice(-400)
    for (const k of dates) {
      const r = raw.daily[k], tries = int(r.tries, 0, 9999, 0), done = !!r.done && tries > 0
      d.daily[k] = { tries, done, launch: done ? int(r.launch, 1, tries, tries) : 0, t: done && Number.isFinite(r.t) ? Math.max(0, Math.round(r.t * 10) / 10) : 0, letters: int(r.letters, 0, 9, 0) }
    }
  }
  d.streak = int(raw.streak, 0, 99999, 0); d.bestStreak = Math.max(d.streak, int(raw.bestStreak, 0, 99999, 0))
  d.lastDaily = typeof raw.lastDaily === 'string' && DATE_RE.test(raw.lastDaily) ? raw.lastDaily : null
  d.launches = int(raw.launches, 0, 1e9, 0)
  return d
}

/** Stars for a docking: 1 = docked, 2 = every letter posted, 3 = every letter and within par seconds. */
export function starsFor(lvl, nGot, tSec) {
  const n = (lvl.rings || []).length
  if (nGot < n) return 1
  return tSec <= lvl.par + 1e-9 ? 3 : 2
}
export const starRule = (lvl) => (lvl.rings || []).length
  ? `1 star: dock. 2 stars: post ${lvl.rings.length === 1 ? 'the letter' : `all ${lvl.rings.length} letters`}. 3 stars: all that inside ${fmtT(lvl.par)}.`
  : `1 star: dock. 3 stars: dock inside ${fmtT(lvl.par)}.`
export const fmtT = (t) => `${(Math.round(t * 10) / 10).toFixed(1)}s`

/** A level is open when the one before it is cleared, or the one before that (so you can always skip one). */
export function isOpen(data, levels, i) {
  if (i <= 1) return true
  return !!(data.stars[levelKey(levels[i - 1])] || data.stars[levelKey(levels[i - 2])])
}
export const totalStars = (data) => Object.values(data.stars).reduce((n, s) => n + s, 0)
/** First open level without a star (where "Play" should go), or the last level. */
export function frontier(data, levels) {
  for (let i = 0; i < levels.length; i++) if (!data.stars[levelKey(levels[i])]) return i
  return levels.length - 1
}

/** Record a docking. Returns { stars, newStars, newBest }. */
export function recordDock(data, lvl, nGot, tSec) {
  const k = levelKey(lvl), stars = starsFor(lvl, nGot, tSec), full = nGot >= (lvl.rings || []).length
  const old = data.stars[k] || 0, b = data.best[k]
  const improved = !b || (full && !b.full) || (full === b.full && tSec < b.t)
  if (improved) data.best[k] = { t: Math.round(tSec * 100) / 100, full }
  if (stars > old) data.stars[k] = stars
  return { stars, newStars: stars > old, newBest: improved && !!b, best: data.best[k] }
}

// ---- dates and the daily
export function dateStr(d = new Date()) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
export function prevDate(s) { const [y, m, d] = s.split('-').map(Number); return dateStr(new Date(y, m - 1, d - 1)) }

export function dailyRec(data, date) { return data.daily[date] || { tries: 0, done: false, launch: 0, t: 0, letters: 0 } }
/** Count a launch on today's daily (only until it is solved: after that it is free play). */
export function dailyLaunch(data, date) {
  const r = dailyRec(data, date)
  if (!r.done) r.tries++
  data.daily[date] = r
  return r
}
/** A flight ended on the daily. full = every letter and docked. Returns true when this finishes the day. */
export function dailyFlight(data, date, { full, letters, t }) {
  const r = dailyRec(data, date)
  data.daily[date] = r
  if (r.done) return false
  if (letters > r.letters) r.letters = letters
  if (!full) return false
  r.done = true; r.launch = Math.max(1, r.tries); r.t = Math.round(t * 10) / 10
  if (data.lastDaily !== date) {
    data.streak = data.lastDaily === prevDate(date) ? data.streak + 1 : 1
    data.lastDaily = date
    if (data.streak > data.bestStreak) data.bestStreak = data.streak
  }
  return true
}
/** The streak as of `today`: it is only alive if the last finished day is today or yesterday. */
export function liveStreak(data, today) { return data.lastDaily === today || data.lastDaily === prevDate(today) ? data.streak : 0 }
export function recentDays(data, today, n = 7) {
  const out = []
  let d = today
  for (let i = 0; i < n; i++) { out.unshift({ date: d, rec: data.daily[d] || null }); d = prevDate(d) }
  return out
}
export function shareText(date, rec, nRings) {
  return `Star Post ${date} · all ${nRings} letters · launch #${rec.launch} · ${rec.t.toFixed(1)}s\ngames.oddvale.com/star-post`
}

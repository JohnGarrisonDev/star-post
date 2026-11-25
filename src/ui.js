// DOM overlays inside the stage: HUD, the control bar, a hint toast, and the menu screens.
// Screens are plain HTML built from data; every button carries data-act and main.js handles the action.

const STAR = (on) => `<svg class="star${on ? ' on' : ''}" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6l2.9 6 6.5.9-4.7 4.6 1.1 6.5L12 17.5l-5.8 3.1 1.1-6.5L2.6 9.5l6.5-.9z"/></svg>`
export const starsHtml = (n) => `<span class="stars" role="img" aria-label="${n} of 3 stars">${STAR(n > 0)}${STAR(n > 1)}${STAR(n > 2)}</span>`
const MENU_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h14"/></svg>'
const LOCK = '<svg class="lock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>'
const ENV = '<svg class="env" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3.5 7.5 12 14l8.5-6.5"/></svg>'
const btn = (act, label, cls = '', arg = '') => `<button type="button" class="btn ${cls}" data-act="${act}"${arg !== '' ? ` data-arg="${arg}"` : ''}>${label}</button>`
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

export function createUI(stage, { onAction, onNudge, onFast }) {
  const el = (tag, cls, html = '') => { const n = document.createElement(tag); n.className = cls; n.innerHTML = html; stage.appendChild(n); return n }
  const hud = el('div', 'hud', `
    <div class="hud-id"><span class="hud-label" data-h="label"></span><span class="hud-name" data-h="name"></span></div>
    <div class="hud-right">
      <span class="hud-chip" data-h="trieschip" title="Launches today"><small>Launch</small><b data-h="tries">1</b></span>
      <span class="hud-chip" data-h="letterchip" title="Letters posted">${ENV}<b data-h="letters">0/0</b></span>
      <span class="hud-chip time"><b data-h="time">0.0s</b></span>
      <button type="button" class="hud-btn" data-act="menu" aria-label="Menu" title="Menu (Esc)">${MENU_ICON}</button>
    </div>`)
  const bar = el('div', 'bar', `
    <div class="bar-aim" data-b="aim">
      <div class="stepper" role="group" aria-label="Angle"><button type="button" data-nudge="a-" aria-label="Aim left">&#9664;</button><output data-b="angle">0&deg;</output><button type="button" data-nudge="a+" aria-label="Aim right">&#9654;</button></div>
      <div class="stepper" role="group" aria-label="Power"><button type="button" data-nudge="p-" aria-label="Less power">&minus;</button><output data-b="power">50</output><button type="button" data-nudge="p+" aria-label="More power">+</button></div>
      <button type="button" class="go" data-act="launch">Launch</button>
    </div>
    <div class="bar-fly" data-b="fly" hidden>
      <button type="button" class="pill" data-act="retry" title="Retry (R)">&#8634; Retry</button>
      <button type="button" class="pill puff" data-act="puff" data-b="puffbtn" title="Puff (Space)">Puff <span data-b="puffs"></span></button>
      <button type="button" class="pill" data-hold="fast" title="Hold to fast-forward (F)">&#9654;&#9654; Fast</button>
    </div>`)
  const toast = el('div', 'toast'); toast.setAttribute('aria-live', 'polite')
  const overlay = el('div', 'overlay')
  hud.hidden = true; bar.hidden = true; overlay.hidden = true
  const h = (k) => hud.querySelector(`[data-h="${k}"]`), b = (k) => bar.querySelector(`[data-b="${k}"]`)
  let screen = null, toastTimer = 0, repeat = 0, repeatDelay = 0

  const click = (e) => { const t = e.target.closest('[data-act]'); if (!t || t.disabled) return; onAction(t.dataset.act, t.dataset.arg) }
  hud.addEventListener('click', click); overlay.addEventListener('click', click); bar.addEventListener('click', click)
  for (const n of [hud, overlay, bar]) n.addEventListener('pointerdown', (e) => e.stopPropagation())
  // nudge buttons repeat while held; the fast button is hold-to-run
  const stopRepeat = () => { clearTimeout(repeatDelay); clearInterval(repeat); repeat = 0 }
  bar.addEventListener('pointerdown', (e) => {
    const n = e.target.closest('[data-nudge]'), f = e.target.closest('[data-hold="fast"]')
    if (n) { stopRepeat(); onNudge(n.dataset.nudge, false); repeatDelay = setTimeout(() => { repeat = setInterval(() => onNudge(n.dataset.nudge, true), 70) }, 330) }
    if (f) { onFast(true); f.classList.add('held') }
  })
  const up = () => { stopRepeat(); const f = bar.querySelector('[data-hold="fast"]'); if (f.classList.contains('held')) { f.classList.remove('held'); onFast(false) } }
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) bar.addEventListener(ev, up)
  window.addEventListener('blur', up)
  bar.addEventListener('keydown', (e) => { const n = e.target.closest('[data-nudge]'); if (n && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); onNudge(n.dataset.nudge, false) } })

  function show(name, html, { focus = '.btn.primary', wide = false, clear = false } = {}) {
    screen = name
    overlay.className = `overlay scr-${name}${clear ? ' clear' : ''}`
    overlay.innerHTML = `<div class="panel${wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-label="${name}">${html}</div>`
    overlay.hidden = false
    const f = overlay.querySelector(focus) || overlay.querySelector('button:not([disabled])')
    if (f) f.focus({ preventScroll: true })
  }
  const dayDots = (days, today) => `<div class="days" role="img" aria-label="Last ${days.length} days">${days.map((d) => `<span class="day${d.rec && d.rec.done ? ' done' : d.rec && d.rec.tries ? ' tried' : ''}${d.date === today ? ' today' : ''}"><i>${d.date.slice(8)}</i><b>${d.rec && d.rec.done ? '#' + d.rec.launch : d.rec && d.rec.tries ? '&middot;&middot;' : '&ndash;'}</b></span>`).join('')}</div>`

  const ui = {
    get screen() { return screen },
    hide() { screen = null; overlay.hidden = true; overlay.innerHTML = ''; if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur() },
    hud({ show: on, label, name, daily }) {
      hud.hidden = !on; bar.hidden = !on
      if (!on) return
      h('label').textContent = label; h('name').textContent = name
      h('trieschip').hidden = !daily
    },
    stats({ letters, total, time, tries }) {
      h('letters').textContent = `${letters}/${total}`; h('letterchip').hidden = !total
      h('letterchip').classList.toggle('all', total > 0 && letters >= total)
      h('time').textContent = time
      if (tries != null) h('tries').textContent = tries
    },
    aim(a10, p10) { b('angle').innerHTML = `${(((3600 - a10) % 3600) / 10).toFixed(1)}&deg;`; b('power').textContent = (p10 / 10).toFixed(1) },
    bar(mode, { puffs = 0, puffsMax = 0 } = {}) {
      b('aim').hidden = mode !== 'aim'; b('fly').hidden = mode === 'aim'
      const pb = b('puffbtn'); pb.hidden = !puffsMax; pb.disabled = puffs <= 0
      b('puffs').textContent = '●'.repeat(puffs) + '○'.repeat(Math.max(0, puffsMax - puffs))
    },
    toast(text, ms = 4200) {
      clearTimeout(toastTimer)
      toast.textContent = text || ''
      toast.classList.toggle('on', !!text)
      if (text && ms) toastTimer = setTimeout(() => toast.classList.remove('on'), ms)
    },

    title({ next, stars, maxStars, today, rec, streak, bestStreak, days, nRings }) {
      show('title', `
        <span class="eyebrow">Oddvale orbital post office</span>
        <h2 class="logo-title">Star <em>Post</em></h2>
        <p class="sub">One launch. Gravity does the rest.</p>
        <div class="btns col">
          ${btn('play', `${stars ? 'Continue' : 'Play'} <small>${next}</small>`, 'primary')}
          ${btn('daily', `Daily delivery <small>${rec && rec.done ? `done &middot; #${rec.launch}` : rec && rec.tries ? `${rec.tries} launched` : 'new today'}</small>`)}
          ${btn('levels', 'All systems', 'small')}
        </div>
        ${dayDots(days, today)}
        <p class="stats">${STAR(true)} ${stars}/${maxStars} <i>&middot;</i> Streak ${streak} <i>&middot;</i> Best ${bestStreak}</p>
        <p class="how">Press anywhere, pull back, let go. Or aim with <kbd>&larr;</kbd><kbd>&rarr;</kbd><kbd>&uarr;</kbd><kbd>&darr;</kbd> and launch with <kbd>Space</kbd>.</p>`, { clear: true })
      void nRings
    },
    levels({ sectors, levels, sector }) {
      const tabs = sectors.map((s, i) => `<button type="button" class="tab${i === sector ? ' on' : ''}" data-act="sector" data-arg="${i}">${i + 1}. ${esc(s.name)}</button>`).join('')
      const cells = levels.map((l) => `<button type="button" class="cell${l.open ? '' : ' locked'}" data-act="level" data-arg="${l.i}" ${l.open ? '' : 'disabled'} aria-label="${esc(l.name)}${l.open ? `, ${l.stars} of 3 stars` : ', locked'}">
          <span class="num">${l.no}</span><span class="nm">${esc(l.name)}</span>
          ${l.open ? `<span class="stars">${STAR(l.stars > 0)}${STAR(l.stars > 1)}${STAR(l.stars > 2)}</span><span class="bs">${l.best ? l.best : `par ${l.par}`}</span>` : LOCK}</button>`).join('')
      show('levels', `
        <span class="eyebrow">Sector ${sector + 1} of ${sectors.length}</span>
        <h2>${esc(sectors[sector].name)}</h2>
        <p class="sub">${esc(sectors[sector].blurb)}</p>
        <div class="tabs">${tabs}</div>
        <div class="grid">${cells}</div>
        <p class="note">Dock for 1 star, post every letter for 2, do it inside par for 3. Stuck? The system after it is open too.</p>
        <div class="btns">${btn('title', 'Back', 'small')}</div>`, { wide: true, focus: '.cell:not(.locked)' })
    },
    menu({ label, name, hint, rule, daily }) {
      show('menu', `
        <span class="eyebrow">Paused &middot; ${esc(label)}</span>
        <h2>${esc(name)}</h2>
        ${hint ? `<p class="sub">${esc(hint)}</p>` : ''}
        ${rule ? `<p class="note">${esc(rule)}</p>` : ''}
        <div class="btns col">
          ${btn('resume', 'Back to it', 'primary')}
          ${daily ? '' : btn('levels', 'All systems')}
          ${btn('title', 'Quit to title')}
        </div>
        <p class="how"><kbd>R</kbd> retry &middot; hold <kbd>F</kbd> fast-forward &middot; <kbd>Space</kbd> launch, then puff &middot; <kbd>Shift</kbd> fine aim</p>`)
    },
    result({ label, name, stars, title, quip, time, par, letters, total, landing, best, newBest, hasNext, nextOpen, rule }) {
      show('result', `
        <span class="eyebrow">${esc(label)} &middot; ${esc(name)}</span>
        <h2>${esc(title)}</h2>
        ${starsHtml(stars)}
        <p class="score"><b>${time}</b> ${total ? `<i>&middot;</i> ${letters}/${total} letters` : ''} <i>&middot;</i> ${esc(landing)} landing</p>
        <p class="sub">${esc(quip)}</p>
        <p class="note">${newBest ? '<span class="tag">New best</span> ' : best ? `Best ${best} &middot; ` : ''}par ${par}${stars < 3 ? ` &middot; ${esc(rule)}` : ''}</p>
        <div class="btns col">
          ${hasNext ? btn('next', 'Next system', stars >= 2 ? 'primary' : '', '') : ''}
          ${btn('retry', stars >= 3 ? 'Fly it again' : 'Try for more stars', stars >= 2 && hasNext ? '' : 'primary')}
          ${btn('levels', 'All systems', 'small')}
        </div>`)
      void nextOpen
    },
    dailyDone({ date, name, rec, total, streak, bestStreak, days, fresh }) {
      show('daily', `
        <span class="eyebrow">Daily delivery &middot; ${date}</span>
        <h2>${fresh ? 'Posted!' : 'Already posted'}</h2>
        <p class="score"><b>Launch #${rec.launch}</b> <i>&middot;</i> ${rec.t.toFixed(1)}s <i>&middot;</i> all ${total} letters</p>
        <p class="sub">${esc(name)} is done for today. A new system arrives at midnight.</p>
        ${dayDots(days, date)}
        <p class="stats">Streak ${streak} <i>&middot;</i> Best ${bestStreak}</p>
        <div class="btns col">
          ${btn('copy', 'Copy result', 'primary')}
          ${btn('resume', 'Keep flying <small>for fun</small>')}
          ${btn('title', 'Back to title', 'small')}
        </div>`)
    },
    copied(ok) { const c = overlay.querySelector('[data-act="copy"]'); if (c) c.textContent = ok ? 'Copied!' : 'Could not copy' },
  }
  return ui
}

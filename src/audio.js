// Star Post sounds: all synthesised through the kit's sfx (no audio files). Soft and round, never harsh.
import { sfx } from '../kit/kit.js'

const last = {}
/** Rate limit: at most one play of `id` every `ms`. */
const ok = (id, ms) => { const t = Date.now(); if (t - (last[id] || 0) < ms) return false; last[id] = t; return true }
const CHIME = [523.25, 659.25, 783.99, 1046.5, 1318.5] // rising notes, one per letter posted

export const audio = {
  tick() { if (ok('tick', 55)) sfx.tone({ freq: 880, dur: 0.025, type: 'sine', vol: 0.05 }) },
  click() { if (ok('click', 40)) sfx.tone({ freq: 520, dur: 0.05, type: 'triangle', vol: 0.12 }) },
  launch(power) {
    sfx.noise({ dur: 0.32, vol: 0.16, freq: 500 + power * 14, slide: 2600 })
    sfx.tone({ freq: 150 + power * 2, slide: 420 + power * 5, dur: 0.24, type: 'triangle', vol: 0.16 })
  },
  puff() { if (!ok('puff', 60)) return; sfx.noise({ dur: 0.14, vol: 0.16, freq: 2400, slide: 600 }); sfx.tone({ freq: 620, slide: 880, dur: 0.08, type: 'sine', vol: 0.1 }) },
  noPuff() { if (ok('nopuff', 200)) sfx.tone({ freq: 170, dur: 0.08, type: 'triangle', vol: 0.1 }) },
  deliver(count) {
    const f = CHIME[Math.min(CHIME.length - 1, count - 1)]
    sfx.tone({ freq: f, dur: 0.3, type: 'sine', vol: 0.2 }); sfx.tone({ freq: f * 1.5, dur: 0.38, type: 'sine', vol: 0.12, delay: 0.07 })
    sfx.noise({ dur: 0.1, vol: 0.06, freq: 4000 })
  },
  wrongOrder() { if (ok('wrong', 400)) sfx.tone({ freq: 260, slide: 200, dur: 0.12, type: 'triangle', vol: 0.1 }) },
  bounce(speed) { if (!ok('bounce', 70)) return; sfx.tone({ freq: 160 + Math.min(260, speed), slide: 330 + Math.min(400, speed * 1.4), dur: 0.16, type: 'sine', vol: 0.2 }) },
  boost() { if (!ok('boost', 90)) return; sfx.tone({ freq: 330, slide: 990, dur: 0.18, type: 'sawtooth', vol: 0.07 }); sfx.noise({ dur: 0.18, vol: 0.1, freq: 900, slide: 5000 }) },
  warp() { if (!ok('warp', 90)) return; sfx.tone({ freq: 880, slide: 180, dur: 0.16, type: 'sine', vol: 0.14 }); sfx.tone({ freq: 180, slide: 880, dur: 0.18, type: 'sine', vol: 0.14, delay: 0.1 }) },
  bonk() { sfx.tone({ freq: 190, slide: 70, dur: 0.22, type: 'sine', vol: 0.28 }); sfx.noise({ dur: 0.08, vol: 0.1, freq: 500 }); sfx.tone({ freq: 620, slide: 500, dur: 0.1, type: 'triangle', vol: 0.07, delay: 0.16 }) },
  lost() { sfx.tune([[392, 0.14], [330, 0.14], [262, 0.26]], { type: 'sine', vol: 0.14 }) },
  dock(stars) {
    sfx.tone({ freq: 110, slide: 60, dur: 0.16, type: 'sine', vol: 0.34 }); sfx.noise({ dur: 0.07, vol: 0.2, freq: 700 }) // the stamp thunk
    const tunes = { 1: [[523, 0.1], [659, 0.18]], 2: [[523, 0.1], [659, 0.1], [784, 0.2]], 3: [[523, 0.09], [659, 0.09], [784, 0.09], [1047, 0.12], [784, 0.08], [1047, 0.28]] }
    setTimeout(() => sfx.tune(tunes[stars] || tunes[1], { type: 'triangle', vol: 0.17 }), 170)
  },
  star(i) { sfx.tone({ freq: 700 + i * 180, dur: 0.12, type: 'triangle', vol: 0.12 }) },
}

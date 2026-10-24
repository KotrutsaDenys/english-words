/*
 * FSRS-5: планувальник повторень (той самий, що в Anki).
 * Для кожного слова тримає стабільність S (за скільки днів імовірність згадати впаде до 90%)
 * і складність D (1..10). Оцінки: 1 не знаю, 2 важко, 3 знаю, 4 легко.
 * Параметри: типові для FSRS-5 (open-spaced-repetition).
 */
(function (root) {
  'use strict';

  const W = [0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192,
    1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621];
  const DECAY = -0.5;
  const FACTOR = 19 / 81;
  const S_MIN = 0.1;
  const MAX_IVL = 3650;

  const clampD = d => Math.min(10, Math.max(1, d));

  function retrievability(t, s) {
    if (!(s > 0)) return 0;
    return Math.pow(1 + FACTOR * Math.max(0, t) / s, DECAY);
  }
  function rawInterval(s, retention) {
    return s / FACTOR * (Math.pow(retention, 1 / DECAY) - 1);
  }
  function initStability(g) { return Math.max(S_MIN, W[g - 1]); }
  function initDifficulty(g) { return clampD(W[4] - Math.exp(W[5] * (g - 1)) + 1); }
  function nextDifficulty(d, g) {
    const delta = -W[6] * (g - 3);
    const damped = d + delta * (10 - d) / 9;
    return clampD(W[7] * initDifficulty(4) + (1 - W[7]) * damped);
  }
  function recallStability(d, s, r, g) {
    const hard = g === 2 ? W[15] : 1;
    const easy = g === 4 ? W[16] : 1;
    return s * (1 + Math.exp(W[8]) * (11 - d) * Math.pow(s, -W[9]) * (Math.exp(W[10] * (1 - r)) - 1) * hard * easy);
  }
  function forgetStability(d, s, r) {
    const sf = W[11] * Math.pow(d, -W[12]) * (Math.pow(s + 1, W[13]) - 1) * Math.exp(W[14] * (1 - r));
    return Math.max(S_MIN, Math.min(sf, s));
  }
  function shortTermStability(s, g) {
    return Math.max(S_MIN, s * Math.exp(W[17] * (g - 3 + W[18])));
  }

  /* Перша оцінка нового слова */
  function init(g) {
    return { s: initStability(g), d: initDifficulty(g) };
  }

  /* Наступний стан після оцінки g. t: скільки днів минуло від попереднього повторення */
  function next(state, g, t) {
    const s = state.s, d = state.d;
    if (t <= 0) return { s: shortTermStability(s, g), d: nextDifficulty(d, g) };
    const r = retrievability(t, s);
    const ns = g === 1 ? forgetStability(d, s, r) : recallStability(d, s, r, g);
    return { s: Math.max(S_MIN, ns), d: nextDifficulty(d, g) };
  }

  /* Інтервал у днях під бажане запам'ятовування; fuzz розкидає слова, щоб не збивалися в один день */
  function interval(s, retention, rng) {
    let ivl = Math.round(rawInterval(s, retention || 0.9));
    ivl = Math.min(MAX_IVL, Math.max(1, ivl));
    if (rng && ivl >= 3) {
      let delta = 1;
      const ranges = [[2.5, 7, 0.15], [7, 20, 0.1], [20, Infinity, 0.05]];
      for (const [lo, hi, f] of ranges) delta += f * Math.max(0, Math.min(ivl, hi) - lo);
      const lo = Math.max(2, Math.round(ivl - delta));
      const hi = Math.min(MAX_IVL, Math.round(ivl + delta));
      ivl = Math.floor(rng() * (hi - lo + 1)) + lo;
    }
    return ivl;
  }

  const api = { W, DECAY, FACTOR, retrievability, interval, init, next, initStability, initDifficulty,
    nextDifficulty, recallStability, forgetStability, shortTermStability };
  root.FSRS = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

/*
 * Логіка без інтерфейсу: дати, перевірка відповідей, речення з пропуском,
 * вибір вправи, розклад повторень і рушій сесії. Працює і в браузері, і в node (для тестів).
 */
(function (root) {
  'use strict';
  const F = root.FSRS || (typeof require !== 'undefined' ? require('./fsrs.js') : null);

  /* ---------- Дати: локальний день як ціле число ---------- */
  function dayNum(d) { d = d || new Date(); return Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / 86400000); }
  function dayKey(n) { return new Date(n * 86400000).toISOString().slice(0, 10); }
  function fmtDate(n) { const [y, m, d] = dayKey(n).split('-'); return d + '.' + m + '.' + y; }

  /* ---------- Українська множина ---------- */
  function plural(n, one, few, many) {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 15) return many;
    if (b === 1) return one;
    if (b >= 2 && b <= 4) return few;
    return many;
  }

  /* ---------- Порівняння відповідей ---------- */
  const CONTRACTIONS = [
    [/\bi'm\b/g, 'i am'], [/\byou're\b/g, 'you are'], [/\bwe're\b/g, 'we are'], [/\bthey're\b/g, 'they are'],
    [/\bit's\b/g, 'it is'], [/\bthat's\b/g, 'that is'], [/\bwhat's\b/g, 'what is'], [/\bwhere's\b/g, 'where is'],
    [/\bthere's\b/g, 'there is'], [/\bhe's\b/g, 'he is'], [/\bshe's\b/g, 'she is'], [/\bwho's\b/g, 'who is'],
    [/\bhow's\b/g, 'how is'], [/\bi'll\b/g, 'i will'], [/\byou'll\b/g, 'you will'], [/\bwe'll\b/g, 'we will'],
    [/\bit'll\b/g, 'it will'], [/\bi've\b/g, 'i have'], [/\bwe've\b/g, 'we have'], [/\bi'd\b/g, 'i would'],
    [/\bcan't\b/g, 'cannot'], [/\bwon't\b/g, 'will not'], [/\bdon't\b/g, 'do not'], [/\bdoesn't\b/g, 'does not'],
    [/\bdidn't\b/g, 'did not'], [/\bisn't\b/g, 'is not'], [/\baren't\b/g, 'are not'], [/\bwasn't\b/g, 'was not'],
    [/\bhaven't\b/g, 'have not'], [/\bhasn't\b/g, 'has not'], [/\bcouldn't\b/g, 'could not'], [/\bshouldn't\b/g, 'should not'],
    [/\blet's\b/g, 'let us'], [/\bc'mere\b/g, 'come here'], [/\bcan not\b/g, 'cannot']
  ];
  function norm(s) {
    return String(s || '').toLowerCase()
      .replace(/[’‘`´]/g, "'")
      .replace(/\.\.\.|…/g, ' ')
      .replace(/[.,!?;:"“”()\[\]]/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }
  function expand(s) { let r = s; for (const [rx, to] of CONTRACTIONS) r = r.replace(rx, to); return r; }
  function forms(s) {
    const n = norm(s);
    return [n.replace(/'/g, ''), expand(n).replace(/'/g, '')];
  }
  function answerTargets(en) {
    const base = norm(en);
    const out = new Set([en]);
    if (base.startsWith('to ')) out.add(base.slice(3));
    const art = base.replace(/^(the|a|an) /, '');
    if (art !== base) out.add(art);
    return Array.from(out);
  }
  function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[b.length];
  }
  /* Позначити в написаному літери, яких не має бути (для показу помилки) */
  function diffMarks(input, target) {
    const a = String(input), b = String(target);
    const al = a.toLowerCase(), bl = b.toLowerCase();
    const n = a.length, m = b.length;
    const d = Array.from({ length: n + 1 }, (_, i) => { const r = new Array(m + 1).fill(0); r[0] = i; return r; });
    for (let j = 0; j <= m; j++) d[0][j] = j;
    for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (al[i - 1] === bl[j - 1] ? 0 : 1));
    }
    const marks = new Array(n).fill(true);
    let i = n, j = m;
    while (i > 0 && j > 0) {
      if (d[i][j] === d[i - 1][j - 1] + (al[i - 1] === bl[j - 1] ? 0 : 1)) { marks[i - 1] = al[i - 1] === bl[j - 1]; i--; j--; }
      else if (d[i][j] === d[i - 1][j] + 1) { marks[i - 1] = false; i--; }
      else j--;
    }
    while (i > 0) { marks[i - 1] = false; i--; }
    return a.split('').map((ch, k) => ({ ch, ok: marks[k] }));
  }
  /* result: exact | typo | wrong */
  function checkAnswer(input, targets) {
    const inForms = forms(input);
    if (!inForms[0]) return { result: 'wrong', target: targets[0] };
    let best = { result: 'wrong', target: targets[0], dist: Infinity };
    for (const t of targets) {
      const tf = forms(t);
      if (inForms.some(f => tf.includes(f))) return { result: 'exact', target: t, dist: 0 };
      for (const a of inForms) for (const b of tf) {
        const d = levenshtein(a, b);
        if (d < best.dist) best = { result: 'wrong', target: t, dist: d, len: b.length };
      }
    }
    const allowed = best.len <= 3 ? 0 : best.len <= 7 ? 1 : 2;
    if (best.dist <= allowed) best.result = 'typo';
    return best;
  }

  /* Граматика перевіряється точно: апостроф важливий (its ≠ it's), друкарська помилка — помилка.
     Скорочення розгортаються в обидва боки (weren't = were not, 've been = have been, 's = is або has). */
  function gNorm(s) {
    return String(s || '').toLowerCase().replace(/[’‘`´]/g, "'").replace(/[.,!?;:"“”()]/g, ' ')
      .replace(/\s+'/g, " '").replace(/\s+/g, ' ').trim();
  }
  function gVariants(s) {
    let t = ' ' + gNorm(s) + ' ';
    t = t.replace(/\bwon't\b/g, 'will not').replace(/\bcan't\b/g, 'cannot').replace(/\bshan't\b/g, 'shall not')
      .replace(/\b(\w+)n't\b/g, '$1 not').replace(/\bcan not\b/g, 'cannot').replace(/\blet's\b/g, 'let us')
      .replace(/(\w|^|\s)'m\b/g, '$1 am').replace(/(\w|^|\s)'re\b/g, '$1 are').replace(/(\w|^|\s)'ve\b/g, '$1 have')
      .replace(/(\w|^|\s)'ll\b/g, '$1 will');
    const out = new Set([gNorm(s)]);
    const fin = x => x.replace(/\s+/g, ' ').trim();
    // 's і 'd двозначні: is/has, would/had
    for (const s1 of ['is', 'has']) for (const d1 of ['would', 'had']) {
      out.add(fin(t.replace(/(\w)'s\b/g, '$1 ' + s1).replace(/(^|\s)'s\b/g, '$1' + s1).replace(/(\w)'d\b/g, '$1 ' + d1).replace(/(^|\s)'d\b/g, '$1' + d1)));
    }
    out.add(fin(t));
    return out;
  }
  function grammarMatch(input, targets) {
    const mine = gVariants(input);
    if (!gNorm(input)) return false;
    return [].concat(targets).some(tg => { for (const v of gVariants(tg)) if (mine.has(v)) return true; return false; });
  }

  /* ---------- Граматика: банк завдань, вибір на тест, повторення тем ---------- */
  /* Стабільний ключ завдання: не залежить від його місця в банку */
  function taskKey(t) {
    const s = JSON.stringify([t.type, t.task || '', t.q || '', t.uk || '', t.opts || t.words || '']);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(36);
  }
  /* Перемішати список слів «випадково», але однаково протягом дня (seed = номер дня):
     прокрутка й фільтри не перетасовують список щоразу */
  function dayShuffle(items, seed) {
    const key = w => {
      const s = seed + ':' + w.id;
      let h = 0x811c9dc5;
      for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
      h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12;
      return h >>> 0;
    };
    return items.map(w => [key(w), w]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
  }
  /* Скільки завдань кожного типу щонайменше в тесті з n */
  function taskMix(n) { return { choice: Math.round(4 * n / 12), input: Math.round(3 * n / 12), order: n >= 8 ? 1 : 0 }; }
  /* Вибрати n завдань: спершу ті, де помилявся (seen = 1), потім ще не бачені, потім решта;
     щонайменше по кілька кожного типу. Порядок — від простішого: за місцем у своїй дюжині банку. */
  function pickTasks(bank, seen, n, rng) {
    rng = rng || Math.random;
    seen = seen || {};
    n = Math.min(n, bank.length);
    const items = bank.map((t, i) => {
      const s = seen[taskKey(t)];
      return { t, i, p: s === 1 ? 0 : s == null ? 1 : 2, r: rng() };
    });
    const byPri = (a, b) => a.p - b.p || a.r - b.r;
    const chosen = new Set();
    const need = taskMix(n);
    for (const type of ['choice', 'input', 'order']) {
      items.filter(x => x.t.type === type).sort(byPri).slice(0, need[type]).forEach(x => chosen.add(x));
    }
    items.slice().sort(byPri).forEach(x => { if (chosen.size < n) chosen.add(x); });
    return Array.from(chosen).sort((a, b) => (a.i % 12) - (b.i % 12) || a.i - b.i).map(x => x.t);
  }
  /* Коли повторити тему після тесту: добре знаєш — інтервал росте, слабко — завтра-післязавтра */
  function grammarSchedule(prev, bal, today) {
    let iv;
    if (bal >= 10) iv = prev && prev.iv >= 2 && prev.best >= 10 ? Math.min(120, Math.round(prev.iv * 2.5)) : 4;
    else if (bal >= 7) iv = 2;
    else iv = 1;
    return { iv, due: today + iv };
  }
  /* Тест розділу: по завданню з кожної теми по колу, слабкіші теми першими; порядок — як теми в розділі */
  function pickSectionTasks(topics, n, rng) {
    rng = rng || Math.random;
    const order = topics.map((tp, i) => ({ tp, i, w: tp.best == null ? -1 : tp.best, r: rng() }))
      .sort((a, b) => a.w - b.w || a.r - b.r);
    const queues = new Map(order.map(o => [o.tp.id, pickTasks(o.tp.tasks, o.tp.seen, o.tp.tasks.length, rng)
      .map(t => ({ t, s: (o.tp.seen || {})[taskKey(t)] }))
      .sort((a, b) => (a.s === 1 ? 0 : a.s == null ? 1 : 2) - (b.s === 1 ? 0 : b.s == null ? 1 : 2) || rng() - 0.5)]));
    const out = [];
    let guard = 0;
    while (out.length < n && guard++ < 1000) {
      let took = false;
      for (const o of order) {
        if (out.length >= n) break;
        const q = queues.get(o.tp.id);
        if (q && q.length) { out.push({ tid: o.tp.id, pos: o.i, task: q.shift().t }); took = true; }
      }
      if (!took) break;
    }
    return out.sort((a, b) => a.pos - b.pos);
  }

  /* ---------- Закріплення граматики: кожне завдання повертається з інтервалом ----------
     p[taskKey] = [due, iv]; iv 0 — останній раз помилка (повернеться завтра) */
  function taskSrs(prev, ok, today) {
    if (!ok) return [today + 1, 0];
    const iv = !prev ? 3 : prev[1] === 0 ? 2 : Math.min(180, Math.round(prev[1] * 2.5));
    return [today + iv, iv];
  }
  function shuffleArr(a, rng) {
    rng = rng || Math.random;
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  /* topics: [{id, tasks, p, best}]. Скільки завдань чекає на сьогодні */
  function practiceDue(topics, today) {
    let n = 0;
    topics.forEach(t => { const p = t.p || {}; t.tasks.forEach(task => { const s = p[taskKey(task)]; if (s && s[0] <= today) n++; }); });
    return n;
  }
  /* Щоденне закріплення: спершу ті, що чекають (давніші першими), далі ще не бачені з пройдених тем
     (по колу між темами, слабші теми першими, у темі від простішого). Теми впереміш */
  function pickPractice(topics, today, n, rng) {
    rng = rng || Math.random;
    const due = [], fresh = {};
    topics.forEach(t => {
      const p = t.p || {};
      t.tasks.forEach((task, i) => {
        const s = p[taskKey(task)];
        if (s) { if (s[0] <= today) due.push({ tid: t.id, task, d: s[0], r: rng() }); }
        else if (t.best != null) (fresh[t.id] = fresh[t.id] || { w: t.best, r: rng(), q: [] }).q.push({ tid: t.id, task, i });
      });
    });
    due.sort((a, b) => a.d - b.d || a.r - b.r);
    const out = due.slice(0, n).map(x => ({ tid: x.tid, task: x.task }));
    const ids = Object.keys(fresh).sort((a, b) => fresh[a].w - fresh[b].w || fresh[a].r - fresh[b].r);
    ids.forEach(id => fresh[id].q.sort((a, b) => (a.i % 12) - (b.i % 12) || a.i - b.i));
    let took = true;
    while (out.length < n && took) {
      took = false;
      for (const id of ids) {
        if (out.length >= n) break;
        const x = fresh[id].q.shift();
        if (x) { out.push({ tid: x.tid, task: x.task }); took = true; }
      }
    }
    return shuffleArr(out, rng);
  }
  /* Мої помилки: завдання, де остання відповідь хибна */
  function pickMistakes(topics, n, rng) {
    rng = rng || Math.random;
    const out = [];
    topics.forEach(t => { const p = t.p || {}; t.tasks.forEach(task => { const s = p[taskKey(task)]; if (s && s[1] === 0) out.push({ tid: t.id, task, d: s[0], r: rng() }); }); });
    return out.sort((a, b) => a.d - b.d || a.r - b.r).slice(0, n == null ? out.length : n).map(x => ({ tid: x.tid, task: x.task }));
  }
  /* Практика однієї теми: помилки → не бачені → ті, що чекають → решта (найдавніше призначені першими) */
  function pickTopicPractice(topic, today, n, rng) {
    rng = rng || Math.random;
    const p = topic.p || {};
    const rank = task => { const s = p[taskKey(task)]; return !s ? [1, 0] : s[1] === 0 ? [0, s[0]] : s[0] <= today ? [2, s[0]] : [3, s[0]]; };
    return topic.tasks.map((task, i) => ({ task, k: rank(task), i, r: rng() }))
      .sort((a, b) => a.k[0] - b.k[0] || (a.k[0] === 1 ? (a.i % 12) - (b.i % 12) || a.r - b.r : a.k[1] - b.k[1] || a.r - b.r))
      .slice(0, n).map(x => ({ tid: topic.id, task: x.task }));
  }

  /* ---------- Речення з пропуском ---------- */
  const IRREGULAR = {
    get: ['got', 'gotten'], keep: ['kept'], bring: ['brought'], take: ['took', 'taken'], mean: ['meant'],
    understand: ['understood'], forget: ['forgot', 'forgotten'], spend: ['spent'], set: ['set'], hurt: ['hurt'],
    cut: ['cut'], run: ['ran'], give: ['gave', 'given'], come: ['came'], go: ['went', 'gone'], find: ['found'],
    put: ['put'], pay: ['paid'], leave: ['left'], fall: ['fell', 'fallen'], say: ['said'], tell: ['told'],
    buy: ['bought'], see: ['saw', 'seen'], make: ['made'], hold: ['held'], send: ['sent'], feel: ['felt'],
    drive: ['drove', 'driven'], speak: ['spoke', 'spoken'], break: ['broke', 'broken'], think: ['thought'],
    catch: ['caught'], lend: ['lent'], overtake: ['overtook', 'overtaken'], fit: ['fitted'], spell: ['spelt', 'spelled'], be: ['is', 'am', 'are', 'was', 'were', 'been'],
    have: ['has', 'had'], do: ['does', 'did', 'done'], wake: ['woke', 'woken'], win: ['won'], lose: ['lost'], sell: ['sold'],
    // інші неправильні дієслова з базового словника
    arise: ['arose', 'arisen'], bear: ['bore', 'born', 'borne'], beat: ['beaten'], become: ['became'], begin: ['began', 'begun'],
    bend: ['bent'], bet: ['bet'], bind: ['bound'], bite: ['bit', 'bitten'], bleed: ['bled'], blow: ['blew', 'blown'],
    build: ['built'], burn: ['burnt'], burst: ['burst'], cast: ['cast'], choose: ['chose', 'chosen'], cling: ['clung'],
    cost: ['cost'], creep: ['crept'], deal: ['dealt'], dig: ['dug'], draw: ['drew', 'drawn'], dream: ['dreamt'],
    drink: ['drank', 'drunk'], eat: ['ate', 'eaten'], feed: ['fed'], fight: ['fought'], flee: ['fled'], fly: ['flew', 'flown', 'flies'],
    forbid: ['forbade', 'forbidden'], forgive: ['forgave', 'forgiven'], freeze: ['froze', 'frozen'], grow: ['grew', 'grown'],
    hang: ['hung'], hear: ['heard'], hide: ['hid', 'hidden'], hit: ['hit'], kneel: ['knelt'], know: ['knew', 'known'],
    lay: ['laid'], lead: ['led'], lean: ['leant'], leap: ['leapt'], learn: ['learnt'], let: ['let'], lie: ['lay', 'lain', 'lying'],
    light: ['lit'], meet: ['met'], mistake: ['mistook', 'mistaken'], quit: ['quit'], read: ['read'], ride: ['rode', 'ridden'],
    ring: ['rang', 'rung'], rise: ['rose', 'risen'], seek: ['sought'], shake: ['shook', 'shaken'], shine: ['shone'],
    shoot: ['shot'], show: ['shown'], shrink: ['shrank', 'shrunk'], shut: ['shut'], sing: ['sang', 'sung'], sink: ['sank', 'sunk'],
    sit: ['sat'], sleep: ['slept'], slide: ['slid'], smell: ['smelt'], spin: ['spun'], split: ['split'], spread: ['spread'],
    spring: ['sprang', 'sprung'], stand: ['stood'], steal: ['stole', 'stolen'], stick: ['stuck'], sting: ['stung'],
    strike: ['struck'], swear: ['swore', 'sworn'], sweep: ['swept'], swim: ['swam', 'swum'], swing: ['swung'],
    teach: ['taught'], tear: ['tore', 'torn'], throw: ['threw', 'thrown'], wear: ['wore', 'worn'], weep: ['wept'],
    wind: ['wound'], withdraw: ['withdrew', 'withdrawn'], write: ['wrote', 'written'], undertake: ['undertook', 'undertaken'],
    upset: ['upset'], forecast: ['forecast'], broadcast: ['broadcast'], prove: ['proven'],
    // неправильні множини й ступені порівняння
    child: ['children'], man: ['men'], woman: ['women'], person: ['people'], foot: ['feet'], tooth: ['teeth'], mouse: ['mice'],
    life: ['lives'], wife: ['wives'], knife: ['knives'], half: ['halves'], leaf: ['leaves'], shelf: ['shelves'], wolf: ['wolves'],
    thief: ['thieves'], good: ['better', 'best'], bad: ['worse', 'worst'], far: ['further', 'furthest', 'farther'],
    many: ['more', 'most'], little: ['less', 'least'], big: ['bigger', 'biggest'], hot: ['hotter', 'hottest'], sad: ['sadder', 'saddest']
  };
  function wordForms(w) {
    const out = new Set([w, w + 's', w + 'es', w + 'ed', w + 'd', w + 'ing', w + 'er', w + 'est', w + 'r']);
    if (/e$/.test(w)) out.add(w.slice(0, -1) + 'ing');
    if (/[^aeiou]y$/.test(w)) { ['ies', 'ied', 'ier', 'iest', 'ily'].forEach(e => out.add(w.slice(0, -1) + e)); }
    if (/e$/.test(w)) out.add(w + 'st');
    if (/ie$/.test(w)) out.add(w.slice(0, -2) + 'ying');
    if (/le$/.test(w)) out.add(w.slice(0, -1) + 'y');
    if (/[^aeiou]$/.test(w) && !/y$/.test(w)) out.add(w + 'ly');
    if (/[aeiou]$/.test(w) || /e$/.test(w)) out.add(w + 'ly');
    if (/[^aeiou][aeiou][bdgmnprtl]$/.test(w)) { out.add(w + w.slice(-1) + 'ed'); out.add(w + w.slice(-1) + 'ing'); out.add(w + w.slice(-1) + 'er'); }
    (IRREGULAR[w] || []).forEach(f => out.add(f));
    return Array.from(out);
  }
  /* Можливі початкові форми слова з тексту: worked → work, making → make, children → child.
     Порядок важливий: used → use раніше, ніж us; uses → use раніше, ніж us. */
  let IRR_REV = null;
  function lemmaCandidates(token) {
    const raw = String(token || '').toLowerCase().replace(/[’‘]/g, "'").replace(/^'+|'+$/g, '');
    const t = raw.replace(/'s$/, '').replace(/s'$/, 's');
    const out = [];
    const push = x => { if (x && x.length >= 2 && !out.includes(x)) out.push(x); };
    if (raw) out.push(raw);   // it's, I, a: як є
    push(t);                  // plasterer's → plasterer
    if (!IRR_REV) {
      IRR_REV = {};
      for (const base in IRREGULAR) IRREGULAR[base].forEach(f => { (IRR_REV[f] = IRR_REV[f] || []).push(base); });
    }
    (IRR_REV[t] || []).forEach(push);
    const dbl = /([bdgklmnprt])\1$/;
    if (/ies$/.test(t)) push(t.slice(0, -3) + 'y');
    if (/s$/.test(t) && !/ss$/.test(t)) push(t.slice(0, -1));
    if (/es$/.test(t)) push(t.slice(0, -2));
    if (/ied$/.test(t)) push(t.slice(0, -3) + 'y');
    if (/ed$/.test(t)) {
      push(t.slice(0, -1));
      const s = t.slice(0, -2);
      push(s);
      if (dbl.test(s)) push(s.slice(0, -1));
    }
    if (/ing$/.test(t)) {
      const s = t.slice(0, -3);
      if (/ying$/.test(t)) push(s.slice(0, -1) + 'ie');
      push(s + 'e');
      push(s);
      if (dbl.test(s)) push(s.slice(0, -1));
    }
    if (/iest$/.test(t)) push(t.slice(0, -4) + 'y');
    if (/ier$/.test(t)) push(t.slice(0, -3) + 'y');
    if (/est$/.test(t)) { push(t.slice(0, -2)); push(t.slice(0, -3)); }
    if (/er$/.test(t)) { push(t.slice(0, -1)); push(t.slice(0, -2)); }
    if (/ily$/.test(t)) push(t.slice(0, -3) + 'y');
    if (/ly$/.test(t)) push(t.slice(0, -2));
    return out;
  }
  function isLetter(ch) { return !!ch && /[a-z']/i.test(ch); }
  function findPhrase(text, phrase) {
    const lt = text.toLowerCase(), lp = phrase.toLowerCase();
    let i = lt.indexOf(lp);
    while (i !== -1) {
      if (!isLetter(lt[i - 1]) && !isLetter(lt[i + lp.length])) return i;
      i = lt.indexOf(lp, i + 1);
    }
    return -1;
  }
  function clozeTarget(word) { return word ? clozeIn(word, word.ex) : null; }
  /* Де в реченні стоїть слово (у будь-якій формі): для пропусків у прикладі та фразах */
  function clozeIn(word, sentence) {
    if (!word || !sentence) return null;
    let base = String(word.en).trim().replace(/[.!?]+$/, '');
    if (/\.\.\.|…/.test(base)) return null;
    base = base.replace(/^to /i, '').replace(/^(the|a|an) /i, '');
    const parts = base.split(/\s+/);
    if (!parts[0] || parts.length > 3) return null;
    const rest = parts.slice(1).join(' ');
    const cands = wordForms(parts[0].toLowerCase()).map(f => rest ? f + ' ' + rest : f);
    if (parts.length > 1) wordForms(parts[parts.length - 1].toLowerCase())
      .forEach(f => cands.push(parts.slice(0, -1).join(' ') + ' ' + f));
    let best = null;
    for (const c of cands) {
      const i = findPhrase(sentence, c);
      if (i !== -1 && (!best || i < best.start || (i === best.start && c.length > best.len))) best = { start: i, len: c.length };
    }
    if (!best) return null;
    const text = sentence.slice(best.start, best.start + best.len);
    const others = norm(sentence.slice(0, best.start) + ' ' + sentence.slice(best.start + best.len));
    if (!others) return null;
    return { start: best.start, end: best.start + best.len, text };
  }

  /* Пошук слова з тексту в словнику: точний збіг, потім початкова форма. Повертає до трьох значень.
     glossary: службові слова {en: uk}, яких немає серед слів для вивчення (the, your, it's).
     sentence: речення, де торкнулися слова, щоб знайти вирази зі словом (day off, pick up, in a nutshell). */
  const PLACEHOLDER = new Set(['someone', "someone's", 'somebody', 'something', 'sb', 'sth', "one's", 'one', 'your', 'yours', 'yourself', 'oneself']);
  function lookupIndex(words, glossary) {
    glossary = glossary || {};
    const heads = new Map();
    const multi = new Map();
    words.forEach(w => {
      const h = norm(w.en).replace(/^to /, '').replace(/^(the|a|an) /, '').trim();
      if (!h) return;
      if (/\s/.test(h)) {
        const toks = h.split(' ').map(x => x.replace(/^'+|'+$/g, '')).filter(Boolean);
        if (toks.length > 6) return;
        toks.forEach(tk => {
          if (PLACEHOLDER.has(tk) || tk.length < 2) return;
          const l = multi.get(tk);
          if (!l) multi.set(tk, [{ w, toks }]); else if (!l.some(x => x.w === w)) l.push({ w, toks });
        });
        return;
      }
      const list = heads.get(h);
      if (!list) heads.set(h, [w]); else if (list.length < 3 && !list.some(x => x.uk === w.uk)) list.push(w);
    });
    const gl = k => Object.prototype.hasOwnProperty.call(glossary, k) ? [{ en: k, uk: glossary[k], gloss: true }] : null;
    const single = c => {
      // Слово для вивчення в точній формі, потім службове в точній формі (was, it's), потім початкові форми
      if (heads.has(c[0])) return { words: heads.get(c[0]), exact: true, base: c[0] };
      if (gl(c[0])) return { words: gl(c[0]), exact: true, base: c[0] };
      for (let i = 1; i < c.length; i++) {
        const list = heads.get(c[i]) || gl(c[i]);
        if (list) return { words: list, exact: false, base: c[i] };
      }
      return null;
    };
    return (token, sentence) => {
      const c = lemmaCandidates(token);
      const r = single(c);
      let phrases = [];
      if (sentence) {
        const have = new Set();
        (String(sentence).match(/[A-Za-z][A-Za-z'’]*/g) || []).forEach(x => lemmaCandidates(x).forEach(f => have.add(f)));
        const seen = new Set();
        c.forEach(f => (multi.get(f) || []).forEach(({ w, toks }) => {
          if (seen.has(w) || !toks.every(tk => PLACEHOLDER.has(tk) || have.has(tk))) return;
          seen.add(w); phrases.push(w);
        }));
        // Довші вирази точніші: in a nutshell перед nutshell
        phrases = phrases.sort((a, b) => b.en.length - a.en.length).slice(0, 2);
      }
      if (!r && !phrases.length) return null;
      return Object.assign({ words: [], exact: false, base: c[0] }, r || {}, { phrases });
    };
  }

  /* Фрази зі словом, де його можна сховати: «Доповни фразу» (довкола слова щонайменше два інших) */
  function phraseTargets(word, phrases) {
    return (phrases || []).map(([en, uk], i) => {
      const ct = clozeIn(word, en);
      return ct && tokens(en).length >= tokens(ct.text).length + 2 ? Object.assign({ i, en, uk }, ct) : null;
    }).filter(Boolean);
  }
  /* Початкова форма без «to» й артикля */
  function baseForm(w) { return String(w.en || '').trim().replace(/[.!?]+$/, '').replace(/^to /i, '').replace(/^(the|a|an) /i, ''); }
  /* «Склади слово з літер»: одне слово з 3–12 літер */
  function spellTarget(w) { const b = baseForm(w); return /^[A-Za-z]{3,12}$/.test(b) ? b : null; }
  /* «Яке слово пропущено?»: у прикладі слово стоїть у початковій формі, тож варіанти не підкажуть закінченням */
  function ctxTarget(w) { const ct = clozeTarget(w); return ct && ct.text.toLowerCase() === baseForm(w).toLowerCase() ? ct : null; }

  /* ---------- Слова для «склади фразу» ---------- */
  function tokens(s) {
    return String(s || '').replace(/\.\.\.|…/g, ' ').split(/\s+/)
      .map(t => t.replace(/^[^A-Za-z0-9'’]+|[^A-Za-z0-9'’]+$/g, '').replace(/’/g, "'"))
      .filter(Boolean);
  }
  function canBuildPhrase(w) { const n = tokens(w.en).length; return n >= 3 && n <= 8 && !/\.\.\.|…/.test(w.en); }
  function canBuildSentence(w) { const n = tokens(w.ex).length; return n >= 3 && n <= 10; }
  function canType(w) { return !/\.\.\.|…/.test(w.en) && tokens(w.en).length <= 4 && w.en.length <= 28; }
  function canDictate(w) { return canType(w) && tokens(w.en).length <= 3; }
  function isPhrase(w) { return tokens(w.en).length >= 3; }

  /* ---------- Вибір вправи ---------- */
  const EXERCISES = {
    intro: 'Нове слово',
    mcq_en_uk: 'Вибери переклад',
    mcq_uk_en: 'Вибери англійською',
    listen_mcq: 'Що ти почув?',
    flip: 'Згадай переклад',
    flip_rev: 'Згадай англійською',
    type_en: 'Напиши англійською',
    cloze: 'Встав у речення',
    dictation: 'Напиши, що чуєш',
    build_phrase: 'Склади фразу',
    build_sentence: 'Склади речення',
    speak: 'Скажи англійською',
    own_sentence: 'Своє речення',
    spell: 'Склади слово з літер',
    ctx_mcq: 'Яке слово пропущено?',
    phrase_fill: 'Доповни фразу',
    listen_ex: 'Зрозумій на слух',
    match: 'Знайди пари',
    say_sentence: 'Скажи речення'
  };
  /* «Скажи речення»: приклад до 10 слів, який можна вимовити й порівняти із записом */
  function canSaySentence(w) { const n = tokens(w.ex).length; return !!w.ex && !!w.exUk && n >= 3 && n <= 10; }
  /* Який приклад показати: чергуємо два контексти за кількістю повторень */
  function exampleFor(w, card, kind) {
    if (!w.ex2) return { ex: w.ex, exUk: w.exUk, sayEx: w.sayEx, n: 1 };
    const reps = card ? (card.reps || 0) + (card.step || 0) : 0;
    const second = kind === 'other' ? reps % 2 === 0 : reps % 2 === 1;
    return second ? { ex: w.ex2, exUk: w.ex2Uk, sayEx: w.sayEx2, n: 2 } : { ex: w.ex, exUk: w.exUk, sayEx: w.sayEx, n: 1 };
  }
  function withExample(w, card) {
    const e = exampleFor(w, card);
    return Object.assign({}, w, { ex: e.ex, exUk: e.exUk, sayEx: e.sayEx, exN: e.n });
  }
  /* Вправи, яким потрібен звук або голос: у тихому режимі їх немає */
  const SOUND_EXERCISES = ['listen_mcq', 'dictation', 'speak', 'listen_ex', 'say_sentence'];
  function eligible(type, w, ctx) {
    const st = ctx.settings || {};
    const typing = st.typing !== false, speaking = st.speaking !== false;
    if (st.quiet && SOUND_EXERCISES.includes(type)) return false;
    switch (type) {
      case 'type_en': return typing && canType(w);
      case 'cloze': return typing && !!clozeTarget(w);
      case 'dictation': return typing && ctx.canListen && canDictate(w);
      case 'listen_mcq': return !!ctx.canListen;
      case 'build_phrase': return canBuildPhrase(w);
      case 'build_sentence': return !!w.ex && canBuildSentence(w);
      case 'speak': return speaking;
      case 'own_sentence': return typing && canType(w) && !/\.\.\.|…/.test(w.en) && tokens(w.en).length <= 2;
      case 'spell': return !!spellTarget(w);
      case 'ctx_mcq': return !!ctxTarget(w);
      case 'phrase_fill': return typing && !!ctx.phrases && phraseTargets(w, ctx.phrases[w.id]).length > 0;
      case 'listen_ex': return !!ctx.canListen && !!w.ex && !!w.exUk;
      case 'say_sentence': return speaking && canSaySentence(w);
      default: return true;
    }
  }
  function choose(list, ctx) {
    const rng = ctx.rng || Math.random;
    const pool = [];
    for (const [type, weight] of list) if (eligible(type, ctx.word, ctx)) pool.push([type, weight]);
    if (!pool.length) return null;
    const fresh = pool.filter(([t]) => !(ctx.recent || []).includes(t));
    const use = fresh.length ? fresh : pool;
    const total = use.reduce((a, [, wt]) => a + wt, 0);
    let x = rng() * total;
    for (const [t, wt] of use) { x -= wt; if (x <= 0) return t; }
    return use[use.length - 1][0];
  }
  const PRODUCTIVE = [['type_en', 4], ['build_phrase', 5], ['spell', 3], ['cloze', 2], ['speak', 2], ['flip_rev', 1]];
  function pickExercise(word, card, ctx) {
    ctx = Object.assign({}, ctx, { word });
    const mode = (ctx.settings && ctx.settings.mode) || 'mix';
    if (!card) return 'intro';
    if (mode === 'cards') {
      if (card.st === 'learn') return card.step <= 1 ? 'flip' : 'flip_rev';
      return (ctx.rng || Math.random)() < 0.5 ? 'flip' : 'flip_rev';
    }
    if (card.st === 'learn') {
      if (card.step <= 1) return choose([['mcq_en_uk', 3], ['listen_mcq', 2], ['match', 2]], ctx);
      if (card.step === 2) return choose([['mcq_uk_en', 3], ['ctx_mcq', 2]], ctx) || 'mcq_uk_en';
      return choose(PRODUCTIVE, ctx) || 'flip_rev';
    }
    if (card.st === 'relearn') return choose([['type_en', 4], ['build_phrase', 4], ['spell', 3], ['ctx_mcq', 1], ['mcq_uk_en', 1], ['flip_rev', 1]], ctx) || 'flip_rev';
    const s = card.s || 0;
    let list;
    if (s < 4) list = [['mcq_uk_en', 3], ['listen_mcq', 2], ['ctx_mcq', 2], ['spell', 2], ['match', 1], ['flip_rev', 2], ['type_en', 2], ['build_phrase', 2]];
    else if (s < 15) list = [['type_en', 4], ['cloze', 3], ['phrase_fill', 3], ['build_phrase', 3], ['listen_ex', 2], ['speak', 2], ['ctx_mcq', 1], ['flip_rev', 1], ['listen_mcq', 1]];
    else if (s < 45) list = [['type_en', 3], ['cloze', 2], ['phrase_fill', 3], ['dictation', 2], ['build_sentence', 3], ['listen_ex', 2], ['speak', 2], ['say_sentence', 2], ['flip', 1], ['own_sentence', 1]];
    else list = [['dictation', 3], ['build_sentence', 3], ['phrase_fill', 2], ['listen_ex', 2], ['speak', 2], ['say_sentence', 3], ['cloze', 2], ['flip', 1], ['own_sentence', 2]];
    return choose(list, ctx) || 'flip_rev';
  }

  /* ---------- Слова, які легко сплутати: не вчити в один день, а потім розрізняти ---------- */
  const CONFUSABLE = [
    ['talk-borrow', 'talk-lend'], ['core-cheap', 'core-expensive'], ['core-full', 'core-empty'], ['core-loud', 'core-quiet'],
    ['core-safe', 'core-dangerous'], ['core-similar', 'core-different'], ['core-tidy', 'core-messy'], ['talk-already', 'talk-yet'],
    ['talk-yet', 'talk-still'], ['talk-already', 'talk-still'], ['core-hardly', 'core-properly'], ['travel-single', 'travel-return'],
    ['travel-arrivals', 'travel-departures'], ['verbs-pickup', 'verbs-dropoff'], ['verbs-puton', 'verbs-takeoff'],
    ['verbs-turnup', 'verbs-turnoff'], ['core-remember', 'core-forget'], ['core-recommend', 'core-suggest'],
    ['core-notice', 'core-realise'], ['core-expect', 'core-hope'], ['core-bring', 'core-take'], ['site-trowel', 'site-float'],
    ['site-hawk', 'site-float'], ['site-bonding', 'site-render'], ['site-slab', 'site-plasterboard'], ['feel-bored', 'feel-fedup'],
    ['feel-worried', 'feel-nervous'], ['feel-annoyed', 'feel-upset'], ['weather-drizzle', 'weather-showers'],
    ['weather-freezing', 'weather-baltic'], ['core-busy', 'core-available'], ['work-quote', 'work-estimate'],
    ['work-hourly', 'work-dayrate'], ['health-painkillers', 'health-tablets'], ['core-mistake', 'core-wrong'],
    ['talk-wages', 'talk-payslip'], ['car-petrol', 'car-station'], ['car-tyre', 'car-puncture'], ['shop-aisle', 'travel-aisle'],
    ['health-plaster', 'site-bonding'], ['irish-knackered', 'talk-tired'], ['core-even', 'core-though'], ['core-instead', 'core-atleast'],
    // базовий словник: пари, які українці найчастіше плутають
    ['sp-say', 'sp-tell'], ['sp-speak', 'sp-talk'], ['sp-look', 'sp-see'], ['sp-see', 'sp-watch'], ['sp-hear', 'sp-listen'],
    ['sp-lose', 'b3-loose'], ['b1-rise', 'sp-raise'], ['sp-lie', 'b2-lay'], ['sp-quite', 'core-quiet'], ['sp-fun', 'sp-funny'],
    ['b1-affect', 'b1-effect'], ['b2-advise', 'core-advice'], ['sp-job', 'sp-work'], ['sp-wait', 'core-expect'], ['sp-win', 'core-earn'],
    ['sp-hard', 'core-hardly'], ['sp-accept', 'sp-except'], ['sp-wonder', 'b3-wander'], ['sp-dead', 'sp-die'], ['sp-alone', 'feel-lonely'],
    ['b2-tall', 'sp-high'], ['sp-learn', 'sp-teach'], ['b3-beside', 'sp-besides'], ['sp-sit', 'sp-seat'], ['sp-price', 'b3-prize'],
    ['sp-during', 'sp-while'], ['b3-shade', 'b3-shadow'], ['b1-travel', 'sp-trip'], ['b2-journey', 'sp-trip'], ['sp-person', 'sp-personal'],
    ['sp-chicken', 'sp-kitchen'], ['b2-actual', 'b1-current'], ['b1-possibility', 'b1-opportunity'], ['b2-salary', 'b2-wage'],
    ['b1-customer', 'work-client'], ['b2-guest', 'b2-host'], ['talk-borrow', 'b2-loan']
  ];
  const CONF_MAP = {};
  CONFUSABLE.forEach(([a, b]) => { (CONF_MAP[a] = CONF_MAP[a] || []).push(b); (CONF_MAP[b] = CONF_MAP[b] || []).push(a); });
  function confusables(id) { return CONF_MAP[id] || []; }

  /* ---------- Варіанти відповіді для тестів ---------- */
  /* Перший сенс перекладу для варіантів: «отримати; дістатися; ставати» → «отримати». Варіанти стають
     однакової довжини й читаються з одного погляду; повний переклад лишається у відповіді й словнику. */
  function shortSense(uk) {
    const s = String(uk || '').trim();
    if (s.indexOf(';') < 0) return s;
    const first = s.split(';')[0].trim();
    return first.length >= 3 ? first : s;
  }
  /* Підписи варіантів: короткі, якщо вони не збігаються між собою, інакше повні */
  function optionLabels(opts, field) {
    if (field !== 'uk') return opts.map(o => o[field]);
    const short = opts.map(o => shortSense(o.uk));
    const uniq = new Set(short.map(norm));
    return uniq.size === short.length ? short : opts.map(o => o.uk);
  }
  /* Груба частина мови за формою: дієслово («to …» або переклад на -ти), прикметник (переклад на -ий/-ій),
     прислівник («-ly»), інше. Варіанти тієї ж частини мови не видають відповідь формою слова. */
  const LY_NOT_ADV = /^(only|early|family|likely|friendly|lonely|lovely|ugly|silly|holy|daily|weekly|monthly|yearly|elderly|lively|deadly|costly|oily|chilly|jolly|smelly|bully|belly|jelly|rally|ally|supply|apply|reply|rely|fly|july|italy|butterfly|assembly|melancholy)$/i;
  function posClass(w) {
    const en = String(w.en || '').trim();
    const uk = String(w.uk || '').split(/[,;(]/)[0].trim().replace(/\(ся\)$/, '');
    // дієслова в словнику з «to …»; вирази без «to» (cut corners) видно за перекладом на -ти,
    // а одне слово за ним не судимо: «мати», «фрукти», «проти» — не дієслова
    if (/^to /i.test(en) || (/\s/.test(en) && /ти(ся)?$/.test(uk))) return 'verb';
    if (/^[A-Za-z]+ly$/.test(en) && !LY_NOT_ADV.test(en)) return 'adv';
    if (/(ий|ій)$/.test(uk)) return 'adj';
    return 'other';
  }
  /* close: true для вивчених слів (схожі варіанти вчать розрізняти), false для нових (далекі, щоб не плутати) */
  function distractors(word, words, field, n, rng, close) {
    rng = rng || Math.random;
    const target = norm(word[field]);
    const multi = w => tokens(baseForm(w)).length >= 2;   // вираз чи одне слово
    const phrase = multi(word);
    const pos = posClass(word);
    const seen = new Set([target]);
    const conf = new Set(confusables(word.id));
    const score = w => {
      if (conf.has(w.id)) return close ? -2 : 50;
      return (w.cat === word.cat ? (close ? 0 : 3) : (close ? 2 : 0)) + (multi(w) === phrase ? 0 : 3.5) + (posClass(w) === pos ? 0 : 4) + rng() * 1.5;
    };
    const pool = words.filter(w => w.id !== word.id && w[field]).map(w => [score(w), w]).sort((a, b) => a[0] - b[0]);
    const out = [];
    for (const [, w] of pool) {
      const k = norm(w[field]);
      if (seen.has(k)) continue;
      seen.add(k); out.push(w);
      if (out.length >= n) break;
    }
    return out;
  }
  function shuffle(a, rng) {
    rng = rng || Math.random;
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  /* ---------- Розклад ---------- */
  const LEARN_STEPS = 3;            // після знайомства: впізнати, вибрати англійське, згадати самому
  const STEP_GAP = [0, 2, 3, 5];    // скільки інших вправ до наступного кроку
  const LEECH = 4;

  function newCard(today) { return { st: 'learn', step: 1, miss: 0, hint: 0, reps: 0, lapses: 0, first: today, due: today }; }
  function knownCard(today, retention, rng) {
    const s = F.init(4);
    return { st: 'review', s: s.s, d: s.d, last: today, due: today + F.interval(s.s, retention, rng), reps: 1, lapses: 0, first: today, known: true };
  }
  function isLeech(c) { return !!c && (c.lapses || 0) >= LEECH; }
  function strength(c, today) {
    if (!c || c.st !== 'review' || !c.s) return 0;
    return F.retrievability(today - c.last, c.s);
  }
  function statusOf(c) {
    if (!c) return 'new';
    if (isLeech(c)) return 'leech';
    if (c.st === 'review' && c.s >= 21) return 'known';
    return 'learning';
  }
  /* Прогноз інтервалів для кнопок самооцінки */
  function previewIntervals(c, today, retention) {
    const out = {};
    for (const g of [1, 2, 3, 4]) {
      if (!c || c.st !== 'review') { out[g] = g === 1 ? 0 : null; continue; }
      if (g === 1) { out[g] = 0; continue; }
      const n = F.next({ s: c.s, d: c.d }, g, today - c.last);
      out[g] = F.interval(n.s, retention);
    }
    return out;
  }

  /*
   * Застосувати результат вправи до картки. Повертає { card, done, again }:
   * done: картку на сьогодні завершено, again: показати ще раз у цій сесії (через кілька вправ).
   */
  function applyGrade(card, g, env) {
    const today = env.today, retention = env.retention || 0.9, rng = env.rng;
    const c = Object.assign({}, card);
    c.seen = today;
    if (c.st === 'learn') {
      if (g >= 2) {
        if (g === 2) c.hint = (c.hint || 0) + 1;
        c.step = (c.step || 1) + 1;
        if (c.step > LEARN_STEPS || g === 4) {
          const first = g === 4 && c.step <= 2 && !c.miss ? 4 : (c.miss || 0) === 0 && !(c.hint) ? 3 : (c.miss || 0) <= 1 ? 2 : 1;
          const s = F.init(first);
          Object.assign(c, { st: 'review', s: s.s, d: s.d, last: today, due: today + F.interval(s.s, retention, rng), reps: 1 });
          delete c.step; delete c.miss; delete c.hint;
          return { card: c, done: true, again: false, graduated: true };
        }
        c.due = today;
        return { card: c, done: false, again: true, gap: STEP_GAP[c.step] || 3 };
      }
      c.miss = (c.miss || 0) + 1;
      c.step = Math.max(1, (c.step || 1) - 1);
      c.due = today;
      return { card: c, done: false, again: true, gap: 2, wrong: true };
    }
    if (c.st === 'relearn') {
      if (g >= 2) {
        c.st = 'review';
        c.due = today + F.interval(c.s, retention, rng);
        delete c.step;
        return { card: c, done: true, again: false };
      }
      return { card: c, done: false, again: true, gap: 3, wrong: true };
    }
    // review
    const t = Math.max(0, today - (c.last != null ? c.last : today));
    const n = F.next({ s: c.s, d: c.d }, g, t);
    c.s = n.s; c.d = n.d; c.last = today; c.reps = (c.reps || 0) + 1;
    if (g === 1) {
      c.lapses = (c.lapses || 0) + 1;
      c.st = 'relearn'; c.step = 1; c.due = today;
      return { card: c, done: false, again: true, gap: 3, wrong: true, lapse: true };
    }
    c.due = today + F.interval(c.s, retention, rng);
    return { card: c, done: true, again: false };
  }

  /* Перенесення прогресу з першої версії (простий алгоритм) */
  function migrateV2(old, today) {
    const out = {};
    for (const id in old) {
      const p = old[id];
      if (!p) continue;
      if (!p.reps) {
        out[id] = { st: 'learn', step: 1, miss: 1, hint: 0, reps: 0, lapses: p.lapses || 0, first: p.first != null ? p.first : today, due: Math.min(p.due != null ? p.due : today, today) };
      } else {
        const ef = p.ef || 2.5;
        out[id] = {
          st: 'review', s: Math.max(0.5, p.iv || 1), d: Math.min(10, Math.max(1, 5 + (2.5 - ef) * 4)),
          last: p.last != null ? p.last : today - (p.iv || 1), due: p.due != null ? p.due : today,
          reps: p.reps, lapses: p.lapses || 0, first: p.first != null ? p.first : today
        };
      }
    }
    return out;
  }

  /* ---------- Порядок нових слів: свої першими, далі теми з вагами ---------- */
  // Розмовні слова з базового словника йдуть найчастіше: вони покривають більшість живої мови
  const CAT_WEIGHT = { spoken: 12, core: 4, base1: 4, talk: 3, idioms: 3, irish: 2, verbs: 2, site: 2, work: 1, base2: 2,
    feel: 1, health: 1, phone: 1, shop: 1, car: 1, weather: 1, false: 1, travel: 1, base3: 1,
    home: 2, food: 2, people: 2, clothes: 1, docs: 1, tech: 1, nature: 1, leisure: 1, base4: 1, base5: 1, base6: 1, base7: 1 };
  function orderNew(words, cards, cats, perDay, today, priority) {
    const first = new Set(priority || []);
    const pool = words.filter(w => !cards[w.id] && (first.has(w.id) || (cats ? cats[w.cat] !== false : true)));
    // Свої слова, потім позначені «вчити першим» (у порядку позначення), потім теми
    const mine = pool.filter(w => w.cat === 'mine');
    const byId = new Map(pool.map(w => [w.id, w]));
    const pri = (priority || []).map(id => byId.get(id)).filter(w => w && w.cat !== 'mine');
    const priIds = new Set(pri.map(w => w.id));
    const groups = {};
    pool.filter(w => w.cat !== 'mine' && !priIds.has(w.id)).forEach(w => { (groups[w.cat] = groups[w.cat] || []).push(w); });
    const keys = Object.keys(groups);
    const credit = {}; keys.forEach(k => { credit[k] = 0; });
    const out = [];
    let left = pool.length - mine.length - pri.length;
    while (left > 0) {
      let best = null, total = 0;
      for (const k of keys) {
        if (!groups[k].length) continue;
        const wt = CAT_WEIGHT[k] || 1;
        credit[k] += wt; total += wt;
        if (!best || credit[k] > credit[best]) best = k;
      }
      credit[best] -= total;
      out.push(groups[best].shift());
      left--;
    }
    // Слова-плутанки не повинні потрапити в один день: партнера відсуваємо далі
    const n = perDay || 10;
    const recentDays = new Set();
    if (today != null) for (const id in cards) { const c = cards[id]; if (c && c.first != null && c.first >= today - 1) recentDays.add(id); }
    const result = [];
    const deferred = [];
    const placed = new Set();
    for (const w of out) {
      const partners = confusables(w.id);
      const clash = partners.some(pid => placed.has(pid) && result.length < n) || partners.some(pid => recentDays.has(pid));
      if (clash) deferred.push(w); else { result.push(w); placed.add(w.id); }
      if (result.length === n) { placed.clear(); }
    }
    // «Вчити першими» йдуть раніше, але не суцільним блоком: через одне з рештою, щоб теми лишалися впереміш
    const merged = [];
    const rest = result.concat(deferred);
    for (let i = 0, j = 0; i < pri.length || j < rest.length;) {
      if (i < pri.length) merged.push(pri[i++]);
      if (j < rest.length) merged.push(rest[j++]);
    }
    return mine.concat(merged);
  }

  /* ---------- Спринт: швидке впізнавання вивчених слів ---------- */
  function sprintPool(words, cards) {
    return words.filter(w => { const c = cards[w.id]; return c && c.st === 'review' && (c.reps || 0) >= 2 && (c.s || 0) >= 4; });
  }

  /* ---------- Сесія ---------- */
  function Session(env) {
    // env: { words, cards, settings, today, log (сьогоднішній запис), rng, practiceIds }
    this.env = env;
    this.pos = 0;
    this.recent = [];
    this.practice = !!env.practiceIds;
    this.limit = this.practice ? 0 : (env.limit != null ? env.limit : (env.settings.sessionLen || 0));
    this.history = [];
    this.byId = new Map(env.words.map(w => [w.id, w]));
    this.pipe = [];
    this.reviews = [];
    this.newIds = [];
    if (this.practice) {
      this.pipe = env.practiceIds.filter(id => this.byId.has(id)).map((id, i) => ({ id, readyAt: i }));
      return;
    }
    const today = env.today;
    let overdue = 0;
    for (const id in env.cards) {
      const c = env.cards[id];
      if (!this.byId.has(id) || c.due > today) continue;
      if (c.st === 'review') { this.reviews.push(id); if (c.due < today) overdue++; }
      else this.pipe.push({ id, readyAt: 0 });
    }
    this.reviews.sort((a, b) => strength(env.cards[a], today) - strength(env.cards[b], today));
    // Після пропущених днів нові слова чекають, поки не розібрано борг: інакше він лише росте
    this.overdue = overdue;
    this.newPaused = !env.reviewOnly && !env.withNew && overdue >= backlogLimit(env.settings.newPerDay);
    this.newIds = env.reviewOnly || this.newPaused ? [] : orderNew(env.words, env.cards, env.settings.cats, env.settings.newPerDay || 10, today, env.priority).slice(0, this.allowance()).map(w => w.id);
  }
  /* Скільки прострочених повторень вважати боргом */
  function backlogLimit(perDay) { return Math.max(30, (perDay || 10) * 3); }
  Session.prototype.allowance = function () {
    const l = this.env.log || {};
    return Math.max(0, (this.env.settings.newPerDay || 10) + (l.x || 0) - (l.n || 0));
  };
  Session.prototype.remaining = function () {
    return this.reviews.length + this.newIds.length + new Set(this.pipe.map(p => p.id)).size;
  };
  /* Скільки ще вправ орієнтовно: нове слово = знайомство + 3 кроки */
  Session.prototype.remainingUnits = function () {
    if (this.practice) return this.pipe.length;
    let pipeU = 0;
    for (const id of new Set(this.pipe.map(p => p.id))) {
      const c = this.env.cards[id];
      pipeU += c && c.st === 'learn' ? Math.max(1, LEARN_STEPS + 1 - (c.step || 1)) : 1;
    }
    const fresh = this.reviews.length + this.newIds.length * (LEARN_STEPS + 1);
    // Коротке заняття: після ліміту лише довчити почате
    if (this.limit) return pipeU + Math.min(fresh, Math.max(0, this.limit - this.pos));
    return pipeU + fresh;
  };
  Session.prototype.counts = function () {
    return { reviews: this.reviews.length, fresh: this.newIds.length, learning: new Set(this.pipe.map(p => p.id)).size };
  };
  Session.prototype.next = function () {
    const ready = this.pipe.filter(p => p.readyAt <= this.pos).sort((a, b) => a.readyAt - b.readyAt)[0];
    if (ready) return this.make(ready.id, 'pipe');
    const capped = this.limit && this.pos >= this.limit;
    if (!capped && !this.practice) {
      const canNew = this.newIds.length > 0 && new Set(this.pipe.map(p => p.id)).size < 3;
      if (canNew && (!this.reviews.length || this.pos % 3 === 2)) return this.make(this.newIds[0], 'new');
      if (this.reviews.length) return this.make(this.reviews[0], 'review');
      if (canNew) return this.make(this.newIds[0], 'new');
    }
    if (this.pipe.length) {
      const soonest = this.pipe.slice().sort((a, b) => a.readyAt - b.readyAt)[0];
      return this.make(soonest.id, 'pipe');
    }
    return null;
  };
  Session.prototype.make = function (id, source) {
    const word = this.byId.get(id);
    const card = this.practice ? null : this.env.cards[id];
    let exercise;
    if (this.practice) {
      const pseudo = { st: 'review', s: 5 };
      exercise = pickExercise(word, pseudo, { settings: this.env.settings, rng: this.env.rng, recent: this.recent, canListen: this.env.canListen, phrases: this.env.phrases });
    } else {
      exercise = pickExercise(word, source === 'new' ? null : card, { settings: this.env.settings, rng: this.env.rng, recent: this.recent, canListen: this.env.canListen, phrases: this.env.phrases });
    }
    return { id, word, card, exercise, source };
  };
  /* Слово показали як нове: learn = вчити, known = вже знаю */
  /* Знімок стану перед дією, щоб її можна було скасувати */
  const clone = o => (o == null ? o : JSON.parse(JSON.stringify(o)));
  Session.prototype.snapshot = function (id) {
    const env = this.env;
    this.history.push({
      id, had: Object.prototype.hasOwnProperty.call(env.cards, id), card: clone(env.cards[id]), log: clone(env.log || {}),
      pipe: this.pipe.map(p => Object.assign({}, p)), reviews: this.reviews.slice(), newIds: this.newIds.slice(), pos: this.pos, recent: this.recent.slice()
    });
    if (this.history.length > 20) this.history.shift();
  };
  Session.prototype.canUndo = function () { return this.history.length > 0; };
  Session.prototype.introduce = function (id, known) {
    const env = this.env;
    this.snapshot(id);
    this.newIds = this.newIds.filter(x => x !== id);
    if (known) {
      env.cards[id] = knownCard(env.today, env.settings.retention, env.rng);
      if (env.log) { env.log.k = (env.log.k || 0) + 1; env.log.c = (env.log.c || 0) + 1; }
    } else {
      env.cards[id] = newCard(env.today);
      if (env.log) env.log.n = (env.log.n || 0) + 1;
      this.pipe.push({ id, readyAt: this.pos + 1 + STEP_GAP[1] });
    }
    this.pos++;
  };
  /* Відповідь на вправу. g: 1 не знаю, 2 важко/з підказкою, 3 знаю, 4 легко */
  Session.prototype.answer = function (id, g, exercise) {
    const env = this.env, log = env.log || {};
    this.snapshot(id);
    this.recent.unshift(exercise); this.recent.length = Math.min(this.recent.length, 2);
    log.r = (log.r || 0) + 1;
    if (g === 1) {
      log.a = (log.a || 0) + 1;
      log.miss = log.miss || [];
      if (!log.miss.includes(id)) log.miss.push(id);
    }
    this.pipe = this.pipe.filter(p => p.id !== id);
    this.reviews = this.reviews.filter(x => x !== id);
    let res;
    // Тренування або слово без картки (видалене під час заняття): розклад не чіпаємо
    if (this.practice || !env.cards[id]) {
      res = g >= 2 ? { done: true } : { again: true, gap: 3 };
    } else {
      const card = env.cards[id];
      const wasReview = card.st === 'review';
      res = applyGrade(card, g, { today: env.today, retention: env.settings.retention || 0.9, rng: env.rng });
      env.cards[id] = res.card;
      if (wasReview) { log.rv = (log.rv || 0) + 1; if (g > 1) log.rok = (log.rok || 0) + 1; }
      if (res.done) log.c = (log.c || 0) + 1;
    }
    this.pos++;
    if (res.again) this.pipe.push({ id, readyAt: this.pos + (res.gap || 3) });
    return res;
  };

  /* Скасувати останню дію (відповідь або знайомство з новим словом). Повертає id слова або false */
  Session.prototype.undo = function () {
    const u = this.history.pop();
    if (!u) return false;
    const env = this.env;
    if (!this.practice) { if (u.had) env.cards[u.id] = u.card; else delete env.cards[u.id]; }
    if (env.log) { Object.keys(env.log).forEach(k => { delete env.log[k]; }); Object.assign(env.log, u.log); }
    this.pipe = u.pipe; this.reviews = u.reviews; this.newIds = u.newIds; this.pos = u.pos; this.recent = u.recent;
    return u.id;
  };

  /* ---------- Серія днів з одним вихідним на тиждень ----------
     Один пропущений день між двома днями занять серію не обриває, якщо за попередні
     7 днів вихідного ще не було. Вихідний не додається до числа днів. */
  function streakInfo(has, today) {
    const todayDone = !!has(today);
    let d = todayDone ? today : today - 1;
    let days = 0, lastRest = null;
    const rests = [];
    for (let guard = 0; guard < 4000; guard++) {
      if (has(d)) { days++; d--; continue; }
      if (has(d - 1) && (lastRest == null || lastRest - d >= 7)) { rests.push(d); lastRest = d; d--; continue; }
      break;
    }
    // Чи можна сьогодні пропустити без втрати серії: вчора було заняття, і вихідний давно
    const restReady = days > 0 && !todayDone && has(today - 1) && !rests.some(r => r > today - 7);
    return { days, rests, todayDone, restReady };
  }

  /* ---------- Порада щодо темпу: скільки нових слів брати на день ----------
     Дивимось на точність повторень за останні 7 днів (log.rv / log.rok). Коли вона падає нижче 75 %,
     слова не встигають закріплюватися і черга повторень росте: краще менше нових, але міцніше.
     Коли понад 93 % і боргу немає, можна брати більше. Поради немає, поки повторень замало. */
  function paceAdvice(log, settings, today, overdue) {
    let rv = 0, rok = 0, days = 0;
    for (let d = today - 6; d <= today; d++) {
      const l = log[dayKey(d)];
      if (!l || !l.rv) continue;
      rv += l.rv; rok += l.rok || 0; days++;
    }
    const per = (settings && settings.newPerDay) || 10;
    if (rv < 30 || days < 3) return null;
    const acc = rok / rv;
    if (acc < 0.75 && per > 3) return { kind: 'slow', acc, rv, from: per, to: Math.max(3, Math.round(per * 0.6)) };
    if (acc >= 0.93 && !overdue && rv >= 40 && per < 30) return { kind: 'fast', acc, rv, from: per, to: Math.min(30, per + Math.max(2, Math.round(per * 0.3))) };
    return null;
  }

  /* ---------- Діалоги ----------
     Озвучка діалогу — один файл: спершу всі репліки поспіль (так грає «Слухати весь діалог»), потім варіанти
     alt по черзі реплік, потім ключові фрази. tools/dialogue_audio.py кладе їх у тому самому порядку. */
  function dialogYou(d) { return Object.keys(d.roles).find(k => d.roles[k].you) || 'b'; }
  function dialogClips(d) {
    const out = [];
    d.lines.forEach((l, i) => out.push({ k: 'l', i, s: l.s, text: l.say || l.en }));
    d.lines.forEach((l, i) => (l.alt || []).forEach((a, j) => out.push({ k: 'a', i, j, s: l.s, text: a.say || a.en })));
    (d.phrases || []).forEach((p, i) => out.push({ k: 'p', i, s: dialogYou(d), text: p.say || p.en }));
    return out;
  }
  /* Номер шматка в DLG_AUDIO: репліка i, її варіант j або ключова фраза */
  function dialogClipIndex(d, k, i, j) {
    return dialogClips(d).findIndex(c => c.k === k && c.i === i && (k !== 'a' || c.j === j));
  }
  /* Тренування за діалогом, від легшого до складнішого:
     «Послухай і вибери переклад» (репліки співрозмовника), «Що ти відповіси?» (твоя репліка після його),
     «Склади свою репліку» з плиток. me — чию роль тренуємо. */
  function dialogTasks(d, me, rng, sizes) {
    rng = rng || Math.random;
    me = me || dialogYou(d);
    const other = me === 'a' ? 'b' : 'a';
    const L = d.lines;
    const n = Object.assign({ listen: 4, reply: 3, order: 3 }, sizes);
    const all = L.map((l, i) => i);
    const of = s => all.filter(i => L[i].s === s);
    const pick = (arr, k) => shuffle(arr.slice(), rng).slice(0, k).sort((a, b) => a - b);
    const listen = pick(of(other).filter(i => tokens(L[i].en).length >= 3), n.listen).map(i => {
      const wrong = shuffle(all.filter(j => j !== i && L[j].uk !== L[i].uk), rng).slice(0, 3);
      const opts = shuffle([i].concat(wrong), rng);
      return { type: 'listen', li: i, opts, a: opts.indexOf(i) };
    });
    const replyable = of(me).filter(i => i > 0 && L[i - 1].s === other);
    const reply = pick(replyable, n.reply).map(i => {
      // Неправильні варіанти — твої ж репліки з інших місць розмови, не сусідні
      const wrong = shuffle(of(me).filter(j => Math.abs(j - i) > 2), rng).slice(0, 2);
      const opts = shuffle([i].concat(wrong), rng);
      return { type: 'reply', li: i, prev: i - 1, opts, a: opts.indexOf(i) };
    });
    const usedReply = new Set(reply.map(t => t.li));
    const buildable = of(me).filter(i => { const t = tokens(L[i].en).length; return t >= 4 && t <= 12; });
    const fresh = buildable.filter(i => !usedReply.has(i));
    // Спершу репліки, яких не було в «Що ти відповіси?»
    const orderIds = shuffle(fresh.slice(), rng).concat(shuffle(buildable.filter(i => usedReply.has(i)), rng))
      .slice(0, n.order).sort((a, b) => a - b);
    const order = orderIds.map(i => {
      const toks = tokens(L[i].en);
      let words = shuffle(toks.slice(), rng), guard = 0;
      while (words.join(' ') === toks.join(' ') && guard++ < 8) words = shuffle(words, rng);
      return { type: 'order', li: i, words };
    });
    return listen.concat(reply, order);
  }
  /* Чи правильно складено репліку: ті самі слова в тому ж порядку (без різниці у великих літерах і апострофах) */
  function dialogOrderOk(line, placed) {
    const want = tokens(line.en).map(t => t.toLowerCase());
    const got = placed.map(t => String(t).toLowerCase().replace(/’/g, "'"));
    return want.length === got.length && want.every((t, i) => t === got[i]);
  }
  /* Коли повторити діалог після рольової гри: добре — 3 дні, далі ×2,5 до 90; погано — завтра */
  function dialogSchedule(prev, ratio, today) {
    let iv;
    if (ratio >= 0.8) iv = prev && prev.iv >= 3 ? Math.min(90, Math.round(prev.iv * 2.5)) : 3;
    else iv = 1;
    return { iv, due: today + iv };
  }
  /* Три етапи діалогу: прослухав повністю, тренування на 80 %+, зіграв свою роль */
  function dialogStars(r, d) {
    if (!r) return 0;
    const me = d ? dialogYou(d) : 'b';
    return (r.heard ? 1 : 0) + (r.tr >= 0.8 ? 1 : 0) + (r.role && r.role[me] ? 1 : 0);
  }
  /* Діалоги, які час повторити (пройдені, день настав), найдавніші першими */
  function dialogDue(dres, order, today) {
    return order.filter(id => { const r = dres[id]; return r && r.due != null && r.due <= today; })
      .sort((a, b) => dres[a].due - dres[b].due);
  }

  /* ---------- Диктант: почуй речення й напиши його ----------
     Порівняння по словах: скорочення розгортаються з обох боків (I'm = I am), різниця в одну літеру
     (у довгих словах — у дві) — описка, а не помилка. Кожне слово еталона отримує стан ok / typo / miss,
     зайві написані слова рахуються окремо. */
  const DICT_EXPAND = {
    "i'm": 'i am', "you're": 'you are', "we're": 'we are', "they're": 'they are', "it's": 'it is', "that's": 'that is',
    "there's": 'there is', "here's": 'here is', "what's": 'what is', "where's": 'where is', "who's": 'who is', "how's": 'how is',
    "he's": 'he is', "she's": 'she is', "let's": 'let us', "i've": 'i have', "you've": 'you have', "we've": 'we have',
    "they've": 'they have', "i'll": 'i will', "you'll": 'you will', "he'll": 'he will', "she'll": 'she will', "it'll": 'it will',
    "we'll": 'we will', "they'll": 'they will', "that'll": 'that will', "i'd": 'i would', "you'd": 'you would', "he'd": 'he would',
    "she'd": 'she would', "we'd": 'we would', "they'd": 'they would', "isn't": 'is not', "aren't": 'are not', "wasn't": 'was not',
    "weren't": 'were not', "don't": 'do not', "doesn't": 'does not', "didn't": 'did not', "can't": 'can not', "cannot": 'can not',
    "couldn't": 'could not', "won't": 'will not', "wouldn't": 'would not', "shouldn't": 'should not', "haven't": 'have not',
    "hasn't": 'has not', "hadn't": 'had not', "mustn't": 'must not', "needn't": 'need not', "gonna": 'going to', "wanna": 'want to',
    'ok': 'okay'
  };
  // Скорочення без апострофа, як їх часто набирають на телефоні (dont, im). Справжні слова (ill, well, its) не чіпаємо
  const DICT_NOAPO = {};
  Object.keys(DICT_EXPAND).forEach(k => { const b = k.replace(/'/g, ''); if (b !== k && !['ill', 'well', 'were', 'shed', 'wed', 'hell', 'its', 'lets', 'wont', 'id', 'shell', 'hed', 'whos', 'hes'].includes(b)) DICT_NOAPO[b] = k; });
  function dictWords(s, typed) {
    // Слова з посиланням на вихідне слово (щоб розфарбувати саме його)
    const out = [];
    tokens(String(s || '').replace(/[-–—]/g, ' ')).forEach((t, i) => {
      let low = t.toLowerCase();
      if (typed && DICT_NOAPO[low]) low = DICT_NOAPO[low];
      const exp = DICT_EXPAND[low];
      (exp ? exp.split(' ') : [low]).forEach(x => out.push({ t: x, i }));
    });
    return out;
  }
  function dictNear(a, b) {
    if (a === b) return 2;
    const n = Math.max(a.length, b.length);
    if (n < 4) return 0;
    return levenshtein(a, b) <= (n >= 8 ? 2 : 1) ? 1 : 0;
  }
  function dictationCheck(target, typed) {
    const shown = tokens(String(target || '').replace(/[-–—]/g, ' '));
    const T = dictWords(target), G = dictWords(typed, true);
    // Найдовша спільна послідовність з вагами: точний збіг 2, описка 1
    const n = T.length, m = G.length;
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        const s = dictNear(T[i].t, G[j].t);
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1], s ? s + dp[i + 1][j + 1] : 0);
      }
    }
    const tState = new Array(n).fill('miss'), tGot = new Array(n).fill('');
    const pairs = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      const s = dictNear(T[i].t, G[j].t);
      if (s && dp[i][j] === s + dp[i + 1][j + 1]) { tState[i] = s === 2 ? 'ok' : 'typo'; tGot[i] = G[j].t; pairs.push([i, j]); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
      else j++;
    }
    // Проміжки між збігами: «get» замість «got» — неправильне слово на своєму місці, а не пропуск і зайве;
    // «every thing» замість «everything» — описка
    const extra = [];
    pairs.push([n, m]);
    let pi = -1, pj = -1;
    pairs.forEach(([a, b]) => {
      const tg = [], gg = [];
      for (let x = pi + 1; x < a; x++) tg.push(x);
      for (let y = pj + 1; y < b; y++) gg.push(y);
      if (tg.length === 1 && gg.length === 2 && G[gg[0]].t + G[gg[1]].t === T[tg[0]].t) {
        tState[tg[0]] = 'typo'; tGot[tg[0]] = G[gg[0]].t + ' ' + G[gg[1]].t;
      } else {
        const k = Math.min(tg.length, gg.length);
        for (let z = 0; z < k; z++) { tState[tg[z]] = 'bad'; tGot[tg[z]] = G[gg[z]].t; }
        for (let z = k; z < gg.length; z++) extra.push(G[gg[z]].t);
      }
      pi = a; pj = b;
    });
    // Стан вихідного слова: найгірший з його частин (I'm = I + am)
    const rank = { ok: 0, typo: 1, bad: 2, miss: 3 };
    const words = shown.map(w => ({ w, st: 'ok', got: '' }));
    T.forEach((x, k) => {
      const o = words[x.i];
      if (rank[tState[k]] > rank[o.st]) o.st = tState[k];
      if (tGot[k] && tState[k] !== 'ok') o.got = (o.got ? o.got + ' ' : '') + tGot[k];
    });
    const ok = words.filter(w => w.st === 'ok').length, typo = words.filter(w => w.st === 'typo').length;
    const score = words.length ? Math.max(0, (ok + 0.5 * typo - 0.5 * extra.length) / words.length) : 0;
    return { words, extra, ok, typo, wrong: words.length - ok - typo, score, perfect: ok === words.length && !extra.length };
  }
  /* Підказка: перша літера кожного слова, решта рисками (Have you got → H___ y__ g__) */
  function dictSkeleton(s) {
    return String(s || '').replace(/[A-Za-z][A-Za-z'’]*/g, w => w[0] + w.slice(1).replace(/[A-Za-z]/g, '_'));
  }
  /* Речення для диктанту: приклади слів, які вже вчиш (свіжіші частіше), 4–12 слів, без цифр */
  function dictationPool(words, cards) {
    const out = [];
    words.forEach(w => {
      const c = cards[w.id];
      if (!c || c.st === 'new' || !(c.reps > 0)) return;
      [['x', w.ex, w.exUk], ['x2', w.ex2, w.ex2Uk]].forEach(([k, en, uk]) => {
        if (!en || !uk || /\d/.test(en)) return;
        const n = tokens(en).length;
        if (n >= 4 && n <= 12) out.push({ id: w.id, k, en, uk, last: c.last != null ? c.last : 0 });
      });
    });
    return out;
  }
  function pickDictation(words, cards, n, rng) {
    rng = rng || Math.random;
    const pool = dictationPool(words, cards);
    if (!pool.length) return [];
    // Половина — з 60 найсвіжіших слів, решта — з усіх; одне слово дає не більше одного речення
    const fresh = pool.slice().sort((a, b) => b.last - a.last).slice(0, 120);
    const seen = new Set(), out = [];
    const take = arr => { for (const s of shuffle(arr.slice(), rng)) { if (out.length >= n) return; if (!seen.has(s.id)) { seen.add(s.id); out.push(s); } } };
    const half = Math.ceil(n / 2);
    take(fresh.slice(0, Math.max(half * 2, 12)));
    if (out.length > half) out.length = half;
    take(pool);
    return out;
  }

  /* ---------- Розповідь 4/3/2: та сама історія тричі, щоразу коротше ----------
     Методика Пола Нейшна: повтор з тиском часу робить мовлення плавнішим, бо слова й будова речень
     уже знайдені в першому раунді. Для рівня A2 раунди 2:00, 1:30 і 1:00. */
  const TELL_ROUNDS = [120, 90, 60];
  function pickTalk(talks, used, today, rng) {
    rng = rng || Math.random;
    if (!talks.length) return null;
    // Найдавніше розказана (або ще не розказана) тема, серед рівних — випадкова
    const score = t => (used && used[t.id] != null ? used[t.id] : -1e9) + rng();
    return talks.slice().sort((a, b) => score(a) - score(b))[0];
  }
  /* Слова, які варто вжити в розповіді: вивчені за останні 14 днів, одне слово (не вираз) */
  function talkWords(words, cards, today, n, rng) {
    rng = rng || Math.random;
    const pool = words.filter(w => {
      const c = cards[w.id];
      return c && c.st !== 'new' && c.first != null && today - c.first <= 14 && tokens(w.en.replace(/^to /, '')).length <= 3;
    });
    return shuffle(pool, rng).slice(0, n);
  }

  /* ---------- Завдання дня (як щоденні квести в Duolingo) ----------
     Три завдання на день: одне на обсяг заняття, одне на якість, одне на іншу методику. Набір залежить
     лише від дня (той самий весь день), прогрес — із сьогоднішнього запису в журналі. */
  function dayRng(day) {
    let s = Math.abs(Math.floor(day * 7919 + 104729)) % 2147483647 || 1;
    return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  }
  function dailyQuests(day, l, opt) {
    l = l || {};
    opt = opt || {};
    const rng = dayRng(day);
    const pick = arr => { const a = arr.filter(Boolean); return a.length ? a[Math.floor(rng() * a.length)] : null; };
    const minutes = Math.floor(((l.ms || 0) + (l.lms || 0)) / 60000);
    const study = pick([
      { id: 'answers', icon: 'check', title: 'Дай 30 відповідей у заняттях', target: 30, value: l.r || 0, go: 'session' },
      { id: 'minutes', icon: 'timer', title: 'Позаймайся 12 хвилин', target: 12, value: minutes, go: 'session' },
      { id: 'right', icon: 'target', title: '25 правильних відповідей', target: 25, value: Math.max(0, (l.r || 0) - (l.a || 0)), go: 'session' }
    ]);
    const skill = pick([
      { id: 'combo', icon: 'flame', title: '8 правильних відповідей поспіль', target: 8, value: l.cb || 0, go: 'session' },
      opt.newWords ? { id: 'new', icon: 'plus', title: 'Познайомся з 5 новими словами', target: 5, value: l.n || 0, go: 'session' } : null
    ]);
    const method = pick([
      opt.dialogs ? { id: 'dialog', icon: 'chat', title: 'Діалог: тренування або рольова гра', target: 1, value: (l.dlr || []).length, go: 'dialogs' } : null,
      opt.dict ? { id: 'dict', icon: 'dictation', title: 'Диктант: напиши 10 речень', target: 10, value: l.dc || 0, go: 'dict' } : null,
      opt.tell ? { id: 'tell', icon: 'speak', title: 'Розповідь 4/3/2: три раунди вголос', target: 3, value: l.tk || 0, go: 'tell' } : null,
      opt.grammar ? { id: 'grammar', icon: 'pen', title: 'Граматика: 12 завдань', target: 12, value: (l.gt || 0) + (l.gp || 0), go: 'grammar' } : null,
      opt.listen ? { id: 'listen', icon: 'listen', title: 'Послухай 20 слів у режимі «Слухати»', target: 20, value: l.ls || 0, go: 'listen' } : null
    ]);
    return [study, skill, method].filter(Boolean).map(q => Object.assign({}, q, { done: q.value >= q.target, value: Math.min(q.target, q.value) }));
  }

  /* ---------- Календар і карта активності ----------
     Дні — номери dayNum. Тиждень з понеділка. Рівень активності 0–4 за кількістю відповідей і вправ. */
  function weekdayOf(n) { return (new Date(n * 86400000).getUTCDay() + 6) % 7; }   // 0 = понеділок
  function monthOf(n) { const k = dayKey(n); return { y: +k.slice(0, 4), m: +k.slice(5, 7) - 1 }; }
  function monthGrid(y, m) {
    const first = Math.floor(Date.UTC(y, m, 1) / 86400000);
    const last = Math.floor(Date.UTC(y, m + 1, 1) / 86400000) - 1;
    const weeks = [];
    let week = new Array(weekdayOf(first)).fill(null);
    for (let d = first; d <= last; d++) {
      week.push(d);
      if (week.length === 7) { weeks.push(week); week = []; }
    }
    if (week.length) { while (week.length < 7) week.push(null); weeks.push(week); }
    return weeks;
  }
  function activityScore(l) {
    if (!l) return 0;
    return (l.r || 0) + (l.gt || 0) + (l.gp || 0) + (l.dl || 0) + (l.dc || 0) + (l.tk || 0) * 5 + Math.round((l.ls || 0) / 2);
  }
  function activityLevel(score) { return score <= 0 ? 0 : score < 15 ? 1 : score < 40 ? 2 : score < 80 ? 3 : 4; }
  function activityWeeks(log, today, weeks) {
    const end = today + (6 - weekdayOf(today));
    const start = end - weeks * 7 + 1;
    const out = [];
    for (let w = 0; w < weeks; w++) {
      const col = [];
      for (let i = 0; i < 7; i++) {
        const d = start + w * 7 + i;
        const s = d > today ? -1 : activityScore(log[dayKey(d)]);
        col.push({ d, score: Math.max(0, s), lvl: s < 0 ? -1 : activityLevel(s) });
      }
      out.push(col);
    }
    return out;
  }
  /* Найдовша серія за весь журнал (з тим самим правилом вихідного: один пропуск на 7 днів) */
  function bestStreak(has, from, today) {
    let best = 0, cur = 0, lastRest = null;
    for (let d = from; d <= today; d++) {
      if (has(d)) { cur++; best = Math.max(best, cur); continue; }
      if (cur > 0 && has(d + 1) && (lastRest == null || d - lastRest >= 7)) { lastRest = d; continue; }
      if (d === today) continue;
      cur = 0; lastRest = null;
    }
    return best;
  }

  const api = {
    dailyQuests, weekdayOf, monthOf, monthGrid, activityScore, activityLevel, activityWeeks, bestStreak,
    dictationCheck, dictSkeleton, dictationPool, pickDictation, TELL_ROUNDS, pickTalk, talkWords,
    dialogYou, dialogClips, dialogClipIndex, dialogTasks, dialogOrderOk, dialogSchedule, dialogStars, dialogDue,
    paceAdvice,
    dayNum, dayKey, fmtDate, plural, norm, expand, levenshtein, diffMarks, checkAnswer, answerTargets,
    wordForms, clozeTarget, clozeIn, phraseTargets, baseForm, spellTarget, ctxTarget, tokens, canBuildPhrase, canBuildSentence, canSaySentence, canType, canDictate, isPhrase,
    EXERCISES, pickExercise, eligible, distractors, posClass, shortSense, optionLabels, shuffle, CONFUSABLE, confusables, exampleFor, withExample, sprintPool,
    LEARN_STEPS, LEECH, newCard, knownCard, isLeech, strength, statusOf, previewIntervals, applyGrade,
    migrateV2, orderNew, Session, SOUND_EXERCISES, streakInfo, lemmaCandidates, lookupIndex, backlogLimit, grammarMatch, taskKey, dayShuffle, taskSrs, practiceDue, pickPractice, pickMistakes, pickTopicPractice, pickTasks, grammarSchedule, pickSectionTasks
  };
  root.EWCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

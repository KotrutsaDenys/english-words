// Тести логіки: node tests/core.test.js
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const F = require('../public/js/fsrs.js');
const C = require('../public/js/core.js');

const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/words.js'), 'utf8'), ctx);
if (fs.existsSync(path.join(__dirname, '../public/words-base.js'))) vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/words-base.js'), 'utf8'), ctx);
const WORDS = ctx.window.WORDS;
const byId = id => WORDS.find(w => w.id === id);
let passed = 0;
function test(name, fn) { fn(); passed++; }

function seeded(seed) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }

test('FSRS: початкові значення', () => {
  assert.strictEqual(F.init(3).s, 3.173);
  assert.strictEqual(F.interval(3.173, 0.9), 3);
  assert.ok(Math.abs(F.retrievability(10, 10) - 0.9) < 1e-9);
  assert.ok(F.init(1).d > F.init(3).d && F.init(3).d > F.init(4).d);
});
test('FSRS: успіх збільшує, провал зменшує стабільність', () => {
  const st = F.init(3);
  const good = F.next(st, 3, 3), hard = F.next(st, 2, 3), easy = F.next(st, 4, 3), again = F.next(st, 1, 3);
  assert.ok(good.s > st.s && easy.s > good.s && hard.s < good.s, JSON.stringify({ good, hard, easy }));
  assert.ok(again.s < st.s && again.d > st.d);
  assert.ok(F.interval(good.s, 0.9) > F.interval(st.s, 0.9));
  assert.ok(F.interval(10, 0.95) < F.interval(10, 0.9) && F.interval(10, 0.85) > F.interval(10, 0.9));
});
test('FSRS: fuzz тримається поруч', () => {
  const rng = seeded(7);
  for (let i = 0; i < 200; i++) { const v = F.interval(30, 0.9, rng); assert.ok(v >= 27 && v <= 33, v); }
});

test('Перевірка відповіді', () => {
  const t = C.answerTargets('to skim');
  assert.strictEqual(C.checkAnswer('Skim', t).result, 'exact');
  assert.strictEqual(C.checkAnswer('to skim', t).result, 'exact');
  assert.strictEqual(C.checkAnswer('trowl', C.answerTargets('trowel')).result, 'typo');
  assert.strictEqual(C.checkAnswer('towel', C.answerTargets('trowel')).result, 'typo');
  assert.strictEqual(C.checkAnswer('hammer', C.answerTargets('trowel')).result, 'wrong');
  assert.strictEqual(C.checkAnswer('whats the craic', C.answerTargets("What's the craic?")).result, 'exact');
  assert.strictEqual(C.checkAnswer('what is the craic', C.answerTargets("What's the craic?")).result, 'exact');
  assert.strictEqual(C.checkAnswer('craic', C.answerTargets('the craic')).result, 'exact');
  assert.strictEqual(C.checkAnswer('come here', C.answerTargets("C'mere")).result, 'exact');
  assert.strictEqual(C.checkAnswer('', C.answerTargets('yet')).result, 'wrong');
  assert.strictEqual(C.checkAnswer('yes', C.answerTargets('yet')).result, 'wrong');
  assert.strictEqual(C.checkAnswer('I cannot', C.answerTargets("I can't")).result, 'exact');
});

test('Речення з пропуском', () => {
  const cases = {
    'site-trowel': 'trowel', 'site-set': 'sets', 'site-knockoff': 'knock off', 'irish-craic': 'craic',
    'talk-cheers': 'Cheers', 'core-get': 'get', 'verbs-runout': 'run out of', 'core-spend': 'spent', 'talk-catch': 'catch'
  };
  for (const [id, expect] of Object.entries(cases)) {
    const r = C.clozeTarget(byId(id));
    assert.ok(r, id);
    assert.strictEqual(r.text, expect, id + ' -> ' + r.text);
  }
  assert.strictEqual(C.clozeTarget(byId('site-dry')), null);
  const withCloze = WORDS.filter(w => C.clozeTarget(w)).length;
  assert.ok(withCloze > WORDS.length * 0.5, 'cloze coverage ' + withCloze);
});

test('Слова для «склади»', () => {
  assert.deepStrictEqual(C.tokens("Pass me the trowel, please."), ['Pass', 'me', 'the', 'trowel', 'please']);
  assert.deepStrictEqual(C.tokens("I'm on my way"), ["I'm", 'on', 'my', 'way']);
  assert.ok(C.canBuildPhrase(byId('talk-slowly')));
  assert.ok(!C.canBuildPhrase(byId('site-trowel')));
  assert.ok(!C.canType(byId('phone-speakto')));
});

test('Вибір вправи поважає налаштування', () => {
  const rng = seeded(3);
  const w = byId('site-trowel');
  const card = { st: 'review', s: 10, d: 5, last: 0, due: 10 };
  for (let i = 0; i < 100; i++) {
    const e = C.pickExercise(w, card, { settings: { typing: false, speaking: false }, rng, canListen: true });
    assert.ok(!['type_en', 'cloze', 'dictation', 'speak'].includes(e), e);
  }
  for (let i = 0; i < 50; i++) {
    const e = C.pickExercise(w, card, { settings: { mode: 'cards' }, rng });
    assert.ok(e === 'flip' || e === 'flip_rev', e);
  }
  assert.strictEqual(C.pickExercise(w, null, { settings: {} }), 'intro');
  assert.strictEqual(C.pickExercise(w, { st: 'learn', step: 2 }, { settings: {} }), 'mcq_uk_en');
});

test('Відволікаючі варіанти без повторів', () => {
  const rng = seeded(11);
  for (const w of WORDS.slice(0, 80)) {
    const d = C.distractors(w, WORDS, 'uk', 3, rng);
    assert.strictEqual(d.length, 3);
    const set = new Set(d.map(x => C.norm(x.uk)).concat([C.norm(w.uk)]));
    assert.strictEqual(set.size, 4, w.id);
  }
});

test('Порядок нових слів змішує теми', () => {
  const order = C.orderNew(WORDS, {}, null).slice(0, 20).map(w => w.cat);
  assert.ok(new Set(order).size >= 5, order.join(','));
  const mine = [{ id: 'u1', cat: 'mine', en: 'x', uk: 'y' }].concat(WORDS);
  assert.strictEqual(C.orderNew(mine, {}, null)[0].id, 'u1');
});

function runDay(env, answerFn) {
  const s = new C.Session(env);
  let guard = 0, item;
  while ((item = s.next()) && guard++ < 1000) {
    if (item.source === 'new') { s.introduce(item.id, false); continue; }
    s.answer(item.id, answerFn(item), item.exercise);
  }
  assert.ok(guard < 1000, 'session did not finish');
  return s;
}

test('Перший день: 10 нових проходять кроки і плануються', () => {
  const env = { words: WORDS, cards: {}, settings: { newPerDay: 10, retention: 0.9 }, today: 1000, log: {}, rng: seeded(5), canListen: true };
  const s = runDay(env, () => 3);
  const ids = Object.keys(env.cards);
  assert.strictEqual(ids.length, 10);
  for (const id of ids) {
    const c = env.cards[id];
    assert.strictEqual(c.st, 'review', id);
    assert.ok(c.due >= 1002 && c.due <= 1004, id + ' due ' + c.due);
  }
  assert.strictEqual(env.log.c, 10);
  assert.strictEqual(env.log.n, 10);
  assert.ok(s.pos >= 40 && s.pos <= 45, 'pos ' + s.pos);
});

test('Помилки повертають слово і знижують перший інтервал', () => {
  const env = { words: WORDS, cards: {}, settings: { newPerDay: 3, retention: 0.9 }, today: 2000, log: {}, rng: seeded(9), canListen: true };
  let wrongOnce = new Set();
  runDay(env, item => {
    if (item.card && item.card.st === 'learn' && item.card.step === 3 && !wrongOnce.has(item.id)) { wrongOnce.add(item.id); return 1; }
    return 3;
  });
  for (const id of Object.keys(env.cards)) {
    assert.strictEqual(env.cards[id].st, 'review');
    assert.strictEqual(env.cards[id].due, 2001, 'hard first interval for ' + id);
  }
  assert.strictEqual(env.log.miss.length, 3);
});

test('Місяць навчання: стабільність росте, провали йдуть на перенавчання', () => {
  const rng = seeded(21);
  const env = { words: WORDS, cards: {}, settings: { newPerDay: 10, retention: 0.9 }, rng, canListen: true };
  const logs = {};
  for (let day = 0; day < 30; day++) {
    env.today = 5000 + day;
    env.log = logs[day] = {};
    runDay(env, item => {
      if (item.card && item.card.st === 'review') {
        const p = C.strength(item.card, env.today);
        return rng() < p ? 3 : 1;
      }
      return rng() < 0.85 ? 3 : 1;
    });
    for (const id in env.cards) {
      const c = env.cards[id];
      assert.ok(c.st === 'review', 'end of day ' + day + ' ' + id + ' ' + c.st);
      assert.ok(c.due > env.today, 'due in future');
      assert.ok(c.d >= 1 && c.d <= 10 && c.s > 0);
    }
  }
  const cards = Object.values(env.cards);
  assert.strictEqual(cards.length, 300);
  const reviewsLastWeek = Object.keys(logs).slice(-7).reduce((a, d) => a + (logs[d].rv || 0), 0);
  assert.ok(reviewsLastWeek / 7 < 60, 'reviews per day ' + reviewsLastWeek / 7);
  const strong = cards.filter(c => c.s > 20).length;
  assert.ok(strong > 20, 'strong ' + strong);
});

test('Ліміт сесії зупиняє нові й повторення, але дає довчити почате', () => {
  const env = { words: WORDS, cards: {}, settings: { newPerDay: 20, retention: 0.9, sessionLen: 15 }, today: 9000, log: {}, rng: seeded(2), canListen: true };
  const s = runDay(env, () => 3);
  const learning = Object.values(env.cards).filter(c => c.st === 'learn').length;
  assert.strictEqual(learning, 0);
  assert.ok(Object.keys(env.cards).length < 20);
});

test('«Вже знаю» не забирає ліміт нових', () => {
  const env = { words: WORDS, cards: {}, settings: { newPerDay: 5, retention: 0.9 }, today: 9100, log: {}, rng: seeded(4), canListen: true };
  const s = new C.Session(env);
  const first = s.next();
  s.introduce(first.id, true);
  assert.strictEqual(env.cards[first.id].st, 'review');
  assert.ok(env.cards[first.id].due - 9100 >= 12);
  assert.strictEqual(env.log.n || 0, 0);
});

test('Тренування помилок не змінює розклад', () => {
  const cards = { 'site-trowel': { st: 'review', s: 5, d: 5, last: 10, due: 15, reps: 2, lapses: 0 } };
  const before = JSON.stringify(cards);
  const env = { words: WORDS, cards, settings: {}, today: 12, log: {}, rng: seeded(1), practiceIds: ['site-trowel'], canListen: true };
  const s = new C.Session(env);
  let item = s.next(); s.answer(item.id, 1, item.exercise);
  item = s.next(); s.answer(item.id, 3, item.exercise);
  assert.strictEqual(s.next(), null);
  assert.strictEqual(JSON.stringify(cards), before);
});

test('Перенесення прогресу з першої версії', () => {
  const old = {
    'site-trowel': { iv: 2, ef: 2.5, reps: 1, lapses: 0, due: 102, first: 100, last: 100 },
    'site-hawk': { iv: 0, ef: 2.3, reps: 0, lapses: 0, due: 100, first: 100, last: 100 }
  };
  const m = C.migrateV2(old, 101);
  assert.strictEqual(m['site-trowel'].st, 'review');
  assert.strictEqual(m['site-trowel'].s, 2);
  assert.strictEqual(m['site-trowel'].due, 102);
  assert.strictEqual(m['site-hawk'].st, 'learn');
  assert.strictEqual(m['site-hawk'].due, 100);
});

test('Оцінка залишку, режим без нових і скасування відповіді', () => {
  const env = { words: WORDS, cards: {}, settings: { newPerDay: 4, retention: 0.9 }, today: 9500, log: {}, rng: seeded(8), canListen: true };
  const s = new C.Session(env);
  assert.strictEqual(s.remainingUnits(), 16);
  const first = s.next(); s.introduce(first.id, false);
  assert.strictEqual(s.remainingUnits(), 15);
  const env2 = { words: WORDS, cards: { 'site-trowel': { st: 'review', s: 3, d: 5, last: 9497, due: 9500, reps: 1, lapses: 0 } },
    settings: { newPerDay: 10, retention: 0.9 }, today: 9500, log: {}, rng: seeded(8), canListen: true, reviewOnly: true };
  const s2 = new C.Session(env2);
  assert.strictEqual(s2.newIds.length, 0);
  const it = s2.next();
  assert.strictEqual(it.id, 'site-trowel');
  const before = JSON.stringify(env2.cards['site-trowel']);
  s2.answer(it.id, 1, it.exercise);
  assert.strictEqual(env2.cards['site-trowel'].st, 'relearn');
  assert.strictEqual(env2.log.a, 1);
  assert.ok(s2.undo());
  assert.strictEqual(JSON.stringify(env2.cards['site-trowel']), before);
  assert.strictEqual(env2.log.a, undefined);
  s2.answer(it.id, 3, it.exercise);
  assert.strictEqual(env2.cards['site-trowel'].st, 'review');
  assert.strictEqual(s2.next(), null);
});

test('Позначення помилок у написанні', () => {
  const m = C.diffMarks('hamer', 'trowel');
  assert.ok(m.some(x => !x.ok));
  assert.ok(C.diffMarks('trowel', 'trowel').every(x => x.ok));
  const fix = C.diffMarks('plasterboard', 'plasterbord').filter(x => !x.ok).map(x => x.ch).join('');
  assert.strictEqual(fix, 'a');
});

test('Слова-плутанки не потрапляють в один день, а потім стають дистракторами', () => {
  const order = C.orderNew(WORDS, {}, null, 10, 1000);
  for (let day = 0; day < 10; day++) {
    const chunk = order.slice(day * 10, day * 10 + 10).map(w => w.id);
    for (const id of chunk) for (const p of C.confusables(id)) assert.ok(!chunk.includes(p), id + ' + ' + p + ' same day');
  }
  const cards = { 'talk-borrow': { st: 'learn', step: 1, first: 1000, due: 1000 } };
  const next = C.orderNew(WORDS, cards, null, 10, 1001).slice(0, 10).map(w => w.id);
  assert.ok(!next.includes('talk-lend'), 'lend deferred after borrow yesterday');
  const rng = seeded(3);
  const lend = byId('talk-lend');
  const close = C.distractors(lend, WORDS, 'uk', 3, rng, true).map(w => w.id);
  assert.ok(close.includes('talk-borrow'), 'close distractors include borrow');
  const far = C.distractors(lend, WORDS, 'uk', 3, rng, false).map(w => w.id);
  assert.ok(!far.includes('talk-borrow'), 'far distractors exclude borrow');
  assert.ok(far.every(id => byId(id).cat !== 'talk'), 'far distractors from other categories');
});

test('Два контексти чергуються', () => {
  const w = byId('site-trowel');
  assert.ok(w.ex2 && w.ex2 !== w.ex);
  assert.strictEqual(C.exampleFor(w, { reps: 0 }).n, 1);
  assert.strictEqual(C.exampleFor(w, { reps: 1 }).n, 2);
  assert.strictEqual(C.exampleFor(w, { reps: 1 }, 'other').n, 1);
  assert.strictEqual(C.withExample(w, { reps: 3 }).ex, w.ex2);
  assert.ok(WORDS.every(x => x.ex2 && x.ex2Uk), 'all words have ex2');
});

test('Спринт бере лише вивчені слова', () => {
  const cards = { 'site-trowel': { st: 'review', reps: 3, s: 10 }, 'site-hawk': { st: 'review', reps: 1, s: 10 }, 'site-float': { st: 'learn' } };
  assert.strictEqual(C.sprintPool(WORDS, cards).map(w => w.id).join(','), 'site-trowel');
});

test('Серія: один вихідний на тиждень не обриває, два пропуски поспіль обривають', () => {
  const T = 5000;
  const on = set => d => set.has(d);
  // Вчилися 5 днів, сьогодні ще ні: серія 5
  let info = C.streakInfo(on(new Set([T - 1, T - 2, T - 3, T - 4, T - 5])), T);
  assert.strictEqual(info.days, 5);
  assert.strictEqual(info.todayDone, false);
  assert.ok(info.restReady, 'можна відпочити сьогодні');
  // Пропуск позавчора: вихідний, серія триває, сам день не рахується
  info = C.streakInfo(on(new Set([T, T - 1, T - 3, T - 4])), T);
  assert.strictEqual(info.days, 4);
  assert.strictEqual(info.rests.join(), String(T - 2));
  // Два вихідні в одному тижні: другий обриває
  info = C.streakInfo(on(new Set([T, T - 2, T - 4, T - 5])), T);
  assert.strictEqual(info.days, 2);
  // Вихідні через тиждень обидва зараховуються
  const many = new Set();
  for (let d = T; d > T - 20; d--) if (d !== T - 3 && d !== T - 11) many.add(d);
  info = C.streakInfo(on(many), T);
  assert.strictEqual(info.days, 18);
  assert.strictEqual(info.rests.length, 2);
  // Два дні поспіль без занять: серії немає
  info = C.streakInfo(on(new Set([T - 3, T - 4])), T);
  assert.strictEqual(info.days, 0);
  // Учора пропуск, позавчора заняття: серія ще жива, сьогоднішнє заняття її продовжить
  info = C.streakInfo(on(new Set([T - 2, T - 3])), T);
  assert.strictEqual(info.days, 2);
  assert.ok(!info.restReady);
});

test('«Вчити першим» ставить слова на початок черги нових', () => {
  const order = C.orderNew(WORDS, {}, null, 10, 1000, ['site-hawk', 'talk-lend']).map(w => w.id);
  assert.strictEqual(order.slice(0, 2).join(), 'site-hawk,talk-lend');
  assert.strictEqual(order.length, WORDS.length);
  assert.strictEqual(new Set(order).size, order.length);
  // Пріоритет діє навіть для вимкненої теми
  const off = C.orderNew(WORDS, {}, { site: false }, 10, 1000, ['site-hawk']).map(w => w.id);
  assert.strictEqual(off[0], 'site-hawk');
  assert.ok(!off.slice(1).some(id => id.startsWith('site-')));
  const env = { words: WORDS, cards: {}, settings: { newPerDay: 3, retention: 0.9 }, today: 1000, log: {}, rng: seeded(5), canListen: true, priority: ['site-hawk'] };
  assert.strictEqual(new C.Session(env).newIds[0], 'site-hawk');
});

test('Тихий режим прибирає вправи на слух і говоріння', () => {
  const w = byId('site-trowel');
  const ctx = { settings: { quiet: true, typing: true, speaking: true }, canListen: true };
  for (const t of C.SOUND_EXERCISES) assert.ok(!C.eligible(t, w, ctx), t);
  assert.ok(C.eligible('mcq_en_uk', w, ctx));
  const rng = seeded(11);
  for (let i = 0; i < 200; i++) {
    const ex = C.pickExercise(w, { st: 'review', s: 40, reps: 6 }, { settings: ctx.settings, rng, recent: [], canListen: true });
    assert.ok(!C.SOUND_EXERCISES.includes(ex), ex);
  }
});

test('Назад: скасування знайомства і кількох відповідей поспіль', () => {
  const env = { words: WORDS, cards: {}, settings: { newPerDay: 3, retention: 0.9 }, today: 9600, log: {}, rng: seeded(9), canListen: true };
  const s = new C.Session(env);
  const first = s.next();
  assert.strictEqual(first.exercise, 'intro');
  const before = s.newIds.slice();
  s.introduce(first.id, false);
  assert.ok(env.cards[first.id] && env.log.n === 1);
  assert.strictEqual(s.undo(), first.id);
  assert.ok(!(first.id in env.cards), 'картку прибрано');
  assert.strictEqual(s.newIds.join(), before.join());
  assert.strictEqual(env.log.n, undefined);
  assert.ok(!s.canUndo());
  // Знайомство і відповідь, потім два кроки назад (одне нове слово, тож далі буде його крок)
  s.newIds = [first.id];
  s.introduce(first.id, false);
  const it = s.next();
  assert.strictEqual(it.id, first.id);
  const snapCards = JSON.stringify(env.cards);
  s.answer(it.id, 1, it.exercise);
  assert.strictEqual(s.undo(), it.id);
  assert.strictEqual(JSON.stringify(env.cards), snapCards);
  assert.strictEqual(s.undo(), first.id);
  assert.strictEqual(Object.keys(env.cards).length, 0);
});

test('Коротке заняття: ліміт задається окремо від налаштувань', () => {
  const cards = {};
  for (let i = 0; i < 30; i++) cards[WORDS[i].id] = { st: 'review', s: 3 + i, d: 5, last: 9690, due: 9700, reps: 2, lapses: 0 };
  const env = { words: WORDS, cards, settings: { newPerDay: 10, retention: 0.9, sessionLen: 0 }, today: 9700, log: {}, rng: seeded(6), canListen: true, reviewOnly: true, limit: 12 };
  const s = new C.Session(env);
  assert.strictEqual(s.remainingUnits(), 12);
  let n = 0, it;
  while ((it = s.next()) && n < 100) { s.answer(it.id, 3, it.exercise); n++; }
  assert.strictEqual(n, 12);
  // Найслабші першими
  const answered = Object.entries(cards).filter(([, c]) => c.last === 9700).map(([id]) => id);
  assert.ok(answered.includes(WORDS[0].id));
});

test('Борг після пропущених днів: нові слова чекають, поки його не розібрано', () => {
  const mk = overdueN => {
    const cards = {};
    for (let i = 0; i < 50; i++) cards[WORDS[i].id] = { st: 'review', s: 5, d: 5, last: 9690, due: i < overdueN ? 9697 : (i < 45 ? 9700 : 9710), reps: 2, lapses: 0 };
    return cards;
  };
  const env = (cards, extra) => Object.assign({ words: WORDS, cards, settings: { newPerDay: 10, retention: 0.9, sessionLen: 0 }, today: 9700, log: {}, rng: seeded(3), canListen: true }, extra || {});
  const heavy = new C.Session(env(mk(35)));
  assert.strictEqual(heavy.overdue, 35);
  assert.ok(heavy.newPaused);
  assert.strictEqual(heavy.counts().fresh, 0);
  assert.strictEqual(heavy.counts().reviews, 45);
  // Можна взяти нові попри борг
  const forced = new C.Session(env(mk(35), { withNew: true }));
  assert.ok(!forced.newPaused && forced.counts().fresh === 10);
  // Звичайний день: прострочених мало, нові є
  const light = new C.Session(env(mk(10)));
  assert.ok(!light.newPaused && light.counts().fresh === 10);
  // Більший денний ліміт нових піднімає поріг
  assert.strictEqual(C.backlogLimit(20), 60);
  assert.ok(!new C.Session(env(mk(35), { settings: { newPerDay: 20, retention: 0.9, sessionLen: 0 } })).newPaused);
});

test('Слово з прикладу знаходиться в словнику за початковою формою', () => {
  const find = C.lookupIndex(WORDS);
  const base = t => { const r = find(t); return r ? C.norm(r.words[0].en).replace(/^to /, '') : null; };
  assert.strictEqual(base('used'), 'use');
  assert.strictEqual(base('uses'), 'use');
  assert.strictEqual(base('children'), 'child');
  assert.strictEqual(base('stopped'), 'stop');
  assert.strictEqual(base('making'), 'make');
  assert.strictEqual(base('went'), 'go');
  assert.strictEqual(base('families'), 'family');
  assert.strictEqual(base('Walls'), 'wall');
  assert.ok(find('trowel').exact);
  assert.ok(!find('wrecked'));
  // Вираз з речення важливіший за окреме слово, а службові слова беруться з глосарію
  assert.strictEqual(find('off', 'Tomorrow is my day off.').phrases[0].en, 'day off');
  assert.ok(find('picked', 'He picked it up on the way.').phrases.some(w => /pick up/.test(w.en)));
  const withGloss = C.lookupIndex(WORDS, { the: 'артикль', "it's": 'це є' });
  assert.ok(withGloss('The').words[0].gloss);
  assert.strictEqual(withGloss("It's").words[0].uk, 'це є');
  assert.deepStrictEqual(C.lemmaCandidates("plasterer's").slice(0, 2), ["plasterer's", 'plasterer']);
});

test('Граматика: точна перевірка вписаної відповіді', () => {
  assert.ok(C.grammarMatch("weren't", ['were not']));
  assert.ok(C.grammarMatch("'ve been", ['have been']));
  assert.ok(C.grammarMatch("He's gone.", ['he has gone']));
  assert.ok(C.grammarMatch('DOES', ['does']));
  assert.ok(!C.grammarMatch('its', ["it's"]));
  assert.ok(!C.grammarMatch('dont work', ["don't work"]));
  assert.ok(!C.grammarMatch('watchs', ['watches']));
  assert.ok(!C.grammarMatch('', ['x']));
});

test('Граматика: public/grammar.js зібрано з grammar/*.json (python3 tools/build_grammar.py)', () => {
  const gctx = { window: {} };
  vm.createContext(gctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/grammar.js'), 'utf8'), gctx);
  const G = gctx.window.GRAMMAR;
  const order = JSON.parse(fs.readFileSync(path.join(__dirname, '../grammar/_sections.json'), 'utf8'));
  const built = G.sections.reduce((a, s) => a.concat(s.topics), []);
  assert.ok(built.length >= 1);
  for (const id of built) {
    const src = JSON.parse(fs.readFileSync(path.join(__dirname, '../grammar', id + '.json'), 'utf8'));
    const t = Object.assign({}, G.topics[id]); delete t.section;
    assert.strictEqual(JSON.stringify(t), JSON.stringify(src), id + ': запусти python3 tools/build_grammar.py');
    assert.strictEqual(G.topics[id].tasks.length, 12, id);
  }
  // Кожна тема з файла є в зібраному посібнику
  const files = fs.readdirSync(path.join(__dirname, '../grammar')).filter(f => f.endsWith('.json') && !f.startsWith('_')).map(f => f.slice(0, -5));
  for (const f of files) assert.ok(built.includes(f), f + ' немає в public/grammar.js');
  assert.ok(built.every(id => order.some(s => s.topics.includes(id))));
});

test('Стилі й скрипти в index.html мають актуальні ?v= (python3 tools/stamp.py)', () => {
  const crypto = require('crypto');
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const refs = Array.from(html.matchAll(/(?:src|href)="(\/[^"?]+\.(?:js|css))(\?v=([0-9a-f]+))?"/g));
  assert.ok(refs.length >= 8, 'знайдено ' + refs.length);
  for (const m of refs) {
    const file = path.join(__dirname, '../public', m[1]);
    const h = crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 10);
    assert.strictEqual(m[3], h, m[1] + ': запусти python3 tools/stamp.py');
  }
});

console.log('OK, тестів пройдено: ' + passed);

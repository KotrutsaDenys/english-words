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

console.log('OK, тестів пройдено: ' + passed);

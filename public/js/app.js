/* Інтерфейс English Words: навчання, словник, звіт, налаштування */
(function () {
'use strict';

const C = window.EWCore;
const F = window.FSRS;
const CATS = window.CATEGORIES;
const BASE = window.WORDS;
const AUD = window.AUDIO || { voices: [], files: {} };

/* ---------- Дрібниці ---------- */
const $ = id => document.getElementById(id);
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
let toastTimer;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}
const KEYS = { cards: 'ew.cards', progress: 'ew.progress', custom: 'ew.custom', log: 'ew.log', settings: 'ew.settings', notes: 'ew.notes', meta: 'ew.meta' };
function load(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch (e) { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { toast('Не вдалося зберегти. Перевір, чи не вимкнене сховище в Safari.'); }
}
function remove(key) { try { localStorage.removeItem(key); } catch (e) {} }
const today = () => C.dayNum();
const days = n => n + ' ' + C.plural(n, 'день', 'дні', 'днів');
const words = n => n + ' ' + C.plural(n, 'слово', 'слова', 'слів');
const mins = n => n + ' хв';
function inDays(n) { if (n == null) return ''; if (n <= 0) return 'знову'; if (n === 1) return 'завтра'; return 'через ' + days(n); }

/* ---------- Стан ---------- */
let currentTab = 'learn';
const DEFAULT_SETTINGS = {
  newPerDay: 10, mode: 'mix', typing: true, speaking: true, sessionLen: 0, retention: 0.9,
  autoplay: true, voiceSrc: 'emma', voice: '', rate: 1, cats: {}
};
let settings = Object.assign({}, DEFAULT_SETTINGS, load(KEYS.settings, {}));
settings.cats = Object.assign({}, settings.cats || {});
if (![0.75, 0.9, 1].includes(settings.rate)) settings.rate = settings.rate < 0.8 ? 0.75 : settings.rate < 0.95 ? 0.9 : 1;
if (![0.85, 0.9, 0.95].includes(settings.retention)) settings.retention = 0.9;
delete settings.dir;

let custom = load(KEYS.custom, []);
let notes = load(KEYS.notes, {});
let log = load(KEYS.log, {});
let meta = load(KEYS.meta, {});
let cards = load(KEYS.cards, null);
if (!cards) {
  const old = load(KEYS.progress, null);
  cards = old ? C.migrateV2(old, today()) : {};
  if (old) { save(KEYS.cards, cards); save('ew.progress.v2', old); remove(KEYS.progress); }
}

let index = null;
function allWords() { return custom.concat(BASE); }
function byId(id) {
  if (!index) index = new Map(allWords().map(w => [w.id, w]));
  return index.get(id);
}
function reindex() { index = null; }
function todayLog() {
  const k = C.dayKey(today());
  if (!log[k]) log[k] = { n: 0, r: 0, a: 0, c: 0, x: 0, ms: 0 };
  return log[k];
}
function persist() { save(KEYS.cards, cards); save(KEYS.log, log); }
function saveSettings() { save(KEYS.settings, settings); }

/* ---------- Вимова: записи Емми і голос iPhone як запасний ---------- */
const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;
let voices = [];
function loadVoices() {
  if (!synth) return;
  const all = synth.getVoices();
  let list = all.filter(v => /^en[-_](GB|IE)/i.test(v.lang));
  if (!list.length) list = all.filter(v => /^en/i.test(v.lang));
  voices = list.sort((a, b) => (a.lang > b.lang ? 1 : a.lang < b.lang ? -1 : a.name.localeCompare(b.name)));
  if (currentTab === 'settings') renderVoices();
}
function pickVoice() {
  if (!voices.length) return null;
  return voices.find(v => v.voiceURI === settings.voice) ||
    voices.find(v => /en[-_]GB/i.test(v.lang) && /daniel/i.test(v.name)) ||
    voices.find(v => /en[-_]GB/i.test(v.lang)) || voices[0];
}
function speakable(text) { return String(text).replace(/\.\.\.|…/g, ' ').replace(/\s+/g, ' ').trim(); }
function speakDevice(text, rate) {
  if (!synth || !text) return;
  stopAudio();
  const u = new SpeechSynthesisUtterance(speakable(text));
  const v = pickVoice();
  if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = 'en-GB'; }
  u.rate = Math.max(0.5, (rate || settings.rate) * 0.95);
  synth.speak(u);
}
if (synth) { loadVoices(); synth.addEventListener ? synth.addEventListener('voiceschanged', loadVoices) : (synth.onvoiceschanged = loadVoices); }

const VOICE_NAMES = { emma: 'Емма' };
const player = new Audio();
player.preload = 'auto';
try { player.preservesPitch = true; player.webkitPreservesPitch = true; } catch (e) {}
const blobs = new Map();
let playing = '';
function textFor(w, kind) { return kind === 'x' ? (w.sayEx || w.ex) : (w.say || w.en); }
function clipUrl(w, kind) {
  const voice = settings.voiceSrc;
  if (!w || !AUD.voices.includes(voice)) return null;
  const f = AUD.files[w.id];
  const h = f && (kind === 'x' ? f[1] : f[0]);
  return h ? '/audio/' + voice + '/' + w.id + '-' + h + '.mp3' : null;
}
function canListen() { return (AUD.voices.includes(settings.voiceSrc) && AUD.voices.length > 0) || !!synth; }
function stopAudio() { try { player.pause(); } catch (e) {} if (synth) synth.cancel(); }
function preloadUrl(url) {
  if (!url || blobs.has(url)) return;
  blobs.set(url, null);
  fetch(url).then(r => r.ok ? r.blob() : null).then(b => {
    if (!b) { blobs.delete(url); return; }
    blobs.set(url, URL.createObjectURL(b));
    while (blobs.size > 40) {
      const [oldUrl, oldBlob] = blobs.entries().next().value;
      if (oldBlob === player.src) break;
      blobs.delete(oldUrl);
      if (oldBlob) URL.revokeObjectURL(oldBlob);
    }
  }).catch(() => { blobs.delete(url); });
}
function preloadWord(w) { if (!w) return; preloadUrl(clipUrl(w, 'w')); if (w.ex) preloadUrl(clipUrl(w, 'x')); }
function playUrl(url, fallbackText, rate) {
  stopAudio();
  playing = url;
  player.dataset.fallback = fallbackText || '';
  player.src = blobs.get(url) || url;
  player.defaultPlaybackRate = rate || settings.rate;
  player.playbackRate = rate || settings.rate;
  const p = player.play();
  if (p && p.catch) p.catch(err => { if (err && err.name !== 'AbortError' && playing === url) speakDevice(fallbackText, rate); });
}
player.addEventListener('error', () => { if (playing) { const t = player.dataset.fallback; playing = ''; if (t) speakDevice(t); } });
function sayWord(w, kind, rate) {
  if (!w) return;
  const text = textFor(w, kind);
  if (!text) return;
  const url = clipUrl(w, kind);
  if (url) playUrl(url, text, rate); else speakDevice(text, rate);
}
if (navigator.audioSession) { try { navigator.audioSession.type = 'playback'; } catch (e) {} }

const SVG = (body, w) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (w || 2) + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + '</svg>';
const ICON = {
  speaker: SVG('<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>'),
  mic: SVG('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>'),
  check: SVG('<path d="m5 12.5 4.5 4.5L19 7.5"/>', 3),
  cross: SVG('<path d="M7 7l10 10M17 7 7 17"/>', 3),
  bang: SVG('<path d="M12 6v8M12 18h.01"/>', 3),
  flame: SVG('<path d="M12 21c4 0 6.5-2.6 6.5-6.3 0-3.6-2.6-6.1-4.5-8.7-.4 2.2-1.6 3.7-3 4.6.1-2.7-1.1-5.1-3-6.6C8 7.3 5.5 9.9 5.5 14.7 5.5 18.4 8 21 12 21z"/>'),
  // значки вправ
  intro: SVG('<path d="M12 3.5l2.2 5.3 5.3 2.2-5.3 2.2L12 18.5l-2.2-5.3L4.5 11l5.3-2.2z"/>'),
  choose: SVG('<rect x="4" y="4.5" width="16" height="4.5" rx="1.5"/><rect x="4" y="13" width="16" height="4.5" rx="1.5"/><path d="m7 15.2 1.3 1.3 2.4-2.6"/>'),
  listen: SVG('<path d="M5 14v-2a7 7 0 0 1 14 0v2"/><rect x="3.5" y="13.5" width="4" height="6" rx="1.5"/><rect x="16.5" y="13.5" width="4" height="6" rx="1.5"/>'),
  flip: SVG('<rect x="5" y="4" width="14" height="16" rx="2.5"/><path d="M9 12h6M12 9l3 3-3 3"/>'),
  type: SVG('<rect x="3" y="6.5" width="18" height="11" rx="2.5"/><path d="M7 10.5h.01M10.5 10.5h.01M14 10.5h.01M17 10.5h.01M8 14h8"/>'),
  cloze: SVG('<path d="M4 8h5M15 8h5M4 16h16"/><path d="M10 9.5h4" stroke-dasharray="1.5 2"/>'),
  build: SVG('<rect x="3.5" y="13" width="7.5" height="6" rx="1.5"/><rect x="13" y="13" width="7.5" height="6" rx="1.5"/><rect x="8.2" y="5" width="7.5" height="6" rx="1.5"/>'),
  dictation: SVG('<path d="M6 9.5a6 6 0 1 1 9.4 4.9c-1.4 1-2.4 2.1-2.4 3.6a2.5 2.5 0 0 1-4.6 1.4"/><path d="M9.5 10a2.5 2.5 0 0 1 5 0"/>'),
  speak: SVG('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>')
};
const EX_ICON = {
  intro: 'intro', mcq_en_uk: 'choose', mcq_uk_en: 'choose', listen_mcq: 'listen', flip: 'flip', flip_rev: 'flip',
  type_en: 'type', cloze: 'cloze', dictation: 'dictation', build_phrase: 'build', build_sentence: 'build', speak: 'speak'
};
function sayBtn(w, kind, small, label) {
  const b = el('button', 'say' + (small ? ' sm' : ''));
  b.type = 'button';
  b.innerHTML = ICON.speaker;
  b.setAttribute('aria-label', label || (kind === 'x' ? 'Послухати приклад' : 'Послухати слово'));
  b.addEventListener('click', e => { e.stopPropagation(); sayWord(w, kind); });
  return b;
}

/* ---------- Розпізнавання мовлення (Safari, не в режимі програми на екрані) ---------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const standalone = navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
let recBroken = false;
function canRecognize() { return !!SR && !standalone && !recBroken; }

/* ---------- Серія днів і рулетка ---------- */
function streak() {
  let n = today();
  const has = d => { const l = log[C.dayKey(d)]; return l && (l.r > 0 || l.c > 0); };
  if (!has(n)) n--;
  let s = 0;
  while (has(n)) { s++; n--; }
  return s;
}
function renderStreak() {
  const s = streak();
  $('streak').innerHTML = s > 0 ? ICON.flame + '<span><b>' + days(s) + '</b> поспіль</span>' : '';
}
function renderTape(done, total, label, remUnits) {
  const track = $('tapeTrack');
  const fill = $('tapeFill');
  const scale = $('tapeScale');
  const pct = total > 0 ? Math.min(100, done / total * 100) : 0;
  const w = track.clientWidth || 300;
  const step = total > 0 ? w / total : 12;
  scale.style.width = w + 'px';
  scale.style.setProperty('--step', Math.max(3, step) + 'px');
  scale.style.setProperty('--step5', Math.max(15, step * 5) + 'px');
  const every = [5, 10, 20, 25, 50, 100].find(n => n * step >= 26) || 100;
  const key = total + ':' + w;
  if (scale.dataset.key !== key) {
    scale.dataset.key = key;
    scale.innerHTML = '';
    if (total > 0) for (let k = every; k < total; k += every) {
      const n = el('span', 'tape-num', String(k));
      n.style.left = (k * step) + 'px';
      scale.appendChild(n);
    }
  }
  fill.style.width = pct + '%';
  $('tapeHook').style.left = pct + '%';
  $('tape').setAttribute('aria-valuemax', String(total));
  $('tape').setAttribute('aria-valuenow', String(done));
  $('tapeDone').innerHTML = total > 0 ? (label || 'Вправи') + ' <b>' + done + ' з ' + total + '</b>' : 'На сьогодні нічого';
  const left = remUnits != null ? remUnits : Math.max(0, total - done);
  const leftText = remUnits != null ? 'залишилось ≈ ' + mins(Math.max(1, Math.ceil(left * 10 / 60))) : 'залишилось ' + left;
  $('tapeLeft').textContent = total > 0 ? (left ? leftText : 'усе пройдено') : '';
}

/* ---------- Навчання ---------- */
let session = null;
let current = null;
let ui = null;          // стан поточної вправи
let practiceDone = 0;
let keys = {};          // клавіатурні дії поточного екрана

function envFor(practiceIds, reviewOnly) {
  return { words: allWords(), cards, settings, today: today(), log: todayLog(), rng: Math.random, canListen: canListen(), practiceIds, reviewOnly };
}
function updateTape() {
  if (session && session.practice) { renderTape(practiceDone, practiceDone + session.remaining(), 'Тренування'); return; }
  const l = todayLog();
  const done = (l.r || 0) + (l.n || 0) + (l.k || 0);
  const rem = (session || new C.Session(envFor())).remainingUnits();
  renderTape(done, done + rem, null, rem);
}
function estimateMinutes(units) { return Math.max(1, Math.ceil(units * 10 / 60)); }

const WEEKDAYS = ['неділя', 'понеділок', 'вівторок', 'середа', 'четвер', "п'ятниця", 'субота'];
const WD_SHORT = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
function greeting() {
  const d = new Date();
  const h = d.getHours();
  const hello = h < 5 ? 'Доброї ночі' : h < 12 ? 'Добрий ранок' : h < 18 ? 'Добрий день' : h < 23 ? 'Добрий вечір' : 'Доброї ночі';
  const t = today();
  return hello + ', ' + WEEKDAYS[new Date(t * 86400000).getUTCDay()] + ' ' + C.fmtDate(t).slice(0, 5);
}
function joinUk(parts) {
  if (parts.length < 2) return parts.join('');
  return parts.slice(0, -1).join(', ') + ' і ' + parts[parts.length - 1];
}
function planSentence(cnt) {
  const parts = [];
  if (cnt.learning) parts.push(cnt.learning + ' ' + C.plural(cnt.learning, 'слово', 'слова', 'слів') + ' довчити');
  if (cnt.reviews) parts.push(cnt.reviews + ' ' + C.plural(cnt.reviews, 'повторення', 'повторення', 'повторень'));
  if (cnt.fresh) parts.push(cnt.fresh + ' ' + C.plural(cnt.fresh, 'нове слово', 'нові слова', 'нових слів'));
  const s = joinUk(parts);
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function studied(d) { const l = log[C.dayKey(d)]; return !!(l && (l.r > 0 || l.c > 0)); }
function weekSection() {
  const t = today();
  const wd = new Date(t * 86400000).getUTCDay();
  const monday = t - ((wd + 6) % 7);
  const sec = el('section', 'section');
  const s = streak();
  const title = el('h3', 'section-title', 'Цей тиждень');
  title.appendChild(el('span', null, s ? 'серія ' + days(s) : 'серія ще не почата'));
  sec.appendChild(title);
  const row = el('div', 'week');
  for (let d = monday; d < monday + 7; d++) {
    const done = studied(d);
    const cell = el('div', 'day' + (done ? ' done' : '') + (d === t ? ' today' : ''));
    const dot = el('i');
    if (done) dot.innerHTML = ICON.check;
    dot.setAttribute('aria-hidden', 'true');
    cell.append(dot, document.createTextNode(WD_SHORT[(d - monday + 1) % 7]));
    cell.setAttribute('aria-label', C.fmtDate(d) + (done ? ': було заняття' : d > t ? '' : ': без заняття'));
    row.appendChild(cell);
  }
  sec.appendChild(row);
  return sec;
}
function vocabBar(box, legend, tt) {
  box.innerHTML = '';
  const total = Math.max(1, tt.all);
  [['k', tt.known], ['l', tt.learning], ['x', tt.leech]].forEach(([c, n]) => {
    if (!n) return;
    const i = el('i', c); i.style.width = (n / total * 100) + '%'; box.appendChild(i);
  });
  box.setAttribute('aria-label', 'Знаю ' + tt.known + ', вчу ' + tt.learning + ', важких ' + tt.leech + ', нових ' + tt.new);
  if (!legend) return;
  legend.innerHTML = '';
  [['k', 'знаю', tt.known], ['l', 'вчу', tt.learning], ['x', 'важкі', tt.leech], ['n', 'ще не вчив', tt.new]].forEach(([c, label, n]) => {
    if (!n && c === 'x') return;
    const li = el('li');
    li.append(el('i', c), el('b', null, String(n)), document.createTextNode(' ' + label));
    legend.appendChild(li);
  });
}
function vocabSection() {
  const tt = totals();
  const sec = el('section', 'section');
  const title = el('h3', 'section-title', 'Мій словник');
  title.appendChild(el('span', null, words(tt.all)));
  const bar = el('div', 'vocab-bar'); bar.setAttribute('role', 'img');
  const legend = el('ul', 'legend');
  sec.append(title, bar, legend);
  vocabBar(bar, legend, tt);
  return sec;
}
function renderLearn() {
  const active = session && current;
  $('stage').hidden = !active;
  $('learnHome').hidden = !!active;
  updateTape();
  if (active) return;
  const home = $('learnHome');
  home.innerHTML = '';
  keys = {};
  const l = todayLog();
  const plan = new C.Session(envFor());
  const cnt = plan.counts();
  const total = cnt.reviews + cnt.learning + cnt.fresh;
  home.appendChild(el('p', 'greet', greeting()));
  const st = el('div', 'stack');
  if (total) {
    home.appendChild(el('h2', 'hero', (l.r ? 'Ще ' : '') + (l.r ? planSentence(cnt).charAt(0).toLowerCase() + planSentence(cnt).slice(1) : planSentence(cnt))));
    home.appendChild(el('p', 'hero-sub', 'Приблизно ' + mins(estimateMinutes(plan.remainingUnits())) + '.'));
    if (cnt.reviews >= 40 && cnt.fresh) home.appendChild(el('p', 'tip', 'Повторень сьогодні багато. Нічого страшного, якщо зробиш лише їх, а нові слова почекають до завтра.'));
    const go = el('button', 'btn btn-primary', l.r ? 'Продовжити' : 'Почати');
    go.addEventListener('click', () => startSession());
    st.appendChild(go);
    if (cnt.reviews && cnt.fresh) {
      const quick = el('button', 'btn', 'Тільки повторення, без нових');
      quick.addEventListener('click', () => startSession(null, true));
      st.appendChild(quick);
    }
    home.appendChild(st);
    keys.enter = () => go.click();
    plan.reviews.slice(0, 3).concat(plan.newIds.slice(0, 2)).forEach(id => preloadWord(byId(id)));
  } else {
    const left = C.orderNew(allWords(), cards, settings.cats).length;
    const misses = (l.miss || []).filter(id => byId(id));
    if (l.r) {
      home.appendChild(el('h2', 'hero', 'Готово на сьогодні'));
      const acc = Math.round((l.r - (l.a || 0)) / l.r * 100);
      const ul = el('ul', 'done-list');
      [['Час', mins(Math.max(1, Math.round((l.ms || 0) / 60000)))], ['Нових слів', String(l.n || 0)], ['Повторено', String(l.rv || 0)], ['Точність', acc + '%']]
        .forEach(([a, b]) => { const li = el('li'); li.append(el('span', null, a), el('b', null, b)); ul.appendChild(li); });
      home.appendChild(ul);
      const rep = el('button', 'btn btn-primary', 'Скопіювати звіт');
      rep.addEventListener('click', copyReport);
      st.appendChild(rep);
    } else {
      home.appendChild(el('h2', 'hero', 'Сьогодні вільно'));
      home.appendChild(el('p', 'hero-sub', left ? 'Повторень немає, а ліміт нових на сьогодні вичерпано.' : 'Нових слів не залишилось. Додай свої у Словнику або увімкни інші теми в Налаштуваннях.'));
    }
    if (misses.length) {
      const pr = el('button', 'btn', 'Потренувати помилки (' + misses.length + ')');
      pr.addEventListener('click', () => startSession(misses));
      st.appendChild(pr);
    }
    if (left) {
      const more = el('button', 'btn', 'Ще 5 нових слів');
      more.addEventListener('click', () => { todayLog().x = (todayLog().x || 0) + 5; persist(); startSession(); });
      st.appendChild(more);
    }
    home.appendChild(st);
  }
  home.appendChild(weekSection());
  home.appendChild(vocabSection());
}

function startSession(practiceIds, reviewOnly) {
  session = new C.Session(envFor(practiceIds, reviewOnly));
  practiceDone = 0;
  nextItem();
}
function endSession() {
  const wasPractice = session && session.practice;
  session = null; current = null; ui = null;
  document.body.classList.remove('typing');
  renderLearn();
  if (wasPractice) toast('Тренування завершено');
}
function nextItem() {
  stopAudio();
  if (!session) return;
  current = session.next();
  if (!current) { endSession(); return; }
  show(current);
}

/* Каркас вправи */
function frame(item) {
  $('stage').hidden = false;
  $('learnHome').hidden = true;
  const card = $('card');
  card.innerHTML = '';
  card.onclick = null;
  const head = el('div', 'ex-head');
  const label = el('span', 'ex-label');
  const ic = el('span', 'ex-ic' + (item.exercise === 'intro' ? ' new' : ''));
  ic.innerHTML = ICON[EX_ICON[item.exercise]] || '';
  label.append(ic, document.createTextNode(C.EXERCISES[item.exercise] || ''));
  const right = el('span', 'ex-right');
  if (item.card && C.isLeech(item.card)) right.appendChild(el('span', 'badge', 'важке слово'));
  if (item.card && item.card.st === 'learn') {
    const steps = el('span', 'steps');
    steps.setAttribute('aria-label', 'Крок ' + item.card.step + ' з ' + C.LEARN_STEPS);
    for (let k = 1; k <= C.LEARN_STEPS; k++) steps.appendChild(el('i', k < item.card.step ? 'on' : ''));
    right.appendChild(steps);
  } else if (!(item.card && C.isLeech(item.card))) {
    right.appendChild(document.createTextNode(session && session.practice ? 'Тренування' : (CATS[item.word.cat] || '')));
  }
  head.append(label, right);
  card.appendChild(head);
  const body = el('div', 'prompt');
  card.appendChild(body);
  setFoot([]);
  keys = {};
  return body;
}
function setFoot(buttons, cols) {
  const foot = $('foot');
  foot.innerHTML = '';
  foot.className = 'foot' + (cols ? ' cols' + cols : '');
  buttons.forEach(b => foot.appendChild(b));
}
function button(text, cls, onClick, sub) {
  const b = el('button', 'btn' + (cls ? ' ' + cls : ''));
  b.type = 'button';
  b.appendChild(document.createTextNode(text));
  if (sub) b.appendChild(el('small', null, sub));
  b.addEventListener('click', onClick);
  return b;
}
function bigWord(text, lang) {
  const h = el('h2', 'word' + (lang === 'uk' ? ' uk' : ''), text);
  h.lang = lang;
  requestAnimationFrame(() => fitWord(h));
  return h;
}
function fitWord(node) {
  const card = $('card');
  const avail = (card.clientWidth || 340) - 40;
  const text = node.textContent;
  const longest = text.split(/\s+/).reduce((m, s) => Math.max(m, s.length), 1);
  const factor = node.classList.contains('uk') ? 0.62 : 0.78;
  let size = Math.floor(avail / (longest * factor));
  size = Math.max(22, Math.min(text.length > 16 ? 29 : 44, size));
  node.style.fontSize = size + 'px';
}
function enSpan(text) { const s = el('span', null, text); s.lang = 'en'; return s; }

/* Нотатки: власна асоціація */
function mnemonicBlock(w, openByDefault) {
  const box = el('div', 'mnemo');
  const existing = notes[w.id];
  const editor = () => {
    box.innerHTML = '';
    const ta = el('textarea');
    ta.placeholder = 'Наприклад: trowel схоже на «трава», гладилкою «косиш» штукатурку';
    ta.value = notes[w.id] || '';
    ta.setAttribute('aria-label', 'Своя асоціація');
    const row = el('div', 'row');
    const saveBtn = el('button', 'link-btn', 'Зберегти асоціацію');
    saveBtn.type = 'button';
    saveBtn.addEventListener('click', () => {
      const v = ta.value.trim();
      if (v) notes[w.id] = v; else delete notes[w.id];
      save(KEYS.notes, notes);
      toast(v ? 'Асоціацію збережено' : 'Асоціацію видалено');
      render();
    });
    row.appendChild(saveBtn);
    box.append(ta, row);
    ta.addEventListener('focus', () => document.body.classList.add('typing'));
    ta.addEventListener('blur', () => document.body.classList.remove('typing'));
  };
  const render = () => {
    box.innerHTML = '';
    if (notes[w.id]) {
      const n = el('p', 'note');
      n.append(el('b', null, 'Твоя асоціація: '), document.createTextNode(notes[w.id] + ' '));
      const edit = el('button', 'link-btn', 'змінити');
      edit.type = 'button';
      edit.addEventListener('click', editor);
      n.appendChild(edit);
      box.appendChild(n);
    } else {
      const b = el('button', 'link-btn', 'Додати свою асоціацію');
      b.type = 'button';
      b.addEventListener('click', editor);
      box.appendChild(b);
    }
  };
  if (openByDefault && !existing) {
    const lead = el('p', 'tip', 'Це слово часто вилітає з голови. Придумай свою зачіпку: схоже слово, картинку, ситуацію з роботи.');
    box.appendChild(lead);
    const wrap = el('div');
    box.appendChild(wrap);
    const ta = el('textarea');
    ta.placeholder = 'Твоя асоціація';
    ta.setAttribute('aria-label', 'Своя асоціація');
    const row = el('div', 'row');
    const saveBtn = el('button', 'link-btn', 'Зберегти асоціацію');
    saveBtn.type = 'button';
    saveBtn.addEventListener('click', () => {
      const v = ta.value.trim();
      if (!v) return;
      notes[w.id] = v; save(KEYS.notes, notes); toast('Асоціацію збережено'); render();
    });
    row.appendChild(saveBtn);
    wrap.append(ta, row);
    ta.addEventListener('focus', () => document.body.classList.add('typing'));
    ta.addEventListener('blur', () => document.body.classList.remove('typing'));
  } else render();
  return box;
}

/* Блок з відповіддю: слово, переклад, приклад, підказка */
function details(w, opts) {
  opts = opts || {};
  const d = el('div', 'details');
  if (opts.verdict) {
    const info = nextInfo();
    if (info) opts.verdict.querySelector('.vbody').appendChild(el('span', 'next-info', info));
    d.appendChild(opts.verdict);
  }
  if (opts.yours) d.appendChild(opts.yours);
  if (opts.en !== false) {
    const t = el('p', 'trans en');
    t.append(enSpan(w.en), sayBtn(w, 'w', true));
    d.appendChild(t);
  }
  if (opts.uk !== false) d.appendChild(el('p', 'trans', w.uk));
  if (w.ex && opts.ex !== false) {
    const ex = el('p', 'ex');
    ex.append(enSpan(w.ex), sayBtn(w, 'x', true));
    d.appendChild(ex);
    if (w.exUk) d.appendChild(el('p', 'ex-uk', w.exUk));
  }
  if (w.note) { const n = el('p', 'note'); n.textContent = w.note; d.appendChild(n); }
  if (opts.tip) d.appendChild(el('p', 'tip', opts.tip));
  const fresh = current && cards[current.id];
  d.appendChild(mnemonicBlock(w, !!(fresh && C.isLeech(fresh) && opts.wrong)));
  return d;
}
function nextInfo() {
  const r = ui && ui.res;
  if (!r || !session || session.practice) return '';
  if (r.done && r.card && r.card.due != null) return 'Наступне повторення ' + inDays(r.card.due - today()) + '.';
  if (r.wrong) return 'Повернемося до цього слова за кілька вправ.';
  if (r.again) return 'Ще раз за кілька вправ.';
  return '';
}
function verdict(kind, text, sub) {
  const v = el('div', 'verdict ' + kind);
  v.setAttribute('role', 'status');
  const ic = el('span', 'vi');
  ic.innerHTML = kind === 'right' ? ICON.check : kind === 'typo' ? ICON.bang : kind === 'info' ? ICON.speaker : ICON.cross;
  const body = el('span', 'vbody');
  const t = el('span', 'vt', text);
  if (sub) t.appendChild(el('small', null, sub));
  body.appendChild(t);
  v.append(ic, body);
  return v;
}

/* Зарахувати відповідь */
function addTime() {
  if (!ui || ui.timed) return;
  ui.timed = true;
  const l = todayLog();
  l.ms = (l.ms || 0) + Math.min(60000, Math.max(0, performance.now() - ui.t0));
}
function finish(g) {
  if (!ui || ui.answered) return null;
  ui.answered = true;
  ui.g = g;
  addTime();
  const res = session.answer(current.id, g, current.exercise);
  ui.res = res;
  if (session.practice && res.done) practiceDone++;
  persist();
  renderStreak();
  updateTape();
  return res;
}
function regrade(g) {
  if (!ui || !ui.answered || !session.undo()) return;
  ui.answered = false;
  ui.timed = true;
  finish(g);
}
function nextButton() {
  const b = button('Далі', 'btn-primary', nextItem);
  setFoot([b]);
  keys = { enter: () => b.click() };
  setTimeout(() => { try { b.focus({ preventScroll: true }); } catch (e) {} }, 30);
  return b;
}

function show(item) {
  ui = { t0: performance.now(), answered: false, hints: 0, tries: 0 };
  document.body.classList.remove('typing');
  const w = item.word;
  preloadWord(w);
  if (session) {
    session.reviews.slice(0, 2).concat(session.newIds.slice(0, 1)).forEach(id => preloadWord(byId(id)));
  }
  const fn = RENDER[item.exercise] || RENDER.flip;
  fn(item);
  updateTape();
  window.scrollTo(0, 0);
}

const RENDER = {};

/* Знайомство з новим словом */
RENDER.intro = item => {
  const w = item.word;
  const body = frame(item);
  body.appendChild(bigWord(w.en, 'en'));
  const r = el('div', 'row'); r.appendChild(sayBtn(w, 'w')); body.appendChild(r);
  const d = el('div', 'details');
  d.appendChild(el('p', 'trans', w.uk));
  if (w.ex) {
    const ex = el('p', 'ex'); ex.append(enSpan(w.ex), sayBtn(w, 'x', true)); d.appendChild(ex);
    if (w.exUk) d.appendChild(el('p', 'ex-uk', w.exUk));
  }
  if (w.note) { const n = el('p', 'note'); n.textContent = w.note; d.appendChild(n); }
  d.appendChild(el('p', 'tip', 'Послухай і скажи вголос двічі: сказане вголос запам\'ятовується краще.'));
  d.appendChild(mnemonicBlock(w, false));
  $('card').appendChild(d);
  const learn = () => { addTime(); session.introduce(item.id, false); persist(); nextItem(); };
  const known = () => {
    addTime(); session.introduce(item.id, true); persist(); renderStreak();
    toast('Повторю «' + w.en + '» приблизно через ' + days(cards[item.id].due - today()));
    nextItem();
  };
  setFoot([button('Вже знаю', 'btn-quiet', known), button('Вчити', 'btn-primary', learn)], 2);
  keys = { enter: learn };
  if (settings.autoplay) sayWord(w, 'w');
};

/* Вибір з варіантів */
function mcq(item, prompt, field) {
  const w = item.word;
  const body = frame(item);
  if (prompt === 'en') {
    body.appendChild(bigWord(w.en, 'en'));
    const r = el('div', 'row'); r.appendChild(sayBtn(w, 'w')); body.appendChild(r);
    if (settings.autoplay) sayWord(w, 'w');
  } else if (prompt === 'uk') {
    body.appendChild(bigWord(w.uk, 'uk'));
  } else {
    listenPrompt(body, w);
  }
  const opts = C.shuffle([w].concat(C.distractors(w, allWords(), field, 3)));
  const box = el('div', 'options');
  const btns = [];
  opts.forEach((o, i) => {
    const b = el('button', 'opt-btn' + (field === 'en' ? ' en' : ''));
    b.type = 'button';
    b.append(el('span', 'k', String(i + 1)), el('span', null, o[field]));
    if (field === 'en') b.lastChild.lang = 'en';
    b.addEventListener('click', () => choose(o, b));
    btns.push(b);
    box.appendChild(b);
  });
  $('card').appendChild(box);
  keys = { num: n => btns[n - 1] && btns[n - 1].click() };
  function choose(o, b) {
    if (ui.answered) return;
    const ok = o.id === w.id;
    finish(ok ? 3 : 1);
    btns.forEach((x, i) => {
      x.disabled = true;
      if (opts[i].id === w.id) { x.classList.add('right'); x.firstChild.innerHTML = ICON.check; }
      else if (x === b) { x.classList.add('wrong'); x.firstChild.innerHTML = ICON.cross; }
      else x.classList.add('dim');
    });
    sayWord(w, 'w');
    const v = ok ? verdict('right', 'Правильно') : verdict('wrong', 'Ні, правильно:');
    $('card').appendChild(details(w, { verdict: v, en: prompt !== 'en', uk: prompt !== 'uk', wrong: !ok }));
    nextButton();
  }
}
function listenPrompt(body, w) {
  const big = el('button', 'listen-big');
  big.type = 'button';
  big.innerHTML = ICON.speaker;
  big.setAttribute('aria-label', 'Послухати ще раз');
  big.addEventListener('click', () => sayWord(w, 'w'));
  const slow = el('button', 'slow-btn', 'Повільніше');
  slow.type = 'button';
  slow.addEventListener('click', () => sayWord(w, 'w', 0.7));
  body.append(big, slow);
  sayWord(w, 'w');
}
RENDER.mcq_en_uk = item => mcq(item, 'en', 'uk');
RENDER.mcq_uk_en = item => mcq(item, 'uk', 'en');
RENDER.listen_mcq = item => mcq(item, 'audio', 'uk');

/* Картки з самооцінкою */
function flip(item, rev) {
  const w = item.word;
  const body = frame(item);
  if (rev) body.appendChild(bigWord(w.uk, 'uk'));
  else {
    body.appendChild(bigWord(w.en, 'en'));
    const r = el('div', 'row'); r.appendChild(sayBtn(w, 'w')); body.appendChild(r);
    if (settings.autoplay) sayWord(w, 'w');
  }
  body.appendChild(el('p', 'prompt-sub', rev ? 'Згадай англійською, потім відкрий відповідь' : 'Згадай переклад, потім відкрий відповідь'));
  const reveal = () => {
    if (ui.revealed) return;
    ui.revealed = true;
    $('card').onclick = null;
    $('card').appendChild(details(w, { en: rev, uk: !rev }));
    if (rev) sayWord(w, 'w');
    const pv = C.previewIntervals(item.card, today(), settings.retention);
    const learning = !item.card || item.card.st !== 'review';
    const sub = g => learning ? (g === 1 ? 'ще раз' : g === 4 ? 'вже знаю' : 'далі') : inDays(pv[g]);
    const grade = g => { finish(g); nextItem(); };
    const bs = [
      button('Не знаю', 'btn-again', () => grade(1), sub(1)),
      button('Важко', '', () => grade(2), sub(2)),
      button('Знаю', 'btn-primary', () => grade(3), sub(3)),
      button('Легко', '', () => grade(4), sub(4))
    ];
    setFoot(bs, 4);
    keys = { num: n => bs[n - 1] && bs[n - 1].click() };
  };
  $('card').onclick = e => { if (!e.target.closest('button,textarea')) reveal(); };
  const rb = button('Показати відповідь', 'btn-primary', reveal);
  setFoot([rb]);
  keys = { enter: reveal, space: reveal };
}
RENDER.flip = item => flip(item, false);
RENDER.flip_rev = item => flip(item, true);

/* Письмові вправи */
function typing(item, kind) {
  const w = item.word;
  const body = frame(item);
  let targets, display;
  if (kind === 'cloze') {
    const ct = C.clozeTarget(w);
    if (!ct) { item.exercise = 'type_en'; return typing(item, 'type'); }
    const p = el('p', 'cloze');
    p.lang = 'en';
    const blank = el('span', 'blank', ct.text);
    p.append(document.createTextNode(w.ex.slice(0, ct.start)), blank, document.createTextNode(w.ex.slice(ct.end)));
    body.appendChild(p);
    if (w.exUk) body.appendChild(el('p', 'ex-uk', w.exUk));
    const chip = el('span', 'chip-hint', w.uk);
    const r = el('div'); r.appendChild(chip); body.appendChild(r);
    targets = [ct.text];
    display = ct.text;
    ui.blank = blank;
  } else if (kind === 'dictation') {
    listenPrompt(body, w);
    body.appendChild(el('p', 'prompt-sub', 'Напиши англійською, що почув'));
    targets = C.answerTargets(w.en);
    display = w.en;
  } else {
    body.appendChild(bigWord(w.uk, 'uk'));
    body.appendChild(el('p', 'prompt-sub', 'Напиши англійською'));
    targets = C.answerTargets(w.en);
    display = w.en.replace(/[.!?]+$/, '');
  }
  const pattern = el('p', 'pattern');
  pattern.hidden = true;
  pattern.setAttribute('aria-live', 'polite');
  const input = el('input', 'answer');
  Object.assign(input, { type: 'text', autocomplete: 'off', spellcheck: false });
  input.setAttribute('autocapitalize', 'none');
  input.setAttribute('autocorrect', 'off');
  input.setAttribute('enterkeyhint', 'done');
  input.setAttribute('aria-label', 'Відповідь англійською');
  input.lang = 'en';
  $('card').append(pattern, input);
  input.addEventListener('focus', () => document.body.classList.add('typing'));
  input.addEventListener('blur', () => setTimeout(() => document.body.classList.remove('typing'), 50));
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); if (!ui.answered) check(); else nextItem(); }
  });
  const showPattern = () => {
    let n = ui.hints, out = '';
    for (const ch of display) {
      if (/[A-Za-z]/.test(ch)) { if (n > 0) { out += ch; n--; } else out += '_'; }
      else out += ch;
    }
    pattern.textContent = out.split('').join(' ').replace(/ {3}/g, '   ');
    pattern.hidden = false;
  };
  const hint = () => {
    if (ui.answered) return;
    const letters = display.replace(/[^A-Za-z]/g, '').length;
    if (ui.hints >= letters - 1) { toast('Підказок більше немає'); return; }
    ui.hints++;
    showPattern();
    input.focus();
  };
  const result = (check, value) => {
    const res = check.result;
    input.disabled = true;
    input.blur();
    let g, v;
    if (res === 'exact') {
      g = ui.hints ? 2 : 3;
      input.classList.add('right');
      v = verdict('right', 'Правильно', ui.hints ? ' з підказкою' : '');
    } else if (res === 'typo') {
      g = 2;
      input.classList.add('typo');
      v = verdict('typo', 'Майже, перевір написання');
    } else {
      g = 1;
      input.classList.add('wrong');
      v = verdict('wrong', value ? 'Ні, правильно:' : 'Правильна відповідь:');
    }
    finish(g);
    if (ui.blank) { ui.blank.classList.add('filled'); }
    sayWord(w, kind === 'cloze' ? 'x' : 'w');
    let yours = null;
    if (g <= 2 && value && res !== 'exact') {
      yours = el('div');
      const line = (label, text, against, cls) => {
        const p = el('p', 'yours');
        p.appendChild(document.createTextNode(label));
        const span = el('span'); span.lang = 'en';
        C.diffMarks(text, against).forEach(m => span.appendChild(m.ok ? document.createTextNode(m.ch) : el('span', cls, m.ch)));
        p.appendChild(span);
        yours.appendChild(p);
      };
      const right = String(check.target || display);
      const close = res === 'typo' || (check.dist != null && check.dist <= Math.ceil(right.length * 0.4));
      if (close) {
        line('Ти написав: ', value, right, 'bad');
        line('Правильно: ', right, value, 'fix');
      } else {
        const p = el('p', 'yours');
        const sv = el('s', null, value); sv.lang = 'en';
        p.append(document.createTextNode('Ти написав: '), sv);
        yours.appendChild(p);
      }
    }
    $('card').appendChild(details(w, { verdict: v, yours, en: true, uk: kind === 'dictation', wrong: g === 1 }));
    const next = button('Далі', 'btn-primary', nextItem);
    const btns = [next];
    if (g === 1 && value) {
      const accept = button('Я мав рацію', 'btn-quiet', () => {
        regrade(ui.hints ? 2 : 3);
        toast('Зараховано');
        accept.remove();
        setFoot([next]);
      });
      btns.unshift(accept);
    }
    setFoot(btns, btns.length === 2 ? 2 : 0);
    keys = { enter: () => next.click() };
  };
  const check = () => {
    if (ui.answered) return;
    const value = input.value.trim();
    if (!value) { input.focus(); toast('Напиши відповідь або натисни «Не знаю»'); return; }
    result(C.checkAnswer(value, targets), value);
  };
  setFoot([
    button('Не знаю', 'btn-quiet', () => { if (!ui.answered) result({ result: 'wrong' }, ''); }),
    button('Підказка', '', hint),
    button('Перевірити', 'btn-primary', check)
  ], 3);
  keys = {};
  try { input.focus({ preventScroll: true }); } catch (e) {}
}
RENDER.type_en = item => typing(item, 'type');
RENDER.cloze = item => typing(item, 'cloze');
RENDER.dictation = item => typing(item, 'dictation');

/* Склади фразу або речення зі слів */
function build(item, sentence) {
  const w = item.word;
  const body = frame(item);
  const target = C.tokens(sentence ? w.ex : w.en);
  if (sentence) {
    const p = el('p', 'trans', w.exUk || w.uk);
    body.appendChild(p);
    body.appendChild(el('p', 'prompt-sub', 'Склади це речення англійською'));
  } else {
    body.appendChild(bigWord(w.uk, 'uk'));
    body.appendChild(el('p', 'prompt-sub', 'Склади фразу англійською'));
  }
  const lowerTarget = target.map(t => t.toLowerCase());
  const pool = [];
  const STOP = new Set(['a', 'an', 'the', 'to', 'of', 'in', 'on', 'at', 'for', 'and', 'or', 'but', 'i', 'you', 'he', 'she', 'it', 'we',
    'they', 'me', 'him', 'her', 'us', 'them', 'my', 'your', 'his', 'its', 'our', 'their', 'is', 'am', 'are', 'was', 'were', 'be',
    'been', 'do', 'does', 'did', 'have', 'has', 'had', 'can', 'could', 'will', 'would', 'shall', 'should', 'may', 'might', 'must',
    "i'm", "it's", "i'll", "don't", "can't", "you're", "that's", 'this', 'that', 'so', 'please', 'not', 'no', 'yes']);
  C.shuffle(allWords().slice(), Math.random).some(o => {
    if (o.id === w.id) return false;
    for (const t of C.tokens(o.ex)) {
      const l = t.toLowerCase();
      if (l.length >= 3 && l.length <= 9 && !STOP.has(l) && !lowerTarget.includes(l) && !pool.some(p => p.toLowerCase() === l)) { pool.push(t); break; }
    }
    return pool.length >= 2;
  });
  const tiles = C.shuffle(target.concat(pool).map((t, i) => ({ t, i })));
  const answerBox = el('div', 'build-answer');
  answerBox.setAttribute('aria-label', 'Твоя відповідь');
  const bank = el('div', 'build-bank');
  const placed = [];
  const bankBtns = new Map();
  tiles.forEach(tile => {
    const b = el('button', 'tile', tile.t);
    b.type = 'button';
    b.lang = 'en';
    b.addEventListener('click', () => { if (ui.answered || b.classList.contains('used')) return; place(tile); });
    bankBtns.set(tile.i, b);
    bank.appendChild(b);
  });
  const redraw = () => {
    answerBox.innerHTML = '';
    placed.forEach((tile, pos) => {
      const b = el('button', 'tile', tile.t);
      b.type = 'button';
      b.lang = 'en';
      if (tile.state) b.classList.add(tile.state);
      b.addEventListener('click', () => {
        if (ui.answered) return;
        placed.splice(pos, 1);
        bankBtns.get(tile.i).classList.remove('used');
        placed.forEach(p => { p.state = ''; });
        redraw();
      });
      answerBox.appendChild(b);
    });
    checkBtn.disabled = !placed.length;
  };
  const place = tile => {
    placed.forEach(p => { p.state = ''; });
    placed.push(tile);
    bankBtns.get(tile.i).classList.add('used');
    redraw();
  };
  $('card').append(answerBox, bank);
  const done = (g, v) => {
    finish(g);
    sayWord(w, sentence ? 'x' : 'w');
    $('card').appendChild(details(w, { verdict: v, en: true, uk: sentence, wrong: g === 1 }));
    nextButton();
  };
  const check = () => {
    if (ui.answered || !placed.length) return;
    const ok = placed.length === target.length && placed.every((p, i) => p.t.toLowerCase() === lowerTarget[i]);
    if (ok) {
      placed.forEach(p => { p.state = 'good'; });
      redraw();
      done(ui.tries ? 2 : 3, verdict('right', 'Правильно', ui.tries ? ' з другої спроби' : ''));
      return;
    }
    ui.tries++;
    placed.forEach((p, i) => { p.state = p.t.toLowerCase() === lowerTarget[i] ? 'good' : 'bad'; });
    redraw();
    if (ui.tries >= 2) {
      done(1, verdict('wrong', 'Правильний порядок:'));
    } else toast('Майже. Прибери червоні слова й спробуй ще раз');
  };
  const checkBtn = button('Перевірити', 'btn-primary', check);
  checkBtn.disabled = true;
  setFoot([button('Не знаю', 'btn-quiet', () => { if (!ui.answered) done(1, verdict('wrong', 'Правильно так:')); }), checkBtn], 2);
  keys = { enter: check };
}
RENDER.build_phrase = item => build(item, false);
RENDER.build_sentence = item => build(item, true);

/* Скажи вголос */
RENDER.speak = item => {
  const w = item.word;
  const body = frame(item);
  body.appendChild(bigWord(w.uk, 'uk'));
  body.appendChild(el('p', 'prompt-sub', 'Скажи англійською вголос'));
  const selfGrade = heard => {
    if (ui.revealed) return;
    ui.revealed = true;
    sayWord(w, 'w');
    const v = heard ? verdict('info', 'Почула: «' + heard + '»', ' порівняй з правильним') : verdict('info', 'Порівняй зі своєю відповіддю');
    $('card').appendChild(details(w, { verdict: v, uk: false }));
    const grade = g => { finish(g); nextItem(); };
    const bs = [
      button('Не згадав', 'btn-again', () => grade(1)),
      button('З помилкою', '', () => grade(2)),
      button('Правильно', 'btn-primary', () => grade(3))
    ];
    setFoot(bs, 3);
    keys = { num: n => bs[n - 1] && bs[n - 1].click() };
  };
  if (canRecognize()) {
    const mic = el('button', 'mic');
    mic.type = 'button';
    const ic = el('span', 'ic'); ic.innerHTML = ICON.mic;
    const label = el('span', null, 'Натисни й говори');
    mic.append(ic, label);
    $('card').appendChild(mic);
    let rec = null;
    mic.addEventListener('click', () => {
      if (ui.revealed || ui.answered) return;
      if (rec) { try { rec.stop(); } catch (e) {} return; }
      stopAudio();
      try {
        rec = new SR();
        rec.lang = 'en-GB';
        rec.interimResults = false;
        rec.maxAlternatives = 5;
      } catch (e) { recBroken = true; selfGrade(''); return; }
      mic.classList.add('on'); label.textContent = 'Слухаю…';
      rec.onresult = ev => {
        const alts = Array.from(ev.results[0] || []).map(a => a.transcript);
        const targets = C.answerTargets(w.say || w.en).concat(C.answerTargets(w.en));
        const hit = alts.some(a => {
          const r = C.checkAnswer(a, targets).result;
          return r !== 'wrong' || C.norm(a).includes(C.norm(w.en.replace(/^to /i, '')));
        });
        if (hit) {
          finish(3);
          sayWord(w, 'w');
          $('card').appendChild(details(w, { verdict: verdict('right', 'Правильно, вимова зрозуміла'), uk: false }));
          nextButton();
        } else selfGrade(alts[0] || '');
      };
      rec.onerror = ev => {
        if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed' || ev.error === 'audio-capture') { recBroken = true; toast('Мікрофон недоступний, перевір себе сам'); }
        if (!ui.answered) selfGrade('');
      };
      rec.onend = () => { mic.classList.remove('on'); label.textContent = 'Натисни й говори'; rec = null; };
      try { rec.start(); } catch (e) { recBroken = true; selfGrade(''); }
    });
    setFoot([button('Не знаю', 'btn-quiet', () => { if (!ui.answered && !ui.revealed) { finish(1); sayWord(w, 'w'); $('card').appendChild(details(w, { verdict: verdict('wrong', 'Правильно:'), uk: false, wrong: true })); nextButton(); } }), button('Показати відповідь', '', () => selfGrade(''))], 2);
  } else {
    body.appendChild(el('p', 'tip', 'Скажи повністю вголос, потім відкрий відповідь і чесно оціни себе.'));
    const rb = button('Показати відповідь', 'btn-primary', () => selfGrade(''));
    setFoot([rb]);
    keys = { enter: () => rb.click() };
  }
};

/* Клавіатура (для комп'ютера) */
document.addEventListener('keydown', e => {
  if (currentTab !== 'learn') return;
  if (e.target.closest && e.target.closest('input,textarea,select')) return;
  if (/^[1-4]$/.test(e.key) && keys.num) { e.preventDefault(); keys.num(Number(e.key)); return; }
  if (e.key === 'Enter' && keys.enter) { if (e.target.closest && e.target.closest('button')) return; e.preventDefault(); keys.enter(); return; }
  if (e.key === ' ' && keys.space) { e.preventDefault(); keys.space(); }
});

/* ---------- Словник ---------- */
let dictCat = 'all';
let dictStatus = 'all';
let openItem = null;
const STATUS_TEXT = { new: 'нове', learning: 'вчу', known: 'знаю', leech: 'важке' };
function renderStatusSeg() {
  segment('segStatus', [['all', 'Усі'], ['new', 'Нові'], ['learning', 'Вчу'], ['known', 'Знаю'], ['leech', 'Важкі']], dictStatus, v => {
    dictStatus = v; renderStatusSeg(); renderList();
  });
}
function renderChips() {
  const box = $('chips'); box.innerHTML = '';
  [['all', 'Усі теми']].concat(Object.entries(CATS)).forEach(([k, name]) => {
    if (k === 'mine' && !custom.length) return;
    const b = el('button', 'chip', name);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(dictCat === k));
    b.addEventListener('click', () => { dictCat = k; renderChips(); renderList(); });
    box.appendChild(b);
  });
}
function renderList() {
  const q = $('search').value.trim().toLowerCase();
  const list = $('list'); list.innerHTML = '';
  const t = today();
  const items = allWords().filter(w => (dictCat === 'all' || w.cat === dictCat) &&
    (dictStatus === 'all' || C.statusOf(cards[w.id]) === dictStatus) &&
    (!q || w.en.toLowerCase().includes(q) || w.uk.toLowerCase().includes(q)));
  const known = items.filter(w => C.statusOf(cards[w.id]) === 'known').length;
  $('dictCount').textContent = words(items.length) + (known ? ', знаю ' + known : '');
  if (!items.length) {
    list.appendChild(el('li', 'empty', q ? 'Нічого не знайдено. Можна додати це слово.' : 'Тут поки порожньо.'));
    return;
  }
  const frag = document.createDocumentFragment();
  items.slice(0, 400).forEach(w => {
    const c = cards[w.id];
    const li = el('li', 'item');
    const head = el('button', 'item-head');
    head.type = 'button';
    head.setAttribute('aria-expanded', String(openItem === w.id));
    const txt = el('span', 'item-text');
    const en = el('span', 'item-en', w.en); en.lang = 'en';
    txt.append(en, el('span', 'item-uk', w.uk));
    if (c && c.st === 'review') {
      const r = C.strength(c, t);
      const m = el('span', 'meter'); const i = el('i'); i.style.width = Math.round(r * 100) + '%'; m.appendChild(i);
      m.title = 'Пам\'ять зараз: ' + Math.round(r * 100) + '%';
      txt.appendChild(m);
    }
    const st = C.statusOf(c);
    head.append(txt, el('span', 'status ' + st, STATUS_TEXT[st]));
    head.addEventListener('click', () => { openItem = openItem === w.id ? null : w.id; renderList(); });
    li.appendChild(head);
    if (openItem === w.id) li.appendChild(itemBody(w, c, t));
    frag.appendChild(li);
  });
  list.appendChild(frag);
}
function itemBody(w, c, t) {
  const body = el('div', 'item-body');
  preloadWord(w);
  if (w.ex) {
    const ex = el('p', 'ex'); ex.append(enSpan(w.ex), sayBtn(w, 'x', true)); body.appendChild(ex);
    if (w.exUk) body.appendChild(el('p', 'ex-uk', w.exUk));
  }
  if (w.note) { const n = el('p', 'note'); n.textContent = w.note; body.appendChild(n); }
  if (c) {
    let info;
    if (c.st === 'review') info = (c.due <= t ? 'Повторення сьогодні' : 'Повторення ' + C.fmtDate(c.due)) + '. Пам\'ять зараз ' + Math.round(C.strength(c, t) * 100) + '%.';
    else info = 'Ще вчиш, продовжиш на занятті.';
    if (c.lapses) info += ' Забував: ' + c.lapses + ' р.';
    body.appendChild(el('p', 'muted', info));
  }
  body.appendChild(mnemonicBlock(w, false));
  const acts = el('div', 'item-actions');
  const act = (text, fn, danger) => {
    const b = el('button', 'link-btn', text);
    b.type = 'button';
    if (danger) b.style.textDecorationColor = 'var(--orange)';
    b.addEventListener('click', fn);
    acts.appendChild(b);
  };
  act('Послухати', () => sayWord(w, 'w'));
  if (!c) act('Вже знаю', () => {
    cards[w.id] = C.knownCard(t, settings.retention, Math.random);
    persist(); resetSession(); renderList(); toast('Позначено як відоме');
  });
  if (c) act('Вчити заново', () => {
    if (!confirm('Почати вчити «' + w.en + '» з нуля?')) return;
    delete cards[w.id]; persist(); resetSession(); renderList(); toast('Слово знову серед нових');
  });
  if (w.cat === 'mine') act('Видалити', () => {
    if (!confirm('Видалити «' + w.en + '» зі словника?')) return;
    custom = custom.filter(x => x.id !== w.id);
    delete cards[w.id]; delete notes[w.id];
    save(KEYS.custom, custom); save(KEYS.notes, notes); persist(); reindex(); resetSession();
    openItem = null; renderChips(); renderList(); toast('Слово видалено');
  }, true);
  body.appendChild(acts);
  return body;
}
function resetSession() { session = null; current = null; ui = null; }
$('search').addEventListener('input', () => { openItem = null; renderList(); });
$('addOpen').addEventListener('click', () => {
  $('addPanel').hidden = false;
  const q = $('search').value.trim();
  if (q && /[a-z]/i.test(q)) $('fEn').value = q;
  $('fEn').focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
$('addCancel').addEventListener('click', () => { $('addForm').reset(); $('addPanel').hidden = true; });
$('addForm').addEventListener('submit', e => {
  e.preventDefault();
  const en = $('fEn').value.trim(), uk = $('fUk').value.trim();
  if (!en || !uk) return;
  if (allWords().some(w => w.en.toLowerCase() === en.toLowerCase())) { toast('«' + en + '» уже є у словнику'); return; }
  custom.unshift({ id: 'u' + Date.now().toString(36), cat: 'mine', en, uk, ex: $('fEx').value.trim(), exUk: $('fExUk').value.trim() });
  save(KEYS.custom, custom);
  reindex();
  resetSession();
  $('addForm').reset(); $('addPanel').hidden = true;
  $('search').value = '';
  dictCat = 'mine'; dictStatus = 'all';
  renderStatusSeg(); renderChips(); renderList();
  toast('Слово додано, воно буде першим серед нових');
});
['fEn', 'fUk', 'fEx', 'fExUk', 'search'].forEach(id => {
  $(id).addEventListener('focus', () => document.body.classList.add('typing'));
  $(id).addEventListener('blur', () => document.body.classList.remove('typing'));
});

/* ---------- Звіт ---------- */
function totals() {
  const all = allWords();
  const by = { new: 0, learning: 0, known: 0, leech: 0 };
  all.forEach(w => { by[C.statusOf(cards[w.id])]++; });
  return { all: all.length, ...by };
}
function reportRows() {
  const l = todayLog();
  const tt = totals();
  const acc = l.r ? Math.round((l.r - (l.a || 0)) / l.r * 100) : 0;
  const s = streak();
  return [
    ['Час', mins(Math.round((l.ms || 0) / 60000))],
    ['Нових слів', String(l.n || 0)],
    ['Повторено', String(l.rv || 0)],
    ['Відповідей', (l.r || 0) + (l.r ? ', точність ' + acc + '%' : '')],
    ['Серія', s ? days(s) + ' поспіль' : 'ще не почата'],
    ['Вчу', words(tt.learning + tt.leech)],
    ['Знаю', words(tt.known)]
  ];
}
function reportText() {
  return ['Англійська, ' + C.fmtDate(today())].concat(reportRows().map(([a, b]) => a + ': ' + b)).join('\n');
}
function renderReport() {
  const t = today();
  $('reportTitle').textContent = 'Звіт за ' + C.fmtDate(t);
  const docket = $('docket'); docket.innerHTML = '';
  reportRows().forEach(([a, b]) => { const d = el('div'); d.append(el('dt', null, a), el('dd', null, b)); docket.appendChild(d); });

  const hasProgress = Object.keys(cards).length > 0;
  const lastB = meta.lastBackup;
  const stale = hasProgress && (lastB == null || t - lastB >= 7);
  $('backupCallout').hidden = !stale;
  if (stale) $('backupText').textContent = lastB == null ? 'Ти ще жодного разу не зберігав копію прогресу. Якщо Safari очистить дані, все вивчене зникне.' : 'Остання копія прогресу: ' + C.fmtDate(lastB) + '. Варто зберегти свіжу.';

  let rv = 0, ok = 0;
  for (let d = t - 29; d <= t; d++) { const l = log[C.dayKey(d)]; if (l) { rv += l.rv || 0; ok += l.rok || 0; } }
  const target = Math.round(settings.retention * 100);
  const rt = $('retention');
  rt.innerHTML = '';
  const gb = $('gaugeBox'); gb.innerHTML = '';
  if (rv >= 15) {
    const pct = Math.round(ok / rv * 100);
    const g = el('div', 'gauge'); g.setAttribute('role', 'img');
    g.setAttribute('aria-label', 'Згадуєш ' + pct + '%, ціль ' + target + '%');
    const fillG = el('i'); fillG.style.width = pct + '%';
    const mark = el('span', 'mark'); mark.style.left = target + '%'; mark.title = 'Ціль ' + target + '%';
    g.append(fillG, mark);
    gb.appendChild(g);
    rt.append(document.createTextNode('На повтореннях ти згадуєш '), el('b', null, pct + '%'), document.createTextNode(' слів (ціль ' + target + '%). '));
    rt.appendChild(document.createTextNode(pct < target - 7
      ? 'Забуваєш більше, ніж треба: краще вчити щодня і брати менше нових слів.'
      : pct > target + 6 ? 'Пам\'ятаєш дуже добре: можна брати більше нових слів.' : 'Саме так, як задумано.'));
  } else {
    rt.textContent = 'Оцінка з\'явиться після кількох днів повторень. Алгоритм тримає ціль ' + target + '%: саме стільки слів ти маєш згадувати на повторенні.';
  }

  const chart = $('chart'); chart.innerHTML = '';
  const vals = [];
  for (let d = t - 13; d <= t; d++) { const l = log[C.dayKey(d)]; vals.push({ d, r: l ? l.r || 0 : 0 }); }
  const max = Math.max(10, ...vals.map(v => v.r));
  vals.forEach(v => {
    const b = el('div', 'bar' + (v.r ? '' : ' zero') + (v.d === t ? ' today' : ''));
    b.style.height = Math.max(3, v.r / max * 100) + '%';
    b.title = C.fmtDate(v.d) + ': ' + v.r;
    chart.appendChild(b);
  });
  chart.setAttribute('aria-label', 'Відповіді за 14 днів: ' + vals.map(v => C.fmtDate(v.d).slice(0, 5) + ' ' + v.r).join(', '));
  $('chartFrom').textContent = C.fmtDate(t - 13).slice(0, 5);

  const fc = $('forecast'); fc.innerHTML = '';
  const legend = $('forecastLegend'); legend.innerHTML = '';
  const counts = [];
  for (let i = 1; i <= 7; i++) counts.push(Object.values(cards).filter(c => c.st === 'review' && (i === 1 ? c.due <= t + 1 : c.due === t + i)).length);
  const fmax = Math.max(5, ...counts);
  const WD = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  counts.forEach((n, i) => {
    const b = el('div', 'bar alt' + (n ? '' : ' zero'));
    b.style.height = Math.max(3, n / fmax * 100) + '%';
    b.title = n + '';
    fc.appendChild(b);
    const d = new Date((t + i + 1) * 86400000);
    legend.appendChild(el('span', null, i === 0 ? 'завтра' : WD[d.getUTCDay()]));
  });
  fc.setAttribute('aria-label', 'Повторень на 7 днів: ' + counts.join(', '));

  const tt = totals();
  const rows = [
    ['Знаю (міцно на 3+ тижні)', tt.known], ['Вчу', tt.learning], ['Важкі', tt.leech],
    ['Ще не вчив', tt.new], ['Свої слова', custom.length], ['Усього', tt.all]
  ];
  vocabBar($('vocabBar'), null, tt);
  const dl = $('totals'); dl.innerHTML = '';
  rows.forEach(([k, v]) => { const d = el('div'); d.append(el('dt', null, k), el('dd', null, String(v))); dl.appendChild(d); });

  const hard = Object.entries(cards).filter(([id, c]) => byId(id) && c.st !== 'learn' && ((c.lapses || 0) >= 2 || (c.d || 0) >= 8))
    .sort((a, b) => (b[1].lapses || 0) - (a[1].lapses || 0) || (b[1].d || 0) - (a[1].d || 0)).slice(0, 6);
  $('hardBox').hidden = !hard.length;
  const hl = $('hardList'); hl.innerHTML = '';
  hard.forEach(([id, c]) => {
    const w = byId(id);
    const li = el('li', 'item');
    const head = el('button', 'item-head');
    head.type = 'button';
    const txt = el('span', 'item-text');
    const en = el('span', 'item-en', w.en); en.lang = 'en';
    txt.append(en, el('span', 'item-uk', w.uk));
    head.append(txt, el('span', 'status leech', 'забував ' + (c.lapses || 0)));
    head.addEventListener('click', () => { $('search').value = w.en; openItem = w.id; dictCat = 'all'; dictStatus = 'all'; showTab('dict'); });
    li.appendChild(head);
    hl.appendChild(li);
  });
}
async function copyReport() {
  const text = reportText();
  try { await navigator.clipboard.writeText(text); }
  catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (_) {}
    ta.remove();
  }
  toast('Звіт скопійовано');
}
$('copyReport').addEventListener('click', copyReport);

/* ---------- Налаштування ---------- */
function segment(boxId, options, value, onPick) {
  const box = $(boxId); box.innerHTML = '';
  options.forEach(([val, label]) => {
    const b = el('button', null, label);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(value === val));
    b.addEventListener('click', () => onPick(val));
    box.appendChild(b);
  });
}
function renderVoices() {
  const sel = $('voice');
  sel.innerHTML = '';
  if (!synth) { sel.disabled = true; $('voiceNote').textContent = 'Цей браузер не вміє озвучувати текст.'; return; }
  if (!voices.length) { sel.appendChild(new Option('Стандартний британський', '')); $('voiceNote').textContent = ''; return; }
  const cur = pickVoice();
  voices.forEach(v => {
    const accent = /IE/i.test(v.lang) ? 'ірландський' : /GB/i.test(v.lang) ? 'британський' : v.lang;
    sel.appendChild(new Option(v.name + ' (' + accent + ')', v.voiceURI, false, cur && v.voiceURI === cur.voiceURI));
  });
  $('voiceNote').textContent = voices.some(v => /IE/i.test(v.lang)) ? 'Тут є й ірландський голос: корисно, щоб звикати до місцевої вимови.' : '';
}
const SAMPLE_ID = 'site-hand';
const RET_NOTES = {
  0.85: 'Повторень менше, але частіше забуватимеш.',
  0.9: 'Рекомендовано: найкращий баланс часу й пам\'яті.',
  0.95: 'Пам\'ятатимеш міцніше, але повторень буде помітно більше.'
};
function renderSettings() {
  const re = () => { saveSettings(); renderSettings(); };
  segment('segNew', [[5, '5'], [10, '10'], [15, '15'], [20, '20']], settings.newPerDay, v => { settings.newPerDay = v; re(); });
  segment('segMode', [['mix', 'Вправи'], ['cards', 'Тільки картки']], settings.mode, v => { settings.mode = v; re(); });
  segment('segLen', [[0, 'Усе'], [15, '≈ 5 хв'], [30, '≈ 10 хв']], settings.sessionLen, v => { settings.sessionLen = v; re(); });
  segment('segRet', [[0.85, '85%'], [0.9, '90%'], [0.95, '95%']], settings.retention, v => { settings.retention = v; re(); });
  $('retNote').textContent = 'Яку частку слів ти маєш згадувати на повторенні. ' + RET_NOTES[settings.retention];
  $('typing').checked = settings.typing !== false;
  $('speaking').checked = settings.speaking !== false;
  const vopts = AUD.voices.map(v => [v, VOICE_NAMES[v] || v]).concat([['device', 'iPhone']]);
  segment('segVoice', vopts, settings.voiceSrc, v => { settings.voiceSrc = v; re(); sayWord(byId(SAMPLE_ID), 'x'); });
  segment('segRate', [[0.75, 'Повільно'], [0.9, 'Середньо'], [1, 'Звичайно']], settings.rate, v => { settings.rate = v; re(); sayWord(byId(SAMPLE_ID), 'x'); });
  $('voiceLbl').textContent = settings.voiceSrc === 'device' ? 'Голос iPhone' : 'Голос iPhone для слів, доданих на сайті';
  $('offlineAudio').hidden = settings.voiceSrc === 'device' || !AUD.voices.length;
  $('autoplay').checked = settings.autoplay;
  renderVoices();
  const box = $('catToggles'); box.innerHTML = '';
  Object.entries(CATS).forEach(([k, name]) => {
    if (k === 'mine') return;
    const total = BASE.filter(w => w.cat === k).length;
    if (!total) return;
    const fresh = BASE.filter(w => w.cat === k && !cards[w.id]).length;
    const row = el('div', 'toggle');
    const label = el('span', null, name);
    label.appendChild(el('span', 'opt', fresh + ' з ' + total + ' ще не вчив'));
    const sw = el('input', 'switch'); sw.type = 'checkbox'; sw.checked = settings.cats[k] !== false;
    sw.setAttribute('aria-label', name);
    sw.addEventListener('change', () => { settings.cats[k] = sw.checked; saveSettings(); });
    row.append(label, sw);
    box.appendChild(row);
  });
  $('lastBackup').textContent = meta.lastBackup != null ? 'Остання копія: ' + C.fmtDate(meta.lastBackup) + '.' : 'Копію ще не зберігали.';
}
$('typing').addEventListener('change', e => { settings.typing = e.target.checked; saveSettings(); });
$('speaking').addEventListener('change', e => { settings.speaking = e.target.checked; saveSettings(); });
$('autoplay').addEventListener('change', e => { settings.autoplay = e.target.checked; saveSettings(); });
$('voice').addEventListener('change', e => { settings.voice = e.target.value; saveSettings(); speakDevice('Can you give me a hand?'); });
$('voiceTest').innerHTML = ICON.speaker;
$('voiceTest').addEventListener('click', () => speakDevice('Can you give me a hand with these slabs?'));

let offlineBusy = false;
$('offlineAudio').addEventListener('click', async () => {
  if (offlineBusy) return;
  const urls = [];
  allWords().forEach(w => { const a = clipUrl(w, 'w'), b = clipUrl(w, 'x'); if (a) urls.push(a); if (b) urls.push(b); });
  if (!urls.length) return;
  offlineBusy = true;
  const btn = $('offlineAudio');
  let done = 0, failed = 0;
  const worker = async () => {
    while (urls.length) {
      const u = urls.pop();
      try { const r = await fetch(u); if (!r.ok) failed++; else await r.arrayBuffer(); } catch (e) { failed++; }
      done++;
      if (done % 10 === 0) btn.textContent = 'Завантажую… ' + done;
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  offlineBusy = false;
  btn.textContent = 'Завантажити всі записи для офлайну';
  toast(failed ? 'Не вдалося завантажити ' + failed + '. Спробуй ще раз з інтернетом.' : 'Готово: записи працюватимуть і без інтернету');
});

/* Резервна копія */
function backupData() { return { app: 'english-words', version: 3, saved: new Date().toISOString(), cards, custom, notes, log, settings, meta }; }
function markBackup() { meta.lastBackup = today(); save(KEYS.meta, meta); }
async function saveBackup() {
  const json = JSON.stringify(backupData());
  const name = 'english-words-' + C.dayKey(today()) + '.json';
  try {
    const file = new File([json], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'English Words, копія' });
      markBackup(); refreshAfterBackup();
      return;
    }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  markBackup(); refreshAfterBackup();
  toast('Копію збережено');
}
function refreshAfterBackup() { if (currentTab === 'report') renderReport(); if (currentTab === 'settings') renderSettings(); }
$('backupSave').addEventListener('click', saveBackup);
$('backupNow').addEventListener('click', saveBackup);
$('backupLoad').addEventListener('click', () => $('backupFile').click());
$('backupFile').addEventListener('change', async e => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (data.app !== 'english-words') throw new Error('bad');
    const when = data.saved ? new Date(data.saved) : null;
    const label = when ? C.fmtDate(C.dayNum(when)) : 'невідомої дати';
    if (!confirm('Замінити поточний прогрес копією від ' + label + '?')) return;
    cards = data.cards || (data.progress ? C.migrateV2(data.progress, today()) : {});
    custom = data.custom || []; log = data.log || {}; notes = data.notes || {};
    meta = Object.assign({}, data.meta || {});
    settings = Object.assign({}, DEFAULT_SETTINGS, data.settings || {});
    settings.cats = Object.assign({}, settings.cats || {});
    if (![0.85, 0.9, 0.95].includes(settings.retention)) settings.retention = 0.9;
    save(KEYS.custom, custom); save(KEYS.notes, notes); save(KEYS.meta, meta); saveSettings(); persist();
    reindex(); session = null; current = null;
    renderAll();
    toast('Прогрес відновлено');
  } catch (err) {
    toast('Це не схоже на копію English Words. Вибери файл english-words-….json');
  }
});
$('resetAll').addEventListener('click', () => {
  if (!confirm('Скинути весь прогрес і статистику? Свої слова й асоціації залишаться. Скасувати це не вийде.')) return;
  cards = {}; log = {}; persist();
  session = null; current = null;
  renderAll();
  toast('Прогрес скинуто');
});

/* ---------- Вкладки ---------- */
function showTab(name) {
  currentTab = name;
  document.querySelectorAll('[data-screen]').forEach(s => { s.hidden = s.dataset.screen !== name; });
  document.querySelectorAll('[data-tab]').forEach(t => {
    if (t.dataset.tab === name) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
  });
  if (name !== 'learn') stopAudio();
  if (name === 'learn') renderLearn();
  if (name === 'dict') { renderStatusSeg(); renderChips(); renderList(); }
  if (name === 'report') renderReport();
  if (name === 'settings') renderSettings();
  window.scrollTo(0, 0);
}
document.querySelectorAll('[data-tab]').forEach(t => t.addEventListener('click', () => showTab(t.dataset.tab)));
function renderAll() { renderStreak(); showTab(currentTab); }

let lastDay = today();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (today() !== lastDay) { lastDay = today(); session = null; current = null; ui = null; renderAll(); }
});
window.addEventListener('resize', () => { if (currentTab === 'learn') updateTape(); });

renderAll();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}
if (/[?&]test=1/.test(location.search)) {
  window.EW = {
    get session() { return session; }, get current() { return current; }, get cards() { return cards; }, get log() { return log; },
    settings, nextItem, showTab,
    force(id, exercise) {
      if (!session) session = new C.Session(envFor());
      showTab('learn');
      current = { id, word: byId(id), card: cards[id], exercise, source: 'review' };
      show(current);
    }
  };
}
})();

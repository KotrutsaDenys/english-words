/* Інтерфейс English Words: навчання, словник, звіт, налаштування */
(function () {
'use strict';

const C = window.EWCore;
const F = window.FSRS;
const CATS = window.CATEGORIES;
const BASE = window.WORDS;
const AUD = window.AUDIO || { voices: [], files: {} };
const PHRASES = window.PHRASES || {};

/* ---------- Дрібниці ---------- */
const $ = id => document.getElementById(id);
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
let toastTimer;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}
const KEYS = { cards: 'ew.cards', progress: 'ew.progress', custom: 'ew.custom', log: 'ew.log', settings: 'ew.settings', notes: 'ew.notes', meta: 'ew.meta', own: 'ew.own', grammar: 'ew.grammar' };
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
/* Коротко для вузьких кнопок оцінки: «9 дн.», «2 міс.» */
function shortDays(n) {
  if (n == null) return '';
  if (n <= 0) return 'знову';
  if (n === 1) return 'завтра';
  if (n < 60) return n + ' дн.';
  if (n < 365) return Math.round(n / 30) + ' міс.';
  return (Math.round(n / 36.5) / 10).toString().replace('.', ',') + ' р.';
}

/* ---------- Стан ---------- */
let currentTab = 'learn';
const DEFAULT_SETTINGS = {
  newPerDay: 10, mode: 'mix', typing: true, speaking: true, sessionLen: 0, retention: 0.9,
  autoplay: true, voiceSrc: 'emma', voice: '', rate: 1, cats: {}, pretest: true,
  autoNext: true, quiet: false, haptics: true,
  listen: { shadow: false, phrases: false, uk: true }
};
let settings = Object.assign({}, DEFAULT_SETTINGS, load(KEYS.settings, {}));
settings.cats = Object.assign({}, settings.cats || {});
settings.listen = Object.assign({}, DEFAULT_SETTINGS.listen, settings.listen || {});
if (![0.75, 0.9, 1].includes(settings.rate)) settings.rate = settings.rate < 0.8 ? 0.75 : settings.rate < 0.95 ? 0.9 : 1;
if (![0.85, 0.9, 0.95].includes(settings.retention)) settings.retention = 0.9;
delete settings.dir;

let custom = load(KEYS.custom, []);
let notes = load(KEYS.notes, {});
let own = load(KEYS.own, {});
let log = load(KEYS.log, {});
let meta = load(KEYS.meta, {});
let cards = load(KEYS.cards, null);
if (!cards) {
  const old = load(KEYS.progress, null);
  cards = old ? C.migrateV2(old, today()) : {};
  if (old) { save(KEYS.cards, cards); save('ew.progress.v2', old); remove(KEYS.progress); }
}

let index = null;
let peekIdx = null;     // пошук слова з прикладу (будується при першому дотику)
function allWords() { return custom.concat(BASE); }
function byId(id) {
  if (!index) index = new Map(allWords().map(w => [w.id, w]));
  return index.get(id);
}
function reindex() { index = null; peekIdx = null; }
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
let ukVoices = [];
function loadVoices() {
  if (!synth) return;
  const all = synth.getVoices();
  ukVoices = all.filter(v => /^uk/i.test(v.lang));
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
function textFor(w, kind) { return kind === 'x2' ? (w.sayEx2 || w.ex2) : kind === 'x' ? (w.sayEx || w.ex) : (w.say || w.en); }
function clipUrl(w, kind) {
  const voice = settings.voiceSrc;
  if (!w || !AUD.voices.includes(voice)) return null;
  const f = AUD.files[w.id];
  if (kind === 'x' && w.exN === 2) kind = 'x2';
  const h = f && (kind === 'x2' ? f[2] : kind === 'x' ? f[1] : f[0]);
  return h ? '/audio/' + voice + '/' + w.id + '-' + h + '.mp3' : null;
}
function canListen() { return (AUD.voices.includes(settings.voiceSrc) && AUD.voices.length > 0) || !!synth; }
function stopAudio() { clearSegment(); try { player.pause(); } catch (e) {} if (synth) synth.cancel(); }
/* Фрази слова лежать в одному файлі: граємо шматок [початок, кінець] і зупиняємось у паузі після нього */
let segEnd = 0, segTimer = null, segToken = 0;
function clearSegment() { segEnd = 0; if (segTimer) { clearInterval(segTimer); segTimer = null; } }
function playSegment(url, start, end, fallbackText, rate) {
  stopAudio();
  playing = url;
  player.dataset.fallback = fallbackText || '';
  const src = blobs.get(url) || url;
  const from = Math.max(0, start - 0.04);
  const token = ++segToken;
  const seek = () => { if (token !== segToken) return; try { if (Math.abs(player.currentTime - from) > 0.08) player.currentTime = from; } catch (e) {} };
  if (player.getAttribute('src') !== src) {
    player.src = src;
    player.addEventListener('loadedmetadata', seek, { once: true });
  }
  if (player.readyState >= 1) seek();
  player.defaultPlaybackRate = rate || settings.rate;
  player.playbackRate = rate || settings.rate;
  segEnd = end + 0.12;
  segTimer = setInterval(() => {
    if (!segEnd) return;
    if (player.currentTime >= segEnd) { const keep = playing; try { player.pause(); } catch (e) {} clearSegment(); playing = keep; }
  }, 30);
  const p = player.play();
  if (p && p.catch) p.catch(err => { if (err && err.name !== 'AbortError' && playing === url) { clearSegment(); speakDevice(fallbackText, rate); } });
}
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
function preloadWord(w) { if (!w) return; preloadUrl(clipUrl(w, 'w')); if (w.ex) preloadUrl(clipUrl(w, 'x')); if (w.ex2) preloadUrl(clipUrl(w, 'x2')); }
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
/* Файл з усіма фразами слова: AUDIO.phrases[id] = [хеш, [початок, кінець], ...] */
function phrasePackUrl(w) {
  const voice = settings.voiceSrc;
  if (!w || !AUD.voices.includes(voice) || !AUD.phrases) return null;
  const pk = AUD.phrases[w.id];
  return pk && typeof pk[0] === 'string' ? '/audio/' + voice + '/' + w.id + '-p' + pk[0] + '.mp3' : null;
}
function sayPhrase(w, i) {
  const p = (PHRASES[w.id] || [])[i];
  if (!p) return;
  const url = phrasePackUrl(w);
  const t = url && AUD.phrases[w.id][i + 1];
  if (t) playSegment(url, t[0], t[1], p[0]); else speakDevice(p[0]);
}
function cleanPhrase(t) { return String(t).replace(/[?!.,]+$/g, '').replace(/[“”"]/g, '').trim(); }
function youglishUrl(t) { return 'https://youglish.com/pronounce/' + encodeURIComponent(cleanPhrase(t)) + '/english/uk'; }
function youtubeUrl(t) { return 'https://m.youtube.com/results?search_query=' + encodeURIComponent('"' + cleanPhrase(t) + '"'); }
/* Блок фраз: 5 коротких сполучень зі словом, кожна з озвучкою і відео, де її кажуть */
function phraseBlock(w, open) {
  const list = PHRASES[w.id];
  if (!list || !list.length) return null;
  const box = el('div', 'phrases');
  const head = el('button', 'phrases-head');
  head.type = 'button';
  head.setAttribute('aria-expanded', String(!!open));
  head.append(el('span', null, 'Фрази зі словом'), el('span', 'phrases-n', String(list.length)));
  const body = el('div', 'phrases-body');
  body.hidden = !open;
  list.forEach((p, i) => {
    const row = el('div', 'phrase');
    const play = el('button', 'say sm');
    play.type = 'button';
    play.innerHTML = ICON.speaker;
    play.setAttribute('aria-label', 'Послухати фразу');
    play.addEventListener('click', e => { e.stopPropagation(); sayPhrase(w, i); });
    const text = el('div', 'phrase-text');
    const en = el('span', 'phrase-en'); en.appendChild(enText(p[0]));
    text.append(en, el('span', 'phrase-uk', p[1]));
    const acts = el('div', 'phrase-acts');
    const link = (label, href, title) => {
      const a = el('a', 'mini');
      a.innerHTML = ICON.play + label;
      a.href = href; a.target = '_blank'; a.rel = 'noopener'; a.title = title;
      a.addEventListener('click', e => e.stopPropagation());
      return a;
    };
    acts.append(link('YouGlish', youglishUrl(p[0]), 'Відео, де носії кажуть цю фразу'), link('YouTube', youtubeUrl(p[0]), 'Пошук фрази в YouTube'));
    text.appendChild(acts);
    row.append(play, text);
    body.appendChild(row);
  });
  head.addEventListener('click', e => {
    e.stopPropagation();
    const o = body.hidden;
    body.hidden = !o;
    head.setAttribute('aria-expanded', String(o));
    if (o) preloadPhrases(w);
  });
  if (open) preloadPhrases(w);
  box.append(head, body);
  return box;
}
function preloadPhrases(w) { preloadUrl(phrasePackUrl(w)); }
function sayWord(w, kind, rate) {
  if (!w) return;
  const text = textFor(w, kind);
  if (!text) return;
  const url = clipUrl(w, kind);
  if (url) playUrl(url, text, rate); else speakDevice(text, rate);
}
if (navigator.audioSession) { try { navigator.audioSession.type = 'playback'; } catch (e) {} }
/* Озвучка без натискання: у тихому режимі мовчить. Кнопки з динаміком працюють завжди */
function autoSay(w, kind) { if (!settings.quiet) sayWord(w, kind); }
function audioBusy() { return (!player.paused && !player.ended && !!playing) || !!(synth && synth.speaking); }

/* ---------- Вібрація на відповідь ----------
   Android: navigator.vibrate. iPhone (Safari 17.4+): перемикач <input switch> дає легкий відгук,
   якщо клацнути його в обробнику натискання. */
function haptic(kind) {
  if (!settings.haptics) return;
  try {
    if (navigator.vibrate && !/iPhone|iPad/.test(navigator.userAgent)) { navigator.vibrate(kind === 'wrong' ? [25, 70, 25] : 12); return; }
    const tap = () => {
      const label = document.createElement('label');
      label.setAttribute('aria-hidden', 'true');
      label.style.display = 'none';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.setAttribute('switch', '');
      label.appendChild(input);
      document.head.appendChild(label);
      label.click();
      label.remove();
    };
    tap();
    if (kind === 'wrong') setTimeout(tap, 120);
  } catch (e) {}
}

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
  speak: SVG('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>'),
  pen: SVG('<path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M13.5 8.5l3 3"/>'),
  play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5.5v13l11-6.5z"/></svg>',
  // керування заняттям і головна
  close: SVG('<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>', 2.4),
  undo: SVG('<path d="M9 7.5 4.5 12 9 16.5"/><path d="M5 12h9.5a5 5 0 0 1 0 10H12"/>', 2.2),
  mute: SVG('<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>'),
  moon: SVG('<path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z"/>'),
  bolt: SVG('<path d="M13 3 5.5 13.5H12L11 21l7.5-10.5H12z"/>'),
  repeat: SVG('<path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.5"/><path d="M20 4v4.5h-4.5"/><path d="M20 12a8 8 0 0 1-13.7 5.6L4 15.5"/><path d="M4 20v-4.5h4.5"/>'),
  target: SVG('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="M12 12h.01"/>'),
  moonplus: SVG('<path d="M12 4v4M10 6h4"/><path d="M19.5 13.5A7.5 7.5 0 1 1 10 4.5"/>'),
  sieve: SVG('<path d="M4 5h16l-6 7.5V19l-4 1.5v-8z"/>'),
  plus: SVG('<path d="M12 5v14M5 12h14"/>', 2.4),
  calendar: SVG('<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="M12 13.5v3.5M10.2 15.3h3.6"/>'),
  share: SVG('<path d="M12 3.5v11M8 7.5l4-4 4 4"/><path d="M6.5 11H5.5A1.5 1.5 0 0 0 4 12.5v6A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5v-6a1.5 1.5 0 0 0-1.5-1.5h-1"/>'),
  chevron: SVG('<path d="m9 6 6 6-6 6"/>', 2.4),
  prev: SVG('<path d="M6 5.5v13"/><path d="M18.5 6.5 9.5 12l9 5.5z"/>'),
  next: SVG('<path d="M18 5.5v13"/><path d="M5.5 6.5l9 5.5-9 5.5z"/>'),
  pause: SVG('<path d="M8.5 5.5v13M15.5 5.5v13"/>', 3),
  book: SVG('<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v15.5H5.5A1.5 1.5 0 0 0 4 21z"/><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v15.5h5.5A1.5 1.5 0 0 1 20 21z"/>'),
  timer: SVG('<circle cx="12" cy="13.5" r="7.5"/><path d="M12 13.5V9.5M10 2.5h4M18.5 6l1.5-1.5"/>')
};
const EX_ICON = {
  intro: 'intro', mcq_en_uk: 'choose', mcq_uk_en: 'choose', listen_mcq: 'listen', flip: 'flip', flip_rev: 'flip',
  type_en: 'type', cloze: 'cloze', dictation: 'dictation', build_phrase: 'build', build_sentence: 'build', speak: 'speak', own_sentence: 'pen'
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

/* ---------- Серія днів і смуга прогресу ---------- */
function streakInfo() { return C.streakInfo(studied, today()); }
function streak() { return streakInfo().days; }
function renderStreak() {
  const s = streak();
  $('streak').innerHTML = s > 0 ? ICON.flame + '<span><b>' + days(s) + '</b> поспіль</span>' : '';
}
function renderTape(done, total, label, remUnits, hideLeft) {
  const pct = total > 0 ? Math.min(100, done / total * 100) : 0;
  $('tapeFill').style.width = pct + '%';
  // Мету дня досягнуто: смуга один раз спалахує й стає зеленою
  const tape = $('tape');
  const full = total > 0 && done >= total;
  if (full && !tape.classList.contains('full') && tape.dataset.seen === '1') { tape.classList.remove('snap'); void tape.offsetWidth; tape.classList.add('snap'); }
  tape.classList.toggle('full', full);
  tape.dataset.seen = '1';
  tape.setAttribute('aria-valuemax', String(total));
  tape.setAttribute('aria-valuenow', String(done));
  $('tapeDone').innerHTML = total > 0 ? (label || 'Зроблено') + ' <b>' + done + '</b> з ' + total : 'На сьогодні нічого';
  const left = remUnits != null ? remUnits : Math.max(0, total - done);
  const leftText = remUnits != null ? 'ще ≈ ' + mins(Math.max(1, Math.ceil(left * 10 / 60))) : 'ще ' + left;
  $('tapeLeft').textContent = total > 0 && !hideLeft ? (left ? leftText : 'усе на сьогодні') : '';
}

/* ---------- Навчання ---------- */
let session = null;
let current = null;
let ui = null;          // стан поточної вправи
let practiceDone = 0;
let keys = {};          // клавіатурні дії поточного екрана
let mode = null;        // що на екрані вправ: session, sprint, triage, summary; null = головна
let itemHistory = [];   // вправи, до яких можна повернутися кнопкою «назад»
let sess = null;        // знімок дня на початку заняття, для підсумку

function envFor(practiceIds, reviewOnly, limit) {
  return {
    words: allWords(), cards, settings, today: today(), log: todayLog(), rng: Math.random, canListen: canListen(),
    practiceIds, reviewOnly, limit, priority: meta.priority || [], withNew: !!todayLog().nw
  };
}
function updateTape() {
  updateSessionBar();
  if (sprint) { sprintTape(); return; }
  if (mode === 'listen' && listen) { listenTape(); return; }
  if ((mode === 'gtest' || mode === 'gresult') && gt) { gtTape(); return; }
  if (session && session.practice) { renderTape(practiceDone, practiceDone + session.remaining(), 'Тренування'); return; }
  const l = todayLog();
  const done = (l.r || 0) + (l.n || 0) + (l.k || 0);
  const rem = (session || new C.Session(envFor())).remainingUnits();
  // На головній час уже є на кнопці «Почати», тут лише скільки зроблено за день
  renderTape(done, done + rem, mode ? null : 'Сьогодні', rem, !mode);
}
/* Верхній рядок під час заняття: вийти, повернути відповідь, тихий режим */
function updateSessionBar() {
  const inSession = !!mode && currentTab === 'learn';
  document.body.classList.toggle('in-session', inSession);
  $('exitBtn').hidden = !inSession;
  const undoable = mode === 'session' && !!session && session.canUndo();
  $('undoBtn').hidden = mode !== 'session';
  $('undoBtn').disabled = !undoable;
  $('quietBtn').hidden = mode !== 'session';
  $('ruleBtn').hidden = mode !== 'gtest';
  $('quietBtn').setAttribute('aria-pressed', String(!!settings.quiet));
  $('quietBtn').innerHTML = settings.quiet ? ICON.mute : ICON.speaker;
  $('quietBtn').setAttribute('aria-label', settings.quiet ? 'Тихий режим увімкнено' : 'Тихий режим');
  syncHistory();
}
/* Жест «назад» (свайп від краю в Safari, кнопка на Android) закриває заняття, а не сайт */
let histPushed = false, ignorePop = false;
function syncHistory() {
  try {
    if (mode && !histPushed) { history.pushState({ ew: 'stage' }, ''); histPushed = true; }
    else if (!mode && histPushed) { histPushed = false; ignorePop = true; history.back(); }
  } catch (e) {}
}
window.addEventListener('popstate', () => {
  if (ignorePop) { ignorePop = false; return; }
  // Відкрита тема граматики: «назад» повертає до списку тем
  if (!histPushed) { if (gramPushed) { gramPushed = false; closeTopic(); } return; }
  histPushed = false;
  if (mode === 'session') endSession(true);
  else if (mode === 'sprint') endSprint();
  else if (mode === 'listen') finishListen();
  else if (mode === 'gtest' || mode === 'gresult') endGramTest();
  else if (mode) { triage = null; mode = null; renderLearn(); }
});
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
const lowerFirst = s => s.charAt(0).toLowerCase() + s.slice(1);
function studied(d) { const l = log[C.dayKey(d)]; return !!(l && (l.r > 0 || l.c > 0 || l.gt > 0)); }
function weekSection() {
  const t = today();
  const wd = new Date(t * 86400000).getUTCDay();
  const monday = t - ((wd + 6) % 7);
  const info = streakInfo();
  const rests = new Set(info.rests);
  const sec = el('section', 'section');
  const title = el('h3', 'section-title', 'Цей тиждень');
  title.appendChild(el('span', null, info.days ? 'серія ' + days(info.days) : 'серія ще не почата'));
  sec.appendChild(title);
  const row = el('div', 'week');
  let restShown = false;
  for (let d = monday; d < monday + 7; d++) {
    const done = studied(d);
    const rest = !done && rests.has(d);
    if (rest) restShown = true;
    const cell = el('div', 'day' + (done ? ' done' : '') + (rest ? ' rest' : '') + (d === t ? ' today' : ''));
    const dot = el('i');
    if (done) dot.innerHTML = ICON.check;
    else if (rest) dot.innerHTML = ICON.moon;
    dot.setAttribute('aria-hidden', 'true');
    cell.append(dot, document.createTextNode(WD_SHORT[(d - monday + 1) % 7]));
    cell.setAttribute('aria-label', C.fmtDate(d) + (done ? ': було заняття' : rest ? ': вихідний, серія не обірвалась' : d > t ? '' : ': без заняття'));
    row.appendChild(cell);
  }
  sec.appendChild(row);
  if (restShown) sec.appendChild(el('p', 'tip', 'Місяць — вихідний: один пропущений день на тиждень серію не обриває.'));
  else if (!info.todayDone && info.days === 0 && studied(t - 2) && !studied(t - 1)) sec.appendChild(el('p', 'tip', 'Вчора був пропуск. Заняття сьогодні збереже серію.'));
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

/* Плитка швидкої дії на головній */
function quick(icon, title, sub, onClick, cls) {
  const b = el('button', 'qa' + (cls ? ' ' + cls : ''));
  b.type = 'button';
  const ic = el('span', 'qa-ic'); ic.innerHTML = ICON[icon] || '';
  const txt = el('span', 'qa-text');
  txt.append(el('b', null, title), el('small', null, sub));
  b.append(ic, txt);
  b.addEventListener('click', onClick);
  return b;
}
/* Головна кнопка дня: завжди в одному місці, під великим пальцем */
function dock(text, sub, onClick) {
  const d = el('div', 'dock');
  const b = button(text, 'btn-primary btn-big', onClick, sub);
  d.appendChild(b);
  return { box: d, btn: b };
}
function dueTomorrow() { const t = today(); return Object.values(cards).filter(c => c.st === 'review' && c.due === t + 1).length; }

function renderLearn() {
  if (mode) { $('stage').hidden = false; $('learnHome').hidden = true; updateTape(); return; }
  $('stage').hidden = true;
  $('learnHome').hidden = false;
  setFoot([]);
  updateTape();
  const home = $('learnHome');
  home.innerHTML = '';
  home.classList.remove('has-dock');
  keys = {};
  const t = today();
  const l = todayLog();
  const plan = new C.Session(envFor());
  const cnt = plan.counts();
  const total = cnt.reviews + cnt.learning + cnt.fresh;
  const units = plan.remainingUnits();
  const misses = (l.miss || []).filter(id => byId(id));
  const fresh = Object.keys(cards).filter(id => byId(id) && cards[id].first === t && !cards[id].known);
  const left = C.orderNew(allWords(), cards, settings.cats, null, null, meta.priority).length;
  const sp = C.sprintPool(allWords(), cards).length;
  const hour = new Date().getHours();
  const evening = hour >= 19 || hour < 4;
  const tiles = [];
  let main = null;
  home.appendChild(el('p', 'greet', greeting()));
  if (total) {
    const sentence = planSentence(cnt);
    home.appendChild(el('h2', 'hero', l.r ? 'Ще ' + lowerFirst(sentence) : sentence));
    if (meta.reminder && meta.reminder.a) home.appendChild(el('p', 'plan-line', 'Твій план: ' + meta.reminder.a + ', о ' + meta.reminder.t));
    if (settings.quiet) {
      const q = el('button', 'plan-line quiet-chip');
      q.type = 'button';
      q.innerHTML = ICON.mute;
      q.append(document.createTextNode('Тихий режим увімкнено · '), el('u', null, 'вимкнути'));
      q.addEventListener('click', () => { settings.quiet = false; saveSettings(); renderLearn(); toast('Звук увімкнено'); });
      home.appendChild(q);
    }
    if (plan.newPaused) home.appendChild(el('p', 'tip', 'Після пропущених днів накопичилось ' + plan.overdue + ' ' + C.plural(plan.overdue, 'повторення', 'повторення', 'повторень') + '. Нові слова почекають, поки не розбереш їх: найслабші йдуть першими.'));
    else if (cnt.reviews >= 40 && cnt.fresh) home.appendChild(el('p', 'tip', 'Повторень сьогодні багато. Нічого страшного, якщо зробиш лише їх, а нові слова почекають до завтра.'));
    main = dock(l.r ? 'Продовжити' : 'Почати', '≈ ' + mins(estimateMinutes(units)), () => startSession());
    if (units > 14) tiles.push(quick('bolt', 'Хоч 2 хвилини', cnt.reviews ? 'найслабші повторення' : 'коротке заняття', startShort));
    if (cnt.reviews && cnt.fresh) tiles.push(quick('repeat', 'Тільки повторення', 'без нових слів', () => startSession(null, true)));
    const gdue = gramDue();
    if (gdue.length) tiles.push(quick('pen', 'Граматика: повторити', GR.topics[gdue[0]].title + (gdue.length > 1 ? ' і ще ' + (gdue.length - 1) : ''), () => openTopic(gdue[0])));
    if (plan.newPaused && left) tiles.push(quick('plus', 'Взяти й нові слова', 'сьогодні, попри борг', () => { todayLog().nw = 1; persist(); startSession(); }));
    plan.reviews.slice(0, 3).concat(plan.newIds.slice(0, 2)).forEach(id => preloadWord(byId(id)));
  } else {
    if (l.r) {
      home.appendChild(el('h2', 'hero', 'Готово на сьогодні'));
      const acc = Math.round((l.r - (l.a || 0)) / l.r * 100);
      const ul = el('ul', 'done-list');
      [['Час', mins(Math.max(1, Math.round((l.ms || 0) / 60000)))], ['Нових слів', String(l.n || 0)], ['Повторено', String(l.rv || 0)], ['Точність', acc + '%']]
        .forEach(([a, b]) => { const li = el('li'); li.append(el('span', null, a), el('b', null, b)); ul.appendChild(li); });
      home.appendChild(ul);
      const tm = dueTomorrow();
      home.appendChild(el('p', 'tip', tm ? 'Завтра чекає ' + tm + ' ' + C.plural(tm, 'повторення', 'повторення', 'повторень') + '.' : 'Завтра повторень майже немає, можна взяти нові слова.'));
      const rep = el('button', 'link-btn', 'Скопіювати звіт');
      rep.type = 'button';
      rep.addEventListener('click', copyReport);
      home.appendChild(rep);
    } else {
      home.appendChild(el('h2', 'hero', 'Сьогодні вільно'));
      home.appendChild(el('p', 'hero-sub', left ? 'Повторень немає, а ліміт нових на сьогодні вичерпано.' : 'Нових слів не залишилось. Додай свої у Словнику або увімкни інші теми в Налаштуваннях.'));
    }
    const consolidate = () => startSession(fresh, false, null, 'fresh');
    const practice = () => startSession(misses, false, null, 'misses');
    if (l.r && fresh.length && evening) main = dock('Закріпити сьогоднішні нові', words(fresh.length) + ', перед сном найкраще', consolidate);
    else if (misses.length) main = dock('Потренувати помилки', words(misses.length), practice);
    if (l.r && fresh.length && !evening) tiles.push(quick('moonplus', 'Закріпити нові', words(fresh.length) + ', краще ввечері', consolidate));
    if (misses.length && !(main && main.btn.textContent.startsWith('Потренувати'))) tiles.push(quick('target', 'Потренувати помилки', words(misses.length), practice));
    if (left) tiles.push(quick('plus', 'Ще 5 нових слів', 'понад денний ліміт', () => { todayLog().x = (todayLog().x || 0) + 5; persist(); startSession(); }));
    const gd = gramDue(), gn = gramNext();
    if (gd.length) tiles.push(quick('pen', 'Граматика: повторити', GR.topics[gd[0]].title + (gd.length > 1 ? ' і ще ' + (gd.length - 1) : ''), () => openTopic(gd[0])));
    else if (gn && GR.topics[gn]) tiles.push(quick('pen', 'Граматика', 'наступна тема: ' + GR.topics[gn].title, () => openTopic(gn)));
  }
  const ls = canListen() ? listenIds().length : 0;
  if (ls >= 3) tiles.push(quick('listen', 'Слухати', 'у дорогу: ' + words(ls) + ' голосом, без рук', () => startListen()));
  if (sp >= 8) tiles.push(quick('timer', 'Спринт', meta.sprintBest ? 'хвилина, рекорд ' + meta.sprintBest : 'хвилина на швидкість', startSprint));
  if (tiles.length) {
    const grid = el('div', 'qa-list');
    tiles.forEach(x => grid.appendChild(x));
    home.appendChild(grid);
  }
  const news = newsCard();
  if (news) home.appendChild(news);
  const setup = setupSection();
  if (setup) home.appendChild(setup);
  home.appendChild(weekSection());
  home.appendChild(vocabSection());
  if (main) {
    home.appendChild(main.box);
    home.classList.add('has-dock');
    keys.enter = () => main.btn.click();
  }
}

/* ---------- Налаштувати один раз ---------- */
const IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function setupItems() {
  const items = [];
  if (IOS && !standalone) items.push({
    id: 'home', icon: 'share', title: 'Додай на екран «Додому»', sub: 'відкриватиметься як програма, на весь екран',
    body: () => {
      const b = el('div', 'setup-body');
      b.appendChild(el('p', null, 'У Safari натисни «Поділитися» (квадрат зі стрілкою; в iOS 26 він у меню «•••»), прокрути й вибери «На початковий екран» (Add to Home Screen), потім «Додати».'));
      b.appendChild(el('p', 'muted', 'Значок Words з\'явиться поруч з іншими програмами. Прогрес у Safari і в програмі окремий, тож краще одразу вчити з програми, а копію перенести через Налаштування → Резервна копія.'));
      return b;
    }
  });
  if (!meta.reminder) items.push({ id: 'remind', icon: 'calendar', title: 'Обери час для слів', sub: 'щоденне нагадування в Календарі', body: () => reminderPanel(() => renderLearn()) });
  if (!meta.triaged && meta.seenBase && Object.keys(cards).length < 80 && C.orderNew(allWords(), cards, settings.cats).length > 20) {
    items.push({ id: 'triage', icon: 'sieve', title: 'Відсій знайомі слова', sub: 'щоб не витрачати час на те, що вже знаєш', action: startTriage });
  }
  return items;
}
/* Разове повідомлення про новий базовий словник: одразу запропонувати відсіяти знайоме */
function newsCard() {
  if (meta.seenBase || !allWords().some(w => w.cat === 'spoken')) return null;
  const box = el('section', 'news');
  box.appendChild(el('h3', 'section-title', 'Новий базовий словник'));
  const n = allWords().filter(w => /^(spoken|base1|base2|base3)$/.test(w.cat)).length;
  const k = allWords().filter(w => w.cat === 'idioms').length;
  box.appendChild(el('p', null, 'Додала ' + words(n) + ' з найуживанішої англійської' + (k ? ' і ' + k + ' стійких виразів' : '') + '. Багато простих слів ти вже знаєш: відсій їх, щоб не витрачати на них час.'));
  const row = el('div', 'btn-row');
  const go = button('Відсіяти знайомі', 'btn-primary', () => { meta.seenBase = today(); save(KEYS.meta, meta); startTriage(); });
  const ok = button('Зрозуміло', 'btn-quiet', () => { meta.seenBase = today(); save(KEYS.meta, meta); renderLearn(); });
  row.append(ok, go);
  box.appendChild(row);
  return box;
}
function setupSection() {
  if (meta.setupHidden) return null;
  const items = setupItems();
  if (!items.length) return null;
  const sec = el('section', 'section');
  const title = el('h3', 'section-title', 'Налаштуй один раз');
  const hide = el('button', 'link-btn small', 'сховати');
  hide.type = 'button';
  hide.addEventListener('click', () => { meta.setupHidden = true; save(KEYS.meta, meta); renderLearn(); toast('Це все є в Налаштуваннях'); });
  title.appendChild(hide);
  sec.appendChild(title);
  const list = el('div', 'setup');
  items.forEach(it => {
    const row = el('div', 'setup-item');
    const head = el('button', 'setup-head');
    head.type = 'button';
    const ic = el('span', 'qa-ic'); ic.innerHTML = ICON[it.icon];
    const txt = el('span', 'qa-text'); txt.append(el('b', null, it.title), el('small', null, it.sub));
    const chev = el('span', 'chev'); chev.innerHTML = ICON.chevron;
    head.append(ic, txt, chev);
    row.appendChild(head);
    let body = null;
    head.setAttribute('aria-expanded', 'false');
    head.addEventListener('click', () => {
      if (it.action) { it.action(); return; }
      if (body) { body.remove(); body = null; head.setAttribute('aria-expanded', 'false'); return; }
      body = it.body();
      row.appendChild(body);
      head.setAttribute('aria-expanded', 'true');
    });
    list.appendChild(row);
  });
  sec.appendChild(list);
  return sec;
}

/* ---------- Нагадування: подія в Календарі (план «коли і де», а не «колись») ---------- */
const ANCHORS = [
  ['зранку з кавою', '07:30'], ['на перерві', '12:30'], ['дорогою з роботи', '17:30'], ['після вечері', '19:30'], ['перед сном', '22:00']
];
function reminderPanel(onDone) {
  const box = el('div', 'setup-body remind');
  box.appendChild(el('p', null, 'Коли саме вчитимеш? Прив\'язка до звичної справи спрацьовує краще, ніж «колись увечері».'));
  const cur = meta.reminder || {};
  let anchor = cur.a || ANCHORS[3][0];
  const chips = el('div', 'chips wrap');
  const time = el('input', 'field time');
  time.type = 'time';
  time.value = cur.t || (ANCHORS.find(a => a[0] === anchor) || ANCHORS[3])[1];
  time.setAttribute('aria-label', 'Час нагадування');
  const drawChips = () => {
    chips.innerHTML = '';
    ANCHORS.forEach(([a, tm]) => {
      const c = el('button', 'chip', a);
      c.type = 'button';
      c.setAttribute('aria-pressed', String(a === anchor));
      c.addEventListener('click', () => { anchor = a; time.value = tm; drawChips(); });
      chips.appendChild(c);
    });
  };
  drawChips();
  const row = el('div', 'remind-row');
  const lbl = el('label', 'lbl', 'О котрій');
  row.append(lbl, time);
  const add = el('a', 'btn btn-primary', 'Додати в Календар');
  add.target = '_blank';
  add.rel = 'noopener';
  const sync = () => {
    const tm = /^\d{2}:\d{2}$/.test(time.value) ? time.value : '19:30';
    const now = new Date();
    const [hh, mm] = tm.split(':').map(Number);
    const start = (now.getHours() * 60 + now.getMinutes() < hh * 60 + mm) ? today() : today() + 1;
    add.href = '/reminder.ics?t=' + tm + '&d=' + C.dayKey(start).replace(/-/g, '') + '&a=' + encodeURIComponent(anchor);
  };
  time.addEventListener('input', sync);
  time.addEventListener('change', sync);
  chips.addEventListener('click', sync);
  sync();
  add.addEventListener('click', () => {
    sync();
    meta.reminder = { t: time.value, a: anchor };
    save(KEYS.meta, meta);
    toast('Відкриваю Календар: натисни «Додати»');
    if (onDone) setTimeout(onDone, 800);
  });
  box.append(chips, row, add);
  box.appendChild(el('p', 'muted', 'Календар покаже подію щодня в цей час. Змінити чи видалити її можна в самому Календарі.'));
  return box;
}

/* kind для тренування: misses (помилки), fresh (сьогоднішні нові), dict (слова зі словника) */
function startSession(practiceIds, reviewOnly, limit, kind) {
  stopAudio();
  cancelAuto();
  session = new C.Session(envFor(practiceIds, reviewOnly, limit));
  practiceDone = 0;
  itemHistory = [];
  const l = todayLog();
  sess = { r: l.r || 0, a: l.a || 0, n: l.n || 0, k: l.k || 0, ms: l.ms || 0, miss: (l.miss || []).slice(), practice: !!practiceIds, kind: kind || (practiceIds ? 'misses' : null) };
  mode = 'session';
  nextItem();
}
/* «Хоч 2 хвилини»: дюжина вправ, спершу найслабші повторення */
function startShort() {
  const plan = new C.Session(envFor());
  startSession(null, plan.counts().reviews > 0, 12);
}
function endSession(manual) {
  cancelAuto();
  stopAudio();
  const wasPractice = !!(session && session.practice);
  const fromDict = !!(sess && sess.kind === 'dict');
  session = null; current = null; ui = null;
  document.body.classList.remove('typing');
  const l = todayLog();
  const did = sess ? (l.r || 0) - sess.r + (l.n || 0) - sess.n + (l.k || 0) - sess.k : 0;
  if (did > 0) { showSummary(manual, wasPractice); return; }
  mode = null; sess = null;
  if (fromDict) showTab('dict'); else renderLearn();
}
function nextItem() {
  cancelAuto();
  stopAudio();
  if (!session) return;
  current = session.next();
  if (!current) { endSession(false); return; }
  show(current);
}
/* Повернути попередню вправу (якщо помилково натиснув не те) */
function doUndo() {
  if (mode !== 'session' || !session || !session.canUndo()) return;
  cancelAuto();
  stopAudio();
  const id = session.undo();
  const h = itemHistory.pop() || { exercise: 'flip', source: 'review' };
  if (h.done) practiceDone = Math.max(0, practiceDone - 1);
  persist();
  renderStreak();
  current = { id, word: byId(id), card: cards[id], exercise: h.exercise, source: h.source };
  show(current);
  toast('Повернула попередню вправу');
}
function pushHistory(h) { itemHistory.push(h); if (itemHistory.length > 20) itemHistory.shift(); }
function toggleQuiet() {
  settings.quiet = !settings.quiet;
  saveSettings();
  if (settings.quiet) stopAudio();
  updateSessionBar();
  toast(settings.quiet ? 'Тихий режим: без автоозвучки й вправ на слух' : 'Звук увімкнено');
  if (mode === 'session' && session && current && ui && !ui.answered && !ui.revealed && ui.guessed == null && C.SOUND_EXERCISES.includes(current.exercise)) {
    current = session.make(current.id, current.source);
    show(current);
  }
}

/* Підсумок заняття */
function showSummary(manual, practice) {
  mode = 'summary';
  const s0 = sess || { r: 0, a: 0, n: 0, ms: 0, miss: [] };
  const kind = s0.kind;
  sess = null;
  const l = todayLog();
  const r = (l.r || 0) - s0.r, a = (l.a || 0) - s0.a, n = (l.n || 0) - s0.n;
  const ms = (l.ms || 0) - s0.ms;
  const missIds = (l.miss || []).filter(id => !s0.miss.includes(id) && byId(id));
  const plan = new C.Session(envFor());
  const cnt = plan.counts();
  const leftTotal = cnt.reviews + cnt.learning + cnt.fresh;
  const info = streakInfo();
  $('stage').hidden = false;
  $('learnHome').hidden = true;
  const card = $('card');
  card.innerHTML = '';
  card.onclick = null;
  const head = el('div', 'ex-head');
  const label = el('span', 'ex-label');
  const ic = el('span', 'ex-ic done'); ic.innerHTML = ICON.check;
  label.append(ic, document.createTextNode(practice ? 'Тренування завершено' : 'Заняття завершено'));
  head.appendChild(label);
  if (info.days) { const sk = el('span', 'ex-right streak-chip'); sk.innerHTML = ICON.flame; sk.appendChild(el('span', null, days(info.days))); head.appendChild(sk); }
  card.appendChild(head);
  const body = el('div', 'prompt summary');
  const titleText = practice ? (kind === 'misses' ? 'Помилки розібрано' : kind === 'fresh' ? 'Нові слова закріплено' : 'Готово')
    : !leftTotal ? 'Усе на сьогодні!' : manual ? 'Добра перерва' : 'Готово';
  body.appendChild(el('h2', 'word', titleText));
  const stats = el('div', 'stats');
  const stat = (v, k) => { const d = el('div', 'stat'); d.append(el('b', null, v), el('span', null, k)); stats.appendChild(d); };
  stat(String(r + n), C.plural(r + n, 'вправа', 'вправи', 'вправ'));
  stat(r ? Math.round((r - a) / r * 100) + '%' : '—', 'точність');
  stat(mins(Math.max(1, Math.round(ms / 60000))), 'час');
  body.appendChild(stats);
  if (n) body.appendChild(el('p', 'prompt-sub', 'Нових слів: ' + n + '.'));
  if (!practice && leftTotal) body.appendChild(el('p', 'prompt-sub', 'Ще залишилось: ' + lowerFirst(planSentence(cnt)) + ', ≈ ' + mins(estimateMinutes(plan.remainingUnits())) + '. Прогрес збережено.'));
  else if (!practice) { const tm = dueTomorrow(); body.appendChild(el('p', 'prompt-sub', tm ? 'Завтра: ' + tm + ' ' + C.plural(tm, 'повторення', 'повторення', 'повторень') + '.' : 'Завтра повторень майже немає.')); }
  card.appendChild(body);
  if (missIds.length) {
    const d = el('div', 'details');
    d.appendChild(el('p', 'tip', 'Помилки цього заняття:'));
    missIds.forEach(id => {
      const w = byId(id);
      const p = el('p', 'ex');
      p.append(enSpan(w.en), document.createTextNode(' — ' + w.uk), sayBtn(w, 'w', true));
      d.appendChild(p);
    });
    card.appendChild(d);
  }
  const home = () => { mode = null; if (kind === 'dict') showTab('dict'); else renderLearn(); window.scrollTo(0, 0); };
  const btns = [];
  if (!practice && leftTotal) {
    btns.push(button('На головну', 'btn-quiet', home));
    btns.push(button('Продовжити', 'btn-primary', () => startSession()));
  } else {
    if (missIds.length && !practice) btns.push(button('Потренувати помилки', '', () => startSession(missIds, false, null, 'misses')));
    btns.push(button('Готово', 'btn-primary', home));
  }
  setFoot(btns, btns.length === 2 ? 2 : 0);
  keys = { enter: () => btns[btns.length - 1].click() };
  updateTape();
  renderStreak();
  window.scrollTo(0, 0);
}

/* ---------- Відсіяти знайомі слова наперед ---------- */
let triage = null;
function triageList() { return C.orderNew(allWords(), cards, settings.cats, settings.newPerDay, today(), meta.priority).filter(w => w.cat !== 'mine').slice(0, 20); }
function startTriage() {
  const list = triageList();
  if (!list.length) { toast('Нових слів не залишилось'); return; }
  stopAudio();
  session = null; current = null; ui = null;
  triage = { list, known: new Set(), total: 0 };
  mode = 'triage';
  if (currentTab !== 'learn') showTab('learn');
  renderTriage();
}
function renderTriage() {
  $('stage').hidden = false;
  $('learnHome').hidden = true;
  const card = $('card');
  card.innerHTML = '';
  card.onclick = null;
  const head = el('div', 'ex-head');
  const label = el('span', 'ex-label');
  const ic = el('span', 'ex-ic'); ic.innerHTML = ICON.sieve;
  label.append(ic, document.createTextNode('Відсіяти знайомі'));
  const count = el('span', 'ex-right');
  head.append(label, count);
  card.appendChild(head);
  card.appendChild(el('p', 'prompt-sub', 'Торкнись слів, які вже знаєш напевно. Вони не займатимуть місце серед нових, лише одна перевірка через кілька тижнів.'));
  // Простих слів буває більшість: зручніше позначити всі й зняти кілька незнайомих
  const allBtn = el('button', 'link-btn small tri-all');
  allBtn.type = 'button';
  card.appendChild(allBtn);
  const ul = el('div', 'triage');
  const done = button('Готово', 'btn-quiet', () => finishTriage(false));
  const more = button('Ще 20', 'btn-primary', () => finishTriage(true));
  const rows = [];
  const redrawCount = () => {
    const n = triage.total + triage.known.size;
    count.textContent = n ? 'знаю ' + words(n) : words(triage.list.length) + ' наступні';
    allBtn.textContent = triage.known.size === triage.list.length ? 'Зняти всі позначки' : 'Знаю всі на цій сторінці';
  };
  allBtn.addEventListener('click', () => {
    const on = triage.known.size !== triage.list.length;
    triage.list.forEach(w => { if (on) triage.known.add(w.id); else triage.known.delete(w.id); });
    rows.forEach(b => b.setAttribute('aria-pressed', String(on)));
    haptic('ok');
    redrawCount();
  });
  triage.list.forEach(w => {
    const b = el('button', 'tri');
    b.type = 'button';
    b.setAttribute('aria-pressed', 'false');
    const box = el('span', 'tri-box'); box.innerHTML = ICON.check;
    const txt = el('span', 'tri-text');
    const en = el('b', null, w.en); en.lang = 'en';
    txt.append(en, el('span', null, w.uk));
    b.append(box, txt);
    b.addEventListener('click', () => {
      const on = !triage.known.has(w.id);
      if (on) triage.known.add(w.id); else triage.known.delete(w.id);
      b.setAttribute('aria-pressed', String(on));
      haptic('ok');
      redrawCount();
    });
    rows.push(b);
    ul.appendChild(b);
  });
  card.appendChild(ul);
  redrawCount();
  setFoot([done, more], 2);
  keys = { enter: () => more.click() };
  updateTape();
  window.scrollTo(0, 0);
}
function finishTriage(next) {
  if (!triage) return;
  triage.known.forEach(id => { if (!cards[id]) cards[id] = C.knownCard(today(), settings.retention, Math.random); });
  triage.total += triage.known.size;
  const n = triage.total;
  meta.triaged = today();
  save(KEYS.meta, meta);
  persist();
  if (next) {
    // Наступні 20: невідмічені з цієї порції підуть у навчання, їх не показуємо вдруге
    const shown = new Set(triage.shown || []);
    triage.list.forEach(w => shown.add(w.id));
    const list = C.orderNew(allWords(), cards, settings.cats, settings.newPerDay, today(), meta.priority)
      .filter(w => w.cat !== 'mine' && !shown.has(w.id)).slice(0, 20);
    if (list.length) {
      triage = { list, known: new Set(), total: n, shown: Array.from(shown) };
      renderTriage();
      return;
    }
  }
  triage = null;
  mode = null;
  renderLearn();
  toast(n ? 'Позначено ' + words(n) + ' як відомі' : 'Добре, усі ці слова вивчиш');
}

/* Каркас вправи */
function frame(item) {
  if (!mode) mode = 'session';
  closePeek();
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
/* Нижня панель: кнопки і, після відповіді, висновок (завжди видно, хоч би яка довга картка) */
function setFoot(buttons, cols, fb) {
  const foot = $('foot');
  foot.innerHTML = '';
  foot.className = 'foot' + (fb ? ' sheet ' + (fb.dataset.kind || 'info') : '');
  const inner = el('div', 'foot-in');
  if (fb) inner.appendChild(fb);
  const row = el('div', 'foot-btns' + (cols ? ' cols' + cols : ''));
  buttons.forEach(b => row.appendChild(b));
  if (buttons.length) inner.appendChild(row);
  foot.appendChild(inner);
  foot.hidden = !buttons.length && !fb;
  measureFoot();
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
/* Слово і динамік поруч: видно, що слухати саме його, і менше місця по висоті */
function wordWithSay(w) {
  const row = el('div', 'word-row');
  row.append(bigWord(w.en, 'en'), sayBtn(w, 'w'));
  return row;
}
function fitWord(node) {
  const card = $('card');
  const inRow = node.parentElement && node.parentElement.classList.contains('word-row');
  const avail = (card.clientWidth || 340) - 40 - (inRow ? 58 : 0);
  const text = node.textContent;
  const longest = text.split(/\s+/).reduce((m, s) => Math.max(m, s.length), 1);
  const factor = node.classList.contains('uk') ? 0.62 : 0.64;
  let size = Math.floor(avail / (longest * factor));
  size = Math.max(22, Math.min(text.length > 16 ? 29 : 44, size));
  node.style.fontSize = size + 'px';
}
function enSpan(text) { const s = el('span', null, text); s.lang = 'en'; return s; }
/* Англійський текст, де кожне слово можна торкнути й побачити переклад */
function enText(text) {
  const s = el('span'); s.lang = 'en';
  String(text || '').split(/([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’]*)/).forEach((part, i) => {
    if (!part) return;
    s.appendChild(i % 2 ? el('span', 'tw', part) : document.createTextNode(part));
  });
  return s;
}

/* ---------- Переклад слова з прикладу: бульбашка біля слова ---------- */
let peekEl = null;
function peekFind(t, sentence) { if (!peekIdx) peekIdx = C.lookupIndex(allWords(), window.GLOSSARY); return peekIdx(t, sentence); }
function closePeek() {
  if (!peekEl) return;
  peekEl.remove(); peekEl = null;
  document.querySelectorAll('.tw.on').forEach(x => x.classList.remove('on'));
  document.documentElement.classList.remove('peek-open');
}
function openPeek(span) {
  closePeek();
  if (listen && !listen.paused) lPause();
  const token = span.textContent;
  const host = span.closest('[data-sent]');
  const sentence = host ? host.dataset.sent : span.parentNode ? span.parentNode.textContent : '';
  const r = peekFind(token, sentence);
  const box = el('div', 'peek');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'Переклад слова ' + token);
  const entry = w => {
    const row = el('div', 'peek-row');
    const txt = el('div', 'peek-text');
    const en = el('b', null, w.en); en.lang = 'en';
    txt.append(en, el('span', 'peek-uk', w.uk));
    const say = el('button', 'say sm');
    say.type = 'button';
    say.innerHTML = ICON.speaker;
    say.setAttribute('aria-label', 'Послухати ' + w.en);
    say.addEventListener('click', () => (w.gloss ? speakDevice(w.en) : sayWord(w, 'w')));
    row.append(txt, say);
    box.appendChild(row);
    if (w.gloss) return;
    const c = cards[w.id];
    if (c) { box.appendChild(el('p', 'peek-st', C.statusOf(c) === 'known' ? 'Знаєш це слово' : 'Вчиш це слово')); return; }
    if (current && current.id === w.id) return;
    const isPri = (meta.priority || []).includes(w.id);
    const b = el('button', 'link-btn small', isPri ? 'Буде серед найближчих нових' : 'Вчити першим');
    b.type = 'button';
    b.disabled = isPri;
    b.addEventListener('click', () => {
      meta.priority = (meta.priority || []).filter(x => x !== w.id && !cards[x]).concat([w.id]);
      save(KEYS.meta, meta);
      b.textContent = 'Буде серед найближчих нових'; b.disabled = true;
      if (!mode) resetSession();
    });
    box.appendChild(b);
  };
  if (r) {
    // Вираз з цього речення (day off, pick up) важливіший за окреме слово
    r.phrases.forEach(entry);
    const singles = r.words.slice(0, r.phrases.length ? 1 : 3);
    if (singles.length && !r.exact && !singles[0].gloss) {
      const f = el('p', 'peek-form'); f.append(enSpan(token), document.createTextNode(' — форма слова ' + r.base)); box.appendChild(f);
    }
    singles.forEach(entry);
  } else {
    box.appendChild(el('p', 'peek-none', 'Слова «' + token + '» немає в словнику.'));
    if (!mode && /^[a-z'’-]{2,}$/i.test(token)) {
      const add = el('button', 'link-btn small', 'Додати своє слово');
      add.type = 'button';
      add.addEventListener('click', () => {
        closePeek();
        showTab('dict');
        $('addPanel').hidden = false;
        $('fEn').value = token.toLowerCase();
        $('fUk').focus();
      });
      box.appendChild(add);
    }
  }
  document.body.appendChild(box);
  span.classList.add('on');
  peekEl = box;
  document.documentElement.classList.add('peek-open');
  // Під словом, а якщо не вміщається над нижньою панеллю, то над ним
  const rect = span.getBoundingClientRect();
  const vw = document.documentElement.clientWidth, vh = window.innerHeight;
  const bw = box.offsetWidth, bh = box.offsetHeight;
  const footH = document.body.classList.contains('in-session') ? ($('foot').offsetHeight || 0) : 70;
  const left = Math.max(12, Math.min(vw - bw - 12, rect.left + rect.width / 2 - bw / 2));
  let top = rect.bottom + 8;
  if (top + bh > vh - footH - 8) top = Math.max(8, rect.top - bh - 8);
  box.style.left = left + 'px';
  box.style.top = top + 'px';
  if (!meta.peekUsed) { meta.peekUsed = today(); save(KEYS.meta, meta); }
}
document.addEventListener('click', e => {
  const t = e.target.closest && e.target.closest('.tw');
  if (t) { e.preventDefault(); e.stopPropagation(); if (t.classList.contains('on')) closePeek(); else openPeek(t); return; }
  // Дотик поза бульбашкою лише закриває її, щоб випадково не натиснути «Далі» під нею
  if (peekEl && !(e.target.closest && e.target.closest('.peek'))) { e.preventDefault(); e.stopPropagation(); closePeek(); }
}, true);
window.addEventListener('scroll', () => { if (peekEl) closePeek(); }, { passive: true });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && peekEl) { closePeek(); e.stopPropagation(); } }, true);

/* Нотатки: власна асоціація */
function mnemonicBlock(w, openByDefault) {
  const box = el('div', 'mnemo');
  const existing = notes[w.id];
  const editor = () => {
    box.innerHTML = '';
    const ta = el('textarea');
    ta.placeholder = 'Наприклад: cheap звучить як «чіпси», а чіпси дешеві';
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

/* Блок з відповіддю в картці: слово, переклад, приклад, фрази, асоціація */
function details(w, opts) {
  opts = opts || {};
  const d = el('div', 'details');
  if (opts.en !== false) {
    const t = el('p', 'trans en');
    t.append(enSpan(w.en), sayBtn(w, 'w', true));
    d.appendChild(t);
  }
  if (opts.uk !== false) d.appendChild(el('p', 'trans', w.uk));
  if (w.ex && opts.ex !== false) {
    const ex = el('p', 'ex');
    ex.append(enText(w.ex), sayBtn(w, 'x', true));
    d.appendChild(ex);
    if (w.exUk) d.appendChild(el('p', 'ex-uk', w.exUk));
  }
  if (w.note) { const n = el('p', 'note'); n.textContent = w.note; d.appendChild(n); }
  if (opts.tip) d.appendChild(el('p', 'tip', opts.tip));
  const pb = phraseBlock(w, false);
  if (pb) d.appendChild(pb);
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
/* Висновок для нижньої панелі. answer: правильна відповідь (рядок або вузол), extra: вузол під нею */
function verdict(kind, text, sub, answer, extra) {
  const v = el('div', 'verdict ' + kind);
  v.dataset.kind = kind;
  v.setAttribute('role', 'status');
  const ic = el('span', 'vi');
  ic.innerHTML = kind === 'right' ? ICON.check : kind === 'typo' ? ICON.bang : kind === 'info' ? ICON.speaker : ICON.cross;
  const body = el('span', 'vbody');
  const t = el('span', 'vt', text);
  if (sub) t.appendChild(el('small', null, sub));
  body.appendChild(t);
  if (answer) {
    const a = el('span', 'va');
    if (typeof answer === 'string') a.textContent = answer; else a.appendChild(answer);
    body.appendChild(a);
  }
  if (extra) body.appendChild(extra);
  const info = nextInfo();
  if (info) body.appendChild(el('span', 'next-info', info));
  v.append(ic, body);
  return v;
}
/* «слово — переклад» для висновку */
function pair(w) {
  const f = document.createDocumentFragment();
  f.append(enSpan(w.en), document.createTextNode(' — ' + w.uk));
  return f;
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
  const counted = !!(session.practice && res.done);
  if (counted) practiceDone++;
  pushHistory({ id: current.id, exercise: current.exercise, source: current.source, done: counted });
  haptic(g === 1 ? 'wrong' : 'ok');
  persist();
  renderStreak();
  updateTape();
  return res;
}
function regrade(g) {
  if (!ui || !ui.answered || !session.undo()) return;
  const h = itemHistory.pop();
  if (h && h.done) practiceDone = Math.max(0, practiceDone - 1);
  ui.answered = false;
  ui.timed = true;
  finish(g);
}
/* «Далі». Після правильної відповіді сам переходить далі, якщо не торкатися екрана */
function nextButton(fb, autoOk) {
  const b = button('Далі', 'btn-primary', nextItem);
  setFoot([b], 0, fb);
  keys = { enter: () => b.click() };
  if (autoOk) startAuto(b);
  return b;
}
let auto = null;
function cancelAuto() {
  if (!auto) return;
  clearTimeout(auto.timer);
  auto.btn.classList.remove('auto');
  auto = null;
}
function startAuto(btn) {
  cancelAuto();
  if (!settings.autoNext) return;
  const ms = 1700;
  btn.style.setProperty('--auto', ms + 'ms');
  btn.classList.add('auto');
  const t0 = performance.now();
  const tick = () => {
    if (!auto || auto.btn !== btn) return;
    // Дати Еммі договорити, але не чекати вічно
    if (audioBusy() && performance.now() - t0 < 4000) { auto.timer = setTimeout(tick, 150); return; }
    auto = null;
    btn.classList.remove('auto');
    nextItem();
  };
  auto = { btn, timer: setTimeout(tick, ms) };
}
['pointerdown', 'touchmove', 'wheel'].forEach(ev => document.addEventListener(ev, e => {
  if (auto && !(e.target && e.target.closest && e.target.closest('#foot'))) cancelAuto();
}, { passive: true }));
document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible') cancelAuto(); });

function show(item) {
  cancelAuto();
  ui = { t0: performance.now(), answered: false, hints: 0, tries: 0 };
  document.body.classList.remove('typing');
  if (item.exercise !== 'intro') item.word = C.withExample(byId(item.id), item.card);
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
  body.appendChild(wordWithSay(w));
  // Здогадку рахуємо після introduce, щоб «назад» повертав і її
  const countGuess = () => {
    if (ui.guessed !== true && ui.guessed !== false) return;
    const l = todayLog(); l.g = (l.g || 0) + 1; if (ui.guessed) l.gok = (l.gok || 0) + 1;
  };
  const decide = isKnown => {
    if (ui.answered) return;
    ui.answered = true;
    addTime();
    session.introduce(item.id, isKnown);
    countGuess();
    pushHistory({ id: item.id, exercise: 'intro', source: item.source || 'new' });
    persist();
    if (isKnown) { renderStreak(); toast('Повторю «' + w.en + '» приблизно через ' + days(cards[item.id].due - today())); }
    nextItem();
  };
  const learn = () => decide(false);
  const known = () => decide(true);
  const reveal = guessed => {
    const d = el('div', 'details');
    d.appendChild(el('p', 'trans', w.uk));
    [[w.ex, w.exUk, 'x'], [w.ex2, w.ex2Uk, 'x2']].forEach(([ex, exUk, kind]) => {
      if (!ex) return;
      const p = el('p', 'ex'); p.append(enText(ex), sayBtn(w, kind, true)); d.appendChild(p);
      if (exUk) d.appendChild(el('p', 'ex-uk', exUk));
    });
    if (w.note) { const n = el('p', 'note'); n.textContent = w.note; d.appendChild(n); }
    d.appendChild(el('p', 'tip', 'Скажи слово і приклад уголос: сказане тримається довше, ніж прочитане.'));
    if (!meta.peekUsed) d.appendChild(el('p', 'tip', 'Незнайоме слово в прикладі? Торкнись його, і з\'явиться переклад.'));
    const pb = phraseBlock(w, false);
    if (pb) d.appendChild(pb);
    d.appendChild(mnemonicBlock(w, false));
    $('card').appendChild(d);
    let v = null;
    if (guessed === true) v = verdict('right', 'Вгадав', ' тепер запам\'ятай');
    else if (guessed === false) v = verdict('info', 'Не вгадав, і це нормально', ' здогадка все одно допомагає запам\'ятати');
    setFoot([button('Вже знаю', 'btn-quiet', known), button('Вчити', 'btn-primary', learn)], 2, v);
    keys = { enter: learn };
  };
  if (settings.pretest !== false && !(session && session.practice)) {
    body.appendChild(el('p', 'prompt-sub', 'Як гадаєш, що це означає?'));
    const opts = C.shuffle([w].concat(C.distractors(w, allWords(), 'uk', 3, Math.random, false)));
    const box = el('div', 'options');
    const btns = [];
    opts.forEach((o, i) => {
      const b = el('button', 'opt-btn');
      b.type = 'button';
      b.append(el('span', 'k', String(i + 1)), el('span', null, o.uk));
      b.addEventListener('click', () => {
        if (ui.guessed != null) return;
        const ok = o.id === w.id;
        ui.guessed = ok;
        haptic('ok');
        btns.forEach((x, k) => {
          x.disabled = true;
          if (opts[k].id === w.id) { x.classList.add('right'); x.firstChild.innerHTML = ICON.check; }
          else if (x === b) { x.classList.add('wrong'); x.firstChild.innerHTML = ICON.cross; }
          else x.remove();
        });
        reveal(ok);
      });
      btns.push(b);
      box.appendChild(b);
    });
    $('card').appendChild(box);
    setFoot([button('Показати одразу', 'btn-quiet', () => { if (ui.guessed == null) { ui.guessed = 'skip'; box.remove(); reveal(null); } })]);
    keys = { num: n => btns[n - 1] && btns[n - 1].click() };
  } else {
    reveal(null);
  }
  if (settings.autoplay) autoSay(w, 'w');
};

/* Вибір з варіантів */
function mcq(item, prompt, field) {
  const w = item.word;
  const body = frame(item);
  if (prompt === 'en') {
    body.appendChild(wordWithSay(w));
    if (settings.autoplay) autoSay(w, 'w');
  } else if (prompt === 'uk') {
    body.appendChild(bigWord(w.uk, 'uk'));
  } else {
    listenPrompt(body, w);
  }
  const close = !!(item.card && item.card.st !== 'learn');
  const opts = C.shuffle([w].concat(C.distractors(w, allWords(), field, 3, Math.random, close)));
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
  // Чесне «не знаю» краще за вгадування навмання: вгадане слово розклад вважав би вивченим
  setFoot([button('Не знаю', 'btn-quiet', () => choose(null, null))]);
  keys = { num: n => btns[n - 1] && btns[n - 1].click() };
  function choose(o, b) {
    if (ui.answered) return;
    const ok = !!o && o.id === w.id;
    finish(ok ? 3 : 1);
    btns.forEach((x, i) => {
      x.disabled = true;
      if (opts[i].id === w.id) { x.classList.add('right'); x.firstChild.innerHTML = ICON.check; }
      else if (x === b) { x.classList.add('wrong'); x.firstChild.innerHTML = ICON.cross; }
      else x.classList.add('dim');
    });
    autoSay(w, 'w');
    $('card').appendChild(details(w, { en: prompt !== 'en', uk: prompt !== 'uk', wrong: !ok }));
    // Що означає вибраний хибний варіант: помилка теж чогось вчить
    let mine = null;
    if (o && !ok) {
      const other = field === 'uk' ? 'en' : 'uk';
      mine = el('span', 'yours');
      const a = el('span', null, o[field]); if (field === 'en') a.lang = 'en';
      const z = el('span', null, o[other]); if (other === 'en') z.lang = 'en';
      mine.append(a, document.createTextNode(' — це '), z);
    }
    nextButton(ok ? verdict('right', 'Правильно') : verdict('wrong', o ? 'Ні, правильно:' : 'Правильно:', null, pair(w), mine), ok);
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
    body.appendChild(wordWithSay(w));
    if (settings.autoplay) autoSay(w, 'w');
  }
  body.appendChild(el('p', 'prompt-sub', rev ? 'Згадай англійською, потім відкрий відповідь' : 'Згадай переклад, потім відкрий відповідь'));
  const reveal = () => {
    if (ui.revealed) return;
    ui.revealed = true;
    $('card').onclick = null;
    $('card').appendChild(details(w, { en: rev, uk: !rev }));
    if (rev) autoSay(w, 'w');
    const pv = C.previewIntervals(item.card, today(), settings.retention);
    const learning = !item.card || item.card.st !== 'review';
    const sub = g => learning ? (g === 1 ? 'ще раз' : g === 4 ? 'вже знаю' : 'далі') : shortDays(pv[g]);
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
    let g;
    if (res === 'exact') { g = ui.hints ? 2 : 3; input.classList.add('right'); }
    else if (res === 'typo') { g = 2; input.classList.add('typo'); }
    else { g = 1; input.classList.add('wrong'); }
    finish(g);
    if (ui.blank) { ui.blank.classList.add('filled'); }
    autoSay(w, kind === 'cloze' ? 'x' : 'w');
    // Що написав учень проти правильного: літери з помилкою підсвічені
    const right = String(check.target || display);
    let yours = null, close = false;
    if (value && res !== 'exact') {
      yours = el('span', 'yours-box');
      const line = (label, text, against, cls) => {
        const p = el('span', 'yours');
        p.appendChild(document.createTextNode(label));
        const span = el('span'); span.lang = 'en';
        C.diffMarks(text, against).forEach(m => span.appendChild(m.ok ? document.createTextNode(m.ch) : el('span', cls, m.ch)));
        p.appendChild(span);
        yours.appendChild(p);
      };
      close = res === 'typo' || (check.dist != null && check.dist <= Math.ceil(right.length * 0.4));
      if (close) {
        line('Ти написав: ', value, right, 'bad');
        line('Правильно: ', right, value, 'fix');
      } else {
        const p = el('span', 'yours');
        const sv = el('s', null, value); sv.lang = 'en';
        p.append(document.createTextNode('Ти написав: '), sv);
        yours.appendChild(p);
      }
    }
    let v;
    if (res === 'exact') v = verdict('right', 'Правильно', ui.hints ? ' з підказкою' : '');
    else if (res === 'typo') v = verdict('typo', 'Майже, перевір написання', null, null, yours);
    else if (close) v = verdict('wrong', 'Неправильно', null, null, yours);
    else v = verdict('wrong', value ? 'Ні, правильно:' : 'Правильна відповідь:', null, enSpan(display), yours);
    $('card').appendChild(details(w, { en: true, uk: kind === 'dictation', wrong: g === 1 }));
    const next = button('Далі', 'btn-primary', nextItem);
    const btns = [next];
    if (g === 1 && value) {
      const accept = button('Я мав рацію', 'btn-quiet', () => {
        regrade(ui.hints ? 2 : 3);
        input.classList.remove('wrong'); input.classList.add('right');
        setFoot([next], 0, verdict('right', 'Зараховано'));
        keys = { enter: () => next.click() };
      });
      btns.unshift(accept);
    }
    setFoot(btns, btns.length === 2 ? 2 : 0, v);
    keys = { enter: () => next.click() };
    if (res === 'exact' && !ui.hints) startAuto(next);
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
  const done = (g, kind, title, sub) => {
    finish(g);
    autoSay(w, sentence ? 'x' : 'w');
    $('card').appendChild(details(w, { en: true, uk: sentence, wrong: g === 1 }));
    nextButton(verdict(kind, title, sub, g === 1 ? enSpan(sentence ? w.ex : w.en) : null), g === 3);
  };
  const check = () => {
    if (ui.answered || !placed.length) return;
    const ok = placed.length === target.length && placed.every((p, i) => p.t.toLowerCase() === lowerTarget[i]);
    if (ok) {
      placed.forEach(p => { p.state = 'good'; });
      redraw();
      done(ui.tries ? 2 : 3, 'right', 'Правильно', ui.tries ? ' з другої спроби' : '');
      return;
    }
    ui.tries++;
    placed.forEach((p, i) => { p.state = p.t.toLowerCase() === lowerTarget[i] ? 'good' : 'bad'; });
    redraw();
    if (ui.tries >= 2) {
      done(1, 'wrong', 'Правильний порядок:');
    } else { haptic('wrong'); toast('Майже. Прибери червоні слова й спробуй ще раз'); }
  };
  const checkBtn = button('Перевірити', 'btn-primary', check);
  checkBtn.disabled = true;
  setFoot([button('Не знаю', 'btn-quiet', () => { if (!ui.answered) done(1, 'wrong', 'Правильно так:'); }), checkBtn], 2);
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
    const v = heard ? verdict('info', 'Почула: «' + heard + '»', ' порівняй з правильним', pair(w)) : verdict('info', 'Порівняй зі своєю відповіддю', null, pair(w));
    $('card').appendChild(details(w, { uk: false }));
    const grade = g => { finish(g); nextItem(); };
    const bs = [
      button('Не згадав', 'btn-again', () => grade(1)),
      button('З помилкою', '', () => grade(2)),
      button('Правильно', 'btn-primary', () => grade(3))
    ];
    setFoot(bs, 3, v);
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
          $('card').appendChild(details(w, { uk: false }));
          nextButton(verdict('right', 'Правильно, вимова зрозуміла'), true);
        } else selfGrade(alts[0] || '');
      };
      rec.onerror = ev => {
        if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed' || ev.error === 'audio-capture') { recBroken = true; toast('Мікрофон недоступний, перевір себе сам'); }
        if (!ui.answered) selfGrade('');
      };
      rec.onend = () => { mic.classList.remove('on'); label.textContent = 'Натисни й говори'; rec = null; };
      try { rec.start(); } catch (e) { recBroken = true; selfGrade(''); }
    });
    setFoot([button('Не знаю', 'btn-quiet', () => { if (!ui.answered && !ui.revealed) { finish(1); sayWord(w, 'w'); $('card').appendChild(details(w, { uk: false, wrong: true })); nextButton(verdict('wrong', 'Правильно:', null, pair(w))); } }), button('Показати відповідь', '', () => selfGrade(''))], 2);
  } else {
    body.appendChild(el('p', 'tip', 'Скажи повністю вголос, потім відкрий відповідь і чесно оціни себе.'));
    const rb = button('Показати відповідь', 'btn-primary', () => selfGrade(''));
    setFoot([rb]);
    keys = { enter: () => rb.click() };
  }
};

/* Своє речення: продуктивне вживання слова */
RENDER.own_sentence = item => {
  const w = item.word;
  const body = frame(item);
  const h = el('h2', 'word', w.en); h.lang = 'en'; h.style.fontSize = '30px';
  body.appendChild(h);
  body.appendChild(el('p', 'trans', w.uk));
  body.appendChild(el('p', 'prompt-sub', 'Склади своє речення з цим словом, про своє життя або роботу'));
  const ta = el('textarea', 'answer');
  ta.rows = 2;
  ta.lang = 'en';
  ta.placeholder = 'Напиши англійською…';
  ta.setAttribute('autocapitalize', 'sentences');
  ta.setAttribute('autocorrect', 'off');
  ta.setAttribute('aria-label', 'Своє речення');
  ta.style.resize = 'none';
  $('card').appendChild(ta);
  ta.addEventListener('focus', () => document.body.classList.add('typing'));
  ta.addEventListener('blur', () => setTimeout(() => document.body.classList.remove('typing'), 50));
  const stem = w.en.replace(/^to /i, '').replace(/^(the|a|an) /i, '').replace(/[.!?]+$/, '').toLowerCase();
  const forms = C.tokens(stem).map(t => C.wordForms(t.toLowerCase()));
  const containsWord = text => {
    const toks = C.tokens(text).map(t => t.toLowerCase());
    return forms.every(fs => toks.some(t => fs.includes(t)));
  };
  const check = () => {
    if (ui.answered) return;
    const text = ta.value.trim();
    if (!text) { toast('Напиши речення або натисни «Пропустити»'); return; }
    if (C.tokens(text).length < 3) { toast('Хоча б три слова'); return; }
    if (!containsWord(text)) { toast('У реченні має бути слово «' + stem + '»'); return; }
    ta.disabled = true; ta.blur();
    const list = own[w.id] || [];
    if (!list.includes(text)) { list.unshift(text); own[w.id] = list.slice(0, 3); save(KEYS.own, own); }
    finish(3);
    ta.classList.add('right');
    autoSay(w, 'x');
    $('card').appendChild(details(w, { uk: false }));
    const next = button('Далі', 'btn-primary', nextItem);
    const unsure = button('Я не впевнений', 'btn-quiet', () => { regrade(2); setFoot([next], 0, verdict('info', 'Добре, повторимо раніше')); keys = { enter: () => next.click() }; });
    setFoot([unsure, next], 2, verdict('right', 'Записала твоє речення', ' перевір себе за прикладами в картці'));
    keys = { enter: () => next.click() };
  };
  setFoot([button('Пропустити', 'btn-quiet', () => { if (!ui.answered) { finish(2); autoSay(w, 'x'); $('card').appendChild(details(w, { uk: false })); nextButton(verdict('info', 'Ось як його вживають')); } }), button('Готово', 'btn-primary', check)], 2);
  keys = {};
  try { ta.focus({ preventScroll: true }); } catch (e) {}
};

/* ---------- Спринт: хвилина на швидкість ---------- */
const SPRINT_SECONDS = 60;
let sprint = null;
function startSprint() {
  const pool = C.shuffle(C.sprintPool(allWords(), cards).slice());
  if (pool.length < 8) return;
  stopAudio();
  session = null; current = null; ui = null;
  sprint = { pool, i: 0, ok: 0, wrong: [], left: SPRINT_SECONDS, timer: null, t0: performance.now() };
  mode = 'sprint';
  if (currentTab !== 'learn') showTab('learn');
  $('stage').hidden = false;
  $('learnHome').hidden = true;
  sprint.timer = setInterval(() => {
    if (!sprint) return;
    sprint.left = Math.max(0, SPRINT_SECONDS - Math.floor((performance.now() - sprint.t0) / 1000));
    sprintTape();
    if (sprint.left <= 0) endSprint();
  }, 250);
  sprintTape();
  sprintNext();
}
function sprintTape() {
  if (!sprint) return;
  renderTape(SPRINT_SECONDS - sprint.left, SPRINT_SECONDS, 'Секунди');
  $('tapeLeft').textContent = 'правильно ' + sprint.ok;
}
function sprintNext() {
  if (!sprint) return;
  if (sprint.i >= sprint.pool.length) { endSprint(); return; }
  const w = sprint.pool[sprint.i];
  const card = $('card');
  card.innerHTML = '';
  card.onclick = null;
  const head = el('div', 'ex-head');
  const label = el('span', 'ex-label');
  const ic = el('span', 'ex-ic'); ic.innerHTML = ICON.choose;
  label.append(ic, document.createTextNode('Спринт'));
  const timer = el('span', 'sprint-time', String(sprint.left));
  timer.id = 'sprintTime';
  head.append(label, timer);
  card.appendChild(head);
  const body = el('div', 'prompt');
  body.appendChild(bigWord(w.en, 'en'));
  card.appendChild(body);
  const opts = C.shuffle([w].concat(C.distractors(w, allWords(), 'uk', 3, Math.random, true)));
  const box = el('div', 'options');
  const btns = [];
  opts.forEach((o, i) => {
    const b = el('button', 'opt-btn');
    b.type = 'button';
    b.append(el('span', 'k', String(i + 1)), el('span', null, o.uk));
    b.addEventListener('click', () => {
      if (!sprint || b.disabled) return;
      btns.forEach(x => { x.disabled = true; });
      const ok = o.id === w.id;
      haptic(ok ? 'ok' : 'wrong');
      if (ok) { sprint.ok++; b.classList.add('right'); }
      else {
        b.classList.add('wrong');
        btns[opts.findIndex(x => x.id === w.id)].classList.add('right');
        sprint.wrong.push(w.id);
        const l = todayLog(); l.miss = l.miss || []; if (!l.miss.includes(w.id)) l.miss.push(w.id);
      }
      sprint.i++;
      setTimeout(sprintNext, ok ? 120 : 650);
    });
    btns.push(b);
    box.appendChild(b);
  });
  card.appendChild(box);
  setFoot([button('Зупинити', 'btn-quiet', endSprint)]);
  keys = { num: n => btns[n - 1] && btns[n - 1].click() };
}
function endSprint() {
  if (!sprint) return;
  clearInterval(sprint.timer);
  const r = sprint;
  sprint = null;
  mode = 'summary';
  const best = meta.sprintBest || 0;
  const record = r.ok > best;
  if (record) meta.sprintBest = r.ok;
  meta.sprintLast = r.ok;
  meta.sprintRuns = (meta.sprintRuns || 0) + 1;
  save(KEYS.meta, meta);
  const l = todayLog(); l.sp = Math.max(l.sp || 0, r.ok); persist();
  const card = $('card');
  card.innerHTML = '';
  const head = el('div', 'ex-head');
  const label = el('span', 'ex-label');
  const ic = el('span', 'ex-ic'); ic.innerHTML = ICON.choose;
  label.append(ic, document.createTextNode('Спринт'));
  head.appendChild(label);
  card.appendChild(head);
  const body = el('div', 'prompt');
  const big = el('h2', 'word', String(r.ok));
  body.appendChild(big);
  body.appendChild(el('p', 'prompt-sub', words(r.ok) + ' за хвилину' + (record && best ? ', новий рекорд' : best ? ', рекорд ' + best : '')));
  card.appendChild(body);
  if (r.wrong.length) {
    const d = el('div', 'details');
    d.appendChild(el('p', 'tip', 'Сплутав:'));
    r.wrong.forEach(id => {
      const w = byId(id);
      const p = el('p', 'ex');
      p.append(enSpan(w.en), document.createTextNode(' — ' + w.uk), sayBtn(w, 'w', true));
      d.appendChild(p);
    });
    card.appendChild(d);
  }
  const done = button('Готово', 'btn-primary', () => { mode = null; renderLearn(); });
  const again = button('Ще раз', '', startSprint);
  setFoot([again, done], 2);
  keys = { enter: () => done.click() };
  renderStreak();
  updateTape();
}

/* ---------- Слухати: слова голосом без рук (дорога, робота з одним навушником) ----------
   Слово, пауза згадати, переклад, приклад. Усе грає один <audio>, і паузи теж записи (тиша):
   коли екран заблоковано, таймери майже стоять, а звук грає далі, тож ланцюжок не рветься.
   Розклад повторень не змінюється: це підготовка до заняття, а не заміна. */
const GAP_URL = '/audio/gap.mp3', GAP_SEC = 0.55;
let gapSrc = null;
let listen = null;
let lSeekTok = 0;
function loadGap() {
  if (gapSrc) return;
  fetch(GAP_URL).then(r => (r.ok ? r.blob() : null)).then(b => { if (b && !gapSrc) gapSrc = URL.createObjectURL(b); }).catch(() => {});
}
function ukVoice() { return ukVoices.find(v => /lesya/i.test(v.name)) || ukVoices[0] || null; }
function ukSpeakable(t) { return String(t).replace(/\s*\([^)]*\)/g, '').replace(/\s+([,;])/g, '$1').replace(/^[,;\s]+|[,;\s]+$/g, '').replace(/\s+/g, ' '); }
/* Що слухати з головної: помилки дня, слова в процесі, повторення на сьогодні (найслабші першими),
   свіжі слова за два тижні, кілька наступних нових для знайомства, далі решта вивчених */
function listenIds() {
  const t = today(), l = todayLog();
  const out = [], seen = new Set();
  const add = id => { if (!seen.has(id) && byId(id)) { seen.add(id); out.push(id); } };
  const weak = (a, b) => C.strength(cards[a], t) - C.strength(cards[b], t);
  const mine = Object.keys(cards).filter(id => byId(id) && !cards[id].known);
  (l.miss || []).forEach(add);
  mine.filter(id => cards[id].st !== 'review').forEach(add);
  mine.filter(id => cards[id].st === 'review' && cards[id].due <= t).sort(weak).forEach(add);
  mine.filter(id => cards[id].st === 'review' && cards[id].first >= t - 14).sort(weak).forEach(add);
  if (out.length < 30) C.orderNew(allWords(), cards, settings.cats, settings.newPerDay, t, meta.priority).slice(0, 8).forEach(w => add(w.id));
  mine.filter(id => cards[id].st === 'review').sort(weak).forEach(add);
  return out.slice(0, 40);
}
function startListen(ids, source) {
  ids = (ids || listenIds()).filter(id => byId(id));
  if (!ids.length) { toast('Поки немає слів, які можна послухати'); return; }
  stopAudio(); cancelAuto(); closePeek();
  if (sprint) endSprint();
  session = null; current = null; ui = null; triage = null;
  // iPhone дозволяє голосу говорити без дотику лише після першої фрази, сказаної з дотику
  if (synth) { try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; synth.speak(u); } catch (e) {} }
  loadGap();
  listen = { ids, i: 0, k: 0, q: [], tok: 0, paused: false, onEnd: null, segEnd: 0, segFrom: 0, isGap: false, lastDur: 0,
    heard: new Set(), ms: 0, t0: performance.now(), shown: {}, source: source || 'home', timer: null, pack: null, speakFin: null };
  mode = 'listen';
  if (currentTab !== 'learn') showTab('learn');
  lMediaHandlers(true);
  lLoad();
}
function lWord() { const id = listen.ids[listen.i]; return C.withExample(byId(id), cards[id]); }
/* Черга дій для одного слова. sh: пауза, щоб повторити вголос (якщо ввімкнено) */
function lQueue(w) {
  const q = [{ t: 'say', kind: 'w' }, { t: 'gap', d: 1.6, sh: true }, { t: 'show', what: 'uk' }, { t: 'uk' }];
  if (w.ex) q.push({ t: 'gap', d: 0.4 }, { t: 'show', what: 'ex' }, { t: 'say', kind: 'x' }, { t: 'gap', d: 1.1, sh: true });
  if (settings.listen.phrases && PHRASES[w.id] && phrasePackUrl(w)) {
    q.push({ t: 'show', what: 'ph' });
    if (settings.listen.shadow) PHRASES[w.id].forEach((p, i) => q.push({ t: 'phrase', i }, { t: 'gap', d: 0.8, sh: true }));
    else q.push({ t: 'pack' }, { t: 'gap', d: 0.6 });
  }
  q.push({ t: 'gap', d: 0.9 });
  return q;
}
function lLoad() {
  if (!listen) return;
  const w = lWord();
  listen.q = lQueue(w); listen.k = 0; listen.shown = {}; listen.lastDur = 0;
  lRenderCard(w);
  lMedia(w);
  const nx = listen.ids[listen.i + 1] && byId(listen.ids[listen.i + 1]);
  preloadWord(w);
  if (nx) { preloadWord(C.withExample(nx, cards[nx.id])); if (settings.listen.phrases) preloadPhrases(nx); }
  if (settings.listen.phrases) preloadPhrases(w);
  updateTape();
  if (!listen.paused) lRun();
}
function lRun() {
  if (!listen || listen.paused) return;
  const a = listen.q[listen.k];
  if (!a) { lJump(1); return; }
  const tok = ++listen.tok;
  const done = () => { if (!listen || tok !== listen.tok || listen.paused) return; listen.k++; lRun(); };
  const w = lWord();
  if (a.t === 'show') { lShow(a.what); done(); return; }
  if (a.t === 'say') {
    const url = clipUrl(w, a.kind);
    if (url) { lPlay(url, 0, 0, done); return; }
    const text = textFor(w, a.kind);
    if (text && !document.hidden) lSpeak(speakable(text), 'en', done); else done();
    return;
  }
  if (a.t === 'uk') {
    if (settings.listen.uk && ukVoice() && !document.hidden) lSpeak(ukSpeakable(w.uk), 'uk', done);
    else lGap(1.0, done);
    return;
  }
  if (a.t === 'gap') { lGap(a.sh && settings.listen.shadow ? Math.max(a.d, listen.lastDur * 1.15 + 0.8) : a.d, done); return; }
  const url = phrasePackUrl(w);
  const times = url && AUD.phrases[w.id];
  if (a.t === 'pack' && url) { listen.pack = times.slice(1); lPlay(url, 0, 0, () => { if (listen) { listen.pack = null; lMark(-1); } done(); }); return; }
  if (a.t === 'phrase' && times && times[a.i + 1]) { lMark(a.i); lPlay(url, times[a.i + 1][0], times[a.i + 1][1], done); return; }
  done();
}
function lPlay(src, from, to, done) {
  clearSegment();
  if (synth && synth.speaking) synth.cancel();
  playing = '';
  listen.onEnd = done;
  listen.isGap = src === gapSrc;
  listen.segFrom = from || 0;
  listen.segEnd = to ? to + 0.06 : 0;
  const real = blobs.get(src) || src;
  const tk = ++lSeekTok;
  const seek = () => { if (tk !== lSeekTok) return; try { if (Math.abs(player.currentTime - (from || 0)) > 0.05) player.currentTime = from || 0; } catch (e) {} };
  if (player.getAttribute('src') !== real) { player.src = real; player.addEventListener('loadedmetadata', seek, { once: true }); }
  else seek();
  player.defaultPlaybackRate = settings.rate;
  player.playbackRate = settings.rate;
  const p = player.play();
  if (p && p.catch) p.catch(err => {
    if (!listen || listen.onEnd !== done) return;
    if (err && err.name === 'NotAllowedError') lPause();
    else if (!err || err.name !== 'AbortError') lFire();
  });
}
/* Запис дограв (або дійшов до кінця шматка): наступна дія */
function lFire() {
  if (!listen || !listen.onEnd) return;
  if (!listen.isGap) listen.lastDur = (listen.segEnd ? listen.segEnd - listen.segFrom : (isFinite(player.duration) ? player.duration : 1.5)) / (settings.rate || 1);
  const f = listen.onEnd;
  listen.onEnd = null; listen.segEnd = 0;
  f();
}
player.addEventListener('ended', () => { if (listen) lFire(); });
player.addEventListener('error', () => { if (listen && listen.onEnd) lFire(); });
player.addEventListener('timeupdate', () => {
  if (!listen) return;
  if (listen.segEnd && player.currentTime >= listen.segEnd) { try { player.pause(); } catch (e) {} lFire(); return; }
  if (listen.pack) {
    const t = player.currentTime;
    lMark(listen.pack.findIndex(([a, b]) => t >= a - 0.1 && t <= b + 0.3));
  }
});
function lGap(sec, done) {
  if (!gapSrc) {
    clearTimeout(listen.timer);
    listen.timerOn = true;
    listen.timer = setTimeout(() => { if (listen) listen.timerOn = false; done(); }, sec * 1000);
    return;
  }
  let left = Math.max(1, Math.round(sec / GAP_SEC));
  const loop = () => { if (!listen) return; if (left-- <= 0) { done(); return; } lPlay(gapSrc, 0, 0, loop); };
  loop();
}
function lSpeak(text, lang, done) {
  if (!synth || !text) { done(); return; }
  try { player.pause(); } catch (e) {}
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const v = lang === 'uk' ? ukVoice() : pickVoice();
  if (v) { u.voice = v; u.lang = v.lang; } else u.lang = lang === 'uk' ? 'uk-UA' : 'en-GB';
  u.rate = lang === 'uk' ? 1 : Math.max(0.5, settings.rate * 0.95);
  let fired = false;
  const fin = () => { if (fired) return; fired = true; if (listen) { clearTimeout(listen.timer); listen.speakFin = null; } done(); };
  u.onend = fin; u.onerror = fin;
  listen.speakFin = fin;
  // На iPhone подія кінця фрази інколи губиться: не чекаємо вічно
  clearTimeout(listen.timer);
  listen.timer = setTimeout(fin, 1800 + text.length * 110);
  synth.speak(u);
}
/* Зупинити поточний звук і скасувати очікування */
function lHalt() {
  if (!listen) return;
  listen.tok++;
  listen.onEnd = null; listen.segEnd = 0; listen.pack = null; listen.speakFin = null; listen.timerOn = false;
  clearTimeout(listen.timer);
  try { player.pause(); } catch (e) {}
  if (synth) synth.cancel();
}
function lHeard() {
  const id = listen.ids[listen.i];
  if (!listen.shown.uk || listen.heard.has(id)) return;
  listen.heard.add(id);
  const l = todayLog(); l.ls = (l.ls || 0) + 1;
  save(KEYS.log, log);
}
function lPause() {
  if (!listen || listen.paused) return;
  lHalt();
  listen.paused = true;
  listen.ms += performance.now() - listen.t0;
  lMediaState();
  lRenderFoot();
}
/* Після паузи слово звучить спочатку: так легше підхопити */
function lResume() {
  if (!listen || !listen.paused) return;
  listen.paused = false;
  listen.t0 = performance.now();
  lLoad();
}
function lJump(d) {
  if (!listen) return;
  lHeard();
  lHalt();
  if (listen.i + d >= listen.ids.length) { finishListen(); return; }
  listen.i = Math.max(0, listen.i + d);
  // «Наступне» з паузи (і з навушників) одразу грає; зміна налаштування на паузі лише перемальовує
  if (listen.paused && d !== 0) { listen.paused = false; listen.t0 = performance.now(); }
  lLoad();
}
function lShow(what) {
  listen.shown[what] = true;
  const n = $(what === 'uk' ? 'lUk' : what === 'ex' ? 'lEx' : 'lPh');
  if (n) n.classList.remove('veil');
}
function lMark(i) {
  const box = $('lPh');
  if (!box) return;
  Array.from(box.children).forEach((r, k) => {
    const on = k === i;
    if (on && !r.classList.contains('on') && !document.hidden) { try { r.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) {} }
    r.classList.toggle('on', on);
  });
}
function lRenderCard(w) {
  closePeek();
  $('stage').hidden = false;
  $('learnHome').hidden = true;
  const card = $('card');
  card.innerHTML = '';
  card.onclick = null;
  const head = el('div', 'ex-head');
  const label = el('span', 'ex-label');
  const ic = el('span', 'ex-ic'); ic.innerHTML = ICON.listen;
  label.append(ic, document.createTextNode('Слухати'));
  const right = el('span', 'ex-right');
  if (!cards[w.id]) right.appendChild(el('span', 'badge fresh', 'нове'));
  right.appendChild(document.createTextNode((listen.i + 1) + ' з ' + listen.ids.length));
  head.append(label, right);
  card.appendChild(head);
  const body = el('div', 'prompt listen');
  body.appendChild(bigWord(w.en, 'en'));
  const uk = el('p', 'l-uk veil', w.uk); uk.id = 'lUk';
  body.appendChild(uk);
  card.appendChild(body);
  if (w.ex) {
    const exb = el('div', 'l-ex veil'); exb.id = 'lEx';
    const p = el('p', 'ex'); p.appendChild(enText(w.ex));
    exb.appendChild(p);
    if (w.exUk) exb.appendChild(el('p', 'ex-uk', w.exUk));
    card.appendChild(exb);
  }
  if (settings.listen.phrases && PHRASES[w.id]) {
    const ph = el('div', 'l-ph veil'); ph.id = 'lPh';
    PHRASES[w.id].forEach(p => {
      const r = el('p', 'l-phr');
      const en = el('span', 'phrase-en'); en.appendChild(enText(p[0]));
      r.append(en, el('span', 'phrase-uk', p[1]));
      ph.appendChild(r);
    });
    card.appendChild(ph);
  }
  card.appendChild(lOptions());
  lRenderFoot();
  window.scrollTo(0, 0);
}
function lOptions() {
  const box = el('div', 'l-opts');
  const row = el('div', 'chips wrap');
  const hint = el('p', 'tip');
  const drawHint = () => {
    hint.textContent = settings.listen.shadow
      ? 'Після кожного запису пауза: повтори вголос слідом за Еммою, так розмова пізніше йде легше.'
      : 'Слухай і згадуй переклад до того, як він з\'явиться. Розклад повторень це не змінює.';
  };
  const chip = (key, text, restart) => {
    const b = el('button', 'chip', text);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(!!settings.listen[key]));
    b.addEventListener('click', () => {
      settings.listen[key] = !settings.listen[key];
      saveSettings();
      b.setAttribute('aria-pressed', String(settings.listen[key]));
      drawHint();
      if (restart) lJump(0);
    });
    return b;
  };
  row.append(chip('shadow', 'Пауза, щоб повторити', true), chip('phrases', 'З фразами', true));
  if (ukVoice()) row.appendChild(chip('uk', 'Переклад уголос'));
  drawHint();
  box.append(row, hint);
  return box;
}
function lRenderFoot() {
  if (!listen) return;
  const mk = (icon, text, fn, cls) => {
    const b = el('button', 'btn l-btn' + (cls ? ' ' + cls : ''));
    b.type = 'button';
    const i = el('span', 'l-ic'); i.innerHTML = ICON[icon];
    b.append(i, el('span', null, text));
    b.addEventListener('click', fn);
    return b;
  };
  const prev = mk('prev', 'Назад', () => lJump(-1));
  prev.disabled = listen.i === 0;
  const pp = listen.paused ? mk('play', 'Слухати', lResume, 'btn-primary') : mk('pause', 'Пауза', lPause, 'btn-primary');
  const last = listen.i >= listen.ids.length - 1;
  const next = mk(last ? 'check' : 'next', last ? 'Кінець' : 'Далі', () => lJump(1));
  setFoot([prev, pp, next], '3m');
  keys = { space: () => (listen.paused ? lResume() : lPause()), enter: () => (listen.paused ? lResume() : lPause()) };
  lMediaState();
}
function listenTape() {
  const n = listen.ids.length;
  renderTape(listen.i, n, 'Слово', null, true);
  $('tapeDone').innerHTML = 'Слово <b>' + (listen.i + 1) + '</b> з ' + n;
  const per = (settings.listen.phrases ? 20 : 9) * (settings.listen.shadow ? 1.6 : 1);
  $('tapeLeft').textContent = 'ще ≈ ' + mins(Math.max(1, Math.round((n - listen.i) * per / 60)));
}
/* Екран блокування й навушники: назва слова, пауза, наступне/попереднє */
function lMedia(w) {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({ title: w.en, artist: w.uk, album: 'English Words',
      artwork: [{ src: '/icon-512.png', sizes: '512x512', type: 'image/png' }] });
  } catch (e) {}
}
function lMediaState() {
  if (!('mediaSession' in navigator)) return;
  try { navigator.mediaSession.playbackState = !listen ? 'none' : listen.paused ? 'paused' : 'playing'; } catch (e) {}
}
function lMediaHandlers(on) {
  if (!('mediaSession' in navigator)) return;
  const set = (a, f) => { try { navigator.mediaSession.setActionHandler(a, on ? f : null); } catch (e) {} };
  set('play', () => lResume());
  set('pause', () => lPause());
  set('nexttrack', () => lJump(1));
  set('previoustrack', () => lJump(-1));
  set('stop', () => finishListen());
}
/* Зупинити слухання. Повертає стан, щоб показати підсумок */
function endListen() {
  if (!listen) return null;
  lHeard();
  lHalt();
  const L = listen;
  if (!L.paused) L.ms += performance.now() - L.t0;
  const l = todayLog();
  l.lms = (l.lms || 0) + Math.round(L.ms);
  save(KEYS.log, log);
  listen = null;
  lMediaHandlers(false);
  if ('mediaSession' in navigator) { try { navigator.mediaSession.metadata = null; } catch (e) {} }
  lMediaState();
  return L;
}
function finishListen() {
  const L = endListen();
  if (!L) return;
  if (L.heard.size) { showListenDone(L); return; }
  mode = null;
  if (L.source === 'dict') showTab('dict'); else renderLearn();
}
function showListenDone(L) {
  mode = 'summary';
  $('stage').hidden = false;
  $('learnHome').hidden = true;
  const card = $('card');
  card.innerHTML = '';
  card.onclick = null;
  const head = el('div', 'ex-head');
  const label = el('span', 'ex-label');
  const ic = el('span', 'ex-ic done'); ic.innerHTML = ICON.check;
  label.append(ic, document.createTextNode('Слухання завершено'));
  head.appendChild(label);
  card.appendChild(head);
  const body = el('div', 'prompt summary');
  body.appendChild(el('h2', 'word', 'Прослухано'));
  const stats = el('div', 'stats two');
  const stat = (v, k) => { const d = el('div', 'stat'); d.append(el('b', null, v), el('span', null, k)); stats.appendChild(d); };
  stat(String(L.heard.size), C.plural(L.heard.size, 'слово', 'слова', 'слів'));
  stat(mins(Math.max(1, Math.round(L.ms / 60000))), 'час');
  body.appendChild(stats);
  const plan = new C.Session(envFor());
  const c = plan.counts();
  const todo = c.reviews + c.learning + c.fresh;
  body.appendChild(el('p', 'prompt-sub', todo
    ? 'Тепер ці слова легше згадати самому. На занятті чекає ' + lowerFirst(planSentence(c)) + '.'
    : 'Слухання готує до заняття, а розклад повторень не змінює.'));
  card.appendChild(body);
  const back = () => { mode = null; if (L.source === 'dict') showTab('dict'); else renderLearn(); window.scrollTo(0, 0); };
  const btns = [button('Готово', 'btn-quiet', back)];
  if (todo && L.source !== 'dict') btns.push(button('Почати заняття', 'btn-primary', () => startSession()));
  else btns.push(button('Слухати ще раз', 'btn-primary', () => startListen(L.ids, L.source)));
  setFoot(btns, 2);
  keys = { enter: () => btns[1].click() };
  updateTape();
}
document.addEventListener('visibilitychange', () => {
  if (!listen || listen.paused) return;
  // Голос iPhone у фоні замовкає: не чекаємо його, а йдемо далі записами
  if (document.hidden && listen.speakFin) { const f = listen.speakFin; if (synth) synth.cancel(); f(); return; }
  // Повернувся до екрана, а ланцюжок десь зупинився: слово звучить заново
  const stalled = () => listen && !listen.paused && (listen.onEnd ? player.paused : !listen.speakFin && !listen.timerOn);
  if (!document.hidden && stalled()) setTimeout(() => { if (stalled()) { lHalt(); lLoad(); } }, 400);
});
/* Звук зупинила система (дзвінок, інша програма): показати паузу, а не чекати вічно */
player.addEventListener('pause', () => {
  if (listen && !listen.paused && listen.onEnd && player.paused && !player.ended) lPause();
});

/* ---------- Граматика: правило простими словами, приклади й 12 завдань з оцінкою ----------
   Теми збирає tools/build_grammar.py з grammar/*.json у window.GRAMMAR.
   Оцінка за 12-бальною шкалою: 1 завдання = 1 бал. */
const GR = window.GRAMMAR || { sections: [], topics: {} };
let gres = load(KEYS.grammar, {});        // { id: { best, last, date, n, read } }
let gramOpen = null;                      // відкрита тема
let gramPushed = false;                   // запис в історії для жесту «назад»
let gramListY = 0;                        // де був список, щоб повернутися туди ж
let gt = null;                            // тест, що йде
let gramObs = null;                       // стежить, чи видно блок тесту (кнопка «До завдань»)
const GRADE = b => (b >= 10 ? 'відмінно' : b >= 7 ? 'добре' : b >= 4 ? 'задовільно' : 'варто повторити');
const gradeCls = b => (b >= 10 ? 'g-top' : b >= 7 ? 'g-ok' : 'g-low');
function gramOrder() { return GR.sections.reduce((a, s) => a.concat(s.topics), []); }
function saveGres() { save(KEYS.grammar, gres); }
function points(n) { return n + ' ' + C.plural(n, 'бал', 'бали', 'балів'); }
/* Текст з **виділенням**: українська — жирним, англійська — маркером, кожне англійське слово торкабельне */
function richUk(text) {
  const f = document.createDocumentFragment();
  String(text).split('**').forEach((part, i) => { if (part) f.appendChild(i % 2 ? el('b', null, part) : document.createTextNode(part)); });
  return f;
}
function richEn(text) {
  const s = el('span'); s.lang = 'en';
  String(text).split('**').forEach((part, i) => {
    if (!part) return;
    if (i % 2) { const m = el('mark', 'gm'); m.appendChild(enText(part)); s.appendChild(m); } else s.appendChild(enText(part));
  });
  return s;
}
const plain = t => String(t || '').replace(/\*\*/g, '');
const CYR_RX = /[А-Яа-яІіЇїЄєҐґ]/;
function gsay(text) {
  const b = el('button', 'say sm');
  b.type = 'button';
  b.innerHTML = ICON.speaker;
  b.setAttribute('aria-label', 'Послухати');
  b.addEventListener('click', e => { e.stopPropagation(); speakDevice(plain(text)); });
  return b;
}
function gramBadge(id) {
  const r = gres[id];
  const i = el('span', 'gmark' + (r && r.best != null ? ' ' + gradeCls(r.best) : r && r.read ? ' read' : ''));
  if (r && r.best != null) { i.textContent = String(r.best); i.setAttribute('aria-label', 'Бал ' + r.best + ' з 12'); }
  else i.setAttribute('aria-label', r && r.read ? 'Прочитано, тест ще не пройдено' : 'Ще не почато');
  return i;
}
function gramNext() {
  const ids = gramOrder();
  return ids.find(id => !gres[id] || gres[id].best == null || gres[id].best < 7) || null;
}
/* Теми, які час повторити: пройдені (7+), а день повторення настав. Найдавніше прострочені першими */
function gramDue() {
  const t = today();
  return gramOrder().filter(id => { const r = gres[id]; return r && r.best >= 7 && r.due != null && r.due <= t; })
    .sort((a, b) => gres[a].due - gres[b].due);
}
function isDue(id) { const r = gres[id]; return !!(r && r.best >= 7 && r.due != null && r.due <= today()); }
function renderGrammar() {
  if (gramOpen && GR.topics[gramOpen]) renderGramTopic(gramOpen);
  else { gramOpen = null; renderGramList(); }
}
function renderGramList() {
  const box = $('gramList');
  $('gramTopic').hidden = true;
  box.hidden = false;
  box.innerHTML = '';
  const ids = gramOrder();
  box.appendChild(el('h2', 'report-title', 'Граматика'));
  if (!ids.length) { box.appendChild(el('p', 'tip', 'Теми з\'являться після оновлення.')); return; }
  const done = ids.filter(id => gres[id] && gres[id].best != null);
  const avg = done.length ? Math.round(done.reduce((a, id) => a + gres[id].best, 0) / done.length) : 0;
  box.appendChild(el('p', 'gintro', ids.length + ' ' + C.plural(ids.length, 'тема', 'теми', 'тем') + ': «Головне» на 20 секунд, правило простими словами, приклади, типові помилки й тест на 12 завдань. Кожна правильна відповідь — 1 бал з 12.'));
  if (done.length) box.appendChild(el('p', 'gintro strong', 'Пройдено ' + done.length + ' з ' + ids.length + ', середній бал ' + avg + '.'));
  const card = (id, small) => {
    const t = GR.topics[id];
    const b = el('button', 'gnext');
    b.type = 'button';
    const txt = el('span', 'gnext-text');
    const en = el('b', null, t.title); en.lang = 'en';
    txt.append(el('small', null, small), en, el('span', null, t.uk));
    const chev = el('span', 'chev'); chev.innerHTML = ICON.chevron;
    b.append(txt, chev);
    b.addEventListener('click', () => openTopic(id));
    return b;
  };
  // Спершу повторення пройденого, яке вже настав час освіжити, потім наступна нова тема
  const due = gramDue();
  if (due.length) {
    box.appendChild(card(due[0], due.length > 1 ? 'Час повторити, ще ' + (due.length - 1) + ' ' + C.plural(due.length - 1, 'тема', 'теми', 'тем') + ' чекає' : 'Час повторити: нові завдання'));
  }
  const next = gramNext();
  if (next) box.appendChild(card(next, done.length ? 'Далі за планом' : 'Почни звідси'));
  GR.sections.forEach(sec => {
    const n = sec.topics.filter(id => gres[id] && gres[id].best != null).length;
    const h = el('h3', 'section-title gsec', sec.title);
    h.appendChild(el('span', null, n ? n + ' з ' + sec.topics.length : String(sec.topics.length)));
    box.appendChild(h);
    const ul = el('ul', 'list glist-topics');
    sec.topics.forEach(id => {
      const t = GR.topics[id];
      const li = el('li', 'item');
      const head = el('button', 'item-head gitem');
      head.type = 'button';
      const txt = el('span', 'item-text');
      const en = el('span', 'item-en', t.title); en.lang = 'en';
      txt.append(en, el('span', 'item-uk', t.uk));
      if (isDue(id)) txt.appendChild(el('span', 'gdue', 'час повторити'));
      head.append(gramBadge(id), txt, el('span', 'glevel', t.level));
      head.addEventListener('click', () => openTopic(id));
      li.appendChild(head);
      ul.appendChild(li);
    });
    box.appendChild(ul);
    // Тест розділу: завдання з усіх його тем, показує, яка тема просіла
    const sr = gres['sec:' + sec.id];
    const st = el('button', 'gsec-test');
    st.type = 'button';
    const sic = el('span', 'qa-ic'); sic.innerHTML = ICON.target;
    const stx = el('span', 'qa-text');
    stx.append(el('b', null, 'Тест розділу'), el('small', null, sr && sr.best != null ? 'найкраще ' + sr.best + ' з 12, ' + GRADE(sr.best) : '12 завдань з усіх тем розділу'));
    st.append(sic, stx);
    st.addEventListener('click', () => startSectionTest(sec.id));
    box.appendChild(st);
  });
  box.appendChild(el('p', 'tip gfoot', 'Бали: 10–12 відмінно, 7–9 добре, 4–6 задовільно. Щоразу тест бере нові завдання з банку теми, а ті, де помилився, повертає. Пройдені теми нагадаю повторити через кілька днів, далі все рідше.'));
}
function openTopic(id) {
  if (!GR.topics[id]) return;
  if (!gramOpen) gramListY = window.scrollY;
  gramOpen = id;
  if (!gramPushed) { try { history.pushState({ ew: 'gtopic' }, ''); gramPushed = true; } catch (e) {} }
  if (currentTab !== 'grammar') showTab('grammar'); else renderGrammar();
  window.scrollTo(0, 0);
}
function closeTopic() {
  closePeek();
  gramOpen = null;
  if (currentTab === 'grammar') { renderGramList(); window.scrollTo(0, gramListY); }
}
function leaveTopic() { if (gramPushed) history.back(); else closeTopic(); }
function gramBlock(b) {
  switch (b.t) {
    case 'p': { const p = el('p', 'gp'); p.appendChild(richUk(b.text)); return p; }
    case 'h': return el('h3', 'gh', b.text);
    case 'tip': { const d = el('div', 'gtip'); d.appendChild(richUk(b.text)); return d; }
    case 'list': {
      const ul = el('ul', 'glist');
      b.items.forEach(it => { const li = el('li'); li.appendChild(richUk(it)); ul.appendChild(li); });
      return ul;
    }
    case 'rule': {
      const d = el('div', 'grule');
      if (b.title) d.appendChild(el('p', 'grule-t', b.title));
      b.lines.forEach(ln => { const p = el('p', 'grule-l'); p.appendChild(richEn(ln)); d.appendChild(p); });
      return d;
    }
    case 'table': {
      const wrap = el('div', 'gtable-wrap');
      const tb = el('table', 'gtable');
      const tr = el('tr');
      b.head.forEach(h => tr.appendChild(el('th', null, h)));
      const thead = el('thead'); thead.appendChild(tr); tb.appendChild(thead);
      const tbody = el('tbody');
      b.rows.forEach(r => {
        const row = el('tr');
        r.forEach(c => { const td = el('td'); td.appendChild(CYR_RX.test(c) ? richUk(c) : richEn(c)); row.appendChild(td); });
        tbody.appendChild(row);
      });
      tb.appendChild(tbody);
      wrap.appendChild(tb);
      return wrap;
    }
    case 'ex': {
      const d = el('div', 'gex');
      b.items.forEach(([en, uk]) => {
        const row = el('div', 'gex-row');
        const txt = el('div', 'gex-text');
        const e = el('p', 'gex-en'); e.dataset.sent = plain(en); e.appendChild(richEn(en));
        txt.append(e, el('p', 'gex-uk', uk));
        row.append(txt, gsay(en));
        d.appendChild(row);
      });
      return d;
    }
    case 'mistake': {
      const d = el('div', 'gmist');
      const bad = el('p', 'gmist-bad'); const bi = el('span', 'gmi'); bi.innerHTML = ICON.cross;
      const bt = el('s', null, b.wrong); bt.lang = 'en';
      bad.append(bi, bt);
      const good = el('p', 'gmist-good'); const gi = el('span', 'gmi'); gi.innerHTML = ICON.check;
      const gtx = el('span', null, b.right); gtx.lang = 'en';
      good.append(gi, gtx, gsay(b.right));
      d.append(bad, good, el('p', 'gmist-why', b.why));
      return d;
    }
  }
  return document.createDocumentFragment();
}
function renderGramTopic(id) {
  const t = GR.topics[id];
  const box = $('gramTopic');
  $('gramList').hidden = true;
  box.hidden = false;
  box.innerHTML = '';
  gres[id] = Object.assign({}, gres[id], { read: gres[id] && gres[id].read || today() });
  saveGres();
  const top = el('div', 'gtop');
  const back = el('button', 'gback');
  back.type = 'button';
  back.innerHTML = ICON.chevron;
  back.appendChild(document.createTextNode('Усі теми'));
  back.addEventListener('click', leaveTopic);
  top.append(back, el('span', 'gmeta', t.level + ', ' + t.minutes + ' хв читання'));
  box.appendChild(top);
  const title = el('h2', 'gtitle', t.title); title.lang = 'en';
  box.append(title, el('p', 'gsub', t.uk));
  const key = gramKey(t);
  if (key) box.appendChild(key);
  const sheet = el('div', 'gsheet');
  t.blocks.forEach(b => sheet.appendChild(gramBlock(b)));
  box.appendChild(sheet);
  // Перевір себе
  const r = gres[id];
  const test = el('section', 'gtest');
  test.appendChild(el('h3', 'gh', 'Перевір себе'));
  const bank = t.tasks.length;
  const seenN = r && r.seen ? t.tasks.filter(x => r.seen[C.taskKey(x)]).length : 0;
  test.appendChild(el('p', 'gp', '12 завдань: вибрати, вписати, скласти речення. Кожна правильна відповідь — 1 бал. Після кожної відповіді покажу, чому саме так.'));
  if (r && r.best != null) {
    const res = el('p', 'gbest');
    res.append(el('b', 'gscore ' + gradeCls(r.best), r.best + ' з 12'), document.createTextNode(' — твій найкращий результат, ' + GRADE(r.best) + (r.date != null ? ', ' + C.fmtDate(r.date) : '') + '.'));
    test.appendChild(res);
    if (bank > 12) test.appendChild(el('p', 'gbest muted2', 'Бачив ' + seenN + ' з ' + bank + ' завдань теми. Наступний тест візьме ' + (seenN < bank ? 'нові' : 'ті, де помилявся, і решту вперемішку') + '.'));
    if (isDue(id)) test.appendChild(el('p', 'gbest due', 'Час повторити: з останнього тесту минуло кілька днів, саме тепер повторення найкорисніше.'));
    else if (r.due != null) test.appendChild(el('p', 'gbest muted2', 'Наступне повторення ' + C.fmtDate(r.due) + '.'));
  }
  test.appendChild(button(isDue(id) ? 'Повторити тему' : r && r.best != null ? 'Пройти ще раз' : 'Почати завдання', 'btn-primary btn-big', () => startGramTest(id)));
  box.appendChild(test);
  // Довга тема: кнопка «До завдань», поки сам тест ще не на екрані
  const jump = el('button', 'gjump');
  jump.type = 'button';
  jump.textContent = 'До завдань';
  jump.addEventListener('click', () => test.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  box.appendChild(jump);
  if (gramObs) gramObs.disconnect();
  if ('IntersectionObserver' in window) {
    gramObs = new IntersectionObserver(es => { es.forEach(e => jump.classList.toggle('show', !e.isIntersecting && e.boundingClientRect.top > 0)); });
    gramObs.observe(test);
  }
  // Сусідні теми
  const ids = gramOrder(), k = ids.indexOf(id);
  const nav = el('div', 'gnav');
  const link = (tid, dir) => {
    const b = el('button', 'gnav-btn ' + dir);
    b.type = 'button';
    b.append(el('small', null, dir === 'prev' ? 'Попередня' : 'Наступна'), el('span', null, GR.topics[tid].title));
    b.addEventListener('click', () => openTopic(tid));
    return b;
  };
  if (k > 0) nav.appendChild(link(ids[k - 1], 'prev'));
  if (k >= 0 && k < ids.length - 1) nav.appendChild(link(ids[k + 1], 'next'));
  box.appendChild(nav);
}

/* Тест теми: на екрані заняття (весь екран, нижня панель з висновком) */
function beginGt(g) {
  stopAudio(); cancelAuto(); closePeek();
  if (listen) endListen();
  session = null; current = null; triage = null;
  gt = Object.assign({ i: 0, ok: 0, wrong: [], res: [], t0: performance.now(), answered: false }, g);
  mode = 'gtest';
  showTab('learn');
  gtShow();
}
/* indices — лише для тестів: які саме завдання банку взяти */
function startGramTest(id, _again, indices) {
  const t = GR.topics[id];
  if (!t) return;
  const sel = indices ? indices.map(i => t.tasks[i]).filter(Boolean) : C.pickTasks(t.tasks, (gres[id] || {}).seen, 12, Math.random);
  beginGt({ kind: 'topic', id, title: t.title, tasks: sel.map(x => Object.assign({ tid: id }, x)) });
}
function startSectionTest(sid) {
  const sec = GR.sections.find(s => s.id === sid);
  if (!sec) return;
  const topics = sec.topics.map(id => ({ id, tasks: GR.topics[id].tasks, best: gres[id] && gres[id].best, seen: gres[id] && gres[id].seen }));
  const picked = C.pickSectionTasks(topics, 12, Math.random);
  beginGt({ kind: 'section', id: 'sec:' + sid, sid, title: sec.title, tasks: picked.map(p => Object.assign({ tid: p.tid }, p.task)) });
}
/* «Головне»: шпаргалка теми */
function gramKey(t) {
  if (!t.key || !t.key.length) return null;
  const k = el('section', 'gkey');
  k.appendChild(el('h3', 'gkey-t', 'Головне'));
  const ul = el('ul', 'gkey-list');
  t.key.forEach(x => { const li = el('li'); li.appendChild(richUk(x)); ul.appendChild(li); });
  k.appendChild(ul);
  return k;
}
/* Під час тесту: правило теми поточного завдання, не виходячи з тесту */
function openRuleSheet() {
  if (!gt) return;
  const task = gt.tasks[gt.i];
  const t = GR.topics[task.tid];
  if (!t) return;
  closeRuleSheet();
  const wrap = el('div', 'gsheet-wrap');
  wrap.id = 'ruleSheet';
  const panel = el('div', 'gsheet-panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Правило: ' + t.title);
  const head = el('div', 'gsheet-head');
  const ttl = el('b', null, t.title); ttl.lang = 'en';
  const close = el('button', 'icon-btn');
  close.type = 'button';
  close.innerHTML = ICON.close;
  close.setAttribute('aria-label', 'Закрити');
  close.addEventListener('click', closeRuleSheet);
  head.append(ttl, close);
  panel.appendChild(head);
  const body = el('div', 'gsheet-body');
  const key = gramKey(t);
  if (key) body.appendChild(key);
  // Формули, таблиці й примітки — те, що допомагає саме зараз; приклади й історія правила лишаються на сторінці теми
  t.blocks.filter(b => b.t === 'rule' || b.t === 'table' || b.t === 'tip').forEach(b => body.appendChild(gramBlock(b)));
  panel.appendChild(body);
  wrap.appendChild(panel);
  wrap.addEventListener('click', e => { if (e.target === wrap) closeRuleSheet(); });
  document.body.appendChild(wrap);
  document.body.classList.add('sheet-open');
}
function closeRuleSheet() {
  const s = $('ruleSheet');
  if (s) s.remove();
  document.body.classList.remove('sheet-open');
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('ruleSheet')) { e.stopPropagation(); closeRuleSheet(); } }, true);
function gtFull(task) {
  if (task.type === 'order') return [].concat(task.a)[0];
  const ans = task.type === 'choice' ? task.opts[task.a] : task.a[0];
  return task.q && task.q.includes('___') ? task.q.replace('___', ans).replace(/\s*\([^)]*\)/, '') : ans;
}
function gtShow() {
  closePeek();
  closeRuleSheet();
  const task = gt.tasks[gt.i];
  const t = GR.topics[task.tid];
  gt.answered = false;
  ui = { t0: performance.now(), answered: false };
  $('stage').hidden = false;
  $('learnHome').hidden = true;
  const card = $('card');
  card.innerHTML = '';
  card.onclick = null;
  const head = el('div', 'ex-head');
  const label = el('span', 'ex-label');
  const ic = el('span', 'ex-ic'); ic.innerHTML = ICON.pen;
  const lt = el('span', 'gt-topic', t.title); lt.lang = 'en';
  label.append(ic, lt);
  head.append(label, el('span', 'ex-right', (gt.i + 1) + ' з ' + gt.tasks.length));
  card.appendChild(head);
  const body = el('div', 'prompt gt');
  const instr = task.task || (task.type === 'choice' ? 'Вибери правильний варіант' : task.type === 'input' ? 'Впиши пропущене' : 'Склади речення з цих слів');
  body.appendChild(el('p', 'prompt-sub gt-instr', instr));
  let blank = null;
  if (task.q) {
    const q = el('p', 'gq'); q.lang = 'en';
    const parts = task.q.split('___');
    q.appendChild(document.createTextNode(parts[0]));
    if (parts.length > 1) { blank = el('span', 'blank'); blank.textContent = ' '; q.append(blank, document.createTextNode(parts[1])); }
    body.appendChild(q);
  }
  if (task.uk) body.appendChild(el('p', task.type === 'order' ? 'gq uk' : 'ex-uk', task.uk));
  card.appendChild(body);
  const done = (ok, given, answerText) => {
    if (gt.answered) return;
    gt.answered = true;
    ui.answered = true;
    if (ok) gt.ok++; else gt.wrong.push({ task, given });
    gt.res.push({ tid: task.tid, ok });
    // Що бачив і де помилився: наступний тест поверне помилки й візьме нове
    const g = gres[task.tid] = Object.assign({}, gres[task.tid]);
    g.seen = Object.assign({}, g.seen);
    g.seen[C.taskKey(task)] = ok ? 2 : 1;
    saveGres();
    const l = todayLog(); l.gt = (l.gt || 0) + 1;
    l.ms = (l.ms || 0) + Math.min(60000, Math.max(0, performance.now() - ui.t0));
    save(KEYS.log, log);
    haptic(ok ? 'ok' : 'wrong');
    renderStreak();
    if (blank) { blank.textContent = answerText; blank.classList.add('filled'); }
    const full = gtFull(task);
    if (!settings.quiet && settings.autoplay) speakDevice(full);
    const extra = el('span', 'gt-why');
    if (!ok && given) {
      const y = el('span', 'yours');
      const s = el('s', null, given); if (!CYR_RX.test(given)) s.lang = 'en';
      y.append(document.createTextNode('Твоя відповідь: '), s);
      extra.appendChild(y);
    }
    extra.appendChild(el('span', 'why', task.why));
    const ansNode = ok ? null : (() => { const a = el('span'); a.lang = 'en'; a.textContent = task.type === 'order' ? full : answerText; return a; })();
    const v = verdict(ok ? 'right' : 'wrong', ok ? 'Правильно' : (given ? 'Ні, правильно:' : 'Правильно:'), null, ansNode, extra);
    const last = gt.i >= gt.tasks.length - 1;
    const nb = button(last ? 'Результат' : 'Далі', 'btn-primary', gtNext);
    setFoot([nb], 0, v);
    keys = { enter: () => nb.click() };
    updateTape();
  };
  if (task.type === 'choice') {
    const opts = C.shuffle(task.opts.map((o, k) => ({ o, k })));
    const box = el('div', 'options');
    const btns = [];
    opts.forEach(({ o, k }) => {
      const b = el('button', 'opt-btn' + (CYR_RX.test(o) ? '' : ' en'));
      b.type = 'button';
      const txt = el('span', null, o); if (!CYR_RX.test(o)) txt.lang = 'en';
      b.append(el('span', 'k', String(btns.length + 1)), txt);
      b.addEventListener('click', () => pick(k, b));
      btns.push(b);
      box.appendChild(b);
    });
    card.appendChild(box);
    const pick = (k, b) => {
      if (gt.answered) return;
      const ok = k === task.a;
      btns.forEach((x, i) => {
        x.disabled = true;
        if (opts[i].k === task.a) { x.classList.add('right'); x.firstChild.innerHTML = ICON.check; }
        else if (x === b) { x.classList.add('wrong'); x.firstChild.innerHTML = ICON.cross; }
        else x.classList.add('dim');
      });
      done(ok, b ? task.opts[k] : '', task.opts[task.a]);
    };
    setFoot([button('Не знаю', 'btn-quiet', () => pick(-1, null))]);
    keys = { num: n => btns[n - 1] && btns[n - 1].click() };
  } else if (task.type === 'input') {
    const input = el('input', 'answer');
    Object.assign(input, { type: 'text', autocomplete: 'off', spellcheck: false });
    input.setAttribute('autocapitalize', 'none');
    input.setAttribute('autocorrect', 'off');
    input.setAttribute('enterkeyhint', 'done');
    input.setAttribute('aria-label', 'Пропущене слово');
    input.lang = 'en';
    card.appendChild(input);
    input.addEventListener('focus', () => document.body.classList.add('typing'));
    input.addEventListener('blur', () => setTimeout(() => document.body.classList.remove('typing'), 50));
    const targets = task.a.concat(task.a.map(a => task.q.replace('___', a).replace(/\s*\([^)]*\)/, '')));
    const check = skip => {
      if (gt.answered) return;
      const value = input.value.trim();
      if (!value && !skip) { input.focus(); toast('Впиши відповідь або натисни «Не знаю»'); return; }
      // Граматика перевіряється точно: друкарська помилка й апостроф тут часто і є помилкою
      const ok = !skip && C.grammarMatch(value, targets);
      input.disabled = true;
      input.blur();
      input.classList.add(ok ? 'right' : 'wrong');
      done(ok, skip ? '' : value, task.a[0]);
    };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); if (!gt.answered) check(false); else gtNext(); } });
    setFoot([button('Не знаю', 'btn-quiet', () => check(true)), button('Перевірити', 'btn-primary', () => check(false))], 2);
    keys = {};
    try { input.focus({ preventScroll: true }); } catch (e) {}
  } else {
    // Склади речення з плиток
    const words = C.shuffle(task.words.map((w, i) => ({ t: w, i })));
    const answers = [].concat(task.a).map(a => C.tokens(a).map(x => x.toLowerCase()));
    const answerBox = el('div', 'build-answer');
    answerBox.setAttribute('aria-label', 'Твоє речення');
    const bank = el('div', 'build-bank');
    const placed = [];
    const bankBtns = new Map();
    const redraw = () => {
      answerBox.innerHTML = '';
      placed.forEach((tile, pos) => {
        const b = el('button', 'tile', tile.t);
        b.type = 'button'; b.lang = 'en';
        if (tile.state) b.classList.add(tile.state);
        b.addEventListener('click', () => {
          if (gt.answered) return;
          placed.splice(pos, 1);
          bankBtns.get(tile.i).classList.remove('used');
          redraw();
        });
        answerBox.appendChild(b);
      });
      checkBtn.disabled = placed.length !== words.length;
    };
    words.forEach(tile => {
      const b = el('button', 'tile', tile.t);
      b.type = 'button'; b.lang = 'en';
      b.addEventListener('click', () => {
        if (gt.answered || b.classList.contains('used')) return;
        placed.push(tile); b.classList.add('used'); redraw();
      });
      bankBtns.set(tile.i, b);
      bank.appendChild(b);
    });
    card.append(answerBox, bank);
    const check = skip => {
      if (gt.answered) return;
      const mine = placed.map(p => p.t.toLowerCase().replace(/’/g, "'"));
      const hit = answers.find(a => a.length === mine.length && a.every((x, i) => x === mine[i]));
      const best = hit || answers[0];
      placed.forEach((p, i) => { p.state = best[i] === mine[i] ? 'good' : 'bad'; });
      redraw();
      done(!skip && !!hit, skip ? '' : placed.map(p => p.t).join(' '), [].concat(task.a)[0]);
    };
    const checkBtn = button('Перевірити', 'btn-primary', () => check(false));
    checkBtn.disabled = true;
    setFoot([button('Не знаю', 'btn-quiet', () => check(true)), checkBtn], 2);
    keys = { enter: () => { if (!checkBtn.disabled) check(false); } };
  }
  updateTape();
  window.scrollTo(0, 0);
}
function gtNext() {
  if (!gt) return;
  if (gt.i >= gt.tasks.length - 1) { gtResult(); return; }
  gt.i++;
  stopAudio();
  gtShow();
}
function gtTape() {
  const n = gt.tasks.length, d = gt.i + (gt.answered ? 1 : 0);
  renderTape(d, n, 'Завдання', null, true);
  $('tapeLeft').textContent = (gt.mode === 'result' ? 'бал ' : 'правильно ') + gt.ok;
}
function gtResult() {
  const n = gt.tasks.length;
  const bal = Math.round(gt.ok / n * 12);
  const prev = gres[gt.id] || {};
  const upd = { best: Math.max(bal, prev.best == null ? -1 : prev.best), last: bal, date: today(), n: (prev.n || 0) + 1 };
  if (gt.kind === 'topic') Object.assign(upd, C.grammarSchedule(prev, bal, today()));
  gres[gt.id] = Object.assign({}, prev, upd);
  saveGres();
  const l = todayLog();
  l.gtr = (l.gtr || []).filter(x => x.id !== gt.id).concat([{ id: gt.id, b: bal }]);
  save(KEYS.log, log);
  gt.mode = 'result';
  mode = 'gresult';
  stopAudio();
  closeRuleSheet();
  const card = $('card');
  card.innerHTML = '';
  card.onclick = null;
  const head = el('div', 'ex-head');
  const label = el('span', 'ex-label');
  const ic = el('span', 'ex-ic done'); ic.innerHTML = ICON.check;
  label.append(ic, document.createTextNode(gt.kind === 'section' ? 'Тест розділу завершено' : 'Тест завершено'));
  head.appendChild(label);
  card.appendChild(head);
  const body = el('div', 'prompt summary gres');
  const score = el('p', 'gres-score ' + gradeCls(bal));
  score.append(el('b', null, String(bal)), el('span', null, 'з 12'));
  body.append(score, el('p', 'gres-grade ' + gradeCls(bal), GRADE(bal)));
  let line = gt.title + ': правильно ' + gt.ok + ' з ' + n + '.';
  if (prev.best != null) line += bal > prev.best ? ' Новий найкращий результат, раніше було ' + prev.best + '.' : ' Найкращий результат: ' + Math.max(bal, prev.best) + '.';
  body.appendChild(el('p', 'prompt-sub', line));
  if (gt.kind === 'topic') {
    const r = gres[gt.id];
    body.appendChild(el('p', 'prompt-sub', bal >= 7
      ? 'Нагадаю повторити ' + C.fmtDate(r.due) + (r.iv > 4 ? ': знаєш добре, тому рідше.' : '.')
      : 'Перечитай «Головне» й типові помилки, потім спробуй ще раз: тест поверне ці завдання й додасть нові.'));
  }
  card.appendChild(body);
  // Тест розділу: по темах, щоб було видно, яку підтягнути
  let weak = [];
  if (gt.kind === 'section') {
    const per = {};
    gt.res.forEach(x => { const p = per[x.tid] = per[x.tid] || { ok: 0, n: 0 }; p.n++; if (x.ok) p.ok++; });
    const sec = GR.sections.find(s2 => s2.id === gt.sid);
    const d = el('div', 'details gsec-res');
    d.appendChild(el('p', 'tip', 'По темах'));
    sec.topics.filter(tid => per[tid]).forEach(tid => {
      const p = per[tid];
      const row = el('button', 'gsec-row' + (p.ok < p.n ? ' bad' : ''));
      row.type = 'button';
      const en = el('span', 'gsec-t', GR.topics[tid].title); en.lang = 'en';
      row.append(en, el('b', null, p.ok + ' з ' + p.n));
      row.addEventListener('click', () => { gt = null; mode = null; openTopic(tid); });
      d.appendChild(row);
      if (p.ok < p.n) weak.push(tid);
    });
    if (weak.length) d.appendChild(el('p', 'tip', 'Варто підтягнути: ' + weak.map(tid => GR.topics[tid].title).join(', ') + '. Торкнись теми, щоб відкрити правило.'));
    card.appendChild(d);
  }
  if (gt.wrong.length) {
    const d = el('div', 'details gres-list');
    d.appendChild(el('p', 'tip', 'Помилки: правильна відповідь виділена'));
    gt.wrong.forEach(({ task, given }) => {
      const it = el('div', 'gres-item');
      if (gt.kind === 'section') { const tn = el('p', 'gres-topic', GR.topics[task.tid].title); tn.lang = 'en'; it.appendChild(tn); }
      const s2 = el('p', 'gres-sent'); s2.lang = 'en';
      const full = gtFull(task);
      if (task.type !== 'order' && task.q && task.q.includes('___')) {
        const ans = task.type === 'choice' ? task.opts[task.a] : task.a[0];
        const parts = task.q.replace(/\s*\([^)]*\)/, '').split('___');
        s2.append(document.createTextNode(parts[0]), el('mark', 'gm', ans), document.createTextNode(parts[1] || ''));
      } else s2.appendChild(el('mark', 'gm', full));
      it.appendChild(s2);
      if (given) { const y = el('p', 'yours'); const g2 = el('s', null, given); y.append(document.createTextNode('Твоя відповідь: '), g2); it.appendChild(y); }
      it.appendChild(el('p', 'gres-why', task.why));
      d.appendChild(it);
    });
    card.appendChild(d);
  }
  const btns = [];
  if (gt.kind === 'section') {
    const sid = gt.sid;
    btns.push(button('До списку', 'btn-quiet', () => { gt = null; mode = null; gramOpen = null; showTab('grammar'); }));
    btns.push(weak.length
      ? button('Відкрити ' + GR.topics[weak[0]].title, 'btn-primary', () => { gt = null; mode = null; openTopic(weak[0]); })
      : button('Ще раз', 'btn-primary', () => startSectionTest(sid)));
  } else {
    const ids = gramOrder();
    const id = gt.id;
    const nextId = ids[ids.indexOf(id) + 1];
    const toTopic = () => { gt = null; mode = null; gramOpen = id; showTab('grammar'); window.scrollTo(0, 0); };
    if (bal >= 10 && nextId) {
      btns.push(button('Ще раз', 'btn-quiet', () => startGramTest(id)));
      btns.push(button('Наступна тема', 'btn-primary', () => { gt = null; mode = null; gramOpen = nextId; showTab('grammar'); window.scrollTo(0, 0); }));
    } else {
      btns.push(button('До правила', 'btn-quiet', toTopic));
      btns.push(button('Пройти ще раз', 'btn-primary', () => startGramTest(id)));
    }
  }
  setFoot(btns, 2);
  keys = { enter: () => btns[1].click() };
  updateTape();
  window.scrollTo(0, 0);
}
/* Вийти з тесту (хрестик, жест «назад») або з результату */
function endGramTest() {
  const wasTest = mode === 'gtest' && gt && gt.i + (gt.answered ? 1 : 0) > 0;
  const topicId = gt ? (gt.kind === 'topic' ? gt.id : null) : gramOpen;
  gt = null;
  mode = null;
  stopAudio();
  closeRuleSheet();
  document.body.classList.remove('typing');
  gramOpen = topicId && GR.topics[topicId] ? topicId : null;
  showTab('grammar');
  if (wasTest) toast('Тест перервано, бал не збережено');
}

/* Клавіатура (для комп'ютера) */
document.addEventListener('keydown', e => {
  if (currentTab !== 'learn') return;
  if (auto && e.key !== 'Enter') cancelAuto();
  if (e.target.closest && e.target.closest('input,textarea,select')) return;
  if (e.key === 'Escape' && mode) { e.preventDefault(); $('exitBtn').click(); return; }
  if ((e.key === 'z' || e.key === 'я') && !e.metaKey && !e.ctrlKey && mode === 'session') { e.preventDefault(); doUndo(); return; }
  if (/^[1-4]$/.test(e.key) && keys.num) { e.preventDefault(); keys.num(Number(e.key)); return; }
  if (e.key === 'Enter' && keys.enter) { if (e.target.closest && e.target.closest('button')) return; e.preventDefault(); keys.enter(); return; }
  if (e.key === ' ' && keys.space) { e.preventDefault(); keys.space(); }
});

/* ---------- Словник ---------- */
let dictCat = 'all';
let dictStatus = 'all';
let openItem = null;
const STATUS_TEXT = { new: 'нове', learning: 'вчу', known: 'знаю', leech: 'важке' };
/* Стани з кількістю слів (для вибраної теми й пошуку) */
function renderStatusSeg(counts) {
  const box = $('segStatus'); box.innerHTML = '';
  [['all', 'Усі'], ['new', 'Нові'], ['learning', 'Вчу'], ['known', 'Знаю'], ['leech', 'Важкі']].forEach(([val, label]) => {
    const b = el('button', null, label);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(dictStatus === val));
    if (counts) b.appendChild(el('small', null, String(counts[val] || 0)));
    b.addEventListener('click', () => { dictStatus = val; openItem = null; renderList(); });
    box.appendChild(b);
  });
}
/* Теми: кнопка з вибраною темою і сітка всіх тем з кількістю слів (20 тем у рядок не вміщаються) */
const BASE_CATS = ['spoken', 'idioms', 'base1', 'base2', 'base3'];
function renderChips() {
  $('catName').textContent = dictCat === 'all' ? 'Усі теми' : (CATS[dictCat] || 'Усі теми');
  $('catChev').innerHTML = ICON.chevron;
  const grid = $('catGrid');
  if (grid.hidden) return;
  grid.innerHTML = '';
  const n = {}, kn = {};
  let knownAll = 0;
  allWords().forEach(w => {
    n[w.cat] = (n[w.cat] || 0) + 1;
    if (C.statusOf(cards[w.id]) === 'known') { kn[w.cat] = (kn[w.cat] || 0) + 1; knownAll++; }
  });
  const cell = (k, name, count, known, cls) => {
    const b = el('button', 'cat-cell' + (cls ? ' ' + cls : ''));
    b.type = 'button';
    b.setAttribute('aria-pressed', String(dictCat === k));
    b.append(el('b', null, name), el('small', null, words(count) + (known ? ', знаю ' + known : '')));
    b.addEventListener('click', () => {
      dictCat = k; openItem = null;
      grid.hidden = true; $('catBtn').setAttribute('aria-expanded', 'false');
      renderChips(); renderList();
      // Сітка тем була довга: повертаємось до кількості слів і дій з темою
      window.scrollTo(0, 0);
    });
    return b;
  };
  grid.appendChild(cell('all', 'Усі теми', allWords().length, knownAll, 'all'));
  const mine = Object.keys(CATS).filter(k => !BASE_CATS.includes(k) && k !== 'mine');
  [['Базовий словник', BASE_CATS], ['Мої теми', mine.concat(custom.length ? ['mine'] : [])]].forEach(([title, keys]) => {
    const ks = keys.filter(k => n[k]);
    if (!ks.length) return;
    grid.appendChild(el('p', 'cat-group', title));
    ks.forEach(k => grid.appendChild(cell(k, CATS[k], n[k], kn[k] || 0)));
  });
}
$('catBtn').addEventListener('click', () => {
  const g = $('catGrid');
  g.hidden = !g.hidden;
  $('catBtn').setAttribute('aria-expanded', String(!g.hidden));
  renderChips();
});
/* Пошук: спершу точний збіг, потім слова, що починаються з запиту, потім решта */
const stripHead = s => s.toLowerCase().replace(/^to /, '').replace(/^(a|an|the) /, '');
function searchScore(w, q) {
  const e = w.en.toLowerCase(), h = stripHead(w.en), u = w.uk.toLowerCase();
  if (h === q || e === q) return 0;
  if (h.startsWith(q)) return 1;
  if (e.split(/[^a-z']+/).some(x => x.startsWith(q))) return 2;
  if (e.includes(q)) return 3;
  const uw = u.split(/[^а-яіїєґ'ʼ]+/);
  if (u.startsWith(q)) return 4;
  if (uw.some(x => x === q)) return 5;
  if (uw.some(x => x.startsWith(q))) return 6;
  if (u.includes(q)) return 7;
  return -1;
}
function renderList() {
  const q = $('search').value.trim().toLowerCase();
  const list = $('list'); list.innerHTML = '';
  const t = today();
  let base = allWords().filter(w => dictCat === 'all' || w.cat === dictCat);
  if (q) {
    base = base.map((w, i) => ({ w, i, s: searchScore(w, q) })).filter(x => x.s >= 0)
      .sort((a, b) => a.s - b.s || a.i - b.i).map(x => x.w);
  }
  const counts = { all: base.length };
  base.forEach(w => { const st = C.statusOf(cards[w.id]); counts[st] = (counts[st] || 0) + 1; });
  renderStatusSeg(counts);
  const items = dictStatus === 'all' ? base : base.filter(w => C.statusOf(cards[w.id]) === dictStatus);
  $('dictCount').textContent = words(items.length) + (dictStatus === 'all' && counts.known ? ', знаю ' + counts.known : '');
  renderDictActs(items, q);
  if (!items.length) {
    list.appendChild(el('li', 'empty', q ? 'Нічого не знайдено. Можна додати це слово.' : 'Тут поки порожньо.'));
    return;
  }
  const frag = document.createDocumentFragment();
  items.slice(0, 400).forEach(w => {
    const c = cards[w.id];
    const li = el('li', 'item' + (openItem === w.id ? ' open' : ''));
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
    head.appendChild(txt);
    // Мітка лише там, де вона щось каже: нові слова без мітки, «вчу» тихо
    if (st !== 'new') head.appendChild(el('span', 'status ' + st, STATUS_TEXT[st]));
    else if ((meta.priority || []).includes(w.id)) head.appendChild(el('span', 'status pri', 'першим'));
    // Відкриваємо на місці, без перемальовування всього списку: не стрибає прокрутка
    head.addEventListener('click', () => {
      const was = openItem === w.id;
      const prev = list.querySelector('.item.open');
      if (prev) {
        prev.classList.remove('open');
        const pb = prev.querySelector('.item-body'); if (pb) pb.remove();
        prev.querySelector('.item-head').setAttribute('aria-expanded', 'false');
      }
      openItem = was ? null : w.id;
      if (!was) {
        li.classList.add('open');
        li.appendChild(itemBody(w, cards[w.id], today()));
        head.setAttribute('aria-expanded', 'true');
      }
    });
    li.appendChild(head);
    if (openItem === w.id) li.appendChild(itemBody(w, c, t));
    frag.appendChild(li);
  });
  list.appendChild(frag);
  if (items.length > 400) list.appendChild(el('li', 'empty', 'Показано 400 з ' + items.length + '. Вибери тему або почни вводити слово.'));
}
/* Дії з відібраними словами (тема, стан або пошук): послухати, потренувати, вчити першими */
function renderDictActs(items, q) {
  const box = $('dictActs');
  box.innerHTML = '';
  const filtered = dictCat !== 'all' || dictStatus !== 'all' || !!q;
  if (!filtered || !items.length) { box.hidden = true; return; }
  const t = today();
  const act = (icon, text, fn) => {
    const b = el('button', 'act');
    b.type = 'button';
    b.innerHTML = ICON[icon];
    b.appendChild(document.createTextNode(text));
    b.addEventListener('click', fn);
    box.appendChild(b);
  };
  if (canListen()) act('listen', 'Слухати', () => startListen(items.slice(0, 50).map(w => w.id), 'dict'));
  const studied = items.filter(w => cards[w.id]).sort((a, b) => C.strength(cards[a.id], t) - C.strength(cards[b.id], t));
  // Тренування не змінює розклад: до 20 найслабших слів з відібраних
  if (studied.length >= 2) act('target', 'Потренувати', () => {
    startSession(C.shuffle(studied.slice(0, 20).map(w => w.id)), false, null, 'dict');
    showTab('learn');
  });
  const fresh = items.filter(w => !cards[w.id]);
  if (fresh.length && (dictCat !== 'all' || q)) {
    const pri = new Set(meta.priority || []);
    const allPri = fresh.every(w => pri.has(w.id));
    act('plus', allPri ? 'Не першими' : 'Вчити першими', () => {
      const ids = new Set(fresh.map(w => w.id));
      const list = (meta.priority || []).filter(x => !cards[x] && !ids.has(x));
      meta.priority = allPri ? list : list.concat(fresh.map(w => w.id));
      save(KEYS.meta, meta);
      resetSession();
      renderList();
      toast(allPri ? 'Повернула в загальну чергу' : words(fresh.length) + ' підуть першими серед нових');
    });
  }
  box.hidden = !box.childNodes.length;
}
function itemBody(w, c, t) {
  const body = el('div', 'item-body');
  preloadWord(w);
  [[w.ex, w.exUk, 'x'], [w.ex2, w.ex2Uk, 'x2']].forEach(([ex, exUk, kind]) => {
    if (!ex) return;
    const p = el('p', 'ex'); p.append(enText(ex), sayBtn(w, kind, true)); body.appendChild(p);
    if (exUk) body.appendChild(el('p', 'ex-uk', exUk));
  });
  if (w.note) { const n = el('p', 'note'); n.textContent = w.note; body.appendChild(n); }
  if (own[w.id] && own[w.id].length) {
    const o = el('p', 'muted');
    o.append(document.createTextNode('Твої речення: '));
    own[w.id].forEach((t, i) => { const sp = el('span', null, (i ? ' · ' : '') + t); sp.lang = 'en'; sp.style.color = 'var(--ink)'; o.appendChild(sp); });
    body.appendChild(o);
  }
  if (c) {
    let info;
    if (c.st === 'review') info = (c.due <= t ? 'Повторення сьогодні' : 'Повторення ' + C.fmtDate(c.due)) + '. Пам\'ять зараз ' + Math.round(C.strength(c, t) * 100) + '%.';
    else info = 'Ще вчиш, продовжиш на занятті.';
    if (c.lapses) info += ' Забував: ' + c.lapses + ' р.';
    body.appendChild(el('p', 'muted', info));
  }
  const pb = phraseBlock(w, true);
  if (pb) body.appendChild(pb);
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
  if (!c) {
    const isPri = (meta.priority || []).includes(w.id);
    act(isPri ? 'Не першим' : 'Вчити першим', () => {
      const list = (meta.priority || []).filter(x => x !== w.id && !cards[x]);
      if (!isPri) list.push(w.id);
      meta.priority = list;
      save(KEYS.meta, meta);
      resetSession();
      renderList();
      toast(isPri ? 'Повернула в загальну чергу' : '«' + w.en + '» буде серед найближчих нових');
    });
  }
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
function resetSession() { session = null; current = null; ui = null; if (mode === 'session') mode = null; }
let searchTimer = null;
$('search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { openItem = null; renderList(); }, 120); });
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
  renderChips(); renderList();
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
  ].concat(l.sp ? [['Спринт', l.sp + ' за хвилину']] : [])
    .concat(l.ls ? [['Слухав', words(l.ls) + ', ' + mins(Math.max(1, Math.round((l.lms || 0) / 60000)))]] : [])
    .concat(gramReport(l));
}
/* Теми й розділи, пройдені сьогодні */
function gramReport(l) {
  const name = id => {
    if (GR.topics[id]) return GR.topics[id].title;
    const sec = id.indexOf('sec:') === 0 && GR.sections.find(s => s.id === id.slice(4));
    return sec ? 'розділ «' + sec.title + '»' : null;
  };
  const items = (l.gtr || []).filter(x => name(x.id)).map(x => name(x.id) + ' ' + x.b + ' з 12');
  return items.length ? [['Граматика', items.join(', ')]] : [];
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

  // Поступ у базовому словнику: скільки з найуживаніших слів уже твої
  const bp = $('baseProgress'); bp.innerHTML = '';
  const agg = {};
  allWords().forEach(w => {
    if (!BASE_CATS.includes(w.cat)) return;
    const a = agg[w.cat] = agg[w.cat] || { n: 0, k: 0, l: 0 };
    a.n++;
    const st = C.statusOf(cards[w.id]);
    if (st === 'known') a.k++; else if (st !== 'new') a.l++;
  });
  BASE_CATS.filter(k => agg[k]).forEach(k => {
    const a = agg[k];
    const row = el('div', 'bp-row');
    const top = el('div', 'bp-top');
    top.append(el('b', null, CATS[k]), el('span', null, 'знаю ' + a.k + (a.l ? ', вчу ' + a.l : '') + ' з ' + a.n));
    const bar = el('div', 'vocab-bar small');
    bar.setAttribute('role', 'img');
    bar.setAttribute('aria-label', CATS[k] + ': знаю ' + a.k + ', вчу ' + a.l + ' з ' + a.n);
    [['k', a.k], ['l', a.l]].forEach(([c, v]) => { if (!v) return; const i = el('i', c); i.style.width = (v / a.n * 100) + '%'; bar.appendChild(i); });
    row.append(top, bar);
    bp.appendChild(row);
  });
  $('baseBox').hidden = !bp.childNodes.length;

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
  $('pretest').checked = settings.pretest !== false;
  $('speaking').checked = settings.speaking !== false;
  $('autoNext').checked = settings.autoNext !== false;
  $('quiet').checked = !!settings.quiet;
  $('haptics').checked = settings.haptics !== false;
  const rb = $('reminderBox');
  rb.innerHTML = '';
  if (meta.reminder) {
    const p = el('p', 'note2', 'Зараз: ' + meta.reminder.a + ', о ' + meta.reminder.t + '. Щоб змінити, додай нову подію, а стару видали в Календарі.');
    rb.appendChild(p);
  }
  rb.appendChild(reminderPanel(() => renderSettings()));
  const vopts = AUD.voices.map(v => [v, VOICE_NAMES[v] || v]).concat([['device', 'iPhone']]);
  segment('segVoice', vopts, settings.voiceSrc, v => { settings.voiceSrc = v; re(); sayWord(byId(SAMPLE_ID), 'x'); });
  segment('segRate', [[0.75, 'Повільно'], [0.9, 'Середньо'], [1, 'Звичайно']], settings.rate, v => { settings.rate = v; re(); sayWord(byId(SAMPLE_ID), 'x'); });
  $('voiceLbl').textContent = settings.voiceSrc === 'device' ? 'Голос iPhone' : 'Голос iPhone для слів, доданих на сайті';
  $('offlineAudio').hidden = settings.voiceSrc === 'device' || !AUD.voices.length;
  document.querySelector('.offline-more').hidden = $('offlineAudio').hidden;
  $('autoplay').checked = settings.autoplay;
  renderVoices();
  const box = $('catToggles'); box.innerHTML = '';
  const tot = {}, fresh = {};
  BASE.forEach(w => { tot[w.cat] = (tot[w.cat] || 0) + 1; if (!cards[w.id]) fresh[w.cat] = (fresh[w.cat] || 0) + 1; });
  const mineKeys = Object.keys(CATS).filter(k => !BASE_CATS.includes(k) && k !== 'mine');
  [['Базовий словник', BASE_CATS], ['Мої теми', mineKeys]].forEach(([title, keys]) => {
    const ks = keys.filter(k => tot[k]);
    if (!ks.length) return;
    box.appendChild(el('h3', 'sub', title));
    ks.forEach(k => {
      const name = CATS[k];
      const row = el('div', 'toggle');
      const label = el('span', null, name);
      label.appendChild(el('span', 'opt', 'ще не вчив ' + (fresh[k] || 0) + ' з ' + tot[k]));
      const sw = el('input', 'switch'); sw.type = 'checkbox'; sw.checked = settings.cats[k] !== false;
      sw.setAttribute('aria-label', name);
      sw.addEventListener('change', () => { settings.cats[k] = sw.checked; saveSettings(); });
      row.append(label, sw);
      box.appendChild(row);
    });
  });
  renderOffline();
  $('lastBackup').textContent = meta.lastBackup != null ? 'Остання копія: ' + C.fmtDate(meta.lastBackup) + '.' : 'Копію ще не зберігали.';
}
$('typing').addEventListener('change', e => { settings.typing = e.target.checked; saveSettings(); });
$('pretest').addEventListener('change', e => { settings.pretest = e.target.checked; saveSettings(); });
$('speaking').addEventListener('change', e => { settings.speaking = e.target.checked; saveSettings(); });
$('autoplay').addEventListener('change', e => { settings.autoplay = e.target.checked; saveSettings(); });
$('autoNext').addEventListener('change', e => { settings.autoNext = e.target.checked; saveSettings(); });
$('quiet').addEventListener('change', e => { settings.quiet = e.target.checked; saveSettings(); if (settings.quiet) stopAudio(); });
$('haptics').addEventListener('change', e => { settings.haptics = e.target.checked; saveSettings(); if (settings.haptics) haptic('ok'); });
$('triageBtn').addEventListener('click', startTriage);
$('voice').addEventListener('change', e => { settings.voice = e.target.value; saveSettings(); speakDevice('Can you give me a hand?'); });
$('voiceTest').innerHTML = ICON.speaker;
$('voiceTest').addEventListener('click', () => speakDevice('Can you give me a hand with this?'));

/* Записи для офлайну. Усі записи важать ~660 МБ, тож за замовчуванням лише потрібні найближчим часом */
let offlineBusy = false;
const MB_PER_WORD = 0.21;
function wordUrls(w) {
  const out = [];
  ['w', 'x', 'x2'].forEach(k => { const u = clipUrl(w, k); if (u) out.push(u); });
  const pk = phrasePackUrl(w); if (pk) out.push(pk);
  return out;
}
function offlineSoon() {
  const studying = allWords().filter(w => cards[w.id]);
  const next = C.orderNew(allWords(), cards, settings.cats, settings.newPerDay, today(), meta.priority).slice(0, 50);
  return studying.concat(next);
}
function mbText(n) { return n >= 1000 ? (Math.round(n / 100) / 10).toString().replace('.', ',') + ' ГБ' : Math.max(1, Math.round(n)) + ' МБ'; }
function renderOffline() {
  const btn = $('offlineAudio');
  if (offlineBusy || !btn) return;
  const soon = offlineSoon();
  btn.innerHTML = '';
  btn.append(document.createTextNode('Завантажити записи для офлайну'), el('small', null, words(soon.length) + ': ті, що вчиш, і 50 наступних, ≈ ' + mbText(soon.length * MB_PER_WORD)));
  $('offlineAll').textContent = 'або всі ' + words(allWords().length) + ' (≈ ' + mbText(allWords().length * MB_PER_WORD) + ')';
  if ('caches' in window) caches.open('ew-audio-v2').then(c => c.keys()).then(k => {
    $('offlineNote').textContent = k.length ? 'На телефоні вже збережено ' + k.length + ' ' + C.plural(k.length, 'запис', 'записи', 'записів') + '.' : '';
  }).catch(() => {});
}
async function downloadAudio(list, btn) {
  if (offlineBusy) return;
  const urls = [GAP_URL];
  list.forEach(w => wordUrls(w).forEach(u => urls.push(u)));
  if (!urls.length) return;
  offlineBusy = true;
  const total = urls.length;
  let done = 0, failed = 0;
  const worker = async () => {
    while (urls.length) {
      const u = urls.pop();
      try { const r = await fetch(u); if (!r.ok) failed++; else await r.arrayBuffer(); } catch (e) { failed++; }
      done++;
      if (done % 10 === 0) btn.textContent = 'Завантажую… ' + Math.round(done / total * 100) + '%';
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  offlineBusy = false;
  renderOffline();
  toast(failed ? 'Не вдалося завантажити ' + failed + '. Спробуй ще раз з інтернетом.' : 'Готово: записи працюватимуть і без інтернету');
}
$('offlineAudio').addEventListener('click', () => downloadAudio(offlineSoon(), $('offlineAudio')));
$('offlineAll').addEventListener('click', () => {
  const n = allWords().length;
  if (!confirm('Завантажити всі записи (≈ ' + mbText(n * MB_PER_WORD) + ')? Краще через Wi-Fi.')) return;
  downloadAudio(allWords(), $('offlineAudio'));
});

/* Резервна копія */
function backupData() { return { app: 'english-words', version: 5, saved: new Date().toISOString(), cards, custom, notes, own, log, settings, meta, grammar: gres }; }
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
    custom = data.custom || []; log = data.log || {}; notes = data.notes || {}; own = data.own || {};
    meta = Object.assign({}, data.meta || {});
    gres = Object.assign({}, data.grammar || {}); saveGres(); gramOpen = null;
    settings = Object.assign({}, DEFAULT_SETTINGS, data.settings || {});
    settings.cats = Object.assign({}, settings.cats || {});
    settings.listen = Object.assign({}, DEFAULT_SETTINGS.listen, settings.listen || {});
    if (![0.85, 0.9, 0.95].includes(settings.retention)) settings.retention = 0.9;
    save(KEYS.custom, custom); save(KEYS.notes, notes); save(KEYS.own, own); save(KEYS.meta, meta); saveSettings(); persist();
    reindex(); session = null; current = null; mode = null;
    renderAll();
    toast('Прогрес відновлено');
  } catch (err) {
    toast('Це не схоже на копію English Words. Вибери файл english-words-….json');
  }
});
$('resetAll').addEventListener('click', () => {
  if (!confirm('Скинути весь прогрес і статистику? Свої слова й асоціації залишаться. Скасувати це не вийде.')) return;
  cards = {}; log = {}; persist();
  gres = {}; saveGres(); gramOpen = null; gt = null;
  session = null; current = null; mode = null;
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
  closePeek();
  if (name !== 'learn') {
    if (listen) { endListen(); mode = null; }
    stopAudio(); cancelAuto(); if (sprint) endSprint(); updateSessionBar();
  }
  if (name === 'learn') renderLearn();
  if (name === 'dict') { renderChips(); renderList(); }
  if (name === 'report') renderReport();
  if (name === 'grammar') renderGrammar();
  if (name === 'settings') renderSettings();
  window.scrollTo(0, 0);
}
document.querySelectorAll('[data-tab]').forEach(t => t.addEventListener('click', () => {
  // Повторний дотик до «Граматики» з відкритої теми повертає до списку
  if (t.dataset.tab === 'grammar' && currentTab === 'grammar' && gramOpen) { leaveTopic(); return; }
  showTab(t.dataset.tab);
}));
function renderAll() { renderStreak(); showTab(currentTab); }

let lastDay = today();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (today() !== lastDay) {
    lastDay = today();
    if (sprint) endSprint();
    if (listen) return;
    session = null; current = null; ui = null; mode = null; triage = null; gt = null;
    renderAll();
  }
});
window.addEventListener('resize', () => { if (currentTab === 'learn') updateTape(); });

/* ---------- Кнопки заняття ---------- */
$('exitBtn').innerHTML = ICON.close;
$('undoBtn').innerHTML = ICON.undo;
$('exitBtn').addEventListener('click', () => {
  if (mode === 'session') { endSession(true); return; }
  if (mode === 'sprint') { endSprint(); return; }
  if (mode === 'listen') { finishListen(); return; }
  if (mode === 'gtest' || mode === 'gresult') { endGramTest(); return; }
  triage = null; mode = null; renderLearn();
});
$('undoBtn').addEventListener('click', doUndo);
$('ruleBtn').innerHTML = ICON.book;
$('ruleBtn').addEventListener('click', openRuleSheet);
$('quietBtn').addEventListener('click', toggleQuiet);

/* ---------- Клавіатура iPhone і висота нижньої панелі ----------
   Safari не підсовує закріплені знизу елементи над клавіатурою, тож рахуємо її висоту самі. */
const vv = window.visualViewport;
let maxInnerH = window.innerHeight;
function measureFoot() {
  const f = $('foot');
  const h = f.hidden || $('stage').hidden ? 0 : f.offsetHeight;
  document.documentElement.style.setProperty('--foot-h', h + 'px');
}
if ('ResizeObserver' in window) new ResizeObserver(measureFoot).observe($('foot'));
let vvTimer = null;
function textFocused() { const a = document.activeElement; return !!a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && !/^(checkbox|radio|button|file|range)$/.test(a.type))); }
function onViewport() {
  if (!vv) return;
  maxInnerH = Math.max(maxInnerH, window.innerHeight);
  // Клавіатура відкрита: видима частина помітно нижча за екран, і фокус у полі вводу
  const open = textFocused() && maxInnerH - vv.height > 120 && vv.scale < 1.05;
  // Наскільки підняти нижню панель, щоб вона стояла над клавіатурою (у координатах сторінки)
  const kb = open ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0;
  document.documentElement.style.setProperty('--kb', kb + 'px');
  document.body.classList.toggle('kb-open', open);
  clearTimeout(vvTimer);
  if (open) vvTimer = setTimeout(keepFocusVisible, 80);
}
/* Поле вводу має бути видно між верхом екрана і панеллю з кнопками над клавіатурою */
function keepFocusVisible() {
  const a = document.activeElement;
  if (!vv || !a || !a.closest || !a.closest('#card')) return;
  const foot = $('foot');
  const r = a.getBoundingClientRect();
  const top = vv.offsetTop + 8;
  const bottom = vv.offsetTop + vv.height - (foot.hidden ? 0 : foot.offsetHeight) - 10;
  if (r.bottom > bottom) window.scrollBy(0, r.bottom - bottom);
  else if (r.top < top) window.scrollBy(0, r.top - top);
}
if (vv) { vv.addEventListener('resize', onViewport); vv.addEventListener('scroll', onViewport); }
window.addEventListener('orientationchange', () => { maxInnerH = 0; setTimeout(onViewport, 400); });
document.addEventListener('focusin', () => setTimeout(onViewport, 50));
document.addEventListener('focusout', () => setTimeout(onViewport, 50));
/* Програма з екрана «Додому»: після клавіатури iOS інколи лишає екран укороченим. Лікуємо перемалюванням */
document.addEventListener('focusout', () => {
  if (!standalone) return;
  setTimeout(() => {
    const a = document.activeElement;
    if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
    if (window.innerHeight >= maxInnerH - 60) return;
    const app = document.querySelector('.app');
    const y = window.scrollY;
    app.style.display = 'none';
    void app.offsetHeight;
    app.style.display = '';
    window.scrollTo(0, y);
    onViewport();
  }, 350);
});

renderAll();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}
if (/[?&]test=1/.test(location.search)) {
  window.EW = {
    get session() { return session; }, get current() { return current; }, get cards() { return cards; }, get log() { return log; },
    settings, nextItem, showTab, startSprint, get sprint() { return sprint; }, get mode() { return mode; },
    get meta() { return meta; }, undo: doUndo, startTriage, startShort, endSession, listenIds, startListen,
    get gt() { return gt; }, get gres() { return gres; }, openTopic, startGramTest, startSectionTest, gramDue, openRuleSheet,
    debug() { return { auto: !!auto, busy: audioBusy(), paused: player.paused, ended: player.ended, playing, t: player.currentTime, speaking: !!(synth && synth.speaking) }; },
    force(id, exercise) {
      if (!session) session = new C.Session(envFor());
      mode = 'session';
      showTab('learn');
      current = { id, word: byId(id), card: cards[id], exercise, source: 'review' };
      show(current);
    }
  };
}
})();

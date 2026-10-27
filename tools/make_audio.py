#!/usr/bin/env python3
"""Генерує британські аудіо для слів, прикладів і фраз з public/words.js і public/phrases.js.

Голос: Kokoro TTS (Apache 2.0), британський жіночий bf_emma.
Потрібно: pip install kokoro-onnx soundfile, ffmpeg, node і файли моделі
kokoro-v1.0.onnx та voices-v1.0.bin з
https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0

Запуск:  python3 tools/make_audio.py --model PATH/kokoro-v1.0.onnx --voices PATH/voices-v1.0.bin

Файли:
  audio/emma/<id>-<hash>.mp3    слово, приклад 1, приклад 2 (окремі файли)
  audio/emma/<id>-p<hash>.mp3   усі 5 фраз слова в одному файлі з паузами між ними;
                                у маніфесті для кожної фрази [початок, кінець] у секундах.
Фрази пакуються, бо Cloudflare (безкоштовний план) приймає до 20 000 файлів.

Генерує лише те, чого ще немає. Назва файлу містить хеш тексту, тож після зміни слова,
прикладу чи фраз запис оновиться сам. public/audio.js переписується по ходу роботи
(лише з готовими записами), тож проміжний стан можна комітити.
"""
import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC = os.path.join(ROOT, 'public')
AUDIO_DIR = os.path.join(PUBLIC, 'audio')
VOICES = {'emma': 'bf_emma'}
SPEED = 0.95
SR = 24000
BITRATE = '96k'
PACK_EDGE = 0.35   # тиша на початку і в кінці файла фраз, с
PACK_GAP = 0.6     # тиша між фразами, с

# espeak-ng en-gb читає ці слова з коротким «a», як на півночі Англії.
# Для британської норми (RP) їм потрібне довге «ɑː».
BATH_WORDS = ['after', 'plaster', 'plasterboard', 'pass', 'ask', 'asked', 'last',
              'fast', 'class', 'glass', 'grass', 'path', 'bath', 'answer', 'example',
              'staff', 'dance', 'chance', 'plant', 'castle', 'laugh', 'aunt', 'branch',
              'master', 'disaster', 'afternoon', 'basket', 'task', 'mask', 'vast', 'past',
              'passed', 'passing', 'asking', 'lasting', 'faster', 'classes', 'glasses', 'answered',
              'examples', 'plants', 'laughed', 'laughing', 'branches', 'tasks', 'command', 'demand',
              'can\'t', 'half', 'calm', 'palm', 'father', 'rather', 'banana', 'tomato', 'grant',
              'advantage', 'sample', 'pastry', 'nasty', 'ghastly', 'drama', 'graph', 'raft', 'craft',
              'draft', 'shaft', 'chant', 'slant', 'blast', 'mast', 'cast', 'contrast', 'forecast']


# Слова, які espeak читає як іменник там, де в реченні дієслово (close the door, excuse me, use it).
# Виправляємо написанням перед фонемізацією; хеш файла рахується від початкового тексту.
TEXT_FIXES = [
    (re.compile(r"\b([Ee])xcuse (me|him|her|us|them|you|myself|my|our|his)\b"), r"\1xcuze \2"),
    (re.compile(r"\bto excuse\b"), 'to excuze'),
    (re.compile(r"\b([Cc])lose (the|it|your|my|his|her|our|their|that|this|up|down|them|everything|all|a|an|at|early|late|soon|tonight|today|tomorrow)\b"), r"\1loze \2"),
    (re.compile(r"\b([Cc])lose\?"), r"\1loze?"),
    # дієслово на початку речення чи фрази: use your head, live with my parents
    (re.compile(r"(^|[.!?]\s+)([Uu])se (?!of\b)"), r"\1\2ze "),
    (re.compile(r"(^|[.!?]\s+)([Ll])ive (with|on|and|next|together|alone|apart|abroad|nearby|like|in|up|close|here|there|near)\b"), r"\1\2iv \3"),
    # lives після підмета: My family lives in Ukraine (espeak читає як множину від life)
    (re.compile(r"\blives (in|alone|with|next|near|on|abroad|nearby|miles|close|by|here|there|downstairs|upstairs|together|far|just|round|around|across|opposite|beside)\b"), r"livz \1"),
    # row = сварка, tear = рвати, wind someone up = дражнити
    (re.compile(r"\b(have|had|having) a (big |huge |massive |bit of a )?row\b"), r"\1 a \2rau"),
    (re.compile(r"\b([Tt])he row about\b"), r"\1he rau about"),
    (re.compile(r"\ba row with\b"), 'a rau with'),
    (re.compile(r"\btear (up|down|off|apart|open|it|the|a|your|my|his|her)\b"), r"tare \1"),
    (re.compile(r"\bwind (someone|me|him|her|them|us|you|the lads|the boss|everyone|people) up\b"), r"wined \1 up"),
    (re.compile(r"\bwound (someone|me|him|her|them|us|you|the lads|the boss|everyone) up\b"), r"wownd \1 up"),
]


def fix_text(text):
    for rx, rep in TEXT_FIXES:
        text = rx.sub(rep, text)
    return text


def load_js(files, name):
    """Виконує js-файли з public/ по черзі в одному контексті й повертає window[name]."""
    files = [files] if isinstance(files, str) else files
    paths = [os.path.join(PUBLIC, f) for f in files if os.path.exists(os.path.join(PUBLIC, f))]
    js = ("const fs=require('fs');const vm=require('vm');const c={window:{}};vm.createContext(c);"
          "const a=process.argv.slice(1);const name=a.pop();"
          "for(const f of a)vm.runInContext(fs.readFileSync(f,'utf8'),c);"
          "process.stdout.write(JSON.stringify(c.window[name]||null));")
    out = subprocess.run(['node', '-e', js] + paths + [name], check=True, capture_output=True, text=True).stdout
    return json.loads(out)


# v2: 96 kbps і інтонація завершеного речення для коротких фраз
def text_hash(text):
    return hashlib.sha1(('v2|' + text).encode('utf-8')).hexdigest()[:8]


def pack_hash(texts):
    return text_hash('pack|' + '\n'.join(texts))


def speak_text(text):
    """Окремі слова й короткі фрази без розділового знака читаються з інтонацією речення."""
    t = text.strip()
    if t and t[-1] not in '.!?…':
        t += '.'
    return t


def encode(samples, out_path):
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp:
        wav = tmp.name
    try:
        sf.write(wav, samples, SR)
        part = out_path + '.part.mp3'
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav, '-ac', '1', '-ar', str(SR),
                        '-c:a', 'libmp3lame', '-b:a', BITRATE, part], check=True)
        os.replace(part, out_path)
    finally:
        os.unlink(wav)


def decode(path):
    """mp3 -> float32 моно 24 кГц (для перепакування вже готових записів фраз)."""
    raw = subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', path, '-f', 'f32le', '-ac', '1', '-ar', str(SR), '-'],
                         check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()


class Speaker:
    def __init__(self, model, voices):
        self.k = Kokoro(model, voices)
        self.bath = {}
        for w in BATH_WORDS:
            ph = self.k.tokenizer.phonemize(w, 'en-gb').strip()
            fixed = re.sub(r'a(?![ɪʊ])', 'ɑː', ph, count=1)
            if fixed != ph:
                pattern = ''.join('[ˈˌ]?' if ch in 'ˈˌ' else re.escape(ch) for ch in ph)
                self.bath[w] = (re.compile(r'(?<![^\s.,!?;:"“”—-])' + pattern + r'(?![^\s.,!?;:"“”—-])'), fixed)

    def phonemes(self, text):
        ph = self.k.tokenizer.phonemize(fix_text(text), 'en-gb')
        low = text.lower()
        for w, (rx, fixed) in self.bath.items():
            if re.search(r'\b' + re.escape(w) + r'\b', low):
                ph = rx.sub(fixed, ph)
        return ph

    def synth(self, text, voice):
        ph = self.phonemes(speak_text(text))
        samples, sr = self.k.create(ph, voice=voice, speed=SPEED, lang='en-gb', is_phonemes=True)
        assert sr == SR, sr
        samples = np.asarray(samples, dtype=np.float32)
        peak = float(np.max(np.abs(samples))) or 1.0
        samples = samples / peak * 0.89
        return np.concatenate([np.zeros(int(SR * 0.08), np.float32), samples, np.zeros(int(SR * 0.15), np.float32)])

    def render(self, text, voice, out_path):
        encode(self.synth(text, voice), out_path)


def build_pack(speaker, voice, folder, wid, texts, out_path):
    """Фрази одним файлом: тиша, фраза, пауза, фраза... Повертає [[початок, кінець], ...]."""
    parts = [np.zeros(int(SR * PACK_EDGE), np.float32)]
    pos = len(parts[0])
    times = []
    for i, t in enumerate(texts):
        old = os.path.join(folder, f'{wid}-{text_hash(t)}.mp3')   # окремий запис зі старого формату
        seg = decode(old) if os.path.exists(old) else speaker.synth(t, voice)
        if i:
            gap = np.zeros(int(SR * PACK_GAP), np.float32)
            parts.append(gap)
            pos += len(gap)
        times.append([round(pos / SR, 2), round((pos + len(seg)) / SR, 2)])
        parts.append(seg)
        pos += len(seg)
    parts.append(np.zeros(int(SR * PACK_EDGE), np.float32))
    encode(np.concatenate(parts), out_path)
    return times


def write_manifest(manifest, pmanifest):
    path = os.path.join(PUBLIC, 'audio.js')
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as fh:
        fh.write('// Згенеровано tools/make_audio.py. Не редагувати вручну.\n')
        fh.write('// files: [слово, приклад 1, приклад 2]; phrases: [хеш файла фраз, [початок, кінець] для кожної фрази].\n')
        fh.write('window.AUDIO = ' + json.dumps({'voices': list(VOICES), 'files': manifest, 'phrases': pmanifest},
                                                 ensure_ascii=False, separators=(',', ':')) + ';\n')
    os.replace(tmp, path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--model', required=True)
    ap.add_argument('--voices', required=True)
    ap.add_argument('--only', help='через кому: id слів, які перегенерувати')
    ap.add_argument('--every', type=int, default=50, help='як часто (у словах) оновлювати audio.js')
    ap.add_argument('--no-new-phrases', action='store_true', help='спершу лише слова й приклади: нові файли фраз не створювати')
    args = ap.parse_args()

    words = load_js(['words.js', 'words-base.js'], 'WORDS')
    phrases = load_js(['phrases.js', 'phrases-base.js'], 'PHRASES') or {}
    prev = load_js('audio.js', 'AUDIO') if os.path.exists(os.path.join(PUBLIC, 'audio.js')) else None
    prev_phr = (prev or {}).get('phrases') or {}
    speaker = Speaker(args.model, args.voices)
    only = set(args.only.split(',')) if args.only else None
    name, voice = 'emma', VOICES['emma']
    folder = os.path.join(AUDIO_DIR, name)
    os.makedirs(folder, exist_ok=True)

    manifest, pmanifest, keep = {}, {}, set()
    done = 0
    for n, w in enumerate(words, 1):
        wid = w['id']
        force = bool(only and wid in only)
        texts = [w.get('say') or w['en'], w.get('sayEx') or w.get('ex') or '', w.get('sayEx2') or w.get('ex2') or '']
        hashes = [text_hash(t) if t else None for t in texts]
        ok = True
        for t, h in zip(texts, hashes):
            if not h:
                continue
            fname = f'{wid}-{h}.mp3'
            keep.add(fname)
            path = os.path.join(folder, fname)
            if not os.path.exists(path) or force:
                speaker.render(t, voice, path)
                done += 1
            ok = ok and os.path.exists(path)
        if ok:
            manifest[wid] = [h for h in hashes if h] if hashes[2] else [h for h in hashes[:2] if h]
        plist = [p[0] for p in (phrases.get(wid) or [])]
        if plist:
            ph = pack_hash(plist)
            fname = f'{wid}-p{ph}.mp3'
            keep.add(fname)
            path = os.path.join(folder, fname)
            old = prev_phr.get(wid)
            if os.path.exists(path) and not force and isinstance(old, list) and old and old[0] == ph:
                pmanifest[wid] = old
            elif args.no_new_phrases:
                pass
            else:
                times = build_pack(speaker, voice, folder, wid, plist, path)
                pmanifest[wid] = [ph] + times
                done += len(plist)
        if n % args.every == 0:
            write_manifest(manifest, pmanifest)
            print(f'{n}/{len(words)} слів, нових записів: {done}', flush=True)

    write_manifest(manifest, pmanifest)
    removed = 0
    for f in os.listdir(folder):
        if f.endswith('.mp3') and f not in keep:
            os.unlink(os.path.join(folder, f))
            removed += 1
    print(f'Готово. Нових записів: {done}, видалено старих файлів: {removed}, слів у маніфесті: {len(manifest)}, '
          f'файлів фраз: {len(pmanifest)}, усього файлів: {len(os.listdir(folder))}')


if __name__ == '__main__':
    sys.exit(main())

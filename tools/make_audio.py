#!/usr/bin/env python3
"""Генерує британські аудіо для слів і прикладів з public/words.js.

Голос: Kokoro TTS (Apache 2.0), британський жіночий bf_emma.
Потрібно: pip install kokoro-onnx soundfile, ffmpeg, node і файли моделі
kokoro-v1.0.onnx та voices-v1.0.bin з
https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0

Запуск:  python3 tools/make_audio.py --model PATH/kokoro-v1.0.onnx --voices PATH/voices-v1.0.bin
Генерує лише те, чого ще немає. Назва файлу містить хеш тексту, тож після
зміни слова чи прикладу запис оновиться сам. Записує public/audio.js.
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

# espeak-ng en-gb читає ці слова з коротким «a», як на півночі Англії.
# Для британської норми (RP) їм потрібне довге «ɑː».
BATH_WORDS = ['after', 'plaster', 'plasterboard', 'pass', 'ask', 'asked', 'last',
              'fast', 'class', 'glass', 'grass', 'path', 'bath', 'answer', 'example',
              'staff', 'dance', 'chance', 'plant', 'castle', 'laugh', 'aunt', 'branch',
              'master', 'disaster', 'afternoon', 'basket', 'task', 'mask', 'vast', 'past']


def load_js(file, name):
    js = ("const fs=require('fs');const vm=require('vm');const c={window:{}};"
          "vm.createContext(c);vm.runInContext(fs.readFileSync(process.argv[1],'utf8'),c);"
          "process.stdout.write(JSON.stringify(c.window[process.argv[2]]));")
    out = subprocess.run(['node', '-e', js, os.path.join(PUBLIC, file), name],
                         check=True, capture_output=True, text=True).stdout
    return json.loads(out)


def load_words():
    return load_js('words.js', 'WORDS')


def load_phrases():
    return load_js('phrases.js', 'PHRASES') if os.path.exists(os.path.join(PUBLIC, 'phrases.js')) else {}


# v2: 96 kbps і інтонація завершеного речення для коротких фраз
def text_hash(text):
    return hashlib.sha1(('v2|' + text).encode('utf-8')).hexdigest()[:8]


def speak_text(text):
    """Окремі слова й короткі фрази без розділового знака читаються з інтонацією речення."""
    t = text.strip()
    if t and t[-1] not in '.!?…':
        t += '.'
    return t


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
        ph = self.k.tokenizer.phonemize(text, 'en-gb')
        low = text.lower()
        for w, (rx, fixed) in self.bath.items():
            if re.search(r'\b' + re.escape(w) + r'\b', low):
                ph = rx.sub(fixed, ph)
        return ph

    def render(self, text, voice, out_path):
        ph = self.phonemes(speak_text(text))
        samples, sr = self.k.create(ph, voice=voice, speed=SPEED, lang='en-gb', is_phonemes=True)
        samples = np.asarray(samples, dtype=np.float32)
        peak = float(np.max(np.abs(samples))) or 1.0
        samples = samples / peak * 0.89
        pad_start = np.zeros(int(sr * 0.08), dtype=np.float32)
        pad_end = np.zeros(int(sr * 0.15), dtype=np.float32)
        samples = np.concatenate([pad_start, samples, pad_end])
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp:
            wav = tmp.name
        try:
            sf.write(wav, samples, sr)
            subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav, '-ac', '1', '-ar', str(SR),
                            '-c:a', 'libmp3lame', '-b:a', '96k', out_path], check=True)
        finally:
            os.unlink(wav)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--model', required=True)
    ap.add_argument('--voices', required=True)
    ap.add_argument('--only', help='через кому: id слів, які перегенерувати')
    args = ap.parse_args()

    words = load_words()
    phrases = load_phrases()
    speaker = Speaker(args.model, args.voices)
    only = set(args.only.split(',')) if args.only else None

    manifest = {}
    pmanifest = {}
    jobs = []
    for w in words:
        plist = phrases.get(w['id']) or []
        if plist:
            pmanifest[w['id']] = [text_hash(p[0]) for p in plist]
            for p, h in zip(plist, pmanifest[w['id']]):
                for name in VOICES:
                    jobs.append((name, f"{w['id']}-{h}.mp3", p[0], w['id']))
        word_text = w.get('say') or w['en']
        ex_text = w.get('sayEx') or w.get('ex') or ''
        ex2_text = w.get('sayEx2') or w.get('ex2') or ''
        hw = text_hash(word_text)
        hx = text_hash(ex_text) if ex_text else None
        hx2 = text_hash(ex2_text) if ex2_text else None
        manifest[w['id']] = [hw, hx, hx2] if hx2 else ([hw, hx] if hx else [hw])
        for name in VOICES:
            jobs.append((name, f"{w['id']}-{hw}.mp3", word_text, w['id']))
            if hx:
                jobs.append((name, f"{w['id']}-{hx}.mp3", ex_text, w['id']))
            if hx2:
                jobs.append((name, f"{w['id']}-{hx2}.mp3", ex2_text, w['id']))

    keep = {name: set() for name in VOICES}
    done = 0
    for name, fname, text, wid in jobs:
        keep[name].add(fname)
        folder = os.path.join(AUDIO_DIR, name)
        os.makedirs(folder, exist_ok=True)
        path = os.path.join(folder, fname)
        if os.path.exists(path) and not (only and wid in only):
            continue
        speaker.render(text, VOICES[name], path)
        done += 1
        if done % 25 == 0:
            print(f'{done} записів готово', flush=True)

    removed = 0
    for name in VOICES:
        folder = os.path.join(AUDIO_DIR, name)
        for f in os.listdir(folder):
            if f.endswith('.mp3') and f not in keep[name]:
                os.unlink(os.path.join(folder, f))
                removed += 1

    with open(os.path.join(PUBLIC, 'audio.js'), 'w', encoding='utf-8') as fh:
        fh.write('// Згенеровано tools/make_audio.py. Не редагувати вручну.\n')
        fh.write('window.AUDIO = ' + json.dumps({'voices': list(VOICES), 'files': manifest, 'phrases': pmanifest},
                                                 ensure_ascii=False, separators=(',', ':')) + ';\n')
    print(f'Нових записів: {done}, видалено старих: {removed}, слів у маніфесті: {len(manifest)}, фраз: {sum(len(v) for v in pmanifest.values())}')


if __name__ == '__main__':
    sys.exit(main())

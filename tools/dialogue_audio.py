#!/usr/bin/env python3
"""Озвучка діалогів: Chatterbox Turbo (Resemble AI, MIT) з ірландськими голосами з VCTK (CC BY 4.0).

Один файл на діалог: public/audio/dlg/<id>-<хеш>.mp3. Спершу всі репліки поспіль з природними паузами,
потім варіанти alt по черзі реплік, потім ключові фрази (той самий порядок, що C.dialogClips у core.js).
Маніфест: public/dialogue-audio.js, window.DLG_AUDIO[id] = [хеш, [початок, кінець], ...].

Кожен шматок перевіряє Whisper: якщо модель сказала не те (пропустила чи вигадала слова), шматок
генерується ще раз з іншим зерном, до 4 спроб, лишається найкращий.

Працює в GitHub Actions (.github/workflows/dialogue-audio.yml), бо моделі з Hugging Face, а з робочого
середовища Claude туди немає доступу. Локально теж можна:
  pip install chatterbox-tts faster-whisper huggingface_hub soundfile
  python3 tools/dialogue_audio.py            озвучити нові й змінені діалоги
  python3 tools/dialogue_audio.py --only id  переозвучити один
"""
import difflib, hashlib, json, os, re, subprocess, sys, tempfile, time

import numpy as np
import soundfile as sf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'dialogues')
OUT_DIR = os.path.join(ROOT, 'public', 'audio', 'dlg')
MANIFEST = os.path.join(ROOT, 'public', 'dialogue-audio.js')
VERSION = 'cbt1'                     # зміниться модель чи обробка — зміниться і хеш, усе переозвучиться
VOICES = {'m1': 'p245', 'm2': 'p298', 'f1': 'p288'}
GAP_TURN = 0.5       # пауза, коли говорить інший
GAP_SAME = 0.25      # та сама людина говорить далі
GAP_OTHER = 0.7      # між варіантами й фразами
EDGE = 0.3
PAD_IN, PAD_OUT = 0.06, 0.12
BITRATE = '48k'
TRIES = 4
GOOD = 0.9


def clips(d):
    you = next((k for k, r in d['roles'].items() if r.get('you')), 'b')
    out = [{'k': 'l', 'i': i, 's': l['s'], 'text': l.get('say') or l['en'], 'en': l['en']} for i, l in enumerate(d['lines'])]
    for i, l in enumerate(d['lines']):
        for j, a in enumerate(l.get('alt') or []):
            out.append({'k': 'a', 'i': i, 'j': j, 's': l['s'], 'text': a.get('say') or a['en'], 'en': a['en']})
    for i, p in enumerate(d.get('phrases') or []):
        out.append({'k': 'p', 'i': i, 's': you, 'text': p.get('say') or p['en'], 'en': p['en']})
    return out


def voice_of(d, c):
    return d['roles'][c['s']]['voice']


def dlg_hash(d):
    spoken = [[voice_of(d, c), c['text']] for c in clips(d)]
    return hashlib.sha1((VERSION + json.dumps(spoken, ensure_ascii=False)).encode('utf-8')).hexdigest()[:10]


def load_manifest():
    if not os.path.exists(MANIFEST):
        return {}
    s = open(MANIFEST, encoding='utf-8').read()
    m = re.search(r'window\.DLG_AUDIO\s*=\s*(\{.*\});', s, re.S)
    return json.loads(m.group(1)) if m else {}


def write_manifest(man):
    with open(MANIFEST, 'w', encoding='utf-8') as fh:
        fh.write('// Згенеровано tools/dialogue_audio.py. Не редагувати вручну.\n')
        fh.write('// DLG_AUDIO[id] = [хеш файла /audio/dlg/<id>-<хеш>.mp3, [початок, кінець] для кожного шматка з C.dialogClips]\n')
        fh.write('window.DLG_AUDIO = ' + json.dumps(man, separators=(',', ':')) + ';\n')


def words(s):
    return re.findall(r"[a-z0-9']+", s.lower().replace('’', "'"))


def similarity(c, got):
    g = words(got)
    return max(difflib.SequenceMatcher(None, words(t), g).ratio() for t in (c['text'], c['en']))


def speak_text(t):
    t = t.strip()
    return t if t[-1:] in '.!?…' else t + '.'


def trim(a, sr):
    """Обрізати тишу з країв (поріг відносно гучності), лишивши трохи повітря"""
    if not len(a):
        return a
    env = np.convolve(np.abs(a), np.ones(int(sr * 0.01)) / int(sr * 0.01), mode='same')
    thr = max(0.004, float(env.max()) * 0.03)
    idx = np.where(env > thr)[0]
    if not len(idx):
        return a
    s, e = max(0, idx[0] - int(sr * 0.03)), min(len(a), idx[-1] + int(sr * 0.06))
    return a[s:e]


def level(a):
    """Однакова гучність шматків: RMS близько −20 dBFS, піки не вище −1 dBFS"""
    rms = float(np.sqrt(np.mean(a ** 2))) or 1.0
    a = a * (0.1 / rms)
    peak = float(np.max(np.abs(a))) or 1.0
    return a * min(1.0, 0.89 / peak)


def encode(samples, sr, out_path):
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp:
        wav = tmp.name
    try:
        sf.write(wav, samples, sr)
        part = out_path + '.part.mp3'
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav, '-ac', '1', '-ar', str(sr),
                        '-c:a', 'libmp3lame', '-b:a', BITRATE, part], check=True)
        os.replace(part, out_path)
    finally:
        os.unlink(wav)


class Engine:
    def __init__(self):
        import torch
        from chatterbox.tts_turbo import ChatterboxTurboTTS
        from faster_whisper import WhisperModel
        from huggingface_hub import hf_hub_download
        self.torch = torch
        self.tts = ChatterboxTurboTTS.from_pretrained(device='cpu')
        self.sr = self.tts.sr
        self.asr = WhisperModel('small.en', device='cpu', compute_type='int8')
        self.refs = {v: hf_hub_download('kyutai/tts-voices', 'vctk/%s_023.wav' % p) for v, p in VOICES.items()}

    def hear(self, a):
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp:
            path = tmp.name
        try:
            sf.write(path, a, self.sr)
            segs, _ = self.asr.transcribe(path, beam_size=5, language='en')
            return ' '.join(s.text.strip() for s in segs)
        finally:
            os.unlink(path)

    def say(self, c, voice, seed):
        best = None
        for t in range(TRIES):
            self.torch.manual_seed(seed * 7 + t * 1009)
            wav = self.tts.generate(speak_text(c['text']), audio_prompt_path=self.refs[voice])
            a = trim(wav.squeeze(0).cpu().numpy().astype(np.float32), self.sr)
            got = self.hear(a)
            score = similarity(c, got)
            if best is None or score > best[0]:
                best = (score, a, got, t + 1)
            if score >= GOOD:
                break
        return best


def build(engine, d, h):
    sr = engine.sr
    cl = clips(d)
    parts, segs, pos = [np.zeros(int(sr * EDGE), np.float32)], [], int(sr * EDGE)
    weak = []
    for n, c in enumerate(cl):
        score, a, got, tries = engine.say(c, voice_of(d, c), n + 1)
        if score < GOOD:
            weak.append((n, round(score, 2), c['text'], got))
        print('  %2d/%d %s%s %.2f×%d %s' % (n + 1, len(cl), c['k'], c['i'], score, tries, c['text']), flush=True)
        a = np.concatenate([np.zeros(int(sr * PAD_IN), np.float32), level(a), np.zeros(int(sr * PAD_OUT), np.float32)])
        if n:
            prev = cl[n - 1]
            gap = (GAP_SAME if prev['s'] == c['s'] else GAP_TURN) if (c['k'] == 'l' and prev['k'] == 'l') else GAP_OTHER
            parts.append(np.zeros(int(sr * gap), np.float32))
            pos += int(sr * gap)
        segs.append([round(pos / sr, 2), round((pos + len(a)) / sr, 2)])
        parts.append(a)
        pos += len(a)
    parts.append(np.zeros(int(sr * EDGE), np.float32))
    os.makedirs(OUT_DIR, exist_ok=True)
    encode(np.concatenate(parts), sr, os.path.join(OUT_DIR, '%s-%s.mp3' % (d['id'], h)))
    for w in weak:
        print('  УВАГА: шматок %d схожість %.2f: %r → почуто %r' % w, flush=True)
    return [h] + segs


def main(argv):
    only = argv[argv.index('--only') + 1].split(',') if '--only' in argv else None
    order = json.load(open(os.path.join(SRC, '_order.json'), encoding='utf-8'))
    man = load_manifest()
    todo = []
    for did in order:
        d = json.load(open(os.path.join(SRC, did + '.json'), encoding='utf-8'))
        h = dlg_hash(d)
        old = man.get(did)
        have = old and old[0] == h and os.path.exists(os.path.join(OUT_DIR, '%s-%s.mp3' % (did, h))) and len(old) == len(clips(d)) + 1
        if not have or (only and did in only):
            todo.append((d, h))
    engine = Engine() if todo else None
    for d, h in todo:
        t0 = time.time()
        print('%s: %d шматків' % (d['id'], len(clips(d))), flush=True)
        man[d['id']] = build(engine, d, h)
        write_manifest({k: man[k] for k in order if k in man})   # проміжний стан теж придатний
        print('%s: готово за %d с' % (d['id'], time.time() - t0), flush=True)
    man = {k: man[k] for k in order if k in man}
    write_manifest(man)
    keep = {'%s-%s.mp3' % (k, v[0]) for k, v in man.items()}
    removed = 0
    if os.path.isdir(OUT_DIR):
        for f in os.listdir(OUT_DIR):
            if f.endswith('.mp3') and f not in keep:
                os.unlink(os.path.join(OUT_DIR, f))
                removed += 1
    print('Готово: озвучено %d, видалено старих %d, у маніфесті %d' % (len(todo), removed, len(man)))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))

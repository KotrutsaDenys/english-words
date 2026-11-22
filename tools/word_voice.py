#!/usr/bin/env python3
"""Озвучка слів ірландським голосом «Кіара»: Chatterbox Turbo (Resemble AI, MIT) за записом VCTK p288
(жінка з Дубліна, CC BY 4.0). Обрав Денис 22.11.2026 зі зразків (№ 6).

Один файл на слово: public/audio/ciara/<id>-c<хеш>.mp3 — слово, приклад 1, приклад 2, 5 фраз з паузами.
Маніфест: public/audio-ciara.js, window.AUDIO_CIARA[id] = [хеш, [початок, кінець] × 8] (той самий порядок,
що в AUDIO.one Емми, тож у застосунку oneOf / clipSeg / phraseTimes працюють без змін).
Кожен шматок перевіряє Whisper (до 3 спроб, для самого слова 2), як у діалогах (tools/dialogue_audio.py).

Працює в GitHub Actions (.github/workflows/word-voice.yml): 20 частин паралельно, кожна до ~5,5 год,
потім збирач зливає результат, комітить і, якщо слова лишилися, запускає себе ще раз.
  python3 tools/word_voice.py --shard 3 --of 20 --minutes 330 --out shard-out   частина 3 з 20
  python3 tools/word_voice.py --merge collected                                  злити частини
  python3 tools/word_voice.py --status                                           скільки лишилось
"""
import glob, hashlib, json, os, shutil, subprocess, sys, time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dialogue_audio as da  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC = os.path.join(ROOT, 'public')
OUT_DIR = os.path.join(PUBLIC, 'audio', 'ciara')
MANIFEST = os.path.join(PUBLIC, 'audio-ciara.js')
VOICE = 'f1'          # p288 у da.VOICES
VERSION = 'cb1'
BITRATE = '40k'
GAP, EDGE = 0.6, 0.3
# Написання, яке писали для espeak (Емма), Chatterbox читає гірше за звичайне
FIX = {'irish-cmere': ["C'mere", "C'mere, can you help me?", None]}


def load_js(files, var):
    code = ('global.window={};' + ''.join("try{require(%s)}catch(e){}" % json.dumps(os.path.join(PUBLIC, f)) for f in files)
            + 'process.stdout.write(JSON.stringify(window[%s]||null))' % json.dumps(var))
    return json.loads(subprocess.run(['node', '-e', code], check=True, capture_output=True, text=True).stdout)


def load_words():
    words = load_js(['words.js', 'words-base.js', 'words-more.js'], 'WORDS')
    phrases = load_js(['phrases.js', 'phrases-base.js', 'phrases-more.js'], 'PHRASES') or {}
    return words, phrases


def clips(w, phrases):
    said = [w.get('say') or w['en'], w.get('sayEx') or w.get('ex') or '', w.get('sayEx2') or w.get('ex2') or '']
    fix = FIX.get(w['id'])
    if fix:
        said = [f or o for f, o in zip(fix, said)]
    shown = [w['en'], w.get('ex') or '', w.get('ex2') or '']
    if not said[1] or not said[2]:
        return None                    # без двох прикладів порядок шматків інший — таке слово лишається Еммі
    out = [{'text': a, 'en': b, 'k': 'l', 'i': n, 's': 'a'} for n, (a, b) in enumerate(zip(said, shown))]
    for p in phrases.get(w['id']) or []:
        out.append({'text': p[0], 'en': p[0], 'k': 'p', 'i': len(out), 's': 'a'})
    return out


def whash(cl):
    return hashlib.sha1((VERSION + '|p288|' + json.dumps([c['text'] for c in cl], ensure_ascii=False)).encode('utf-8')).hexdigest()[:9]


def load_manifest():
    if not os.path.exists(MANIFEST):
        return {}
    s = open(MANIFEST, encoding='utf-8').read()
    i = s.find('{')
    return json.loads(s[i:s.rindex('}') + 1]) if i >= 0 else {}


def write_manifest(man):
    with open(MANIFEST, 'w', encoding='utf-8') as fh:
        fh.write('// Згенеровано tools/word_voice.py. Не редагувати вручну.\n')
        fh.write('// AUDIO_CIARA[id] = [хеш файла /audio/ciara/<id>-c<хеш>.mp3, [початок, кінець]: слово, приклад 1, приклад 2, фрази]\n')
        fh.write('window.AUDIO_CIARA = ' + json.dumps(man, separators=(',', ':')) + ';\n')


def todo_list(words, phrases, man):
    out = []
    for i, w in enumerate(words):
        cl = clips(w, phrases)
        if not cl:
            continue
        h = whash(cl)
        old = man.get(w['id'])
        if not (old and old[0] == h and len(old) == len(cl) + 1):
            out.append((i, w, cl, h))
    return out


def build(eng, cl, path):
    sr = eng.sr
    parts, segs, pos = [np.zeros(int(sr * EDGE), np.float32)], [], int(sr * EDGE)
    weak = []
    for n, c in enumerate(cl):
        score, a, got, tries = eng.say(c, VOICE, int(hashlib.md5(c['text'].encode('utf-8')).hexdigest()[:6], 16) % 9973 + n, tries=2 if n == 0 else 3)
        if score < da.GOOD:
            weak.append('%.2f %r → %r' % (score, c['text'], got))
        a = np.concatenate([np.zeros(int(sr * da.PAD_IN), np.float32), da.level(a), np.zeros(int(sr * da.PAD_OUT), np.float32)])
        if n:
            parts.append(np.zeros(int(sr * GAP), np.float32))
            pos += int(sr * GAP)
        segs.append([round(pos / sr, 2), round((pos + len(a)) / sr, 2)])
        parts.append(a)
        pos += len(a)
    parts.append(np.zeros(int(sr * EDGE), np.float32))
    old = da.BITRATE
    da.BITRATE = BITRATE
    try:
        da.encode(np.concatenate(parts), sr, path)
    finally:
        da.BITRATE = old
    return segs, weak


def run_shard(k, n, minutes, out, limit=0):
    t0 = time.time()
    words, phrases = load_words()
    man = load_manifest()
    todo = [x for x in todo_list(words, phrases, man) if x[0] % n == k]
    if limit:
        todo = todo[:limit]
    print('частина %d з %d: %d слів' % (k, n, len(todo)), flush=True)
    os.makedirs(os.path.join(out, 'files'), exist_ok=True)
    part_path = os.path.join(out, 'manifest-%d.json' % k)
    part = {}
    if not todo:
        json.dump(part, open(part_path, 'w'))
        return 0
    eng = da.Engine()
    for j, (_, w, cl, h) in enumerate(todo):
        if minutes and time.time() - t0 > minutes * 60:
            print('ЧАС ВИЙШОВ: зроблено %d з %d' % (j, len(todo)), flush=True)
            break
        ts = time.time()
        segs, weak = build(eng, cl, os.path.join(out, 'files', '%s-c%s.mp3' % (w['id'], h)))
        part[w['id']] = [h] + segs
        print('%4d/%d %s %.0f с%s' % (j + 1, len(todo), w['id'], time.time() - ts, ('  УВАГА: ' + ' | '.join(weak)) if weak else ''), flush=True)
        if len(part) % 5 == 0:
            json.dump(part, open(part_path, 'w'))
    json.dump(part, open(part_path, 'w'))
    print('готово: %d слів за %d хв' % (len(part), (time.time() - t0) / 60), flush=True)
    return 0


def merge(src):
    words, phrases = load_words()
    man = load_manifest()
    before = len(man)
    os.makedirs(OUT_DIR, exist_ok=True)
    for f in glob.glob(os.path.join(src, '**', '*.mp3'), recursive=True):
        shutil.copy2(f, os.path.join(OUT_DIR, os.path.basename(f)))
    for f in sorted(glob.glob(os.path.join(src, '**', 'manifest-*.json'), recursive=True)):
        for wid, v in json.load(open(f)).items():
            if os.path.exists(os.path.join(OUT_DIR, '%s-c%s.mp3' % (wid, v[0]))):
                man[wid] = v
    ids = {w['id'] for w in words}
    man = {k: v for k, v in man.items() if k in ids and os.path.exists(os.path.join(OUT_DIR, '%s-c%s.mp3' % (k, v[0])))}
    keep = {'%s-c%s.mp3' % (k, v[0]) for k, v in man.items()}
    removed = 0
    for f in os.listdir(OUT_DIR):
        if f.endswith('.mp3') and f not in keep:
            os.unlink(os.path.join(OUT_DIR, f))
            removed += 1
    write_manifest(man)
    left = len(todo_list(words, phrases, man))
    print('злито: було %d, стало %d, видалено старих %d, лишилось %d' % (before, len(man), removed, left))
    gh = os.environ.get('GITHUB_OUTPUT')
    if gh:
        with open(gh, 'a') as fh:
            fh.write('remaining=%d\nadded=%d\n' % (left, len(man) - before))
    return 0


def main(argv):
    if '--merge' in argv:
        return merge(argv[argv.index('--merge') + 1])
    if '--status' in argv:
        words, phrases = load_words()
        man = load_manifest()
        print('озвучено %d, лишилось %d' % (len(man), len(todo_list(words, phrases, man))))
        return 0
    k = int(argv[argv.index('--shard') + 1])
    n = int(argv[argv.index('--of') + 1])
    minutes = float(argv[argv.index('--minutes') + 1]) if '--minutes' in argv else 0
    out = argv[argv.index('--out') + 1] if '--out' in argv else 'shard-out'
    limit = int(argv[argv.index('--limit') + 1]) if '--limit' in argv else 0
    return run_shard(k, n, minutes, out, limit)


if __name__ == '__main__':
    sys.exit(main(sys.argv))

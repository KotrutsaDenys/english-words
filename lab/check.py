# Розпізнає кожен зразок Whisper-ом: чи модель сказала саме те, що треба, без пропусків і вигадок
import glob, json, os, re
from faster_whisper import WhisperModel
from common import T, OUT
m = WhisperModel('small.en', device='cpu', compute_type='int8')
want = ' '.join(T)
norm = lambda s: re.findall(r"[a-z']+", s.lower())
rep = []
for f in sorted(glob.glob(os.path.join(OUT, '*.mp3'))):
    segs, _ = m.transcribe(f, beam_size=5)
    got = ' '.join(s.text.strip() for s in segs)
    a, b = norm(want), norm(got)
    miss = [w for w in a if w not in b]
    extra = [w for w in b if w not in a]
    rep.append(f'{os.path.basename(f)}\n  {got}\n  missing: {miss}  extra: {extra}')
open(os.path.join(OUT, 'report.txt'), 'w').write('\n'.join(rep) + '\n')
print('\n'.join(rep))

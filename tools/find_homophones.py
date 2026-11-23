"""Омофони в словнику (week / weak, sea / see): слова, що звучать однаково.
Їх не можна ставити варіантами в одному тесті на слух, а в диктанті треба показувати значення.

Запуск після нової порції словника:
    pip install --break-system-packages cmudict kokoro-onnx phonemizer
    python3 tools/find_homophones.py
і вставити надрукований HOMOPHONES у public/js/core.js замість старого.
Вимова британська (espeak en-gb) плюс американська (CMU): збіг у будь-якій — омофони."""
import json, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JS = r"""
global.window = global; const P = process.argv[1] + '/public/';
for (const f of ['words.js', 'words-base.js', 'words-more.js']) require(P + f);
const C = require(P + 'js/core.js');
console.log(JSON.stringify(window.WORDS.map(w => [w.id, C.baseForm(w), w.say || ''])));
"""
words = json.loads(subprocess.check_output(['node', '-e', JS, ROOT]))
single = [(i, h.lower(), say) for i, h, say in words if re.fullmatch(r"[A-Za-z']+", h)]

import cmudict
import espeakng_loader
from phonemizer.backend.espeak.wrapper import EspeakWrapper
EspeakWrapper.set_library(espeakng_loader.get_library_path())
EspeakWrapper.set_data_path(espeakng_loader.get_data_path())
from phonemizer import phonemize

cmu = cmudict.dict()
ph = phonemize([say or h for _, h, say in single], language='en-gb', backend='espeak', strip=True,
               preserve_punctuation=False, with_stress=False, njobs=1)
groups = {}
for (i, h, _), p in zip(single, ph):
    groups.setdefault('gb:' + p.strip(), []).append((h, i))
    for pr in cmu.get(h, [])[:1]:
        groups.setdefault('us:' + ' '.join(re.sub(r'\d', '', x) for x in pr), []).append((h, i))
# Не омофони, хоч транскрипції близькі
SKIP = {frozenset({'addition', 'edition'})}
found = set()
for g in groups.values():
    by_head = {}
    for h, i in g:
        by_head.setdefault(h, i)
    if len(by_head) > 1 and frozenset(by_head) not in SKIP:
        found.add(tuple(sorted(by_head.items())))
items = ['[' + ', '.join("'" + i + "'" for _, i in g) + ']' for g in sorted(found)]
out, line = '  const HOMOPHONES = [\n', '   '
for it in items:
    if len(line) + len(it) + 2 > 128:
        out += line + '\n'
        line = '   '
    line += ' ' + it + ','
out += line.rstrip(',') + '\n  ];'
print(out)
print(f'// груп: {len(items)}', file=sys.stderr)

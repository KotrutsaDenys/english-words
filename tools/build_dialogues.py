#!/usr/bin/env python3
"""Діалоги: перевіряє dialogues/<id>.json і збирає їх у public/dialogues.js.

  python3 tools/build_dialogues.py                 перевірити й зібрати
  python3 tools/build_dialogues.py --check a.json  лише перевірити вказані файли

Формат описано в dialogues/README.md.
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'dialogues')
OUT = os.path.join(ROOT, 'public', 'dialogues.js')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_grammar import RUSSISMS, RU_LETTERS, CYR  # noqa: E402

LEVELS = {'A1', 'A2', 'B1', 'B2'}
ICONS = {'plane', 'cup', 'house', 'cart', 'doctor', 'phone', 'bed', 'pint', 'car', 'scissors', 'bag', 'key', 'map', 'helmet', 'pill', 'bank', 'bus', 'chat'}
VOICES = {'m1', 'm2', 'f1'}
ID_RX = re.compile(r'^[a-z0-9]+(-[a-z0-9]+)*$')


def check(path, expected_id=None):
    errs = []
    try:
        with open(path, encoding='utf-8') as fh:
            d = json.load(fh)
    except Exception as e:
        return None, ['не читається JSON: %s' % e]
    err = errs.append

    def uk_text(where, s, required=True):
        if not isinstance(s, str) or not s.strip():
            if required:
                err('%s: порожній український текст' % where)
            return
        if not CYR.search(s):
            err('%s: має бути українською: %r' % (where, s))
        if RU_LETTERS.search(s):
            err('%s: російські літери: %r' % (where, s))
        for rx in RUSSISMS:
            if re.search(rx, s, re.I):
                err('%s: схоже на русизм (%s): %r' % (where, rx, s))
        if '  ' in s or s != s.strip():
            err('%s: зайві пробіли: %r' % (where, s))

    def en_text(where, s, required=True):
        if not isinstance(s, str) or not s.strip():
            if required:
                err('%s: порожній англійський текст' % where)
            return
        if CYR.search(s):
            err('%s: кирилиця в англійському тексті: %r' % (where, s))
        if '  ' in s or s != s.strip():
            err('%s: зайві пробіли: %r' % (where, s))
        if "'" in s and '’' in s:
            err('%s: апострофи різні: %r' % (where, s))

    did = d.get('id')
    if not isinstance(did, str) or not ID_RX.match(did):
        err('id: латиницею через дефіс')
    if expected_id and did != expected_id:
        err('id %r не збігається з іменем файла %r' % (did, expected_id))
    en_text('title', d.get('title'))
    for k in ('uk', 'place', 'scene', 'goal'):
        uk_text(k, d.get(k))
    if d.get('icon') not in ICONS:
        err('icon: один з %s' % sorted(ICONS))
    if d.get('level') not in LEVELS:
        err('level: один з %s' % sorted(LEVELS))
    if not isinstance(d.get('minutes'), int) or not 2 <= d['minutes'] <= 20:
        err('minutes: ціле 2–20')

    roles = d.get('roles')
    if not isinstance(roles, dict) or set(roles) != {'a', 'b'}:
        err('roles: рівно дві ролі, a і b')
        roles = {}
    yous = [k for k, r in roles.items() if isinstance(r, dict) and r.get('you')]
    if len(yous) != 1:
        err('roles: рівно одна роль з "you": true')
    for k, r in roles.items():
        if not isinstance(r, dict):
            err('roles.%s: об\'єкт' % k)
            continue
        en_text('roles.%s.en' % k, r.get('en'))
        uk_text('roles.%s.uk' % k, r.get('uk'))
        if r.get('voice') not in VOICES:
            err('roles.%s.voice: один з %s' % (k, sorted(VOICES)))
    if roles and isinstance(roles.get('a'), dict) and isinstance(roles.get('b'), dict) and roles['a'].get('voice') == roles['b'].get('voice'):
        err('roles: у ролей мають бути різні голоси')

    phrases = d.get('phrases')
    if not isinstance(phrases, list) or not 6 <= len(phrases) <= 10:
        err('phrases: 6–10 ключових фраз')
        phrases = []
    for i, p in enumerate(phrases):
        if not isinstance(p, dict):
            err('phrases[%d]: об\'єкт' % i)
            continue
        en_text('phrases[%d].en' % i, p.get('en'))
        uk_text('phrases[%d].uk' % i, p.get('uk'))
        uk_text('phrases[%d].note' % i, p.get('note'), False)
        extra = set(p) - {'en', 'uk', 'note', 'say'}
        if extra:
            err('phrases[%d]: невідомі поля %s' % (i, sorted(extra)))

    lines = d.get('lines')
    if not isinstance(lines, list) or not 14 <= len(lines) <= 24:
        err('lines: 14–24 репліки')
        lines = []
    seen_uk = {}
    per_role = {'a': 0, 'b': 0}
    for i, ln in enumerate(lines):
        w = 'lines[%d]' % i
        if not isinstance(ln, dict):
            err(w + ': об\'єкт')
            continue
        if ln.get('s') not in ('a', 'b'):
            err(w + '.s: a або b')
        else:
            per_role[ln['s']] += 1
        en_text(w + '.en', ln.get('en'))
        en_text(w + '.say', ln.get('say'), False)
        uk_text(w + '.uk', ln.get('uk'))
        uk_text(w + '.note', ln.get('note'), False)
        extra = set(ln) - {'s', 'en', 'uk', 'say', 'alt', 'note'}
        if extra:
            err(w + ': невідомі поля %s' % sorted(extra))
        u = (ln.get('uk') or '').strip().lower()
        if u in seen_uk:
            err(w + '.uk: такий самий переклад, як у lines[%d]' % seen_uk[u])
        seen_uk[u] = i
        alt = ln.get('alt', [])
        if not isinstance(alt, list) or len(alt) > 3:
            err(w + '.alt: список до 3 варіантів')
            alt = []
        for j, a in enumerate(alt):
            if not isinstance(a, dict):
                err('%s.alt[%d]: об\'єкт' % (w, j))
                continue
            en_text('%s.alt[%d].en' % (w, j), a.get('en'))
            en_text('%s.alt[%d].say' % (w, j), a.get('say'), False)
            uk_text('%s.alt[%d].uk' % (w, j), a.get('uk'))
            if (a.get('en') or '').strip().lower() == (ln.get('en') or '').strip().lower():
                err('%s.alt[%d]: варіант збігається з реплікою' % (w, j))
            extra = set(a) - {'en', 'uk', 'say'}
            if extra:
                err('%s.alt[%d]: невідомі поля %s' % (w, j, sorted(extra)))
        if re.search(r'\d', ln.get('en') or '') and not ln.get('say'):
            err(w + ': у репліці цифри — додай "say" зі словами, як читати вголос')
    for k, n in per_role.items():
        if lines and n < 6:
            err('у ролі %s лише %d реплік, треба щонайменше 6' % (k, n))
    tips = d.get('tips')
    if not isinstance(tips, list) or not 2 <= len(tips) <= 4:
        err('tips: 2–4 пункти')
        tips = []
    for i, t in enumerate(tips):
        uk_text('tips[%d]' % i, t)
    known = {'id', 'title', 'uk', 'icon', 'level', 'minutes', 'place', 'scene', 'goal', 'roles', 'phrases', 'lines', 'tips'}
    extra = set(d) - known
    if extra:
        err('невідомі поля: %s' % sorted(extra))
    return d, errs


def main(argv):
    if len(argv) > 1 and argv[1] == '--check':
        bad = 0
        for p in argv[2:]:
            _, errs = check(p, os.path.splitext(os.path.basename(p))[0])
            for e in errs:
                print('%s: %s' % (p, e))
            bad += len(errs)
        print('OK' if not bad else 'помилок: %d' % bad)
        return 1 if bad else 0
    order = json.load(open(os.path.join(SRC, '_order.json'), encoding='utf-8'))
    files = sorted(f[:-5] for f in os.listdir(SRC) if f.endswith('.json') and not f.startswith('_'))
    missing = [i for i in order if i not in files]
    unlisted = [f for f in files if f not in order]
    bad = 0
    for i in missing:
        print('_order.json: немає файла dialogues/%s.json' % i)
        bad += 1
    for f in unlisted:
        print('dialogues/%s.json: немає в _order.json' % f)
        bad += 1
    if len(set(order)) != len(order):
        print('_order.json: повтори')
        bad += 1
    items = {}
    for i in order:
        if i in missing:
            continue
        d, errs = check(os.path.join(SRC, i + '.json'), i)
        for e in errs:
            print('dialogues/%s.json: %s' % (i, e))
        bad += len(errs)
        if d is not None:
            items[i] = d
    if bad:
        print('помилок: %d, public/dialogues.js не змінено' % bad)
        return 1
    body = json.dumps({'order': order, 'items': items}, ensure_ascii=False, separators=(',', ':'))
    with open(OUT, 'w', encoding='utf-8') as fh:
        fh.write('// Згенеровано tools/build_dialogues.py з dialogues/*.json. Не редагувати вручну.\n')
        fh.write('window.DIALOGS = ' + body + ';\n')
    n = sum(len(d['lines']) for d in items.values())
    print('public/dialogues.js: діалогів %d, реплік %d' % (len(items), n))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))

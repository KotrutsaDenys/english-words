#!/usr/bin/env python3
"""Посібник з граматики: перевіряє теми grammar/<id>.json і збирає їх у public/grammar.js.

  python3 tools/build_grammar.py                 зібрати все, що є (відсутні теми лише попередження)
  python3 tools/build_grammar.py --strict        зібрати, і відсутня тема теж помилка
  python3 tools/build_grammar.py --check a.json  лише перевірити вказані файли

Формат теми описано в grammar/README.md.
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'grammar')
OUT = os.path.join(ROOT, 'public', 'grammar.js')

LEVELS = {'A1', 'A2', 'B1', 'B2'}
# Банк завдань теми: тест щоразу бере з нього 12. Перехідний період: 12 або 24, потім лише 24
TASK_COUNTS = (24,) if os.environ.get('GRAMMAR_FINAL') else (12, 24)
STRICT_KEY = bool(os.environ.get('GRAMMAR_FINAL'))
BLOCKS = {'p', 'h', 'rule', 'table', 'ex', 'tip', 'mistake', 'list'}
CYR = re.compile(r'[А-Яа-яІіЇїЄєҐґ]')
RU_LETTERS = re.compile(r'[ЫыЭэЪъЁё]')
# Часті русизми в поясненнях
RUSSISMS = [r"(?<![\w'’ʼ])являєт", r"(?<![\w'’ʼ])являют", r"(?<![\w'’ʼ])являти(?:ся)?\b", r'слідуюч', r'на протязі', r'приймати участь', r'приймає участь',
            r'співпада', r'не дивлячись на', r'в залежності', r'у залежності', r'по відношенню', r'міроприємств', r'\bучбов',
            r'\bвірн(?:ий|а|е|і|о|ого|ому|им|их)\b', r'вибачаюсь', r'одинаков', r'\bсамий \w+ш(?:ий|а|е|і)\b', r'\bприймати до уваги',
            r'\bна рахунок\b', r'\bдякуючи\b', r'\bвиключення\b', r'\bзнаходиться\b', r'\bзнаходяться\b',
            r'\bтим не менше\b', r'\bслідує\b', r'\bслідуєт']


def strip_bold(s):
    return s.replace('**', '')


def en_tokens(s):
    s = strip_bold(s).replace('’', "'")
    return [t.lower() for t in re.findall(r"[A-Za-z0-9][A-Za-z0-9'\-]*", s)]


def check_topic(path, expected_id=None):
    errs = []
    try:
        with open(path, encoding='utf-8') as fh:
            t = json.load(fh)
    except Exception as e:
        return None, ['не читається JSON: %s' % e]
    if not isinstance(t, dict):
        return None, ['тема має бути об\'єктом JSON']

    def err(msg):
        errs.append(msg)

    def uk_text(where, s, need_cyr=True):
        if not isinstance(s, str) or not s.strip():
            err('%s: порожній текст' % where); return
        if s.count('**') % 2:
            err('%s: непарні ** у «%s»' % (where, s[:60]))
        if need_cyr and not CYR.search(s):
            err('%s: немає українського тексту: «%s»' % (where, s[:60]))
        if RU_LETTERS.search(s):
            err('%s: російські літери: «%s»' % (where, s[:60]))
        low = s.lower()
        for rx in RUSSISMS:
            m = re.search(rx, low)
            if m:
                err('%s: русизм «%s» у «%s»' % (where, m.group(0), s[:80]))

    def en_text(where, s, allow_empty=False):
        if not isinstance(s, str) or (not s.strip() and not allow_empty):
            err('%s: порожній англійський текст' % where); return
        if CYR.search(s):
            err('%s: кирилиця в англійському тексті: «%s»' % (where, s[:60]))
        if s.count('**') % 2:
            err('%s: непарні ** у «%s»' % (where, s[:60]))

    tid = t.get('id')
    if expected_id and tid != expected_id:
        err('id «%s» не збігається з назвою файла «%s»' % (tid, expected_id))
    if not isinstance(tid, str) or not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', tid or ''):
        err('id має бути латиницею через дефіс')
    if t.get('level') not in LEVELS:
        err('level має бути одним з %s' % sorted(LEVELS))
    title = t.get('title')
    if not isinstance(title, str) or not title or len(title) > 42:
        err('title обов\'язковий, до 42 символів')
    uk_text('uk', t.get('uk', ''))
    if len(t.get('uk', '')) > 60:
        err('uk (назва українською) довша за 60 символів')
    uk_text('summary', t.get('summary', ''))
    if len(t.get('summary', '')) > 70:
        err('summary довший за 70 символів')
    if not isinstance(t.get('minutes'), int) or not 2 <= t['minutes'] <= 20:
        err('minutes: ціле число 2..20')

    blocks = t.get('blocks')
    if not isinstance(blocks, list) or not 6 <= len(blocks) <= 40:
        err('blocks: від 6 до 40 блоків'); blocks = blocks if isinstance(blocks, list) else []
    n_ex = n_mistake = 0
    for i, b in enumerate(blocks):
        w = 'blocks[%d]' % i
        bt = b.get('t') if isinstance(b, dict) else None
        if bt not in BLOCKS:
            err('%s: невідомий тип блока %r' % (w, bt)); continue
        if bt in ('p', 'h', 'tip'):
            uk_text(w, b.get('text'))
            if bt == 'h' and len(b.get('text', '')) > 60:
                err('%s: заголовок довший за 60 символів' % w)
        elif bt == 'list':
            items = b.get('items')
            if not isinstance(items, list) or not 1 <= len(items) <= 12:
                err('%s: list.items від 1 до 12' % w); continue
            for k, it in enumerate(items):
                if not isinstance(it, str) or not it.strip():
                    err('%s.items[%d]: порожньо' % (w, k))
                elif it.count('**') % 2:
                    err('%s.items[%d]: непарні **' % (w, k))
        elif bt == 'rule':
            if b.get('title') is not None:
                uk_text(w + '.title', b['title'])
            lines = b.get('lines')
            if not isinstance(lines, list) or not 1 <= len(lines) <= 10:
                err('%s: rule.lines від 1 до 10' % w); continue
            for k, ln in enumerate(lines):
                if not isinstance(ln, str) or not ln.strip() or ln.count('**') % 2:
                    err('%s.lines[%d]: порожньо або непарні **' % (w, k))
                elif len(strip_bold(ln)) > 60:
                    err('%s.lines[%d]: довше 60 символів (не влізе на телефон): «%s»' % (w, k, ln))
        elif bt == 'table':
            head, rows = b.get('head'), b.get('rows')
            if not isinstance(head, list) or not 2 <= len(head) <= 4:
                err('%s: table.head від 2 до 4 колонок' % w); continue
            if not isinstance(rows, list) or not 1 <= len(rows) <= 16:
                err('%s: table.rows від 1 до 16' % w); continue
            for k, r in enumerate(rows):
                if not isinstance(r, list) or len(r) != len(head):
                    err('%s.rows[%d]: кількість клітинок не як у head' % (w, k)); continue
                for c in r:
                    if not isinstance(c, str) or c.count('**') % 2:
                        err('%s.rows[%d]: клітинка не рядок або непарні **' % (w, k))
                    elif len(strip_bold(c)) > 34:
                        err('%s.rows[%d]: клітинка довша за 34 символи: «%s»' % (w, k, c))
        elif bt == 'ex':
            items = b.get('items')
            if not isinstance(items, list) or not 1 <= len(items) <= 8:
                err('%s: ex.items від 1 до 8' % w); continue
            for k, it in enumerate(items):
                if not isinstance(it, list) or len(it) != 2:
                    err('%s.items[%d]: має бути [англійською, українською]' % (w, k)); continue
                en_text('%s.items[%d][0]' % (w, k), it[0])
                uk_text('%s.items[%d][1]' % (w, k), it[1])
                n_ex += 1
        elif bt == 'mistake':
            en_text(w + '.wrong', b.get('wrong'))
            en_text(w + '.right', b.get('right'))
            uk_text(w + '.why', b.get('why'))
            if b.get('wrong') == b.get('right'):
                err('%s: wrong і right однакові' % w)
            n_mistake += 1
    if n_ex < 6:
        err('прикладів (ex) замало: %d, треба щонайменше 6' % n_ex)
    if n_mistake < 1:
        err('потрібен хоча б один блок mistake з типовою помилкою')

    # «Головне»: 3–5 найважливіших правил теми, шпаргалка зверху сторінки й у тесті
    key = t.get('key')
    if key is None and STRICT_KEY:
        err('key: потрібно 3–5 головних правил (шпаргалка)')
    elif key is not None:
        if not isinstance(key, list) or not 3 <= len(key) <= 5:
            err('key: від 3 до 5 пунктів')
        else:
            for k, it in enumerate(key):
                uk_text('key[%d]' % k, it)
                if isinstance(it, str) and len(strip_bold(it)) > 170:
                    err('key[%d]: довше 170 символів — це шпаргалка, коротше' % k)
    tasks = t.get('tasks')
    if not isinstance(tasks, list) or len(tasks) not in TASK_COUNTS:
        err('tasks: має бути %s завдань (банк, з якого тест бере 12)' % ' або '.join(map(str, TASK_COUNTS))); tasks = tasks if isinstance(tasks, list) else []
    kinds = {'choice': 0, 'input': 0, 'order': 0}
    seen_q = set()
    for i, x in enumerate(tasks):
        w = 'tasks[%d]' % i
        ty = x.get('type') if isinstance(x, dict) else None
        if ty not in kinds:
            err('%s: type має бути choice, input або order' % w); continue
        kinds[ty] += 1
        if x.get('task') is not None:
            uk_text(w + '.task', x['task'])
        if x.get('uk') is not None:
            uk_text(w + '.uk', x['uk'])
        why = x.get('why')
        uk_text(w + '.why', why)
        if isinstance(why, str) and len(why) > 230:
            err('%s.why довше 230 символів (не влізе в нижню панель)' % w)
        q = x.get('q', '')
        key = (ty, q, json.dumps(x.get('words')), '' if q else json.dumps(x.get('opts'), ensure_ascii=False))
        if key in seen_q:
            err('%s: таке саме завдання вже є' % w)
        seen_q.add(key)
        if ty == 'choice':
            en_text(w + '.q', q, allow_empty=bool(x.get('task')))
            if q.count('___') > 1:
                err('%s: у q більше одного пропуску ___' % w)
            if not q.strip() and not x.get('task'):
                err('%s: без q потрібне task (питання українською)' % w)
            opts = x.get('opts')
            if not isinstance(opts, list) or not 2 <= len(opts) <= 4 or any(not isinstance(o, str) or not o.strip() for o in opts):
                err('%s: opts від 2 до 4 непорожніх рядків' % w); continue
            if len(set(o.strip().lower() for o in opts)) != len(opts):
                err('%s: однакові варіанти' % w)
            a = x.get('a')
            if not isinstance(a, int) or not 0 <= a < len(opts):
                err('%s: a має бути номером правильного варіанта (з 0)' % w)
            for o in opts:
                if '**' in o:
                    err('%s: ** у варіантах не потрібні' % w)
        elif ty == 'input':
            en_text(w + '.q', q)
            if q.count('___') != 1:
                err('%s: у q має бути рівно один пропуск ___' % w)
            a = x.get('a')
            if not isinstance(a, list) or not a or any(not isinstance(s, str) or not s.strip() or CYR.search(s) for s in a):
                err('%s: a — список правильних відповідей англійською' % w)
            if not x.get('uk'):
                err('%s: для input потрібен uk (переклад речення)' % w)
        elif ty == 'order':
            words = x.get('words')
            a = x.get('a')
            if isinstance(a, str):
                a = [a]
            if not isinstance(words, list) or not 3 <= len(words) <= 10 or any(not isinstance(s, str) or not s.strip() for s in words):
                err('%s: words від 3 до 10 слів' % w); continue
            if not isinstance(a, list) or not a:
                err('%s: a — правильне речення (або список варіантів)' % w); continue
            if not x.get('uk'):
                err('%s: для order потрібен uk (що скласти)' % w)
            ws = sorted(en_tokens(' '.join(words)))
            if len(ws) != len(words):
                err('%s: кожен елемент words має бути одним словом без розділових знаків' % w)
            for s in a:
                en_text(w + '.a', s)
                if sorted(en_tokens(s)) != ws:
                    err('%s: відповідь «%s» складається не з тих самих слів, що words' % (w, s))
    scale = len(tasks) // 12 or 1
    if tasks and (kinds['choice'] < 4 * scale or kinds['input'] < 3 * scale or not scale <= kinds['order'] <= 3 * scale):
        err('суміш завдань: choice ≥ %d, input ≥ %d, order %d–%d (зараз %s)' % (4 * scale, 3 * scale, scale, 3 * scale, kinds))
    return t, errs


def main():
    args = sys.argv[1:]
    if args and args[0] == '--check':
        bad = 0
        for p in args[1:]:
            _, errs = check_topic(p, os.path.splitext(os.path.basename(p))[0])
            print(('OK  ' if not errs else 'ПОМИЛКИ  ') + p)
            for e in errs:
                print('   - ' + e)
            bad += bool(errs)
        sys.exit(1 if bad else 0)
    strict = '--strict' in args
    with open(os.path.join(SRC, '_sections.json'), encoding='utf-8') as fh:
        sections = json.load(fh)
    topics, out_sections, problems, missing = {}, [], 0, []
    all_ids = [tid for s in sections for tid in s['topics']]
    if len(set(all_ids)) != len(all_ids):
        print('у _sections.json є повтори'); sys.exit(1)
    for s in sections:
        ids = []
        for tid in s['topics']:
            path = os.path.join(SRC, tid + '.json')
            if not os.path.exists(path):
                missing.append(tid); continue
            t, errs = check_topic(path, tid)
            if errs:
                problems += 1
                print('ПОМИЛКИ  ' + path)
                for e in errs:
                    print('   - ' + e)
                continue
            t['section'] = s['id']
            topics[tid] = t
            ids.append(tid)
        if ids:
            out_sections.append({'id': s['id'], 'title': s['title'], 'topics': ids})
    extra = [f[:-5] for f in os.listdir(SRC) if f.endswith('.json') and not f.startswith('_') and f[:-5] not in all_ids]
    for e in extra:
        print('файл не вказано в _sections.json: %s' % e); problems += 1
    if missing:
        print(('ПОМИЛКА' if strict else 'увага') + ': ще немає тем: ' + ', '.join(missing))
    if problems or (strict and missing):
        sys.exit(1)
    data = {'sections': out_sections, 'topics': topics}
    with open(OUT, 'w', encoding='utf-8') as fh:
        fh.write('// Згенеровано tools/build_grammar.py з grammar/*.json. Не редагувати вручну.\n')
        fh.write('window.GRAMMAR = ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n')
    n_tasks = sum(len(t['tasks']) for t in topics.values())
    print('public/grammar.js: %d тем, %d завдань, %d КБ' % (len(topics), n_tasks, os.path.getsize(OUT) // 1024))


if __name__ == '__main__':
    main()

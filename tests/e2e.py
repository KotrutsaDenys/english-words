"""Наскрізна перевірка в браузері: python3 tests/e2e.py [папка_для_скріншотів]
Проходить кілька днів навчання ботом, перевіряє кожен тип вправи, міграцію і відсутність помилок."""
import json, os, subprocess, sys, time, random
from datetime import datetime, timedelta
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = sys.argv[1] if len(sys.argv) > 1 else None
PORT = 8791
srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '-d', os.path.join(ROOT, 'public')],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
URL = f'http://localhost:{PORT}/?test=1'
errors = []
seen_types = {}
rnd = random.Random(7)


def shot(page, name):
    if SHOTS:
        os.makedirs(SHOTS, exist_ok=True)
        page.screenshot(path=os.path.join(SHOTS, name + '.png'))


def visible(page, sel):
    loc = page.locator(sel)
    return loc.count() > 0 and loc.first.is_visible()


def click_text(page, text):
    page.locator('#foot button', has_text=text).first.click()


def answer(page, wrong=False, scheme='light', expect=None):
    cur = page.evaluate('''() => { const c = window.EW.current; if (!c) return null;
        return { id: c.id, ex: c.exercise, w: c.word,
          cloze: (EWCore.clozeTarget(c.word) || {}).text || null, fill: c.fill || null,
          spell: EWCore.spellTarget(c.word), ctx: (EWCore.ctxTarget(c.word) || {}).text || null,
          tokPhrase: EWCore.tokens(c.word.en), tokSent: EWCore.tokens(c.word.ex) }; }''')
    if not cur:
        return False
    ex, w = cur['ex'], cur['w']
    key = ex + ('-' + scheme)
    if key not in seen_types:
        seen_types[key] = cur['id']
        page.wait_for_timeout(150)
        shot(page, f'{scheme}-{ex}-a')
    if ex == 'intro':
        if visible(page, '.opt-btn:not([disabled])'):
            page.locator('.opt-btn').nth(0 if rnd.random() < 0.5 else 1).click()
            page.wait_for_timeout(120)
        if key + '-done' not in seen_types:
            seen_types[key + '-done'] = 1
            shot(page, f'{scheme}-{ex}-b')
        click_text(page, 'Вчити')
        return True
    if ex in ('mcq_en_uk', 'mcq_uk_en', 'listen_mcq', 'phrase_mcq', 'listen_spell'):
        field = 'en' if ex == 'mcq_uk_en' else 'uk'
        btns = page.locator('.opt-btn')
        target = None
        for i in range(btns.count()):
            if (btns.nth(i).get_attribute('data-id') == w['id']) != wrong:
                target = btns.nth(i)
                break
        target.click()
    elif ex == 'tf':
        truth = page.inner_text('.tf-uk') == page.evaluate('(u) => EWCore.shortSense(u)', w['uk'])
        click_text(page, ('Ні' if truth else 'Так') if wrong else ('Так' if truth else 'Ні'))
    elif ex in ('flip', 'flip_rev'):
        click_text(page, 'Показати відповідь')
        click_text(page, 'Не знаю' if wrong else 'Знаю')
    elif ex in ('type_en', 'cloze', 'dictation'):
        val = 'qwerty' if wrong else (cur['cloze'] if ex == 'cloze' else w['en'].rstrip('.!?'))
        page.fill('.answer', val)
        click_text(page, 'Перевірити')
    elif ex in ('build_phrase', 'build_sentence'):
        toks = cur['tokSent'] if ex == 'build_sentence' else cur['tokPhrase']
        if wrong:
            toks = list(reversed(toks))
        for t in toks:
            tiles = page.locator('.build-bank .tile:not(.used)', has_text=t)
            for i in range(tiles.count()):
                if tiles.nth(i).inner_text() == t:
                    tiles.nth(i).click()
                    break
        click_text(page, 'Перевірити')
        if wrong and visible(page, '#foot button:has-text("Перевірити")'):
            click_text(page, 'Перевірити')
    elif ex == 'speak':
        click_text(page, 'Показати відповідь')
        click_text(page, 'Не згадав' if wrong else 'Правильно')
    elif ex == 'say_sentence':
        if wrong and rnd.random() < 0.5:
            click_text(page, 'Не знаю')
            assert visible(page, '.ex.said mark'), 'say_sentence: слово в реченні не позначено'
        else:
            click_text(page, 'Показати відповідь')
            assert visible(page, '.ex.said mark'), 'say_sentence: слово в реченні не позначено'
            click_text(page, 'Не згадав' if wrong else 'Правильно')
    elif ex == 'spell':
        if wrong:
            click_text(page, 'Не знаю')
        else:
            for ch in cur['spell']:
                tiles = page.locator('.spell-bank .tile:not([disabled])')
                for i in range(tiles.count()):
                    if tiles.nth(i).inner_text().lower() == ch.lower():
                        tiles.nth(i).click()
                        break
    elif ex == 'ctx_mcq':
        btns = page.locator('.opt-btn')
        for i in range(btns.count()):
            if (btns.nth(i).locator('span').nth(1).inner_text().lower() == cur['ctx'].lower()) != wrong:
                btns.nth(i).click()
                break
    elif ex == 'phrase_fill':
        page.fill('.answer', 'qwerty' if wrong else cur['fill'])
        click_text(page, 'Перевірити')
    elif ex == 'listen_ex':
        btns = page.locator('.opt-btn')
        for i in range(btns.count()):
            if (btns.nth(i).locator('span').nth(1).inner_text() == w['exUk']) != wrong:
                btns.nth(i).click()
                break
    elif ex == 'match':
        en = page.locator('.pair-btn.en')
        ids = [en.nth(i).get_attribute('data-id') for i in range(en.count())]
        if wrong:
            page.locator('.pair-btn.en[data-id="%s"]' % w['id']).click()
            other = next(i for i in ids if i != w['id'])
            page.locator('.pair-btn:not(.en)[data-id="%s"]' % other).click()
        for i in ids:
            page.locator('.pair-btn.en[data-id="%s"]' % i).click()
            page.locator('.pair-btn:not(.en)[data-id="%s"]' % i).click()
    elif ex == 'own_sentence':
        if wrong:
            click_text(page, 'Пропустити')
        else:
            page.fill('textarea.answer', 'I think ' + w['en'].replace('to ', '') + ' is a useful word for work.')
            click_text(page, 'Готово')
    else:
        raise RuntimeError('unknown exercise ' + ex)
    if ex not in ('flip', 'flip_rev', 'speak', 'say_sentence') and key + '-done' not in seen_types:
        seen_types[key + '-done'] = 1
        page.wait_for_timeout(150)
        shot(page, f'{scheme}-{ex}-b')
    if expect:
        assert visible(page, '.verdict.' + expect), (ex, expect, page.inner_text('#foot')[:200])
        if expect == 'wrong':
            shot(page, f'{scheme}-{ex}-wrong')
    if visible(page, '#foot button:has-text("Далі")'):
        click_text(page, 'Далі')
    return True


def grammar_answer(page, wrong=False):
    """Відповісти на поточне завдання граматики за ключем (або навмисно хибно)"""
    t = page.evaluate('(() => { const g = window.EW.gt; return g.tasks[g.i]; })()')
    if t['type'] == 'choice':
        right = t['opts'][t['a']]
        btns = page.locator('.opt-btn')
        for k in range(btns.count()):
            if (btns.nth(k).locator('span').nth(1).inner_text() == right) != wrong:
                btns.nth(k).click()
                break
    elif t['type'] == 'input':
        page.fill('.answer', 'qqq' if wrong else t['a'][0])
        click_text(page, 'Перевірити')
    elif t['type'] == 'fix':
        norm = lambda x: x.replace('’', "'").strip('.,!?;:"“”«»()—–').lower()
        words = page.locator('.fixq .fixw')
        texts = [norm(words.nth(k).inner_text()) for k in range(words.count())]
        bi = texts.index(norm(t['bad']))
        if wrong:
            words.nth(0 if bi else 1).click()
        else:
            words.nth(bi).click()
            page.fill('.answer', t['a'][0])
            click_text(page, 'Перевірити')
    else:
        ans = t['a'][0] if isinstance(t['a'], list) else t['a']
        toks = page.evaluate('([a]) => EWCore.tokens(a)', [ans])
        if wrong:
            toks = list(reversed(toks))
        for tk in toks:
            tiles = page.locator('.build-bank .tile:not(.used)')
            for k in range(tiles.count()):
                if tiles.nth(k).inner_text().lower() == tk.lower():
                    tiles.nth(k).click()
                    break
        click_text(page, 'Перевірити')
    page.wait_for_timeout(60)
    return t


def run_day(page, wrong_rate=0.0, scheme='light', limit=400):
    page.wait_for_timeout(300)
    if visible(page, '#learnHome button:has-text("Почати")'):
        page.click('#learnHome button:has-text("Почати")')
    elif visible(page, '#learnHome button:has-text("Продовжити")'):
        page.click('#learnHome button:has-text("Продовжити")')
    else:
        return 0
    n = 0
    while n < limit and page.evaluate('!!(window.EW && window.EW.current)'):
        answer(page, wrong=rnd.random() < wrong_rate, scheme=scheme)
        n += 1
    assert n < limit, 'session too long'
    return n


try:
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
        for scheme in ([] if os.environ.get('E2E_UX_ONLY') else ['light', 'dark']):
            ctx = b.new_context(viewport={'width': 375, 'height': 760}, device_scale_factor=2, color_scheme=scheme,
                                is_mobile=True, has_touch=True)
            page = ctx.new_page()
            page.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
            page.on('console', lambda m: errors.append('console: ' + m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
            # Перерваний запис чи його blob-копія (бот перейшов далі, поки грав попередній) — не помилка; файли перевіряє make_audio
            page.on('requestfailed', lambda r: errors.append('failed: ' + r.url + ' ' + str(r.failure)) if 'fonts.g' not in r.url and not (('/audio/' in r.url or r.url.startswith('blob:')) and 'ABORTED' in str(r.failure)) else None)
            start = datetime(2026, 10, 24, 18, 0, 0)
            page.clock.set_fixed_time(start)
            page.goto(URL)
            page.wait_for_timeout(600)
            # Бот відповідає швидко; самостійний перехід далі перевіряється окремо нижче
            page.evaluate('localStorage.setItem("ew.settings", JSON.stringify({autoNext: false})); location.reload()')
            page.wait_for_timeout(600)
            shot(page, f'{scheme}-home')
            n1 = run_day(page, wrong_rate=0.15, scheme=scheme)
            log = page.evaluate('window.EW.log')
            day = list(log.values())[-1]
            print(scheme, 'day1 answers', n1, 'log', {k: day[k] for k in ('n', 'r', 'a', 'c')})
            assert day['n'] == 10 and day['c'] == 10, day
            shot(page, f'{scheme}-done')
            if scheme == 'light' and visible(page, 'button:has-text("Потренувати")'):
                page.click('button:has-text("Потренувати")')
                k = 0
                while page.evaluate('!!(window.EW.current)') and k < 60:
                    answer(page, scheme='practice'); k += 1
                print('practice answers', k)
            cards = page.evaluate('window.EW.cards')
            # Слово з п'ятьма помилками за день відкладено на завтра (C.DAY_MISS), решта вивчені
            rested = lambda c: c['st'] in ('learn', 'relearn') and c.get('mt', 0) >= 5 and c['due'] == c.get('md', -9) + 1
            assert len(cards) == 10 and all(c['st'] == 'review' or rested(c) for c in cards.values()), cards
            for d in (2, 4, 7, 12, 20):
                page.clock.set_fixed_time(start + timedelta(days=d))
                page.reload()
                page.wait_for_timeout(500)
                n = run_day(page, wrong_rate=0.12, scheme=scheme)
                cards = page.evaluate('window.EW.cards')
                states = {}
                for c in cards.values():
                    states[c['st']] = states.get(c['st'], 0) + 1
                print(scheme, 'day', d + 1, 'answers', n, 'cards', len(cards), states)
            # Вправи для міцних слів, до яких бот за 3 тижні не доходить
            for ex_type, check in (('dictation', 'canDictate'), ('build_sentence', 'canBuildSentence'), ('flip', 'canType'), ('own_sentence', 'canDictate'),
                                   ('spell', 'spellTarget'), ('ctx_mcq', 'ctxTarget'), ('listen_ex', 'canBuildSentence'), ('match', 'canType'), ('phrase_fill', 'canType'),
                                   ('say_sentence', 'canSaySentence'), ('tf', 'canType')):
                wid = page.evaluate('''([check]) => Object.entries(window.EW.cards).filter(([id, c]) => c.st === 'review')
                    .map(([id]) => window.WORDS.find(x => x.id === id)).find(w => w && EWCore[check](w)).id''', [check])
                page.evaluate('([id, t]) => window.EW.force(id, t)', [wid, ex_type])
                answer(page, scheme=scheme)
            page.evaluate('window.EW.showTab("learn")')
            # Спринт
            page.evaluate('''() => { const t = EWCore.dayNum(); for (const id in window.EW.cards) { const c = window.EW.cards[id]; if (c.st === 'review') { c.reps = Math.max(c.reps || 0, 2); c.s = Math.max(c.s || 0, 5); } } }''')
            page.evaluate('window.EW.startSprint()')
            page.wait_for_timeout(300)
            assert page.evaluate('!!window.EW.sprint'), 'sprint did not start'
            shot(page, f'{scheme}-sprint')
            for k in range(6):
                btns = page.locator('.opt-btn')
                if btns.count() == 0:
                    break
                btns.nth(k % 4).click()
                page.wait_for_timeout(800)
            page.clock.run_for(61000)
            page.wait_for_timeout(400)
            assert not page.evaluate('!!window.EW.sprint'), 'sprint did not end'
            shot(page, f'{scheme}-sprint-end')
            print(scheme, 'sprint result:', page.inner_text('#card .prompt').replace('\n', ' | '))
            click_text(page, 'Готово')
            page.wait_for_timeout(200)
            for tab in ('dict', 'report', 'settings'):
                page.evaluate('document.activeElement && document.activeElement.blur()')
                page.wait_for_timeout(120)
                page.click(f'[data-tab="{tab}"]')
                page.wait_for_timeout(250)
                if tab == 'dict':
                    page.locator('.item-head').first.click()
                    page.wait_for_timeout(150)
                    assert page.locator('.phrase').count() == 5, 'phrases in dictionary'
                    links = page.locator('.phrase .mini')
                    assert links.count() == 10
                    yg = links.nth(0).get_attribute('href'); yt = links.nth(1).get_attribute('href')
                    assert yg.startswith('https://youglish.com/pronounce/') and yg.endswith('/english/uk'), yg
                    assert yt.startswith('https://m.youtube.com/results?search_query=%22'), yt
                    print(scheme, 'phrase links:', yg, '|', yt)
                shot(page, f'{scheme}-{tab}')
                if SHOTS:
                    page.screenshot(path=os.path.join(SHOTS, f'{scheme}-{tab}-full.png'), full_page=True)
            print(scheme, 'report:', page.inner_text('#docket').replace('\n', ' | '))
            ctx.close()

        # Перенесення прогресу з версії 2
        ctx = b.new_context(viewport={'width': 375, 'height': 760})
        page = ctx.new_page()
        page.on('pageerror', lambda e: errors.append('migration pageerror: ' + str(e)))
        page.clock.set_fixed_time(datetime(2026, 10, 25, 9, 0, 0))
        page.goto(URL)
        today = page.evaluate('EWCore.dayNum()')
        old = {'site-trowel': {'iv': 2, 'ef': 2.5, 'reps': 1, 'lapses': 0, 'due': today, 'first': today - 1, 'last': today - 1},
               'talk-going': {'iv': 0, 'ef': 2.3, 'reps': 0, 'lapses': 0, 'due': today - 1, 'first': today - 1, 'last': today - 1}}
        page.evaluate('o => { localStorage.clear(); localStorage.setItem("ew.progress", JSON.stringify(o)); localStorage.setItem("ew.log", JSON.stringify({"2026-10-24": {"n": 2, "r": 5, "a": 1, "c": 1, "x": 0}})); }', old)
        page.reload(); page.wait_for_timeout(400)
        mc = page.evaluate('window.EW.cards')
        assert mc['site-trowel']['st'] == 'review' and mc['talk-going']['st'] == 'learn', mc
        assert page.evaluate('localStorage.getItem("ew.progress")') is None
        home = page.inner_text('#learnHome')
        print('migration home:', home.replace('\n', ' | '))
        assert 'повторення' in home and 'довчити' in home
        print('migration streak:', page.inner_text('#streak'))
        ctx.close()

        # Зручність: повноекранне заняття, назад, тихий режим, підсумок, відсів, коротке заняття, нагадування
        ctx = b.new_context(viewport={'width': 375, 'height': 667}, is_mobile=True, has_touch=True)
        page = ctx.new_page()
        page.on('pageerror', lambda e: errors.append('ux pageerror: ' + str(e)))
        page.clock.set_fixed_time(datetime(2026, 10, 27, 19, 0, 0))
        page.goto(URL)
        page.wait_for_timeout(500)
        assert visible(page, '#learnHome .dock button:has-text("Почати")'), 'головна кнопка внизу'
        assert visible(page, '.tabs') and not visible(page, '#exitBtn')
        # Нагадування в Календар
        page.click('.setup-head:has-text("Обери час")')
        href = page.locator('.remind a.btn').get_attribute('href')
        assert href.startswith('/reminder.ics?t=19:30&d=') and '&a=' in href, href
        page.click('.remind .chip:has-text("перед сном")')
        href = page.locator('.remind a.btn').get_attribute('href')
        assert '?t=22:00&d=20261027' in href, href
        # Заняття: вкладки й шапка сховані, назад повертає знайомство
        page.click('#learnHome .dock button')
        page.wait_for_timeout(300)
        assert not visible(page, '.tabs') and not visible(page, '.top') and visible(page, '#exitBtn')
        assert page.evaluate('window.EW.current.exercise') == 'intro'
        first = page.evaluate('window.EW.current.id')
        assert page.locator('#undoBtn').is_disabled()
        page.locator('.opt-btn').nth(0).click()
        page.wait_for_timeout(150)
        assert visible(page, '#foot.sheet .verdict'), 'висновок у нижній панелі'
        click_text(page, 'Вчити')
        page.wait_for_timeout(200)
        assert first in page.evaluate('Object.keys(window.EW.cards)')
        page.click('#undoBtn')
        page.wait_for_timeout(200)
        assert first not in page.evaluate('Object.keys(window.EW.cards)'), 'назад прибрав картку'
        assert page.evaluate('[window.EW.current.id, window.EW.current.exercise]') == [first, 'intro']
        click_text(page, 'Показати одразу')
        click_text(page, 'Вчити')
        page.wait_for_timeout(200)
        # Тихий режим міняє вправу на слух на іншу
        lid = page.evaluate("Object.keys(window.EW.cards)[0]")
        page.evaluate('([id]) => window.EW.force(id, "listen_mcq")', [lid])
        page.click('#quietBtn')
        page.wait_for_timeout(200)
        assert page.evaluate('window.EW.settings.quiet') is True
        assert page.evaluate('window.EW.current.exercise') not in ('listen_mcq', 'dictation', 'speak')
        page.click('#quietBtn')
        # Самостійний перехід після правильної відповіді
        page.evaluate('window.EW.settings.autoNext = true')
        pair = page.evaluate('''() => { const t = EWCore.dayNum(); const ws = window.WORDS.slice(250, 252);
            for (const w of ws) window.EW.cards[w.id] = { st: 'review', s: 6, d: 5, last: t - 6, due: t, reps: 2, lapses: 0, first: t - 9 };
            return ws.map(w => [w.id, w.uk]); }''')
        (a_id, a_uk), (b_id, b_uk) = pair
        page.evaluate('([id]) => window.EW.force(id, "mcq_en_uk")', [a_id])
        page.wait_for_timeout(150)
        page.locator('.opt-btn[data-id="%s"]' % a_id).click()
        assert visible(page, '#foot.sheet.right'), 'правильна відповідь'
        assert visible(page, '#foot button.auto'), 'смужка відліку'
        for _ in range(30):
            page.wait_for_timeout(200)
            if page.evaluate('window.EW.current.id') != a_id:
                break
        assert page.evaluate('window.EW.current.id') != a_id, 'не перейшов далі сам'
        # Торкнувся картки: стоїть
        page.evaluate('([id]) => window.EW.force(id, "mcq_en_uk")', [b_id])
        page.wait_for_timeout(150)
        page.locator('.opt-btn[data-id="%s"]' % b_id).click()
        page.locator('#card .ex-head').dispatch_event('pointerdown')
        assert not visible(page, '#foot button.auto')
        page.wait_for_timeout(4500)
        assert page.evaluate('window.EW.current.id') == b_id, 'перейшов, хоча торкнувся картки'
        # Хрестик: підсумок заняття
        page.click('#exitBtn')
        page.wait_for_timeout(250)
        assert page.evaluate('window.EW.mode') == 'summary'
        summary = page.inner_text('#card')
        print('summary:', summary.replace('\n', ' | '))
        assert 'Заняття завершено' in summary and 'точність' in summary
        # Повторення сьогоднішніх нових слів: переклад відкривається дотиком
        fresh_n = page.evaluate('() => { const t = EWCore.dayNum(); return Object.values(window.EW.cards).filter(c => c.first === t && !c.known).length; }')
        recap = page.locator('.recap button')
        assert recap.count() == min(fresh_n, 16), (recap.count(), fresh_n)
        if fresh_n:
            assert recap.first.locator('small').count() == 0
            recap.first.click()
            assert recap.first.locator('small').inner_text().strip(), 'переклад не з\'явився'
            shot(page, 'light-summary-recap')
        click_text(page, 'На головну')
        page.wait_for_timeout(200)
        assert visible(page, '.tabs') and page.evaluate('window.EW.mode') is None
        # Новина про великий словник (одна за раз), потім про базовий: відсіяти знайомі
        if page.locator('.news:has-text("Великий словник")').count():
            assert 'Де кажуть' in page.inner_text('.news')
            page.click('.news button:has-text("Зрозуміло")')
            page.wait_for_timeout(200)
            assert page.locator('.news:has-text("Великий словник")').count() == 0
        # Новина про діалоги: кнопка веде до списку, «Пізніше» прибирає назавжди
        if page.locator('.news:has-text("Діалоги")').count():
            assert page.locator('.news button:has-text("Відкрити діалоги")').count() == 1
            page.click('.news button:has-text("Пізніше")')
            page.wait_for_timeout(200)
            assert page.locator('.news:has-text("Діалоги")').count() == 0
        page.click('.news button:has-text("Відсіяти знайомі")')
        page.wait_for_timeout(200)
        assert page.locator('.tri').count() == 20
        ids = page.evaluate('window.EW.mode') == 'triage'
        page.locator('.tri').nth(0).click(); page.locator('.tri').nth(2).click()
        first_batch = page.evaluate("Array.from(document.querySelectorAll('.tri b')).map(b => b.textContent)")
        click_text(page, 'Ще 20')
        page.wait_for_timeout(200)
        second_batch = page.evaluate("Array.from(document.querySelectorAll('.tri b')).map(b => b.textContent)")
        assert not set(first_batch) & set(second_batch), 'друга порція повторює першу'
        assert 'знаю 2 слова' in page.inner_text('#card .ex-head')
        click_text(page, 'Готово')
        page.wait_for_timeout(200)
        known = [c for c in page.evaluate('Object.values(window.EW.cards)') if c.get('known')]
        assert len(known) == 2 and page.evaluate('window.EW.meta.triaged') is not None, known
        # Хоч 2 хвилини
        page.evaluate('''() => { const t = EWCore.dayNum(); for (const w of window.WORDS.slice(40, 70)) window.EW.cards[w.id] = { st: 'review', s: 4, d: 5, last: t - 4, due: t, reps: 2, lapses: 0, first: t - 9 }; }''')
        page.evaluate('window.EW.showTab("learn")')
        page.wait_for_timeout(200)
        page.click('.qa:has-text("Хоч 2 хвилини")')
        page.wait_for_timeout(200)
        assert page.evaluate('window.EW.session.limit') == 12 and page.evaluate('window.EW.session.newIds.length') == 0
        # Жест «назад» закриває заняття, а не сайт
        page.go_back()
        page.wait_for_timeout(300)
        assert page.url.startswith(URL.split('?')[0]) and page.evaluate('window.EW.mode') in ('summary', None), page.url
        if page.evaluate('window.EW.mode'):
            page.click('#exitBtn')
            page.wait_for_timeout(200)
        assert page.evaluate('window.EW.mode') is None
        # Вчити першим зі словника
        page.evaluate('window.EW.showTab("dict")')
        # Фраза з файлу фраз: грає свій шматок і зупиняється
        page.fill('#search', 'trowel')
        page.wait_for_timeout(200)
        page.locator('.item-head').first.click()
        page.wait_for_timeout(300)
        # Кіара: [хеш, слово, приклад 1, приклад 2, фрази…]; Емма: окремий файл фраз [хеш, фрази…]
        seg = page.evaluate('(window.AUDIO_CIARA && window.AUDIO_CIARA["site-trowel"]) ? window.AUDIO_CIARA["site-trowel"][6] : window.AUDIO.phrases["site-trowel"][3]')
        page.evaluate('document.querySelectorAll(".phrase .say")[2].click()')
        ts = []
        for _ in range(45):
            page.wait_for_timeout(60)
            ts.append(page.evaluate('window.EW.debug()'))
        played = [d['t'] for d in ts if not d['paused']]
        assert played and min(played) >= seg[0] - 0.2 and max(d['t'] for d in ts) <= seg[1] + 0.4, (seg, played[:3], ts[-1])
        assert ts[-1]['paused'], 'фраза не зупинилась'
        page.locator('.item-head').first.click()
        far = page.evaluate('window.WORDS[300]')
        page.fill('#search', far['en'])
        page.wait_for_timeout(200)
        page.locator('.item-head').first.click()
        page.click('.item-actions button:has-text("Вчити першим")')
        assert page.evaluate('window.EW.meta.priority') == [far['id']]
        assert visible(page, '.status.pri')
        page.evaluate('window.EW.showTab("learn")')
        page.wait_for_timeout(200)
        page.click('#learnHome .dock button')
        page.wait_for_timeout(200)
        print('first new after priority:', page.evaluate('window.EW.session.newIds.slice(0, 2)'))
        assert page.evaluate('window.EW.session.newIds[0]') == far['id']
        page.click('#exitBtn')
        page.wait_for_timeout(200)
        # Словник: теми сіткою, кількість за станом, пошук від точного збігу
        page.evaluate('window.EW.showTab("dict")')
        page.fill('#search', '')
        page.wait_for_timeout(250)
        page.click('#catBtn')
        assert page.locator('.cat-cell').count() >= 15
        page.locator('.cat-cell', has_text='Стійкі вирази').click()
        page.wait_for_timeout(200)
        assert page.inner_text('#catName') == 'Стійкі вирази' and page.locator('#catGrid').is_hidden()
        assert page.inner_text('#segStatus button[aria-pressed="true"] small') == str(page.evaluate('window.WORDS.filter(w => w.cat === "idioms").length'))
        page.click('#catBtn'); page.locator('.cat-cell.all').click()
        page.fill('#search', 'get')
        page.wait_for_timeout(300)
        assert page.locator('.item-en').first.inner_text() == 'to get', page.locator('.item-en').first.inner_text()
        # Відсів: «Знаю всі на цій сторінці»
        page.evaluate('window.EW.showTab("learn")')
        page.evaluate('window.EW.startTriage()')
        page.wait_for_timeout(200)
        page.click('.tri-all')
        assert page.locator('.tri[aria-pressed="true"]').count() == 20
        page.click('.tri-all')
        assert page.locator('.tri[aria-pressed="true"]').count() == 0
        page.click('#exitBtn')
        # Тест з варіантами: чесне «Не знаю» і що означає вибраний хибний варіант
        page.evaluate('window.EW.showTab("learn")')
        page.evaluate('([id]) => window.EW.force(id, "mcq_en_uk")', [a_id])
        page.wait_for_timeout(150)
        click_text(page, 'Не знаю')
        page.wait_for_timeout(150)
        assert visible(page, '#foot.sheet.wrong') and visible(page, '.opt-btn.right'), 'Не знаю показує відповідь'
        b_en = page.evaluate('([id]) => window.WORDS.find(w => w.id === id).en', [b_id])
        page.evaluate('([id]) => window.EW.force(id, "mcq_uk_en")', [b_id])
        page.wait_for_timeout(150)
        btns = page.locator('.opt-btn')
        for i in range(btns.count()):
            if btns.nth(i).locator('span').nth(1).inner_text() != b_en:
                btns.nth(i).click()
                break
        assert ' — це ' in page.inner_text('#foot .verdict .yours'), 'значення хибного варіанта'
        # Слово з прикладу: бульбашка з перекладом; дотик поза нею лише закриває її
        page.evaluate('([id]) => window.EW.force(id, "flip")', ['site-trowel'])
        page.wait_for_timeout(150)
        click_text(page, 'Показати відповідь')
        page.wait_for_timeout(150)
        page.locator('.details .ex .tw', has_text='the').first.click()
        assert visible(page, '.peek') and 'артикль' in page.inner_text('.peek'), 'переклад службового слова'
        click_text(page, 'Знаю')
        page.wait_for_timeout(150)
        assert not visible(page, '.peek') and page.evaluate('window.EW.current.id') == 'site-trowel'
        assert page.locator('#foot .foot-btns.cols4 button').count() == 4, 'дотик поза бульбашкою не оцінив слово'
        page.locator('.details .ex .tw', has_text='trowel').first.click()
        assert 'гладилка' in page.inner_text('.peek')
        page.keyboard.press('Escape')
        assert not visible(page, '.peek') and page.evaluate('window.EW.mode') == 'session', 'Escape закриває лише бульбашку'
        page.click('#exitBtn')
        page.wait_for_timeout(200)
        if page.evaluate('window.EW.mode') == 'summary':
            click_text(page, 'Готово' if visible(page, '#foot button:has-text("Готово")') else 'На головну')
            page.wait_for_timeout(200)
        # Після пропущених днів: нові слова на паузі, але їх можна взяти
        page.evaluate('''() => { const t = EWCore.dayNum(); for (const w of window.WORDS.slice(500, 540)) window.EW.cards[w.id] = { st: 'review', s: 4, d: 5, last: t - 9, due: t - 3, reps: 2, lapses: 0, first: t - 20 }; }''')
        page.evaluate('window.EW.showTab("learn")')
        page.wait_for_timeout(200)
        assert 'нов' not in page.inner_text('.hero') and visible(page, '.qa:has-text("Взяти й нові слова")'), page.inner_text('.hero')
        page.click('.qa:has-text("Взяти й нові слова")')
        page.wait_for_timeout(200)
        assert page.evaluate('window.EW.session.newIds.length') > 0
        page.click('#exitBtn')
        page.wait_for_timeout(200)
        if page.evaluate('window.EW.mode'):
            page.click('#exitBtn')
        # Словник: дії з відібраними словами
        page.evaluate('window.EW.showTab("dict")')
        page.fill('#search', '')
        page.wait_for_timeout(250)
        assert not visible(page, '#dictActs'), 'без фільтра дій немає'
        page.click('#segStatus button:has-text("Вчу")')
        page.wait_for_timeout(200)
        assert not visible(page, '.act:has-text("Слухати")') and visible(page, '.act:has-text("Потренувати")')
        page.click('.act:has-text("Потренувати")')
        page.wait_for_timeout(200)
        assert page.evaluate('window.EW.mode') == 'session' and page.evaluate('window.EW.session.practice')
        page.click('#exitBtn')
        page.wait_for_timeout(200)
        assert visible(page, '#screen-dict') and page.evaluate('window.EW.mode') is None, 'тренування зі словника повертає в словник'
        page.click('#segStatus button:has-text("Усі")')
        page.click('#catBtn')
        page.locator('.cat-cell', has_text='Погода').click()
        page.wait_for_timeout(200)
        page.click('.act:has-text("Вчити першими")')
        pri = page.evaluate('window.EW.meta.priority')
        assert len(pri) >= 5 and all(page.evaluate('([id]) => window.WORDS.find(w => w.id === id).cat', [x]) == 'weather' for x in pri[-5:]), pri[-5:]
        assert visible(page, '.act:has-text("Не першими")')
        # Нові вправи (літери, пропущене слово, фраза, речення на слух, пари): кожна відкривається й зараховується
        page.evaluate('''() => { const ids = ['talk-borrow','core-cheap','sp-say','b1-rise','core-busy','sp-listen','core-remember','sp-wait','talk-wages','b2-guest'];
          ids.forEach(id => { if (!window.EW.cards[id]) window.EW.cards[id] = EWCore.knownCard(EWCore.dayNum(), 0.9, Math.random); }); }''')
        for ex_type, wid in (('spell', 'core-remember'), ('ctx_mcq', 'core-busy'), ('phrase_fill', 'talk-borrow'), ('listen_ex', 'sp-wait'), ('match', 'core-cheap'), ('say_sentence', 'sp-say'),
                             ('tf', 'core-cheap'), ('tf', 'b1-rise'), ('listen_spell', 'core-quiet'), ('phrase_mcq', 'talk-borrow')):
            for wrong in (False, True):
                page.evaluate('([id, t]) => window.EW.force(id, t)', [wid, ex_type])
                page.wait_for_timeout(80)
                assert page.evaluate('window.EW.current.exercise') == ex_type, ex_type
                if not wrong:
                    shot(page, f'light-new-{ex_type}-q')
                answer(page, wrong=wrong, expect=('wrong' if wrong else 'right') if ex_type in ('tf', 'listen_spell', 'phrase_mcq') else None)
                page.wait_for_timeout(80)
        # «Як пишеться?»: варіанти — схожі написанням слова, без омофонів; «Так чи ні?» не показує синонім як «неправильний» переклад
        page.evaluate('([id, t]) => window.EW.force(id, t)', ['core-quiet', 'listen_spell'])
        opts = page.evaluate("[...document.querySelectorAll('.opt-btn span:nth-child(2)')].map(s => s.textContent)")
        assert 'quiet' in opts and len(opts) == 4 and all(abs(len(o) - 5) <= 2 for o in opts), opts
        answer(page)
        # Пропуск у фразі чи реченні: пари-плутанки не стоять поруч (lend і borrow обидва пасують у «___ it for a day»)
        for t in ('phrase_mcq', 'ctx_mcq') * 5:
            page.evaluate('([id, t]) => window.EW.force(id, t)', ['talk-borrow', t])
            opts = page.evaluate("[...document.querySelectorAll('.opt-btn span:nth-child(2)')].map(s => s.textContent.toLowerCase())")
            assert 'borrow' in opts and not {'lend', 'loan'} & set(opts), opts
            answer(page)
        for _ in range(12):
            page.evaluate('([id, t]) => window.EW.force(id, t)', ['sp-say', 'tf'])
            shown = page.inner_text('.tf-uk')
            assert 'казати' not in shown or shown == page.evaluate("EWCore.shortSense(window.WORDS.find(w => w.id === 'sp-say').uk)"), shown
            answer(page)
        assert page.evaluate("[...document.querySelectorAll('.spell-slots .slot')].every(s => s.getBoundingClientRect().right <= innerWidth)"), 'літери влазять'
        # Варіанти в тестах тієї ж частини мови: до дієслова лише дієслова
        page.evaluate('([id, t]) => window.EW.force(id, t)', ['sp-say', 'mcq_uk_en'])
        page.wait_for_timeout(80)
        opts = page.evaluate("[...document.querySelectorAll('.opt-btn span:nth-child(2)')].map(s => s.textContent)")
        assert len(opts) == 4 and all(o.startswith('to ') for o in opts), opts
        answer(page)
        # Смуга прогресу не відкочується після помилки
        page.evaluate('([id, t]) => window.EW.force(id, t)', ['core-busy', 'mcq_en_uk'])
        page.wait_for_timeout(80)
        before = page.evaluate("parseFloat(document.getElementById('tapeFill').style.width)")
        answer(page, wrong=True)
        page.wait_for_timeout(80)
        after = page.evaluate("parseFloat(document.getElementById('tapeFill').style.width)")
        assert after >= before, (before, after)
        page.evaluate('window.EW.endSession && window.EW.endSession()')
        page.evaluate('window.EW.showTab("learn")')
        page.wait_for_timeout(150)
        # Граматика: кожна тема відкривається, а відповіді з ключа дають рівно 12 з 12 у кожній дюжині банку
        page.evaluate('window.EW.settings.autoplay = false')
        page.click('.tab[data-tab="grammar"]')
        page.wait_for_timeout(200)
        assert visible(page, '.gnext') and page.locator('.gitem').count() == page.evaluate('Object.keys(window.GRAMMAR.topics).length')
        assert page.locator('.gsec-test').count() == page.evaluate('window.GRAMMAR.sections.length'), 'кнопка тесту в кожному розділі'
        gids = page.evaluate('window.GRAMMAR.sections.flatMap(s => s.topics)')

        def run_test(tid, wrong_at=(), indices=None):
            if indices is None:
                page.click('.gtest .btn-primary')
            else:
                page.evaluate('([id, ix]) => window.EW.startGramTest(id, false, ix)', [tid, indices])
            page.wait_for_timeout(80)
            seen = []
            for i in range(12):
                wrong = i in wrong_at
                t = grammar_answer(page, wrong)
                seen.append(t)
                ok = page.locator('#foot.sheet.right').count() > 0
                assert ok != wrong, '%s, завдання %d: ключ не приймається: %s' % (tid, i, json.dumps(t, ensure_ascii=False)[:300])
                page.locator('#foot .btn-primary').click()
                page.wait_for_timeout(60)
            assert page.evaluate('window.EW.mode') == 'gresult'
            return seen

        for gi, tid in enumerate(gids):
            print('grammar', gi + 1, '/', len(gids), tid, flush=True)
            page.evaluate('([id]) => window.EW.openTopic(id)', [tid])
            page.wait_for_timeout(80)
            assert page.inner_text('.gtitle') == page.evaluate('([id]) => window.GRAMMAR.topics[id].title', [tid])
            assert page.locator('.gsheet > *').count() == page.evaluate('([id]) => window.GRAMMAR.topics[id].blocks.length', [tid]), tid
            assert page.locator('.gkey-list li').count() == page.evaluate('([id]) => (window.GRAMMAR.topics[id].key || []).length', [tid]), tid + ': «Головне»'
            n = page.evaluate('([id]) => window.GRAMMAR.topics[id].tasks.length', [tid])
            # Банк 24: обидві дюжини явно за індексами (кнопка бере з невиданих випадково, її перевіряємо нижче)
            first = run_test(tid, (2, 7) if gi == 0 else (), list(range(12)) if n >= 24 else None)
            assert page.evaluate('([id]) => window.EW.gres[id].best', [tid]) == (10 if gi == 0 else 12), tid
            if gi == 0:
                assert page.locator('.gres-item').count() == 2 and 'добре' not in page.inner_text('.gres-grade')
                assert 'повторити' in page.inner_text('.gres') or 'Перечитай' in page.inner_text('.gres')
            page.click('#exitBtn')
            page.wait_for_timeout(80)
            assert page.evaluate('window.EW.mode') is None and visible(page, '.gtitle'), 'з результату назад до теми'
            for d0 in range(12, n, 12):
                more = run_test(tid, (), list(range(d0, d0 + 12)))
                keys1 = {json.dumps(t, sort_keys=True) for t in first}
                assert all(json.dumps(t, sort_keys=True) not in keys1 for t in more), tid + ': наступна дюжина має бути з інших завдань'
                page.click('#exitBtn')
                page.wait_for_timeout(80)
        # Помилки повертаються: у першій темі дві помилки → наступний тест починається з них
        t0 = gids[0]
        page.evaluate('([id]) => window.EW.openTopic(id)', [t0])
        page.wait_for_timeout(80)
        missed = page.evaluate('([id]) => Object.keys(window.EW.gres[id].seen).filter(k => window.EW.gres[id].seen[k] === 1)', [t0])
        assert len(missed) == 2, missed
        page.click('.gtest .btn-primary')
        page.wait_for_timeout(80)
        picked = page.evaluate('() => window.EW.gt.tasks.map(t => EWCore.taskKey(t))')
        assert set(missed) <= set(picked), 'помилки мають повернутися в наступний тест'
        # «Правило» під час тесту: аркуш із «Головним», закривається
        page.click('#ruleBtn')
        page.wait_for_timeout(100)
        assert visible(page, '#ruleSheet .gkey'), 'аркуш правила'
        page.click('#ruleSheet .icon-btn')
        page.wait_for_timeout(100)
        assert page.locator('#ruleSheet').count() == 0
        page.click('#exitBtn')
        page.wait_for_timeout(80)
        # Список: бали біля тем, «назад» з теми повертає до списку
        page.go_back()
        page.wait_for_timeout(200)
        assert visible(page, '#gramList') and not visible(page, '#gramTopic')
        assert page.locator('.gmark.g-top').count() == len(gids), 'бали біля тем'
        # Тест розділу: 12 завдань з різних тем, результат по темах, бал у звіті
        sid = page.evaluate('window.GRAMMAR.sections[0].id')
        page.locator('.gsec-test').first.click()
        page.wait_for_timeout(100)
        tids = page.evaluate('() => window.EW.gt.tasks.map(t => t.tid)')
        assert len(tids) == 12 and len(set(tids)) >= 4, tids
        for i in range(12):
            wrong = i == 0
            grammar_answer(page, wrong)
            page.locator('#foot .btn-primary').click()
            page.wait_for_timeout(60)
        assert page.evaluate('window.EW.mode') == 'gresult'
        assert page.locator('.gsec-row').count() == len(set(tids)) and page.locator('.gsec-row.bad').count() == 1
        assert page.evaluate('([s]) => window.EW.gres["sec:" + s].best', [sid]) == 11
        page.locator('.gsec-row.bad').click()
        page.wait_for_timeout(100)
        assert visible(page, '.gtitle'), 'з результату розділу відкривається слабка тема'
        # Повторення через дні: пройдена тема стає «час повторити» на головній і в списку
        page.evaluate('([id]) => { const g = window.EW.gres[id]; g.due = EWCore.dayNum() - 1; localStorage.setItem("ew.grammar", JSON.stringify(window.EW.gres)); }', [gids[1]])
        page.reload()
        page.wait_for_timeout(500)
        page.evaluate('window.EW.settings.autoplay = false')
        assert gids[1] in page.evaluate('window.EW.gramDue()')
        page.click('.tab[data-tab="grammar"]')
        page.wait_for_timeout(200)
        assert 'повторити' in page.inner_text('.gnext') and page.locator('.gdue').count() == 1
        # Закріплення: наступного дня завдання з тестів чекають; плитка на головній веде в 12 завдань
        page.evaluate('() => { const g = window.EW.gres, t = EWCore.dayNum(); for (const id in g) { const p = g[id].p || {}; for (const k in p) p[k] = [t, p[k][1]]; } localStorage.setItem("ew.grammar", JSON.stringify(g)); }')
        page.reload()
        page.wait_for_timeout(500)
        page.evaluate('window.EW.settings.autoplay = false')
        due0 = page.evaluate('window.EW.gramPracticeDue()')
        assert due0 > 12, due0
        page.locator('.qa:has-text("Граматика: закріпити")').click()
        page.wait_for_timeout(150)
        assert page.evaluate('window.EW.gt.kind') == 'practice' and page.evaluate('window.EW.gt.tasks.length') == 12
        i = 0
        while page.evaluate('window.EW.mode') == 'gtest':
            grammar_answer(page, i == 0)
            page.locator('#foot .btn-primary').click()
            page.wait_for_timeout(60)
            i += 1
        assert i == 13, 'помилка повертається ще раз у тому ж підході: %d' % i
        assert page.inner_text('.gres-score b') == '11' and visible(page, '#foot button:has-text("Ще 12")')
        assert page.evaluate('window.EW.gramPracticeDue()') == due0 - 12
        page.locator('#foot button:has-text("Готово")').click()
        page.wait_for_timeout(150)
        assert visible(page, '#learnHome'), 'з головної — назад на головну'
        # Мої помилки: пройти правильно — і помилок не лишається
        page.click('.tab[data-tab="grammar"]')
        page.wait_for_timeout(200)
        assert visible(page, '.gpractice')
        page.locator('.gpractice .btn-quiet').click()
        page.wait_for_timeout(150)
        assert page.evaluate('window.EW.gt.kind') == 'mistakes'
        while page.evaluate('window.EW.mode') == 'gtest':
            grammar_answer(page, False)
            page.locator('#foot .btn-primary').click()
            page.wait_for_timeout(60)
        assert page.evaluate('() => EWCore.pickMistakes(Object.keys(window.GRAMMAR.topics).map(id => ({ id, tasks: window.GRAMMAR.topics[id].tasks, p: (window.EW.gres[id] || {}).p }))).length') == 0
        page.locator('#foot button:has-text("Готово")').click()
        page.wait_for_timeout(150)
        # Практика теми без оцінки: бал теми не змінюється, повертає на сторінку теми
        best0 = page.evaluate('([id]) => [window.EW.gres[id].best, window.EW.gres[id].last]', [gids[2]])
        page.evaluate('([id]) => window.EW.openTopic(id)', [gids[2]])
        page.wait_for_timeout(100)
        page.click('.gpr-btn')
        page.wait_for_timeout(100)
        assert page.evaluate('window.EW.gt.kind') == 'tpractice'
        while page.evaluate('window.EW.mode') == 'gtest':
            grammar_answer(page, False)
            page.locator('#foot .btn-primary').click()
            page.wait_for_timeout(60)
        assert 'Практику завершено' in page.inner_text('#card')
        page.locator('#foot button:has-text("Готово")').click()
        page.wait_for_timeout(150)
        assert visible(page, '.gtitle') and page.evaluate('([id]) => [window.EW.gres[id].best, window.EW.gres[id].last]', [gids[2]]) == best0
        # Перерваний тест не зберігає бал
        before = page.evaluate('([id]) => [window.EW.gres[id].last, window.EW.gres[id].n]', [gids[0]])
        page.evaluate('([id]) => window.EW.startGramTest(id)', [gids[0]])
        page.wait_for_timeout(100)
        grammar_answer(page, True)
        page.click('#exitBtn')
        page.wait_for_timeout(100)
        assert page.evaluate('([id]) => [window.EW.gres[id].last, window.EW.gres[id].n]', [gids[0]]) == before
        page.evaluate('window.EW.showTab("report")')
        page.wait_for_timeout(150)
        assert 'Граматика' in page.inner_text('#docket') and 'розділ' in page.inner_text('#docket'), 'бали теми й розділу у звіті за день'
        assert 'закріплено' in page.inner_text('#docket'), 'закріплення у звіті'
        # Завдання дня, «N поспіль», календар серії, карта активності
        page.evaluate('window.EW.showTab("learn")'); page.wait_for_timeout(200)
        assert page.locator('#quests .quest').count() == 3, 'три завдання дня'
        assert all('/' in x for x in page.locator('#quests .q-num').all_text_contents())
        cb = page.evaluate('(window.EW.log[EWCore.dayKey(EWCore.dayNum())] || {}).cb || 0')
        assert cb >= 1, 'найдовша серія правильних відповідей за день пишеться в журнал'
        page.click('#streak'); page.wait_for_timeout(300)
        assert visible(page, '#appSheet') and page.locator('#appSheet .st-day.today').count() == 1
        assert page.locator('#appSheet .st-day.done').count() >= 1
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        shot(page, 'light-streak-sheet')
        page.keyboard.press('Escape'); page.wait_for_timeout(150)
        assert page.locator('#appSheet').count() == 0
        page.click('.week-cal'); page.wait_for_timeout(200)
        assert page.locator('#appSheet').count() == 1
        page.click('#appSheet .gsheet-head .icon-btn'); page.wait_for_timeout(150)
        assert page.locator('#appSheet').count() == 0
        page.evaluate('window.EW.showTab("report")'); page.wait_for_timeout(200)
        assert page.locator('#heatBox .heat-grid i').count() == 140 and page.locator('#heatBox .heat-grid i.today').count() == 1
        # Діалоги: з головної до списку, сторінка, тренування за ключем, рольова гра, повторення, звіт
        page.evaluate('window.EW.showTab("learn")'); page.wait_for_timeout(200)
        page.click('.qa:has-text("Діалоги")'); page.wait_for_timeout(200)
        dorder = page.evaluate('window.DIALOGS.order')
        assert visible(page, '#dlgList') and page.locator('.dlg-item').count() == len(dorder) >= 3
        assert page.locator('[data-tab="learn"][aria-current="page"]').count() == 1, 'діалоги — частина «Вчити»'
        page.click('.dlg-item[data-id="cafe-takeaway"]'); page.wait_for_timeout(200)
        assert 'café' in page.inner_text('#dlgPage .gtitle') and page.locator('#dlgChat .bub').count() == 20
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'сторінка діалогу ширша за екран'
        b0 = page.locator('#dlgChat .bub[data-li="0"]')
        assert not b0.locator('.bub-alts').is_visible()
        b0.locator('.bub-alt-btn').click(); page.wait_for_timeout(100)
        assert b0.locator('.bub-alts').is_visible() and b0.locator('.bub-alt').count() == 2
        page.click('.dlg-opts .chip:has-text("Переклад")'); page.wait_for_timeout(100)
        assert not b0.locator('.bub-uk').first.is_visible() and page.evaluate('window.EW.settings.dlgUk') is False
        page.click('.dlg-opts .chip:has-text("Переклад")'); page.wait_for_timeout(100)
        assert b0.locator('.bub-uk').first.is_visible()
        shot(page, 'light-dialog-page')
        # «Слухати весь діалог» з записом: кнопка стає «Зупинити», репліка підсвічується; без запису — голос пристрою
        if page.evaluate('!!(window.DLG_AUDIO && window.DLG_AUDIO["cafe-takeaway"])'):
            page.click('#dlgPlayBtn'); page.wait_for_timeout(1500)
            assert page.evaluate('!!window.EW.dplay') and 'Зупинити' in page.inner_text('#dlgPlayBtn')
            assert page.locator('#dlgChat .bub.now').count() == 1, 'грає, але не підсвічує репліку'
            page.click('#dlgPlayBtn'); page.wait_for_timeout(100)
            assert not page.evaluate('!!window.EW.dplay') and 'Слухати весь діалог' in page.inner_text('#dlgPlayBtn')
            assert page.locator('#dlgChat .bub.now').count() == 0
        # Тренування: 10 завдань, відповідаємо за ключем
        page.click('.dlg-step[data-step="train"]'); page.wait_for_timeout(200)
        assert page.evaluate('window.EW.mode') == 'dtrain' and visible(page, '#exitBtn')
        kinds = set()
        while page.evaluate('window.EW.mode') == 'dtrain':
            t = page.evaluate('(() => { const d = window.EW.dl; const t = d.tasks[d.i]; return { type: t.type, a: t.a, want: EWCore.tokens(d.d.lines[t.li].en) }; })()')
            kinds.add(t['type'])
            if t['type'] in ('listen', 'reply'):
                page.locator('#card .options .opt-btn').nth(t['a']).click()
            else:
                used = set()
                for w in t['want']:
                    tiles = page.locator('.build-bank .tile')
                    for j in range(tiles.count()):
                        if j not in used and tiles.nth(j).get_attribute('data-w') == w:
                            tiles.nth(j).click(); used.add(j); break
                page.locator('#foot button:has-text("Перевірити")').click()
            page.wait_for_timeout(80)
            assert page.locator('#foot .verdict.right').count() == 1, 'відповідь за ключем має бути правильною'
            page.locator('#foot .btn-primary').click()
            page.wait_for_timeout(80)
        assert kinds == {'listen', 'reply', 'order'}, kinds
        assert page.evaluate('window.EW.mode') == 'dresult' and '10' in page.inner_text('.gres-score')
        shot(page, 'light-dialog-train-result')
        page.locator('#foot button:has-text("Рольова гра")').click(); page.wait_for_timeout(200)
        assert page.evaluate('window.EW.mode') == 'drole'
        mine = 0
        for _ in range(60):
            if page.evaluate('window.EW.mode') != 'drole':
                break
            labels = page.locator('#foot .btn').all_text_contents()
            if any('Показати' in x for x in labels):
                assert page.locator('#dlRoleChat .bub.ask').count() == 1
                page.locator('#foot button:has-text("Показати")').click()
                page.wait_for_timeout(60)
                page.locator('#foot button:has-text("Вийшло")').click(); mine += 1
            else:
                page.locator('#foot .btn-primary').click()
            page.wait_for_timeout(60)
        assert page.evaluate('window.EW.mode') == 'dresult' and mine == 10, mine
        shot(page, 'light-dialog-role-result')
        r = page.evaluate('window.EW.dres["cafe-takeaway"]')
        t0 = page.evaluate('EWCore.dayNum()')
        assert r['tr'] == 1 and r['trk'] == [10, 10] and r['role']['b'] == t0 and r['due'] == t0 + 3, r
        page.locator('#foot button:has-text("Готово")').click(); page.wait_for_timeout(200)
        assert page.evaluate('window.EW.mode') is None and visible(page, '#dlgPage')
        assert page.locator('.dlg-step.done').count() == 2, 'тренування й роль позначені'
        # Хрестик посеред тренування повертає на сторінку діалогу
        page.evaluate('window.EW.startDlgTrain("airport-checkin")'); page.wait_for_timeout(150)
        page.locator('#card .options .opt-btn').first.click(); page.wait_for_timeout(60)
        page.click('#exitBtn'); page.wait_for_timeout(200)
        assert page.evaluate('window.EW.mode') is None and visible(page, '#dlgPage') and 'Checking in' in page.inner_text('#dlgPage .gtitle')
        # Жест «назад» зі сторінки діалогу — до списку
        page.go_back(); page.wait_for_timeout(300)
        assert visible(page, '#dlgList') and not visible(page, '#dlgPage')
        page.evaluate('window.EW.showTab("report")'); page.wait_for_timeout(150)
        assert 'Діалоги' in page.inner_text('#docket') and 'рольова гра 10 з 10' in page.inner_text('#docket')
        # Шедоуінг: «Паузи, щоб повторювати» — після репліки запис чекає з позначкою «Повтори вголос»
        page.evaluate('window.EW.openDialog("cafe-takeaway")'); page.wait_for_timeout(200)
        page.click('.dlg-opts .chip:has-text("Паузи")'); page.wait_for_timeout(100)
        assert page.evaluate('window.EW.settings.dlgEcho') is True
        if page.evaluate('!!(window.DLG_AUDIO && window.DLG_AUDIO["cafe-takeaway"])'):
            page.click('#dlgPlayBtn')
            for _ in range(40):
                page.wait_for_timeout(250)
                if page.locator('#dlgChat .bub.echo').count():
                    break
            assert page.locator('#dlgChat .bub.echo').count() == 1, 'пауза для повтору не настала'
            page.click('#dlgPlayBtn'); page.wait_for_timeout(100)
            assert page.locator('#dlgChat .bub.echo, #dlgChat .bub.now').count() == 0
        page.click('.dlg-opts .chip:has-text("Паузи")'); page.wait_for_timeout(100)
        assert page.evaluate('window.EW.settings.dlgEcho') is False
        # Диктант: пишемо почуте речення точно — кожне без помилок
        page.evaluate('window.EW.showTab("learn")'); page.wait_for_timeout(200)
        if page.locator('.qa:has-text("Диктант")').count():
            page.click('.qa:has-text("Диктант")')
        else:
            page.evaluate('window.EW.startDict()')
        page.wait_for_timeout(200)
        if page.evaluate('window.EW.mode') == 'dict':
            n = page.evaluate('window.EW.pr.items.length')
            assert 3 <= n <= 10
            first = True
            while page.evaluate('window.EW.mode') == 'dict':
                en = page.evaluate('window.EW.pr.items[window.EW.pr.i].en')
                if first:
                    page.click('.dict-hint'); page.wait_for_timeout(50)
                    assert '_' in page.inner_text('.dict-skel')
                    first = False
                page.fill('.dict-input', en.lower().replace(',', '').replace('?', '').replace('.', ''))
                page.locator('#foot button:has-text("Перевірити")').click(); page.wait_for_timeout(60)
                assert page.locator('#foot .verdict.right').count() == 1, 'точно написане речення має бути без помилок: ' + en
                assert page.locator('.dict-line .dw.ok').count() == len(page.evaluate('EWCore.tokens(window.EW.pr.items[window.EW.pr.i].en.replace(/[-–—]/g, " "))'))
                page.locator('#foot .btn-primary').click(); page.wait_for_timeout(60)
            assert page.evaluate('window.EW.mode') == 'prres' and page.inner_text('.gres-score b') == str(n)
            shot(page, 'light-dictation-result')
            page.locator('#foot button:has-text("Готово")').click(); page.wait_for_timeout(200)
            assert page.evaluate('window.EW.mode') is None
        # Розповідь 4/3/2: три раунди (у тесті по секунді), результат і тема запам'ятовується
        page.evaluate('EWCore.TELL_ROUNDS[0] = 2; EWCore.TELL_ROUNDS[1] = 1; EWCore.TELL_ROUNDS[2] = 1;')
        page.click('.qa:has-text("Розповідь")'); page.wait_for_timeout(200)
        assert page.evaluate('window.EW.mode') == 'tell' and page.locator('.tell-q li').count() == 4 and page.locator('.tell-chunk').count() == 5
        topic = page.evaluate('window.EW.pr.topic.id')
        page.locator('#foot button:has-text("Інша тема")').click(); page.wait_for_timeout(100)
        assert page.evaluate('window.EW.pr.topic.id') != topic
        topic = page.evaluate('window.EW.pr.topic.id')
        page.locator('#foot .btn-primary').click(); page.wait_for_timeout(2600)
        assert page.locator('#foot button:has-text("Почати")').count() == 1, 'після раунду — перерва'
        page.locator('#foot .btn-primary').click(); page.wait_for_timeout(300)
        page.locator('#foot button:has-text("Розповів")').click(); page.wait_for_timeout(150)
        page.locator('#foot .btn-primary').click(); page.wait_for_timeout(1500)
        assert page.evaluate('window.EW.mode') == 'prres' and page.locator('.tell-bar').count() == 3
        assert page.evaluate('window.EW.meta.talks["' + topic + '"]') == page.evaluate('EWCore.dayNum()')
        page.evaluate('EWCore.TELL_ROUNDS[0] = 120; EWCore.TELL_ROUNDS[1] = 90; EWCore.TELL_ROUNDS[2] = 60;')
        page.locator('#foot button:has-text("Готово")').click(); page.wait_for_timeout(200)
        page.evaluate('window.EW.showTab("report")'); page.wait_for_timeout(150)
        assert 'Розповідь' in page.inner_text('#docket')
        # Записи для офлайну: за замовчуванням не всі 660 МБ
        page.evaluate('window.EW.showTab("settings")')
        page.wait_for_timeout(200)
        assert 'наступних' in page.inner_text('#offlineAudio') and any(u in page.inner_text('#offlineAll') for u in ('МБ', 'ГБ'))
        # Оформлення: тема й вигляд перемикаються, зберігаються й переживають перезавантаження без спалаху
        accent0 = page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()")
        page.locator('.swatch.plum').click(); page.wait_for_timeout(150)
        assert page.evaluate("document.documentElement.dataset.theme") == 'plum'
        accent1 = page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()")
        assert accent1 != accent0, (accent0, accent1)
        assert page.locator('.swatch.plum[aria-pressed="true"]').count() == 1
        page.locator('.look').nth(2).click(); page.wait_for_timeout(150)
        assert page.evaluate("document.documentElement.dataset.appearance") == 'dark'
        bg_dark = page.evaluate("getComputedStyle(document.documentElement).backgroundColor")
        page.locator('.look').nth(1).click(); page.wait_for_timeout(150)
        bg_light = page.evaluate("getComputedStyle(document.documentElement).backgroundColor")
        assert bg_dark != bg_light, (bg_dark, bg_light)
        assert page.evaluate("document.querySelector('meta[name=theme-color]').getAttribute('content')") == bg_light
        page.reload(); page.wait_for_timeout(500)
        assert page.evaluate("[document.documentElement.dataset.theme, document.documentElement.dataset.appearance]") == ['plum', 'light']
        # сегменти з повзунком: позиція в --i
        page.evaluate('window.EW.showTab("settings")'); page.wait_for_timeout(200)
        page.locator('#segNew button').nth(2).click(); page.wait_for_timeout(100)
        assert page.evaluate("document.getElementById('segNew').style.getPropertyValue('--i')") == '2'
        assert page.evaluate('window.EW.settings.newPerDay') == 15
        page.locator('.look').nth(0).click(); page.locator('.swatch.cobalt').click(); page.wait_for_timeout(100)
        assert page.evaluate("[document.documentElement.dataset.theme, document.documentElement.dataset.appearance]") == [None, None]
        shot(page, 'light-settings-look')
        ctx.close()

        # Граматика мовою «Говори й пиши»: переклад, вголос, на слух — речення з банку теми, без балів
        for scheme in ('light', 'dark'):
            ctx = b.new_context(viewport={'width': 375, 'height': 667}, is_mobile=True, has_touch=True, color_scheme=scheme)
            page = ctx.new_page()
            page.on('pageerror', lambda e: errors.append('speech pageerror: ' + str(e)))
            page.goto(URL); page.wait_for_timeout(400)
            page.evaluate("window.EW.openTopic('present-simple')"); page.wait_for_timeout(200)
            assert page.locator('.gspeak .qa').count() == 3, 'три плитки на сторінці теми'
            page.evaluate("document.querySelector('.gspeak').scrollIntoView({block: 'center'})"); page.wait_for_timeout(400)
            assert not visible(page, '.gjump.show'), '«До завдань» не накриває плитки під тестом'
            shot(page, f'{scheme}-gspeak-topic')
            page.locator('.gspeak .qa', has_text='Переклади').click(); page.wait_for_timeout(150)
            assert page.evaluate('window.EW.gt.kind') == 'speech' and page.evaluate('window.EW.gt.tasks.length') == 8
            assert page.evaluate("window.EW.gt.tasks.every(t => t.speech === 'trans')")
            # Правильний переклад, набраний як на iPhone: з малої, «кривий» апостроф, без крапки
            en = page.evaluate('window.EW.gt.tasks[0].en')
            page.fill('#card textarea', en.replace("'", '’').lower().rstrip('.?!'))
            click_text(page, 'Перевірити'); page.wait_for_timeout(100)
            assert visible(page, '.verdict.right'), ('переклад зараховано', en)
            shot(page, f'{scheme}-gspeak-trans-ok')
            click_text(page, 'Далі'); page.wait_for_timeout(100)
            # Інший переклад: розбір по словах і «Мій варіант теж правильний»
            en = page.evaluate('window.EW.gt.tasks[1].en')
            words = en.rstrip('.?!').split(' ')
            page.fill('#card textarea', ' '.join(words[:-1] + ['probably']))
            click_text(page, 'Перевірити'); page.wait_for_timeout(100)
            assert visible(page, '.dict-res .dw'), 'речення розібране по словах'
            assert visible(page, '#foot button:has-text("Зарахувати")'), 'можна зарахувати свій варіант'
            shot(page, f'{scheme}-gspeak-trans-diff')
            click_text(page, 'Зарахувати'); page.wait_for_timeout(100)
            assert page.evaluate('[window.EW.gt.ok, window.EW.gt.i, window.EW.gt.tasks.length]') == [2, 2, 8]
            k = 0
            while page.evaluate("window.EW.mode") == 'gtest' and k < 20:
                click_text(page, 'Не знаю'); page.wait_for_timeout(60)
                nb = page.locator('#foot button', has_text='Далі')
                (nb if nb.count() else page.locator('#foot button', has_text='Результат')).first.click(); page.wait_for_timeout(60)
                k += 1
            assert page.evaluate("window.EW.mode") == 'gresult' and k == 12, ('6 «Не знаю» + 6 повторів наприкінці', k)
            assert 'Говори й пиши' in page.inner_text('#card')
            g = page.evaluate("window.EW.gres['present-simple']")
            assert len(g.get('sp', {})) == 8 and not g.get('seen') and not g.get('p'), 'речення записані окремо від тесту'
            assert page.evaluate('Object.values(window.EW.log).pop().gl') == 8
            shot(page, f'{scheme}-gspeak-result')
            # Наступний підхід бере спершу речення з помилками — але не сьогоднішні, тож нові
            click_text(page, 'Ще 8'); page.wait_for_timeout(100)
            keys2 = page.evaluate('window.EW.gt.tasks.map(t => t.key)')
            assert not set(keys2) & set(g['sp']), 'сьогодні вже пробував ці — беремо інші'
            page.evaluate('window.EW.endGramTest ? window.EW.endGramTest() : null')
            # Скажи вголос: відповідь, самооцінка
            page.evaluate("window.EW.startSpeech('past-simple', 'say')"); page.wait_for_timeout(100)
            assert visible(page, '.sp-uk') and not visible(page, '.sp-reveal')
            click_text(page, 'Показати відповідь'); page.wait_for_timeout(100)
            assert visible(page, '.sp-reveal')
            shot(page, f'{scheme}-gspeak-say')
            click_text(page, 'Сказав правильно'); page.wait_for_timeout(100)
            assert visible(page, '.verdict.right')
            # На слух: переклад прихований до відповіді
            page.evaluate("window.EW.startSpeech('will', 'hear')"); page.wait_for_timeout(100)
            assert visible(page, '.listen-big') and not visible(page, '.sp-uk')
            en = page.evaluate('window.EW.gt.tasks[0].en')
            page.fill('#card textarea', en)
            click_text(page, 'Перевірити'); page.wait_for_timeout(100)
            assert visible(page, '.verdict.right') and visible(page, '.dict-uk')
            shot(page, f'{scheme}-gspeak-hear')
            # Зі списку тем: упереміш з пройдених тем
            page.evaluate("() => { window.EW.gres['present-simple'] = Object.assign({}, window.EW.gres['present-simple'], { best: 10 }); window.EW.gres['will'] = { best: 9 }; }")
            page.evaluate("window.EW.endGramTest()"); page.wait_for_timeout(100)
            assert visible(page, '#gramTopic'), 'з практики теми — назад на сторінку теми'
            page.click('#gramTopic .gback'); page.wait_for_timeout(150)
            assert visible(page, '.gspeak-all'), 'плитка в списку тем'
            shot(page, f'{scheme}-gspeak-list')
            page.click('.gspeak-all'); page.wait_for_timeout(100)
            kinds = page.evaluate('window.EW.gt.tasks.map(t => t.speech)')
            assert set(kinds) == {'trans', 'say', 'hear'}, kinds
            assert set(page.evaluate('window.EW.gt.tasks.map(t => t.tid)')) <= {'present-simple', 'will'}
            ctx.close()

        # YouGlish: велике слово, слово в розборі, фрази зі словом і бульбашка перекладу ведуть у пошук YouGlish
        ctx = b.new_context(viewport={'width': 375, 'height': 667}, is_mobile=True, has_touch=True)
        page = ctx.new_page()
        page.on('pageerror', lambda e: errors.append('youglish pageerror: ' + str(e)))
        page.goto(URL); page.wait_for_timeout(400)
        page.evaluate("() => { const t = EWCore.dayNum(); EW.cards['core-cheap'] = EWCore.knownCard(t, 0.9, Math.random); EW.force('core-cheap', 'tf'); }")
        page.wait_for_timeout(120)
        assert page.get_attribute('h2.word a.yg', 'href') == 'https://youglish.com/pronounce/cheap/english/uk', 'велике слово'
        assert page.get_attribute('h2.word a.yg', 'target') == '_blank'
        click_text(page, 'Так' if page.inner_text('.tf-uk') == 'дешевий' else 'Ні'); page.wait_for_timeout(100)
        page.click('.details .phrases-head'); page.wait_for_timeout(100)
        ph = page.evaluate("[...document.querySelectorAll('.details .phrase-en a.yg')].map(a => [a.textContent, a.href])")
        assert len(ph) == 5 and all('youglish.com/pronounce/' in h and '/english/uk' in h for _, h in ph), ph
        acts = page.evaluate("[...document.querySelectorAll('.details .phrases .phrase-acts a')].map(a => a.href)")
        yg = [h for h in acts if h.startswith('https://youglish.com/pronounce/')]
        pp = [h for h in acts if h.startswith('https://www.playphrase.me/#/search?q=') and h.endswith('&language=en')]
        assert len(yg) == 5 and len(pp) == 5 and len(acts) == 10, acts
        assert not page.locator('.phrases a[href*="clip.cafe"]').count(), 'фрази — у PlayPhrase, не в Clip.cafe'
        assert page.locator('a[href*="youtube"]').count() == 0, 'YouTube прибрано'
        page.locator('.details .ex .tw').first.click(); page.wait_for_timeout(100)
        assert page.locator('.peek a.mini[href*="youglish.com"]').count() >= 1, 'бульбашка перекладу'
        assert page.locator('.peek .peek-all a[href*="playphrase.me"]').count() + page.locator('.peek a[href*="clip.cafe/s/"]').count() >= 1
        shot(page, 'light-youglish-peek')
        page.mouse.click(5, 300); page.wait_for_timeout(80)
        # Розбір після відповіді: слово → YouGlish, поруч Clip.cafe
        page.evaluate("window.EW.force('core-cheap', 'mcq_uk_en')"); page.wait_for_timeout(100)
        page.click('.opt-btn[data-id="core-cheap"]'); page.wait_for_timeout(100)
        assert page.get_attribute('.details .trans.en a.yg', 'href') == 'https://youglish.com/pronounce/cheap/english/uk', 'слово в розборі'
        assert page.evaluate("[...document.querySelectorAll('.details .word-links a.mini')].map(a => a.href)") == ['https://youglish.com/pronounce/cheap/english/uk', 'https://clip.cafe/s/cheap'], 'окреме слово — Clip.cafe'
        click_text(page, 'Далі'); page.wait_for_timeout(100)
        # Вираз з кількох слів: замість Clip.cafe — PlayPhrase
        mid = page.evaluate("() => { const w = window.WORDS.find(w => w.id.startsWith('pv-') && EWCore.tokens(EWCore.baseForm(w)).length === 2); const t = EWCore.dayNum(); EW.cards[w.id] = EWCore.knownCard(t, 0.9, Math.random); EW.force(w.id, 'mcq_uk_en'); return w.id; }")
        page.wait_for_timeout(100)
        page.click(f'.opt-btn[data-id="{mid}"]'); page.wait_for_timeout(100)
        links = page.evaluate("[...document.querySelectorAll('.details .word-links a.mini')].map(a => a.href)")
        assert links[0].startswith('https://youglish.com/pronounce/') and links[1].startswith('https://www.playphrase.me/#/search?q=') and '%20' in links[1], links
        shot(page, 'light-youglish-details')
        page.evaluate("window.EW.endSession()"); page.wait_for_timeout(100)
        # Спринт з таймером — без посилання
        ctx.close()

        # «Згадай без підказок»: плитка з'являється, коли є ≥ 3 нові слова за сьогодні; вільно, потім за значенням, решта — завтра
        ctx = b.new_context(viewport={'width': 375, 'height': 667}, is_mobile=True, has_touch=True)
        page = ctx.new_page()
        page.on('pageerror', lambda e: errors.append('recall pageerror: ' + str(e)))
        page.goto(URL); page.wait_for_timeout(400)
        assert not visible(page, '.qa:has-text("Згадай без підказок")'), 'без нових слів плитки немає'
        assert not visible(page, '.qa:has-text("Слухати")'), '«Слухати» прибрано'
        rc_ids = ['core-cheap', 'core-busy', 'talk-borrow', 'core-remember', 'sp-wait']
        page.evaluate('''(ids) => { const t = EWCore.dayNum(); ids.forEach(id => { const c = EWCore.knownCard(t, 0.9, Math.random); delete c.known; c.first = t; c.due = t + 5; EW.cards[id] = c; }); EW.showTab('learn'); }''', rc_ids)
        page.wait_for_timeout(200)
        assert visible(page, '.qa:has-text("Згадай без підказок")'), 'плитка згадування'
        page.locator('.qa', has_text='Згадай без підказок').click(); page.wait_for_timeout(150)
        assert page.evaluate('window.EW.mode') == 'recall' and page.locator('.rc').count() == 5
        page.fill('.recall .answer, #card input.answer', 'chep'); page.keyboard.press('Enter'); page.wait_for_timeout(80)   # описка — зараховано
        page.fill('#card input.answer', 'to borrow'); page.keyboard.press('Enter'); page.wait_for_timeout(80)
        page.fill('#card input.answer', 'banana'); page.keyboard.press('Enter'); page.wait_for_timeout(80)
        assert 'немає' in page.inner_text('.recall-note')
        assert page.locator('.rc.got').count() == 2
        shot(page, 'light-recall-free')
        click_text(page, 'Більше не пам'); page.wait_for_timeout(100)
        assert page.locator('.rc.cue').count() == 3, 'решта зі значенням'
        page.fill('#card input.answer', 'busy'); page.keyboard.press('Enter'); page.wait_for_timeout(80)
        shot(page, 'light-recall-cue')
        click_text(page, 'Завершити'); page.wait_for_timeout(150)
        assert page.evaluate('window.EW.mode') == 'prres' and '2' in page.inner_text('.gres-score')
        cs = page.evaluate('window.EW.cards'); t0 = page.evaluate('EWCore.dayNum()')
        assert cs['core-remember']['due'] == t0 + 1 and cs['sp-wait']['due'] == t0 + 1 and cs['core-busy']['due'] == t0 + 5, 'не згадане — завтра'
        lg = page.evaluate('Object.values(window.EW.log).pop()')
        assert lg['fr'] == 2 and lg['frn'] == 5
        shot(page, 'light-recall-result')
        click_text(page, 'Готово'); page.wait_for_timeout(150)
        assert not visible(page, '.qa:has-text("Згадай без підказок")'), 'сьогодні вже згадував'
        ctx.close()

        # Справжній користувач: північ посеред заняття, запізніле розпізнавання мовлення, синонім і омофон при друці
        ctx = b.new_context(viewport={'width': 375, 'height': 667}, is_mobile=True, has_touch=True)
        page = ctx.new_page()
        page.on('pageerror', lambda e: errors.append('real-user pageerror: ' + str(e)))
        page.add_init_script("""window.__srs = []; class FakeSR { constructor(){ window.__srs.push(this); } start(){} stop(){} abort(){ this.aborted = true; } }
            window.webkitSpeechRecognition = FakeSR; window.SpeechRecognition = FakeSR;""")
        page.clock.install(time=datetime(2026, 11, 23, 23, 55, 0))
        page.goto(URL); page.wait_for_timeout(500)
        page.evaluate('window.EW.meta.triaged = 1')
        page.click('#learnHome .dock button'); page.wait_for_timeout(200)
        for _ in range(2):
            click_text(page, 'Показати одразу'); page.wait_for_timeout(80)
            click_text(page, 'Вчити'); page.wait_for_timeout(120)
        d0 = page.evaluate('window.EW.session.env.today')
        page.clock.fast_forward('00:10:00')   # 00:05 наступного дня, заняття відкрите
        for _ in range(3):
            answer(page)
        d1 = page.evaluate('window.EW.session.env.today')
        lg = page.evaluate('window.EW.log')
        assert d1 == d0 + 1, ('після півночі план дня новий', d0, d1)
        assert lg.get('2026-11-24', {}).get('r', 0) >= 2, ('відповіді після півночі — у новий день', lg)
        assert 'день' in page.inner_text('#streak'), page.inner_text('#streak')
        page.evaluate('window.EW.endSession()'); page.wait_for_timeout(150)
        # Розпізнавання мовлення відповіло вже після переходу далі: нова вправа не зараховується сама
        ids = page.evaluate("""() => { const t = EWCore.dayNum(); const ids = ['sp-week', 'sp-sea', 'sp-son'];
            ids.forEach(id => { EW.cards[id] = { st: 'review', s: 5, d: 5, last: t - 5, due: t, reps: 2, lapses: 0, first: t - 9 }; });
            EW.force('sp-week', 'speak'); return ids; }""")
        page.click('.mic'); page.wait_for_timeout(50)
        click_text(page, 'Показати відповідь'); page.wait_for_timeout(50)
        click_text(page, 'Не згадав'); page.wait_for_timeout(150)
        cur = page.evaluate('window.EW.current && window.EW.current.id')
        r0 = page.evaluate('JSON.stringify(window.EW.log)')
        assert page.evaluate('window.__srs[0].aborted === true'), 'мікрофон зупинено при переході далі'
        page.evaluate("() => { const r = window.__srs[0]; r.onresult && r.onresult({ results: [[{ transcript: 'week' }]] }); r.onend && r.onend(); }")
        page.wait_for_timeout(100)
        assert page.evaluate('JSON.stringify(window.EW.log)') == r0, 'запізнілий результат не зарахував вправу ' + str(cur)
        assert not visible(page, '.verdict.right'), 'нова вправа не позначена правильною сама'
        # Омофон на слух: weak замість week — підказка значення, ще одна спроба без штрафу
        page.evaluate("window.EW.force('sp-week', 'dictation')"); page.wait_for_timeout(150)
        assert 'тиждень' in page.inner_text('#card .chip-hint'), 'омофон: показано значення'
        page.fill('#card input.answer', 'weak'); click_text(page, 'Перевірити'); page.wait_for_timeout(100)
        assert visible(page, '.alt-note') and 'слабкий' in page.inner_text('.alt-note'), 'пояснення омофона'
        assert not page.is_disabled('#card input.answer'), 'можна виправити'
        page.fill('#card input.answer', 'week'); click_text(page, 'Перевірити'); page.wait_for_timeout(100)
        assert visible(page, '.verdict.right'), 'друга спроба зараховується'
        # Синонім при друці: say замість tell
        page.evaluate("""() => { const t = EWCore.dayNum(); EW.cards['sp-tell'] = { st: 'review', s: 5, d: 5, last: t - 5, due: t, reps: 2, lapses: 0, first: t - 9 }; EW.force('sp-tell', 'type_en'); }""")
        page.wait_for_timeout(150)
        page.fill('#card input.answer', 'say'); click_text(page, 'Перевірити'); page.wait_for_timeout(100)
        assert visible(page, '.alt-note') and 'інше слово' in page.inner_text('.alt-note'), 'синонім: ще спроба'
        page.fill('#card input.answer', 'tell'); click_text(page, 'Перевірити'); page.wait_for_timeout(100)
        assert visible(page, '.verdict.right')
        shot(page, 'light-synonym-retry')
        ctx.close()
        b.close()
finally:
    srv.terminate()

print('exercise types seen:', sorted(k for k in seen_types if not k.endswith('-done')))
if not os.environ.get('E2E_UX_ONLY'):
    for t in ('spell', 'ctx_mcq', 'phrase_fill', 'listen_ex', 'match'):
        assert t + '-light' in seen_types, 'нова вправа не трапилась ботові: ' + t
print('errors:', errors)
assert not errors, errors
print('E2E OK')

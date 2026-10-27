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


def answer(page, wrong=False, scheme='light'):
    cur = page.evaluate('''() => { const c = window.EW.current; if (!c) return null;
        return { id: c.id, ex: c.exercise, w: c.word,
          cloze: (EWCore.clozeTarget(c.word) || {}).text || null,
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
    if ex in ('mcq_en_uk', 'mcq_uk_en', 'listen_mcq'):
        field = 'en' if ex == 'mcq_uk_en' else 'uk'
        btns = page.locator('.opt-btn')
        target = None
        for i in range(btns.count()):
            txt = btns.nth(i).locator('span').nth(1).inner_text()
            if (txt == w[field]) != wrong:
                target = btns.nth(i)
                break
        target.click()
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
    elif ex == 'own_sentence':
        if wrong:
            click_text(page, 'Пропустити')
        else:
            page.fill('textarea.answer', 'I think ' + w['en'].replace('to ', '') + ' is a useful word for work.')
            click_text(page, 'Готово')
    else:
        raise RuntimeError('unknown exercise ' + ex)
    if ex not in ('flip', 'flip_rev', 'speak') and key + '-done' not in seen_types:
        seen_types[key + '-done'] = 1
        page.wait_for_timeout(150)
        shot(page, f'{scheme}-{ex}-b')
    if visible(page, '#foot button:has-text("Далі")'):
        click_text(page, 'Далі')
    return True


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
            page.on('requestfailed', lambda r: errors.append('failed: ' + r.url) if 'fonts.g' not in r.url else None)
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
            assert len(cards) == 10 and all(c['st'] == 'review' for c in cards.values()), cards
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
            for ex_type, check in (('dictation', 'canDictate'), ('build_sentence', 'canBuildSentence'), ('flip', 'canType'), ('own_sentence', 'canDictate')):
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
        page.locator('.opt-btn').filter(has=page.locator('span', has_text=a_uk)).first.click()
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
        page.locator('.opt-btn').filter(has=page.locator('span', has_text=b_uk)).first.click()
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
        click_text(page, 'На головну')
        page.wait_for_timeout(200)
        assert visible(page, '.tabs') and page.evaluate('window.EW.mode') is None
        # Відсіяти знайомі
        page.click('.setup-head:has-text("Відсій")')
        page.wait_for_timeout(200)
        assert page.locator('.tri').count() == 20
        ids = page.evaluate('window.EW.mode') == 'triage'
        page.locator('.tri').nth(0).click(); page.locator('.tri').nth(2).click()
        click_text(page, 'Знаю 2 слова')
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
        ctx.close()
        b.close()
finally:
    srv.terminate()

print('exercise types seen:', sorted(k for k in seen_types if not k.endswith('-done')))
print('errors:', errors)
assert not errors, errors
print('E2E OK')

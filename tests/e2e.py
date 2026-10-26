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
        if visible(page, '.opt-btn'):
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
        for scheme in ['light', 'dark']:
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
        b.close()
finally:
    srv.terminate()

print('exercise types seen:', sorted(k for k in seen_types if not k.endswith('-done')))
print('errors:', errors)
assert not errors, errors
print('E2E OK')

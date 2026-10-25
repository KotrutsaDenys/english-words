# Нотатки для Claude

Сайт English Words для Дениса: вчить англійські слова з телефона (iPhone, часто як програма з головного екрана). Він редагує сайт, пишучи Claude у чаті; деплой автоматичний з `main` через Cloudflare Workers Builds (воркер `english-words`, статичні файли з `public/`).

- Весь текст інтерфейсу українською, без русизмів, дати DD.MM.YYYY. Звертання до користувача в чоловічому роді.
- `id` слів у `public/words.js` не змінювати й не перевикористовувати: прогрес (`ew.cards` у localStorage) прив'язаний до них.
- У кожного слова два приклади (`ex`/`exUk` і `ex2`/`ex2Uk`), вони чергуються за кількістю повторень (`exampleFor` у core.js). Нове слово має отримати обидва. Пари-плутанки (lend/borrow тощо) у `CONFUSABLE` в core.js: не даються в один день, а для вивчених слів стають дистракторами.
- Нові слова → згенерувати озвучку `tools/make_audio.py` (Kokoro, голос `bf_emma`; модель з релізу thewh1teagle/kokoro-onnx `model-files-v1.0`, `pip install kokoro-onnx soundfile`, потрібні ffmpeg і node). Для слів, які пишуться не так, як читаються, додати `say` / `sayEx` / `sayEx2`; перевіряти вимову через `Speaker.phonemes()` у скрипті.
- Додав новий файл, потрібний офлайн → додай його в `CORE` і підніми `CACHE` у `public/sw.js`.
- Логіка й розклад: `public/js/core.js` і `public/js/fsrs.js` (без DOM, тестуються в node). Інтерфейс: `public/js/app.js`.
- Перед комітом: `node tests/core.test.js` і `python3 tests/e2e.py` (Playwright, з `?test=1` сторінка відкриває `window.EW` для тестів).
- Сховище: `ew.cards`, `ew.log` (за днями), `ew.settings`, `ew.custom`, `ew.notes` (асоціації), `ew.own` (власні речення), `ew.meta` (копія, рекорд спринту). Старий формат `ew.progress` мігрує автоматично (`migrateV2`).

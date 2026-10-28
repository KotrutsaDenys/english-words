#!/usr/bin/env python3
"""Ставить ?v=<хеш вмісту> до стилів і скриптів у public/index.html.

Сервіс-воркер віддає такі файли одразу з кешу телефона (сайт відкривається миттєво навіть
без мережі), а після зміни файла хеш інший, і телефон завантажить нову версію.
Запускати після будь-якої зміни в public/*.js, public/js/*.js чи public/app.css:
    python3 tools/stamp.py
tests/core.test.js перевіряє, що хеші актуальні.
"""
import hashlib
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC = os.path.join(ROOT, 'public')
INDEX = os.path.join(PUBLIC, 'index.html')
RX = re.compile(r'(src|href)="(/[^"?]+\.(?:js|css))(?:\?v=[0-9a-f]+)?"')


def file_hash(path):
    with open(path, 'rb') as fh:
        return hashlib.sha1(fh.read()).hexdigest()[:10]


def main():
    html = open(INDEX, encoding='utf-8').read()

    def rep(m):
        full = os.path.join(PUBLIC, m.group(2).lstrip('/'))
        if not os.path.exists(full):
            return m.group(0)
        return f'{m.group(1)}="{m.group(2)}?v={file_hash(full)}"'

    new = RX.sub(rep, html)
    if new != html:
        open(INDEX, 'w', encoding='utf-8').write(new)
        print('index.html: хеші оновлено')
    else:
        print('index.html: без змін')


if __name__ == '__main__':
    main()

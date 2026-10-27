/* English Words: статичні файли віддає Cloudflare з public/, сюди доходять лише інші адреси.
   /reminder.ics — щоденна подія для Календаря iPhone: нагадування вчити слова у вибраний час. */

const TITLE = 'English Words: 10 хвилин слів';

/* Текст для iCalendar: екранування за RFC 5545 */
function esc(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}
/* Рядки довші за 75 байтів переносяться (кирилиця в UTF-8 займає 2 байти, тож рахуємо байти) */
function fold(line) {
  const enc = new TextEncoder();
  const out = [];
  let cur = '', bytes = 0, limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > limit) { out.push(cur); cur = ' '; bytes = 1; limit = 75; }
    cur += ch; bytes += n;
  }
  out.push(cur);
  return out.join('\r\n');
}
function stamp(date) { return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }

export function buildIcs({ time, date, anchor, origin, now }) {
  const [hh, mm] = time.split(':');
  const what = anchor ? anchor.charAt(0).toUpperCase() + anchor.slice(1) + ' — ' : '';
  const desc = what + 'відкрий English Words і зроби заняття. Мало часу? Натисни «Хоч 2 хвилини», серія не обірветься.\n' + origin + '/';
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//English Words//Reminder//UK',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    'UID:ew-reminder-' + date + '-' + hh + mm + '@english-words',
    'DTSTAMP:' + stamp(now || new Date()),
    // Без часового поясу: подія о цій годині там, де телефон
    'DTSTART:' + date + 'T' + hh + mm + '00',
    'DURATION:PT10M',
    'RRULE:FREQ=DAILY',
    'SUMMARY:' + esc(TITLE),
    'DESCRIPTION:' + esc(desc),
    'URL:' + origin + '/',
    'TRANSP:TRANSPARENT',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:' + esc(TITLE),
    'TRIGGER:PT0M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR'
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}

export function parseQuery(url) {
  const t = url.searchParams.get('t') || '19:30';
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(t) ? t : '19:30';
  const d = url.searchParams.get('d') || '';
  let date = /^20\d{6}$/.test(d) ? d : null;
  if (!date) {
    const n = new Date(Date.now() + 86400000);
    date = n.toISOString().slice(0, 10).replace(/-/g, '');
  }
  const anchor = (url.searchParams.get('a') || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 60);
  return { time, date, anchor };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/reminder.ics') {
      const body = buildIcs(Object.assign(parseQuery(url), { origin: url.origin }));
      return new Response(body, {
        headers: {
          'content-type': 'text/calendar; charset=utf-8',
          'content-disposition': 'inline; filename="english-words.ics"',
          'cache-control': 'no-store'
        }
      });
    }
    if (env && env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Not found', { status: 404 });
  }
};

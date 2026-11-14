'use strict';
// Plan-limit messages the CLIs print when the account is out of usage:
//   Claude Code: "You've hit your session limit · resets 1:50pm (Europe/London)", "… · resets Jul 18, 12pm (UTC)",
//                older builds: "Claude AI usage limit reached|1747000000" (epoch seconds)
//   Cursor CLI:  "You've hit your usage limit … Your usage limits will reset when your monthly cycle ends on 10/2/2026."
const LIMIT_RE = /hit your\b[^.\n]*\blimit|usage limit reached/i;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** minutes `tz` is ahead of UTC at instant `ms` (undefined tz = this machine's zone) */
function offsetMin(ms, tz) {
  const p = {};
  for (const x of new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(ms)) p[x.type] = +x.value;
  return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - ms) / 60000);
}
/** wall-clock time in `tz` -> epoch ms (second pass settles DST edges) */
function zoned(y, mo, d, h, mi, tz) {
  const guess = Date.UTC(y, mo, d, h, mi);
  const first = guess - offsetMin(guess, tz) * 60000;
  return guess - offsetMin(first, tz) * 60000;
}

/** null when `text` is not a limit message, else { at }: when it resets (epoch ms), or null when the message gives no time */
function limitReset(text, now = Date.now()) {
  text = String(text || '');
  const epoch = /usage limit reached\|(\d{9,11})/i.exec(text);
  if (epoch) return { at: +epoch[1] * 1000 };
  if (!LIMIT_RE.test(text)) return null;
  const cycle = /cycle ends on (\d{1,2})\/(\d{1,2})\/(\d{4})/i.exec(text);
  if (cycle) return { at: new Date(+cycle[3], cycle[1] - 1, +cycle[2]).getTime() };
  const m = /resets\s+(?:([a-z]{3})[a-z]*\s+(\d{1,2}),?\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*(?:\(([^)]+)\))?/i.exec(text);
  if (!m) return { at: null };
  let tz = m[6];
  try { offsetMin(now, tz); } catch (_) { tz = undefined; }   // unknown zone name: read it as local time
  const h = (+m[3] % 12) + (m[5].toLowerCase() === 'pm' ? 12 : 0), mi = +(m[4] || 0);
  const today = new Date(now + offsetMin(now, tz) * 60000);   // the date as shown in tz, read through the UTC getters
  const mo = m[1] ? MONTHS.indexOf(m[1].toLowerCase()) : today.getUTCMonth();
  if (mo < 0) return { at: null };
  if (m[1]) {
    let at = zoned(today.getUTCFullYear(), mo, +m[2], h, mi, tz);
    if (at < now - 86400000) at = zoned(today.getUTCFullYear() + 1, mo, +m[2], h, mi, tz);
    return { at };
  }
  let at = zoned(today.getUTCFullYear(), mo, today.getUTCDate(), h, mi, tz);
  if (at < now) at = zoned(today.getUTCFullYear(), mo, today.getUTCDate() + 1, h, mi, tz);
  return { at };
}

module.exports = { limitReset };

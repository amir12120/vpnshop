'use strict';
// Zero-dependency Jalali (Persian) calendar conversion for the usage meter,
// so "monthly" chart buckets align to real calendar months instead of fixed
// 30-day windows.
//
// Conversion algorithm: Kazimierz M. Borkowski, "The Persian calendar for
// 3000 years" (1996) — transcribed from jalaali-js (MIT, Behrang Noruzi
// Niya). Exact for Jalaali years -61…3177 and identical to the ECMAScript
// Intl `en-US-u-ca-persian` calendar between Gregorian 1800 and 2256, which
// is the range this app operates in.
//
// All functions operate on LOCAL calendar dates (server timezone) — the same
// basis the Intl fa-IR labels use.

const BREAKS = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635,
  2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];
const MIN_JY = BREAKS[0];
const MAX_JY = BREAKS[BREAKS.length - 1] - 1;

function div(a, b) { return ~~(a / b); }
function mod(a, b) { return a - ~~(a / b) * b; }

// Locate the Jalaali year inside the leap-cycle table; returns the Gregorian
// year and the day of March on which Farvardin 1 falls.
function jalCalCore(jy) {
  if (!Number.isFinite(jy) || jy < MIN_JY || jy > MAX_JY) {
    throw new RangeError(`Invalid Jalaali year ${jy}`);
  }
  const gy = jy + 621;
  let leapJ = -14;
  let jp = BREAKS[0];
  let jm = 0;
  let jump = 0;
  for (let i = 1; i < BREAKS.length; i += 1) {
    jm = BREAKS[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ += div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  const n = jy - jp;
  leapJ += div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  return { gy, march, jump, n };
}

// Number of years since the last leap year (0 = the year itself is leap).
function leapFromCycle(jump, n) {
  let adjusted = n;
  if (jump - n < 6) adjusted = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(adjusted + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return leap;
}

// Jalali y/m/d -> Julian Day number
function j2d(jy, jm, jd) {
  const r = jalCalCore(jy);
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}

// Gregorian y/m/d (m 1-12) -> Julian Day number
function g2d(gy, gm, gd) {
  let d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4) +
    div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}

// Julian Day number -> Gregorian y/m/d
function d2g(jdn) {
  let j = 4 * jdn + 139361631;
  j += div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}

// Julian Day number -> Jalali y/m/d
function d2j(jdn) {
  const gy = d2g(jdn).gy;
  let jy = Math.min(gy - 621, MAX_JY);
  const r = jalCalCore(jy);
  const leap = leapFromCycle(r.jump, r.n);
  const jdn1f = g2d(r.gy, 3, r.march);
  let k = jdn - jdn1f;
  if (k >= 0) {
    if (k <= 185) return { jy, jm: 1 + div(k, 31), jd: mod(k, 31) + 1 };
    k -= 186;
  } else {
    jy -= 1;
    k += 179;
    if (leap === 1) k += 1; // the year before the leap cycle ran long
  }
  return { jy, jm: 7 + div(k, 30), jd: mod(k, 30) + 1 };
}

// ── public helpers (local time) ────────────────────────────────────────────

// Gregorian Date (local) -> Jalali { jy, jm, jd }
function dateToJalali(d) {
  return d2j(g2d(d.getFullYear(), d.getMonth() + 1, d.getDate()));
}

// Unix seconds -> Jalali { jy, jm, jd }
function tsToJalali(ts) {
  return dateToJalali(new Date(ts * 1000));
}

// Jalali y/m/d -> local Date at 00:00
function jalaliToDate(jy, jm, jd) {
  const g = d2g(j2d(jy, jm, jd));
  return new Date(g.gy, g.gm - 1, g.gd);
}

// Sequential month index of a Jalali year-month and its inverse.
function monthIndexOf(jy, jm) { return jy * 12 + (jm - 1); }
function yearMonthOf(idx) { return { jy: Math.floor(idx / 12), jm: (idx % 12) + 1 }; }

module.exports = {
  dateToJalali, tsToJalali, jalaliToDate, monthIndexOf, yearMonthOf,
  // low-level exports (round-trip tests)
  d2j, j2d, g2d, d2g, jdnOf: (d) => g2d(d.getFullYear(), d.getMonth() + 1, d.getDate()),
};

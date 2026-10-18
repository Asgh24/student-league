import { describe, expect, it } from 'vitest';
import {
  formatJalaliDate,
  isJalaliLeap,
  isoDateToJalali,
  isValidJalaliDate,
  jalaliMonthLength,
  jalaliToIsoDate,
  jalaliToJdn,
  jalaliWeekdayIndex,
  jdnToJalali,
  toJalali,
} from '../src/lib/jalali.js';

describe('Gregorian to Jalali conversion', () => {
  it('converts well known historical dates', () => {
    expect(toJalali(1979, 2, 11)).toEqual({ jy: 1357, jm: 11, jd: 22 });
    expect(toJalali(2000, 1, 1)).toEqual({ jy: 1378, jm: 10, jd: 11 });
  });

  it('converts Nowruz for several years', () => {
    expect(toJalali(2021, 3, 21)).toEqual({ jy: 1400, jm: 1, jd: 1 });
    expect(toJalali(2024, 3, 20)).toEqual({ jy: 1403, jm: 1, jd: 1 });
    expect(toJalali(2025, 3, 21)).toEqual({ jy: 1404, jm: 1, jd: 1 });
    expect(toJalali(2026, 3, 21)).toEqual({ jy: 1405, jm: 1, jd: 1 });
  });

  it('converts a mid year date used by the UI', () => {
    expect(isoDateToJalali('2026-08-01')).toEqual({ jy: 1405, jm: 5, jd: 10 });
  });

  it('round trips every day of leap and normal years', () => {
    for (const jy of [1399, 1403, 1404]) {
      const daysInYear = isJalaliLeap(jy) ? 366 : 365;
      for (let offset = 0; offset < daysInYear; offset += 1) {
        const jdn = jalaliToJdn(jy, 1, 1) + offset;
        const parts = jdnToJalali(jdn);
        // julian day -> jalali -> julian day is an identity
        expect(jalaliToJdn(parts.jy, parts.jm, parts.jd)).toBe(jdn);
        // jalali -> gregorian iso -> jalali is an identity as well
        const iso = jalaliToIsoDate(parts.jy, parts.jm, parts.jd);
        expect(isoDateToJalali(iso)).toEqual(parts);
      }
    }
  });

  it('keeps Jalali day numbers contiguous across the year boundary', () => {
    expect(jalaliToJdn(1403, 12, 30) + 1).toBe(jalaliToJdn(1404, 1, 1));
    expect(jalaliToJdn(1404, 12, 29) + 1).toBe(jalaliToJdn(1405, 1, 1));
  });

  it('keeps Jalali day numbers contiguous across mid year month boundaries', () => {
    expect(jalaliToJdn(1405, 6, 31) + 1).toBe(jalaliToJdn(1405, 7, 1));
    expect(jalaliToJdn(1405, 11, 30) + 1).toBe(jalaliToJdn(1405, 12, 1));
  });

  it('survives an Esfand to Farvardin walk across a leap year', () => {
    let jdn = jalaliToJdn(1403, 12, 25);
    const seen = [];
    for (let i = 0; i < 10; i += 1) {
      seen.push(jdnToJalali(jdn));
      jdn += 1;
    }
    expect(seen[0]).toEqual({ jy: 1403, jm: 12, jd: 25 });
    expect(seen[5]).toEqual({ jy: 1403, jm: 12, jd: 30 });
    expect(seen[6]).toEqual({ jy: 1404, jm: 1, jd: 1 });
    expect(seen[9]).toEqual({ jy: 1404, jm: 1, jd: 4 });
  });
});

describe('Jalali leap years and month lengths', () => {
  it('detects the 33 year leap cycle', () => {
    expect(isJalaliLeap(1399)).toBe(1);
    expect(isJalaliLeap(1403)).toBe(1);
    expect(isJalaliLeap(1400)).toBe(0);
    expect(isJalaliLeap(1401)).toBe(0);
    expect(isJalaliLeap(1402)).toBe(0);
    expect(isJalaliLeap(1404)).toBe(0);
  });

  it('knows the length of every month', () => {
    expect(jalaliMonthLength(1405, 1)).toBe(31);
    expect(jalaliMonthLength(1405, 6)).toBe(31);
    expect(jalaliMonthLength(1405, 7)).toBe(30);
    expect(jalaliMonthLength(1405, 11)).toBe(30);
    expect(jalaliMonthLength(1403, 12)).toBe(30);
    expect(jalaliMonthLength(1404, 12)).toBe(29);
  });

  it('spaces Nowruz by 365 or 366 days matching the leap flag', () => {
    for (let jy = 1395; jy <= 1410; jy += 1) {
      const gap = jalaliToJdn(jy + 1, 1, 1) - jalaliToJdn(jy, 1, 1);
      expect(gap).toBe(isJalaliLeap(jy) ? 366 : 365);
    }
  });

  it('validates jalali dates', () => {
    expect(isValidJalaliDate(1403, 12, 30)).toBe(true);
    expect(isValidJalaliDate(1404, 12, 30)).toBe(false);
    expect(isValidJalaliDate(1405, 13, 1)).toBe(false);
    expect(isValidJalaliDate(1405, 7, 31)).toBe(false);
  });
});

describe('formatting helpers', () => {
  it('formats an ISO timestamp as a Persian date', () => {
    expect(formatJalaliDate('2026-08-01T10:20:30.000Z')).toBe('۱۴۰۵/۰۵/۱۰');
  });

  it('can keep latin digits and append the time', () => {
    expect(formatJalaliDate('2026-08-01T10:20:30.000Z', { digits: 'en' })).toBe('1405/05/10');
    expect(formatJalaliDate('2026-08-01T10:20:30.000Z', { digits: 'en', withTime: true })).toBe('1405/05/10 - 10:20');
  });

  it('converts Jalali parts back to an ISO calendar date', () => {
    expect(jalaliToIsoDate(1405, 1, 1)).toBe('2026-03-21');
    expect(jalaliToIsoDate(1405, 5, 10)).toBe('2026-08-01');
  });

  it('returns an empty string for invalid input', () => {
    expect(formatJalaliDate(null)).toBe('');
    expect(formatJalaliDate('not-a-date')).toBe('');
  });

  it('maps Gregorian days to Jalali weekday indexes where 0 is Saturday', () => {
    expect(jalaliWeekdayIndex('2026-08-01T00:00:00Z')).toBe(0);
    expect(jalaliWeekdayIndex('2026-08-02T00:00:00Z')).toBe(1);
    expect(jalaliWeekdayIndex('2026-08-07T00:00:00Z')).toBe(6);
  });
});

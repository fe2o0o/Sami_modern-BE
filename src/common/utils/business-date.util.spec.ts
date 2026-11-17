import { addDaysIso, businessToday, businessTodayDate, businessYear } from './business-date.util';

describe('business date (Egypt)', () => {
  it('00:58 Cairo on 16/11 is 16/11, although UTC is still 15/11', () => {
    const at = new Date('2026-11-15T22:58:00Z'); // Cairo = UTC+2 in November
    expect(businessToday(at)).toBe('2026-11-16');
  });

  it('month end: 00:30 Cairo on 1 December is in December, not November', () => {
    expect(businessToday(new Date('2026-11-30T22:30:00Z'))).toBe('2026-12-01');
  });

  it('year end: the Egyptian year changes at Cairo midnight', () => {
    const at = new Date('2026-12-31T22:30:00Z');
    expect(businessToday(at)).toBe('2027-01-01');
    expect(businessYear(at)).toBe(2027);
  });

  it('daytime is the same day in both', () => {
    expect(businessToday(new Date('2026-11-16T10:00:00Z'))).toBe('2026-11-16');
  });

  it('local Date carries the Egyptian calendar date', () => {
    const d = businessTodayDate(new Date('2026-11-15T22:58:00Z'));
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([2026, 11, 16]);
  });

  it('adds days across month and year ends', () => {
    expect(addDaysIso('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDaysIso('2026-12-31', 30)).toBe('2027-01-30');
    expect(addDaysIso('2026-03-01', -1)).toBe('2026-02-28');
  });
});

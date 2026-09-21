import { describe, expect, it } from 'vitest';
import { monthKey, recordImport, usageThisMonth } from './usage';
import { FREE_ENTITLEMENTS, PlanEntitlements } from './index';

const JAN = new Date('2026-01-15T12:00:00Z');
const FEB = new Date('2026-02-01T00:00:00Z');

describe('monthKey', () => {
  it('buckets by UTC month', () => {
    expect(monthKey(JAN)).toBe('2026-01');
    expect(monthKey(new Date('2026-12-31T23:59:59Z'))).toBe('2026-12');
  });

  it('uses UTC, not the device timezone', () => {
    // A device-local boundary would reset the allowance at a different instant per
    // user, and crossing a date line could roll it backwards.
    expect(monthKey(new Date('2026-02-01T00:30:00Z'))).toBe('2026-02');
    expect(monthKey(new Date('2026-01-31T23:30:00Z'))).toBe('2026-01');
  });
});

describe('usageThisMonth', () => {
  it('counts nothing when there is no stored usage', () => {
    expect(usageThisMonth(null, JAN)).toBe(0);
  });

  it('counts usage recorded in the same month', () => {
    expect(usageThisMonth({ month: '2026-01', count: 3 }, JAN)).toBe(3);
  });

  it('ignores a count from a previous month', () => {
    // The allowance resets; last month's usage simply stops applying.
    expect(usageThisMonth({ month: '2026-01', count: 99 }, FEB)).toBe(0);
  });
});

describe('recordImport', () => {
  it('starts a fresh bucket when nothing is stored', () => {
    expect(recordImport(null, JAN)).toEqual({ month: '2026-01', count: 1 });
  });

  it('increments within the same month', () => {
    expect(recordImport({ month: '2026-01', count: 2 }, JAN)).toEqual({
      month: '2026-01',
      count: 3,
    });
  });

  it('rolls over rather than accumulating across months', () => {
    expect(recordImport({ month: '2026-01', count: 40 }, FEB)).toEqual({
      month: '2026-02',
      count: 1,
    });
  });
});

describe('PlanEntitlements', () => {
  it('gates nothing today, because the free limit is null', () => {
    // PRD §34: no paywall before repeated import → workout behaviour is validated.
    const service = new PlanEntitlements();
    expect(FREE_ENTITLEMENTS.monthlyAiImportLimit).toBeNull();
    expect(service.canImport(0)).toBe(true);
    expect(service.canImport(10_000)).toBe(true);
    expect(service.remaining(5)).toBeNull();
  });

  it('enforces a limit the moment one is set', () => {
    // The point of the fix: introducing a limit is a one-line change, not a feature
    // to build under time pressure.
    const limited = new PlanEntitlements({ plan: 'free', monthlyAiImportLimit: 3 });

    expect(limited.canImport(0)).toBe(true);
    expect(limited.canImport(2)).toBe(true);
    expect(limited.canImport(3)).toBe(false);
    expect(limited.canImport(4)).toBe(false);

    expect(limited.remaining(0)).toBe(3);
    expect(limited.remaining(3)).toBe(0);
    // Never negative, even if usage somehow exceeded the limit.
    expect(limited.remaining(9)).toBe(0);
  });

  it('lets a limited user through again after the month rolls over', () => {
    const limited = new PlanEntitlements({ plan: 'free', monthlyAiImportLimit: 3 });
    const exhausted = { month: '2026-01', count: 3 };

    expect(limited.canImport(usageThisMonth(exhausted, JAN))).toBe(false);
    expect(limited.canImport(usageThisMonth(exhausted, FEB))).toBe(true);
  });
});

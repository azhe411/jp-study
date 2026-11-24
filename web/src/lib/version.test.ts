import { describe, expect, it } from 'vitest';
import { compareSemver, isOutdated } from './version';

describe('compareSemver', () => {
  it('逐段按数值比较，不按字符串', () => {
    expect(compareSemver('0.10.0', '0.9.9')).toBe(1);
    expect(compareSemver('0.3.2', '0.3.2')).toBe(0);
    expect(compareSemver('0.3.2', '0.4.0')).toBe(-1);
  });
});

describe('isOutdated', () => {
  it('未声明最低版本时不提示', () => {
    expect(isOutdated(undefined, '0.0.1')).toBe(false);
  });
  it('低于最低版本才提示', () => {
    expect(isOutdated('0.4.0', '0.3.2')).toBe(true);
    expect(isOutdated('0.4.0', '0.4.0')).toBe(false);
  });
});

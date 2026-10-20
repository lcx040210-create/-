import { describe, expect, it } from 'vitest';
import { feeOf, payoutOf, withdrawalPreview } from './format';

describe('payoutOf（到手价 = P − floor(P×5%)）', () => {
  it('P=100 → "95"', () => {
    expect(payoutOf('100')).toBe('95');
  });

  it('P=33 → "31.35"（fee 精确到 micro 后从总额扣除）', () => {
    expect(payoutOf('33')).toBe('31.35');
  });
});

describe('withdrawalPreview（提现手续费 10% floor）', () => {
  it('50 → {fee:"5", payout:"45"}', () => {
    expect(withdrawalPreview('50')).toEqual({ fee: '5', payout: '45' });
  });

  it('90 → {fee:"9", payout:"81"}', () => {
    expect(withdrawalPreview('90')).toEqual({ fee: '9', payout: '81' });
  });
});

describe('feeOf（与后端 pctFloor 同口径）', () => {
  it('P=33.333333 的 5% → "1.666666"（向下取整到 micro）', () => {
    expect(feeOf('33.333333', 5)).toBe('1.666666');
  });

  it('零头留给用户侧：0.000001 的 5% → "0"', () => {
    expect(feeOf('0.000001', 5)).toBe('0');
  });
});

describe('非法输入', () => {
  it('超过 6 位小数抛错', () => {
    expect(() => feeOf('1.0000001', 5)).toThrow(RangeError);
    expect(() => payoutOf('1.0000001')).toThrow(RangeError);
    expect(() => withdrawalPreview('1.0000001')).toThrow(RangeError);
  });

  it('负数、空串、非十进制字符串抛错', () => {
    for (const bad of ['-5', '', 'abc', '1,5', '1.', '.5']) {
      expect(() => payoutOf(bad)).toThrow(RangeError);
    }
  });

  it('非法费率抛错', () => {
    expect(() => feeOf('10', -5)).toThrow(RangeError);
    expect(() => feeOf('10', Number.NaN)).toThrow(RangeError);
  });
});

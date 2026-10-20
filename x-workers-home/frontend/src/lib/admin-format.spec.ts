import { describe, expect, it } from 'vitest';
import { formatMicro } from './admin-format';

describe('formatMicro（micro 整数串 → 十进制 XM）', () => {
  it('整数 micro 转十进制并去掉尾零', () => {
    expect(formatMicro('1234567')).toBe('1.234567');
    expect(formatMicro('5000000')).toBe('5');
    expect(formatMicro('0')).toBe('0');
  });

  it('支持超过 Number.MAX_SAFE_INTEGER 的大整数', () => {
    expect(formatMicro('9007199254740991000000')).toBe('9007199254740991');
  });

  it('负值（收入分项支出/净额）保留符号', () => {
    expect(formatMicro('-1500000')).toBe('-1.5');
  });

  it('空值按 0；非法串原样返回', () => {
    expect(formatMicro(null)).toBe('0');
    expect(formatMicro(undefined)).toBe('0');
    expect(formatMicro('')).toBe('0');
    expect(formatMicro('1.5')).toBe('1.5');
    expect(formatMicro('bad')).toBe('bad');
  });
});

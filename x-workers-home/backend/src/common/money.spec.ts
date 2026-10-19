import { MICRO, formatXm, fromWei18, parseXm, pctFloor } from './money';

describe('money（micro-XM 金额工具）', () => {
  describe('pctFloor', () => {
    it('50 XM 的 5% = 2.5 XM', () => {
      expect(pctFloor(50_000_000n, 5, 100)).toBe(2_500_000n);
    });

    it('向下取整，不四舍五入', () => {
      expect(pctFloor(33_333_333n, 5, 100)).toBe(1_666_666n);
    });

    it('0 金额 → 0；结果类型始终是 bigint', () => {
      expect(pctFloor(0n, 5, 100)).toBe(0n);
      expect(pctFloor(10n * MICRO + 1n, 10, 100)).toBe(1_000_000n);
      expect(typeof pctFloor(1n, 5, 100)).toBe('bigint');
    });
  });

  describe('parseXm', () => {
    it('整数 / 小数 → micro', () => {
      expect(parseXm('100')).toBe(100_000_000n);
      expect(parseXm('100.5')).toBe(100_500_000n);
      expect(parseXm('0.000001')).toBe(1n);
      expect(parseXm('0')).toBe(0n);
      expect(typeof parseXm('1')).toBe('bigint');
    });

    it('超过 6 位小数 → 抛错', () => {
      expect(() => parseXm('0.0000001')).toThrow();
      expect(() => parseXm('1.1234567')).toThrow();
    });

    it('负数 / 空串 / 非十进制格式 → 抛错', () => {
      expect(() => parseXm('-1')).toThrow();
      expect(() => parseXm('')).toThrow();
      expect(() => parseXm('   ')).toThrow();
      expect(() => parseXm('abc')).toThrow();
      expect(() => parseXm('1.2.3')).toThrow();
      expect(() => parseXm('1e6')).toThrow();
      expect(() => parseXm('.5')).toThrow();
    });
  });

  describe('formatXm', () => {
    it('micro → 十进制字符串（去尾零）', () => {
      expect(formatXm(100_500_000n)).toBe('100.5');
      expect(formatXm(100_000_000n)).toBe('100');
      expect(formatXm(0n)).toBe('0');
      expect(formatXm(1n)).toBe('0.000001');
      expect(formatXm(1_500_000n)).toBe('1.5');
    });

    it('负数也能格式化（仅用于展示/日志）', () => {
      expect(formatXm(-100_500_000n)).toBe('-100.5');
    });
  });

  describe('fromWei18', () => {
    it('18 位小数字符串 → micro，向下取整', () => {
      expect(fromWei18('100.123456789012345678')).toBe(100_123_456n);
      expect(fromWei18('1')).toBe(1_000_000n);
      expect(fromWei18('0.000001')).toBe(1n);
      expect(fromWei18('0.000000999999999999')).toBe(0n);
      expect(fromWei18('0')).toBe(0n);
      expect(typeof fromWei18('1.5')).toBe('bigint');
    });

    it('>18 位小数 / 负数 / 空串 / 非数字 → 抛错', () => {
      expect(() => fromWei18('1.0000000000000000001')).toThrow();
      expect(() => fromWei18('-1')).toThrow();
      expect(() => fromWei18('')).toThrow();
      expect(() => fromWei18('abc')).toThrow();
      expect(() => fromWei18('1e18')).toThrow();
    });
  });
});

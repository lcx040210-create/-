import { describe, expect, it } from 'vitest';
import { formatRemaining } from './countdown';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

describe('formatRemaining（倒计时纯函数）', () => {
  it('3 小时窗口起始显示 2:59:59（向下取整到秒）', () => {
    expect(formatRemaining(3 * HOUR, 0)).toEqual({
      text: '2:59:59',
      urgent: false,
    });
  });

  it('剩余 9 分 59 秒（含半秒）→ urgent', () => {
    const deadline = 10 * MINUTE - 500;
    expect(formatRemaining(deadline, 0)).toEqual({
      text: '0:09:59',
      urgent: true,
    });
  });

  it('恰好 10 分钟仍不 urgent，10 分钟差 1ms 才 urgent', () => {
    expect(formatRemaining(10 * MINUTE, 0)).toEqual({
      text: '0:09:59',
      urgent: false,
    });
    expect(formatRemaining(10 * MINUTE - 1, 0).urgent).toBe(true);
  });

  it('剩余 1 小时 2 分 3 秒（含半秒）格式为 1:02:03', () => {
    expect(formatRemaining(HOUR + 2 * MINUTE + 3 * SECOND + 500, 0)).toEqual({
      text: '1:02:03',
      urgent: false,
    });
  });

  it('负数 / 恰好到期 → 已超时', () => {
    expect(formatRemaining(1 * SECOND, 2 * SECOND)).toEqual({
      text: '已超时',
      urgent: true,
    });
    expect(formatRemaining(5 * SECOND, 5 * SECOND)).toEqual({
      text: '已超时',
      urgent: true,
    });
  });

  it('非有限数 → 已超时（防御非法 deadline）', () => {
    expect(formatRemaining(Number.NaN, 0)).toEqual({
      text: '已超时',
      urgent: true,
    });
  });
});

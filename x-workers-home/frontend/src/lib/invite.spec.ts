import { describe, expect, it } from 'vitest';
import { tierProgress } from './invite';
import { buildInviteUrl, normalizeBaseUrl, resolveSiteUrl } from './site';
import { formatComponent, formatJoined } from './users';

describe('tierProgress（20% → 30% 满 5 人 → 40% 满 10 人）', () => {
  it('0 人：20%，距下一档还差 5 人', () => {
    expect(tierProgress(0)).toEqual({
      tier: 20,
      nextTier: 30,
      remaining: 5,
      text: '距下一档还差 5 人（30%）',
      percent: 0,
    });
  });

  it('4 人：仍是 20%，还差 1 人', () => {
    expect(tierProgress(4)).toMatchObject({ tier: 20, nextTier: 30, remaining: 1 });
  });

  it('5 人：升到 30%，距 40% 还差 5 人', () => {
    expect(tierProgress(5)).toMatchObject({
      tier: 30,
      nextTier: 40,
      remaining: 5,
      percent: 50,
    });
  });

  it('9 人：还差 1 人升 40%', () => {
    expect(tierProgress(9)).toMatchObject({ tier: 30, nextTier: 40, remaining: 1 });
  });

  it('10 人及以上：40%，已达最高档', () => {
    expect(tierProgress(10)).toEqual({
      tier: 40,
      nextTier: null,
      remaining: 0,
      text: '已达最高档位（40%）',
      percent: 100,
    });
    expect(tierProgress(25).tier).toBe(40);
  });

  it('非法 / 负值按 0 处理', () => {
    expect(tierProgress(-3).tier).toBe(20);
    expect(tierProgress(Number.NaN).remaining).toBe(5);
  });
});

describe('站点链接拼接（尾斜杠）', () => {
  it('normalizeBaseUrl 去掉所有尾斜杠', () => {
    expect(normalizeBaseUrl('http://localhost:4000///')).toBe('http://localhost:4000');
  });

  it('空值 / 空白回落到默认站点地址', () => {
    expect(resolveSiteUrl('  ')).toBe('http://localhost:4000');
    expect(resolveSiteUrl(undefined)).toBe('http://localhost:4000');
    expect(resolveSiteUrl('https://xwh.example/')).toBe('https://xwh.example');
  });

  it('邀请链接为 /login?ref=CODE，且不出现双斜杠', () => {
    expect(buildInviteUrl('AB12CD', 'https://xwh.example/')).toBe(
      'https://xwh.example/login?ref=AB12CD',
    );
    expect(buildInviteUrl('AB 12', 'http://localhost:4000')).toBe(
      'http://localhost:4000/login?ref=AB%2012',
    );
  });
});

describe('公开主页格式化', () => {
  it('formatJoined 按北京时间输出年月日', () => {
    expect(formatJoined('2026-08-01T03:04:05.000Z')).toBe('2026年8月1日');
    expect(formatJoined(null)).toBe('—');
    expect(formatJoined('not-a-date')).toBe('—');
  });

  it('formatComponent 输出百分数并夹在 0-100%', () => {
    expect(formatComponent(0.4567)).toBe('45.7%');
    expect(formatComponent(0)).toBe('0.0%');
    expect(formatComponent(1)).toBe('100.0%');
    expect(formatComponent(1.5)).toBe('100.0%');
    expect(formatComponent(Number.NaN)).toBe('—');
  });
});

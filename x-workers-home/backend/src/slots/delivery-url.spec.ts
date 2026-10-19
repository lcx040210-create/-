import { BadRequestException } from '@nestjs/common';
import { canonicalizeDeliveryUrl, extractDeliveryTweetId } from './delivery-url';

describe('canonicalizeDeliveryUrl（纯函数）', () => {
  it('x.com 推文链接原样规范化', () => {
    expect(canonicalizeDeliveryUrl('https://x.com/alice/status/123456')).toBe(
      'https://x.com/alice/status/123456',
    );
  });

  it('twitter.com / www / mobile / m 子域统一为 x.com', () => {
    for (const host of [
      'twitter.com',
      'www.twitter.com',
      'mobile.twitter.com',
      'm.x.com',
      'www.x.com',
    ]) {
      expect(canonicalizeDeliveryUrl(`https://${host}/alice/status/42`)).toBe(
        'https://x.com/alice/status/42',
      );
    }
  });

  it('handle 小写、去掉查询串 / 锚点 / 尾斜杠', () => {
    expect(
      canonicalizeDeliveryUrl(
        'http://www.twitter.com/Alice/status/987654321/?s=20&t=abc#top',
      ),
    ).toBe('https://x.com/alice/status/987654321');
  });

  it('/i/web/status/<id> 保持该形式', () => {
    expect(
      canonicalizeDeliveryUrl('https://twitter.com/i/web/status/555000111?lang=en'),
    ).toBe('https://x.com/i/web/status/555000111');
  });

  it('非 X 域 → 400', () => {
    expect(() => canonicalizeDeliveryUrl('https://example.com/alice/status/1')).toThrow(
      BadRequestException,
    );
    expect(() => canonicalizeDeliveryUrl('https://notx.com/a/status/1')).toThrow(
      BadRequestException,
    );
  });

  it('X 域但非状态链接（个人主页 / 搜索 / 非法 id）→ 400', () => {
    for (const url of [
      'https://x.com/alice',
      'https://x.com/alice/',
      'https://x.com/search?q=abc',
      'https://x.com/alice/status/abc',
      'https://x.com/alice/status/',
      'https://x.com/i/status/123',
      'https://x.com/alice/status/123/photo/1',
    ]) {
      expect(() => canonicalizeDeliveryUrl(url)).toThrow(BadRequestException);
    }
  });

  it('空串 / 非法 URL / 非 http(s) 协议 → 400', () => {
    for (const raw of ['', '   ', 'not a url', 'ftp://x.com/alice/status/1']) {
      expect(() => canonicalizeDeliveryUrl(raw)).toThrow(BadRequestException);
    }
  });

  it('带端口的非标准地址 → 400', () => {
    expect(() => canonicalizeDeliveryUrl('https://x.com:8443/alice/status/1')).toThrow(
      BadRequestException,
    );
  });
});

describe('extractDeliveryTweetId（纯函数）', () => {
  it('handle 形式与 /i/web/ 形式提取同一 tweet id', () => {
    expect(extractDeliveryTweetId('https://x.com/someone/status/812345678901234567')).toBe(
      '812345678901234567',
    );
    expect(extractDeliveryTweetId('https://x.com/i/web/status/812345678901234567')).toBe(
      '812345678901234567',
    );
  });

  it('非规范形式 / 空值 → null', () => {
    expect(extractDeliveryTweetId('https://x.com/someone')).toBeNull();
    expect(extractDeliveryTweetId('https://x.com/someone/status/abc')).toBeNull();
    expect(extractDeliveryTweetId('')).toBeNull();
  });
});

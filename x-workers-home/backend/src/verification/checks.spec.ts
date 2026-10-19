import { OrderRequirements, OrderType } from '../orders/order.entity';
import { XTweet } from '../xscraper/xscraper.types';
import { evaluateDelivery } from './checks';

function tweet(partial: Partial<XTweet> = {}): XTweet {
  return { id: '1', ...partial } as XTweet;
}

function requirements(partial: Partial<OrderRequirements> = {}): OrderRequirements {
  return {
    keywords: [],
    hashtags: [],
    mentions: [],
    links: [],
    ...partial,
  };
}

function expectOk(
  partial: Partial<XTweet>,
  opts: {
    handle?: string;
    type?: OrderType;
    requirements?: Partial<OrderRequirements>;
  } = {},
) {
  return evaluateDelivery(tweet(partial), {
    handle: opts.handle ?? 'alice',
    type: opts.type ?? 'post',
    requirements: requirements(opts.requirements),
  });
}

describe('evaluateDelivery（纯函数）', () => {
  describe('作者', () => {
    it('作者 handle 与绑定 handle 小写相等 → 通过', () => {
      const result = expectOk({ author: { handle: 'alice' }, text: 'hello' });
      expect(result).toEqual({ ok: true, reasons: [] });
    });

    it('大小写不敏感：绑定 alice / 推文 Alice → 通过', () => {
      const result = expectOk({ author: { handle: 'Alice' }, text: 'hello' });
      expect(result.ok).toBe(true);
    });

    it('绑定 handle 带 @ 前缀也能匹配', () => {
      const result = expectOk(
        { author: { handle: 'alice' }, text: 'hello' },
        { handle: '@Alice' },
      );
      expect(result.ok).toBe(true);
    });

    it('作者不一致 → author_mismatch', () => {
      const result = expectOk({ author: { handle: 'bob' }, text: 'hello' });
      expect(result.ok).toBe(false);
      expect(result.reasons).toContain('author_mismatch');
    });

    it('推文缺少 author（clean() 丢字段）→ author_mismatch', () => {
      const result = expectOk({ text: 'hello' });
      expect(result.reasons).toContain('author_mismatch');
    });
  });

  describe('长度', () => {
    it('10 字符评论（==10）不过、11 字符过', () => {
      const ten = expectOk(
        { author: { handle: 'alice' }, text: 'a'.repeat(10) },
        { type: 'comment' },
      );
      expect(ten.reasons).toContain('too_short');

      const eleven = expectOk(
        { author: { handle: 'alice' }, text: 'a'.repeat(11) },
        { type: 'comment' },
      );
      expect(eleven.ok).toBe(true);
    });

    it('quote 默认同样要求 11 字符；post 默认只要求 1 字符', () => {
      expect(
        expectOk({ author: { handle: 'alice' }, text: 'a'.repeat(10) }, { type: 'quote' })
          .reasons,
      ).toContain('too_short');
      expect(
        expectOk({ author: { handle: 'alice' }, text: 'a' }, { type: 'post' }).ok,
      ).toBe(true);
    });

    it('post 空文本 → too_short；text 缺失按空串处理', () => {
      expect(
        expectOk({ author: { handle: 'alice' }, text: '' }, { type: 'post' }).reasons,
      ).toContain('too_short');
      expect(
        expectOk({ author: { handle: 'alice' } }, { type: 'post' }).reasons,
      ).toContain('too_short');
    });

    it('requirements.minChars 覆盖类型默认值', () => {
      const result = expectOk(
        { author: { handle: 'alice' }, text: 'a'.repeat(20) },
        { type: 'comment', requirements: { minChars: 21 } },
      );
      expect(result.reasons).toContain('too_short');

      const relaxed = expectOk(
        { author: { handle: 'alice' }, text: 'a'.repeat(5) },
        { type: 'comment', requirements: { minChars: 5 } },
      );
      expect(relaxed.ok).toBe(true);

      // minChars 也可用于 post 收紧
      const stricterPost = expectOk(
        { author: { handle: 'alice' }, text: 'a'.repeat(10) },
        { type: 'post', requirements: { minChars: 20 } },
      );
      expect(stricterPost.reasons).toContain('too_short');
    });
  });

  describe('关键词 / 话题标签 / @提及', () => {
    it('关键词大小写不敏感：要求 "Alpha" / 正文含 "alpha" → 过', () => {
      const result = expectOk(
        { author: { handle: 'alice' }, text: 'the ALPHA is here' },
        { requirements: { keywords: ['Alpha'] } },
      );
      expect(result.ok).toBe(true);
    });

    it('关键词缺失 → missing:关键词', () => {
      const result = expectOk(
        { author: { handle: 'alice' }, text: 'nothing relevant' },
        { requirements: { keywords: ['alpha', 'beta'] } },
      );
      expect(result.reasons).toEqual(
        expect.arrayContaining(['missing:alpha', 'missing:beta']),
      );
    });

    it('话题标签 #XWH 缺失 → reasons 含 missing:#XWH（保留大小写）', () => {
      const result = expectOk(
        { author: { handle: 'alice' }, text: 'no tag here' },
        { requirements: { hashtags: ['#XWH'] } },
      );
      expect(result.reasons).toContain('missing:#XWH');
    });

    it('话题标签大小写不敏感，且要求未带 # 时自动补前缀比较', () => {
      const withHash = expectOk(
        { author: { handle: 'alice' }, text: 'join #xwh now' },
        { requirements: { hashtags: ['#XWH'] } },
      );
      expect(withHash.ok).toBe(true);

      const withoutHash = expectOk(
        { author: { handle: 'alice' }, text: 'join #XWH now' },
        { requirements: { hashtags: ['xwh'] } },
      );
      expect(withoutHash.ok).toBe(true);
    });

    it('@提及缺失 → missing:提及；要求未带 @ 时自动补前缀比较', () => {
      const noMention = expectOk(
        { author: { handle: 'alice' }, text: 'hello world' },
        { requirements: { mentions: ['@bob'] } },
      );
      expect(noMention.reasons).toContain('missing:@bob');

      const match = expectOk(
        { author: { handle: 'alice' }, text: 'thanks @Bob!' },
        { requirements: { mentions: ['bob'] } },
      );
      expect(match.ok).toBe(true);
    });
  });

  describe('链接', () => {
    it('链接忽略尾斜杠：要求 "x.com/a" / 正文 "x.com/a/" → 过', () => {
      const result = expectOk(
        { author: { handle: 'alice' }, text: 'see https://x.com/a/ here' },
        { requirements: { links: ['x.com/a'] } },
      );
      expect(result.ok).toBe(true);
    });

    it('链接要求带尾斜杠、正文不带 → 也通过', () => {
      const result = expectOk(
        { author: { handle: 'alice' }, text: 'see https://x.com/a here' },
        { requirements: { links: ['x.com/a/'] } },
      );
      expect(result.ok).toBe(true);
    });

    it('链接大小写不敏感', () => {
      const result = expectOk(
        { author: { handle: 'alice' }, text: 'see https://X.COM/Alpha/Beta' },
        { requirements: { links: ['x.com/alpha/beta'] } },
      );
      expect(result.ok).toBe(true);
    });

    it('链接缺失 → missing_link:链接', () => {
      const result = expectOk(
        { author: { handle: 'alice' }, text: 'no links' },
        { requirements: { links: ['x.com/a'] } },
      );
      expect(result.reasons).toContain('missing_link:x.com/a');
    });
  });

  it('多个不满足项一次性全部返回（顺序稳定）', () => {
    const result = expectOk(
      { author: { handle: 'bob' }, text: 'short' },
      {
        type: 'comment',
        requirements: { keywords: ['alpha'], hashtags: ['#xwh'], links: ['x.com/a'] },
      },
    );
    expect(result.ok).toBe(false);
    expect(result.reasons).toEqual([
      'author_mismatch',
      'too_short',
      'missing:alpha',
      'missing:#xwh',
      'missing_link:x.com/a',
    ]);
  });

  it('requirements 字段缺失（旧数据）不崩溃', () => {
    const result = evaluateDelivery(tweet({ author: { handle: 'alice' }, text: 'ok' }), {
      handle: 'alice',
      type: 'post',
      requirements: {} as OrderRequirements,
    });
    expect(result).toEqual({ ok: true, reasons: [] });
  });
});

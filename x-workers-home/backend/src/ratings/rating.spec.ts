import { computeRating, RatingInput } from './rating';

const DAY_MS = 24 * 60 * 60 * 1000;

function isoDaysAgo(days: number, now: Date = new Date()): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString();
}

/** 20 条推文：views=20000, likes=300, reposts=50, replies=50, bookmarks=0 */
function pinnedTweets() {
  return Array.from({ length: 20 }, () => ({
    views: 20000,
    likes: 300,
    reposts: 50,
    replies: 50,
    bookmarks: 0,
  }));
}

describe('computeRating (纯函数)', () => {
  it('10k 粉丝 / 2 万均浏览 / 2% 互动 / 5 年 / 关注 1k → B(69)', () => {
    const r = computeRating({
      followers: 10000,
      following: 1000,
      joinedISO: isoDaysAgo(1825),
      tweets: pinnedTweets(),
    });

    // 手算：0.3*log10(10001)/6 + 0.25*log10(20001)/5.5 + 0.25*(0.02/0.05)
    //      + 0.1*1 + 0.1*(1 - 1000/10001) = 0.6855055 → ×100 = 68.55055 → 69
    expect(r.score).toBe(69);
    expect(r.grade).toBe('B');
    expect(r.flags).toEqual([]);
  });

  it('0 粉且无推文 → D', () => {
    const r = computeRating({
      followers: 0,
      following: 0,
      joinedISO: isoDaysAgo(100),
      tweets: [],
    });

    // views 全缺失 → avg_views/engagement 剔除；age≈0.0548、ratio=1 重新归一
    expect(r.score).toBeLessThan(40);
    expect(r.grade).toBe('D');
    expect(r.flags).toEqual([]);
  });

  it('刷粉旗标：高粉丝 + 超低互动 → flags 含 brush，grade 封顶 C', () => {
    const r = computeRating({
      followers: 100000,
      following: 100,
      joinedISO: isoDaysAgo(3650),
      tweets: Array.from({ length: 20 }, () => ({
        views: 1000000,
        likes: 100,
        reposts: 0,
        replies: 0,
        bookmarks: 0,
      })),
    });

    // rate = 100/1e6 = 0.0001 < 0.002；原始分 70（A）→ 封顶 C
    expect(r.score).toBe(70);
    expect(r.grade).toBe('C');
    expect(r.flags).toEqual(['brush']);
  });

  it('views 全缺失 → 剔除对应权重并重新归一，不崩溃', () => {
    const r = computeRating({
      followers: 10000,
      following: 1000,
      joinedISO: isoDaysAgo(1825),
      tweets: [
        { likes: 1, reposts: 2, replies: 3, bookmarks: 4 },
        { views: undefined, likes: 5 },
        { views: null, likes: 6 },
      ],
    });

    // 只剩 followers(0.6667)/age(1)/ratio(0.9)，权重 0.3/0.1/0.1
    // (0.3*0.666674 + 0.1*1 + 0.1*0.90001) / 0.5 = 0.780006 → 78
    expect(r.score).toBe(78);
    expect(r.grade).toBe('A');
    expect(r.breakdown).not.toHaveProperty('avg_views');
    expect(r.breakdown).not.toHaveProperty('engagement');
    expect(r.flags).toEqual([]);
  });

  it('joined 缺失 → 剔除 age 权重并重新归一', () => {
    const r = computeRating({
      followers: 10000,
      following: 1000,
      joinedISO: null,
      tweets: pinnedTweets(),
    });

    // 权重和 0.9；(0.3*0.666674 + 0.25*0.782009 + 0.25*0.4 + 0.1*0.90001)/0.9
    // = 0.650561 → 65
    expect(r.score).toBe(65);
    expect(r.grade).toBe('B');
    expect(r.breakdown).not.toHaveProperty('age');
  });

  it('部分推文缺 views：均值与互动率只统计有 views 的推文', () => {
    const withMissing: RatingInput = {
      followers: 10000,
      following: 1000,
      joinedISO: isoDaysAgo(1825),
      tweets: [
        ...pinnedTweets(),
        // 缺 views 的推文不参与 avg_views / engagement，哪怕互动数极低
        { likes: 0, reposts: 0, replies: 0, bookmarks: 0 },
      ],
    };

    expect(computeRating(withMissing).score).toBe(69);
  });
});

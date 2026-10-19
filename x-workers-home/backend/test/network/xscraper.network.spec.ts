/**
 * 联网冒烟测试，默认跳过（npm test / CI 不联网）。
 *
 * - 本机（国内网络）运行前需要配置 HTTP 代理，例如 HTTPS_PROXY=http://127.0.0.1:7890；
 * - VPS / 海外环境可直连（x.py 会自动走系统代理或 HTTPS_PROXY）。
 *
 * 启用方式：把下面的 describe.skip 改成 describe，然后
 *   npx jest test/network/xscraper.network.spec.ts --runInBand
 */
import { SpawnCommandRunner } from '../../src/xscraper/command-runner';
import { XScraperService } from '../../src/xscraper/xscraper.service';

const HANDLE = 'jack';

describe.skip('XScraperService（真实网络，默认跳过）', () => {
  jest.setTimeout(60_000);

  const service = new XScraperService(new SpawnCommandRunner());

  it('getProfile 返回账号资料', async () => {
    const user = await service.getProfile(HANDLE);

    expect(user.handle.toLowerCase()).toBe(HANDLE);
    expect(typeof user.followers).toBe('number');
  });

  it('getRecentTweets 返回时间线', async () => {
    const tweets = await service.getRecentTweets(HANDLE, 5);

    expect(Array.isArray(tweets)).toBe(true);
    expect(tweets.length).toBeLessThanOrEqual(5);
  });
});

import { existsSync, readFileSync } from 'fs';
import * as path from 'path';
import { CommandResult, CommandRunner, CommandTimeoutError } from './command-runner';
import {
  resolveScriptPath,
  XNotFoundError,
  XRateLimitError,
  XScraperService,
  XUpstreamError,
} from './xscraper.service';

const FIXTURES = path.resolve(__dirname, '../../test/fixtures');
const SCRIPT = '/opt/xw/tools/x.py';
const CFG = { python: 'python', script: SCRIPT };

const fixture = (name: string): string => readFileSync(path.join(FIXTURES, name), 'utf8');

class FakeRunner implements CommandRunner {
  readonly calls: Array<{ command: string; args: string[]; timeoutMs?: number }> = [];

  constructor(
    private readonly stdout: string,
    private readonly code = 0,
  ) {}

  async run(
    command: string,
    args: string[],
    options: { timeoutMs?: number } = {},
  ): Promise<CommandResult> {
    this.calls.push({ command, args, timeoutMs: options.timeoutMs });
    return { code: this.code, stdout: this.stdout, stderr: '' };
  }
}

const fakeRunner = (stdout: string, code = 0) => new FakeRunner(stdout, code);
const create = (runner: CommandRunner) => new XScraperService(runner, CFG);

describe('XScraperService', () => {
  it('解析 user 输出', async () => {
    const runner = fakeRunner(fixture('x_user.json'));
    const svc = create(runner);

    const user = await svc.getProfile('alice');

    expect(user.handle).toBe('alice');
    expect(user.followers).toBe(12345);
    expect(user.joined).toBe('2021-03-05T00:00:00Z');
    expect(user.about?.based_in).toBe('Singapore');
    expect(runner.calls[0]).toEqual({
      command: 'python',
      args: [SCRIPT, 'user', 'alice'],
      timeoutMs: 30_000,
    });
  });

  it('解析 tweets 输出并映射 --limit 参数', async () => {
    const runner = fakeRunner(fixture('x_tweets.json'));
    const svc = create(runner);

    const tweets = await svc.getRecentTweets('alice', 5);

    expect(tweets).toHaveLength(2);
    expect(tweets[0].id).toBe('1770000000000000001');
    expect(tweets[0].author?.handle).toBe('alice');
    expect(tweets[0].quoted?.id).toBe('1770000000000000002');
    expect(tweets[1].views).toBeNull();
    expect(tweets[1].reply_to?.handle).toBe('bob');
    expect(runner.calls[0]).toEqual({
      command: 'python',
      args: [SCRIPT, 'tweets', 'alice', '--limit', '5'],
      timeoutMs: 30_000,
    });
  });

  it('解析 tweet 输出', async () => {
    const runner = fakeRunner(fixture('x_tweet.json'));
    const svc = create(runner);

    const tweet = await svc.getTweet('https://x.com/alice/status/1770000000000000001');

    expect(tweet.id).toBe('1770000000000000001');
    expect(tweet.text).toBe('gm. shipping today.');
    expect(tweet.article?.text).toBe('Full article text');
    expect(runner.calls[0].args).toEqual([
      SCRIPT,
      'tweet',
      'https://x.com/alice/status/1770000000000000001',
    ]);
  });

  it('退出码 4 → XNotFoundError', async () => {
    const runner = fakeRunner(
      JSON.stringify({ error: '没找到这条推（删了，或作者是受保护账号）', hint: '检查链接' }),
      4,
    );
    const svc = create(runner);

    const err = await svc
      .getTweet('https://x.com/alice/status/1')
      .then(() => null, (e: unknown) => e);

    expect(err).toBeInstanceOf(XNotFoundError);
    expect((err as XNotFoundError).message).toContain('没找到');
    expect((err as XNotFoundError).hint).toBe('检查链接');
  });

  it('退出码 5 → XRateLimitError', async () => {
    const runner = fakeRunner(
      JSON.stringify({ error: '请求太频繁，被限流了，过一两分钟再试', hint: '稍后再试' }),
      5,
    );
    const svc = create(runner);

    await expect(svc.getProfile('alice')).rejects.toBeInstanceOf(XRateLimitError);
  });

  it('runner 超时 → XUpstreamError', async () => {
    const run = jest.fn().mockRejectedValue(new CommandTimeoutError(30_000));
    const svc = create({ run });

    const err = await svc.getProfile('alice').then(() => null, (e: unknown) => e);

    expect(err).toBeInstanceOf(XUpstreamError);
    expect((err as Error).message).toContain('超时');
    expect(run).toHaveBeenCalledWith('python', [SCRIPT, 'user', 'alice'], {
      timeoutMs: 30_000,
    });
  });

  it('非 JSON stdout → XUpstreamError', async () => {
    const runner = fakeRunner('Traceback (most recent call last):\n  ...\n', 1);
    const svc = create(runner);

    await expect(svc.getProfile('alice')).rejects.toBeInstanceOf(XUpstreamError);
  });

  it('退出码 1 且带 error 字段 → XUpstreamError', async () => {
    const runner = fakeRunner(JSON.stringify({ error: '脚本出错：网络失败', hint: '稍后重试' }), 1);
    const svc = create(runner);

    await expect(svc.getProfile('alice')).rejects.toBeInstanceOf(XUpstreamError);
  });

  it('error 文案含「没找到」时按文案映射为 XNotFoundError', async () => {
    const runner = fakeRunner(JSON.stringify({ error: '没找到（推文删了、账号不存在 / 改名了）' }), 1);
    const svc = create(runner);

    await expect(svc.getProfile('alice')).rejects.toBeInstanceOf(XNotFoundError);
  });
});

describe('resolveScriptPath', () => {
  const backendDir = path.resolve(__dirname, '../..');
  const repoRoot = path.resolve(backendDir, '..');
  const expected = path.resolve(repoRoot, 'tools/x.py');
  const srcDirname = path.join(backendDir, 'src', 'xscraper');
  const distDirname = path.join(backendDir, 'dist', 'xscraper');

  it('cwd 为 backend 时解析到 tools/x.py', () => {
    expect(resolveScriptPath('../tools/x.py', backendDir, srcDirname)).toBe(expected);
  });

  it('cwd 为仓库根（非 backend）时回退解析仍指向 x-workers-home/tools/x.py', () => {
    const resolved = resolveScriptPath('../tools/x.py', repoRoot, srcDirname);

    expect(resolved).toBe(expected);
    expect(existsSync(resolved)).toBe(true);
  });

  it('编译后 dist/xscraper 的 __dirname 回退解析正确', () => {
    expect(resolveScriptPath('../tools/x.py', repoRoot, distDirname)).toBe(expected);
  });

  it('绝对路径原样返回', () => {
    const absolute = path.resolve(backendDir, 'tools', 'x.py');

    expect(resolveScriptPath(absolute, repoRoot, backendDir)).toBe(absolute);
  });

  it('无候选存在时返回 cwd 相对路径', () => {
    expect(resolveScriptPath('../missing/x.py', backendDir, backendDir)).toBe(
      path.resolve(backendDir, '../missing/x.py'),
    );
  });
});

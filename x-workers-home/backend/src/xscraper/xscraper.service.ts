import { existsSync } from 'fs';
import * as path from 'path';
import { CommandResult, CommandRunner, SpawnCommandRunner } from './command-runner';
import { XTweet, XUser } from './xscraper.types';

export const DEFAULT_XSCRAPER_TIMEOUT_MS = 30_000;
const DEFAULT_SCRIPT = '../tools/x.py';

export interface XScraperConfig {
  /** 默认按平台取 python（Windows）/ python3（其他） */
  python?: string;
  /** 相对 cwd 或 monorepo 根；默认 ../tools/x.py */
  script?: string;
  timeoutMs?: number;
}

export class XScraperError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
    readonly exitCode?: number,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** x.py 退出码 4：推文/账号不存在、已删除或受保护 */
export class XNotFoundError extends XScraperError {}

/** x.py 退出码 5：上游限流或数据源异常 */
export class XRateLimitError extends XScraperError {}

/** 其他失败：退出码 1、超时、输出不可解析、spawn 失败 */
export class XUpstreamError extends XScraperError {}

interface XScraperPayload {
  error?: unknown;
  hint?: unknown;
  user?: unknown;
  tweets?: unknown;
  tweet?: unknown;
}

function resolveScriptPath(script: string): string {
  if (path.isAbsolute(script)) {
    return script;
  }

  // cwd 可能是 backend（npm/nest 的常规运行目录）；
  // __dirname 在 ts-jest 下是 backend/src/xscraper，编译后是 backend/dist/xscraper，
  // 两者向上三级都到 monorepo 根（x-workers-home/）。
  const candidates = [
    path.resolve(process.cwd(), script),
    path.resolve(__dirname, '../../../', script),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function snippet(text: string, max = 300): string {
  const compact = text.trim().replace(/\s+/g, ' ');
  return compact.length > max ? `${compact.slice(0, max)}…` : compact;
}

export class XScraperService {
  private readonly python: string;
  private readonly script: string;
  private readonly timeoutMs: number;

  constructor(
    private readonly runner: CommandRunner = new SpawnCommandRunner(),
    config: XScraperConfig = {},
  ) {
    this.python =
      config.python ||
      process.env.XSCRAPER_PYTHON ||
      (process.platform === 'win32' ? 'python' : 'python3');
    this.script = resolveScriptPath(
      config.script || process.env.XSCRAPER_SCRIPT || DEFAULT_SCRIPT,
    );
    this.timeoutMs = config.timeoutMs ?? DEFAULT_XSCRAPER_TIMEOUT_MS;
  }

  async getProfile(handle: string): Promise<XUser> {
    const payload = await this.run(['user', handle]);
    return this.requireField<XUser>(payload.user, 'user');
  }

  async getRecentTweets(handle: string, limit: number): Promise<XTweet[]> {
    const payload = await this.run(['tweets', handle, '--limit', String(limit)]);
    if (!Array.isArray(payload.tweets)) {
      throw new XUpstreamError('x.py 输出缺少 tweets 数组');
    }
    return payload.tweets as XTweet[];
  }

  async getTweet(url: string): Promise<XTweet> {
    const payload = await this.run(['tweet', url]);
    return this.requireField<XTweet>(payload.tweet, 'tweet');
  }

  private requireField<T>(value: unknown, field: string): T {
    if (value === undefined || value === null) {
      throw new XUpstreamError(`x.py 输出缺少 ${field} 字段`);
    }
    return value as T;
  }

  private async run(args: string[]): Promise<XScraperPayload> {
    let result: CommandResult;
    try {
      result = await this.runner.run(this.python, [this.script, ...args], {
        timeoutMs: this.timeoutMs,
      });
    } catch (err) {
      throw new XUpstreamError(`执行 x.py 失败：${errorMessage(err)}`);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(result.stdout.trim());
    } catch {
      throw new XUpstreamError(
        `x.py 输出不是 JSON（退出码 ${result.code}）：${snippet(result.stderr || result.stdout)}`,
        undefined,
        result.code,
      );
    }

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new XUpstreamError('x.py 输出不是 JSON 对象', undefined, result.code);
    }

    const obj = payload as XScraperPayload;
    const message = typeof obj.error === 'string' ? obj.error : undefined;
    const hint = typeof obj.hint === 'string' ? obj.hint : undefined;

    if (message !== undefined) {
      if (result.code === 4 || message.includes('没找到')) {
        throw new XNotFoundError(message, hint, result.code);
      }
      if (result.code === 5) {
        throw new XRateLimitError(message, hint, result.code);
      }
      throw new XUpstreamError(message, hint, result.code);
    }

    if (result.code === 4) {
      throw new XNotFoundError(`x.py 以退出码 4 结束`, undefined, 4);
    }
    if (result.code === 5) {
      throw new XRateLimitError(`x.py 以退出码 5 结束`, undefined, 5);
    }
    if (result.code !== 0) {
      throw new XUpstreamError(
        `x.py 退出码 ${result.code}：${snippet(result.stderr || result.stdout)}`,
        undefined,
        result.code,
      );
    }

    return obj;
  }
}

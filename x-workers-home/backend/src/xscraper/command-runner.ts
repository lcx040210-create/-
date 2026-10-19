import { spawn } from 'child_process';

export interface CommandOptions {
  timeoutMs?: number;
}

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * 可注入的命令执行抽象：默认实现是 SpawnCommandRunner，测试可注入 fake。
 */
export interface CommandRunner {
  run(command: string, args: string[], options?: CommandOptions): Promise<CommandResult>;
}

export const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;

export class CommandTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`命令执行超时（${timeoutMs}ms）`);
    this.name = 'CommandTimeoutError';
  }
}

export class SpawnCommandRunner implements CommandRunner {
  run(command: string, args: string[], options: CommandOptions = {}): Promise<CommandResult> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;

    return new Promise<CommandResult>((resolve, reject) => {
      const child = spawn(command, args, {
        env: process.env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeoutMs);

      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => {
        stdout += chunk;
      });
      child.stderr?.on('data', (chunk: string) => {
        stderr += chunk;
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (timedOut) {
          reject(new CommandTimeoutError(timeoutMs));
          return;
        }
        resolve({ code: code ?? -1, stdout, stderr });
      });
    });
  }
}

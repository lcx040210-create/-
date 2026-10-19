import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { VerificationJob } from './verification-job.entity';

export const VERIFICATION_POLL_INTERVAL_MS = 30_000;

/** 三次重试间隔（第 1/2/3 次失败后）；第 4 次尝试失败直接进入 manual */
export const JOB_BACKOFF_MS = [60_000, 180_000, 600_000];
export const MAX_JOB_ATTEMPTS = 4;

/**
 * handler 抛出该错误表示重试没有意义，直接进入 manual（不再消耗剩余尝试次数）。
 * 例如验证码已过期、目标 handle 已被他人抢先绑定。
 */
export class JobFatalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JobFatalError';
  }
}

export type JobHandler = (job: VerificationJob) => Promise<void>;

export interface JobRegistrationOptions {
  /** 进入 manual 时的钩子（用于把业务实体也置为 manual / 发通知） */
  onManual?: (job: VerificationJob) => Promise<void>;
}

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly handlers = new Map<
    string,
    { handler: JobHandler; onManual?: (job: VerificationJob) => Promise<void> }
  >();
  private ticking = false;

  constructor(
    @InjectRepository(VerificationJob)
    private readonly jobs: Repository<VerificationJob>,
  ) {}

  register(type: string, handler: JobHandler, options: JobRegistrationOptions = {}): void {
    this.handlers.set(type, { handler, onManual: options.onManual });
  }

  async enqueue(
    type: string,
    refId: string,
    payload: Record<string, any>,
    nextRunAt: Date = new Date(),
  ): Promise<VerificationJob> {
    return this.jobs.save(
      this.jobs.create({
        type,
        refId,
        payload,
        status: 'pending',
        attempts: 0,
        nextRunAt,
        lastError: null,
      }),
    );
  }

  /** 重新发起绑定/改绑时清掉旧的待执行任务，避免旧验证码继续生效 */
  async cancelPending(type: string, refId: string): Promise<void> {
    await this.jobs.delete({ type, refId, status: 'pending' });
  }

  @Interval(VERIFICATION_POLL_INTERVAL_MS)
  async poll(): Promise<void> {
    // e2e 里由测试手动调用 tick()，避免 30s 后台轮询制造不确定性
    if (process.env.NODE_ENV === 'test') return;
    await this.tick();
  }

  /** 可注入 now，便于测试推进时间 */
  async tick(now: Date = new Date()): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const due = await this.jobs.find({
        where: { status: 'pending', nextRunAt: LessThanOrEqual(now) },
        order: { createdAt: 'ASC' },
        take: 100,
      });
      for (const job of due) {
        await this.runOne(job, now);
      }
    } finally {
      this.ticking = false;
    }
  }

  private async runOne(job: VerificationJob, now: Date): Promise<void> {
    const registration = this.handlers.get(job.type);
    job.attempts += 1;

    try {
      if (!registration) {
        throw new Error(`未注册的 job 类型: ${job.type}`);
      }
      await registration.handler(job);
      job.status = 'done';
      job.lastError = null;
      await this.jobs.save(job);
    } catch (err) {
      job.lastError = err instanceof Error ? err.message : String(err);

      if (err instanceof JobFatalError || job.attempts >= MAX_JOB_ATTEMPTS) {
        job.status = 'manual';
        await this.jobs.save(job);
        if (registration?.onManual) {
          try {
            await registration.onManual(job);
          } catch (hookErr) {
            this.logger.error(
              `job ${job.id} onManual 钩子失败: ${
                hookErr instanceof Error ? hookErr.message : String(hookErr)
              }`,
            );
          }
        }
      } else {
        const backoff = JOB_BACKOFF_MS[job.attempts - 1];
        job.nextRunAt = new Date(now.getTime() + backoff);
        await this.jobs.save(job);
      }
    }
  }
}

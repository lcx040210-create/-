import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { isAddress, verifyMessage } from 'ethers';
import {
  DataSource,
  EntityManager,
  FindOptionsWhere,
  In,
  IsNull,
  LessThanOrEqual,
  Repository,
} from 'typeorm';
import { JobFatalError, SchedulerService } from '../jobs/scheduler.service';
import { VerificationJob } from '../jobs/verification-job.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { RatingsService } from '../ratings/ratings.service';
import { User } from '../users/user.entity';
import { XScraperService } from '../xscraper/xscraper.service';
import { BindingChange } from './binding-change.entity';
import { toApiBindingStatus, XBinding } from './x-binding.entity';

export const X_BINDING_JOB_TYPE = 'x_binding';
export const X_BINDING_CODE_TTL_MS = 24 * 60 * 60 * 1000;
export const BINDING_CHANGE_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const BINDING_CHANGE_POLL_INTERVAL_MS = 60_000;

export interface XBindingJobPayload {
  userId: string;
  handle: string;
  code: string;
  mode: 'initial' | 'change';
  /** ISO 时间：改绑/绑定发起时刻，用于过滤「start 之前」的推文 */
  startedAt: string;
}

export function normalizeXHandle(raw: string): string {
  return raw.trim().replace(/^@/, '').toLowerCase();
}

export function generateXBindingCode(): string {
  return `XWH-${randomBytes(3).toString('hex').toUpperCase()}`;
}

/**
 * 钱包改绑签名消息（personal_sign）。当前地址 + 新地址都写入消息，
 * 换绑成功后当前地址变化，旧签名不可重放。
 */
export function buildWalletChangeMessage(
  currentAddress: string,
  newAddress: string,
): string {
  return [
    'X工作者之家 更换钱包',
    `当前地址: ${currentAddress.toLowerCase()}`,
    `新地址: ${newAddress.toLowerCase()}`,
  ].join('\n');
}

function isUniqueViolation(err: unknown): boolean {
  const code =
    (err as { code?: string })?.code ??
    (err as { driverError?: { code?: string } })?.driverError?.code;
  return code === '23505';
}

function containsCode(text: unknown, code: string): boolean {
  return typeof text === 'string' && text.toUpperCase().includes(code.toUpperCase());
}

@Injectable()
export class BindingsService implements OnModuleInit {
  private readonly logger = new Logger(BindingsService.name);

  constructor(
    @InjectRepository(XBinding)
    private readonly xBindings: Repository<XBinding>,
    @InjectRepository(BindingChange)
    private readonly changes: Repository<BindingChange>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly scheduler: SchedulerService,
    private readonly scraper: XScraperService,
    private readonly notifications: NotificationsService,
    private readonly ratings: RatingsService,
  ) {}

  onModuleInit(): void {
    this.scheduler.register(
      X_BINDING_JOB_TYPE,
      (job) => this.handleJob(job),
      { onManual: (job) => this.onJobManual(job) },
    );
  }

  async start(userId: string, rawHandle: string) {
    const handle = normalizeXHandle(rawHandle);

    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }
    if (user.status === 'suspended') {
      throw new ForbiddenException('账号已被封禁，无法绑定 X');
    }

    const existing = await this.xBindings.findOne({ where: { userId } });
    const taken = await this.xBindings.findOne({ where: { handle } });
    if (taken && taken.userId !== userId) {
      throw new ConflictException('该 X 账号已被绑定');
    }
    if (existing?.status === 'active') {
      if (existing.handle === handle) {
        throw new ConflictException('该 X 账号已绑定');
      }
      throw new ConflictException('已绑定其他 X 账号，请使用改绑流程');
    }

    const code = generateXBindingCode();
    const now = new Date();
    try {
      // user_id 唯一：重复发起会覆盖旧验证码
      await this.xBindings.upsert(
        {
          userId,
          handle,
          code,
          status: 'pending',
          verifiedAt: null,
          createdAt: now,
        },
        ['userId'],
      );
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('该 X 账号已被绑定');
      }
      throw err;
    }

    await this.scheduler.cancelPending(X_BINDING_JOB_TYPE, userId);
    await this.scheduler.enqueue(X_BINDING_JOB_TYPE, userId, {
      userId,
      handle,
      code,
      mode: 'initial',
      startedAt: now.toISOString(),
    } satisfies XBindingJobPayload);

    return {
      code,
      handle,
      expiresAt: new Date(now.getTime() + X_BINDING_CODE_TTL_MS),
    };
  }

  async status(userId: string): Promise<{ status: string; handle: string | null }> {
    const binding = await this.xBindings.findOne({ where: { userId } });
    return {
      status: toApiBindingStatus(binding?.status),
      handle: binding?.handle ?? null,
    };
  }

  /** 改绑 X：复用验证码 job；验证通过后只生成 pending change，不立即换绑 */
  async requestXChange(userId: string, rawHandle: string) {
    const handle = normalizeXHandle(rawHandle);
    const binding = await this.xBindings.findOne({ where: { userId } });
    if (!binding || binding.status !== 'active') {
      throw new BadRequestException('请先完成 X 绑定');
    }
    if (binding.handle === handle) {
      throw new BadRequestException('新 X 账号与当前绑定相同');
    }
    const taken = await this.xBindings.findOne({ where: { handle } });
    if (taken && taken.userId !== userId) {
      throw new ConflictException('该 X 账号已被绑定');
    }
    if (await this.hasPendingChange(userId, 'x')) {
      throw new ConflictException('已有待处理的 X 改绑申请');
    }

    const code = generateXBindingCode();
    const now = new Date();
    await this.scheduler.cancelPending(X_BINDING_JOB_TYPE, userId);
    await this.scheduler.enqueue(X_BINDING_JOB_TYPE, userId, {
      userId,
      handle,
      code,
      mode: 'change',
      startedAt: now.toISOString(),
    } satisfies XBindingJobPayload);

    return {
      code,
      handle,
      expiresAt: new Date(now.getTime() + X_BINDING_CODE_TTL_MS),
    };
  }

  /**
   * 用户侧钱包改绑签名消息：与 requestWalletChange 使用同一构造，
   * 保证前端签名 / 后端 verifyMessage 的消息完全一致。
   */
  async walletChangeMessage(
    userId: string,
    rawNewAddress: string,
  ): Promise<{ message: string }> {
    if (!isAddress(rawNewAddress)) {
      throw new BadRequestException('新地址格式不正确');
    }
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }
    const newAddress = rawNewAddress.toLowerCase();
    if (user.address.toLowerCase() === newAddress) {
      throw new BadRequestException('新地址与当前地址相同');
    }
    return { message: buildWalletChangeMessage(user.address, newAddress) };
  }

  async requestWalletChange(userId: string, rawNewAddress: string, signature: string) {
    if (!isAddress(rawNewAddress)) {
      throw new BadRequestException('新地址格式不正确');
    }
    const newAddress = rawNewAddress.toLowerCase();

    // 用户级串行锁：并发改绑请求都读到「无 pending」再各自插入的窗口被关掉。
    // 锁序：user 行 → binding_changes（只读校验）→ 插入；与提现流一致。
    const { change, message } = await this.dataSource.transaction(async (tx) => {
      const userRepo = tx.getRepository(User);
      const user = await userRepo.findOne({
        where: { id: userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user) {
        throw new UnauthorizedException('用户不存在');
      }
      if (user.address.toLowerCase() === newAddress) {
        throw new BadRequestException('新地址与当前地址相同');
      }

      const message = buildWalletChangeMessage(user.address, newAddress);
      let recovered: string;
      try {
        recovered = verifyMessage(message, signature);
      } catch {
        throw new BadRequestException('新地址签名无效');
      }
      if (recovered.toLowerCase() !== newAddress) {
        throw new BadRequestException('新地址签名无效');
      }

      const occupied = await userRepo.findOne({ where: { address: newAddress } });
      if (occupied && occupied.id !== userId) {
        throw new ConflictException('该地址已被其他用户使用');
      }
      if (await this.hasPendingChange(userId, 'wallet', tx)) {
        throw new ConflictException('已有待处理的改绑申请');
      }

      const changes = tx.getRepository(BindingChange);
      const change = await changes.save(
        changes.create({
          userId,
          kind: 'wallet',
          newValue: newAddress,
          status: 'pending',
          effectiveAt: new Date(Date.now() + BINDING_CHANGE_COOLDOWN_MS),
          appliedAt: null,
        }),
      );
      return { change, message };
    });

    return { ...this.toChangeView(change), message };
  }

  async listChanges(userId: string) {
    const rows = await this.changes.find({
      where: { userId },
      order: { createdAt: 'DESC', id: 'DESC' },
    });
    return rows.map((row) => this.toChangeView(row));
  }

  /** 提现风控：必须存在 active 状态的 X 绑定（双绑齐备）。 */
  async hasActiveXBinding(
    userId: string,
    manager?: EntityManager,
  ): Promise<boolean> {
    const repo = manager ? manager.getRepository(XBinding) : this.xBindings;
    return (await repo.count({ where: { userId, status: 'active' } })) > 0;
  }

  /**
   * T9 提现拦截：存在 pending，或已审核通过但还未落库的改绑申请。
   * kind 省略时检查钱包与 X 两类。
   */
  async hasPendingChange(
    userId: string,
    kind?: 'wallet' | 'x',
    manager?: EntityManager,
  ): Promise<boolean> {
    const where: FindOptionsWhere<BindingChange> = {
      userId,
      status: In(['pending', 'approved']),
      appliedAt: IsNull(),
    };
    if (kind) where.kind = kind;
    // 调用方已持有用户行锁时（提现/改绑事务内），用其事务管理器读，避免跨连接快照。
    const repo = manager ? manager.getRepository(BindingChange) : this.changes;
    return (await repo.count({ where })) > 0;
  }

  @Interval(BINDING_CHANGE_POLL_INTERVAL_MS)
  async applyDueChangesLoop(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    await this.applyDueChanges();
  }

  /** 冷静期到 + 审核通过 → 落库换绑（可注入 now 供测试推进时间） */
  async applyDueChanges(now: Date = new Date()): Promise<void> {
    const due = await this.changes.find({
      where: {
        status: 'approved',
        appliedAt: IsNull(),
        effectiveAt: LessThanOrEqual(now),
      },
    });
    for (const change of due) {
      await this.applyOne(change.id, now);
    }
  }

  private async applyOne(changeId: string, now: Date): Promise<void> {
    await this.dataSource.transaction(async (tx) => {
      const repo = tx.getRepository(BindingChange);
      const change = await repo.findOne({ where: { id: changeId } });
      if (
        !change ||
        change.status !== 'approved' ||
        change.appliedAt ||
        change.effectiveAt.getTime() > now.getTime()
      ) {
        return;
      }

      let conflict = false;
      if (change.kind === 'wallet') {
        const users = tx.getRepository(User);
        const occupied = await users.findOne({ where: { address: change.newValue } });
        if (occupied && occupied.id !== change.userId) {
          conflict = true;
        } else {
          await users.update({ id: change.userId }, { address: change.newValue });
        }
      } else if (change.kind === 'x') {
        const bindings = tx.getRepository(XBinding);
        const binding = await bindings.findOne({ where: { userId: change.userId } });
        const occupied = await bindings.findOne({ where: { handle: change.newValue } });
        if (!binding || (occupied && occupied.userId !== change.userId)) {
          conflict = true;
        } else {
          binding.handle = change.newValue;
          await bindings.save(binding);
        }
      } else {
        conflict = true;
      }

      if (conflict) {
        change.status = 'rejected';
        await repo.save(change);
        await this.notifications.notify(tx, {
          userId: change.userId,
          kind: 'binding_change_failed',
          title: '改绑失败',
          body: `目标值 ${change.newValue} 已被占用或原绑定不存在，改绑申请已驳回`,
          ref: { type: 'binding_change', id: change.id },
        });
        return;
      }

      change.appliedAt = now;
      await repo.save(change);
      await this.notifications.notify(tx, {
        userId: change.userId,
        kind: 'binding_change_applied',
        title: '改绑已生效',
        body:
          change.kind === 'wallet'
            ? `钱包地址已更换为 ${change.newValue}`
            : `X 绑定已更换为 @${change.newValue}`,
        ref: { type: 'binding_change', id: change.id },
      });
    });
  }

  /** SchedulerService 回调；抛错 → 退避重试，4 次后 manual */
  private async handleJob(job: VerificationJob): Promise<void> {
    const payload = job.payload as XBindingJobPayload;
    const { userId, handle, code, mode } = payload;

    if (mode === 'initial') {
      const binding = await this.xBindings.findOne({ where: { userId } });
      // 旧 job / 重复 start 产生的过期任务：静默结束
      if (!binding || binding.status !== 'pending' || binding.code !== code) return;
    } else {
      const binding = await this.xBindings.findOne({ where: { userId } });
      if (!binding || binding.status !== 'active' || binding.handle === handle) return;
    }

    // 验证码 24h 有效（初始绑定与改绑同规则）
    const startedAtMs = payload.startedAt ? new Date(payload.startedAt).getTime() : NaN;
    if (!Number.isNaN(startedAtMs) && Date.now() > startedAtMs + X_BINDING_CODE_TTL_MS) {
      throw new JobFatalError('验证码已过期，请重新发起');
    }

    const profile = await this.scraper.getProfile(handle);
    let matched = containsCode(profile?.bio, code);

    if (!matched) {
      const tweets = await this.scraper.getRecentTweets(handle, 5);
      matched = (tweets ?? []).some((tweet) =>
        this.tweetMatches(tweet, code, payload.startedAt),
      );
    }

    if (!matched) {
      throw new Error('验证码未匹配：请把验证码写进 bio 或最近 5 条推文');
    }

    if (mode === 'initial') {
      const activated = await this.activate(userId, handle, code);
      if (activated) {
        // 绑定时初评：评级失败绝不能阻断绑定成功
        try {
          await this.ratings.computeForUser(userId);
        } catch (err) {
          this.logger.warn(
            `绑定初评失败 userId=${userId} handle=${handle}：${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
    } else {
      await this.createXChange(userId, handle);
    }
  }

  private tweetMatches(
    tweet: { text?: string | null; created_at?: string | null },
    code: string,
    startedAtISO: string,
  ): boolean {
    if (!containsCode(tweet.text, code)) return false;

    const startedAt = startedAtISO ? new Date(startedAtISO).getTime() : NaN;
    if (Number.isNaN(startedAt)) return true;
    // x.py 缺失 created_at 时无法判定先后，不阻断（字段缺失 ≠ 旧推文）
    if (!tweet.created_at) return true;

    const createdAt = new Date(tweet.created_at).getTime();
    return Number.isNaN(createdAt) || createdAt >= startedAt;
  }

  /** @returns 本次调用是否真正完成了激活（旧 job / 状态已变化时 false） */
  private async activate(userId: string, handle: string, code: string): Promise<boolean> {
    return this.dataSource.transaction(async (tx) => {
      const repo = tx.getRepository(XBinding);
      const binding = await repo.findOne({ where: { userId } });
      if (!binding || binding.status !== 'pending' || binding.code !== code) return false;

      binding.status = 'active';
      binding.verifiedAt = new Date();
      await repo.save(binding);

      // 登录身份即钱包，X 验证通过即双绑齐。
      // 只从 pending_x_binding 提升，绝不覆盖 suspended（封禁中仍可能走到这里）
      await tx.getRepository(User).update(
        { id: userId, status: 'pending_x_binding' },
        { status: 'active' },
      );

      await this.notifications.notify(tx, {
        userId,
        kind: 'x_binding_success',
        title: 'X 绑定成功',
        body: `已绑定 @${handle}`,
        ref: { type: 'x_binding', id: binding.id },
      });

      return true;
    });
  }

  private async createXChange(userId: string, handle: string): Promise<void> {
    await this.dataSource.transaction(async (tx) => {
      const bindings = tx.getRepository(XBinding);
      const binding = await bindings.findOne({ where: { userId } });
      // 旧 job / 当前绑定已变化
      if (!binding || binding.status !== 'active' || binding.handle === handle) return;

      const occupied = await bindings.findOne({ where: { handle } });
      if (occupied && occupied.userId !== userId) {
        throw new JobFatalError('该 X 账号已被其他用户绑定');
      }

      const repo = tx.getRepository(BindingChange);
      let change = await repo.findOne({
        where: {
          userId,
          kind: 'x',
          status: In(['pending', 'approved']),
          appliedAt: IsNull(),
        },
      });
      if (change) {
        change.newValue = handle;
        change.effectiveAt = new Date(Date.now() + BINDING_CHANGE_COOLDOWN_MS);
        change.status = 'pending';
      } else {
        change = repo.create({
          userId,
          kind: 'x',
          newValue: handle,
          status: 'pending',
          effectiveAt: new Date(Date.now() + BINDING_CHANGE_COOLDOWN_MS),
          appliedAt: null,
        });
      }
      change = await repo.save(change);

      await this.notifications.notify(tx, {
        userId,
        kind: 'x_change_verified',
        title: 'X 改绑验证通过',
        body: `@${handle} 验证通过，进入 24 小时冷静期，审核通过后生效`,
        ref: { type: 'binding_change', id: change.id },
      });
    });
  }

  /** job 进入 manual：绑定置 manual、落失败通知（无事务调用方时由这里开事务） */
  private async onJobManual(job: VerificationJob): Promise<void> {
    const payload = job.payload as XBindingJobPayload;
    const { userId, handle, mode, code } = payload;
    const reason = job.lastError ?? '验证码未匹配';

    await this.dataSource.transaction(async (tx) => {
      const bindings = tx.getRepository(XBinding);
      const binding = await bindings.findOne({ where: { userId } });
      if (mode === 'initial') {
        // 绑定已被重新发起 / 已完成：旧 job 的失败不再通知
        if (!binding || binding.status !== 'pending' || binding.code !== code) return;
        binding.status = 'manual';
        await bindings.save(binding);
        await this.notifications.notify(tx, {
          userId,
          kind: 'x_binding_failed',
          title: 'X 绑定失败',
          body: `@${handle} 验证失败（${reason}），请重新发起绑定`,
          ref: { type: 'x_binding', id: binding.id },
        });
        return;
      }

      if (!binding || binding.status !== 'active' || binding.handle === handle) return;
      await this.notifications.notify(tx, {
        userId,
        kind: 'x_change_failed',
        title: 'X 改绑失败',
        body: `@${handle} 验证失败（${reason}），请重新发起改绑`,
      });
    });
  }

  private toChangeView(change: BindingChange) {
    return {
      id: change.id,
      kind: change.kind,
      newValue: change.newValue,
      status: change.status,
      effectiveAt: change.effectiveAt,
      appliedAt: change.appliedAt,
      createdAt: change.createdAt,
    };
  }
}

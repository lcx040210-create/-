import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { EntityManager, Repository } from 'typeorm';
import { formatXm, pctFloor } from '../common/money';
import { LedgerService } from '../ledger/ledger.service';
import { User } from '../users/user.entity';
import { Referral } from './referral.entity';

/** base32 邀请码字母表：大写字母 + 数字，排除易混的 0/1/I/O。 */
export const REF_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const REF_CODE_LENGTH = 6;

export interface ReferralMineView {
  code: string | null;
  inviteesCount: number;
  tier: number;
  rebateTotalXm: string;
}

export interface FeeEvent {
  userId: string;
  feeMicro: bigint;
  feeKind: string;
}

/** 随机 6 位邀请码。256 是 32 的整数倍，按字节取模无偏。 */
export function generateRefCode(): string {
  const bytes = randomBytes(REF_CODE_LENGTH);
  let code = '';
  for (let i = 0; i < REF_CODE_LENGTH; i++) {
    code += REF_CODE_ALPHABET[bytes[i] & 31];
  }
  return code;
}

export function normalizeRefCode(raw: string): string {
  return raw.trim().toUpperCase();
}

/** 档位：邀请人名下 active 被邀人数 0-4 → 20%，5-9 → 30%，≥10 → 40%。 */
export function tierOf(activeInvitees: number): number {
  if (activeInvitees >= 10) return 40;
  if (activeInvitees >= 5) return 30;
  return 20;
}

@Injectable()
export class ReferralService {
  constructor(
    @InjectRepository(Referral) private readonly referrals: Repository<Referral>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly ledger: LedgerService,
  ) {}

  /** 建号事务内分配唯一邀请码；唯一索引兜底（碰撞重试）。 */
  async allocateCode(tx: EntityManager): Promise<string> {
    for (let attempt = 0; attempt < 20; attempt++) {
      const code = generateRefCode();
      const taken = await tx.query(
        `SELECT 1 FROM "users" WHERE "ref_code" = $1 LIMIT 1`,
        [code],
      );
      if (taken.length === 0) return code;
    }
    throw new Error('邀请码生成失败，请重试');
  }

  /**
   * 建号事务内绑定邀请关系：无效码 / 自邀 → 400。
   * invitee_user_id 唯一，保证一人只能被绑一次。
   */
  async bindInvitee(
    tx: EntityManager,
    p: { inviteeUserId: string; inviteeAddress: string; code: string },
  ): Promise<void> {
    const code = normalizeRefCode(p.code);
    if (!code) {
      throw new BadRequestException('邀请码无效');
    }
    const referrer = await tx.getRepository(User).findOne({ where: { refCode: code } });
    if (!referrer) {
      throw new BadRequestException('邀请码无效');
    }
    if (referrer.address === p.inviteeAddress.toLowerCase()) {
      throw new BadRequestException('不能使用自己的邀请码');
    }
    await tx.getRepository(Referral).insert({
      referrerUserId: referrer.id,
      inviteeUserId: p.inviteeUserId,
    });
  }

  /**
   * 手续费事件钩子：所有平台手续费入账处（提现费 / 发单费 / 完结费）调用。
   * 无邀请人 → no-op；返佣从 platform_income 转入邀请人可用余额。
   */
  async onFeeEvent(tx: EntityManager, p: FeeEvent): Promise<void> {
    const ref = await tx
      .getRepository(Referral)
      .findOne({ where: { inviteeUserId: p.userId } });
    if (!ref) return;

    const rate = tierOf(await this.countActiveInvitees(tx, ref.referrerUserId));
    const rebate = pctFloor(p.feeMicro, rate, 100);
    if (rebate <= 0n) return;

    await this.ledger.transfer(tx, {
      from: { platform: 'income' },
      to: { userId: ref.referrerUserId },
      amountMicro: rebate,
      kind: 'referral_rebate',
      ref: { type: 'user', id: p.userId },
      memo: `${p.feeKind} 返佣 ${rate}%`,
    });
  }

  /** 邀请页数据：本人邀请码、active 被邀人数、当前档位、累计返佣。 */
  async mine(userId: string): Promise<ReferralMineView> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }

    const inviteesCount = await this.countActiveInvitees(this.users.manager, userId);
    const rows = await this.users.manager.query(
      `SELECT COALESCE(SUM("available_delta"), 0)::text AS total
         FROM "ledger_entries"
        WHERE "user_id" = $1 AND "kind" = 'referral_rebate'`,
      [userId],
    );

    return {
      code: user.refCode,
      inviteesCount,
      tier: tierOf(inviteesCount),
      rebateTotalXm: formatXm(BigInt(rows[0].total)),
    };
  }

  private async countActiveInvitees(
    manager: EntityManager,
    referrerUserId: string,
  ): Promise<number> {
    const rows = await manager.query(
      `SELECT COUNT(*)::int AS count
         FROM "referrals" r
         JOIN "users" u ON u."id" = r."invitee_user_id"
        WHERE r."referrer_user_id" = $1 AND u."status" = 'active'`,
      [referrerUserId],
    );
    return rows[0].count as number;
  }
}

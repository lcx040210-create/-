import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { verifyMessage } from 'ethers';
import { DataSource, Repository } from 'typeorm';
import {
  toApiBindingStatus,
  XBinding,
  XBindingApiStatus,
} from '../bindings/x-binding.entity';
import { ReferralService } from '../referral/referral.service';
import { TermsService } from '../terms/terms.service';
import { User } from '../users/user.entity';
import { AuthNonce } from './entities/auth-nonce.entity';
import { RefreshToken } from './entities/refresh-token.entity';

export const NONCE_TTL_MS = 10 * 60 * 1000;
const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL = '7d';
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface AuthUserView {
  id: string;
  address: string;
  status: string;
  role: string;
  rating_grade: string | null;
  x_binding?: { status: XBindingApiStatus; handle: string | null };
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  user: AuthUserView;
}

export function buildLoginMessage(address: string, nonce: string): string {
  return `X工作者之家 登录\n地址: ${address}\nNonce: ${nonce}`;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function toView(user: User): AuthUserView {
  return {
    id: user.id,
    address: user.address,
    status: user.status,
    role: user.role,
    rating_grade: user.ratingGrade,
  };
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(AuthNonce) private readonly nonces: Repository<AuthNonce>,
    @InjectRepository(RefreshToken)
    private readonly refreshTokens: Repository<RefreshToken>,
    @InjectRepository(XBinding)
    private readonly xBindings: Repository<XBinding>,
    private readonly dataSource: DataSource,
    private readonly referral: ReferralService,
    private readonly terms: TermsService,
    private readonly jwt: JwtService,
  ) {}

  async issueNonce(rawAddress: string) {
    const address = rawAddress.toLowerCase();
    const nonce = randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + NONCE_TTL_MS);

    await this.nonces.upsert({ address, nonce, expiresAt, used: false }, ['address']);

    return { nonce, message: buildLoginMessage(address, nonce) };
  }

  async verify(
    rawAddress: string,
    signature: string,
    referralCode?: string,
    termsVersion?: number,
  ): Promise<TokenPair> {
    const address = rawAddress.toLowerCase();
    const nonceRow = await this.nonces.findOne({ where: { address } });
    if (!nonceRow || nonceRow.used || nonceRow.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Nonce 无效或已过期');
    }

    let recovered: string;
    try {
      recovered = verifyMessage(buildLoginMessage(address, nonceRow.nonce), signature);
    } catch {
      throw new UnauthorizedException('签名无效');
    }
    if (recovered.toLowerCase() !== address) {
      throw new UnauthorizedException('签名无效');
    }

    // 原子消费 nonce：并发重放中只有一次能抢到未使用且未过期的行
    const consumed = await this.nonces
      .createQueryBuilder()
      .update(AuthNonce)
      .set({ used: true })
      .where('address = :address', { address })
      .andWhere('nonce = :nonce', { nonce: nonceRow.nonce })
      .andWhere('used = false')
      .andWhere('expires_at > now()')
      .execute();
    if (!consumed.affected) {
      throw new UnauthorizedException('Nonce 无效或已过期');
    }

    // 条款校验、建号与同意记录同一事务：当前条款用 FOR SHARE 锁定，
    // 与发布事务（FOR UPDATE）互斥，避免条款切换期间记录错版本。
    const user = await this.dataSource.transaction(async (tx) => {
      const currentTerms = await this.terms.requireCurrent(tx);
      if (termsVersion !== currentTerms.version) {
        throw new BadRequestException('请先同意最新服务条款');
      }

      const repo = tx.getRepository(User);
      let existing = await repo.findOne({ where: { address } });
      if (!existing) {
        // 首次建号：生成邀请码 +（可选）绑定邀请关系，同一事务提交。
        // 已存在用户的 verify 是登录，忽略 referralCode，不重绑。
        existing = await repo.save(
          repo.create({
            address,
            status: 'pending_x_binding',
            role: 'user',
            refCode: await this.referral.allocateCode(tx),
          }),
        );

        const code = (referralCode ?? '').trim();
        if (code) {
          await this.referral.bindInvitee(tx, {
            inviteeUserId: existing.id,
            inviteeAddress: address,
            code,
          });
        }
      }

      // 幂等：当前版本已有同意记录时不重复写（agreed_at 不变）；
      // 条款升级后旧用户首次携带新版本 verify 时补写一条。
      await this.terms.recordConsent(tx, existing.id, currentTerms.version);
      return existing;
    });

    return this.issueTokens(user);
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    const stored = await this.refreshTokens.findOne({
      where: { tokenHash: hashToken(refreshToken) },
    });
    if (!stored || stored.revoked || stored.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Refresh token 无效或已过期');
    }

    // 原子轮换：并发复用同一个 refresh token 时只有一次成功
    const revoked = await this.refreshTokens
      .createQueryBuilder()
      .update(RefreshToken)
      .set({ revoked: true })
      .where('id = :id', { id: stored.id })
      .andWhere('revoked = false')
      .execute();
    if (!revoked.affected) {
      throw new UnauthorizedException('Refresh token 无效或已过期');
    }

    const user = await this.users.findOne({ where: { id: stored.userId } });
    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }

    return this.issueTokens(user);
  }

  async me(userId: string): Promise<AuthUserView> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }
    const binding = await this.xBindings.findOne({ where: { userId } });
    return {
      ...toView(user),
      x_binding: {
        status: toApiBindingStatus(binding?.status),
        handle: binding?.handle ?? null,
      },
    };
  }

  private async issueTokens(user: User): Promise<TokenPair> {
    const payload = { sub: user.id, role: user.role };
    const accessToken = await this.jwt.signAsync(payload, {
      secret: process.env.JWT_SECRET,
      expiresIn: ACCESS_TOKEN_TTL,
    });
    // jti 保证同一秒内轮换出的 refresh token 也不与旧 token 重复
    const refreshToken = await this.jwt.signAsync(
      { ...payload, jti: randomUUID() },
      { secret: process.env.JWT_REFRESH_SECRET, expiresIn: REFRESH_TOKEN_TTL },
    );

    await this.refreshTokens.insert({
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      revoked: false,
    });

    return { accessToken, refreshToken, user: toView(user) };
  }
}

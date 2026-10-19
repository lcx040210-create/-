import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { formatUnits } from 'ethers';
import { DataSource } from 'typeorm';
import { fromWei18, formatXm, pctFloor } from '../common/money';
import { PLATFORM_ACCOUNTS } from '../database/migrations/1700000003000-ledger';
import { CHAIN_PROVIDER, ChainProvider } from '../deposits/chain-provider';

/** 每 30 分钟巡检一次（与充值监听的 30s 轮询相互独立）。 */
export const RECONCILIATION_CRON = '*/30 * * * *';

/** 平台钱包必须覆盖的 XM 总量下限：90%。 */
export const RECONCILIATION_RESERVE_NUM = 90;
export const RECONCILIATION_RESERVE_DEN = 100;

export type ReconciliationStatus = 'ok' | 'deficit';

/**
 * 收入分项（全部来自 platform_income 账户的流水净额，单位 micro-XM 的十进制字符串）。
 * 收入项为正；支出项（rebatePaid / compensationPaid）以正数展示支出额，
 * net = 收入项之和 − 支出项之和。
 */
export interface ReconciliationIncome {
  postingFee: string;
  completionFee: string;
  withdrawalFee: string;
  forfeit: string;
  rebatePaid: string;
  compensationPaid: string;
  net: string;
}

export interface Reconciliation {
  /** 全平台 XM 总量（所有账户 available + frozen），十进制 XM 字符串。 */
  totalXm: string;
  /** 平台收款钱包的 USDT 余额（micro-USDT 十进制字符串）。 */
  walletUsdtMicro: string;
  /** 应付下限 = pctFloor(totalXm, 90, 100) + Σ(pending/approved 提现 payout_micro)。 */
  requiredMicro: string;
  /** max(0, requiredMicro − walletUsdtMicro)。 */
  deficitMicro: string;
  status: ReconciliationStatus;
  income: ReconciliationIncome;
  accounts: { escrowAvailable: string; platformIncome: string };
}

/**
 * 对账口径（唯一版本，T7 + T9 + T18）：
 * - totalXm = Σ(所有账户 available + frozen)，含用户 / escrow / platform_income；
 * - walletUsdtMicro = fromWei18(balanceOf(PLATFORM_WALLET_ADDRESS))；
 * - requiredMicro = pctFloor(totalXm, 90, 100) + Σ(pending/approved 提现的 payout_micro)；
 * - deficitMicro = max(0, requiredMicro − walletUsdtMicro)。
 *
 * 收入分项只统计 platform_income 账户的流水行——同一笔 transfer 在用户侧也有
 * 一行（反向），若按 kind 全表汇总会重复/对冲计数。
 */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    @Inject(CHAIN_PROVIDER) private readonly chain: ChainProvider,
    private readonly dataSource: DataSource,
  ) {}

  /** cron 巡检：任何异常只记日志，绝不让定时任务崩进程。 */
  @Cron(RECONCILIATION_CRON)
  async patrol(): Promise<void> {
    // e2e 只走 GET 按需对账，避免后台 cron 在测试中制造不确定告警。
    if (process.env.NODE_ENV === 'test') return;
    try {
      await this.inspect();
    } catch (err) {
      this.logger.error(
        `对账巡检失败：${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** 端点 / 巡检共用入口：计算快照，deficit 时记日志并异步告警。 */
  async inspect(): Promise<Reconciliation> {
    const result = await this.reconcile();
    this.alertIfDeficit(result);
    return result;
  }

  async reconcile(): Promise<Reconciliation> {
    const [totalRow] = await this.dataSource.query(
      `SELECT COALESCE(SUM("available" + "frozen"), 0)::text AS "total" FROM "accounts"`,
    );
    const totalMicro = BigInt(totalRow.total);

    const [pendingRow] = await this.dataSource.query(
      `SELECT COALESCE(SUM("payout_micro"), 0)::text AS "total"
         FROM "withdrawals"
        WHERE "status" IN ('pending', 'approved')`,
    );
    const pendingPayoutMicro = BigInt(pendingRow.total);

    const walletWei = await this.chain.getUsdtBalance(this.platformWalletAddress());
    // USDT(BEP20) 精度 18：wei 整数先转 18 位小数字符串，再按 micro 向下取整。
    const walletUsdtMicro = fromWei18(formatUnits(walletWei, 18));

    const requiredMicro =
      pctFloor(totalMicro, RECONCILIATION_RESERVE_NUM, RECONCILIATION_RESERVE_DEN) +
      pendingPayoutMicro;
    const deficitMicro =
      requiredMicro > walletUsdtMicro ? requiredMicro - walletUsdtMicro : 0n;

    const income = await this.incomeBreakdown();
    const accounts = await this.platformBalances();

    return {
      totalXm: formatXm(totalMicro),
      walletUsdtMicro: walletUsdtMicro.toString(),
      requiredMicro: requiredMicro.toString(),
      deficitMicro: deficitMicro.toString(),
      status: deficitMicro > 0n ? 'deficit' : 'ok',
      income,
      accounts,
    };
  }

  /**
   * 按 platform_income 账户汇总各 kind 的 available_delta + frozen_delta。
   * 平台账户不冻结，frozen_delta 恒为 0；兼容写法避免未来冻结时漏算。
   */
  private async incomeBreakdown(): Promise<ReconciliationIncome> {
    const rows: Array<{ kind: string; delta: string }> = await this.dataSource.query(
      `SELECT "kind", COALESCE(SUM("available_delta" + "frozen_delta"), 0)::text AS "delta"
         FROM "ledger_entries"
        WHERE "account_id" = $1
        GROUP BY "kind"`,
      [PLATFORM_ACCOUNTS.income],
    );
    const byKind = new Map<string, bigint>(
      rows.map((row) => [row.kind, BigInt(row.delta)]),
    );
    const of = (kind: string): bigint => byKind.get(kind) ?? 0n;

    const postingFee = of('posting_fee');
    const completionFee = of('completion_fee');
    const withdrawalFee = of('withdrawal_fee');
    const forfeit = of('forfeit');
    // 支出类流水在 income 账户上为负 delta，展示时取正数。
    const rebateRaw = of('referral_rebate');
    const compensationRaw = of('penalty_compensation');
    const net =
      postingFee + completionFee + withdrawalFee + forfeit + rebateRaw + compensationRaw;

    return {
      postingFee: postingFee.toString(),
      completionFee: completionFee.toString(),
      withdrawalFee: withdrawalFee.toString(),
      forfeit: forfeit.toString(),
      rebatePaid: (-rebateRaw).toString(),
      compensationPaid: (-compensationRaw).toString(),
      net: net.toString(),
    };
  }

  /** 两个平台账户余额（available；平台账户不冻结，frozen 恒为 0）。 */
  private async platformBalances(): Promise<{
    escrowAvailable: string;
    platformIncome: string;
  }> {
    const rows: Array<{ id: string; available: string }> = await this.dataSource.query(
      `SELECT "id", "available"::text AS "available"
         FROM "accounts"
        WHERE "id" = ANY($1::uuid[])`,
      [[PLATFORM_ACCOUNTS.escrow, PLATFORM_ACCOUNTS.income]],
    );
    const byId = new Map(rows.map((row) => [row.id, row.available]));
    const escrow = byId.get(PLATFORM_ACCOUNTS.escrow);
    const income = byId.get(PLATFORM_ACCOUNTS.income);
    if (escrow === undefined || income === undefined) {
      throw new Error('平台账户未初始化：escrow / platform_income');
    }
    return { escrowAvailable: escrow, platformIncome: income };
  }

  private platformWalletAddress(): string {
    const address = (process.env.PLATFORM_WALLET_ADDRESS || '').trim().toLowerCase();
    if (!address) {
      throw new Error('PLATFORM_WALLET_ADDRESS 未配置');
    }
    return address;
  }

  /** deficit 时：先记 warning 日志；配置了 webhook 才异步 POST（不阻塞请求/巡检）。 */
  private alertIfDeficit(result: Reconciliation): void {
    if (result.status !== 'deficit') return;

    const text =
      `[XWH 对账告警] 平台钱包 USDT 不足：deficit ${formatXm(BigInt(result.deficitMicro))} XM` +
      `（required ${formatXm(BigInt(result.requiredMicro))} XM，` +
      `wallet ${formatXm(BigInt(result.walletUsdtMicro))} XM）`;
    this.logger.warn(text);

    const url = (process.env.ALERT_WEBHOOK_URL || '').trim();
    if (!url) return;
    void this.postWebhook(url, text);
  }

  /** fire-and-forget：失败只记日志，绝不冒泡。 */
  private async postWebhook(url: string, text: string): Promise<void> {
    if (typeof globalThis.fetch !== 'function') {
      this.logger.error('对账告警 webhook 未发送：当前运行时没有 fetch');
      return;
    }
    try {
      const response = await globalThis.fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!response.ok) {
        this.logger.error(`对账告警 webhook 返回 ${response.status}`);
      }
    } catch (err) {
      this.logger.error(
        `对账告警 webhook 发送失败：${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

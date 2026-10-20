import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { formatUnits } from 'ethers';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { fromWei18 } from '../common/money';
import { LedgerService } from '../ledger/ledger.service';
import { User } from '../users/user.entity';
import { ChainCursor } from './chain-cursor.entity';
import { CHAIN_PROVIDER, ChainProvider, ChainTransfer } from './chain-provider';
import { Deposit } from './deposit.entity';

export const DEPOSIT_WATCH_INTERVAL_MS = 30_000;
export const BSC_CURSOR_ID = 'bsc';
export const DEFAULT_DEPOSIT_MIN_CONFIRMATIONS = 15;

/**
 * 每 30s 扫描平台收款地址的 USDT(BEP20) 转入：
 * 1. 只处理 latest − minConfirmations 之前的块（默认 15 确认）；
 * 2. 按 (tx_hash, log_index) 去重，from 小写匹配 users.address；
 * 3. 命中 → 同事务内 credit + deposit.credited；未命中 → unmatched 待人工认领；
 * 4. 同一事务推进 chain_cursors（provider 出错则整体回滚，cursor 不前进）。
 */
@Injectable()
export class BscWatcherService {
  private readonly logger = new Logger(BscWatcherService.name);
  private ticking = false;
  private warnedAboutZeroCursor = false;

  constructor(
    @Inject(CHAIN_PROVIDER) private readonly chain: ChainProvider,
    private readonly dataSource: DataSource,
    private readonly ledger: LedgerService,
    @InjectRepository(ChainCursor)
    private readonly cursors: Repository<ChainCursor>,
  ) {}

  @Interval(DEPOSIT_WATCH_INTERVAL_MS)
  async poll(): Promise<void> {
    // e2e 里由测试手动调用 tick()，避免 30s 后台轮询制造不确定性
    if (process.env.NODE_ENV === 'test') return;
    await this.tick();
  }

  /** 整 tick 兜底：任何异常只记日志，绝不冒泡（定时任务不能崩进程）。 */
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.runTick();
    } catch (err) {
      this.logger.error(
        `BSC 充值监听失败（cursor 不前进）：${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    } finally {
      this.ticking = false;
    }
  }

  private async runTick(): Promise<void> {
    const minConfirmations = this.minConfirmations();
    const platformWallet = this.platformWallet();

    const cursorRow = await this.cursors.findOne({ where: { id: BSC_CURSOR_ID } });
    const cursor = cursorRow?.lastBlock ?? 0n;

    const latest = await this.chain.getLatestBlock();
    const safe = latest - minConfirmations;
    if (safe <= cursor || safe <= 0) return;

    // 区间 (cursor, safe]；首次启动（cursor=0）可用 BSC_START_BLOCK 指定起点，
    // 避免从区块 1 开始拉取巨大区间。
    const startBlock = this.startBlock();
    if (cursor === 0n && startBlock === null && !this.warnedAboutZeroCursor) {
      this.warnedAboutZeroCursor = true;
      this.logger.warn(
        'chain_cursors.last_block=0 且未设置 BSC_START_BLOCK：将从区块 1 开始扫描，可能造成巨大 RPC 区间。' +
          '生产环境请在首次启动前初始化游标或设置 BSC_START_BLOCK。',
      );
    }
    const fromBlock = cursor > 0n ? Number(cursor) + 1 : (startBlock ?? 1);
    // 起点尚未进入安全确认区间（例如刚部署、BSC_START_BLOCK 接近链头）时先等待。
    if (fromBlock > safe) return;
    const transfers = await this.chain.getUsdtTransfers({
      to: platformWallet,
      fromBlock,
      toBlock: safe,
    });

    await this.dataSource.transaction(async (tx) => {
      for (const transfer of transfers) {
        await this.processTransfer(tx, transfer);
      }
      await tx.getRepository(ChainCursor).save({
        id: BSC_CURSOR_ID,
        lastBlock: BigInt(safe),
      });
    });
  }

  private async processTransfer(tx: EntityManager, transfer: ChainTransfer): Promise<void> {
    const deposits = tx.getRepository(Deposit);

    // 幂等：同一 (tx_hash, log_index) 已处理过则跳过
    const existing = await deposits.findOne({
      where: { txHash: transfer.txHash, logIndex: transfer.logIndex },
    });
    if (existing) return;

    const from = transfer.from.toLowerCase();
    const to = transfer.to.toLowerCase();
    // amountWei 是原始 wei 整数（uint256），先转成 18 位小数的十进制字符串，
    // 再由 fromWei18 向下取整到 micro-XM（fromWei18 接收的是代币单位字符串）。
    const amountMicro = fromWei18(formatUnits(transfer.amountWei, 18));
    const user = await tx.getRepository(User).findOne({ where: { address: from } });

    // micro 向下取整后为 0 的尘埃转账无法入账，按 unmatched 留档（不阻断 cursor 推进）。
    const canCredit = user !== null && amountMicro > 0n;

    const deposit = await deposits.save(
      deposits.create({
        txHash: transfer.txHash,
        logIndex: transfer.logIndex,
        fromAddress: from,
        toAddress: to,
        rawAmountWei: transfer.amountWei,
        amountMicro,
        userId: canCredit ? user.id : null,
        status: canCredit ? 'credited' : 'unmatched',
        blockNumber: BigInt(transfer.blockNumber),
      }),
    );

    if (!canCredit) return;

    // 充值 1:1 零手续费；ref 指向 deposit 行，便于对账与认领追溯
    await this.ledger.credit(tx, {
      userId: user.id,
      amountMicro,
      kind: 'deposit_credit',
      ref: { type: 'deposit', id: deposit.id },
    });
  }

  private minConfirmations(): number {
    const raw = process.env.DEPOSIT_MIN_CONFIRMATIONS;
    const parsed = raw === undefined ? NaN : Number(raw);
    return Number.isInteger(parsed) && parsed >= 0
      ? parsed
      : DEFAULT_DEPOSIT_MIN_CONFIRMATIONS;
  }

  /**
   * 首次扫描起点（含）。仅在 cursor=0 时生效；未设置 / 非法值返回 null（保持现行为）。
   * 生产部署在 `.env.production` 设置 BSC_START_BLOCK=<部署时当前区块>。
   */
  private startBlock(): number | null {
    const raw = (process.env.BSC_START_BLOCK || '').trim();
    if (!raw) return null;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 0) {
      this.logger.warn(`BSC_START_BLOCK 非法（"${raw}"），已忽略`);
      return null;
    }
    return parsed > 0 ? parsed : null;
  }

  private platformWallet(): string {
    const address = (process.env.PLATFORM_WALLET_ADDRESS || '').trim().toLowerCase();
    if (!address) {
      throw new Error('PLATFORM_WALLET_ADDRESS 未配置');
    }
    return address;
  }
}

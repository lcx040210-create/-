import { Injectable } from '@nestjs/common';
import { Contract, EventLog, JsonRpcProvider } from 'ethers';
import {
  ChainProvider,
  ChainTransfer,
  DEFAULT_USDT_BEP20_CONTRACT,
  GetUsdtTransfersParams,
} from './chain-provider';

const USDT_ABI = [
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'function balanceOf(address owner) view returns (uint256)',
];

@Injectable()
export class BscChainProvider implements ChainProvider {
  private readonly provider: JsonRpcProvider;
  private readonly usdt: Contract;

  constructor() {
    // 不在这里强校验 env：e2e 会覆盖该 provider；缺 URL 时只会在真正发请求时失败。
    this.provider = new JsonRpcProvider(process.env.BSC_RPC_URL);
    this.usdt = new Contract(
      process.env.USDT_BEP20_CONTRACT || DEFAULT_USDT_BEP20_CONTRACT,
      USDT_ABI,
      this.provider,
    );
  }

  async getLatestBlock(): Promise<number> {
    return this.provider.getBlockNumber();
  }

  async getUsdtTransfers(p: GetUsdtTransfersParams): Promise<ChainTransfer[]> {
    const events = await this.usdt.queryFilter(
      this.usdt.filters.Transfer(null, p.to),
      p.fromBlock,
      p.toBlock,
    );

    const transfers: ChainTransfer[] = [];
    for (const event of events) {
      // queryFilter 的返回类型为 (EventLog | Log)[]；只有解析出 args 的才是目标事件。
      if (!(event instanceof EventLog) || !event.args) continue;
      transfers.push({
        txHash: event.transactionHash,
        logIndex: event.index,
        from: String(event.args[0]).toLowerCase(),
        to: String(event.args[1]).toLowerCase(),
        amountWei: String(event.args[2]),
        blockNumber: event.blockNumber,
      });
    }
    return transfers;
  }

  async getUsdtBalance(address: string): Promise<string> {
    const balance: bigint = await this.usdt.balanceOf(address);
    return balance.toString();
  }
}

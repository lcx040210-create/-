/**
 * 链上数据源抽象：BscWatcherService 只依赖该接口，e2e 注入 FakeChainProvider。
 * T18（对账）会在此接口上追加 getUsdtBalance。
 */

export interface GetUsdtTransfersParams {
  /** 平台收款地址（小写） */
  to: string;
  /** 含端点 */
  fromBlock: number;
  /** 含端点 */
  toBlock: number;
}

export interface ChainTransfer {
  txHash: string;
  logIndex: number;
  /** 小写地址 */
  from: string;
  /** 小写地址 */
  to: string;
  /** 18 位小数的十进制字符串（wei） */
  amountWei: string;
  blockNumber: number;
}

export interface ChainProvider {
  getLatestBlock(): Promise<number>;
  getUsdtTransfers(p: GetUsdtTransfersParams): Promise<ChainTransfer[]>;
  /** USDT(BEP20) balanceOf(address)，原始 wei 整数的十进制字符串。 */
  getUsdtBalance(address: string): Promise<string>;
}

/** DI token：DepositsModule 默认绑定 BscChainProvider，测试覆盖为 Fake。 */
export const CHAIN_PROVIDER = Symbol('CHAIN_PROVIDER');

/** BSC 主网 USDT（BEP20）合约地址 */
export const DEFAULT_USDT_BEP20_CONTRACT = '0x55d398326f99059fF775485246999027B3197955';

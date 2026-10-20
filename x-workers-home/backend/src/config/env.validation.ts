import { Logger } from '@nestjs/common';

/** 充值最小确认数默认值；env 非法时统一回退到该值。 */
export const DEFAULT_DEPOSIT_MIN_CONFIRMATIONS = 15;

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const ZERO_ADDRESS_PATTERN = /^0x0{40}$/i;

/** 0x + 40 位十六进制（不排除零地址）。 */
export function isEvmAddress(raw: string | null | undefined): boolean {
  return ADDRESS_PATTERN.test((raw ?? '').trim());
}

/** 合法且非零的 EVM 地址（平台收款地址必须满足）。 */
export function isNonZeroEvmAddress(raw: string | null | undefined): boolean {
  const value = (raw ?? '').trim();
  return ADDRESS_PATTERN.test(value) && !ZERO_ADDRESS_PATTERN.test(value);
}

/**
 * 解析 DEPOSIT_MIN_CONFIRMATIONS：空串不再被 Number('')=0 误判为合法 0。
 * 仅接受正整数；非法返回 null（由调用方决定 warn / 回退）。
 */
export function parseDepositMinConfirmations(
  raw: string | null | undefined,
): number | null {
  const text = (raw ?? '').trim();
  if (!text || !/^\d+$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export interface EnvWarnLogger {
  warn(message: string): void;
}

/**
 * 资金相关 env 启动校验（fail-closed）：
 * - 双 JWT 密钥非空且不同；
 * - 平台收款地址必须是合法非零地址；
 * - USDT 合约地址格式合法；
 * - 确认数非法时回退默认值并 warn（写回 env，监听器只读）。
 */
export function validateEnv(
  env: NodeJS.ProcessEnv = process.env,
  logger: EnvWarnLogger = new Logger('EnvValidation'),
): void {
  const jwtSecret = (env.JWT_SECRET ?? '').trim();
  const jwtRefreshSecret = (env.JWT_REFRESH_SECRET ?? '').trim();
  if (!jwtSecret || !jwtRefreshSecret || jwtSecret === jwtRefreshSecret) {
    throw new Error(
      '环境变量校验失败：JWT_SECRET 与 JWT_REFRESH_SECRET 必须非空且不相同',
    );
  }

  if (!isNonZeroEvmAddress(env.PLATFORM_WALLET_ADDRESS)) {
    throw new Error(
      '环境变量校验失败：PLATFORM_WALLET_ADDRESS 必须是合法的非零 BSC 地址（0x + 40 位十六进制）',
    );
  }

  if (!isEvmAddress(env.USDT_BEP20_CONTRACT)) {
    throw new Error(
      '环境变量校验失败：USDT_BEP20_CONTRACT 必须是合法的 BSC 合约地址（0x + 40 位十六进制）',
    );
  }

  const rawConfirmations = env.DEPOSIT_MIN_CONFIRMATIONS;
  if (parseDepositMinConfirmations(rawConfirmations) === null) {
    env.DEPOSIT_MIN_CONFIRMATIONS = String(DEFAULT_DEPOSIT_MIN_CONFIRMATIONS);
    logger.warn(
      `DEPOSIT_MIN_CONFIRMATIONS 非法（"${rawConfirmations ?? ''}"），已回退为 ${DEFAULT_DEPOSIT_MIN_CONFIRMATIONS}`,
    );
  }
}

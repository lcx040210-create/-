/**
 * 金额工具：与后端 `backend/src/common/money.ts` 完全同口径。
 *
 * 全项目金额一律用整数 micro-XM（1 XM = 1_000_000 micro）表示，
 * 所有运算只使用 BigInt；费率除法向下取整，零头留给用户侧。
 * 本文件禁止出现任何浮点金额运算。
 */

export const MICRO = 1_000_000n;

/** 十进制字符串 → micro；最多 6 位小数，负 / 空 / 非十进制 → 抛 RangeError。 */
const XM_PATTERN = /^(\d+)(?:\.(\d+))?$/;

export function parseXm(value: string): bigint {
  if (typeof value !== 'string') {
    throw new RangeError('非法金额：必须是字符串');
  }
  const text = value.trim();
  const match = XM_PATTERN.exec(text);
  if (!match) {
    throw new RangeError(`非法金额："${value}"`);
  }
  const whole = match[1];
  const frac = match[2] ?? '';
  if (frac.length > 6) {
    throw new RangeError(`非法金额："${value}" 最多支持 6 位小数`);
  }
  return BigInt(whole) * MICRO + BigInt(frac.padEnd(6, '0'));
}

/** micro → 十进制字符串（去掉无意义的尾零）。 */
export function formatXm(micro: bigint): string {
  const negative = micro < 0n;
  const abs = negative ? -micro : micro;
  const whole = abs / MICRO;
  const frac = abs % MICRO;

  let out = whole.toString();
  if (frac !== 0n) {
    out += `.${frac.toString().padStart(6, '0').replace(/0+$/, '')}`;
  }
  return negative ? `-${out}` : out;
}

/** 向下取整的百分比计算：basis points（1% = 100bp，基数 10000）。 */
function pctFloor(amount: bigint, basisPoints: bigint): bigint {
  return (amount * basisPoints) / 10_000n;
}

/** 费率（百分数）→ basis points。费率本身是配置值，不是金额，允许 number。 */
function toBasisPoints(pct: number): bigint {
  if (!Number.isFinite(pct) || pct < 0) {
    throw new RangeError(`非法费率："${pct}"`);
  }
  return BigInt(Math.round(pct * 100));
}

/** 按费率收取的手续费（floor 到 micro）。 */
export function feeOf(amountXm: string, pct: number): string {
  return formatXm(pctFloor(parseXm(amountXm), toBasisPoints(pct)));
}

/** 订单到手价：P − floor(P × 5%)。 */
export function payoutOf(priceXm: string): string {
  const price = parseXm(priceXm);
  return formatXm(price - pctFloor(price, 500n));
}

/** 提现预览：10% 手续费（floor），其余给用户。 */
export function withdrawalPreview(amountXm: string): { fee: string; payout: string } {
  const amount = parseXm(amountXm);
  const fee = pctFloor(amount, 1_000n);
  return { fee: formatXm(fee), payout: formatXm(amount - fee) };
}

/**
 * 全项目金额口径：整数 micro-XM（1 XM = 1_000_000 micro）。
 * 只用 bigint，禁止 number 算术 / 浮点 / parseFloat。
 */

export const MICRO = 1_000_000n;

/** 费率除法一律向下取整，零头留给用户侧。 */
export function pctFloor(amount: bigint, num: number, den: number): bigint {
  return (amount * BigInt(num)) / BigInt(den);
}

/** 十进制字符串："100" / "100.5" → micro。最多 6 位小数；负 / 空 / 非十进制 → 抛错。 */
const XM_PATTERN = /^(\d+)(?:\.(\d+))?$/;

export function parseXm(s: string): bigint {
  if (typeof s !== 'string') {
    throw new RangeError('非法金额：必须是字符串');
  }
  const text = s.trim();
  const match = XM_PATTERN.exec(text);
  if (!match) {
    throw new RangeError(`非法金额："${s}"`);
  }
  const whole = match[1];
  const frac = match[2] ?? '';
  if (frac.length > 6) {
    throw new RangeError(`非法金额："${s}" 最多支持 6 位小数`);
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
    const digits = frac.toString().padStart(6, '0').replace(/0+$/, '');
    out += `.${digits}`;
  }
  return negative ? `-${out}` : out;
}

/** 链上 18 位小数字符串 → micro，向下取整；全程字符串处理，不经过 Number。 */
const WEI_PATTERN = /^(\d+)(?:\.(\d+))?$/;

export function fromWei18(s: string): bigint {
  if (typeof s !== 'string') {
    throw new RangeError('非法链上金额：必须是字符串');
  }
  const text = s.trim();
  const match = WEI_PATTERN.exec(text);
  if (!match) {
    throw new RangeError(`非法链上金额："${s}"`);
  }
  const whole = match[1];
  const frac = match[2] ?? '';
  if (frac.length > 18) {
    throw new RangeError(`非法链上金额："${s}" 超过 18 位小数`);
  }
  // 前 6 位小数恰好是 micro-XM 的小数部分，其余位直接丢弃（floor）。
  const microFrac = frac.padEnd(18, '0').slice(0, 6);
  return BigInt(whole) * MICRO + BigInt(microFrac);
}

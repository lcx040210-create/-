import { formatXm } from './format';

/**
 * 管理端金额展示：把后端的 micro 整数串（`BigInt.toString()`）转成十进制 XM 串。
 *
 * 对账接口的字段单位混用，务必区分：
 * - `totalXm` 已经是十进制 XM 串，直接展示；
 * - `walletUsdtMicro` / `requiredMicro` / `deficitMicro` / `income.*` / `accounts.*`
 *   都是 micro 整数串，必须经本函数转换。
 *
 * 非法值（空 / 非整数）原样返回，避免管理端因单个脏数据整页崩掉。
 */
export function formatMicro(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '0';
  try {
    return formatXm(BigInt(value));
  } catch {
    return String(value);
  }
}

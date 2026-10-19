import { ValueTransformer } from 'typeorm';

/**
 * PostgreSQL bigint（int8）经 pg 驱动返回字符串；实体层统一转成 bigint，
 * 写入时再转回十进制字符串。金额在 JS 里必须是 bigint。
 */
export const bigintTransformer: ValueTransformer = {
  to: (value: bigint | null | undefined): string | null | undefined =>
    value === null || value === undefined ? value : value.toString(),
  from: (value: string | null): bigint | null =>
    value === null ? null : BigInt(value),
};

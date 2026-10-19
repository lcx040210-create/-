import { BadRequestException } from '@nestjs/common';
import { formatXm } from './money';

/** 金额为 0 / 负数 / 非 bigint。 */
export class InvalidAmountError extends BadRequestException {
  constructor(message = '金额必须为正的 bigint（micro-XM）') {
    super(message);
  }
}

/** 可用（或冻结）余额不足；此时调用方事务不得产生任何写入。 */
export class InsufficientFundsError extends BadRequestException {
  constructor(availableMicro?: bigint, requiredMicro?: bigint) {
    if (availableMicro !== undefined && requiredMicro !== undefined) {
      super(
        `余额不足：可用 ${formatXm(availableMicro)} XM，需要 ${formatXm(requiredMicro)} XM`,
      );
    } else {
      super('余额不足');
    }
  }
}

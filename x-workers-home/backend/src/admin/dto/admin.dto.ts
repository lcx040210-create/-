import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class AdminLoginDto {
  @IsString()
  @IsNotEmpty()
  address: string;

  @IsString()
  @IsNotEmpty()
  password: string;
}

const WITHDRAWAL_STATUSES = ['pending', 'approved', 'paid', 'rejected'] as const;
const DEPOSIT_STATUSES = ['unmatched', 'credited'] as const;
const ORDER_TYPES = ['post', 'comment', 'quote'] as const;
const ORDER_STATUSES = ['recruiting', 'closed', 'completed'] as const;
const BINDING_STATUSES = ['pending', 'approved', 'rejected'] as const;

export class AdminWithdrawalListDto {
  @IsOptional()
  @IsIn(WITHDRAWAL_STATUSES)
  status?: (typeof WITHDRAWAL_STATUSES)[number];
}

export class AdminWithdrawalRejectDto {
  @IsString()
  @IsNotEmpty()
  reason: string;
}

export class AdminWithdrawalPaidDto {
  @IsString()
  @IsNotEmpty()
  txHash: string;
}

export class AdminDepositListDto {
  @IsOptional()
  @IsIn(DEPOSIT_STATUSES)
  status?: (typeof DEPOSIT_STATUSES)[number];
}

export class AdminDepositClaimDto {
  /** 按地址找用户（推荐）；与 userId 二选一。 */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  userAddress?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @IsUUID()
  userId?: string;
}

export class AdminResolveDeliveryDto {
  @IsBoolean()
  pass: boolean;
}

export class AdminDisputeListDto {
  @IsOptional()
  @IsIn(['open', 'all'])
  status?: 'open' | 'all';
}

export class AdminDisputeResolveDto {
  @IsIn(['payout', 'refund', 'clawback'])
  ruling: 'payout' | 'refund' | 'clawback';

  @IsOptional()
  @IsString()
  note?: string;
}

export class AdminOrderListDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsIn(ORDER_TYPES)
  type?: (typeof ORDER_TYPES)[number];

  @IsOptional()
  @IsIn(ORDER_STATUSES)
  status?: (typeof ORDER_STATUSES)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
}

export class AdminPenalizeDto {
  @IsString()
  @IsNotEmpty()
  reason: string;
}

export class AdminUserListDto {
  @IsOptional()
  @IsString()
  q?: string;
}

export class AdminBindingChangeListDto {
  @IsOptional()
  @IsIn(BINDING_STATUSES)
  status?: (typeof BINDING_STATUSES)[number];
}

export class AdminBindingChangeRejectDto {
  @IsString()
  @IsNotEmpty()
  reason: string;
}

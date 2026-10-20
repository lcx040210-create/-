import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { LedgerService } from './ledger.service';

@Controller('ledger')
@UseGuards(JwtAuthGuard)
export class LedgerController {
  constructor(private readonly ledger: LedgerService) {}

  /** 本人余额与最近 50 条流水（只读）。 */
  @Get('mine')
  mine(@CurrentUser() user: AuthUser) {
    return this.ledger.getMine(user.userId);
  }
}

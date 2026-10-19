import { Controller, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { SettlementService } from './settlement.service';

@Controller('slots')
export class SettlementController {
  constructor(private readonly settlement: SettlementService) {}

  /** 商家确认放款（幂等：重复确认不会重复入队/重复放款）。 */
  @Post(':id/confirm')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  confirm(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.settlement.confirm(id, user.userId);
  }
}

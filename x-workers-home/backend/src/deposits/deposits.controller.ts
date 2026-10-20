import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { DepositsService } from './deposits.service';

@Controller('deposits')
export class DepositsController {
  constructor(private readonly deposits: DepositsService) {}

  /** 公开端点：平台收款地址（未配置时 503，绝不下发用户绑定钱包）。 */
  @Get('address')
  address() {
    return this.deposits.platformAddress();
  }

  @Get('mine')
  @UseGuards(JwtAuthGuard)
  mine(@CurrentUser() user: AuthUser) {
    return this.deposits.listMine(user.userId);
  }
}

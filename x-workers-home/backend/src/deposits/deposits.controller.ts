import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { DepositsService } from './deposits.service';

@Controller('deposits')
@UseGuards(JwtAuthGuard)
export class DepositsController {
  constructor(private readonly deposits: DepositsService) {}

  @Get('mine')
  mine(@CurrentUser() user: AuthUser) {
    return this.deposits.listMine(user.userId);
  }
}

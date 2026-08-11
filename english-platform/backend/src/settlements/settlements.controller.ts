import { Controller, Get, Post, Param, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SettlementsService } from './settlements.service';
import { User, UserRole } from '../users/entities/user.entity';

@Controller('settlements')
export class SettlementsController {
  constructor(private settlementsService: SettlementsService) {}

  // 管理员计算结算
  @Post('calculate')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async calculate(@Body() body: { teacher_id: string; period_start: string; period_end: string }) {
    return this.settlementsService.calculate(body.teacher_id, body.period_start, body.period_end);
  }

  // 老师看自己的结算
  @Get('mine')
  @UseGuards(JwtAuthGuard)
  async getMine(@CurrentUser() user: User) {
    return this.settlementsService.getTeacherSettlements(user.id);
  }

  // 管理员看全部结算
  @Get('all')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async getAll() {
    return this.settlementsService.getAllSettlements();
  }

  // 确认结算
  @Post(':id/confirm')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async confirm(@Param('id') id: string) {
    return this.settlementsService.confirmSettlement(id);
  }

  // 标记已付款
  @Post(':id/paid')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async markPaid(@Param('id') id: string) {
    return this.settlementsService.markPaid(id);
  }
}

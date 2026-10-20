import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { OrdersService } from './orders.service';

/** 商家本人的订单列表（全部状态），只读。 */
@Controller('me')
@UseGuards(JwtAuthGuard)
export class MeOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get('orders')
  mine(@CurrentUser() user: AuthUser) {
    return this.orders.listMine(user.userId);
  }
}

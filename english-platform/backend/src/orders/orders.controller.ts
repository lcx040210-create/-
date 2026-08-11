import { Controller, Get, Post, Body, UseGuards, ForbiddenException } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { OrdersService } from './orders.service';
import { User } from '../users/entities/user.entity';

@Controller('orders')
export class OrdersController {
  constructor(private ordersService: OrdersService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  async createOrder(
    @CurrentUser() user: User,
    @Body('package_id') packageId: string,
    @Body('pay_channel') payChannel: string,
  ) {
    if (user.role !== 'student') throw new ForbiddenException('仅学生可购买');
    return this.ordersService.createOrder(user.id, packageId, payChannel);
  }

  @Post('payment-callback')
  async paymentCallback(@Body('order_id') orderId: string) {
    return this.ordersService.handlePaymentCallback(orderId);
  }

  @Get('mine')
  @UseGuards(JwtAuthGuard)
  async myOrders(@CurrentUser() user: User) {
    return this.ordersService.getStudentOrders(user.id);
  }

  @Get('balances')
  @UseGuards(JwtAuthGuard)
  async myBalances(@CurrentUser() user: User) {
    return this.ordersService.getStudentBalances(user.id);
  }
}

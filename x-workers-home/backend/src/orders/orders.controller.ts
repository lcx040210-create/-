import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CreateOrderDto } from './dto/create-order.dto';
import { ListOrdersDto } from './dto/list-orders.dto';
import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateOrderDto) {
    return this.orders.create(user.userId, dto);
  }

  /** 公开免登录。 */
  @Get()
  list(@Query() query: ListOrdersDto) {
    return this.orders.list(query);
  }

  /** 公开免登录；closed 状态也可查看。 */
  @Get(':id')
  detail(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.orders.detail(id);
  }

  @Post(':id/close')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  close(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.orders.close(user.userId, id);
  }
}

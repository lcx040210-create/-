import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { DeliverSlotDto } from './dto/deliver-slot.dto';
import { SlotsService } from './slots.service';

@Controller()
export class SlotsController {
  constructor(private readonly slots: SlotsService) {}

  /** 抢单：订单行锁内复核名额，防超卖。 */
  @Post('orders/:id/take')
  @UseGuards(JwtAuthGuard)
  take(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.slots.take(id, user.userId);
  }

  /** 交付：reserved → verifying，事务外入队核验任务。 */
  @Post('slots/:id/deliver')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  deliver(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: DeliverSlotDto,
  ) {
    return this.slots.deliver(id, user.userId, dto.deliveryUrl);
  }

  /** 我的接单列表。 */
  @Get('me/slots')
  @UseGuards(JwtAuthGuard)
  listMine(@CurrentUser() user: AuthUser) {
    return this.slots.listMine(user.userId);
  }
}

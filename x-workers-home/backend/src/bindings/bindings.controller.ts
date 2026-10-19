import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { BindingsService } from './bindings.service';
import { StartXBindingDto } from './dto/start-x-binding.dto';
import { WalletChangeDto } from './dto/wallet-change.dto';
import { XChangeDto } from './dto/x-change.dto';

@Controller('bindings')
@UseGuards(JwtAuthGuard)
export class BindingsController {
  constructor(private readonly bindings: BindingsService) {}

  @Post('x/start')
  startX(@CurrentUser() user: AuthUser, @Body() dto: StartXBindingDto) {
    return this.bindings.start(user.userId, dto.handle);
  }

  @Get('x/status')
  xStatus(@CurrentUser() user: AuthUser) {
    return this.bindings.status(user.userId);
  }

  @Post('x/change')
  changeX(@CurrentUser() user: AuthUser, @Body() dto: XChangeDto) {
    return this.bindings.requestXChange(user.userId, dto.handle);
  }

  @Post('wallet/change')
  changeWallet(@CurrentUser() user: AuthUser, @Body() dto: WalletChangeDto) {
    return this.bindings.requestWalletChange(user.userId, dto.newAddress, dto.signature);
  }

  @Get('changes')
  changes(@CurrentUser() user: AuthUser) {
    return this.bindings.listChanges(user.userId);
  }
}

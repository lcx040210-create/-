import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthService } from './auth.service';
import { NonceDto } from './dto/nonce.dto';
import { RefreshDto } from './dto/refresh.dto';
import { VerifyDto } from './dto/verify.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('nonce')
  nonce(@Body() dto: NonceDto) {
    return this.authService.issueNonce(dto.address);
  }

  @Post('verify')
  verify(@Body() dto: VerifyDto) {
    return this.authService.verify(
      dto.address,
      dto.signature,
      dto.referralCode,
      dto.termsVersion,
    );
  }

  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthUser) {
    return this.authService.me(user.userId);
  }
}

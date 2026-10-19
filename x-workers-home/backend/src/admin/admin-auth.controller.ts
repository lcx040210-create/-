import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminLoginDto } from './dto/admin.dto';

/** 管理员登录：独立于用户钱包签名登录，bcrypt + role 校验。 */
@Controller('admin')
export class AdminAuthController {
  constructor(private readonly admin: AdminService) {}

  @Post('login')
  @HttpCode(200)
  login(@Body() dto: AdminLoginDto) {
    return this.admin.login(dto.address, dto.password);
  }
}

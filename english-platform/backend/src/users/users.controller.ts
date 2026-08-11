import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';

@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getProfile(@CurrentUser() user: User) {
    const profile = await this.usersService.findById(user.id);
    const { password_hash, ...safe } = profile as any;

    if (user.role !== 'admin') {
      delete safe.email;
      delete safe.phone;
    }

    return safe;
  }
}

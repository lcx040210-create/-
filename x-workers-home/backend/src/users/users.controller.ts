import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /** 公开主页：无需 JWT；未知用户 404，非法 id 400。 */
  @Get(':id/public')
  publicProfile(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.users.getPublicProfile(id);
  }
}

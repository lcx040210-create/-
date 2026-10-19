import {
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { VerificationService } from './verification.service';

@Controller()
export class VerificationController {
  constructor(private readonly verification: VerificationService) {}

  /** 交付驳回申诉：仅名额 creator 且存在 last_reject；重复申诉幂等。 */
  @Post('slots/:id/appeal')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  appeal(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.verification.appeal(id, user.userId);
  }
}

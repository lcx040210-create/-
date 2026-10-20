import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { AdminGuard } from '../common/guards/admin.guard';
import { PublishTermsDto } from './dto/publish-terms.dto';
import { TermsService } from './terms.service';

/** 公开：当前生效条款（注册前展示 + 与本地版本比对）。 */
@Controller('terms')
export class TermsController {
  constructor(private readonly terms: TermsService) {}

  @Get('current')
  current() {
    return this.terms.current();
  }
}

/** 管理端：发布新版本（AdminGuard + terms_publish 审计）。 */
@Controller('admin/terms')
@UseGuards(AdminGuard)
export class TermsAdminController {
  constructor(private readonly terms: TermsService) {}

  @Post()
  publish(@CurrentUser() user: AuthUser, @Body() dto: PublishTermsDto) {
    return this.terms.publish(dto.title, dto.contentMd, user.userId);
  }
}

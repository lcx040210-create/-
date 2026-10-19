import {
  Body,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { DisputesService } from './disputes.service';
import { DisputeStatementDto } from './dto/dispute-statement.dto';

@Controller()
export class DisputesController {
  constructor(private readonly disputes: DisputesService) {}

  /** 商家在 48h 确认窗内发起质量争议。 */
  @Post('slots/:id/dispute')
  @UseGuards(JwtAuthGuard)
  dispute(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: DisputeStatementDto,
  ) {
    return this.disputes.raiseQualityDispute(id, user.userId, dto.statement);
  }

  /** 商家在放款后 7 天内举报删帖。 */
  @Post('slots/:id/report-deletion')
  @UseGuards(JwtAuthGuard)
  reportDeletion(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: DisputeStatementDto,
  ) {
    return this.disputes.reportDeletion(id, user.userId, dto.statement);
  }

  /** 当事人（商家 / 接单方）回应争议，追加 evidence。 */
  @Post('disputes/:id/respond')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  respond(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: DisputeStatementDto,
  ) {
    return this.disputes.respond(id, user.userId, dto.statement);
  }
}

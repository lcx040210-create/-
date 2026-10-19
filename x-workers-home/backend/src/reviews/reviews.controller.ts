import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CreateReviewDto } from './dto/create-review.dto';
import { ReviewsService } from './reviews.service';

@Controller()
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  /** 评价对方：仅 paid 名额的商家 / 接单方，每侧一次。 */
  @Post('slots/:id/review')
  @UseGuards(JwtAuthGuard)
  create(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CreateReviewDto,
  ) {
    return this.reviews.create(id, user.userId, dto);
  }

  /** 公开主页消费：星级均分 + 总数 + 近期 10 条。 */
  @Get('users/:id/rating')
  rating(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.reviews.getUserRating(id);
  }
}

import { Controller, Get, Post, Param, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ReviewsService } from './reviews.service';
import { User } from '../users/entities/user.entity';

@Controller('reviews')
export class ReviewsController {
  constructor(private reviewsService: ReviewsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  async create(
    @CurrentUser() user: User,
    @Body() body: { booking_id: string; rating: number; comment?: string },
  ) {
    return this.reviewsService.createReview(user.id, body.booking_id, body.rating, body.comment);
  }

  @Get('about/:userId')
  async getReviews(@Param('userId') userId: string) {
    return this.reviewsService.getReviewsForUser(userId);
  }

  @Get('rating/:userId')
  async getRating(@Param('userId') userId: string) {
    return this.reviewsService.getTeacherRating(userId);
  }
}

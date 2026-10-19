import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { RatingsService } from './ratings.service';

/** 公开端点：无需 JWT，按 X handle 查询账户评级 */
@Controller('ratings')
export class RatingsController {
  constructor(private readonly ratings: RatingsService) {}

  @Get(':handle')
  async getByHandle(@Param('handle') handle: string) {
    const rating = await this.ratings.getByHandle(handle);
    if (!rating) {
      throw new NotFoundException('未找到该账号的评级');
    }
    return rating;
  }
}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { XBinding } from '../bindings/x-binding.entity';
import { User } from '../users/user.entity';
import { XScraperModule } from '../xscraper/xscraper.module';
import { RatingsController } from './ratings.controller';
import { RatingsService } from './ratings.service';
import { UserRating } from './user-rating.entity';

@Module({
  imports: [TypeOrmModule.forFeature([UserRating, User, XBinding]), XScraperModule],
  controllers: [RatingsController],
  providers: [RatingsService],
  exports: [RatingsService],
})
export class RatingsModule {}

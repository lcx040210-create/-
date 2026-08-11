import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { Booking } from '../bookings/booking.entity';
import { Settlement } from '../settlements/settlement.entity';
import { AdminStatsService } from './admin-stats.service';
import { AdminStatsController } from './admin-stats.controller';

@Module({
  imports: [TypeOrmModule.forFeature([User, Booking, Settlement])],
  providers: [AdminStatsService],
  controllers: [AdminStatsController],
})
export class AdminStatsModule {}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Booking } from './booking.entity';
import { BalanceRecord } from '../balances/balance-record.entity';
import { TeacherSchedule } from '../schedules/teacher-schedule.entity';
import { User } from '../users/entities/user.entity';
import { BookingsService } from './bookings.service';
import { BookingsController } from './bookings.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Booking, BalanceRecord, TeacherSchedule, User])],
  providers: [BookingsService],
  controllers: [BookingsController],
  exports: [BookingsService],
})
export class BookingsModule {}

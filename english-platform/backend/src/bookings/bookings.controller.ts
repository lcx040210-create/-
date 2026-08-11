import { Controller, Get, Post, Param, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { BookingsService } from './bookings.service';
import { User } from '../users/entities/user.entity';

@Controller('bookings')
export class BookingsController {
  constructor(private bookingsService: BookingsService) {}

  // 获取某老师的可用时段
  @Get('slots/:teacherId')
  async getSlots(@Param('teacherId') teacherId: string) {
    return this.bookingsService.getAvailableSlots(teacherId);
  }

  // 学生自己预约
  @Post()
  @UseGuards(JwtAuthGuard)
  async create(
    @CurrentUser() user: User,
    @Body() body: { teacher_id: string; start_time: string },
  ) {
    return this.bookingsService.createBooking(user.id, body.teacher_id, body.start_time);
  }

  // 老师帮学生预约
  @Post('proxy')
  @UseGuards(JwtAuthGuard)
  async proxyBook(
    @CurrentUser() user: User,
    @Body() body: { student_id: string; start_time: string },
  ) {
    return this.bookingsService.proxyBooking(user.id, body.student_id, body.start_time);
  }

  // 取消预约
  @Post(':id/cancel')
  @UseGuards(JwtAuthGuard)
  async cancel(@Param('id') id: string, @CurrentUser() user: User) {
    return this.bookingsService.cancelBooking(id, user.id);
  }

  // 我的预约列表
  @Get('mine')
  @UseGuards(JwtAuthGuard)
  async myBookings(@CurrentUser() user: User) {
    return this.bookingsService.getMyBookings(user.id, user.role);
  }
}

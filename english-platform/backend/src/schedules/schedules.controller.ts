import { Controller, Get, Put, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SchedulesService } from './schedules.service';
import { User } from '../users/entities/user.entity';

@Controller('schedules')
export class SchedulesController {
  constructor(private schedulesService: SchedulesService) {}

  @Get('mine')
  @UseGuards(JwtAuthGuard)
  async getMine(@CurrentUser() user: User) {
    return this.schedulesService.getTeacherSchedules(user.id);
  }

  @Put('mine')
  @UseGuards(JwtAuthGuard)
  async setMine(
    @CurrentUser() user: User,
    @Body() body: { slots: { day_of_week: number; start_time: string; end_time: string; is_active?: boolean }[] },
  ) {
    return this.schedulesService.setSchedules(user.id, body.slots);
  }
}

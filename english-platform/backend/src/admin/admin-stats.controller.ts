import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';
import { AdminStatsService } from './admin-stats.service';

@Controller('admin/stats')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminStatsController {
  constructor(private adminStatsService: AdminStatsService) {}

  @Get('dashboard')
  async dashboard() {
    return this.adminStatsService.getDashboardStats();
  }

  @Get('booking-trend')
  async bookingTrend() {
    return this.adminStatsService.getBookingTrend();
  }

  @Get('top-teachers')
  async topTeachers() {
    return this.adminStatsService.getTopTeachers();
  }
}

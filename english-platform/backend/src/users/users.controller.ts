import { Controller, Get, Patch, Post, Param, Body, Query, UseGuards, ForbiddenException } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';
import { UpdateTeacherProfileDto } from './dto/update-teacher-profile.dto';
import { ReviewTeacherDto } from './dto/review-teacher.dto';

@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getProfile(@CurrentUser() user: User) {
    const profile = await this.usersService.findById(user.id);
    const { password_hash, ...safe } = profile as any;

    if (user.role !== 'admin') {
      delete safe.email;
      delete safe.phone;
    }

    return safe;
  }

  @Patch('teacher-profile')
  @UseGuards(JwtAuthGuard)
  async updateTeacherProfile(@CurrentUser() user: User, @Body() dto: UpdateTeacherProfileDto) {
    if (user.role !== 'teacher') throw new ForbiddenException('仅老师可编辑资料');
    return this.usersService.updateTeacherProfile(user.id, dto);
  }

  @Get('teachers')
  async listTeachers(@Query('exam_types') exam_types?: string, @Query('skills') skills?: string) {
    return this.usersService.listTeachers({
      exam_types: exam_types ? exam_types.split(',') : undefined,
      skills: skills ? skills.split(',') : undefined,
    });
  }

  @Get('admin/teachers/pending')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async listPendingTeachers() {
    return this.usersService.listPendingTeachers();
  }

  @Patch('teachers/:id/review')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async reviewTeacher(@Param('id') id: string, @Body() dto: ReviewTeacherDto) {
    return this.usersService.reviewTeacher(id, dto);
  }
}

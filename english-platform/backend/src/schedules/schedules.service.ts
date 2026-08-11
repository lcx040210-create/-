import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TeacherSchedule } from './teacher-schedule.entity';

@Injectable()
export class SchedulesService {
  constructor(
    @InjectRepository(TeacherSchedule)
    private schedulesRepository: Repository<TeacherSchedule>,
  ) {}

  async getTeacherSchedules(teacherId: string) {
    return this.schedulesRepository.find({ where: { teacher_id: teacherId } });
  }

  async setSchedules(teacherId: string, schedules: { day_of_week: number; start_time: string; end_time: string }[]) {
    // 先删旧数据，再批量插入
    await this.schedulesRepository.delete({ teacher_id: teacherId });
    const entities = schedules.map((s) =>
      this.schedulesRepository.create({ teacher_id: teacherId, ...s }),
    );
    return this.schedulesRepository.save(entities);
  }
}

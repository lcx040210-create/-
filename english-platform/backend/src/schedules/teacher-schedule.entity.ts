import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('teacher_schedules')
export class TeacherSchedule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  teacher_id: string;

  @Column('int') // 0=Sun, 1=Mon, ... 6=Sat
  day_of_week: number;

  @Column('time')
  start_time: string;

  @Column('time')
  end_time: string;

  @Column({ default: true })
  is_active: boolean;
}

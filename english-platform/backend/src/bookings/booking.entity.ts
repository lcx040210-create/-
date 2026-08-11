import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export enum BookingStatus {
  BOOKED = 'booked',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  NO_SHOW = 'no_show',
}

export enum BookingCreator {
  STUDENT = 'student',
  TEACHER = 'teacher',
}

@Entity('bookings')
export class Booking {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  student_id: string;

  @Column()
  teacher_id: string;

  @Column('timestamp')
  start_time: Date;

  @Column('timestamp')
  end_time: Date;

  @Column({ type: 'enum', enum: BookingStatus, default: BookingStatus.BOOKED })
  status: BookingStatus;

  @Column({ nullable: true })
  balance_record_id: string;

  @Column({ type: 'enum', enum: BookingCreator })
  created_by: BookingCreator;

  @Column({ nullable: true })
  cancelled_at: Date;

  @CreateDateColumn()
  created_at: Date;
}

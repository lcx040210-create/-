import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { User, UserRole, UserStatus } from '../users/entities/user.entity';
import { Booking, BookingStatus } from '../bookings/booking.entity';
import { Settlement, SettlementStatus } from '../settlements/settlement.entity';
import { TeacherProfile, ReviewStatus } from '../users/entities/teacher-profile.entity';

@Injectable()
export class AdminStatsService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    @InjectRepository(Booking)
    private bookingsRepository: Repository<Booking>,
    @InjectRepository(Settlement)
    private settlementsRepository: Repository<Settlement>,
  ) {}

  async getDashboardStats() {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const [
      totalStudents,
      totalTeachers,
      pendingTeachers,
      todayBookings,
      completedBookings,
      monthlyBookings,
      pendingSettlements,
      monthlySettlementAmount,
    ] = await Promise.all([
      this.usersRepository.count({ where: { role: UserRole.STUDENT } }),
      this.usersRepository.count({ where: { role: UserRole.TEACHER } }),
      this.usersRepository.count({
        where: { role: UserRole.TEACHER, status: UserStatus.PENDING_REVIEW },
      }),
      this.bookingsRepository.count({
        where: {
          status: BookingStatus.BOOKED,
          start_time: Between(todayStart, todayEnd) as any,
        },
      }),
      this.bookingsRepository.count({ where: { status: BookingStatus.COMPLETED } }),
      this.bookingsRepository.count({
        where: {
          start_time: Between(monthStart, monthEnd) as any,
        },
      }),
      this.settlementsRepository.count({ where: { status: SettlementStatus.DRAFT } }),
      this.settlementsRepository
        .createQueryBuilder('s')
        .select('COALESCE(SUM(s.total_amount), 0)', 'total')
        .where('s.period_start >= :monthStart', { monthStart: monthStart.toISOString().split('T')[0] })
        .getRawOne(),
    ]);

    return {
      totalStudents,
      totalTeachers,
      pendingTeachers,
      todayBookings,
      completedBookings,
      monthlyBookings: Number(monthlyBookings),
      pendingSettlements,
      monthlySettlementAmount: Number(monthlySettlementAmount?.total) || 0,
    };
  }

  // 按日期统计预约量（近30天）
  async getBookingTrend() {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const start = new Date(end);
    start.setDate(start.getDate() - 29);
    start.setHours(0, 0, 0, 0);

    const result = await this.bookingsRepository
      .createQueryBuilder('b')
      .select("DATE(b.start_time)", 'date')
      .addSelect('COUNT(*)', 'count')
      .where('b.start_time BETWEEN :start AND :end', { start, end })
      .groupBy("DATE(b.start_time)")
      .orderBy('date', 'ASC')
      .getRawMany();

    return result.map((r) => ({ date: r.date, count: Number(r.count) }));
  }

  // 老师排行榜（按完成课时数）
  async getTopTeachers(limit = 10) {
    return this.bookingsRepository
      .createQueryBuilder('b')
      .select('b.teacher_id', 'teacher_id')
      .addSelect('COUNT(*)', 'total')
      .where('b.status = :status', { status: BookingStatus.COMPLETED })
      .groupBy('b.teacher_id')
      .orderBy('total', 'DESC')
      .limit(limit)
      .getRawMany();
  }
}

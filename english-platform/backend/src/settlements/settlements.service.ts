import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { Settlement, SettlementStatus } from './settlement.entity';
import { Booking, BookingStatus } from '../bookings/booking.entity';
import { Review } from '../reviews/review.entity';
import { User } from '../users/entities/user.entity';
import { BalanceRecord } from '../balances/balance-record.entity';

@Injectable()
export class SettlementsService {
  constructor(
    @InjectRepository(Settlement)
    private settlementsRepository: Repository<Settlement>,
    @InjectRepository(Booking)
    private bookingsRepository: Repository<Booking>,
    @InjectRepository(Review)
    private reviewsRepository: Repository<Review>,
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    @InjectRepository(BalanceRecord)
    private balanceRepository: Repository<BalanceRecord>,
  ) {}

  // 计算某段时间内的老师结算
  async calculate(teacherId: string, periodStart: string, periodEnd: string) {
    const teacher = await this.usersRepository.findOne({
      where: { id: teacherId },
      relations: ['teacherProfile'],
    });
    if (!teacher || !teacher.teacherProfile) throw new BadRequestException('老师不存在');

    const startDate = new Date(periodStart);
    const endDate = new Date(periodEnd);
    endDate.setHours(23, 59, 59, 999);

    // 获取时间段内已完成的课时
    const bookings = await this.bookingsRepository.find({
      where: {
        teacher_id: teacherId,
        status: BookingStatus.COMPLETED,
        start_time: Between(startDate, endDate) as any,
      },
    });

    const totalLessons = bookings.length;
    const baseRate = Number(teacher.teacherProfile.base_rate);
    const baseAmount = totalLessons * baseRate;

    // 量级奖金：按阶梯
    let bonusVolume = 0;
    if (totalLessons >= 100) bonusVolume = totalLessons * 20;
    else if (totalLessons >= 50) bonusVolume = totalLessons * 10;
    else if (totalLessons >= 20) bonusVolume = totalLessons * 5;

    // 评分奖金
    const ratingResult = await this.reviewsRepository
      .createQueryBuilder('review')
      .select('AVG(review.rating)', 'avg')
      .where('review.reviewee_id = :teacherId', { teacherId })
      .andWhere('review.created_at BETWEEN :start AND :end', { start: startDate, end: endDate })
      .getRawOne();

    const avgRating = Number(ratingResult?.avg) || 0;
    let bonusRating = 0;
    if (avgRating >= 4.8) bonusRating = baseAmount * 0.15;
    else if (avgRating >= 4.5) bonusRating = baseAmount * 0.10;
    else if (avgRating >= 4.0) bonusRating = baseAmount * 0.05;

    // 续购率奖金：学生在本结算周期内买了2个以上课包的比率
    const studentIds = [...new Set(bookings.map((b) => b.student_id))];
    let renewalCount = 0;
    for (const sid of studentIds) {
      const orderCount = await this.balanceRepository.count({
        where: { student_id: sid },
      });
      if (orderCount >= 2) renewalCount++;
    }
    const renewalRate = studentIds.length > 0 ? renewalCount / studentIds.length : 0;
    let bonusRenewal = 0;
    if (renewalRate >= 0.6) bonusRenewal = baseAmount * 0.10;
    else if (renewalRate >= 0.4) bonusRenewal = baseAmount * 0.05;

    const totalAmount = baseAmount + bonusVolume + bonusRating + bonusRenewal;

    // 检查是否已有 draft
    const existing = await this.settlementsRepository.findOne({
      where: { teacher_id: teacherId, period_start: periodStart, period_end: periodEnd },
    });
    if (existing) {
      Object.assign(existing, {
        total_lessons: totalLessons,
        base_amount: baseAmount,
        bonus_volume: bonusVolume,
        bonus_rating: Math.round(bonusRating * 100) / 100,
        bonus_renewal: Math.round(bonusRenewal * 100) / 100,
        total_amount: Math.round(totalAmount * 100) / 100,
      });
      return this.settlementsRepository.save(existing);
    }

    const settlement = this.settlementsRepository.create({
      teacher_id: teacherId,
      period_start: periodStart,
      period_end: periodEnd,
      total_lessons: totalLessons,
      base_amount: baseAmount,
      bonus_volume: bonusVolume,
      bonus_rating: Math.round(bonusRating * 100) / 100,
      bonus_renewal: Math.round(bonusRenewal * 100) / 100,
      total_amount: Math.round(totalAmount * 100) / 100,
    });

    return this.settlementsRepository.save(settlement);
  }

  // 获取某老师的结算列表
  async getTeacherSettlements(teacherId: string) {
    return this.settlementsRepository.find({
      where: { teacher_id: teacherId },
      order: { period_start: 'DESC' },
    });
  }

  // 获取所有结算（admin）
  async getAllSettlements() {
    return this.settlementsRepository.find({ order: { period_start: 'DESC' } });
  }

  // 确认结算
  async confirmSettlement(id: string) {
    const s = await this.settlementsRepository.findOne({ where: { id } });
    if (!s) throw new BadRequestException('结算不存在');
    if (s.status !== SettlementStatus.DRAFT) throw new BadRequestException('只能确认草稿状态的结算');
    s.status = SettlementStatus.CONFIRMED;
    return this.settlementsRepository.save(s);
  }

  // 标记已付款
  async markPaid(id: string) {
    const s = await this.settlementsRepository.findOne({ where: { id } });
    if (!s) throw new BadRequestException('结算不存在');
    if (s.status !== SettlementStatus.CONFIRMED) throw new BadRequestException('只能付款已确认的结算');
    s.status = SettlementStatus.PAID;
    return this.settlementsRepository.save(s);
  }
}

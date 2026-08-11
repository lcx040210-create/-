import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';
import { Booking, BookingStatus, BookingCreator } from './booking.entity';
import { BalanceRecord } from '../balances/balance-record.entity';
import { TeacherSchedule } from '../schedules/teacher-schedule.entity';
import { User } from '../users/entities/user.entity';
import { TeacherProfile, ReviewStatus } from '../users/entities/teacher-profile.entity';

@Injectable()
export class BookingsService {
  constructor(
    @InjectRepository(Booking)
    private bookingsRepository: Repository<Booking>,
    @InjectRepository(BalanceRecord)
    private balanceRepository: Repository<BalanceRecord>,
    @InjectRepository(TeacherSchedule)
    private schedulesRepository: Repository<TeacherSchedule>,
    @InjectRepository(User)
    private usersRepository: Repository<User>,
  ) {}

  // 生成某老师未来30天的可用时间槽（每小时一个）
  async getAvailableSlots(teacherId: string, fromDate?: string) {
    const teacher = await this.usersRepository.findOne({
      where: { id: teacherId },
      relations: ['teacherProfile'],
    });
    if (!teacher || !teacher.teacherProfile || teacher.teacherProfile.review_status !== ReviewStatus.APPROVED) {
      throw new BadRequestException('该老师不可预约');
    }

    const schedules = await this.schedulesRepository.find({
      where: { teacher_id: teacherId, is_active: true },
    });

    const start = fromDate ? new Date(fromDate) : new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 30);

    // 获取已预约的课时
    const existingBookings = await this.bookingsRepository.find({
      where: {
        teacher_id: teacherId,
        status: BookingStatus.BOOKED,
        start_time: MoreThanOrEqual(start) as any,
        end_time: LessThanOrEqual(end) as any,
      },
    });

    const bookedTimes = new Set(
      existingBookings.map((b) => b.start_time.toISOString()),
    );

    // 生成时间槽
    const slots: { date: string; time: string; available: boolean }[] = [];
    const maxDaily = teacher.teacherProfile.max_daily_lessons;

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dayOfWeek = d.getDay();
      const daySchedules = schedules.filter((s) => s.day_of_week === dayOfWeek);

      // 计算当日已预约数
      const dayStr = d.toISOString().split('T')[0];
      const dayBookedCount = existingBookings.filter(
        (b) => b.start_time.toISOString().split('T')[0] === dayStr,
      ).length;

      for (const schedule of daySchedules) {
        const [startH, startM] = schedule.start_time.split(':').map(Number);
        const [endH, endM] = schedule.end_time.split(':').map(Number);
        const endMinutes = endH * 60 + endM;

        for (let minutes = startH * 60 + startM; minutes < endMinutes; minutes += 60) {
          const slotDate = new Date(d);
          slotDate.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);

          // 跳过过去的时段 & 4小时内不能预约
          const minBookTime = new Date();
          minBookTime.setHours(minBookTime.getHours() + 4);
          if (slotDate <= minBookTime) continue;

          const key = slotDate.toISOString();
          const alreadyBooked = bookedTimes.has(key);
          const dailyLimitReached = maxDaily && dayBookedCount >= maxDaily && !alreadyBooked;

          slots.push({
            date: slotDate.toISOString().split('T')[0],
            time: `${String(slotDate.getHours()).padStart(2, '0')}:${String(slotDate.getMinutes()).padStart(2, '0')}`,
            available: !alreadyBooked && !dailyLimitReached,
          });
        }
      }
    }

    return { teacher, slots };
  }

  // 学生预约
  async createBooking(
    studentId: string,
    teacherId: string,
    startTime: string,
  ) {
    return this._createBooking(studentId, teacherId, startTime, BookingCreator.STUDENT);
  }

  // 老师代约
  async proxyBooking(
    teacherId: string,
    studentId: string,
    startTime: string,
  ) {
    return this._createBooking(studentId, teacherId, startTime, BookingCreator.TEACHER);
  }

  private async _createBooking(
    studentId: string,
    teacherId: string,
    startTime: string,
    createdBy: BookingCreator,
  ) {
    const slotDate = new Date(startTime);
    const endDate = new Date(slotDate.getTime() + 60 * 60 * 1000);

    // 冲突检测
    const conflict = await this.bookingsRepository.findOne({
      where: {
        teacher_id: teacherId,
        status: BookingStatus.BOOKED,
        start_time: LessThanOrEqual(endDate) as any,
        end_time: MoreThanOrEqual(slotDate) as any,
      },
    });
    if (conflict) throw new BadRequestException('该时段已被预约');

    // 4小时提前
    const minTime = new Date(Date.now() + 4 * 60 * 60 * 1000);
    if (slotDate <= minTime) throw new BadRequestException('需至少提前4小时预约');

    // 老师状态检查
    const teacher = await this.usersRepository.findOne({
      where: { id: teacherId },
      relations: ['teacherProfile'],
    });
    if (!teacher || teacher.teacherProfile?.review_status !== ReviewStatus.APPROVED) {
      throw new BadRequestException('该老师不可预约');
    }

    // 日上限检查
    const dayStr = slotDate.toISOString().split('T')[0];
    const dayStart = new Date(`${dayStr}T00:00:00`);
    const dayEnd = new Date(`${dayStr}T23:59:59`);
    const dayCount = await this.bookingsRepository.count({
      where: {
        teacher_id: teacherId,
        status: BookingStatus.BOOKED,
        start_time: MoreThanOrEqual(dayStart) as any,
        end_time: LessThanOrEqual(dayEnd) as any,
      },
    });
    const maxDaily = teacher.teacherProfile.max_daily_lessons;
    if (maxDaily && dayCount >= maxDaily) {
      throw new BadRequestException('该老师当天课时已满');
    }

    // 匹配课时余额
    const balance = await this.findMatchingBalance(
      studentId,
      teacher.teacherProfile.exam_types,
      teacher.teacherProfile.skills,
    );
    if (!balance) throw new BadRequestException('课时不足，请购买对应课包');

    // 扣减
    balance.remaining -= 1;
    await this.balanceRepository.save(balance);

    // 创建预约
    const booking = this.bookingsRepository.create({
      student_id: studentId,
      teacher_id: teacherId,
      start_time: slotDate,
      end_time: endDate,
      balance_record_id: balance.id,
      created_by: createdBy,
    });

    return this.bookingsRepository.save(booking);
  }

  // 取消预约
  async cancelBooking(bookingId: string, userId: string) {
    const booking = await this.bookingsRepository.findOne({ where: { id: bookingId } });
    if (!booking) throw new NotFoundException('预约不存在');
    if (booking.status !== BookingStatus.BOOKED) throw new BadRequestException('预约状态不可取消');

    const isStudent = booking.student_id === userId;
    const isTeacher = booking.teacher_id === userId;
    if (!isStudent && !isTeacher) throw new BadRequestException('无权操作');

    // 12小时免费取消
    const cancelDeadline = new Date(booking.start_time.getTime() - 12 * 60 * 60 * 1000);
    const now = new Date();

    booking.status = BookingStatus.CANCELLED;
    booking.cancelled_at = now;
    await this.bookingsRepository.save(booking);

    if (now <= cancelDeadline) {
      // 退回课时
      if (booking.balance_record_id) {
        const balance = await this.balanceRepository.findOne({ where: { id: booking.balance_record_id } });
        if (balance) {
          balance.remaining += 1;
          await this.balanceRepository.save(balance);
        }
      }
      return { ...booking, refunded: true };
    }

    return { ...booking, refunded: false };
  }

  // 获取我的预约列表
  async getMyBookings(userId: string, role: string) {
    const where = role === 'student'
      ? { student_id: userId }
      : { teacher_id: userId };
    return this.bookingsRepository.find({ where, order: { start_time: 'ASC' } });
  }

  // FIFO 匹配余额
  private async findMatchingBalance(
    studentId: string,
    examTypes: string[],
    skills: string[],
  ): Promise<BalanceRecord | null> {
    const balances = await this.balanceRepository.find({
      where: { student_id: studentId },
      order: { expires_at: 'ASC' },
    });

    const today = new Date().toISOString().split('T')[0];

    for (const b of balances) {
      if (b.remaining <= 0) continue;
      if (b.expires_at < today) continue;

      // 余额的 exam_types 包含老师所有 exam_types 中的至少一个，且 skills 包含老师所有 skills 中的至少一个
      const matchesExam = examTypes.some((et) => b.exam_types.includes(et));
      const matchesSkill = skills.some((s) => b.skills.includes(s));

      if (matchesExam && matchesSkill) return b;
    }

    return null;
  }
}

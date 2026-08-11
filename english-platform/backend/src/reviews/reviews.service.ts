import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Review } from './review.entity';
import { Booking, BookingStatus } from '../bookings/booking.entity';
import { User, UserRole } from '../users/entities/user.entity';
import { TeacherProfile } from '../users/entities/teacher-profile.entity';

@Injectable()
export class ReviewsService {
  constructor(
    @InjectRepository(Review)
    private reviewsRepository: Repository<Review>,
    @InjectRepository(Booking)
    private bookingsRepository: Repository<Booking>,
    @InjectRepository(User)
    private usersRepository: Repository<User>,
  ) {}

  // 学生评价老师或老师评价学生
  async createReview(
    reviewerId: string,
    bookingId: string,
    rating: number,
    comment?: string,
  ) {
    if (rating < 1 || rating > 5) throw new BadRequestException('评分需在1-5之间');

    const booking = await this.bookingsRepository.findOne({ where: { id: bookingId } });
    if (!booking) throw new NotFoundException('预约不存在');
    if (booking.status !== BookingStatus.COMPLETED) throw new BadRequestException('只能评价已完成的课程');

    // 确定评价方向
    const reviewer = await this.usersRepository.findOne({ where: { id: reviewerId } });
    if (!reviewer) throw new BadRequestException('用户不存在');

    const isStudentReview = reviewer.role === UserRole.STUDENT;
    const revieweeId = isStudentReview ? booking.teacher_id : booking.student_id;

    // 检查是否已评价
    const existing = await this.reviewsRepository.findOne({
      where: { booking_id: bookingId, reviewer_id: reviewerId },
    });
    if (existing) throw new BadRequestException('已评价过该课程');

    const review = this.reviewsRepository.create({
      booking_id: bookingId,
      reviewer_id: reviewerId,
      reviewee_id: revieweeId,
      rating,
      comment,
    });

    return this.reviewsRepository.save(review);
  }

  // 获取用户收到的评价
  async getReviewsForUser(userId: string) {
    return this.reviewsRepository.find({
      where: { reviewee_id: userId },
      order: { created_at: 'DESC' },
    });
  }

  // 获取老师的平均评分
  async getTeacherRating(teacherId: string): Promise<{ avg: number; count: number }> {
    const result = await this.reviewsRepository
      .createQueryBuilder('review')
      .select('AVG(review.rating)', 'avg')
      .addSelect('COUNT(*)', 'count')
      .where('review.reviewee_id = :teacherId', { teacherId })
      .getRawOne();

    return {
      avg: result?.avg ? Math.round(Number(result.avg) * 10) / 10 : 0,
      count: Number(result?.count) || 0,
    };
  }

  // 获取学生的平均评分（老师对学生的评价）
  async getStudentRating(studentId: string): Promise<{ avg: number; count: number }> {
    return this.getTeacherRating(studentId); // same logic
  }
}

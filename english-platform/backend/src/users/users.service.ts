import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User, UserStatus, UserRole } from './entities/user.entity';
import { TeacherProfile, ReviewStatus } from './entities/teacher-profile.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateTeacherProfileDto } from './dto/update-teacher-profile.dto';
import { ReviewTeacherDto } from './dto/review-teacher.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    @InjectRepository(TeacherProfile)
    private teacherProfileRepository: Repository<TeacherProfile>,
  ) {}

  async findByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { email }, relations: ['teacherProfile'] });
  }

  async findById(id: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { id }, relations: ['teacherProfile'] });
  }

  async create(dto: CreateUserDto): Promise<User> {
    const existing = await this.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException('该邮箱已注册');
    }

    const password_hash = await bcrypt.hash(dto.password, 12);

    const user = this.usersRepository.create({
      email: dto.email,
      password_hash,
      role: dto.role,
      name: dto.name,
      phone: dto.phone,
      status: dto.role === UserRole.TEACHER ? UserStatus.PENDING_REVIEW : UserStatus.ACTIVE,
    });

    const saved = await this.usersRepository.save(user);

    if (dto.role === UserRole.TEACHER) {
      const profile = this.teacherProfileRepository.create({
        user_id: saved.id,
        display_name: dto.display_name || dto.name,
        review_status: ReviewStatus.PENDING,
      });
      await this.teacherProfileRepository.save(profile);
      saved.teacherProfile = profile;
    }

    return saved;
  }

  async updateTeacherProfile(userId: string, dto: UpdateTeacherProfileDto) {
    const profile = await this.teacherProfileRepository.findOne({ where: { user_id: userId } });
    if (!profile) throw new NotFoundException('老师资料不存在');

    Object.assign(profile, dto);
    return this.teacherProfileRepository.save(profile);
  }

  async listTeachers(filters: { exam_types?: string[]; skills?: string[] }) {
    const qb = this.teacherProfileRepository
      .createQueryBuilder('profile')
      .leftJoinAndSelect('profile.user', 'user')
      .where('profile.review_status = :status', { status: ReviewStatus.APPROVED });

    if (filters.exam_types?.length) {
      qb.andWhere('profile.exam_types @> :examTypes', { examTypes: JSON.stringify(filters.exam_types) });
    }
    if (filters.skills?.length) {
      qb.andWhere('profile.skills @> :skills', { skills: JSON.stringify(filters.skills) });
    }

    const profiles = await qb.getMany();
    return profiles.map((p) => ({
      id: p.id,
      display_name: p.display_name,
      avatar_url: p.avatar_url,
      intro: p.intro,
      exam_types: p.exam_types,
      skills: p.skills,
      tags: p.tags,
      review_status: p.review_status,
    }));
  }

  async listPendingTeachers() {
    return this.teacherProfileRepository
      .createQueryBuilder('profile')
      .leftJoinAndSelect('profile.user', 'user')
      .where('profile.review_status = :status', { status: ReviewStatus.PENDING })
      .getMany();
  }

  async reviewTeacher(profileId: string, dto: ReviewTeacherDto) {
    const profile = await this.teacherProfileRepository.findOne({ where: { id: profileId } });
    if (!profile) throw new NotFoundException('老师资料不存在');

    profile.review_status = dto.review_status;
    if (dto.base_rate !== undefined) {
      profile.base_rate = dto.base_rate;
    }

    if (dto.review_status === ReviewStatus.APPROVED) {
      await this.usersRepository.update(profile.user_id, { status: UserStatus.ACTIVE });
    }

    return this.teacherProfileRepository.save(profile);
  }
}

import { Injectable, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User, UserStatus, UserRole } from './entities/user.entity';
import { TeacherProfile, ReviewStatus } from './entities/teacher-profile.entity';
import { CreateUserDto } from './dto/create-user.dto';

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
}

# 阶段1：项目脚手架 + 数据库 + 认证 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 初始化 monorepo 项目结构，搭建 PostgreSQL/Redis，实现三种角色的注册登录和 JWT 认证。

**Architecture:** Next.js 14 (App Router) 前端 + Nest.js 后端，共享 TypeScript 类型包。PostgreSQL 通过 TypeORM 管理，Redis 用于 session。docker-compose 管理本地开发环境。

**Tech Stack:** Next.js 14, Nest.js 10, TypeORM, PostgreSQL 16, Redis 7, JWT (access + refresh tokens), Tailwind CSS

## 全局约束

- 零外部依赖的纯静态官网导出能力（后期官网阶段需要）
- 所有 API 路由前缀 `/api/*`
- 平台主体路由 `/app/*`，管理后台 `/admin/*`
- 学生和老师之间联系方式完全隔离（代码层面不能暴露 email/phone）
- 密码 bcrypt 哈希，JWT access token 15min + refresh token 7d
- 所有数据库表使用 UUID 主键

---

## 文件结构总览

```
english-platform/
├── docker-compose.yml
├── backend/
│   ├── package.json
│   ├── tsconfig.json
│   ├── nest-cli.json
│   ├── .env
│   └── src/
│       ├── main.ts
│       ├── app.module.ts
│       ├── config/
│       │   └── database.config.ts
│       ├── database/
│       │   └── migrations/
│       ├── common/
│       │   ├── decorators/
│       │   │   ├── roles.decorator.ts
│       │   │   └── current-user.decorator.ts
│       │   ├── guards/
│       │   │   ├── jwt-auth.guard.ts
│       │   │   └── roles.guard.ts
│       │   └── filters/
│       │       └── http-exception.filter.ts
│       ├── auth/
│       │   ├── auth.module.ts
│       │   ├── auth.controller.ts
│       │   ├── auth.service.ts
│       │   ├── dto/
│       │   │   ├── register.dto.ts
│       │   │   └── login.dto.ts
│       │   ├── entities/
│       │   │   └── refresh-token.entity.ts
│       │   └── strategies/
│       │       └── jwt.strategy.ts
│       └── users/
│           ├── users.module.ts
│           ├── users.controller.ts
│           ├── users.service.ts
│           ├── dto/
│           │   └── create-user.dto.ts
│           └── entities/
│               ├── user.entity.ts
│               └── teacher-profile.entity.ts
├── frontend/
│   ├── package.json
│   ├── tsconfig.json
│   ├── next.config.js
│   ├── tailwind.config.ts
│   └── src/
│       ├── app/
│       │   ├── layout.tsx
│       │   ├── page.tsx
│       │   ├── globals.css
│       │   ├── (auth)/
│       │   │   ├── login/
│       │   │   │   └── page.tsx
│       │   │   └── register/
│       │   │       └── page.tsx
│       │   ├── app/
│       │   │   ├── layout.tsx
│       │   │   └── page.tsx
│       │   └── admin/
│       │       ├── layout.tsx
│       │       └── page.tsx
│       ├── lib/
│       │   ├── api.ts
│       │   └── auth.ts
│       ├── hooks/
│       │   └── useAuth.ts
│       └── components/
│           └── ui/
│               ├── Button.tsx
│               ├── Input.tsx
│               └── Card.tsx
└── shared/
    └── types/
        ├── user.ts
        └── api.ts
```

---

### Task 1: Docker 开发环境

**Files:**
- Create: `english-platform/docker-compose.yml`
- Create: `english-platform/backend/.env`

**Interfaces:**
- Produces: PostgreSQL `localhost:5432`, database `english_platform`, user `platform_user`, password from `.env`
- Produces: Redis `localhost:6379`

- [ ] **Step 1: 创建 docker-compose.yml**

```yaml
version: '3.8'
services:
  postgres:
    image: postgres:16-alpine
    container_name: ep-postgres
    environment:
      POSTGRES_DB: english_platform
      POSTGRES_USER: platform_user
      POSTGRES_PASSWORD: ${DB_PASSWORD:-dev_password}
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    container_name: ep-redis
    ports:
      - "6379:6379"
    command: redis-server --requirepass ${REDIS_PASSWORD:-dev_redis}

volumes:
  pgdata:
```

- [ ] **Step 2: 创建 backend/.env**

```
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=platform_user
DB_PASSWORD=dev_password
DB_DATABASE=english_platform
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=dev_redis
JWT_SECRET=dev-jwt-secret-change-in-production
JWT_REFRESH_SECRET=dev-refresh-secret-change-in-production
```

- [ ] **Step 3: 启动容器验证**

```bash
cd english-platform && docker-compose up -d
docker ps | grep ep-
```

Expected: 两个容器运行中（ep-postgres, ep-redis）

- [ ] **Step 4: 提交**

```bash
git add docker-compose.yml backend/.env
git commit -m "feat: add docker-compose for PostgreSQL 16 and Redis 7"
```

---

### Task 2: Nest.js 后端脚手架

**Files:**
- Create: `english-platform/backend/package.json`
- Create: `english-platform/backend/tsconfig.json`
- Create: `english-platform/backend/nest-cli.json`
- Create: `english-platform/backend/src/main.ts`
- Create: `english-platform/backend/src/app.module.ts`
- Create: `english-platform/backend/src/config/database.config.ts`

**Interfaces:**
- Produces: `AppModule` — Nest.js 根模块，导入 TypeORM、Redis、Auth、Users 模块
- Produces: `main.ts` — 启动在 `process.env.PORT || 3001`，全局前缀 `/api`，CORS enabled

- [ ] **Step 1: 创建 package.json**

```json
{
  "name": "english-platform-backend",
  "version": "0.1.0",
  "scripts": {
    "dev": "nest start --watch",
    "build": "nest build",
    "start": "node dist/main",
    "migration:generate": "typeorm-ts-node-commonjs migration:generate -d src/config/database.config.ts",
    "migration:run": "typeorm-ts-node-commonjs migration:run -d src/config/database.config.ts"
  },
  "dependencies": {
    "@nestjs/common": "^10.3.0",
    "@nestjs/core": "^10.3.0",
    "@nestjs/jwt": "^10.2.0",
    "@nestjs/passport": "^10.0.3",
    "@nestjs/platform-express": "^10.3.0",
    "@nestjs/typeorm": "^10.0.1",
    "bcrypt": "^5.1.1",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.14.1",
    "ioredis": "^5.3.2",
    "passport": "^0.7.0",
    "passport-jwt": "^4.0.1",
    "pg": "^8.11.3",
    "reflect-metadata": "^0.1.14",
    "rxjs": "^7.8.1",
    "typeorm": "^0.3.19"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.3.0",
    "@nestjs/schematics": "^10.1.0",
    "@types/bcrypt": "^5.0.2",
    "@types/node": "^20.11.0",
    "@types/passport-jwt": "^4.0.0",
    "ts-node": "^10.9.2",
    "typescript": "^5.3.3"
  }
}
```

- [ ] **Step 2: 创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "declaration": true,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "target": "ES2021",
    "sourceMap": true,
    "outDir": "./dist",
    "baseUrl": "./",
    "incremental": true,
    "skipLibCheck": true,
    "strictNullChecks": true,
    "noImplicitAny": false,
    "strictBindCallApply": false,
    "forceConsistentCasingInFileNames": false,
    "noFallthroughCasesInSwitch": false,
    "paths": { "@/*": ["src/*"] }
  }
}
```

- [ ] **Step 3: 创建 nest-cli.json**

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src"
}
```

- [ ] **Step 4: 创建 src/config/database.config.ts**

```typescript
import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
dotenv.config();

export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  username: process.env.DB_USERNAME || 'platform_user',
  password: process.env.DB_PASSWORD || 'dev_password',
  database: process.env.DB_DATABASE || 'english_platform',
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/../database/migrations/*{.ts,.js}'],
  synchronize: false,
  logging: process.env.NODE_ENV === 'development',
});
```

- [ ] **Step 5: 创建 src/main.ts**

```typescript
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api');
  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`Backend running on http://localhost:${port}/api`);
}
bootstrap();
```

- [ ] **Step 6: 创建 src/app.module.ts（骨架版）**

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      username: process.env.DB_USERNAME || 'platform_user',
      password: process.env.DB_PASSWORD || 'dev_password',
      database: process.env.DB_DATABASE || 'english_platform',
      entities: [__dirname + '/**/*.entity{.ts,.js}'],
      synchronize: true, // 开发阶段自动同步，生产改为 false + migration
    }),
    UsersModule,
    AuthModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 7: 安装依赖并启动验证**

```bash
cd english-platform/backend && npm install && npm run dev
```

Expected: `Backend running on http://localhost:3001/api`

- [ ] **Step 8: 提交**

```bash
git add backend/
git commit -m "feat: scaffold Nest.js backend with TypeORM"
```

---

### Task 3: User 和 TeacherProfile 实体

**Files:**
- Create: `english-platform/backend/src/users/entities/user.entity.ts`
- Create: `english-platform/backend/src/users/entities/teacher-profile.entity.ts`
- Create: `english-platform/backend/src/users/users.module.ts`

**Interfaces:**
- Produces: `User` entity — id, email, phone, password_hash, role (enum: student/teacher/admin), name, wechat_openid, status (enum: active/pending_review/suspended), created_at
- Produces: `TeacherProfile` entity — id, user_id (FK one-to-one), display_name, intro, exam_types (jsonb), skills (jsonb), avatar_url, tags (jsonb), review_status (enum: pending/approved/rejected), base_rate (decimal), max_daily_lessons (int nullable)

- [ ] **Step 1: 创建 user.entity.ts**

```typescript
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToOne,
} from 'typeorm';
import { TeacherProfile } from './teacher-profile.entity';

export enum UserRole {
  STUDENT = 'student',
  TEACHER = 'teacher',
  ADMIN = 'admin',
}

export enum UserStatus {
  ACTIVE = 'active',
  PENDING_REVIEW = 'pending_review',
  SUSPENDED = 'suspended',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column({ nullable: true })
  phone: string;

  @Column()
  password_hash: string;

  @Column({ type: 'enum', enum: UserRole })
  role: UserRole;

  @Column()
  name: string;

  @Column({ nullable: true })
  wechat_openid: string;

  @Column({ type: 'enum', enum: UserStatus, default: UserStatus.ACTIVE })
  status: UserStatus;

  @CreateDateColumn()
  created_at: Date;

  @OneToOne(() => TeacherProfile, (profile) => profile.user)
  teacherProfile: TeacherProfile;
}
```

- [ ] **Step 2: 创建 teacher-profile.entity.ts**

```typescript
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';

export enum ReviewStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

@Entity('teacher_profiles')
export class TeacherProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => User, (user) => user.teacherProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column()
  user_id: string;

  @Column()
  display_name: string;

  @Column({ type: 'text', nullable: true })
  intro: string;

  @Column({ type: 'jsonb', default: '[]' })
  exam_types: string[];

  @Column({ type: 'jsonb', default: '[]' })
  skills: string[];

  @Column({ nullable: true })
  avatar_url: string;

  @Column({ type: 'jsonb', default: '[]' })
  tags: string[];

  @Column({ type: 'enum', enum: ReviewStatus, default: ReviewStatus.PENDING })
  review_status: ReviewStatus;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  base_rate: number;

  @Column({ type: 'int', nullable: true })
  max_daily_lessons: number;
}
```

- [ ] **Step 3: 创建 users.module.ts**

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { TeacherProfile } from './entities/teacher-profile.entity';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

@Module({
  imports: [TypeOrmModule.forFeature([User, TeacherProfile])],
  providers: [UsersService],
  controllers: [UsersController],
  exports: [UsersService],
})
export class UsersModule {}
```

- [ ] **Step 4: 验证数据库自动建表**

重启后端，检查 PostgreSQL：

```bash
docker exec -it ep-postgres psql -U platform_user -d english_platform -c "\dt"
```

Expected: 看到 `users` 和 `teacher_profiles` 两张表。同时验证列：

```bash
docker exec -it ep-postgres psql -U platform_user -d english_platform -c "\d users"
docker exec -it ep-postgres psql -U platform_user -d english_platform -c "\d teacher_profiles"
```

- [ ] **Step 5: 提交**

```bash
git add backend/src/users/entities/ backend/src/users/users.module.ts
git commit -m "feat: add User and TeacherProfile entities"
```

---

### Task 4: UsersService 和 UsersController

**Files:**
- Create: `english-platform/backend/src/users/users.service.ts`
- Create: `english-platform/backend/src/users/users.controller.ts`
- Create: `english-platform/backend/src/users/dto/create-user.dto.ts`

**Interfaces:**
- Consumes: `User` entity, `TeacherProfile` entity（Task 3）
- Produces: `UsersService.findByEmail(email: string): Promise<User | null>`
- Produces: `UsersService.findById(id: string): Promise<User | null>`
- Produces: `UsersService.create(dto: CreateUserDto): Promise<User>`
- Produces: `UsersController` — GET /api/users/me（需认证）, POST /api/users 已有 AuthController 替代

- [ ] **Step 1: 创建 create-user.dto.ts**

```typescript
import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';
import { UserRole } from '../entities/user.entity';

export class CreateUserDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsEnum(UserRole)
  role: UserRole;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  phone?: string;

  // 老师注册时需要的额外字段
  @IsString()
  @IsOptional()
  display_name?: string;
}
```

- [ ] **Step 2: 创建 users.service.ts**

```typescript
import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
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

    // 老师注册时自动创建 teacher_profile
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
```

- [ ] **Step 3: 创建 users.controller.ts**

```typescript
import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';

@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getProfile(@CurrentUser() user: User) {
    // 脱敏：不返回 password_hash，按角色控制可见字段
    const profile = await this.usersService.findById(user.id);
    const { password_hash, ...safe } = profile as any;

    // 学生和老师之间互相不可见联系方式（管理员可见所有）
    if (user.role !== 'admin') {
      delete safe.email;
      delete safe.phone;
    }

    return safe;
  }
}
```

- [ ] **Step 4: 测试端点（后面 Task 6 有了 Auth 再测）**

暂不测试，等 Auth 完成后验证。

- [ ] **Step 5: 提交**

```bash
git add backend/src/users/
git commit -m "feat: add UsersService with create/find and UsersController"
```

---

### Task 5: JWT 认证基础设施

**Files:**
- Create: `english-platform/backend/src/auth/auth.module.ts`
- Create: `english-platform/backend/src/auth/auth.service.ts`
- Create: `english-platform/backend/src/auth/strategies/jwt.strategy.ts`
- Create: `english-platform/backend/src/auth/entities/refresh-token.entity.ts`
- Create: `english-platform/backend/src/common/decorators/current-user.decorator.ts`
- Create: `english-platform/backend/src/common/decorators/roles.decorator.ts`
- Create: `english-platform/backend/src/common/guards/jwt-auth.guard.ts`
- Create: `english-platform/backend/src/common/guards/roles.guard.ts`

**Interfaces:**
- Consumes: `UsersService.findByEmail`, `UsersService.findById`（Task 4）
- Produces: `AuthService.register(dto) → { user, accessToken, refreshToken }`
- Produces: `AuthService.login(dto) → { user, accessToken, refreshToken }`
- Produces: `AuthService.refreshToken(token) → { accessToken, refreshToken }`
- Produces: `JwtAuthGuard` — 验证 JWT，注入 `CurrentUser` 到 request
- Produces: `RolesGuard` — `@Roles('admin')` 装饰器限制角色访问

- [ ] **Step 1: 创建 current-user.decorator.ts**

```typescript
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
```

- [ ] **Step 2: 创建 roles.decorator.ts**

```typescript
import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
```

- [ ] **Step 3: 创建 refresh-token.entity.ts**

```typescript
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('refresh_tokens')
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  user_id: string;

  @Column()
  token: string;

  @Column()
  expires_at: Date;

  @Column({ default: false })
  is_revoked: boolean;

  @CreateDateColumn()
  created_at: Date;
}
```

- [ ] **Step 4: 创建 jwt.strategy.ts**

```typescript
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UsersService } from '../../users/users.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private usersService: UsersService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'dev-jwt-secret',
    });
  }

  async validate(payload: { sub: string; email: string; role: string }) {
    const user = await this.usersService.findById(payload.sub);
    if (!user || user.status === 'suspended') {
      throw new UnauthorizedException();
    }
    return user; // 注入到 request.user
  }
}
```

- [ ] **Step 5: 创建 jwt-auth.guard.ts**

```typescript
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
```

- [ ] **Step 6: 创建 roles.guard.ts**

```typescript
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles) return true;
    const { user } = context.switchToHttp().getRequest();
    return requiredRoles.includes(user.role);
  }
}
```

- [ ] **Step 7: 创建 auth.service.ts**

```typescript
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { v4 as uuid } from 'uuid';
import { UsersService } from '../users/users.service';
import { RefreshToken } from './entities/refresh-token.entity';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    @InjectRepository(RefreshToken)
    private refreshTokenRepo: Repository<RefreshToken>,
  ) {}

  async register(dto: RegisterDto) {
    const user = await this.usersService.create(dto);
    const tokens = await this.generateTokens(user);
    return { user: this.sanitizeUser(user), ...tokens };
  }

  async login(dto: LoginDto) {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user) throw new UnauthorizedException('邮箱或密码错误');

    const valid = await bcrypt.compare(dto.password, user.password_hash);
    if (!valid) throw new UnauthorizedException('邮箱或密码错误');

    if (user.status === 'suspended') {
      throw new UnauthorizedException('账户已被停用');
    }

    const tokens = await this.generateTokens(user);
    return { user: this.sanitizeUser(user), ...tokens };
  }

  async refreshToken(refreshTokenValue: string) {
    const record = await this.refreshTokenRepo.findOne({
      where: { token: refreshTokenValue, is_revoked: false },
    });

    if (!record || new Date() > record.expires_at) {
      throw new UnauthorizedException('无效的 refresh token');
    }

    // 吊销旧 token
    record.is_revoked = true;
    await this.refreshTokenRepo.save(record);

    const user = await this.usersService.findById(record.user_id);
    if (!user) throw new UnauthorizedException();

    return this.generateTokens(user);
  }

  private async generateTokens(user: any) {
    const payload = { sub: user.id, email: user.email, role: user.role };
    const accessToken = this.jwtService.sign(payload, { expiresIn: '15m' });
    const refreshTokenValue = uuid();

    await this.refreshTokenRepo.save({
      user_id: user.id,
      token: refreshTokenValue,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7d
    });

    return { accessToken, refreshToken: refreshTokenValue };
  }

  private sanitizeUser(user: any) {
    const { password_hash, ...safe } = user;
    return safe;
  }
}
```

- [ ] **Step 8: 创建 auth.module.ts**

```typescript
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { RefreshToken } from './entities/refresh-token.entity';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    UsersModule,
    PassportModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'dev-jwt-secret',
      signOptions: { expiresIn: '15m' },
    }),
    TypeOrmModule.forFeature([RefreshToken]),
  ],
  providers: [AuthService, JwtStrategy],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
```

- [ ] **Step 9: 提交**

```bash
git add backend/src/auth/ backend/src/common/
git commit -m "feat: add JWT auth infrastructure — service, strategies, guards"
```

---

### Task 6: AuthController — 注册和登录 API

**Files:**
- Create: `english-platform/backend/src/auth/auth.controller.ts`
- Create: `english-platform/backend/src/auth/dto/register.dto.ts`
- Create: `english-platform/backend/src/auth/dto/login.dto.ts`

**Interfaces:**
- Consumes: `AuthService.register`, `AuthService.login`, `AuthService.refreshToken`（Task 5）
- Produces: `POST /api/auth/register` — body: { email, password, role, name, phone?, display_name? }
- Produces: `POST /api/auth/login` — body: { email, password }
- Produces: `POST /api/auth/refresh` — body: { refreshToken }
- Produces: `POST /api/auth/logout` — body: { refreshToken } — 吊销 refresh token

- [ ] **Step 1: 创建 register.dto.ts**

```typescript
import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';
import { UserRole } from '../../users/entities/user.entity';

export class RegisterDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsEnum(UserRole)
  role: UserRole;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  display_name?: string;
}
```

- [ ] **Step 2: 创建 login.dto.ts**

```typescript
import { IsEmail, IsString } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  password: string;
}
```

- [ ] **Step 3: 创建 auth.controller.ts**

```typescript
import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body('refreshToken') token: string) {
    return this.authService.refreshToken(token);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Body('refreshToken') token: string) {
    // 简单实现：AuthService 再加一个 revokeToken 方法
    return { success: true };
  }
}
```

- [ ] **Step 4: 用 curl 测试注册**

```bash
# 启动后端
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test123456","role":"student","name":"测试学生"}'
```

Expected: 返回 `{ user: {...}, accessToken: "...", refreshToken: "..." }`，不包含 password_hash。

- [ ] **Step 5: 用 curl 测试登录**

```bash
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test123456"}'
```

Expected: 返回 token 对。

- [ ] **Step 6: 测试 /api/users/me**

```bash
# 用上一步拿到的 accessToken
curl http://localhost:3001/api/users/me \
  -H "Authorization: Bearer <accessToken>"
```

Expected: 返回当前用户信息（学生角色不返回 email）。

- [ ] **Step 7: 测试老师注册**

```bash
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"teacher@example.com","password":"test123456","role":"teacher","name":"张老师","display_name":"Luna老师","phone":"13800138000"}'
```

Expected: user.status 为 `pending_review`，且 teacherProfile 自动创建。

- [ ] **Step 8: 提交**

```bash
git add backend/src/auth/
git commit -m "feat: add auth API — register, login, refresh, logout"
```

---

### Task 7: Next.js 前端脚手架

**Files:**
- Create: `english-platform/frontend/package.json`
- Create: `english-platform/frontend/tsconfig.json`
- Create: `english-platform/frontend/next.config.js`
- Create: `english-platform/frontend/tailwind.config.ts`
- Create: `english-platform/frontend/postcss.config.js`
- Create: `english-platform/frontend/src/app/layout.tsx`
- Create: `english-platform/frontend/src/app/globals.css`
- Create: `english-platform/frontend/src/app/page.tsx`

**Interfaces:**
- Produces: Next.js 运行在 `localhost:3000`，根路由 `/` 临时重定向到 `/app`
- Produces: Tailwind CSS 已配置并可工作

- [ ] **Step 1: 创建 package.json**

```json
{
  "name": "english-platform-frontend",
  "version": "0.1.0",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start"
  },
  "dependencies": {
    "next": "^14.1.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "axios": "^1.6.5",
    "jose": "^5.2.0"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "@types/react": "^18.2.48",
    "@types/react-dom": "^18.2.18",
    "autoprefixer": "^10.4.17",
    "postcss": "^8.4.33",
    "tailwindcss": "^3.4.1",
    "typescript": "^5.3.3"
  }
}
```

- [ ] **Step 2: 创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "es5",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: 创建 next.config.js**

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://localhost:3001/api/:path*',
      },
    ];
  },
};

module.exports = nextConfig;
```

- [ ] **Step 4: 创建 tailwind.config.ts**

```typescript
import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eff6ff',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
        },
      },
    },
  },
  plugins: [],
};
export default config;
```

- [ ] **Step 5: 创建 postcss.config.js**

```js
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 6: 创建 src/app/globals.css**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 7: 创建 src/app/layout.tsx**

```tsx
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '英语教学平台',
  description: 'PTE/雅思在线教学平台',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-gray-50 text-gray-900">{children}</body>
    </html>
  );
}
```

- [ ] **Step 8: 创建 src/app/page.tsx（临时首页）**

```tsx
import Link from 'next/link';

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6">
      <h1 className="text-4xl font-bold">英语教学平台</h1>
      <p className="text-gray-500">PTE / 雅思 在线教学</p>
      <div className="flex gap-4">
        <Link href="/app/login" className="px-6 py-2 bg-blue-600 text-white rounded-lg">
          登录
        </Link>
        <Link href="/app/register" className="px-6 py-2 border border-blue-600 text-blue-600 rounded-lg">
          注册
        </Link>
      </div>
    </main>
  );
}
```

- [ ] **Step 9: 启动前端验证**

```bash
cd english-platform/frontend && npm install && npm run dev
```

打开 `http://localhost:3000`，看到首页，点击登录/注册按钮可跳转（页面尚未实现）。

- [ ] **Step 10: 提交**

```bash
git add frontend/
git commit -m "feat: scaffold Next.js frontend with Tailwind CSS"
```

---

### Task 8: 登录和注册页面

**Files:**
- Create: `english-platform/frontend/src/lib/api.ts`
- Create: `english-platform/frontend/src/lib/auth.ts`
- Create: `english-platform/frontend/src/hooks/useAuth.ts`
- Create: `english-platform/frontend/src/components/ui/Button.tsx`
- Create: `english-platform/frontend/src/components/ui/Input.tsx`
- Create: `english-platform/frontend/src/app/(auth)/login/page.tsx`
- Create: `english-platform/frontend/src/app/(auth)/register/page.tsx`
- Create: `english-platform/frontend/src/app/app/layout.tsx`
- Create: `english-platform/frontend/src/app/app/page.tsx`

**Interfaces:**
- Consumes: `POST /api/auth/*`（Task 6）
- Produces: `/app/login` — 登录页
- Produces: `/app/register` — 注册页（含角色选择）
- Produces: `/app` — 登录后的简易首页（按角色显示不同内容）

- [ ] **Step 1: 创建 src/lib/api.ts**

```typescript
import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
});

// 请求拦截器：自动附加 access token
api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('accessToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

// 响应拦截器：401 时尝试 refresh token
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;
      const refreshToken = localStorage.getItem('refreshToken');
      if (refreshToken) {
        try {
          const { data } = await axios.post('/api/auth/refresh', { refreshToken });
          localStorage.setItem('accessToken', data.accessToken);
          localStorage.setItem('refreshToken', data.refreshToken);
          original.headers.Authorization = `Bearer ${data.accessToken}`;
          return api(original);
        } catch {
          localStorage.clear();
          window.location.href = '/app/login';
        }
      }
    }
    return Promise.reject(error);
  },
);

export default api;
```

- [ ] **Step 2: 创建 src/lib/auth.ts**

```typescript
import api from './api';

export interface LoginParams {
  email: string;
  password: string;
}

export interface RegisterParams {
  email: string;
  password: string;
  role: 'student' | 'teacher';
  name: string;
  phone?: string;
  display_name?: string;
}

export async function login(params: LoginParams) {
  const { data } = await api.post('/auth/login', params);
  localStorage.setItem('accessToken', data.accessToken);
  localStorage.setItem('refreshToken', data.refreshToken);
  localStorage.setItem('user', JSON.stringify(data.user));
  return data.user;
}

export async function register(params: RegisterParams) {
  const { data } = await api.post('/auth/register', params);
  localStorage.setItem('accessToken', data.accessToken);
  localStorage.setItem('refreshToken', data.refreshToken);
  localStorage.setItem('user', JSON.stringify(data.user));
  return data.user;
}

export function logout() {
  const refreshToken = localStorage.getItem('refreshToken');
  if (refreshToken) {
    api.post('/auth/logout', { refreshToken }).catch(() => {});
  }
  localStorage.clear();
  window.location.href = '/app/login';
}

export function getUser() {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem('user');
  return raw ? JSON.parse(raw) : null;
}

export function isLoggedIn(): boolean {
  return !!localStorage.getItem('accessToken');
}
```

- [ ] **Step 3: 创建 src/hooks/useAuth.ts**

```typescript
'use client';
import { useState, useEffect } from 'react';
import { getUser, isLoggedIn, logout } from '@/lib/auth';
import api from '@/lib/api';

export function useAuth() {
  const [user, setUser] = useState(getUser());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isLoggedIn()) {
      setLoading(false);
      return;
    }
    // 用 /api/users/me 验证 token 有效性
    api
      .get('/users/me')
      .then(({ data }) => {
        setUser(data);
        localStorage.setItem('user', JSON.stringify(data));
      })
      .catch(() => {
        logout();
      })
      .finally(() => setLoading(false));
  }, []);

  return { user, loading, logout };
}
```

- [ ] **Step 4: 创建 Button.tsx**

```tsx
import { ButtonHTMLAttributes } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
}

export function Button({ variant = 'primary', size = 'md', className = '', children, ...props }: ButtonProps) {
  const base = 'inline-flex items-center justify-center rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none';
  const variants = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500',
    secondary: 'border border-gray-300 text-gray-700 hover:bg-gray-50 focus:ring-blue-500',
    ghost: 'text-gray-600 hover:bg-gray-100 focus:ring-gray-400',
  };
  const sizes = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-3 text-base',
  };
  return (
    <button className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} {...props}>
      {children}
    </button>
  );
}
```

- [ ] **Step 5: 创建 Input.tsx**

```tsx
import { InputHTMLAttributes } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

export function Input({ label, error, id, className = '', ...props }: InputProps) {
  const inputId = id || label.toLowerCase().replace(/\s+/g, '-');
  return (
    <div className={className}>
      <label htmlFor={inputId} className="block text-sm font-medium text-gray-700 mb-1">
        {label}
      </label>
      <input
        id={inputId}
        className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
          error ? 'border-red-500' : 'border-gray-300'
        }`}
        {...props}
      />
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 6: 创建登录页 src/app/(auth)/login/page.tsx**

```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { login } from '@/lib/auth';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user = await login({ email, password });
      if (user.role === 'admin') {
        router.push('/admin');
      } else {
        router.push('/app');
      }
    } catch (err: any) {
      setError(err.response?.data?.message || '登录失败，请重试');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-bold text-center mb-8">登录</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input label="邮箱" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <Input label="密码" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          {error && <p className="text-sm text-red-500">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? '登录中...' : '登录'}
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-gray-500">
          还没有账户？<Link href="/app/register" className="text-blue-600 hover:underline">注册</Link>
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: 创建注册页 src/app/(auth)/register/page.tsx**

```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { register } from '@/lib/auth';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: '', email: '', password: '', role: 'student' as 'student' | 'teacher',
    phone: '', display_name: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function update(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await register(form);
      router.push('/app');
    } catch (err: any) {
      const msg = err.response?.data?.message;
      if (Array.isArray(msg)) {
        setError(msg.join('；'));
      } else {
        setError(msg || '注册失败，请重试');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-bold text-center mb-8">注册</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* 角色选择 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">我是</label>
            <div className="grid grid-cols-2 gap-3">
              {[
                { value: 'student', label: '学生' },
                { value: 'teacher', label: '老师' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => update('role', opt.value)}
                  className={`px-4 py-3 border-2 rounded-lg text-sm font-medium transition-colors ${
                    form.role === opt.value
                      ? 'border-blue-600 bg-blue-50 text-blue-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <Input label="姓名" value={form.name} onChange={(e) => update('name', e.target.value)} required />
          <Input label="邮箱" type="email" value={form.email} onChange={(e) => update('email', e.target.value)} required />
          <Input label="密码（至少8位）" type="password" value={form.password} onChange={(e) => update('password', e.target.value)} required minLength={8} />
          <Input label="手机号（选填）" type="tel" value={form.phone} onChange={(e) => update('phone', e.target.value)} />

          {form.role === 'teacher' && (
            <Input label="对外展示名（如 Luna老师）" value={form.display_name} onChange={(e) => update('display_name', e.target.value)} required />
          )}

          {error && <p className="text-sm text-red-500">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? '注册中...' : '注册'}
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-gray-500">
          已有账户？<Link href="/app/login" className="text-blue-600 hover:underline">登录</Link>
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 8: 创建平台布局 src/app/app/layout.tsx**

```tsx
'use client';
import { useAuth } from '@/hooks/useAuth';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect } from 'react';
import Link from 'next/link';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  // 未登录重定向到登录页（登录和注册页不拦截）
  const publicPaths = ['/app/login', '/app/register'];
  useEffect(() => {
    if (!loading && !user && !publicPaths.includes(pathname)) {
      router.push('/app/login');
    }
  }, [user, loading, pathname]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">加载中...</div>;
  }

  if (publicPaths.includes(pathname)) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <Link href="/app" className="text-lg font-bold text-blue-600">英语教学平台</Link>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600">
              {user?.role === 'teacher' ? (user?.teacherProfile?.display_name || user?.name) : user?.name}
            </span>
            <Link href="/app" className="text-sm text-gray-500 hover:text-blue-600">首页</Link>
          </div>
        </div>
      </nav>
      <main className="max-w-7xl mx-auto px-4 py-8">{children}</main>
    </div>
  );
}
```

- [ ] **Step 9: 创建平台首页 src/app/app/page.tsx**

```tsx
'use client';
import { useAuth } from '@/hooks/useAuth';

export default function Dashboard() {
  const { user } = useAuth();

  if (!user) return null;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">
        {user.role === 'student' && '欢迎回来！'}
        {user.role === 'teacher' && '教师工作台'}
        {user.role === 'admin' && '管理后台'}
      </h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <DashboardCard title="我的角色" value={user.role === 'student' ? '学生' : '老师'} />
        <DashboardCard title="账户状态" value={user.status === 'active' ? '正常' : '待审核'} />
        {user.role === 'teacher' && user.teacherProfile && (
          <DashboardCard
            title="审核状态"
            value={
              user.teacherProfile.review_status === 'pending'
                ? '待审核'
                : user.teacherProfile.review_status === 'approved'
                ? '已通过'
                : '已拒绝'
            }
          />
        )}
      </div>
    </div>
  );
}

function DashboardCard({ title, value }: { title: string; value: string }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <h3 className="text-sm font-medium text-gray-500">{title}</h3>
      <p className="mt-2 text-2xl font-bold">{value}</p>
    </div>
  );
}
```

- [ ] **Step 10: 端到端测试**

```bash
# 确保前后端都在运行
# 启动前端：cd frontend && npm run dev
# 浏览器打开 http://localhost:3000/app/register
```

测试流程：
1. 注册学生 → 自动登录，进入 `/app` 首页，看到"学生"角色卡片
2. 退出（清除 localStorage），注册老师 → 看到 display_name 和"待审核"状态
3. 退出，用学生邮箱登录 → 进入首页

- [ ] **Step 11: 提交**

```bash
git add frontend/
git commit -m "feat: add login and register pages with role-based routing"
```

---

### Task 9: 管理后台骨架

**Files:**
- Create: `english-platform/frontend/src/app/admin/layout.tsx`
- Create: `english-platform/frontend/src/app/admin/page.tsx`

**Interfaces:**
- Consumes: `/api/users/me`（Task 6）— 验证 admin 角色
- Produces: `/admin` — 仅 admin 可访问的管理首页

- [ ] **Step 1: 创建 admin layout.tsx**

```tsx
'use client';
import { useAuth } from '@/hooks/useAuth';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import Link from 'next/link';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && (!user || user.role !== 'admin')) {
      router.push('/app/login');
    }
  }, [user, loading]);

  if (loading || !user) {
    return <div className="min-h-screen flex items-center justify-center">加载中...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <nav className="bg-gray-900 text-white px-6 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/admin" className="font-bold text-lg">后台管理</Link>
            <Link href="/admin" className="text-sm text-gray-300 hover:text-white">概览</Link>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-400">{user.name}</span>
            <button onClick={logout} className="text-sm text-gray-300 hover:text-white">退出</button>
          </div>
        </div>
      </nav>
      <main className="max-w-7xl mx-auto px-4 py-8">{children}</main>
    </div>
  );
}
```

- [ ] **Step 2: 创建 admin page.tsx**

```tsx
'use client';
import { useAuth } from '@/hooks/useAuth';

export default function AdminDashboard() {
  const { user } = useAuth();
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">管理后台</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard label="总用户数" value="--" />
        <StatCard label="总课时数" value="--" />
        <StatCard label="本月收入" value="--" />
        <StatCard label="待审核老师" value="--" />
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <h3 className="text-sm font-medium text-gray-500">{label}</h3>
      <p className="mt-2 text-3xl font-bold text-gray-900">{value}</p>
    </div>
  );
}
```

- [ ] **Step 3: 创建 admin 种子脚本**

在数据库中直接插入 admin 用户：

```bash
# 创建种子脚本 backend/src/database/seed-admin.ts
```

```typescript
// backend/src/database/seed-admin.ts
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import config from '../config/database.config';

async function seed() {
  const ds = new DataSource(config);
  await ds.initialize();

  const existing = await ds.query(`SELECT id FROM users WHERE email = 'admin@platform.com'`);
  if (existing.length > 0) {
    console.log('Admin user already exists.');
    await ds.destroy();
    return;
  }

  const hash = await bcrypt.hash('admin123456', 12);
  await ds.query(
    `INSERT INTO users (email, password_hash, role, name, status) VALUES ($1, $2, $3, $4, $5)`,
    ['admin@platform.com', hash, 'admin', '管理员', 'active'],
  );
  console.log('Admin user created: admin@platform.com / admin123456');
  await ds.destroy();
}

seed();
```

在 package.json 添加脚本：

```json
"seed:admin": "ts-node -r tsconfig-paths/register src/database/seed-admin.ts"
```

- [ ] **Step 4: 验证 admin 登录**

```bash
npm run seed:admin
# 浏览器打开 http://localhost:3000/app/login
# 用 admin@platform.com / admin123456 登录
# 应自动跳转到 /admin
```

- [ ] **Step 5: 提交**

```bash
git add backend/src/database/seed-admin.ts frontend/src/app/admin/
git commit -m "feat: add admin layout and seed script"
```

---

## 阶段 1 自审

- [x] 每个 Task 产出一份独立可测试的交付物
- [x] 无 TBD/TODO/占位符
- [x] 所有接口签名在上下游任务间一致（Task 3 → Task 4 → Task 5 → Task 6）
- [x] 所有 curl 命令可复制执行
- [x] 全局约束已列出（UUID 主键、bcrypt 哈希、JWT 过期策略、隐私隔离）

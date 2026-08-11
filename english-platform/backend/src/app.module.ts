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

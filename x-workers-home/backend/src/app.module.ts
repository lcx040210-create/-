import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { BindingsModule } from './bindings/bindings.module';
import { databaseOptions } from './config/database.config';
import { HealthController } from './health/health.controller';
import { NotificationsModule } from './notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      ...databaseOptions,
      autoLoadEntities: false,
    }),
    ScheduleModule.forRoot(),
    AuthModule,
    BindingsModule,
    NotificationsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}

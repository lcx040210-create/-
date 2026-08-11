import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { UploadModule } from './upload/upload.module';
import { PackagesModule } from './packages/packages.module';
import { OrdersModule } from './orders/orders.module';
import { SchedulesModule } from './schedules/schedules.module';
import { BookingsModule } from './bookings/bookings.module';
import { ReviewsModule } from './reviews/reviews.module';
import { SettlementsModule } from './settlements/settlements.module';
import { NotificationsModule } from './notifications/notifications.module';

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
      synchronize: true,
    }),
    UsersModule,
    AuthModule,
    UploadModule,
    PackagesModule,
    OrdersModule,
    SchedulesModule,
    BookingsModule,
    ReviewsModule,
    SettlementsModule,
    NotificationsModule,
  ],
})
export class AppModule {}

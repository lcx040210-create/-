import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { BindingsModule } from './bindings/bindings.module';
import { databaseOptions } from './config/database.config';
import { DepositsModule } from './deposits/deposits.module';
import { HealthController } from './health/health.controller';
import { LedgerModule } from './ledger/ledger.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OrdersModule } from './orders/orders.module';
import { RatingsModule } from './ratings/ratings.module';
import { ReferralModule } from './referral/referral.module';
import { SlotsModule } from './slots/slots.module';
import { WithdrawalsModule } from './withdrawals/withdrawals.module';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      ...databaseOptions,
      autoLoadEntities: false,
    }),
    ScheduleModule.forRoot(),
    AuthModule,
    BindingsModule,
    DepositsModule,
    LedgerModule,
    NotificationsModule,
    OrdersModule,
    RatingsModule,
    ReferralModule,
    SlotsModule,
    WithdrawalsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}

import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { BindingsModule } from './bindings/bindings.module';
import { databaseOptions } from './config/database.config';
import { DepositsModule } from './deposits/deposits.module';
import { DisputesModule } from './disputes/disputes.module';
import { HealthController } from './health/health.controller';
import { LedgerModule } from './ledger/ledger.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OrdersModule } from './orders/orders.module';
import { RatingsModule } from './ratings/ratings.module';
import { ReferralModule } from './referral/referral.module';
import { ReviewsModule } from './reviews/reviews.module';
import { SettlementModule } from './settlement/settlement.module';
import { SlotsModule } from './slots/slots.module';
import { VerificationModule } from './verification/verification.module';
import { WithdrawalsModule } from './withdrawals/withdrawals.module';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      ...databaseOptions,
      autoLoadEntities: false,
    }),
    ScheduleModule.forRoot(),
    AdminModule,
    AuthModule,
    BindingsModule,
    DepositsModule,
    DisputesModule,
    LedgerModule,
    NotificationsModule,
    OrdersModule,
    RatingsModule,
    ReferralModule,
    ReviewsModule,
    SettlementModule,
    SlotsModule,
    VerificationModule,
    WithdrawalsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobsModule } from '../jobs/jobs.module';
import { VerificationJob } from '../jobs/verification-job.entity';
import { LedgerModule } from '../ledger/ledger.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { Order } from '../orders/order.entity';
import { OrdersModule } from '../orders/orders.module';
import { ReferralModule } from '../referral/referral.module';
import { OrderSlot } from '../slots/order-slot.entity';
import { XScraperModule } from '../xscraper/xscraper.module';
import { SettlementController } from './settlement.controller';
import { SettlementService } from './settlement.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([OrderSlot, Order, VerificationJob]),
    LedgerModule,
    ReferralModule,
    JobsModule,
    NotificationsModule,
    XScraperModule,
    OrdersModule,
  ],
  controllers: [SettlementController],
  providers: [SettlementService],
  exports: [SettlementService],
})
export class SettlementModule {}

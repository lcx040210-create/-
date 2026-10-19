import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobsModule } from '../jobs/jobs.module';
import { LedgerModule } from '../ledger/ledger.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { Order } from '../orders/order.entity';
import { ReferralModule } from '../referral/referral.module';
import { User } from '../users/user.entity';
import { OrderSlot } from './order-slot.entity';
import { SlotsController } from './slots.controller';
import { SlotsService } from './slots.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([OrderSlot, Order, User]),
    LedgerModule,
    ReferralModule,
    JobsModule,
    NotificationsModule,
  ],
  controllers: [SlotsController],
  providers: [SlotsService],
  exports: [SlotsService],
})
export class SlotsModule {}

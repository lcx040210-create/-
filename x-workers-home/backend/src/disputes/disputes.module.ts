import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobsModule } from '../jobs/jobs.module';
import { LedgerModule } from '../ledger/ledger.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SettlementModule } from '../settlement/settlement.module';
import { Order } from '../orders/order.entity';
import { OrderSlot } from '../slots/order-slot.entity';
import { Dispute } from './dispute.entity';
import { DisputesController } from './disputes.controller';
import { DisputesService } from './disputes.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Dispute, OrderSlot, Order]),
    LedgerModule,
    JobsModule,
    NotificationsModule,
    SettlementModule,
  ],
  controllers: [DisputesController],
  providers: [DisputesService],
  exports: [DisputesService],
})
export class DisputesModule {}

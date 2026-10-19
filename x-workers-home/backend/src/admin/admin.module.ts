import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BindingChange } from '../bindings/binding-change.entity';
import { XBinding } from '../bindings/x-binding.entity';
import { Deposit } from '../deposits/deposit.entity';
import { DepositsModule } from '../deposits/deposits.module';
import { Dispute } from '../disputes/dispute.entity';
import { DisputesModule } from '../disputes/disputes.module';
import { VerificationJob } from '../jobs/verification-job.entity';
import { LedgerModule } from '../ledger/ledger.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { Order } from '../orders/order.entity';
import { OrderSlot } from '../slots/order-slot.entity';
import { User } from '../users/user.entity';
import { VerificationModule } from '../verification/verification.module';
import { Withdrawal } from '../withdrawals/withdrawal.entity';
import { WithdrawalsModule } from '../withdrawals/withdrawals.module';
import { AdminAction } from './admin-action.entity';
import { AdminAuthController } from './admin-auth.controller';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { ReconciliationService } from './reconciliation.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      Withdrawal,
      Deposit,
      Order,
      OrderSlot,
      VerificationJob,
      BindingChange,
      Dispute,
      AdminAction,
      XBinding,
    ]),
    JwtModule.register({}),
    LedgerModule,
    NotificationsModule,
    WithdrawalsModule,
    DepositsModule,
    VerificationModule,
    DisputesModule,
  ],
  controllers: [AdminAuthController, AdminController],
  providers: [AdminService, ReconciliationService],
  exports: [AdminService],
})
export class AdminModule {}

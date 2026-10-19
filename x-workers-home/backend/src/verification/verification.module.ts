import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { XBinding } from '../bindings/x-binding.entity';
import { JobsModule } from '../jobs/jobs.module';
import { VerificationJob } from '../jobs/verification-job.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { Order } from '../orders/order.entity';
import { OrderSlot } from '../slots/order-slot.entity';
import { XScraperModule } from '../xscraper/xscraper.module';
import { VerificationController } from './verification.controller';
import { VerificationService } from './verification.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([OrderSlot, Order, XBinding, VerificationJob]),
    JobsModule,
    NotificationsModule,
    XScraperModule,
  ],
  controllers: [VerificationController],
  providers: [VerificationService],
  exports: [VerificationService],
})
export class VerificationModule {}

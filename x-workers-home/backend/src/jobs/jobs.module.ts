import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SchedulerService } from './scheduler.service';
import { VerificationJob } from './verification-job.entity';

@Module({
  imports: [TypeOrmModule.forFeature([VerificationJob])],
  providers: [SchedulerService],
  exports: [SchedulerService],
})
export class JobsModule {}

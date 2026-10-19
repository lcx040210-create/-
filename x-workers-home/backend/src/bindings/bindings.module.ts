import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobsModule } from '../jobs/jobs.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { User } from '../users/user.entity';
import { XScraperModule } from '../xscraper/xscraper.module';
import { BindingChange } from './binding-change.entity';
import { BindingsController } from './bindings.controller';
import { BindingsService } from './bindings.service';
import { XBinding } from './x-binding.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([XBinding, BindingChange, User]),
    JobsModule,
    NotificationsModule,
    XScraperModule,
  ],
  controllers: [BindingsController],
  providers: [BindingsService],
  exports: [BindingsService],
})
export class BindingsModule {}

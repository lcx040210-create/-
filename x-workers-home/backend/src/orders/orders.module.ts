import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { XBinding } from '../bindings/x-binding.entity';
import { LedgerModule } from '../ledger/ledger.module';
import { User } from '../users/user.entity';
import { MeOrdersController } from './me-orders.controller';
import { Order } from './order.entity';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [TypeOrmModule.forFeature([Order, User, XBinding]), LedgerModule],
  controllers: [OrdersController, MeOrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}

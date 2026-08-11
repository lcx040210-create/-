import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from './order.entity';
import { BalanceRecord } from '../balances/balance-record.entity';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { PackagesModule } from '../packages/packages.module';

@Module({
  imports: [TypeOrmModule.forFeature([Order, BalanceRecord]), PackagesModule],
  providers: [OrdersService],
  controllers: [OrdersController],
  exports: [OrdersService],
})
export class OrdersModule {}

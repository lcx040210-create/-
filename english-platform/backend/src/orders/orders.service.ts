import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order, PayStatus } from './order.entity';
import { BalanceRecord } from '../balances/balance-record.entity';
import { PackagesService } from '../packages/packages.service';

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order)
    private ordersRepository: Repository<Order>,
    @InjectRepository(BalanceRecord)
    private balanceRepository: Repository<BalanceRecord>,
    private packagesService: PackagesService,
  ) {}

  async createOrder(studentId: string, packageId: string, payChannel: string) {
    const pkg = await this.packagesService.findById(packageId);
    if (pkg.status !== 'active') {
      throw new BadRequestException('该课包已下架');
    }

    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30分钟

    // 生成模拟支付二维码（开发环境）
    const payUrl = `https://qr.example.com/pay?order=${Date.now()}&amount=${pkg.price}&channel=${payChannel}`;

    const order = this.ordersRepository.create({
      student_id: studentId,
      package_id: packageId,
      amount: pkg.price,
      pay_channel: payChannel as any,
      pay_url: payUrl,
      expires_at: expiresAt,
    });

    return this.ordersRepository.save(order);
  }

  async handlePaymentCallback(orderId: string) {
    const order = await this.ordersRepository.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.pay_status !== PayStatus.PENDING) {
      throw new BadRequestException('订单已处理');
    }
    if (new Date() > order.expires_at) {
      order.pay_status = PayStatus.EXPIRED;
      await this.ordersRepository.save(order);
      throw new BadRequestException('订单已过期');
    }

    // 更新订单状态
    order.pay_status = PayStatus.PAID;
    order.paid_at = new Date();
    await this.ordersRepository.save(order);

    // 创建课时余额
    const pkg = await this.packagesService.findById(order.package_id);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + pkg.valid_days);

    const balance = this.balanceRepository.create({
      student_id: order.student_id,
      order_id: order.id,
      exam_types: pkg.exam_types,
      skills: pkg.skills,
      total_lessons: pkg.lesson_count,
      remaining: pkg.lesson_count,
      expires_at: expiresAt.toISOString().split('T')[0],
    });
    await this.balanceRepository.save(balance);

    return { order, balance };
  }

  async getStudentBalances(studentId: string) {
    return this.balanceRepository.find({
      where: { student_id: studentId },
      order: { expires_at: 'ASC' },
    });
  }

  async getStudentOrders(studentId: string) {
    return this.ordersRepository.find({
      where: { student_id: studentId },
      order: { created_at: 'DESC' },
    });
  }
}

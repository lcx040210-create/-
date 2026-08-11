import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export enum PayChannel {
  WECHAT = 'wechat',
  ALIPAY = 'alipay',
}

export enum PayStatus {
  PENDING = 'pending',
  PAID = 'paid',
  EXPIRED = 'expired',
  REFUNDED = 'refunded',
}

@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  student_id: string;

  @Column()
  package_id: string;

  @Column('decimal', { precision: 10, scale: 2 })
  amount: number;

  @Column({ type: 'enum', enum: PayChannel })
  pay_channel: PayChannel;

  @Column({ type: 'enum', enum: PayStatus, default: PayStatus.PENDING })
  pay_status: PayStatus;

  @Column({ nullable: true })
  pay_url: string;

  @Column({ nullable: true })
  paid_at: Date;

  @Column()
  expires_at: Date;

  @CreateDateColumn()
  created_at: Date;
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Notification } from './notification.entity';

export interface NotifyInput {
  userId: string;
  kind: string;
  title: string;
  body: string;
  ref?: { type: string; id: string };
}

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private readonly notifications: Repository<Notification>,
  ) {}

  /**
   * 事务内落库。非事务场景由调用方自己开事务后传入 EntityManager，
   * 保证「业务状态 + 通知」原子提交。
   */
  async notify(tx: EntityManager, input: NotifyInput): Promise<Notification> {
    const repo = tx.getRepository(Notification);
    return repo.save(
      repo.create({
        userId: input.userId,
        kind: input.kind,
        title: input.title,
        body: input.body,
        refType: input.ref?.type ?? null,
        refId: input.ref?.id ?? null,
        readAt: null,
      }),
    );
  }

  async list(userId: string, limit = 20, offset = 0) {
    const [items, total] = await this.notifications.findAndCount({
      where: { userId },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: limit,
      skip: offset,
    });
    return { items, total, limit, offset };
  }

  async markRead(userId: string, id: string): Promise<Notification> {
    const notification = await this.notifications.findOne({ where: { id, userId } });
    if (!notification) {
      throw new NotFoundException('通知不存在');
    }
    if (!notification.readAt) {
      notification.readAt = new Date();
      await this.notifications.save(notification);
    }
    return notification;
  }
}

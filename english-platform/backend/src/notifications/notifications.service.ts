import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification, NotificationType } from './notification.entity';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private notificationsRepository: Repository<Notification>,
  ) {}

  async create(
    userId: string,
    type: NotificationType,
    title: string,
    content?: string,
  ) {
    const notif = this.notificationsRepository.create({ user_id: userId, type, title, content });
    return this.notificationsRepository.save(notif);
  }

  async getForUser(userId: string) {
    return this.notificationsRepository.find({
      where: { user_id: userId },
      order: { created_at: 'DESC' },
      take: 50,
    });
  }

  async getUnreadCount(userId: string) {
    return this.notificationsRepository.count({
      where: { user_id: userId, is_read: false },
    });
  }

  async markRead(id: string, userId: string) {
    const notif = await this.notificationsRepository.findOne({ where: { id, user_id: userId } });
    if (notif) {
      notif.is_read = true;
      await this.notificationsRepository.save(notif);
    }
    return notif;
  }

  async markAllRead(userId: string) {
    await this.notificationsRepository.update(
      { user_id: userId, is_read: false },
      { is_read: true },
    );
  }
}

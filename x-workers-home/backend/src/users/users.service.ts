import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { XBinding } from '../bindings/x-binding.entity';
import { OrderSlot } from '../slots/order-slot.entity';
import { User } from './user.entity';

/** 公开主页可见字段（绝不含地址 / 邀请码 / 角色等敏感信息）。 */
export interface PublicUserView {
  id: string;
  handle: string | null;
  joined: Date;
  ratingGrade: string | null;
  completedCount: number;
  xBound: boolean;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(XBinding)
    private readonly bindings: Repository<XBinding>,
    @InjectRepository(OrderSlot)
    private readonly slots: Repository<OrderSlot>,
  ) {}

  /**
   * 公开主页聚合：
   * - handle / joined 取 active X 绑定（joined = 绑定验证时间，回落到绑定创建时间）；
   *   未绑定则 handle=null、joined=users.created_at。
   * - ratingGrade 取冗余列；completedCount = 作为接单方已结算（paid）的名额数。
   */
  async getPublicProfile(id: string): Promise<PublicUserView> {
    const user = await this.users.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    const [binding, completedCount] = await Promise.all([
      this.bindings.findOne({ where: { userId: id, status: 'active' } }),
      this.slots.count({ where: { creatorUserId: id, status: 'paid' } }),
    ]);

    return {
      id: user.id,
      handle: binding?.handle ?? null,
      joined: binding ? (binding.verifiedAt ?? binding.createdAt) : user.createdAt,
      ratingGrade: user.ratingGrade,
      completedCount,
      xBound: !!binding,
    };
  }
}

import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { AdminAction } from '../admin/admin-action.entity';
import { Term } from './terms.entity';
import { UserConsent } from './user-consent.entity';

export const TERMS_PUBLISH_ACTION = 'terms_publish';

export interface TermView {
  id: string;
  version: number;
  title: string;
  content_md: string;
  published_at: Date;
}

function toView(term: Term): TermView {
  return {
    id: term.id,
    version: term.version,
    title: term.title,
    content_md: term.contentMd,
    published_at: term.publishedAt,
  };
}

@Injectable()
export class TermsService {
  constructor(
    @InjectRepository(Term) private readonly terms: Repository<Term>,
    private readonly dataSource: DataSource,
  ) {}

  /** 公开接口：当前生效版本。 */
  async current(): Promise<TermView> {
    const term = await this.terms.findOne({
      where: { isCurrent: true },
      order: { version: 'DESC' },
    });
    if (!term) {
      throw new InternalServerErrorException('服务条款未配置');
    }
    return toView(term);
  }

  /**
   * 在调用方事务内读取并锁定当前条款（FOR SHARE）：
   * 与发布事务的 FOR UPDATE 互斥，保证「校验版本 + 写同意」期间版本不被切换。
   */
  async requireCurrent(manager: EntityManager): Promise<Term> {
    const term = await manager.getRepository(Term).findOne({
      where: { isCurrent: true },
      order: { version: 'DESC' },
      lock: { mode: 'pessimistic_read' },
    });
    if (!term) {
      throw new InternalServerErrorException('服务条款未配置');
    }
    return term;
  }

  /** 幂等写入同意记录：唯一索引 + ON CONFLICT DO NOTHING，重复登录不改 agreed_at。 */
  async recordConsent(
    manager: EntityManager,
    userId: string,
    termsVersion: number,
  ): Promise<void> {
    await manager
      .getRepository(UserConsent)
      .createQueryBuilder()
      .insert()
      .values({ userId, termsVersion })
      .orIgnore()
      .execute();
  }

  /**
   * 发布新版本（单事务）：
   * 锁当前行 → 旧版 is_current=false → version+1 插入 → 同事务写 admin_actions。
   */
  async publish(
    title: string,
    contentMd: string,
    adminId: string,
  ): Promise<TermView> {
    return this.dataSource.transaction(async (tx) => {
      const repo = tx.getRepository(Term);
      const current = await repo.findOne({
        where: { isCurrent: true },
        order: { version: 'DESC' },
        lock: { mode: 'pessimistic_write' },
      });

      let version: number;
      if (current) {
        version = current.version + 1;
        current.isCurrent = false;
        await repo.save(current);
      } else {
        version = ((await repo.maximum('version')) ?? 0) + 1;
      }

      const created = await repo.save(
        repo.create({
          version,
          title,
          contentMd,
          publishedAt: new Date(),
          isCurrent: true,
        }),
      );

      const actions = tx.getRepository(AdminAction);
      await actions.save(
        actions.create({
          adminUserId: adminId,
          action: TERMS_PUBLISH_ACTION,
          targetType: 'terms',
          targetId: created.id,
          detail: { version: created.version, title: created.title },
        }),
      );

      return toView(created);
    });
  }
}

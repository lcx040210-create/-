import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthUser } from '../decorators/current-user.decorator';

/**
 * 管理端守卫：先走 JWT 策略（含封禁校验），再要求 DB 里的 role === 'admin'。
 * 非管理员 → 403；未登录 / token 失效 / 账号被封禁 → 401（由 JwtStrategy 抛出）。
 */
@Injectable()
export class AdminGuard extends AuthGuard('jwt') {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const passed = await super.canActivate(context);
    if (!passed) return false;

    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthUser | undefined;
    if (user?.role !== 'admin') {
      throw new ForbiddenException('需要管理员权限');
    }
    return true;
  }
}

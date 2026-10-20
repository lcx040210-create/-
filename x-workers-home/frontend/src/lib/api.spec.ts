import { describe, expect, it } from 'vitest';
import { errorMessage } from './api';

describe('errorMessage（管理端错误提示中文兜底）', () => {
  it('优先展示后端中文 message', () => {
    expect(
      errorMessage(
        { isAxiosError: true, response: { data: { message: '账号或密码错误' } } },
        '登录失败',
      ),
    ).toBe('账号或密码错误');
  });

  it('class-validator 的 message 数组用中文分号拼接', () => {
    expect(
      errorMessage(
        { isAxiosError: true, response: { data: { message: ['标题不能为空', '内容不能为空'] } } },
        '发布失败',
      ),
    ).toBe('标题不能为空；内容不能为空');
  });

  it('Nest 未捕获异常的英文 Internal server error 使用中文兜底', () => {
    expect(
      errorMessage(
        { isAxiosError: true, response: { data: { message: 'Internal server error' } } },
        '对账快照计算失败',
      ),
    ).toBe('对账快照计算失败');
  });

  it('无响应时提示检查后端服务', () => {
    expect(errorMessage({ isAxiosError: true }, '操作失败')).toBe(
      '网络错误，请确认后端服务已启动',
    );
  });
});

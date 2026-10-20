import { afterEach, describe, expect, it } from 'vitest';
import { API_BASE_URL, errorMessage, fetchApiBaseUrl } from './api';

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

describe('fetchApiBaseUrl（SSR 与浏览器地址分裂）', () => {
  const original = process.env.API_INTERNAL_URL;

  afterEach(() => {
    if (original === undefined) delete process.env.API_INTERNAL_URL;
    else process.env.API_INTERNAL_URL = original;
  });

  it('服务端优先使用容器内 API_INTERNAL_URL（去掉尾斜杠）', () => {
    process.env.API_INTERNAL_URL = 'http://api:4001/api/';
    // vitest 默认 node 环境没有 window → 走服务端分支
    expect(fetchApiBaseUrl()).toBe('http://api:4001/api');
  });

  it('服务端未配置内部地址时回落到 NEXT_PUBLIC_API_URL', () => {
    delete process.env.API_INTERNAL_URL;
    expect(fetchApiBaseUrl()).toBe(API_BASE_URL);
  });
});

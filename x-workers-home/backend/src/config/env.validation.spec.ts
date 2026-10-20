import { Logger } from '@nestjs/common';
import {
  DEFAULT_DEPOSIT_MIN_CONFIRMATIONS,
  validateEnv,
} from './env.validation';

const VALID_PLATFORM = '0x000000000000000000000000000000000000dead';
const VALID_USDT = '0x55d398326f99059ff775485246999027b3197955';

function makeEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    JWT_SECRET: 'test_jwt_secret',
    JWT_REFRESH_SECRET: 'test_jwt_refresh_secret',
    PLATFORM_WALLET_ADDRESS: VALID_PLATFORM,
    USDT_BEP20_CONTRACT: VALID_USDT,
    DEPOSIT_MIN_CONFIRMATIONS: '15',
    ...overrides,
  } as NodeJS.ProcessEnv;
}

describe('validateEnv（资金 env 启动校验）', () => {
  it('合法配置通过且不修改确认数', () => {
    const env = makeEnv();
    expect(() => validateEnv(env)).not.toThrow();
    expect(env.DEPOSIT_MIN_CONFIRMATIONS).toBe('15');
  });

  it('JWT_SECRET 为空 → 抛中文错误', () => {
    expect(() => validateEnv(makeEnv({ JWT_SECRET: '' }))).toThrow(/JWT_SECRET/);
    expect(() => validateEnv(makeEnv({ JWT_SECRET: '   ' }))).toThrow(/JWT_SECRET/);
  });

  it('JWT_REFRESH_SECRET 为空 → 抛中文错误', () => {
    expect(() => validateEnv(makeEnv({ JWT_REFRESH_SECRET: '' }))).toThrow(
      /JWT_REFRESH_SECRET/,
    );
  });

  it('双 JWT 密钥相同 → 抛中文错误', () => {
    expect(() =>
      validateEnv(makeEnv({ JWT_SECRET: 'same', JWT_REFRESH_SECRET: 'same' })),
    ).toThrow(/不相同/);
  });

  it('平台收款地址为零地址 / 非法 → 抛中文错误', () => {
    expect(() =>
      validateEnv(makeEnv({ PLATFORM_WALLET_ADDRESS: `0x${'0'.repeat(40)}` })),
    ).toThrow(/PLATFORM_WALLET_ADDRESS/);
    expect(() =>
      validateEnv(makeEnv({ PLATFORM_WALLET_ADDRESS: '0x1234' })),
    ).toThrow(/PLATFORM_WALLET_ADDRESS/);
    expect(() => validateEnv(makeEnv({ PLATFORM_WALLET_ADDRESS: '' }))).toThrow(
      /PLATFORM_WALLET_ADDRESS/,
    );
  });

  it('USDT 合约地址非法 → 抛中文错误', () => {
    expect(() =>
      validateEnv(makeEnv({ USDT_BEP20_CONTRACT: 'not-a-contract' })),
    ).toThrow(/USDT_BEP20_CONTRACT/);
  });

  it('确认数为空 / NaN / 0 / 负数 → 回退 15 并 warn', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      for (const raw of ['', '   ', 'abc', '0', '-3', '1.5']) {
        warn.mockClear();
        const env = makeEnv({ DEPOSIT_MIN_CONFIRMATIONS: raw });
        expect(() => validateEnv(env)).not.toThrow();
        expect(env.DEPOSIT_MIN_CONFIRMATIONS).toBe(
          String(DEFAULT_DEPOSIT_MIN_CONFIRMATIONS),
        );
        expect(warn).toHaveBeenCalled();
      }
    } finally {
      warn.mockRestore();
    }
  });
});

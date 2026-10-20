import { INestApplication, ValidationPipe } from '@nestjs/common';
import { validateEnv } from './config/env.validation';

export function configureApp(app: INestApplication): void {
  // 资金 env 在启动时 fail-closed；非法确认数回退默认值并 warn。
  validateEnv();

  app.setGlobalPrefix('api');
  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:4000',
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
}

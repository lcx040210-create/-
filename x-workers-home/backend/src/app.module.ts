import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { databaseOptions } from './config/database.config';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      ...databaseOptions,
      autoLoadEntities: false,
    }),
  ],
  controllers: [HealthController],
})
export class AppModule {}

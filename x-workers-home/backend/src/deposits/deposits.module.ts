import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LedgerModule } from '../ledger/ledger.module';
import { User } from '../users/user.entity';
import { BscChainProvider } from './bsc-chain-provider';
import { BscWatcherService } from './bsc-watcher.service';
import { ChainCursor } from './chain-cursor.entity';
import { CHAIN_PROVIDER } from './chain-provider';
import { Deposit } from './deposit.entity';
import { DepositsController } from './deposits.controller';
import { DepositsService } from './deposits.service';

@Module({
  imports: [TypeOrmModule.forFeature([Deposit, ChainCursor, User]), LedgerModule],
  controllers: [DepositsController],
  providers: [
    DepositsService,
    BscWatcherService,
    { provide: CHAIN_PROVIDER, useClass: BscChainProvider },
  ],
  exports: [DepositsService, BscWatcherService, CHAIN_PROVIDER],
})
export class DepositsModule {}

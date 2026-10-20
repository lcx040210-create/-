import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Term } from './terms.entity';
import { TermsAdminController, TermsController } from './terms.controller';
import { TermsService } from './terms.service';
import { UserConsent } from './user-consent.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Term, UserConsent])],
  controllers: [TermsController, TermsAdminController],
  providers: [TermsService],
  exports: [TermsService],
})
export class TermsModule {}

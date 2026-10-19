import { Module } from '@nestjs/common';
import { XScraperService } from './xscraper.service';

/**
 * XScraperService 未加 @Injectable（构造函数有默认值），这里用显式 useFactory 接线。
 * 导出类 token，e2e 可通过 overrideProvider(XScraperService) 注入 fake。
 */
@Module({
  providers: [{ provide: XScraperService, useFactory: () => new XScraperService() }],
  exports: [XScraperService],
})
export class XScraperModule {}

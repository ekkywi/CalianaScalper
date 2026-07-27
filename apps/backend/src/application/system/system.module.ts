// apps/backend/src/application/system/system.module.ts

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SystemController } from './system.controller';
import { TradingModeService } from './trading-mode.service';
import { MlModule } from '../ml/ml.module';
import { RiskModule } from '../risk/risk.module';
import { SystemConfigEntity } from '../../infrastructure/database/system-config.entity';

@Module({
  imports: [
    MlModule,
    RiskModule,
    TypeOrmModule.forFeature([SystemConfigEntity]),
  ],
  controllers: [SystemController],
  providers: [TradingModeService],
  exports: [TradingModeService],
})
export class SystemModule {}

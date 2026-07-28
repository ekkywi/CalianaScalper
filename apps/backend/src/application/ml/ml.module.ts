// apps/backend/src/application/ml/ml.module.ts

import { Module, forwardRef } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { MlController } from './ml.controller';
import { MlEngineService } from '../../infrastructure/ml/ml-engine.service';
import { MlShadowService } from '../../infrastructure/ml/ml-shadow.service';
import { RiskModule } from '../risk/risk.module';
import { StrategyModule } from '../strategy/strategy.module';

@Module({
  imports: [
    HttpModule,
    // Circular: RiskModule → StrategyModule → MlModule → RiskModule
    forwardRef(() => RiskModule),
    forwardRef(() => StrategyModule),
  ],
  controllers: [MlController],
  providers: [MlEngineService, MlShadowService],
  exports: [MlEngineService, MlShadowService],
})
export class MlModule {}

// apps/backend/src/application/ml/ml.module.ts

import { Module, forwardRef } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MlController } from './ml.controller';
import { MlEngineService } from '../../infrastructure/ml/ml-engine.service';
import { MlPredictionLogService } from '../../infrastructure/ml/ml-prediction-log.service';
import { MlPredictionEventEntity } from '../../infrastructure/database/ml-prediction-event.entity';
import { RiskModule } from '../risk/risk.module';
import { StrategyModule } from '../strategy/strategy.module';

@Module({
  imports: [
    HttpModule,
    TypeOrmModule.forFeature([MlPredictionEventEntity]),
    // Circular: RiskModule → StrategyModule → MlModule → RiskModule
    forwardRef(() => RiskModule),
    forwardRef(() => StrategyModule),
  ],
  controllers: [MlController],
  providers: [MlEngineService, MlPredictionLogService],
  exports: [MlEngineService, MlPredictionLogService],
})
export class MlModule {}

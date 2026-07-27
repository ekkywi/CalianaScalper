// apps/backend/src/application/performance/performance.module.ts

import { Module } from '@nestjs/common';
import { PerformanceController } from './performance.controller';
import { RiskModule } from '../risk/risk.module';

@Module({
  imports: [RiskModule],
  controllers: [PerformanceController],
})
export class PerformanceModule {}

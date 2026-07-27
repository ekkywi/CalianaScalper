// apps/backend/src/application/system/system.module.ts

import { Module } from '@nestjs/common';
import { SystemController } from './system.controller';
import { MlModule } from '../ml/ml.module';
import { RiskModule } from '../risk/risk.module';

@Module({
  imports: [MlModule, RiskModule],
  controllers: [SystemController],
})
export class SystemModule {}

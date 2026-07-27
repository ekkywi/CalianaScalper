// apps/backend/src/application/ml/ml.module.ts

import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { MlController } from './ml.controller';
import { MlEngineService } from '../../infrastructure/ml/ml-engine.service';

@Module({
  imports: [HttpModule],
  controllers: [MlController],
  providers: [MlEngineService],
  exports: [MlEngineService],
})
export class MlModule {}

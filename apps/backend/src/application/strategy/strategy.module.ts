// apps/backend/src/application/strategy/strategy.module.ts

import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StrategyController } from './strategy.controller';
import { StrategyService } from '../../infrastructure/strategy/strategy.service';
import { TradingProfileEntity } from '../../infrastructure/database/trading-profile.entity';
import { MlModelRegistryEntity } from '../../infrastructure/database/ml-model-registry.entity';
import { SymbolStrategyBindingEntity } from '../../infrastructure/database/symbol-strategy-binding.entity';
import { SymbolModule } from '../symbol/symbol.module';
import { MlModule } from '../ml/ml.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TradingProfileEntity,
      MlModelRegistryEntity,
      SymbolStrategyBindingEntity,
    ]),
    SymbolModule,
    forwardRef(() => MlModule),
  ],
  controllers: [StrategyController],
  providers: [StrategyService],
  exports: [StrategyService],
})
export class StrategyModule {}

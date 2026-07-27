// apps/backend/src/application/risk/risk.module.ts
// Risk Management Module

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RiskController } from './risk.controller';
import { PositionManagerService } from '../../infrastructure/risk/position-manager.service';
import { BinanceExecutionService } from '../../infrastructure/exchange/binance-execution.service';
import { OrderEntity } from '../../infrastructure/database/order.entity';
import { PositionEntity } from '../../infrastructure/database/position.entity';
import { TradeEntity } from '../../infrastructure/database/trade.entity';
import { SystemConfigEntity } from '../../infrastructure/database/system-config.entity';

@Module({
  imports: [TypeOrmModule.forFeature([OrderEntity, PositionEntity, TradeEntity, SystemConfigEntity])],
  controllers: [RiskController],
  providers: [PositionManagerService, BinanceExecutionService],
  exports: [PositionManagerService, BinanceExecutionService],
})
export class RiskModule {}

// apps/backend/src/application/orders/orders.module.ts

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrderEntity } from '../../infrastructure/database/order.entity';
import { RiskModule } from '../risk/risk.module';

@Module({
  imports: [TypeOrmModule.forFeature([OrderEntity]), RiskModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}

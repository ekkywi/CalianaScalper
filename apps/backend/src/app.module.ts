import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { BinanceWsService } from './infrastructure/exchange/binance-ws.service';
import { BinanceRestService } from './infrastructure/exchange/binance-rest.service';
import { CandleStorageService } from './infrastructure/database/candle-storage.service';
import { AppController } from './app.controller';
import { MarketOrchestrator } from './application/orchestrator/market.orchestrator';
import { UiGateway } from './presentation/gateway/ui.gateway';
import { CandleEntity } from './infrastructure/database/candle.entity';
import { OrderEntity } from './infrastructure/database/order.entity';
import { PositionEntity } from './infrastructure/database/position.entity';
import { TradeEntity } from './infrastructure/database/trade.entity';
import { SystemConfigEntity } from './infrastructure/database/system-config.entity';
import { SymbolModule } from './application/symbol/symbol.module';
import { SymbolEntity } from './infrastructure/database/symbol.entity'; 
import { CandlesController } from './application/candles/candles.controller';
import { MarketController } from './application/market/market.controller';
import { RiskModule } from './application/risk/risk.module';
import { PerformanceModule } from './application/performance/performance.module';
import { MlModule } from './application/ml/ml.module';
import { StrategyModule } from './application/strategy/strategy.module';
import { SystemModule } from './application/system/system.module';
import { OrdersModule } from './application/orders/orders.module';
import { join } from 'path';
import { TradingProfileEntity } from './infrastructure/database/trading-profile.entity';
import { MlModelRegistryEntity } from './infrastructure/database/ml-model-registry.entity';
import { SymbolStrategyBindingEntity } from './infrastructure/database/symbol-strategy-binding.entity';

@Module({
  imports: [
    HttpModule,
    EventEmitterModule.forRoot({
      wildcard: true,
      delimiter: '.',
    }),

    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: join(process.cwd(), '.env'),
    }),

    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const host = configService.get<string>('DB_HOST');
        const port = configService.get<number>('DB_PORT');
        const user = configService.get<string>('DB_USER');
        const pass = configService.get<string>('DB_PASS');
        const name = configService.get<string>('DB_NAME');

        if (!pass) {
          throw new Error('CRITICAL: DB_PASS kosong. File .env tidak terbaca atau key salah!');
        }

        return {
          type: 'postgres',
          host: host,
          port: port,
          username: user,
          password: pass,
          database: name,
          
          entities: [
            CandleEntity,
            SymbolEntity,
            OrderEntity,
            PositionEntity,
            TradeEntity,
            SystemConfigEntity,
            TradingProfileEntity,
            MlModelRegistryEntity,
            SymbolStrategyBindingEntity,
          ],
          synchronize: true,
        };
      },
    }),

    TypeOrmModule.forFeature([CandleEntity, OrderEntity]),
    
    SymbolModule,
    RiskModule,
    PerformanceModule,
    MlModule,
    StrategyModule,
    SystemModule,
    OrdersModule,
  ],
  controllers: [
    AppController,
    CandlesController,
    MarketController,
  ],
  providers: [
    BinanceWsService,
    MarketOrchestrator,
    UiGateway,
    CandleStorageService,
    BinanceRestService,
  ],
})

export class AppModule{}
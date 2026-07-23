// apps/backend/src/app.module.ts

import { Module, OnModuleInit } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { join } from 'path';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { BinanceWsService } from './infrastructure/exchange/binance-ws.service';
import { BinanceRestService } from './infrastructure/exchange/binance-rest.service';
import { CandleStorageService } from './infrastructure/database/candle-storage.service';
import { MlEngineService } from './infrastructure/ml/ml-engine.service';
import { AppController } from './app.controller';
import { MarketOrchestrator } from './application/orchestrator/market.orchestrator';
import { UiGateway } from './presentation/gateway/ui.gateway';
import { CandleEntity } from './infrastructure/database/candle.entity';

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

        console.log('--- DEBUG ENV ---');
        console.log(`CWD: ${process.cwd()}`);
        console.log(`DB_HOST: ${host}`);
        console.log(`DB_USER: ${user}`);
        console.log(`DB_PASS: ${pass ? 'TERBACA' : 'UNDEFINED'}`);
        console.log('-----------------');

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
          entities: [CandleEntity],
          synchronize: true, 
        };
      },
    }),

    TypeOrmModule.forFeature([CandleEntity]),
  ],
  controllers: [
    AppController,
  ],
  providers: [
    BinanceWsService,
    MarketOrchestrator,
    UiGateway,
    CandleStorageService,
    BinanceRestService,
    MlEngineService,
  ],
})

export class AppModule implements OnModuleInit{
  constructor(private readonly binanceRest: BinanceRestService) {}

  async onModuleInit() {
      await this.binanceRest.backfillCandles('BTCUSDT', '15m', 1000);
  }
}

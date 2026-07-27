// apps/backend/src/application/orders/orders.controller.ts

import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { OrdersService } from './orders.service';

class PlaceOrderBody {
  symbol: string;
  side: 'buy' | 'sell';
  type: 'MARKET' | 'LIMIT' | 'STOP_LOSS';
  quantity: number;
  price?: number;
}

@Controller('api/orders')
export class OrdersController {
  private readonly logger = new Logger(OrdersController.name);

  constructor(private readonly ordersService: OrdersService) {}

  /** Open orders from active exchange venue (paper testnet or live) */
  @Get('exchange/open')
  async exchangeOpen(@Query('symbol') symbol?: string) {
    return this.ordersService.listExchangeOpenOrders(symbol);
  }

  /** Recent orders from active exchange venue */
  @Get('exchange/recent')
  async exchangeRecent(
    @Query('symbol') symbol?: string,
    @Query('limit') limit?: string,
  ) {
    return this.ordersService.listExchangeRecentOrders(
      symbol,
      limit ? Number(limit) : 50,
    );
  }

  /** Cancel an open order on the active exchange venue */
  @Delete('exchange/:orderId')
  async exchangeCancel(
    @Param('orderId') orderId: string,
    @Query('symbol') symbol?: string,
  ) {
    this.logger.log(`[ORDERS] Cancel exchange order ${orderId} symbol=${symbol}`);
    return this.ordersService.cancelExchangeOrder(orderId, symbol);
  }

  /** Local Postgres order ledger */
  @Get()
  async list(
    @Query('symbol') symbol?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    return this.ordersService.listOrders({
      symbol,
      limit: limit ? Number(limit) : 50,
      status,
    });
  }

  @Post()
  async place(@Body() body: PlaceOrderBody) {
    this.logger.log(`[ORDERS] Manual place ${JSON.stringify(body)}`);
    return this.ordersService.placeOrder(body);
  }
}

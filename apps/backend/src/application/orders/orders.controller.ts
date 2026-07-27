// apps/backend/src/application/orders/orders.controller.ts

import { Body, Controller, Get, Post, Query, Logger } from '@nestjs/common';
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

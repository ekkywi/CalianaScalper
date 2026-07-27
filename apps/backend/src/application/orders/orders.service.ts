// apps/backend/src/application/orders/orders.service.ts

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BinanceExecutionService } from '../../infrastructure/exchange/binance-execution.service';
import { PositionManagerService } from '../../infrastructure/risk/position-manager.service';
import { OrderEntity } from '../../infrastructure/database/order.entity';

export type PlaceOrderDto = {
  symbol: string;
  side: 'buy' | 'sell';
  type: 'MARKET' | 'LIMIT' | 'STOP_LOSS';
  quantity: number;
  price?: number;
};

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly execution: BinanceExecutionService,
    private readonly positionManager: PositionManagerService,
    @InjectRepository(OrderEntity)
    private readonly orderRepo: Repository<OrderEntity>,
  ) {}

  async listOrders(params?: { symbol?: string; limit?: number; status?: string }) {
    const where: Record<string, string> = {};
    if (params?.symbol) where.symbol = params.symbol.toUpperCase();
    if (params?.status) where.status = params.status;

    return this.orderRepo.find({
      where,
      order: { timestamp: 'DESC' },
      take: params?.limit || 50,
    });
  }

  async placeOrder(dto: PlaceOrderDto) {
    const symbol = (dto.symbol || '').toUpperCase().replace('/', '');
    const side = dto.side;
    const type = dto.type;
    const quantity = Number(dto.quantity);

    if (!symbol || !side || !type) {
      throw new BadRequestException('symbol, side, and type are required');
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new BadRequestException('quantity must be > 0');
    }
    if (type === 'STOP_LOSS') {
      throw new BadRequestException(
        'STOP_LOSS orders are not supported via manual entry — use position SL/TP levels',
      );
    }
    if (type === 'LIMIT' && (!dto.price || dto.price <= 0)) {
      throw new BadRequestException('LIMIT orders require a positive price');
    }
    if (this.positionManager.isTradingHalted()) {
      throw new BadRequestException('Trading is halted — resume before placing orders');
    }

    if (side === 'buy') {
      return this.placeBuy(symbol, type, quantity, dto.price);
    }
    return this.placeSell(symbol, type, quantity, dto.price);
  }

  private async placeBuy(
    symbol: string,
    type: 'MARKET' | 'LIMIT',
    quantity: number,
    price?: number,
  ) {
    const balance = await this.execution.getBalance('USDT');
    if (!balance) {
      throw new BadRequestException('Failed to fetch USDT balance');
    }

    const entryRef =
      type === 'LIMIT' && price
        ? price
        : (await this.estimatePrice(symbol)) || price || 0;
    if (entryRef <= 0) {
      throw new BadRequestException('Could not determine entry price');
    }

    const gate = await this.positionManager.canOpenPosition(
      symbol,
      entryRef,
      quantity,
      balance,
    );
    if (!gate.allowed) {
      throw new BadRequestException(`Risk rejected BUY: ${gate.reason}`);
    }

    const orderResult =
      type === 'MARKET'
        ? await this.execution.executeMarketOrder(symbol, 'buy', quantity)
        : await this.execution.executeLimitOrder(symbol, 'buy', quantity, price!);

    if (!orderResult) {
      throw new BadRequestException('Exchange rejected BUY order');
    }

    // Only open ledger position when fill exists (market fills immediately; limit may be open)
    if (orderResult.filledQuantity > 0 || orderResult.status === 'FILLED') {
      const avg =
        orderResult.averagePrice > 0
          ? orderResult.averagePrice
          : orderResult.price > 0
            ? orderResult.price
            : entryRef;
      const filled =
        orderResult.filledQuantity > 0 ? orderResult.filledQuantity : quantity;
      const position = await this.positionManager.openPosition(
        symbol,
        'LONG',
        avg,
        filled,
        balance,
      );
      if (!position) {
        this.logger.error(
          `[ORDERS] BUY filled but ledger open failed for ${symbol} — attempting flatten`,
        );
        await this.execution.closePosition(symbol, filled);
        throw new BadRequestException(
          'Order filled but position ledger failed; attempted emergency flatten',
        );
      }
      return { order: orderResult, position };
    }

    return { order: orderResult, position: null };
  }

  private async placeSell(
    symbol: string,
    type: 'MARKET' | 'LIMIT',
    quantity: number,
    price?: number,
  ) {
    const existing = this.positionManager.getPosition(symbol);
    if (!existing || existing.status !== 'OPEN') {
      throw new BadRequestException(
        `No open LONG position for ${symbol} — spot mode cannot short`,
      );
    }

    const posQty = Number(existing.quantity);
    if (quantity > posQty + 1e-12) {
      throw new BadRequestException(
        `Sell quantity ${quantity} exceeds open position ${posQty}`,
      );
    }

    // Full close via flatten path (exchange + ledger)
    if (Math.abs(quantity - posQty) < 1e-10) {
      if (type === 'LIMIT') {
        throw new BadRequestException(
          'Full position close via LIMIT not supported — use MARKET or Position Management',
        );
      }
      const fallback = (await this.estimatePrice(symbol)) || Number(existing.entryPrice);
      const closed = await this.positionManager.flattenAndClose(
        symbol,
        fallback,
        'CLOSED_BY_MANUAL',
      );
      if (!closed) {
        throw new BadRequestException(
          `Failed to close ${symbol} on exchange — position left open`,
        );
      }
      return { order: null, position: closed };
    }

    // Partial sell: exchange only, then reduce ledger quantity
    const orderResult =
      type === 'MARKET'
        ? await this.execution.executeMarketOrder(symbol, 'sell', quantity)
        : await this.execution.executeLimitOrder(symbol, 'sell', quantity, price!);

    if (!orderResult) {
      throw new BadRequestException('Exchange rejected SELL order');
    }

    if (orderResult.filledQuantity > 0 || orderResult.status === 'FILLED') {
      const filled =
        orderResult.filledQuantity > 0 ? orderResult.filledQuantity : quantity;
      const reduced = await this.positionManager.reduceOpenQuantity(symbol, filled);
      return { order: orderResult, position: reduced };
    }

    return { order: orderResult, position: existing };
  }

  private async estimatePrice(symbol: string): Promise<number> {
    return this.execution.getLastPrice(symbol);
  }
}

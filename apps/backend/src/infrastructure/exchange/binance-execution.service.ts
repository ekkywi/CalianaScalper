// apps/backend/src/infrastructure/exchange/binance-execution.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as ccxt from 'ccxt';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MARKET_EVENTS, OrderResult, AccountBalance } from '../../core/domain/market.types';
import { OrderEntity } from '../database/order.entity';

@Injectable()
export class BinanceExecutionService {
    private readonly logger = new Logger(BinanceExecutionService.name);
    private exchange: ccxt.binance;

    constructor(
        private configService: ConfigService,
        private readonly eventEmitter: EventEmitter2,
        @InjectRepository(OrderEntity)
        private readonly orderRepo: Repository<OrderEntity>,
    ) {
        this.exchange = new ccxt.binance({
            apiKey: this.configService.get('BINANCE_API_KEY'),
            secret: this.configService.get('BINANCE_API_SECRET'),
            enableRateLimit: true,
            options: {
                defaultType: 'spot',
            },
        });

        this.exchange.setSandboxMode(true);
    }

    /**
     * Fetch account balance for a specific asset
     */
    async getBalance(asset: string = 'USDT'): Promise<AccountBalance | null> {
        try {
            const balance = await this.exchange.fetchBalance();
            const assetBalance = balance[asset];
            
            if (!assetBalance) {
                this.logger.warn(`[BALANCE] Aset ${asset} tidak ditemukan di akun.`);
                return null;
            }

            return {
                asset,
                free: assetBalance.free || 0,
                used: assetBalance.used || 0,
                total: assetBalance.total || 0,
            };
        } catch (error) {
            this.logger.error(`[BALANCE] Gagal mengambil saldo: ${error.message}`);
            return null;
        }
    }

    /**
     * Execute a market order with full error handling and balance validation
     */
    async executeMarketOrder(
        symbol: string, 
        side: 'buy' | 'sell', 
        amount: number,
    ): Promise<OrderResult | null> {
        try {
            // STEP 1: Validate amount
            if (amount <= 0) {
                this.logger.error(`[EKSEKUSI] Jumlah order tidak valid: ${amount}`);
                return null;
            }

            // STEP 2: Check balance before order
            const requiredAsset = side === 'buy' ? 'USDT' : symbol.replace('USDT', '');
            const balance = await this.getBalance(requiredAsset);
            
            if (!balance) {
                this.logger.error(`[EKSEKUSI] Gagal mendapatkan saldo untuk ${requiredAsset}`);
                return null;
            }

            // For BUY: check USDT balance, for SELL: check asset balance
            if (side === 'buy') {
                const estimatedCost = amount * (await this.getCurrentPrice(symbol));
                if (balance.free < estimatedCost) {
                    this.logger.error(
                        `[EKSEKUSI] Saldo ${requiredAsset} tidak cukup. ` +
                        `Butuh ~${estimatedCost.toFixed(2)}, tersedia ${balance.free.toFixed(2)}`
                    );
                    return null;
                }
            } else {
                if (balance.free < amount) {
                    this.logger.error(
                        `[EKSEKUSI] Saldo ${requiredAsset} tidak cukup. ` +
                        `Butuh ${amount}, tersedia ${balance.free}`
                    );
                    return null;
                }
            }

            // STEP 3: Send order with slippage protection
            this.logger.log(`[EKSEKUSI] Mengirim Market ${side.toUpperCase()} untuk ${amount} ${symbol} ke Testnet...`);
            
            const order = await this.exchange.createMarketOrder(symbol, side, amount, undefined, {
                newOrderRespType: 'FULL',
            });

            // STEP 4: Map ccxt order to our OrderResult type
            const orderResult: OrderResult = {
                id: String(order.id || ''),
                symbol: String(order.symbol || ''),
                side: (String(order.side) || 'buy') as 'buy' | 'sell',
                type: (String(order.type).toUpperCase() || 'MARKET') as 'MARKET' | 'LIMIT' | 'STOP_LOSS',
                quantity: Number(order.amount) || 0,
                filledQuantity: Number(order.filled) || 0,
                price: Number(order.price) || 0,
                averagePrice: Number(order.average) || 0,
                status: this.mapOrderStatus(String(order.status)),
                timestamp: Number(order.timestamp) || Date.now(),
            };

            // STEP 5: Save order to database
            await this.orderRepo.save({
                symbol: orderResult.symbol,
                side: orderResult.side,
                type: orderResult.type,
                quantity: orderResult.quantity,
                filledQuantity: orderResult.filledQuantity,
                price: orderResult.price,
                averagePrice: orderResult.averagePrice,
                status: orderResult.status,
                timestamp: orderResult.timestamp,
                exchangeOrderId: orderResult.id,
            });

            // STEP 6: Check for slippage
            if (orderResult.averagePrice > 0 && orderResult.price > 0) {
                const slippage = Math.abs(orderResult.averagePrice - orderResult.price) / orderResult.price;
                if (slippage > 0.005) { // 0.5% slippage threshold
                    this.logger.warn(
                        `[SLIPPAGE] Slippage tinggi: ${(slippage * 100).toFixed(2)}% ` +
                        `(Request: ${orderResult.price}, Fill: ${orderResult.averagePrice})`
                    );
                }
            }

            // STEP 7: Handle partial fills
            if (orderResult.status === 'PARTIALLY_FILLED') {
                this.logger.warn(
                    `[PARTIAL-FILL] Order ${orderResult.id} hanya terisi ` +
                    `${orderResult.filledQuantity}/${orderResult.quantity}`
                );
            }

            this.logger.log(
                `[SUKSES] Order ID: ${orderResult.id} | ` +
                `Harga Rata-rata: ${orderResult.averagePrice || 'Market'} | ` +
                `Status: ${orderResult.status} | ` +
                `Terisi: ${orderResult.filledQuantity}/${orderResult.quantity}`
            );

            this.eventEmitter.emit(MARKET_EVENTS.ORDER_FILLED, orderResult);
            return orderResult;

        } catch (error) {
            this.logger.error(`[GAGAL] Order ${side.toUpperCase()} ${amount} ${symbol} ditolak: ${error.message}`);
            
            // Save failed order to database
            try {
                await this.orderRepo.save({
                    symbol,
                    side,
                    type: 'MARKET',
                    quantity: amount,
                    filledQuantity: 0,
                    price: 0,
                    averagePrice: 0,
                    status: 'REJECTED',
                    timestamp: Date.now(),
                    errorMessage: error.message,
                });
            } catch (dbError) {
                this.logger.error(`[DB] Gagal menyimpan order gagal: ${dbError.message}`);
            }

            this.eventEmitter.emit(MARKET_EVENTS.ORDER_REJECTED, {
                symbol,
                side,
                amount,
                error: error.message,
                timestamp: Date.now(),
            });

            return null;
        }
    }

    /**
     * Get current price for a symbol
     */
    private async getCurrentPrice(symbol: string): Promise<number> {
        try {
            const ticker = await this.exchange.fetchTicker(symbol);
            return ticker.last || 0;
        } catch {
            return 0;
        }
    }

    /**
     * Map ccxt order status to our standard status
     */
    private mapOrderStatus(status: string): OrderResult['status'] {
        switch (status) {
            case 'open': return 'NEW';
            case 'closed': return 'FILLED';
            case 'canceled': return 'CANCELED';
            case 'expired': return 'EXPIRED';
            case 'rejected': return 'REJECTED';
            default: return 'NEW';
        }
    }

    /**
     * Cancel an open order
     */
    async cancelOrder(orderId: string, symbol: string): Promise<boolean> {
        try {
            await this.exchange.cancelOrder(orderId, symbol);
            this.logger.log(`[CANCEL] Order ${orderId} untuk ${symbol} dibatalkan.`);
            return true;
        } catch (error) {
            this.logger.error(`[CANCEL] Gagal membatalkan order ${orderId}: ${error.message}`);
            return false;
        }
    }

    /**
     * Close an existing LONG by market-selling the given quantity.
     * Quantity must be > 0 — never call with 0 (order is rejected by validation).
     */
    async closePosition(symbol: string, quantity: number): Promise<OrderResult | null> {
        if (quantity <= 0) {
            this.logger.error(
                `[CLOSE-POSITION] Quantity tidak valid untuk ${symbol}: ${quantity}`,
            );
            return null;
        }
        this.logger.log(
            `[CLOSE-POSITION] Menutup posisi ${symbol} dengan market sell qty=${quantity}...`,
        );
        return this.executeMarketOrder(symbol, 'sell', quantity);
    }

    /**
     * Fetch order status from exchange
     */
    async fetchOrderStatus(orderId: string, symbol: string): Promise<OrderResult | null> {
        try {
            const order = await this.exchange.fetchOrder(orderId, symbol);
            return {
                id: String(order.id || ''),
                symbol: String(order.symbol || ''),
                side: (String(order.side) || 'buy') as 'buy' | 'sell',
                type: (String(order.type).toUpperCase() || 'MARKET') as 'MARKET' | 'LIMIT' | 'STOP_LOSS',
                quantity: Number(order.amount) || 0,
                filledQuantity: Number(order.filled) || 0,
                price: Number(order.price) || 0,
                averagePrice: Number(order.average) || 0,
                status: this.mapOrderStatus(String(order.status)),
                timestamp: Number(order.timestamp) || Date.now(),
            };
        } catch (error) {
            this.logger.error(`[FETCH] Gagal mengambil status order ${orderId}: ${error.message}`);
            return null;
        }
    }
}
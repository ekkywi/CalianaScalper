// apps/backend/src/infrastructure/exchange/binance-execution.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as ccxt from 'ccxt';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
    MARKET_EVENTS,
    OrderResult,
    AccountBalance,
    TradingMode,
} from '../../core/domain/market.types';
import { OrderEntity } from '../database/order.entity';

export type ExchangeOrderView = {
    id: string;
    symbol: string;
    side: 'buy' | 'sell';
    type: string;
    status: OrderResult['status'];
    price: number;
    amount: number;
    filled: number;
    remaining: number;
    timestamp: number;
};

@Injectable()
export class BinanceExecutionService {
    private readonly logger = new Logger(BinanceExecutionService.name);
    private exchange: ccxt.binance;
    private mode: TradingMode = 'paper';

    constructor(
        private configService: ConfigService,
        private readonly eventEmitter: EventEmitter2,
        @InjectRepository(OrderEntity)
        private readonly orderRepo: Repository<OrderEntity>,
    ) {
        this.mode = this.resolveDefaultMode();
        this.exchange = this.buildExchange(this.mode);
        this.logger.log(
            `[MODE] Boot exchange client in ${this.mode.toUpperCase()} ` +
            `(sandbox=${this.mode === 'paper'})`,
        );
    }

    getMode(): TradingMode {
        return this.mode;
    }

    /** True when env allows live and mainnet keys are present. */
    isLiveAllowed(): boolean {
        return this.getLiveBlockReason() === null;
    }

    getLiveBlockReason(): string | null {
        const allow = String(
            this.configService.get('ALLOW_LIVE_TRADING') ?? 'false',
        ).toLowerCase();
        if (allow !== 'true' && allow !== '1' && allow !== 'yes') {
            return 'ALLOW_LIVE_TRADING is not enabled';
        }
        const { apiKey, secret } = this.resolveCredentials('live');
        if (!apiKey || !secret) {
            return 'BINANCE_MAINNET_API_KEY/SECRET not configured';
        }
        return null;
    }

    /**
     * Rebuild the ccxt client for the given mode.
     * Caller must enforce safety gates (flat book, confirm, etc.).
     */
    applyMode(mode: TradingMode): void {
        if (mode === 'live') {
            const reason = this.getLiveBlockReason();
            if (reason) {
                throw new Error(`Live trading blocked: ${reason}`);
            }
        }
        if (mode === this.mode && this.exchange) {
            return;
        }
        this.mode = mode;
        this.exchange = this.buildExchange(mode);
        this.logger.log(
            `[MODE] Exchange client switched to ${mode.toUpperCase()} ` +
            `(sandbox=${mode === 'paper'})`,
        );
    }

    private resolveDefaultMode(): TradingMode {
        const raw = String(
            this.configService.get('TRADING_MODE_DEFAULT') ?? 'paper',
        ).toLowerCase();
        if (raw === 'live' && this.isLiveAllowed()) {
            return 'live';
        }
        return 'paper';
    }

    private resolveCredentials(mode: TradingMode): { apiKey: string; secret: string } {
        if (mode === 'live') {
            return {
                apiKey: String(this.configService.get('BINANCE_MAINNET_API_KEY') || ''),
                secret: String(this.configService.get('BINANCE_MAINNET_API_SECRET') || ''),
            };
        }
        // Paper / testnet — prefer dedicated keys, fall back to legacy BINANCE_API_*
        const testnetKey = String(
            this.configService.get('BINANCE_TESTNET_API_KEY') ||
                this.configService.get('BINANCE_API_KEY') ||
                '',
        );
        const testnetSecret = String(
            this.configService.get('BINANCE_TESTNET_API_SECRET') ||
                this.configService.get('BINANCE_API_SECRET') ||
                '',
        );
        return { apiKey: testnetKey, secret: testnetSecret };
    }

    private buildExchange(mode: TradingMode): ccxt.binance {
        const { apiKey, secret } = this.resolveCredentials(mode);
        const exchange = new ccxt.binance({
            apiKey,
            secret,
            enableRateLimit: true,
            options: {
                defaultType: 'spot',
                fetchOpenOrders: { warnWithoutSymbol: false },
            },
        });
        exchange.setSandboxMode(mode === 'paper');
        return exchange;
    }

    private venueLabel(): string {
        return this.mode === 'paper' ? 'Paper/Testnet' : 'LIVE/Mainnet';
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
            if (amount <= 0) {
                this.logger.error(`[EKSEKUSI] Jumlah order tidak valid: ${amount}`);
                return null;
            }

            const requiredAsset = side === 'buy' ? 'USDT' : symbol.replace('USDT', '');
            const balance = await this.getBalance(requiredAsset);

            if (!balance) {
                this.logger.error(`[EKSEKUSI] Gagal mendapatkan saldo untuk ${requiredAsset}`);
                return null;
            }

            if (side === 'buy') {
                const estimatedCost = amount * (await this.getCurrentPrice(symbol));
                if (balance.free < estimatedCost) {
                    this.logger.error(
                        `[EKSEKUSI] Saldo ${requiredAsset} tidak cukup. ` +
                        `Butuh ~${estimatedCost.toFixed(2)}, tersedia ${balance.free.toFixed(2)}`,
                    );
                    return null;
                }
            } else {
                if (balance.free < amount) {
                    this.logger.error(
                        `[EKSEKUSI] Saldo ${requiredAsset} tidak cukup. ` +
                        `Butuh ${amount}, tersedia ${balance.free}`,
                    );
                    return null;
                }
            }

            this.logger.log(
                `[EKSEKUSI] Mengirim Market ${side.toUpperCase()} untuk ${amount} ${symbol} ` +
                `ke ${this.venueLabel()}...`,
            );

            const order = await this.exchange.createMarketOrder(symbol, side, amount, undefined, {
                newOrderRespType: 'FULL',
            });

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

            if (orderResult.averagePrice > 0 && orderResult.price > 0) {
                const slippage =
                    Math.abs(orderResult.averagePrice - orderResult.price) / orderResult.price;
                if (slippage > 0.005) {
                    this.logger.warn(
                        `[SLIPPAGE] Slippage tinggi: ${(slippage * 100).toFixed(2)}% ` +
                        `(Request: ${orderResult.price}, Fill: ${orderResult.averagePrice})`,
                    );
                }
            }

            if (orderResult.status === 'PARTIALLY_FILLED') {
                this.logger.warn(
                    `[PARTIAL-FILL] Order ${orderResult.id} hanya terisi ` +
                    `${orderResult.filledQuantity}/${orderResult.quantity}`,
                );
            }

            this.logger.log(
                `[SUKSES] Order ID: ${orderResult.id} | ` +
                `Harga Rata-rata: ${orderResult.averagePrice || 'Market'} | ` +
                `Status: ${orderResult.status} | ` +
                `Terisi: ${orderResult.filledQuantity}/${orderResult.quantity}`,
            );

            this.eventEmitter.emit(MARKET_EVENTS.ORDER_FILLED, orderResult);
            return orderResult;
        } catch (error) {
            this.logger.error(
                `[GAGAL] Order ${side.toUpperCase()} ${amount} ${symbol} ditolak: ${error.message}`,
            );

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

    async getLastPrice(symbol: string): Promise<number> {
        return this.getCurrentPrice(symbol);
    }

    private async getCurrentPrice(symbol: string): Promise<number> {
        try {
            const ticker = await this.exchange.fetchTicker(symbol);
            return ticker.last || 0;
        } catch {
            return 0;
        }
    }

    private mapOrderStatus(status: string): OrderResult['status'] {
        switch (status) {
            case 'open':
                return 'NEW';
            case 'closed':
                return 'FILLED';
            case 'canceled':
                return 'CANCELED';
            case 'expired':
                return 'EXPIRED';
            case 'rejected':
                return 'REJECTED';
            default:
                return 'NEW';
        }
    }

    async cancelOrder(orderId: string, symbol: string): Promise<boolean> {
        try {
            const ccxtSymbol = this.toCcxtSymbol(symbol);
            await this.exchange.cancelOrder(orderId, ccxtSymbol);
            this.logger.log(`[CANCEL] Order ${orderId} untuk ${ccxtSymbol} dibatalkan.`);
            return true;
        } catch (error) {
            this.logger.error(`[CANCEL] Gagal membatalkan order ${orderId}: ${error.message}`);
            return false;
        }
    }

    async executeLimitOrder(
        symbol: string,
        side: 'buy' | 'sell',
        amount: number,
        price: number,
    ): Promise<OrderResult | null> {
        try {
            if (amount <= 0 || price <= 0) {
                this.logger.error(
                    `[EKSEKUSI] Limit order invalid amount=${amount} price=${price}`,
                );
                return null;
            }

            const requiredAsset = side === 'buy' ? 'USDT' : symbol.replace('USDT', '');
            const balance = await this.getBalance(requiredAsset);
            if (!balance) {
                this.logger.error(`[EKSEKUSI] Gagal mendapatkan saldo untuk ${requiredAsset}`);
                return null;
            }

            if (side === 'buy') {
                const estimatedCost = amount * price;
                if (balance.free < estimatedCost) {
                    this.logger.error(
                        `[EKSEKUSI] Saldo USDT tidak cukup untuk LIMIT BUY. ` +
                        `Butuh ~${estimatedCost}, tersedia ${balance.free}`,
                    );
                    return null;
                }
            } else if (balance.free < amount) {
                this.logger.error(
                    `[EKSEKUSI] Saldo ${requiredAsset} tidak cukup untuk LIMIT SELL`,
                );
                return null;
            }

            this.logger.log(
                `[EKSEKUSI] Mengirim Limit ${side.toUpperCase()} ${amount} ${symbol} @ ${price} ` +
                `ke ${this.venueLabel()}`,
            );

            const order = await this.exchange.createLimitOrder(symbol, side, amount, price);

            const orderResult: OrderResult = {
                id: String(order.id || ''),
                symbol: String(order.symbol || symbol),
                side: (String(order.side) || side) as 'buy' | 'sell',
                type: 'LIMIT',
                quantity: Number(order.amount) || amount,
                filledQuantity: Number(order.filled) || 0,
                price: Number(order.price) || price,
                averagePrice: Number(order.average) || 0,
                status: this.mapOrderStatus(String(order.status)),
                timestamp: Number(order.timestamp) || Date.now(),
            };

            await this.orderRepo.save({
                symbol: orderResult.symbol.includes('/')
                    ? symbol
                    : orderResult.symbol,
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

            if (orderResult.status === 'FILLED') {
                this.eventEmitter.emit(MARKET_EVENTS.ORDER_FILLED, orderResult);
            }

            return orderResult;
        } catch (error) {
            this.logger.error(
                `[GAGAL] Limit ${side.toUpperCase()} ${amount} ${symbol}: ${error.message}`,
            );
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

    async fetchOrderStatus(orderId: string, symbol: string): Promise<OrderResult | null> {
        try {
            const order = await this.exchange.fetchOrder(orderId, symbol);
            return this.mapCcxtOrder(order);
        } catch (error) {
            this.logger.error(`[FETCH] Gagal mengambil status order ${orderId}: ${error.message}`);
            return null;
        }
    }

    async fetchOpenOrders(symbol?: string): Promise<ExchangeOrderView[]> {
        try {
            const ccxtSymbol = symbol ? this.toCcxtSymbol(symbol) : undefined;
            const orders = ccxtSymbol
                ? await this.exchange.fetchOpenOrders(ccxtSymbol)
                : await this.exchange.fetchOpenOrders();
            return orders.map((o) => this.toExchangeOrderView(o));
        } catch (error) {
            this.logger.error(`[OPEN-ORDERS] Gagal: ${error.message}`);
            throw error;
        }
    }

    async fetchRecentOrders(symbol?: string, limit: number = 50): Promise<ExchangeOrderView[]> {
        try {
            const ccxtSymbol = symbol ? this.toCcxtSymbol(symbol) : undefined;
            let orders: ccxt.Order[] = [];

            if (ccxtSymbol) {
                try {
                    orders = await this.exchange.fetchOrders(ccxtSymbol, undefined, limit);
                } catch {
                    const [closed, open] = await Promise.all([
                        this.exchange.fetchClosedOrders(ccxtSymbol, undefined, limit).catch(() => []),
                        this.exchange.fetchOpenOrders(ccxtSymbol).catch(() => []),
                    ]);
                    orders = [...open, ...closed];
                }
            } else {
                this.logger.warn(
                    '[RECENT-ORDERS] No symbol provided — returning empty. ' +
                    'Pass a symbol to avoid expensive symbolless exchange calls.',
                );
                return [];
            }

            return orders
                .map((o) => this.toExchangeOrderView(o))
                .sort((a, b) => b.timestamp - a.timestamp)
                .slice(0, limit);
        } catch (error) {
            this.logger.error(`[RECENT-ORDERS] Gagal: ${error.message}`);
            throw error;
        }
    }

    private toCcxtSymbol(symbol: string): string {
        const raw = symbol.toUpperCase().replace('/', '');
        if (raw.endsWith('USDT') && raw.length > 4) {
            return `${raw.slice(0, -4)}/USDT`;
        }
        return raw;
    }

    private mapCcxtOrder(order: ccxt.Order): OrderResult {
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
    }

    private toExchangeOrderView(order: ccxt.Order): ExchangeOrderView {
        const amount = Number(order.amount) || 0;
        const filled = Number(order.filled) || 0;
        const remaining =
            order.remaining != null && Number.isFinite(Number(order.remaining))
                ? Number(order.remaining)
                : Math.max(0, amount - filled);

        return {
            id: String(order.id || ''),
            symbol: String(order.symbol || '').replace('/', ''),
            side: (String(order.side) || 'buy') as 'buy' | 'sell',
            type: String(order.type || 'limit').toUpperCase(),
            status: this.mapOrderStatus(String(order.status)),
            price: Number(order.price) || 0,
            amount,
            filled,
            remaining,
            timestamp: Number(order.timestamp) || Date.now(),
        };
    }
}

// src/presentation/gateway/ui.gateway.ts

import { WebSocketGateway, WebSocketServer, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { OnEvent } from '@nestjs/event-emitter';
import { Logger } from '@nestjs/common';
import { MARKET_EVENTS, type CandleData, type Position } from '../../core/domain/market.types';

@WebSocketGateway({
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
})
export class UiGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    server: Server;

    private readonly logger = new Logger(UiGateway.name);

    handleConnection(client: Socket) {
        this.logger.log(`Frontend Terhubung: ${client.id}`);
    }

    handleDisconnect(client: Socket) {
        this.logger.log(`Frontend Terputus: ${client.id}`);
    }

    @OnEvent(MARKET_EVENTS.CANDLE_TICK)
    handleCandleTick(candle: CandleData) {
        this.server.emit('realtime-price', candle);
    }

    @OnEvent(MARKET_EVENTS.CANDLE_CLOSED)
    handleCandleClosed(candle: CandleData) {
        this.server.emit('candle-closed', candle);
    }

    @OnEvent(MARKET_EVENTS.POSITION_OPENED)
    handlePositionOpened(position: Position) {
        this.server.emit('position-opened', position);
    }

    @OnEvent(MARKET_EVENTS.POSITION_CLOSED)
    handlePositionClosed(position: Position) {
        this.server.emit('position-closed', position);
    }

    @OnEvent(MARKET_EVENTS.TRADING_HALTED)
    handleTradingHalted(event: { reason: string }) {
        this.server.emit('trading-halted', event);
    }

    @OnEvent(MARKET_EVENTS.TRADING_RESUMED)
    handleTradingResumed() {
        this.server.emit('trading-resumed', {});
    }

    @OnEvent(MARKET_EVENTS.RISK_BREACHED)
    handleRiskBreached(event: { reason: string }) {
        this.server.emit('risk-breached', event);
    }
}

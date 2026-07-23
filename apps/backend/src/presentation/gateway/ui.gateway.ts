// src/presentasion/gateway/ui.gateway.ts

import { WebSocketGateway, WebSocketServer, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { OnEvent } from '@nestjs/event-emitter';
import { Logger } from '@nestjs/common';
import { MARKET_EVENTS, type CandleData } from '../../core/domain/market.types';

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
}
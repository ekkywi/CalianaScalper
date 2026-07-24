// apps/frontend/src/components/RealtimeDisplay.tsx

"use client";

import { useEffect, useState } from "react";
import { io, Socket } from "socket.io-client";

interface CandleData {
  symbol: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isClosed: boolean;
}

export default function RealtimeDisplay() {
  const [priceData, setPriceData] = useState<CandleData | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const socket: Socket = io("http://127.0.0.1:3001", {
      transports: ['websocket'],
    });

    socket.on("connect", () => {
      setIsConnected(true);
    });

    socket.on("disconnect", () => {
      setIsConnected(false);
    });

    socket.on("realtime-price", (data: CandleData) => {
      setPriceData(data);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  return (
    <div className="p-6 max-w-md mx-auto bg-gray-900 text-white rounded-xl shadow-md space-y-4 border border-gray-700">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold tracking-wider text-gray-400">
          {priceData?.symbol || "MENUNGGU DATA..."}
        </h2>
        <span className={`px-2 py-1 text-xs font-semibold rounded-full ${isConnected ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
          {isConnected ? "TERHUBUNG" : "TERPUTUS"}
        </span>
      </div>

      <div className="text-4xl font-mono font-bold tracking-tighter">
        {priceData ? `$${priceData.close.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : "$0.00"}
      </div>

      <div className="grid grid-cols-2 gap-4 text-sm text-gray-400">
        <div>
          <p>24h High</p>
          <p className="font-mono text-white">{priceData?.high ? `$${priceData.high}` : "-"}</p>
        </div>
        <div>
          <p>24h Low</p>
          <p className="font-mono text-white">{priceData?.low ? `$${priceData.low}` : "-"}</p>
        </div>
      </div>
    </div>
  );
}
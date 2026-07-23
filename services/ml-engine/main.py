from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import pandas as pd
import xgboost as xgb

app = FastAPI(title="Caliana Scalper ML Engine")

class CandleData(BaseModel):
    symbol: str
    startTime: int
    closeTime: int
    open: float
    high: float
    low: float
    close: float
    volume: float
    isClosed: bool

@app.post("/predict")
async def predict_signal(candle: CandleData):
    if not candle.isClosed:
        raise HTTPException(status_code=400, detail="Hanya memproses candle yang sudah tertutup")

    df = pd.DataFrame([{
        "open": candle.open,
        "high": candle.high,
        "low": candle.low,
        "close": candle.close,
        "volume": candle.volume
    }])

    df['body_size'] = (df['close'] - df['open']) / df['open']
    df['high_wick'] = (df['high'] - df[['open', 'close']].max(axis=1)) / df['open']
    df['low_wick'] = (df[['open', 'close']].min(axis=1) - df['low']) / df['open']
    
    is_bullish_momentum = df['body_size'].iloc[0] > 0.001
    
    confidence = 0.85 if is_bullish_momentum else 0.40
    signal = "BUY" if is_bullish_momentum else "HOLD"

    return {
        "symbol": candle.symbol,
        "timestamp": candle.closeTime,
        "signal": signal,
        "confidence": confidence,
        "target_profit_pct": 0.004,
        "stop_loss_pct": 0.002
    }

@app.get("/health")
def health_check():
    return {"status": "ML Engine Aktif"}
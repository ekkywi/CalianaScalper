# services/ml-engine/main.py

import logging
import os
import pickle
import asyncio
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Optional
from fastapi import FastAPI, HTTPException, BackgroundTasks
from pydantic import BaseModel
import pandas as pd
import numpy as np
from xgboost import XGBClassifier

from database import fetch_historical_candles
from features import build_features, add_target_variable

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Model persistence directory
MODEL_DIR = os.path.join(os.path.dirname(__file__), "models")
os.makedirs(MODEL_DIR, exist_ok=True)

# ============================================================
# Application State
# ============================================================
app_state = {
    "models": {},       # Format: {"BTCUSDT": XGBClassifier()}
    "buffers": {},      # Format: {"BTCUSDT": DataFrame}
    "training_status": {},  # Format: {"BTCUSDT": "idle" | "training" | "ready" | "error"}
    "feature_cols": [
        # Momentum
        "feature_rsi_14", "feature_rsi_7", "feature_stoch_rsi",
        # Trend
        "feature_macd", "feature_macd_signal", "feature_macd_diff",
        "feature_macd_roc", "feature_price_to_sma20", "feature_price_to_ema12",
        "feature_sma_cross", "feature_ema_cross",
        # Volatility
        "feature_bb_width", "feature_bb_percent", "feature_bb_position",
        "feature_atr_percent",
        # Price Action
        "feature_return_1", "feature_return_3", "feature_return_5",
        "feature_return_10", "feature_log_return_1",
        "feature_body_size", "feature_upper_wick", "feature_lower_wick",
        "feature_range", "feature_volume_ratio", "feature_volume_change",
    ]
}

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

class PredictionResponse(BaseModel):
    symbol: str
    signal: str
    confidence: float
    timestamp: int
    model_ready: bool = True

# ============================================================
# Model Persistence
# ============================================================

def get_model_path(symbol: str) -> str:
    return os.path.join(MODEL_DIR, f"{symbol}_model.pkl")

def get_buffer_path(symbol: str) -> str:
    return os.path.join(MODEL_DIR, f"{symbol}_buffer.pkl")

def save_model_to_disk(symbol: str):
    """Save model and buffer to disk for persistence across restarts."""
    try:
        if symbol in app_state["models"]:
            with open(get_model_path(symbol), "wb") as f:
                pickle.dump(app_state["models"][symbol], f)
            logger.info(f"[PERSISTENCE] Model {symbol} disimpan ke disk.")
        
        if symbol in app_state["buffers"]:
            with open(get_buffer_path(symbol), "wb") as f:
                pickle.dump(app_state["buffers"][symbol], f)
            logger.info(f"[PERSISTENCE] Buffer {symbol} disimpan ke disk.")
    except Exception as e:
        logger.error(f"[PERSISTENCE] Gagal menyimpan {symbol}: {e}")

def load_model_from_disk(symbol: str) -> bool:
    """Load model and buffer from disk if available."""
    try:
        model_path = get_model_path(symbol)
        buffer_path = get_buffer_path(symbol)
        
        if os.path.exists(model_path) and os.path.exists(buffer_path):
            with open(model_path, "rb") as f:
                app_state["models"][symbol] = pickle.load(f)
            with open(buffer_path, "rb") as f:
                app_state["buffers"][symbol] = pickle.load(f)
            app_state["training_status"][symbol] = "ready"
            logger.info(f"[PERSISTENCE] Model {symbol} dimuat dari disk.")
            return True
    except Exception as e:
        logger.error(f"[PERSISTENCE] Gagal memuat {symbol}: {e}")
    
    return False

# ============================================================
# Training Function
# ============================================================

def train_symbol_model(symbol: str):
    """Fungsi mandiri untuk melatih model berdasarkan simbol secara on-the-fly."""
    logger.info(f"[TRAINING] Memulai proses penarikan data dan training untuk {symbol}...")
    
    app_state["training_status"][symbol] = "training"
    
    try:
        # Tarik data historis (gunakan 2000 candle untuk training yang lebih stabil)
        df_raw = fetch_historical_candles(symbol, limit=2000)
        
        if df_raw.empty:
            raise ValueError(f"Database kosong untuk {symbol}. Lakukan backfill di NestJS terlebih dahulu.")

        # Simpan 100 candle terakhir ke buffer khusus simbol ini
        app_state["buffers"][symbol] = df_raw.tail(100).copy().reset_index(drop=True)

        # Kalkulasi fitur dan target
        df_features = build_features(df_raw)
        df_target = add_target_variable(df_features, forward_periods=1, min_return=0.005)
        train_data = df_target.dropna().copy()

        if train_data.empty:
            raise ValueError(f"Data valid kosong setelah ekstraksi fitur untuk {symbol}.")

        # Use binary target for XGBoost (binary classification)
        X = train_data[app_state["feature_cols"]]
        y = train_data["target_binary"]

        # Handle class imbalance with scale_pos_weight
        neg_count = len(y[y == 0])
        pos_count = len(y[y == 1])
        scale_pos_weight = neg_count / max(pos_count, 1)

        logger.info(
            f"[TRAINING] Melatih XGBoost {symbol} dengan {len(X)} baris data. "
            f"Class ratio: {pos_count}/{neg_count} (scale={scale_pos_weight:.2f})"
        )

        model = XGBClassifier(
            n_estimators=200,
            learning_rate=0.03,
            max_depth=5,
            min_child_weight=3,
            subsample=0.8,
            colsample_bytree=0.8,
            scale_pos_weight=scale_pos_weight,
            random_state=42,
            eval_metric="logloss",
            early_stopping_rounds=20,
        )

        # Split for validation
        split_idx = int(len(X) * 0.8)
        X_train, X_val = X.iloc[:split_idx], X.iloc[split_idx:]
        y_train, y_val = y.iloc[:split_idx], y.iloc[split_idx:]

        model.fit(
            X_train, y_train,
            eval_set=[(X_val, y_val)],
            verbose=False,
        )

        # Simpan ke memori
        app_state["models"][symbol] = model
        app_state["training_status"][symbol] = "ready"

        # Simpan ke disk
        save_model_to_disk(symbol)

        # Log validation performance
        val_preds = model.predict(X_val)
        val_accuracy = (val_preds == y_val).mean()
        logger.info(
            f"[TRAINING] Selesai. Model {symbol} siap digunakan. "
            f"Validation accuracy: {val_accuracy:.4f}"
        )

    except Exception as e:
        app_state["training_status"][symbol] = "error"
        logger.error(f"[TRAINING] Gagal melatih {symbol}: {str(e)}")
        raise

# ============================================================
# FastAPI App
# ============================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Dieksekusi sekali saat server menyala (Startup)"""
    logger.info("[STARTUP] Memulai inisialisasi ML Engine...")
    
    # Try to load all saved models from disk
    model_files = [f.replace("_model.pkl", "") for f in os.listdir(MODEL_DIR) if f.endswith("_model.pkl")]
    for symbol in model_files:
        load_model_from_disk(symbol)
    
    logger.info(f"[STARTUP] ML Engine siap. {len(app_state['models'])} model dimuat dari disk.")
    yield
    
    # Save all models on shutdown
    logger.info("[SHUTDOWN] Menyimpan semua model ke disk...")
    for symbol in list(app_state["models"].keys()):
        save_model_to_disk(symbol)
    logger.info("[SHUTDOWN] Mematikan ML Engine.")

app = FastAPI(lifespan=lifespan)

# ============================================================
# Endpoints
# ============================================================

@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "models_loaded": len(app_state["models"]),
        "symbols": list(app_state["models"].keys()),
        "training_status": app_state["training_status"],
        "timestamp": datetime.now().isoformat(),
    }

@app.post("/train/{symbol}")
async def force_train(symbol: str, background_tasks: BackgroundTasks):
    """Endpoint untuk memaksa pelatihan ulang model suatu simbol secara async."""
    symbol = symbol.upper()
    
    if app_state["training_status"].get(symbol) == "training":
        raise HTTPException(status_code=409, detail=f"Model {symbol} sedang dalam proses training.")
    
    # Run training in background to not block the response
    background_tasks.add_task(train_symbol_model, symbol)
    
    return {
        "status": "training_started",
        "message": f"Training model {symbol} dimulai di background.",
        "symbol": symbol,
    }

@app.post("/predict", response_model=PredictionResponse)
async def predict_signal(candle: CandleData):
    symbol = candle.symbol.upper()

    # LAZY LOADING: Jika model belum ada di RAM, coba load dari disk
    if symbol not in app_state["models"] or symbol not in app_state["buffers"]:
        if not load_model_from_disk(symbol):
            # If not on disk either, train on-demand
            logger.warning(f"[INFERENSI] Model {symbol} belum ada. Memulai On-Demand Training...")
            try:
                train_symbol_model(symbol)
            except Exception as e:
                raise HTTPException(
                    status_code=503, 
                    detail=f"Gagal menyiapkan model {symbol}: {str(e)}"
                )

    # Check if model is ready
    if app_state["training_status"].get(symbol) != "ready":
        raise HTTPException(
            status_code=503,
            detail=f"Model {symbol} belum siap (status: {app_state['training_status'].get(symbol, 'unknown')})."
        )

    model = app_state["models"][symbol]
    buffer = app_state["buffers"][symbol]

    # Create new row from incoming candle
    new_row = pd.DataFrame([{
        "startTime": candle.startTime,
        "closeTime": candle.closeTime,
        "open": candle.open,
        "high": candle.high,
        "low": candle.low,
        "close": candle.close,
        "volume": candle.volume
    }])

    # Update buffer khusus simbol ini (sliding window of 100)
    buffer = pd.concat([buffer, new_row], ignore_index=True)
    buffer = buffer.tail(100).reset_index(drop=True)
    app_state["buffers"][symbol] = buffer

    # Build features from buffer
    df_features = build_features(buffer)
    
    if df_features.empty:
        raise HTTPException(status_code=500, detail=f"Gagal mengkalkulasi fitur untuk {symbol}.")

    # Get the latest feature vector
    latest_features = df_features.iloc[-1:][app_state["feature_cols"]]

    # Predict probability
    probabilities = model.predict_proba(latest_features)[0]
    
    # Handle case where model only has 1 class
    if len(probabilities) == 1:
        prob_up = float(probabilities[0])
    else:
        prob_up = float(probabilities[1])

    # Dynamic threshold based on market volatility
    # Use ATR from features if available
    atr_percent = df_features["feature_atr_percent"].iloc[-1] if "feature_atr_percent" in df_features.columns else 0
    
    # Adjust thresholds: wider thresholds in high volatility
    volatility_multiplier = min(max(atr_percent / 2, 0.5), 2.0)
    THRESHOLD_BUY = 0.55 + (0.10 * volatility_multiplier)  # 0.60 - 0.75
    THRESHOLD_SELL = 0.45 - (0.10 * volatility_multiplier)  # 0.25 - 0.40

    if prob_up >= THRESHOLD_BUY:
        signal = "BUY"
        confidence = prob_up
    elif prob_up <= THRESHOLD_SELL:
        signal = "SELL"
        confidence = 1.0 - prob_up
    else:
        signal = "HOLD"
        confidence = max(prob_up, 1.0 - prob_up)

    logger.info(
        f"[PREDIKSI] {symbol} | Sinyal: {signal} | "
        f"Keyakinan: {confidence:.4f} | "
        f"Prob UP: {prob_up:.4f} | "
        f"Threshold: BUY>{THRESHOLD_BUY:.2f} SELL<{THRESHOLD_SELL:.2f} | "
        f"ATR%: {atr_percent:.2f}%"
    )

    return PredictionResponse(
        symbol=symbol,
        signal=signal,
        confidence=confidence,
        timestamp=candle.closeTime,
        model_ready=True,
    )

@app.get("/model/{symbol}/info")
async def get_model_info(symbol: str):
    """Get information about a trained model."""
    symbol = symbol.upper()
    
    if symbol not in app_state["models"]:
        raise HTTPException(status_code=404, detail=f"Model {symbol} tidak ditemukan.")
    
    model = app_state["models"][symbol]
    buffer = app_state["buffers"].get(symbol, pd.DataFrame())
    
    return {
        "symbol": symbol,
        "status": app_state["training_status"].get(symbol, "unknown"),
        "buffer_size": len(buffer),
        "buffer_start_time": int(buffer["closeTime"].iloc[0]) if not buffer.empty else None,
        "buffer_end_time": int(buffer["closeTime"].iloc[-1]) if not buffer.empty else None,
        "model_type": type(model).__name__,
        "feature_count": len(app_state["feature_cols"]),
    }
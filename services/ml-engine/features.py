# services/ml-engine/features.py

import pandas as pd
import numpy as np
from ta.momentum import RSIIndicator
from ta.trend import MACD, SMAIndicator, EMAIndicator
from ta.volatility import BollingerBands, AverageTrueRange
from ta.volume import VolumeWeightedAveragePrice
import logging

logger = logging.getLogger(__name__)

def build_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Mengubah data mentah OHLCV menjadi matriks fitur indikator teknikal yang komprehensif.
    Menghindari look-ahead bias dengan hanya menggunakan data yang tersedia saat itu.
    """

    if df.empty:
        logger.warning("DataFrame kosong, tidak bisa memuat fitur.")
        return df
    
    data = df.copy()

    try:
        # ============================================================
        # 1. MOMENTUM INDICATORS
        # ============================================================
        
        # RSI (Relative Strength Index) - 14 periode
        rsi = RSIIndicator(close=data["close"], window=14)
        data["feature_rsi_14"] = rsi.rsi()
        
        # RSI dengan periode berbeda untuk konfirmasi
        rsi_7 = RSIIndicator(close=data["close"], window=7)
        data["feature_rsi_7"] = rsi_7.rsi()
        
        # Stochastic RSI
        rsi_val = data["feature_rsi_14"]
        rsi_min = rsi_val.rolling(window=14).min()
        rsi_max = rsi_val.rolling(window=14).max()
        data["feature_stoch_rsi"] = ((rsi_val - rsi_min) / (rsi_max - rsi_min)) * 100

        # ============================================================
        # 2. TREND INDICATORS
        # ============================================================
        
        # MACD
        macd = MACD(close=data["close"])
        data["feature_macd"] = macd.macd()
        data["feature_macd_signal"] = macd.macd_signal()
        data["feature_macd_diff"] = macd.macd_diff()
        
        # MACD Histogram rate of change (momentum of momentum)
        data["feature_macd_roc"] = data["feature_macd_diff"].pct_change(periods=3)
        
        # Moving Averages
        data["feature_sma_20"] = SMAIndicator(close=data["close"], window=20).sma_indicator()
        data["feature_sma_50"] = SMAIndicator(close=data["close"], window=50).sma_indicator()
        data["feature_ema_12"] = EMAIndicator(close=data["close"], window=12).ema_indicator()
        data["feature_ema_26"] = EMAIndicator(close=data["close"], window=26).ema_indicator()
        
        # Price relative to MA (mean reversion signal)
        data["feature_price_to_sma20"] = data["close"] / data["feature_sma_20"] - 1
        data["feature_price_to_ema12"] = data["close"] / data["feature_ema_12"] - 1
        
        # MA Crossovers
        data["feature_sma_cross"] = data["feature_sma_20"] - data["feature_sma_50"]
        data["feature_ema_cross"] = data["feature_ema_12"] - data["feature_ema_26"]

        # ============================================================
        # 3. VOLATILITY INDICATORS
        # ============================================================
        
        # Bollinger Bands
        bb = BollingerBands(close=data["close"], window=20, window_dev=2)
        data["feature_bb_width"] = bb.bollinger_wband()
        data["feature_bb_percent"] = bb.bollinger_pband()
        data["feature_bb_position"] = (data["close"] - bb.bollinger_lband()) / (bb.bollinger_hband() - bb.bollinger_lband())
        
        # ATR (Average True Range) - normalized by price
        atr = AverageTrueRange(high=data["high"], low=data["low"], close=data["close"], window=14)
        data["feature_atr"] = atr.average_true_range()
        data["feature_atr_percent"] = data["feature_atr"] / data["close"] * 100

        # ============================================================
        # 4. PRICE ACTION FEATURES
        # ============================================================
        
        # Returns
        data["feature_return_1"] = data["close"].pct_change(periods=1)
        data["feature_return_3"] = data["close"].pct_change(periods=3)
        data["feature_return_5"] = data["close"].pct_change(periods=5)
        data["feature_return_10"] = data["close"].pct_change(periods=10)
        
        # Log returns for normality
        data["feature_log_return_1"] = np.log(data["close"] / data["close"].shift(1))
        
        # Candle body and wick patterns
        data["feature_body_size"] = abs(data["close"] - data["open"]) / (data["high"] - data["low"] + 1e-10)
        data["feature_upper_wick"] = (data["high"] - data[["open", "close"]].max(axis=1)) / (data["high"] - data["low"] + 1e-10)
        data["feature_lower_wick"] = (data[["open", "close"]].min(axis=1) - data["low"]) / (data["high"] - data["low"] + 1e-10)
        
        # Price range
        data["feature_range"] = (data["high"] - data["low"]) / data["close"]
        
        # Volume features
        data["feature_volume_ratio"] = data["volume"] / data["volume"].rolling(window=20).mean()
        data["feature_volume_change"] = data["volume"].pct_change(periods=1)

        # ============================================================
        # 5. CLEAN UP
        # ============================================================
        
        # Drop infinite values
        data = data.replace([np.inf, -np.inf], np.nan)
        
        # Drop NaN rows (from rolling calculations)
        data = data.dropna().reset_index(drop=True)

        logger.info(f"Fitur berhasil dibuat: {len(data)} baris, {len([c for c in data.columns if c.startswith('feature_')])} fitur")
        return data
        
    except Exception as e:
        logger.error(f"Gagal melakukan feature engineering: {e}")
        return pd.DataFrame()
    
def add_target_variable(df: pd.DataFrame, forward_periods: int = 1, min_return: float = 0.005) -> pd.DataFrame:
    """
    Legacy forward-return label (superseded by labeling.add_trade_outcome_label).
    Kept for reference; training uses tp_before_sl labels aligned with bot SL/TP.
    """

    data = df.copy()

    # Forward return: (close[t+forward_periods] - close[t]) / close[t]
    data["forward_return"] = data["close"].shift(-forward_periods) / data["close"] - 1

    # Multi-class target:
    # 2 = Strong Buy (return > 2%)
    # 1 = Weak Buy (return > min_return)
    # 0 = Hold / Neutral
    # -1 = Weak Sell (return < -min_return)
    # -2 = Strong Sell (return < -2%)
    
    conditions = [
        (data["forward_return"] > 0.02),           # Strong Buy
        (data["forward_return"] > min_return),      # Weak Buy
        (data["forward_return"] < -0.02),           # Strong Sell
        (data["forward_return"] < -min_return),     # Weak Sell
    ]
    choices = [2, 1, -2, -1]
    
    data["target"] = np.select(conditions, choices, default=0)
    
    # For binary classification (backward compatible):
    # 1 if price goes up significantly, 0 otherwise
    data["target_binary"] = (data["forward_return"] > min_return).astype(int)

    # Drop the last `forward_periods` rows that have NaN target
    data = data.dropna(subset=["forward_return"]).reset_index(drop=True)

    logger.info(
        f"Target variable created: "
        f"Strong Buy={len(data[data['target']==2])}, "
        f"Weak Buy={len(data[data['target']==1])}, "
        f"Hold={len(data[data['target']==0])}, "
        f"Weak Sell={len(data[data['target']==-1])}, "
        f"Strong Sell={len(data[data['target']==-2])}"
    )

    return data
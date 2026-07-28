# services/ml-engine/regime.py
"""Simple market regime detection for long-only gating (Phase 2)."""

from __future__ import annotations

from typing import Any, Dict

import pandas as pd


def _f(row: pd.Series, key: str, default: float = 0.0) -> float:
    val = row.get(key, default)
    try:
        f = float(val)
        return f if pd.notna(f) else default
    except (TypeError, ValueError):
        return default


def detect_regime(feature_row: pd.Series) -> Dict[str, Any]:
    """
    Classify current bar regime from engineered features.
    Returns allow_long, confidence_bump, and human-readable reason.
    """
    atr_pct = _f(feature_row, "feature_atr_percent")
    ema_cross = _f(feature_row, "feature_ema_cross")
    sma_cross = _f(feature_row, "feature_sma_cross")
    bb_width = _f(feature_row, "feature_bb_width")
    rsi = _f(feature_row, "feature_rsi_14", 50.0)

    confidence_bump = 0.0
    allow_long = True
    reason = "Normal conditions"

    # High volatility — avoid new longs (scalper noise)
    if atr_pct >= 3.5:
        return {
            "regime": "high_vol",
            "allow_long": False,
            "confidence_bump": 0.0,
            "reason": f"ATR {atr_pct:.2f}% too high for new longs",
        }

    # Clear downtrend — long-only cautious
    if ema_cross < 0 and sma_cross < 0 and rsi < 45:
        return {
            "regime": "downtrend",
            "allow_long": False,
            "confidence_bump": 0.0,
            "reason": "Downtrend (EMA/SMA bearish, RSI weak)",
        }

    # Elevated vol — require higher confidence
    if atr_pct >= 2.5:
        confidence_bump = max(confidence_bump, 0.05)
        reason = f"Elevated volatility (ATR {atr_pct:.2f}%)"
        regime = "elevated_vol"
    elif ema_cross > 0 and sma_cross > 0 and rsi >= 50:
        regime = "uptrend"
        reason = "Uptrend alignment"
    elif abs(_f(feature_row, "feature_price_to_sma20")) < 0.008 and bb_width < 0.05:
        regime = "range"
        confidence_bump = max(confidence_bump, 0.03)
        reason = "Range / low momentum — stricter entry"
    else:
        regime = "neutral"

    # Mild downtrend bias — bump threshold but allow
    if ema_cross < 0 and allow_long:
        confidence_bump = max(confidence_bump, 0.04)
        reason = "Weak trend — extra confidence required"

    return {
        "regime": regime,
        "allow_long": allow_long,
        "confidence_bump": float(confidence_bump),
        "reason": reason,
    }

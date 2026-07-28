# services/ml-engine/backtest.py
"""Lightweight signal backtest on holdout data (not full portfolio sim)."""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional

import numpy as np
import pandas as pd

from eval_metrics import classification_metrics
from label_config import DEFAULT_LABEL_CONFIG, LabelConfig
from labeling import _long_outcome_at_index


def _simulate_trade_return(
    highs: np.ndarray,
    lows: np.ndarray,
    closes: np.ndarray,
    entry_idx: int,
    entry_price: float,
    config: LabelConfig,
) -> Dict[str, Any]:
    """Return realized % move for a long entered at close (TP/SL/timeout)."""
    fee = config.round_trip_fee_percent
    sl_pct = config.stop_loss_percent
    tp_pct = config.take_profit_percent
    horizon = config.max_horizon_candles

    effective_sl = entry_price * (1 - sl_pct - fee / 2)
    effective_tp = entry_price * (1 + tp_pct - fee)

    label, bars = _long_outcome_at_index(
        highs, lows, entry_idx, effective_sl, effective_tp, horizon
    )

    if label == 1:
        exit_pct = tp_pct - fee
        outcome = "tp"
    elif bars is not None:
        exit_pct = -sl_pct - fee / 2
        outcome = "sl"
    else:
        end = min(entry_idx + horizon, len(closes) - 1)
        if end > entry_idx and np.isfinite(closes[end]):
            exit_pct = float(closes[end] / entry_price - 1 - fee / 2)
        else:
            exit_pct = -fee
        outcome = "timeout"

    return {
        "outcome": outcome,
        "return_pct": float(exit_pct),
        "bars_held": bars,
        "label_hit_tp": label == 1,
    }


def backtest_signals(
    df: pd.DataFrame,
    signal_fn: Callable[[pd.DataFrame, int], bool],
    *,
    config: LabelConfig = DEFAULT_LABEL_CONFIG,
    min_confidence: Optional[float] = None,
    confidence_series: Optional[pd.Series] = None,
) -> Dict[str, Any]:
    """
    Walk holdout rows; when signal_fn returns True (and passes min_confidence),
    simulate one long trade from that bar's close.
    """
    if df.empty:
        return {"n_trades": 0, "trades": []}

    highs = df["high"].to_numpy(dtype=float)
    lows = df["low"].to_numpy(dtype=float)
    closes = df["close"].to_numpy(dtype=float)

    trades: List[Dict[str, Any]] = []
    horizon = config.max_horizon_candles
    last_i = len(df) - horizon - 2

    for i in range(max(0, last_i + 1)):
        if not signal_fn(df, i):
            continue
        if min_confidence is not None and confidence_series is not None:
            conf = confidence_series.iloc[i]
            if not np.isfinite(conf) or conf < min_confidence:
                continue

        entry = closes[i]
        if not np.isfinite(entry) or entry <= 0:
            continue

        sim = _simulate_trade_return(highs, lows, closes, i, entry, config)
        trades.append({"index": i, "entry": float(entry), **sim})

    if not trades:
        return {
            "n_trades": 0,
            "win_rate": None,
            "avg_return_pct": None,
            "total_return_pct": None,
            "trades": [],
        }

    returns = [t["return_pct"] for t in trades]
    wins = sum(1 for t in trades if t["return_pct"] > 0)

    return {
        "n_trades": len(trades),
        "win_rate": wins / len(trades),
        "avg_return_pct": float(np.mean(returns)),
        "total_return_pct": float(np.sum(returns)),
        "trades": trades[:50],  # cap payload
    }


def evaluate_holdout_classifier(
    y_true: pd.Series,
    y_pred: np.ndarray,
) -> Dict[str, Any]:
    return classification_metrics(y_true, y_pred)


def walk_forward_holdout_split(n: int, holdout_ratio: float = 0.2) -> int:
    """Index where holdout starts (chronological)."""
    return int(n * (1 - holdout_ratio))

# services/ml-engine/labeling.py
"""Trade-outcome labels aligned with bot SL/TP execution."""

from __future__ import annotations

import logging
from typing import Optional, Tuple

import numpy as np
import pandas as pd

from label_config import DEFAULT_LABEL_CONFIG, LabelConfig

logger = logging.getLogger(__name__)


def _long_outcome_at_index(
    highs: np.ndarray,
    lows: np.ndarray,
    entry_idx: int,
    sl_price: float,
    tp_price: float,
    max_horizon: int,
) -> Tuple[int, Optional[int]]:
    """
    Walk forward from entry_idx+1. Conservative intrabar: SL checked before TP
    on each candle (worst case for long).
    Returns (label_binary, bars_to_outcome or None if timeout).
    """
    n = len(highs)
    end = min(entry_idx + max_horizon, n - 1)
    for j in range(entry_idx + 1, end + 1):
        if lows[j] <= sl_price:
            return 0, j - entry_idx
        if highs[j] >= tp_price:
            return 1, j - entry_idx
    return 0, None


def add_trade_outcome_label(
    df: pd.DataFrame,
    config: LabelConfig = DEFAULT_LABEL_CONFIG,
) -> pd.DataFrame:
    """
    Label 1 if TP is reached before SL within max_horizon candles after entry
    at close. Entry fee reduces effective TP; exit fee widens effective SL.
    """
    if df.empty:
        return df

    data = df.copy()
    required = {"close", "high", "low"}
    if not required.issubset(data.columns):
        raise ValueError(f"OHLC columns required for labeling: {required}")

    closes = data["close"].to_numpy(dtype=float)
    highs = data["high"].to_numpy(dtype=float)
    lows = data["low"].to_numpy(dtype=float)

    fee = config.round_trip_fee_percent
    sl_pct = config.stop_loss_percent
    tp_pct = config.take_profit_percent
    horizon = config.max_horizon_candles

    labels = np.full(len(data), np.nan)
    bars_to_outcome = np.full(len(data), np.nan)

    last_usable = len(data) - horizon - 1
    pos_count = 0
    neg_count = 0
    timeout_count = 0

    for i in range(max(0, last_usable + 1)):
        entry = closes[i]
        if not np.isfinite(entry) or entry <= 0:
            continue

        # Net levels after round-trip fee approximation
        effective_sl = entry * (1 - sl_pct - fee / 2)
        effective_tp = entry * (1 + tp_pct - fee)

        label, bars = _long_outcome_at_index(
            highs, lows, i, effective_sl, effective_tp, horizon
        )
        labels[i] = label
        if bars is not None:
            bars_to_outcome[i] = bars
            if label == 0:
                neg_count += 1
            else:
                pos_count += 1
        else:
            timeout_count += 1
            neg_count += 1

    data["target_binary"] = labels
    data["bars_to_outcome"] = bars_to_outcome
    data["label_valid"] = ~np.isnan(labels)
    data["label_resolved"] = pd.notna(bars_to_outcome)
    data["target"] = labels

    labeled = int(data["label_valid"].sum())
    resolved = int(data["label_resolved"].sum())
    logger.info(
        f"[LABEL] tp_before_sl horizon={horizon} sl={sl_pct:.2%} tp={tp_pct:.2%} "
        f"fee={fee:.3%} | pos={pos_count} neg={neg_count} timeout={timeout_count} "
        f"usable_rows={labeled}/{len(data)} resolved={resolved}"
    )
    return data


def filter_labeled_rows(df: pd.DataFrame) -> pd.DataFrame:
    """Keep only rows with a valid forward-looking trade-outcome label."""
    if df.empty or "label_valid" not in df.columns:
        return df
    return df[df["label_valid"]].drop(columns=["label_valid"]).reset_index(drop=True)


def label_summary(df: pd.DataFrame) -> dict:
    """Quick class balance stats for metrics.json."""
    if df.empty or "target_binary" not in df.columns:
        return {}
    y = df["target_binary"]
    n = len(y)
    pos = int((y == 1).sum())
    return {
        "n_labeled": n,
        "n_positive": pos,
        "n_negative": int(n - pos),
        "positive_rate": float(pos / n) if n else None,
    }

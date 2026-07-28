# services/ml-engine/baseline.py
"""Simple non-ML rule baseline for Phase 0 comparison."""

from __future__ import annotations

import pandas as pd


def ema_crossover_signals(df: pd.DataFrame) -> pd.Series:
    """
    Long-only baseline: BUY when EMA12 crosses above EMA26 (same features as ML).
    Returns boolean series aligned with df index.
    """
    if df.empty:
        return pd.Series(dtype=bool)

    cross = df.get("feature_ema_cross")
    if cross is None:
        ema12 = df.get("feature_ema_12")
        ema26 = df.get("feature_ema_26")
        if ema12 is None or ema26 is None:
            return pd.Series(False, index=df.index)
        cross = ema12 - ema26

    prev = cross.shift(1)
    return (cross > 0) & (prev <= 0)

"""Shared training helpers for algorithm plugins."""

from __future__ import annotations

from typing import Tuple

import pandas as pd


def chronological_split(
    X: pd.DataFrame,
    y: pd.Series,
    train_ratio: float = 0.8,
) -> Tuple[pd.DataFrame, pd.DataFrame, pd.Series, pd.Series, int]:
    """Time-ordered train/validation split (no shuffle)."""
    split_idx = int(len(X) * train_ratio)
    if split_idx < 1 or split_idx >= len(X):
        return X, X.iloc[:0], y, y.iloc[:0], split_idx
    return (
        X.iloc[:split_idx],
        X.iloc[split_idx:],
        y.iloc[:split_idx],
        y.iloc[split_idx:],
        split_idx,
    )

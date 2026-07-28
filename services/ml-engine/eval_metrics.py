# services/ml-engine/eval_metrics.py
"""Honest classification metrics for trading labels (not PnL simulation)."""

from __future__ import annotations

from typing import Any, Dict, Optional

import numpy as np
import pandas as pd


def _safe_rate(num: float, den: float) -> Optional[float]:
    if den <= 0:
        return None
    return float(num / den)


def classification_metrics(
    y_true: pd.Series | np.ndarray,
    y_pred: np.ndarray,
    positive_label: int = 1,
) -> Dict[str, Any]:
    """
    Metrics focused on the positive (BUY-worthy) class.
    """
    yt = np.asarray(y_true).astype(int)
    yp = np.asarray(y_pred).astype(int)

    tp = int(((yp == positive_label) & (yt == positive_label)).sum())
    fp = int(((yp == positive_label) & (yt != positive_label)).sum())
    fn = int(((yp != positive_label) & (yt == positive_label)).sum())
    tn = int(((yp != positive_label) & (yt != positive_label)).sum())

    precision_buy = _safe_rate(tp, tp + fp)
    recall_buy = _safe_rate(tp, tp + fn)
    if precision_buy is not None and recall_buy is not None and (precision_buy + recall_buy) > 0:
        f1_buy = 2 * precision_buy * recall_buy / (precision_buy + recall_buy)
    else:
        f1_buy = None

    return {
        "accuracy": float((yp == yt).mean()) if len(yt) else None,
        "precision_buy": precision_buy,
        "recall_buy": recall_buy,
        "f1_buy": f1_buy,
        "n_val": int(len(yt)),
        "val_tp": tp,
        "val_fp": fp,
        "val_fn": fn,
        "val_tn": tn,
        "val_predicted_buy": int((yp == positive_label).sum()),
        "val_actual_buy": int((yt == positive_label).sum()),
    }

# services/ml-engine/algorithms/lightgbm_clf.py
"""LightGBM binary classifier plugin."""

from __future__ import annotations

from typing import Any, Dict, Tuple

import numpy as np
import pandas as pd
from lightgbm import LGBMClassifier

from eval_metrics import classification_metrics
from algorithms.base import BaseAlgorithm
from algorithms.training_utils import chronological_split, train_has_both_classes


class LightGBMClassifierPlugin(BaseAlgorithm):
    id = "lightgbm"
    display_name = "LightGBM"

    def train(
        self, X: pd.DataFrame, y: pd.Series
    ) -> Tuple[Any, Dict[str, Any]]:
        neg_count = int((y == 0).sum())
        pos_count = int((y == 1).sum())
        scale_pos_weight = neg_count / max(pos_count, 1)

        model = LGBMClassifier(
            n_estimators=200,
            learning_rate=0.03,
            max_depth=5,
            num_leaves=31,
            subsample=0.8,
            colsample_bytree=0.8,
            scale_pos_weight=scale_pos_weight,
            random_state=42,
            verbosity=-1,
        )

        X_train, X_val, y_train, y_val, split_idx = chronological_split(X, y)
        use_val = (
            split_idx > 0
            and split_idx < len(X)
            and len(y_val) > 0
            and train_has_both_classes(y_train)
        )

        if not use_val:
            model.fit(X, y)
            return model, {
                "accuracy": None,
                "n_train": int(len(X)),
                "n_val": 0,
                "scale_pos_weight": float(scale_pos_weight),
            }

        model.fit(
            X_train,
            y_train,
            eval_set=[(X_val, y_val)],
        )

        val_preds = model.predict(X_val)
        cls_metrics = classification_metrics(y_val, val_preds)

        return model, {
            **cls_metrics,
            "n_train": int(len(X_train)),
            "scale_pos_weight": float(scale_pos_weight),
        }

    def predict_proba(self, model: Any, X_row: pd.DataFrame) -> np.ndarray:
        raw = np.asarray(model.predict_proba(X_row), dtype=float)
        row = raw[0] if raw.ndim >= 2 else raw
        out = np.asarray(row, dtype=float).ravel()
        if out.size == 1:
            classes = getattr(model, "classes_", None)
            p = float(out[0])
            if classes is not None and len(classes) == 1 and int(classes[0]) == 0:
                return np.array([p, 1.0 - p], dtype=float)
            if classes is not None and len(classes) == 1 and int(classes[0]) == 1:
                return np.array([1.0 - p, p], dtype=float)
            return np.array([1.0 - p, p], dtype=float)
        return out

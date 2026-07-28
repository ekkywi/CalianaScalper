# services/ml-engine/algorithms/xgboost_clf.py
"""XGBoost binary classifier plugin."""

from __future__ import annotations

from typing import Any, Dict, Tuple

import numpy as np
import pandas as pd
from xgboost import XGBClassifier

from eval_metrics import classification_metrics

from algorithms.base import BaseAlgorithm


class XGBoostClassifierPlugin(BaseAlgorithm):
    id = "xgboost"
    display_name = "XGBoost"

    def train(
        self, X: pd.DataFrame, y: pd.Series
    ) -> Tuple[Any, Dict[str, Any]]:
        neg_count = int((y == 0).sum())
        pos_count = int((y == 1).sum())
        scale_pos_weight = neg_count / max(pos_count, 1)

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

        split_idx = int(len(X) * 0.8)
        if split_idx < 1 or split_idx >= len(X):
            # Too little data for a clean split — train on all, no honest val accuracy
            model.set_params(early_stopping_rounds=None)
            model.fit(X, y, verbose=False)
            return model, {
                "accuracy": None,
                "n_train": int(len(X)),
                "n_val": 0,
                "scale_pos_weight": float(scale_pos_weight),
            }

        X_train, X_val = X.iloc[:split_idx], X.iloc[split_idx:]
        y_train, y_val = y.iloc[:split_idx], y.iloc[split_idx:]

        model.fit(
            X_train,
            y_train,
            eval_set=[(X_val, y_val)],
            verbose=False,
        )

        val_preds = model.predict(X_val)
        cls_metrics = classification_metrics(y_val, val_preds)

        return model, {
            **cls_metrics,
            "n_train": int(len(X_train)),
            "scale_pos_weight": float(scale_pos_weight),
        }

    def predict_proba(self, model: Any, X_row: pd.DataFrame) -> np.ndarray:
        return np.asarray(model.predict_proba(X_row)[0], dtype=float)

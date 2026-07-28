# services/ml-engine/algorithms/logreg_clf.py
"""Logistic regression baseline plugin (scaled features)."""

from __future__ import annotations

from typing import Any, Dict, Tuple

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from eval_metrics import classification_metrics
from algorithms.base import BaseAlgorithm
from algorithms.prob_utils import prob_up_from_proba
from algorithms.training_utils import chronological_split, train_has_both_classes


class LogisticRegressionPlugin(BaseAlgorithm):
    id = "logreg"
    display_name = "Logistic Regression"

    def train(
        self, X: pd.DataFrame, y: pd.Series
    ) -> Tuple[Any, Dict[str, Any]]:
        model = Pipeline(
            [
                ("scale", StandardScaler()),
                (
                    "clf",
                    LogisticRegression(
                        max_iter=500,
                        class_weight="balanced",
                        random_state=42,
                    ),
                ),
            ]
        )

        X_train, X_val, y_train, y_val, split_idx = chronological_split(X, y)
        use_val = (
            split_idx > 0
            and split_idx < len(X)
            and len(y_val) > 0
            and train_has_both_classes(y_train)
        )

        if not use_val:
            if not train_has_both_classes(y):
                raise ValueError(
                    "Logistic regression needs both BUY and SL labels in the training set."
                )
            model.fit(X, y)
            return model, {
                "accuracy": None,
                "n_train": int(len(X)),
                "n_val": 0,
            }

        model.fit(X_train, y_train)
        val_probs = np.array(
            [
                prob_up_from_proba(self.predict_proba(model, X_val.iloc[i : i + 1]))
                for i in range(len(X_val))
            ]
        )
        val_preds = (val_probs >= 0.5).astype(int)
        cls_metrics = classification_metrics(y_val, val_preds)

        return model, {
            **cls_metrics,
            "n_train": int(len(X_train)),
        }

    def predict_proba(self, model: Any, X_row: pd.DataFrame) -> np.ndarray:
        raw = np.asarray(model.predict_proba(X_row), dtype=float)
        row = raw[0] if raw.ndim >= 2 else raw
        # Pad to [P0, P1] when sklearn only fitted one class
        clf = model.named_steps.get("clf") if hasattr(model, "named_steps") else None
        classes = getattr(clf, "classes_", None) if clf is not None else None
        if classes is not None and len(classes) == 1:
            p = float(row.ravel()[0]) if row.size else 0.0
            if int(classes[0]) == 1:
                return np.array([1.0 - p, p], dtype=float)
            return np.array([p, 1.0 - p], dtype=float)
        out = np.asarray(row, dtype=float).ravel()
        if out.size == 1:
            return np.array([1.0 - out[0], out[0]], dtype=float)
        return out

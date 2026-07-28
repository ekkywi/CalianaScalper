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
from algorithms.training_utils import chronological_split


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
        if split_idx < 1 or split_idx >= len(X):
            model.fit(X, y)
            return model, {
                "accuracy": None,
                "n_train": int(len(X)),
                "n_val": 0,
            }

        model.fit(X_train, y_train)
        val_probs = np.array(
            [prob_up_from_proba(model.predict_proba(X_val.iloc[i : i + 1])) for i in range(len(X_val))]
        )
        val_preds = (val_probs >= 0.5).astype(int)
        cls_metrics = classification_metrics(y_val, val_preds)

        return model, {
            **cls_metrics,
            "n_train": int(len(X_train)),
        }

    def predict_proba(self, model: Any, X_row: pd.DataFrame) -> np.ndarray:
        return np.asarray(model.predict_proba(X_row)[0], dtype=float)

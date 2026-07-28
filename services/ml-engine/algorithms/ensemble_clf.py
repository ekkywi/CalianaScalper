# services/ml-engine/algorithms/ensemble_clf.py
"""Fuse XGBoost + LightGBM + Logistic Regression by weighted probability average."""

from __future__ import annotations

from typing import Any, Dict, Tuple

import numpy as np
import pandas as pd

from eval_metrics import classification_metrics
from algorithms.base import BaseAlgorithm
from algorithms.prob_utils import prob_up_from_proba
from algorithms.training_utils import chronological_split

ENSEMBLE_MEMBERS = ("xgboost", "lightgbm", "logreg")
DEFAULT_WEIGHTS: Dict[str, float] = {
    "xgboost": 0.4,
    "lightgbm": 0.4,
    "logreg": 0.2,
}


class EnsemblePlugin(BaseAlgorithm):
    id = "ensemble"
    display_name = "Ensemble (XGB+LGBM+LR)"

    def _active_members(self) -> tuple[list[str], Dict[str, float]]:
        from algorithms import get_available_algorithm_ids

        available = set(get_available_algorithm_ids())
        members = [m for m in ENSEMBLE_MEMBERS if m in available]
        if not members:
            raise ValueError("No base algorithms available for ensemble.")
        total = sum(DEFAULT_WEIGHTS.get(m, 0.0) for m in members)
        if total <= 0:
            w = 1.0 / len(members)
            return members, {m: w for m in members}
        return members, {m: DEFAULT_WEIGHTS.get(m, 0.0) / total for m in members}

    def train(
        self, X: pd.DataFrame, y: pd.Series
    ) -> Tuple[Any, Dict[str, Any]]:
        from algorithms import get_algorithm

        submodels: Dict[str, Any] = {}
        sub_metrics: Dict[str, Dict[str, Any]] = {}
        members, weights = self._active_members()

        for member_id in members:
            member_algo = get_algorithm(member_id)
            model, metrics = member_algo.train(X, y)
            submodels[member_id] = model
            sub_metrics[member_id] = metrics

        X_train, X_val, y_train, y_val, split_idx = chronological_split(X, y)
        fused_metrics: Dict[str, Any] = {
            "accuracy": None,
            "n_train": int(len(X_train)) if split_idx > 0 else int(len(X)),
            "n_val": 0,
            "sub_models": sub_metrics,
            "ensemble_members": list(members),
            "ensemble_weights": dict(weights),
        }

        if split_idx > 0 and split_idx < len(X) and len(y_val) > 0:
            fused_probs = self._fuse_probs(submodels, X_val, weights)
            val_preds = (fused_probs >= 0.5).astype(int)
            cls_metrics = classification_metrics(y_val, val_preds)
            fused_metrics.update(cls_metrics)
            fused_metrics["n_val"] = int(len(y_val))

        bundle = {
            "submodels": submodels,
            "weights": dict(weights),
        }
        return bundle, fused_metrics

    def _fuse_probs(
        self,
        submodels: Dict[str, Any],
        X: pd.DataFrame,
        weights: Dict[str, float],
    ) -> np.ndarray:
        from algorithms import get_algorithm

        fused = np.zeros(len(X), dtype=float)
        for member_id, weight in weights.items():
            if member_id not in submodels:
                continue
            algo = get_algorithm(member_id)
            member_probs = []
            for i in range(len(X)):
                row = X.iloc[i : i + 1]
                p = prob_up_from_proba(algo.predict_proba(submodels[member_id], row))
                member_probs.append(p)
            fused += weight * np.array(member_probs, dtype=float)
        return fused

    def predict_proba(self, model: Any, X_row: pd.DataFrame) -> np.ndarray:
        from algorithms import get_algorithm

        submodels = model.get("submodels", model)
        weights = model.get("weights", DEFAULT_WEIGHTS)
        fused = 0.0
        for member_id, weight in weights.items():
            if member_id not in submodels:
                continue
            algo = get_algorithm(member_id)
            fused += weight * prob_up_from_proba(
                algo.predict_proba(submodels[member_id], X_row)
            )
        fused = float(np.clip(fused, 0.0, 1.0))
        return np.array([1.0 - fused, fused], dtype=float)

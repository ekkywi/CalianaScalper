# services/ml-engine/algorithms/base.py
"""Algorithm plugin contract for multi-model ML engine."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Dict, Tuple

import numpy as np
import pandas as pd


class BaseAlgorithm(ABC):
    """Interface every ML algorithm plugin must implement."""

    id: str
    display_name: str

    @abstractmethod
    def train(
        self, X: pd.DataFrame, y: pd.Series
    ) -> Tuple[Any, Dict[str, Any]]:
        """
        Train on features X and binary labels y.
        Returns (fitted_model, metrics) where metrics must include:
          - accuracy (float 0-1 from validation split, or None if unavailable)
          - n_train, n_val (ints)
        """

    @abstractmethod
    def predict_proba(self, model: Any, X_row: pd.DataFrame) -> np.ndarray:
        """Return class probabilities for the latest feature row(s)."""

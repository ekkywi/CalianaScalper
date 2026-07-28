"""Extract probability of positive class from classifier outputs."""

from __future__ import annotations

import numpy as np


def prob_up_from_proba(probabilities: np.ndarray) -> float:
    arr = np.asarray(probabilities, dtype=float)
    if arr.size == 1:
        return float(arr[0])
    return float(arr[1])

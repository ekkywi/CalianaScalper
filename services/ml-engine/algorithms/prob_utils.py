"""Extract probability of positive class from classifier outputs."""

from __future__ import annotations

from typing import Optional, Sequence

import numpy as np


def prob_up_from_proba(
    probabilities: np.ndarray,
    classes: Optional[Sequence[int]] = None,
) -> float:
    """
    Return P(class=1) from predict_proba output.

    Accepts shapes:
      - (n_classes,) for one sample
      - (1, n_classes) for one sample batched
      - (n_samples, n_classes) — uses first row
      - (1,) when the fitted model only saw one class
    """
    arr = np.asarray(probabilities, dtype=float)
    if arr.size == 0:
        return 0.0

    if arr.ndim >= 2:
        arr = arr[0]
    arr = np.asarray(arr, dtype=float).ravel()

    if arr.size == 1:
        if classes is not None and len(classes) == 1:
            # Single-class model: probability mass is entirely on that class
            return 1.0 if int(classes[0]) == 1 else 0.0
        # Ambiguous single value — treat as P(positive) only if it looks like a scalar prob
        return float(np.clip(arr[0], 0.0, 1.0))

    # Binary/multiclass: assume column order matches sorted classes; positive=1 is last for [0,1]
    if classes is not None and len(classes) == len(arr):
        try:
            idx = list(int(c) for c in classes).index(1)
            return float(np.clip(arr[idx], 0.0, 1.0))
        except ValueError:
            return 0.0

    return float(np.clip(arr[-1], 0.0, 1.0))

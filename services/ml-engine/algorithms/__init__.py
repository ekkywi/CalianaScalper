# services/ml-engine/algorithms/__init__.py
"""Algorithm registry — register plugins here to enable new models."""

from __future__ import annotations

import logging
from typing import Dict, List, Optional

from algorithms.base import BaseAlgorithm
from algorithms.xgboost_clf import XGBoostClassifierPlugin
from algorithms.logreg_clf import LogisticRegressionPlugin
from algorithms.ensemble_clf import EnsemblePlugin

logger = logging.getLogger(__name__)

_REGISTRY: Dict[str, BaseAlgorithm] = {
    XGBoostClassifierPlugin.id: XGBoostClassifierPlugin(),
    LogisticRegressionPlugin.id: LogisticRegressionPlugin(),
}

try:
    from algorithms.lightgbm_clf import LightGBMClassifierPlugin

    _REGISTRY[LightGBMClassifierPlugin.id] = LightGBMClassifierPlugin()
except Exception as e:
    logger.warning(
        "[ALGO] LightGBM plugin unavailable; continuing without it: %s",
        e,
    )

_REGISTRY[EnsemblePlugin.id] = EnsemblePlugin()

DEFAULT_ALGORITHM = "ensemble" if "ensemble" in _REGISTRY else "xgboost"


def get_available_algorithm_ids() -> List[str]:
    return list(_REGISTRY.keys())


def get_algorithm(algorithm_id: Optional[str] = None) -> BaseAlgorithm:
    key = (algorithm_id or DEFAULT_ALGORITHM).lower().strip()
    if key not in _REGISTRY:
        raise KeyError(
            f"Unknown algorithm '{key}'. Available: {list(_REGISTRY.keys())}"
        )
    return _REGISTRY[key]


def list_algorithms() -> List[dict]:
    return [
        {"id": algo.id, "name": algo.display_name}
        for algo in _REGISTRY.values()
    ]


def register_algorithm(plugin: BaseAlgorithm) -> None:
    """Allow tests / future plugins to register at runtime."""
    _REGISTRY[plugin.id] = plugin

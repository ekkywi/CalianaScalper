# services/ml-engine/model_store.py
"""Persist / load model artifacts, buffers, and honest training metrics."""

from __future__ import annotations

import json
import logging
import os
import pickle
from typing import Any, Dict, List, Optional

import pandas as pd

logger = logging.getLogger(__name__)

MODEL_DIR = os.path.join(os.path.dirname(__file__), "models")
os.makedirs(MODEL_DIR, exist_ok=True)


def artifact_path(symbol: str) -> str:
    return os.path.join(MODEL_DIR, f"{symbol}_artifact.pkl")


def legacy_model_path(symbol: str) -> str:
    return os.path.join(MODEL_DIR, f"{symbol}_model.pkl")


def buffer_path(symbol: str) -> str:
    return os.path.join(MODEL_DIR, f"{symbol}_buffer.pkl")


def metrics_path(symbol: str) -> str:
    return os.path.join(MODEL_DIR, f"{symbol}_metrics.json")


def save_buffer(symbol: str, buffer: pd.DataFrame) -> None:
    try:
        with open(buffer_path(symbol), "wb") as f:
            pickle.dump(buffer, f)
        logger.info(f"[PERSISTENCE] Buffer {symbol} disimpan.")
    except Exception as e:
        logger.error(f"[PERSISTENCE] Gagal menyimpan buffer {symbol}: {e}")


def load_buffer(symbol: str) -> Optional[pd.DataFrame]:
    path = buffer_path(symbol)
    if not os.path.exists(path):
        return None
    try:
        with open(path, "rb") as f:
            return pickle.load(f)
    except Exception as e:
        logger.error(f"[PERSISTENCE] Gagal memuat buffer {symbol}: {e}")
        return None


def save_artifact(
    symbol: str,
    *,
    algorithm: str,
    model: Any,
    feature_cols: list,
    trained_at: int,
) -> None:
    payload = {
        "algorithm": algorithm,
        "model": model,
        "feature_cols": list(feature_cols),
        "trained_at": trained_at,
    }
    try:
        with open(artifact_path(symbol), "wb") as f:
            pickle.dump(payload, f)
        logger.info(f"[PERSISTENCE] Artifact {symbol} ({algorithm}) disimpan.")
    except Exception as e:
        logger.error(f"[PERSISTENCE] Gagal menyimpan artifact {symbol}: {e}")


def save_metrics(symbol: str, metrics: Dict[str, Any]) -> None:
    try:
        with open(metrics_path(symbol), "w", encoding="utf-8") as f:
            json.dump(metrics, f, indent=2)
        logger.info(f"[PERSISTENCE] Metrics {symbol} disimpan.")
    except Exception as e:
        logger.error(f"[PERSISTENCE] Gagal menyimpan metrics {symbol}: {e}")


def load_metrics(symbol: str) -> Optional[Dict[str, Any]]:
    path = metrics_path(symbol)
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else None
    except Exception as e:
        logger.error(f"[PERSISTENCE] Gagal memuat metrics {symbol}: {e}")
        return None


def load_artifact(symbol: str) -> Optional[Dict[str, Any]]:
    """
    Load artifact bundle. Migrates legacy raw XGB pickle → bundle with
    algorithm=xgboost and accuracy=None (honest until retrain).
    """
    art_path = artifact_path(symbol)
    leg_path = legacy_model_path(symbol)

    try:
        if os.path.exists(art_path):
            with open(art_path, "rb") as f:
                data = pickle.load(f)
            if isinstance(data, dict) and "model" in data:
                return {
                    "algorithm": data.get("algorithm") or "xgboost",
                    "model": data["model"],
                    "feature_cols": data.get("feature_cols"),
                    "trained_at": data.get("trained_at"),
                }
            # Unexpected shape — treat as raw model
            return {
                "algorithm": "xgboost",
                "model": data,
                "feature_cols": None,
                "trained_at": None,
            }

        if os.path.exists(leg_path):
            with open(leg_path, "rb") as f:
                raw = pickle.load(f)
            logger.info(
                f"[PERSISTENCE] Migrasi legacy model {symbol} → artifact xgboost (accuracy n/a)."
            )
            return {
                "algorithm": "xgboost",
                "model": raw,
                "feature_cols": None,
                "trained_at": None,
            }
    except Exception as e:
        logger.error(f"[PERSISTENCE] Gagal memuat artifact {symbol}: {e}")

    return None


def discover_symbols() -> List[str]:
    """Find symbols that have artifact or legacy model files."""
    symbols = set()
    if not os.path.isdir(MODEL_DIR):
        return []
    for name in os.listdir(MODEL_DIR):
        if name.endswith("_artifact.pkl"):
            symbols.add(name[: -len("_artifact.pkl")])
        elif name.endswith("_model.pkl"):
            symbols.add(name[: -len("_model.pkl")])
    return sorted(symbols)


def load_symbol_into_state(
    symbol: str,
    app_state: Dict[str, Any],
) -> bool:
    """
    Load artifact + buffer into app_state.
    app_state keys used: models, algorithms, trained_at, metrics, buffers, training_status, feature_cols
    """
    artifact = load_artifact(symbol)
    buffer = load_buffer(symbol)
    if artifact is None or buffer is None:
        return False

    app_state["models"][symbol] = artifact["model"]
    app_state["algorithms"][symbol] = artifact["algorithm"]
    app_state["trained_at"][symbol] = artifact.get("trained_at")
    if artifact.get("feature_cols"):
        # Keep global feature_cols as source of truth for training;
        # per-symbol override only if present (legacy may omit)
        app_state.setdefault("feature_cols_by_symbol", {})[symbol] = artifact[
            "feature_cols"
        ]

    metrics = load_metrics(symbol)
    if metrics is None:
        # Legacy: no fabricated accuracy
        metrics = {
            "accuracy": None,
            "algorithm": artifact["algorithm"],
            "trained_at": artifact.get("trained_at"),
        }
    app_state["metrics"][symbol] = metrics
    app_state["buffers"][symbol] = buffer
    app_state["training_status"][symbol] = "ready"
    logger.info(
        f"[PERSISTENCE] Model {symbol} dimuat (algo={artifact['algorithm']})."
    )
    return True


def delete_symbol_files(symbol: str) -> Dict[str, Any]:
    """Remove all on-disk artifacts for a symbol. Returns list of removed paths."""
    symbol = symbol.upper()
    candidates = [
        artifact_path(symbol),
        legacy_model_path(symbol),
        buffer_path(symbol),
        metrics_path(symbol),
    ]
    removed = []
    errors = []
    for path in candidates:
        if not os.path.exists(path):
            continue
        try:
            os.remove(path)
            removed.append(os.path.basename(path))
        except OSError as e:
            errors.append(f"{os.path.basename(path)}: {e}")
            logger.error(f"[PERSISTENCE] Gagal hapus {path}: {e}")
    return {"symbol": symbol, "removed": removed, "errors": errors}


def purge_symbol_from_state(symbol: str, app_state: Dict[str, Any]) -> None:
    """Drop symbol from in-memory app_state maps."""
    symbol = symbol.upper()
    for key in (
        "models",
        "algorithms",
        "trained_at",
        "metrics",
        "buffers",
        "training_status",
        "feature_cols_by_symbol",
    ):
        store = app_state.get(key)
        if isinstance(store, dict):
            store.pop(symbol, None)

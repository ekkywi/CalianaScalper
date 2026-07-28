# services/ml-engine/model_store.py
"""Persist / load versioned model artifacts, buffers, and metrics."""

from __future__ import annotations

import json
import logging
import os
import pickle
import shutil
import uuid
from typing import Any, Dict, List, Optional

import pandas as pd

logger = logging.getLogger(__name__)

MODEL_DIR = os.path.join(os.path.dirname(__file__), "models")
VERSIONS_DIR = os.path.join(MODEL_DIR, "versions")
os.makedirs(MODEL_DIR, exist_ok=True)
os.makedirs(VERSIONS_DIR, exist_ok=True)


def artifact_path(symbol: str) -> str:
    """Active (hot) artifact path — used for predict."""
    return os.path.join(MODEL_DIR, f"{symbol}_artifact.pkl")


def legacy_model_path(symbol: str) -> str:
    return os.path.join(MODEL_DIR, f"{symbol}_model.pkl")


def buffer_path(symbol: str) -> str:
    return os.path.join(MODEL_DIR, f"{symbol}_buffer.pkl")


def metrics_path(symbol: str) -> str:
    return os.path.join(MODEL_DIR, f"{symbol}_metrics.json")


def version_dir(symbol: str, model_id: str) -> str:
    return os.path.join(VERSIONS_DIR, symbol.upper(), model_id)


def version_artifact_path(symbol: str, model_id: str) -> str:
    return os.path.join(version_dir(symbol, model_id), "artifact.pkl")


def version_metrics_path(symbol: str, model_id: str) -> str:
    return os.path.join(version_dir(symbol, model_id), "metrics.json")


def index_path(symbol: str) -> str:
    return os.path.join(VERSIONS_DIR, symbol.upper(), "index.json")


def new_model_id() -> str:
    return uuid.uuid4().hex[:16]


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


def _read_index(symbol: str) -> Dict[str, Any]:
    path = index_path(symbol)
    if not os.path.exists(path):
        return {"symbol": symbol.upper(), "active_model_id": None, "models": []}
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return {"symbol": symbol.upper(), "active_model_id": None, "models": []}
        data.setdefault("models", [])
        data.setdefault("active_model_id", None)
        data["symbol"] = symbol.upper()
        return data
    except Exception as e:
        logger.error(f"[PERSISTENCE] Gagal baca index {symbol}: {e}")
        return {"symbol": symbol.upper(), "active_model_id": None, "models": []}


def _write_index(symbol: str, data: Dict[str, Any]) -> None:
    sym = symbol.upper()
    os.makedirs(os.path.join(VERSIONS_DIR, sym), exist_ok=True)
    path = index_path(sym)
    data["symbol"] = sym
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def save_artifact(
    symbol: str,
    *,
    algorithm: str,
    model: Any,
    feature_cols: list,
    trained_at: int,
    model_id: Optional[str] = None,
    name: Optional[str] = None,
    metrics: Optional[Dict[str, Any]] = None,
    set_active: bool = True,
) -> str:
    """
    Save a versioned artifact. Also writes active hot path when set_active=True.
    Returns model_id.
    """
    symbol = symbol.upper()
    mid = model_id or new_model_id()
    payload = {
        "algorithm": algorithm,
        "model": model,
        "feature_cols": list(feature_cols),
        "trained_at": trained_at,
        "model_id": mid,
        "name": name or f"{symbol}-{mid[:8]}",
    }

    vdir = version_dir(symbol, mid)
    os.makedirs(vdir, exist_ok=True)
    try:
        with open(version_artifact_path(symbol, mid), "wb") as f:
            pickle.dump(payload, f)
        if metrics is not None:
            with open(version_metrics_path(symbol, mid), "w", encoding="utf-8") as f:
                json.dump(metrics, f, indent=2)

        idx = _read_index(symbol)
        entry = {
            "model_id": mid,
            "name": payload["name"],
            "algorithm": algorithm,
            "trained_at": trained_at,
            "label_config": (metrics or {}).get("label_config"),
            "metrics_summary": {
                k: (metrics or {}).get(k)
                for k in (
                    "accuracy",
                    "precision_buy",
                    "recall_buy",
                    "f1_buy",
                    "n_train",
                    "n_val",
                    "n_positive",
                    "positive_rate",
                )
            },
        }
        models = [m for m in idx["models"] if m.get("model_id") != mid]
        models.append(entry)
        models.sort(key=lambda m: int(m.get("trained_at") or 0), reverse=True)
        idx["models"] = models
        if set_active:
            idx["active_model_id"] = mid
            # Hot path for predict
            with open(artifact_path(symbol), "wb") as f:
                pickle.dump(payload, f)
            if metrics is not None:
                save_metrics(symbol, metrics)
        _write_index(symbol, idx)
        logger.info(f"[PERSISTENCE] Artifact {symbol}/{mid} ({algorithm}) disimpan.")
        return mid
    except Exception as e:
        logger.error(f"[PERSISTENCE] Gagal menyimpan artifact {symbol}/{mid}: {e}")
        raise


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


def load_artifact(symbol: str, model_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Load active artifact, or a specific version when model_id is set."""
    symbol = symbol.upper()
    try:
        if model_id:
            path = version_artifact_path(symbol, model_id)
            if not os.path.exists(path):
                return None
            with open(path, "rb") as f:
                data = pickle.load(f)
            if isinstance(data, dict) and "model" in data:
                return data
            return None

        art_path = artifact_path(symbol)
        leg_path = legacy_model_path(symbol)

        if os.path.exists(art_path):
            with open(art_path, "rb") as f:
                data = pickle.load(f)
            if isinstance(data, dict) and "model" in data:
                return {
                    "algorithm": data.get("algorithm") or "xgboost",
                    "model": data["model"],
                    "feature_cols": data.get("feature_cols"),
                    "trained_at": data.get("trained_at"),
                    "model_id": data.get("model_id"),
                    "name": data.get("name"),
                }
            return {
                "algorithm": "xgboost",
                "model": data,
                "feature_cols": None,
                "trained_at": None,
                "model_id": None,
                "name": None,
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
                "model_id": None,
                "name": None,
            }
    except Exception as e:
        logger.error(f"[PERSISTENCE] Gagal memuat artifact {symbol}: {e}")
    return None


def list_model_versions(symbol: str) -> Dict[str, Any]:
    return _read_index(symbol.upper())


def list_all_libraries() -> List[Dict[str, Any]]:
    """List version libraries; auto-import hot-only artifacts so Nest sync sees them."""
    out: List[Dict[str, Any]] = []
    seen = set()
    for sym in discover_symbols():
        migrate_hot_to_version_if_needed(sym)
        idx = list_model_versions(sym)
        out.append(idx)
        seen.add(sym.upper())
    if os.path.isdir(VERSIONS_DIR):
        for name in sorted(os.listdir(VERSIONS_DIR)):
            path = os.path.join(VERSIONS_DIR, name)
            if os.path.isdir(path) and name.upper() not in seen:
                out.append(list_model_versions(name))
    return out


def activate_model_version(symbol: str, model_id: str) -> Dict[str, Any]:
    symbol = symbol.upper()
    artifact = load_artifact(symbol, model_id=model_id)
    if artifact is None:
        raise FileNotFoundError(f"Model version {symbol}/{model_id} not found")

    metrics = None
    mpath = version_metrics_path(symbol, model_id)
    if os.path.exists(mpath):
        with open(mpath, "r", encoding="utf-8") as f:
            metrics = json.load(f)

    with open(artifact_path(symbol), "wb") as f:
        pickle.dump(artifact, f)
    if metrics is not None:
        save_metrics(symbol, metrics)

    idx = _read_index(symbol)
    idx["active_model_id"] = model_id
    _write_index(symbol, idx)
    return {
        "symbol": symbol,
        "model_id": model_id,
        "algorithm": artifact.get("algorithm"),
        "trained_at": artifact.get("trained_at"),
        "name": artifact.get("name"),
        "metrics": metrics,
    }


def delete_model_version(symbol: str, model_id: str) -> Dict[str, Any]:
    symbol = symbol.upper()
    idx = _read_index(symbol)
    if idx.get("active_model_id") == model_id:
        raise ValueError("Cannot delete the active model; activate another first")
    vdir = version_dir(symbol, model_id)
    removed = []
    if os.path.isdir(vdir):
        shutil.rmtree(vdir)
        removed.append(vdir)
    idx["models"] = [m for m in idx.get("models", []) if m.get("model_id") != model_id]
    _write_index(symbol, idx)
    return {"symbol": symbol, "model_id": model_id, "removed": removed}


def migrate_hot_to_version_if_needed(symbol: str) -> Optional[str]:
    """If symbol has hot artifact but empty index, import as first version."""
    symbol = symbol.upper()
    idx = _read_index(symbol)
    if idx.get("models"):
        return idx.get("active_model_id")
    artifact = load_artifact(symbol)
    if artifact is None:
        return None
    metrics = load_metrics(symbol) or {
        "algorithm": artifact.get("algorithm"),
        "trained_at": artifact.get("trained_at"),
        "label_config": None,
    }
    mid = artifact.get("model_id") or new_model_id()
    trained_at = int(artifact.get("trained_at") or 0) or int(__import__("time").time() * 1000)
    return save_artifact(
        symbol,
        algorithm=artifact.get("algorithm") or "xgboost",
        model=artifact["model"],
        feature_cols=artifact.get("feature_cols") or [],
        trained_at=trained_at,
        model_id=mid,
        name=artifact.get("name") or f"{symbol}-legacy",
        metrics=metrics,
        set_active=True,
    )


def discover_symbols() -> List[str]:
    symbols = set()
    if os.path.isdir(MODEL_DIR):
        for name in os.listdir(MODEL_DIR):
            if name.endswith("_artifact.pkl"):
                symbols.add(name[: -len("_artifact.pkl")])
            elif name.endswith("_model.pkl"):
                symbols.add(name[: -len("_model.pkl")])
    if os.path.isdir(VERSIONS_DIR):
        for name in os.listdir(VERSIONS_DIR):
            if os.path.isdir(os.path.join(VERSIONS_DIR, name)):
                symbols.add(name.upper())
    return sorted(symbols)


def load_symbol_into_state(
    symbol: str,
    app_state: Dict[str, Any],
) -> bool:
    migrate_hot_to_version_if_needed(symbol)
    artifact = load_artifact(symbol)
    buffer = load_buffer(symbol)
    if artifact is None or buffer is None:
        # Allow load without buffer for activate-only paths
        if artifact is None:
            return False
        buffer = pd.DataFrame()

    app_state["models"][symbol] = artifact["model"]
    app_state["algorithms"][symbol] = artifact["algorithm"]
    app_state["trained_at"][symbol] = artifact.get("trained_at")
    app_state["active_model_ids"] = app_state.get("active_model_ids") or {}
    app_state["active_model_ids"][symbol] = artifact.get("model_id")
    if artifact.get("feature_cols"):
        app_state.setdefault("feature_cols_by_symbol", {})[symbol] = artifact[
            "feature_cols"
        ]

    metrics = load_metrics(symbol)
    if metrics is None:
        metrics = {
            "accuracy": None,
            "algorithm": artifact["algorithm"],
            "trained_at": artifact.get("trained_at"),
            "model_id": artifact.get("model_id"),
            "name": artifact.get("name"),
        }
    else:
        metrics.setdefault("model_id", artifact.get("model_id"))
        metrics.setdefault("name", artifact.get("name"))
    app_state["metrics"][symbol] = metrics
    if buffer is not None and not getattr(buffer, "empty", True):
        app_state["buffers"][symbol] = buffer
    app_state["training_status"][symbol] = "ready"
    logger.info(
        f"[PERSISTENCE] Model {symbol} dimuat (algo={artifact['algorithm']}, id={artifact.get('model_id')})."
    )
    return True


def delete_symbol_files(symbol: str) -> Dict[str, Any]:
    """Remove all on-disk artifacts for a symbol (hot + all versions)."""
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
    vroot = os.path.join(VERSIONS_DIR, symbol)
    if os.path.isdir(vroot):
        try:
            shutil.rmtree(vroot)
            removed.append(f"versions/{symbol}")
        except OSError as e:
            errors.append(f"versions/{symbol}: {e}")
    return {"symbol": symbol, "removed": removed, "errors": errors}


def purge_symbol_from_state(symbol: str, app_state: Dict[str, Any]) -> None:
    symbol = symbol.upper()
    for key in (
        "models",
        "algorithms",
        "trained_at",
        "metrics",
        "buffers",
        "training_status",
        "feature_cols_by_symbol",
        "active_model_ids",
    ):
        store = app_state.get(key)
        if isinstance(store, dict):
            store.pop(symbol, None)

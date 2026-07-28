# services/ml-engine/main.py
"""FastAPI ML engine — orchestration over algorithm registry + model store."""

import logging
import time
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Optional

from fastapi import BackgroundTasks, FastAPI, HTTPException
from pydantic import BaseModel
import pandas as pd
import numpy as np

from database import fetch_historical_candles
from features import build_features
from labeling import add_trade_outcome_label, filter_labeled_rows, label_summary
from label_config import DEFAULT_LABEL_CONFIG, LabelConfig
from baseline import ema_crossover_signals
from backtest import (
    backtest_signals,
    evaluate_holdout_classifier,
    walk_forward_holdout_split,
)
from algorithms import DEFAULT_ALGORITHM, get_algorithm, list_algorithms
from algorithms.prob_utils import prob_up_from_proba
from regime import detect_regime
from model_store import (
    activate_model_version,
    delete_model_version,
    delete_symbol_files,
    discover_symbols,
    list_all_libraries,
    list_model_versions,
    load_symbol_into_state,
    new_model_id,
    purge_symbol_from_state,
    save_artifact,
    save_buffer,
    save_metrics,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ============================================================
# Application State
# ============================================================
app_state = {
    "models": {},  # symbol -> fitted estimator
    "algorithms": {},  # symbol -> algorithm id
    "metrics": {},  # symbol -> metrics dict
    "trained_at": {},  # symbol -> ms
    "buffers": {},  # symbol -> DataFrame
    "training_status": {},  # idle | training | ready | error
    "last_training_errors": {},  # symbol -> last validation/error message
    "active_model_ids": {},  # symbol -> engine model_id
    "feature_cols": [
        "feature_rsi_14",
        "feature_rsi_7",
        "feature_stoch_rsi",
        "feature_macd",
        "feature_macd_signal",
        "feature_macd_diff",
        "feature_macd_roc",
        "feature_price_to_sma20",
        "feature_price_to_ema12",
        "feature_sma_cross",
        "feature_ema_cross",
        "feature_bb_width",
        "feature_bb_percent",
        "feature_bb_position",
        "feature_atr_percent",
        "feature_return_1",
        "feature_return_3",
        "feature_return_5",
        "feature_return_10",
        "feature_log_return_1",
        "feature_body_size",
        "feature_upper_wick",
        "feature_lower_wick",
        "feature_range",
        "feature_volume_ratio",
        "feature_volume_change",
    ],
    "feature_cols_by_symbol": {},
}


class CandleData(BaseModel):
    symbol: str
    startTime: int
    closeTime: int
    open: float
    high: float
    low: float
    close: float
    volume: float
    isClosed: bool


class PredictionResponse(BaseModel):
    symbol: str
    signal: str
    confidence: float
    timestamp: int
    model_ready: bool = True
    algorithm: Optional[str] = None
    prob_up: Optional[float] = None
    regime: Optional[str] = None
    regime_allow_long: Optional[bool] = None
    regime_confidence_bump: Optional[float] = None
    regime_reason: Optional[str] = None


class TrainRequest(BaseModel):
    algorithm: Optional[str] = None
    label_config: Optional[dict] = None
    name: Optional[str] = None
    set_active: bool = True


class TrainingValidationError(ValueError):
    """Expected training rejection (label balance, row counts)."""


class EvalQueryParams(BaseModel):
    """Documented for OpenAPI; eval uses query params directly."""

    min_confidence: float = 0.65
    holdout_ratio: float = 0.2
    stop_loss_percent: Optional[float] = None
    take_profit_percent: Optional[float] = None


def buy_threshold(atr_percent: float) -> float:
    if not np.isfinite(atr_percent):
        atr_percent = 0.0
    volatility_multiplier = min(max(atr_percent / 2, 0.5), 2.0)
    return 0.55 + (0.10 * volatility_multiplier)


def sell_threshold(atr_percent: float) -> float:
    if not np.isfinite(atr_percent):
        atr_percent = 0.0
    volatility_multiplier = min(max(atr_percent / 2, 0.5), 2.0)
    return 0.45 - (0.10 * volatility_multiplier)


def signal_from_prob_up(prob_up: float, atr_percent: float) -> tuple[str, float]:
    thresh_buy = buy_threshold(atr_percent)
    thresh_sell = sell_threshold(atr_percent)
    if prob_up >= thresh_buy:
        return "BUY", prob_up
    if prob_up <= thresh_sell:
        return "SELL", 1.0 - prob_up
    return "HOLD", max(prob_up, 1.0 - prob_up)


def prob_up_from_model(model, algo, feature_row: pd.DataFrame) -> float:
    return prob_up_from_proba(algo.predict_proba(model, feature_row))


def feature_cols_for(symbol: str) -> list:
    return app_state["feature_cols_by_symbol"].get(
        symbol, app_state["feature_cols"]
    )


def trainable_rows(
    df_labeled: pd.DataFrame,
    feature_cols: list[str],
    *,
    resolved_only: bool = True,
) -> pd.DataFrame:
    """Keep valid labels with non-null features; optionally drop timeout rows."""
    labeled = filter_labeled_rows(df_labeled)
    if resolved_only and "label_resolved" in labeled.columns:
        labeled = labeled[labeled["label_resolved"]].copy()
    required_cols = list(feature_cols) + ["target_binary"]
    return labeled.dropna(subset=required_cols).copy()


def label_preview_stats(
    symbol: str,
    label_config: LabelConfig,
) -> dict:
    """Compute label balance for UI preview (no model training)."""
    symbol = symbol.upper()
    df_raw = fetch_historical_candles(symbol, limit=2000)
    if df_raw.empty:
        raise HTTPException(
            status_code=404,
            detail=f"No candle data for {symbol}. Run watchlist backfill first.",
        )

    df_features = build_features(df_raw)
    if df_features.empty:
        raise HTTPException(
            status_code=422,
            detail=f"Feature build failed for {symbol}.",
        )

    df_labeled = add_trade_outcome_label(df_features, label_config)
    cols = app_state["feature_cols"]
    all_labeled = filter_labeled_rows(df_labeled)
    train_data = trainable_rows(df_labeled, cols, resolved_only=True)

    n_all = int(len(all_labeled))
    n_resolved = int(all_labeled["label_resolved"].sum()) if "label_resolved" in all_labeled.columns else n_all
    n_train = int(len(train_data))
    n_pos = int((train_data["target_binary"] == 1).sum()) if n_train else 0
    n_neg = int((train_data["target_binary"] == 0).sum()) if n_train else 0
    timeout_rows = n_all - n_resolved if n_all else 0

    trainable = n_train >= 50 and n_pos >= 5
    hint = None
    if not trainable:
        if n_pos < 5:
            hint = (
                f"Need ≥5 positive TP-before-SL labels in resolved rows "
                f"(got {n_pos}/{n_train}). Try lower TP, longer horizon "
                f"({label_config.max_horizon_candles} candles), or more history."
            )
        elif n_train < 50:
            hint = f"Need ≥50 resolved training rows (got {n_train}). Add more candle history."

    return {
        "symbol": symbol,
        "candle_rows": int(len(df_raw)),
        "feature_rows": int(len(df_features)),
        "labeled_rows": n_all,
        "resolved_rows": n_resolved,
        "timeout_rows": timeout_rows,
        "train_rows": n_train,
        "n_positive": n_pos,
        "n_negative": n_neg,
        "positive_rate": float(n_pos / n_train) if n_train else None,
        "trainable": trainable,
        "hint": hint,
        "label_config": label_config.to_dict(),
        "uses_resolved_only": True,
    }


def validate_training_dataset(
    symbol: str,
    train_data: pd.DataFrame,
    label_config: LabelConfig,
    *,
    min_rows: int = 50,
    min_positive: int = 5,
) -> None:
    """Raise actionable errors when the dataset is too weak to train."""
    if train_data.empty:
        raise TrainingValidationError(
            f"Data valid kosong setelah labeling trade-outcome untuk {symbol} "
            f"(resolved SL/TP rows only — timeouts excluded)."
        )

    row_count = int(len(train_data))
    pos_count = int((train_data["target_binary"] == 1).sum())
    neg_count = int((train_data["target_binary"] == 0).sum())

    if row_count < min_rows:
        raise TrainingValidationError(
            f"Data training {symbol} terlalu sedikit ({row_count} baris resolved). "
            f"Butuh minimal {min_rows} baris setelah feature + labeling."
        )

    if pos_count < min_positive:
        raise TrainingValidationError(
            f"Label BUY positif untuk {symbol} terlalu sedikit "
            f"({pos_count}/{row_count} resolved; neg/SL={neg_count}). "
            f"Coba tambah histori, kecilkan TP {label_config.take_profit_percent:.2%}, "
            f"perbesar horizon {label_config.max_horizon_candles} candle, "
            f"atau sesuaikan SL {label_config.stop_loss_percent:.2%}."
        )


def run_train_symbol_model(
    symbol: str,
    algorithm_id: Optional[str] = None,
    label_config: Optional[LabelConfig] = None,
    name: Optional[str] = None,
    set_active: bool = True,
) -> None:
    """Background-safe wrapper so training failures don't bubble into ASGI."""
    try:
        train_symbol_model(
            symbol,
            algorithm_id,
            label_config,
            name=name,
            set_active=set_active,
        )
    except TrainingValidationError as e:
        logger.warning(f"[TRAINING] {symbol}: {e}")
    except Exception:
        logger.exception(f"[TRAINING] Background task gagal untuk {symbol}")


def persist_symbol(
    symbol: str,
    *,
    model_id: Optional[str] = None,
    name: Optional[str] = None,
    set_active: bool = True,
) -> Optional[str]:
    if symbol not in app_state["models"]:
        return None
    algo_id = app_state["algorithms"].get(symbol, DEFAULT_ALGORITHM)
    trained_at = app_state["trained_at"].get(symbol) or int(time.time() * 1000)
    metrics = app_state["metrics"].get(symbol) or {}
    mid = save_artifact(
        symbol,
        algorithm=algo_id,
        model=app_state["models"][symbol],
        feature_cols=feature_cols_for(symbol),
        trained_at=trained_at,
        model_id=model_id or metrics.get("model_id"),
        name=name or metrics.get("name"),
        metrics=metrics,
        set_active=set_active,
    )
    app_state.setdefault("active_model_ids", {})
    if set_active:
        app_state["active_model_ids"][symbol] = mid
        metrics = {**metrics, "model_id": mid}
        if name:
            metrics["name"] = name
        app_state["metrics"][symbol] = metrics
    if symbol in app_state["buffers"]:
        save_buffer(symbol, app_state["buffers"][symbol])
    return mid


def train_symbol_model(
    symbol: str,
    algorithm_id: Optional[str] = None,
    label_config: Optional[LabelConfig] = None,
    name: Optional[str] = None,
    set_active: bool = True,
):
    """Train a NEW model version (keeps prior versions on disk)."""
    symbol = symbol.upper()
    lc = label_config or DEFAULT_LABEL_CONFIG
    had_existing_model = symbol in app_state["models"]
    try:
        algo = get_algorithm(algorithm_id)
    except KeyError as e:
        app_state["training_status"][symbol] = "error"
        logger.error(f"[TRAINING] {e}")
        raise

    model_id = new_model_id()
    display_name = name or f"{symbol}-{algo.id}-{model_id[:6]}"

    logger.info(
        f"[TRAINING] Memulai training {symbol} model_id={model_id} "
        f"algo={algo.id} name={display_name} "
        f"(label SL={lc.stop_loss_percent:.2%} TP={lc.take_profit_percent:.2%} "
        f"horizon={lc.max_horizon_candles} candles)..."
    )
    app_state["training_status"][symbol] = "training"

    try:
        df_raw = fetch_historical_candles(symbol, limit=2000)
        if df_raw.empty:
            raise ValueError(
                f"Database kosong untuk {symbol}. Lakukan backfill di NestJS terlebih dahulu."
            )

        app_state["buffers"][symbol] = (
            df_raw.tail(100).copy().reset_index(drop=True)
        )

        df_features = build_features(df_raw)
        if df_features.empty:
            raise ValueError(
                f"Data valid kosong setelah ekstraksi fitur untuk {symbol}."
            )

        df_labeled = add_trade_outcome_label(df_features, lc)
        cols = app_state["feature_cols"]
        train_data = trainable_rows(df_labeled, cols)
        validate_training_dataset(symbol, train_data, lc)
        X = train_data[cols]
        y = train_data["target_binary"]

        logger.info(
            f"[TRAINING] {algo.display_name} {symbol} — {len(X)} baris data"
        )
        model, metrics = algo.train(X, y)

        trained_at = int(time.time() * 1000)
        metrics = {
            **(metrics or {}),
            "algorithm": algo.id,
            "algorithm_name": algo.display_name,
            "trained_at": trained_at,
            "label_config": lc.to_dict(),
            "model_id": model_id,
            "name": display_name,
            **label_summary(train_data),
        }

        promote = set_active or not had_existing_model
        if promote:
            app_state["models"][symbol] = model
            app_state["algorithms"][symbol] = algo.id
            app_state["metrics"][symbol] = metrics
            app_state["trained_at"][symbol] = trained_at
            app_state["feature_cols_by_symbol"][symbol] = list(cols)

        app_state["training_status"][symbol] = "ready"
        app_state["last_training_errors"].pop(symbol, None)

        if promote:
            persist_symbol(
                symbol,
                model_id=model_id,
                name=display_name,
                set_active=True,
            )
        else:
            save_artifact(
                symbol,
                algorithm=algo.id,
                model=model,
                feature_cols=list(cols),
                trained_at=trained_at,
                model_id=model_id,
                name=display_name,
                metrics=metrics,
                set_active=False,
            )
            save_buffer(symbol, app_state["buffers"][symbol])

        acc = metrics.get("accuracy")
        prec = metrics.get("precision_buy")
        acc_str = f"{acc:.4f}" if isinstance(acc, (int, float)) else "n/a"
        prec_str = f"{prec:.4f}" if isinstance(prec, (int, float)) else "n/a"
        logger.info(
            f"[TRAINING] Selesai {symbol} model_id={model_id} ({algo.id}). "
            f"Val accuracy: {acc_str} | precision_buy: {prec_str} | active={promote}"
        )
        return model_id

    except Exception as e:
        if not had_existing_model:
            purge_symbol_from_state(symbol, app_state)
        app_state["training_status"][symbol] = "error"
        app_state["last_training_errors"][symbol] = str(e)
        logger.error(f"[TRAINING] Gagal melatih {symbol}: {str(e)}")
        raise


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("[STARTUP] Memulai inisialisasi ML Engine...")
    loaded = 0
    for symbol in discover_symbols():
        if load_symbol_into_state(symbol, app_state):
            loaded += 1
    logger.info(f"[STARTUP] ML Engine siap. {loaded} model dimuat dari disk.")
    yield
    logger.info("[SHUTDOWN] Menyimpan semua model ke disk...")
    for symbol in list(app_state["models"].keys()):
        persist_symbol(symbol)
    logger.info("[SHUTDOWN] Mematikan ML Engine.")


app = FastAPI(lifespan=lifespan)


@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "models_loaded": len(app_state["models"]),
        "symbols": list(app_state["models"].keys()),
        "training_status": app_state["training_status"],
        "last_training_errors": dict(app_state["last_training_errors"]),
        "algorithms": {
            s: app_state["algorithms"].get(s) for s in app_state["models"]
        },
        "timestamp": datetime.now().isoformat(),
    }


@app.get("/algorithms")
async def get_algorithms():
    return {
        "default": DEFAULT_ALGORITHM,
        "algorithms": list_algorithms(),
    }


@app.post("/train/{symbol}")
async def force_train(
    symbol: str,
    background_tasks: BackgroundTasks,
    body: TrainRequest = TrainRequest(),
):
    symbol = symbol.upper()
    algorithm_id = body.algorithm or DEFAULT_ALGORITHM

    try:
        get_algorithm(algorithm_id)
    except KeyError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if app_state["training_status"].get(symbol) == "training":
        raise HTTPException(
            status_code=409,
            detail=f"Model {symbol} sedang dalam proses training.",
        )

    lc = LabelConfig.from_dict(body.label_config)
    background_tasks.add_task(
        run_train_symbol_model,
        symbol,
        algorithm_id,
        lc,
        body.name,
        body.set_active,
    )

    return {
        "status": "training_started",
        "message": f"Training model {symbol} ({algorithm_id}) dimulai di background.",
        "symbol": symbol,
        "algorithm": algorithm_id,
        "name": body.name,
        "set_active": body.set_active,
        "label_config": lc.to_dict(),
    }


@app.get("/library")
async def model_library():
    """List all versioned models per symbol."""
    return {"libraries": list_all_libraries()}


@app.get("/library/{symbol}")
async def model_library_symbol(symbol: str):
    return list_model_versions(symbol.upper())


@app.post("/library/{symbol}/activate/{model_id}")
async def activate_library_model(symbol: str, model_id: str):
    symbol = symbol.upper()
    try:
        result = activate_model_version(symbol, model_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    # Reload into memory
    load_symbol_into_state(symbol, app_state)
    return {"status": "ok", **result}


@app.delete("/library/{symbol}/{model_id}")
async def delete_library_model(symbol: str, model_id: str):
    symbol = symbol.upper()
    try:
        result = delete_model_version(symbol, model_id)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {"status": "ok", **result}


@app.get("/label-preview/{symbol}")
async def label_preview(
    symbol: str,
    stop_loss_percent: Optional[float] = None,
    take_profit_percent: Optional[float] = None,
    max_horizon_candles: Optional[int] = None,
):
    """Preview label balance before training (uses current Risk SL/TP when omitted)."""
    symbol = symbol.upper()
    overrides = {
        k: v
        for k, v in {
            "stop_loss_percent": stop_loss_percent,
            "take_profit_percent": take_profit_percent,
            "max_horizon_candles": max_horizon_candles,
        }.items()
        if v is not None
    }
    lc = LabelConfig.from_dict(overrides or None)
    return label_preview_stats(symbol, lc)


@app.post("/predict", response_model=PredictionResponse)
async def predict_signal(candle: CandleData):
    symbol = candle.symbol.upper()

    if symbol not in app_state["models"] or symbol not in app_state["buffers"]:
        if not load_symbol_into_state(symbol, app_state):
            raise HTTPException(
                status_code=503,
                detail=(
                    f"Model {symbol} belum dilatih. "
                    "Latih manual dari halaman ML Models terlebih dahulu."
                ),
            )

    if app_state["training_status"].get(symbol) != "ready":
        raise HTTPException(
            status_code=503,
            detail=(
                f"Model {symbol} belum siap "
                f"(status: {app_state['training_status'].get(symbol, 'unknown')})."
            ),
        )

    algo_id = app_state["algorithms"].get(symbol, DEFAULT_ALGORITHM)
    try:
        algo = get_algorithm(algo_id)
    except KeyError:
        # Fallback: raw sklearn-like predict_proba on stored model
        algo = get_algorithm(DEFAULT_ALGORITHM)

    model = app_state["models"][symbol]
    buffer = app_state["buffers"][symbol]

    new_row = pd.DataFrame(
        [
            {
                "startTime": candle.startTime,
                "closeTime": candle.closeTime,
                "open": candle.open,
                "high": candle.high,
                "low": candle.low,
                "close": candle.close,
                "volume": candle.volume,
            }
        ]
    )

    buffer = pd.concat([buffer, new_row], ignore_index=True)
    buffer = buffer.tail(100).reset_index(drop=True)
    app_state["buffers"][symbol] = buffer

    df_features = build_features(buffer)
    if df_features.empty:
        raise HTTPException(
            status_code=500, detail=f"Gagal mengkalkulasi fitur untuk {symbol}."
        )

    cols = feature_cols_for(symbol)
    missing = [c for c in cols if c not in df_features.columns]
    if missing:
        raise HTTPException(
            status_code=500,
            detail=f"Fitur hilang untuk {symbol}: {missing[:5]}",
        )

    latest_row = df_features.iloc[-1]
    latest_features = df_features.iloc[-1:][cols]
    prob_up = prob_up_from_model(model, algo, latest_features)

    atr_percent = (
        float(latest_row.get("feature_atr_percent", 0.0))
        if "feature_atr_percent" in latest_row.index
        else 0.0
    )

    signal, confidence = signal_from_prob_up(prob_up, atr_percent)
    regime_info = detect_regime(latest_row)

    logger.info(
        f"[PREDIKSI] {symbol} | {algo_id} | Sinyal: {signal} | "
        f"Keyakinan: {confidence:.4f} | Prob UP: {prob_up:.4f} | "
        f"Regime: {regime_info['regime']}"
    )

    return PredictionResponse(
        symbol=symbol,
        signal=signal,
        confidence=confidence,
        timestamp=candle.closeTime,
        model_ready=True,
        algorithm=algo_id,
        prob_up=prob_up,
        regime=regime_info["regime"],
        regime_allow_long=regime_info["allow_long"],
        regime_confidence_bump=regime_info["confidence_bump"],
        regime_reason=regime_info["reason"],
    )


@app.get("/model/{symbol}/info")
async def get_model_info(symbol: str):
    symbol = symbol.upper()

    if symbol not in app_state["models"]:
        if not load_symbol_into_state(symbol, app_state):
            raise HTTPException(
                status_code=404, detail=f"Model {symbol} tidak ditemukan."
            )

    model = app_state["models"][symbol]
    buffer = app_state["buffers"].get(symbol, pd.DataFrame())
    algo_id = app_state["algorithms"].get(symbol, DEFAULT_ALGORITHM)
    try:
        algo_name = get_algorithm(algo_id).display_name
    except KeyError:
        algo_name = algo_id

    metrics = app_state["metrics"].get(symbol) or {}
    accuracy = metrics.get("accuracy")
    precision_buy = metrics.get("precision_buy")
    recall_buy = metrics.get("recall_buy")
    f1_buy = metrics.get("f1_buy")
    label_config = metrics.get("label_config")

    def _float_or_none(v):
        if v is None:
            return None
        try:
            f = float(v)
            return f if np.isfinite(f) else None
        except (TypeError, ValueError):
            return None

    accuracy = _float_or_none(accuracy)
    precision_buy = _float_or_none(precision_buy)
    recall_buy = _float_or_none(recall_buy)
    f1_buy = _float_or_none(f1_buy)

    trained_at = app_state["trained_at"].get(symbol) or metrics.get(
        "trained_at"
    )

    return {
        "symbol": symbol,
        "status": app_state["training_status"].get(symbol, "unknown"),
        "algorithm": algo_id,
        "algorithm_name": algo_name,
        "accuracy": accuracy,
        "precision_buy": precision_buy,
        "recall_buy": recall_buy,
        "f1_buy": f1_buy,
        "label_config": label_config,
        "positive_rate": metrics.get("positive_rate"),
        "buffer_size": len(buffer) if buffer is not None else 0,
        "buffer_start_time": (
            int(buffer["closeTime"].iloc[0])
            if buffer is not None and not buffer.empty
            else None
        ),
        "buffer_end_time": (
            int(buffer["closeTime"].iloc[-1])
            if buffer is not None and not buffer.empty
            else None
        ),
        "trained_at": trained_at,
        "model_type": (
            "EnsembleBundle"
            if algo_id == "ensemble"
            else type(model).__name__
        ),
        "feature_count": len(feature_cols_for(symbol)),
        "n_train": metrics.get("n_train"),
        "n_val": metrics.get("n_val"),
        "sub_models": metrics.get("sub_models"),
        "ensemble_members": metrics.get("ensemble_members"),
        "last_training_error": app_state["last_training_errors"].get(symbol),
    }


@app.get("/eval/{symbol}")
async def evaluate_symbol(
    symbol: str,
    min_confidence: float = 0.65,
    holdout_ratio: float = 0.2,
    stop_loss_percent: Optional[float] = None,
    take_profit_percent: Optional[float] = None,
    max_horizon_candles: Optional[int] = None,
):
    """
    Walk-forward holdout eval: classifier metrics + simulated SL/TP backtest
    for ML vs EMA baseline. Not live PnL.
    """
    symbol = symbol.upper()
    lc = LabelConfig.from_dict(
        {
            k: v
            for k, v in {
                "stop_loss_percent": stop_loss_percent,
                "take_profit_percent": take_profit_percent,
                "max_horizon_candles": max_horizon_candles,
            }.items()
            if v is not None
        }
        or None
    )

    if symbol not in app_state["models"]:
        if not load_symbol_into_state(symbol, app_state):
            raise HTTPException(
                status_code=404,
                detail=f"No trained model for {symbol}. Train first.",
            )

    model = app_state["models"][symbol]
    algo_id = app_state["algorithms"].get(symbol, DEFAULT_ALGORITHM)
    algo = get_algorithm(algo_id)
    cols = feature_cols_for(symbol)

    df_raw = fetch_historical_candles(symbol, limit=2000)
    if df_raw.empty:
        raise HTTPException(status_code=404, detail=f"No candle data for {symbol}")

    df_features = build_features(df_raw)
    if df_features.empty:
        raise HTTPException(
            status_code=500, detail=f"Feature build failed for {symbol}"
        )

    df_labeled = filter_labeled_rows(add_trade_outcome_label(df_features, lc))
    if len(df_labeled) < 100:
        raise HTTPException(
            status_code=422,
            detail=f"Insufficient labeled rows for eval ({len(df_labeled)})",
        )

    split_at = walk_forward_holdout_split(len(df_labeled), holdout_ratio)
    holdout = df_labeled.iloc[split_at:].reset_index(drop=True)

    prob_series: list[float] = []
    conf_series: list[float] = []
    pred_binary: list[int] = []

    for i in range(len(holdout)):
        row = holdout.iloc[i : i + 1][cols]
        prob_up = prob_up_from_model(model, algo, row)
        atr = float(holdout.iloc[i].get("feature_atr_percent", 0.0))
        signal, confidence = signal_from_prob_up(prob_up, atr)
        prob_series.append(prob_up)
        conf_series.append(confidence if signal == "BUY" else 0.0)
        pred_binary.append(1 if signal == "BUY" else 0)

    classifier = evaluate_holdout_classifier(
        holdout["target_binary"], np.array(pred_binary)
    )

    prob_arr = np.array(prob_series)
    conf_arr = pd.Series(conf_series)
    ema_flags = ema_crossover_signals(holdout)

    def ml_signal(_df: pd.DataFrame, i: int) -> bool:
        return prob_arr[i] >= buy_threshold(
            float(holdout.iloc[i].get("feature_atr_percent", 0.0))
        )

    ml_backtest = backtest_signals(
        holdout,
        ml_signal,
        config=lc,
        min_confidence=min_confidence,
        confidence_series=conf_arr,
    )

    def baseline_signal(_df: pd.DataFrame, i: int) -> bool:
        return bool(ema_flags.iloc[i])

    baseline_backtest = backtest_signals(holdout, baseline_signal, config=lc)

    def _summary(bt: dict) -> dict:
        return {
            "n_trades": bt.get("n_trades", 0),
            "win_rate": bt.get("win_rate"),
            "avg_return_pct": bt.get("avg_return_pct"),
            "total_return_pct": bt.get("total_return_pct"),
        }

    return {
        "symbol": symbol,
        "algorithm": algo_id,
        "holdout_rows": len(holdout),
        "holdout_ratio": holdout_ratio,
        "min_confidence": min_confidence,
        "label_config": lc.to_dict(),
        "classifier_holdout": classifier,
        "backtest_ml": _summary(ml_backtest),
        "backtest_baseline_ema": _summary(baseline_backtest),
        "disclaimer": (
            "Holdout SL/TP simulation on historical candles — "
            "not live PnL. Retrain required for tp_before_sl labels on old models."
        ),
    }


@app.delete("/model/{symbol}")
async def delete_model(symbol: str):
    """Remove model artifacts from disk and RAM."""
    symbol = symbol.upper()
    if app_state["training_status"].get(symbol) == "training":
        raise HTTPException(
            status_code=409,
            detail=f"Cannot delete {symbol} while training is in progress.",
        )

    had_in_memory = any(
        symbol in store
        for store in (
            app_state["models"],
            app_state["buffers"],
            app_state["metrics"],
            app_state["trained_at"],
            app_state["algorithms"],
            app_state["feature_cols_by_symbol"],
            app_state["training_status"],
        )
    )
    result = delete_symbol_files(symbol)
    purge_symbol_from_state(symbol, app_state)
    app_state["last_training_errors"].pop(symbol, None)

    logger.info(
        f"[DELETE] Model {symbol} dihapus. files={result['removed']}"
    )
    return {
        "status": "ok",
        "symbol": symbol,
        "removed_files": result["removed"],
        "errors": result["errors"],
        "already_absent": not result["removed"] and not had_in_memory,
    }

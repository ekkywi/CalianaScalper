# CalianaScalper — Phase Status Handoff

Last updated: 2026-07-29
Audience: human operator and future AI agents continuing this repo on another machine

This file complements `PROJECT_STATE.md`.
Use this document for the ML roadmap status across Phase 0 to Phase 4.
Also use the playbook below when judging model quality after training.

Prediction and shadow decision logs are persisted in Postgres (`ml_prediction_events`) and survive Nest restarts.

## Current Snapshot

- Product type: spot long-only crypto scalper
- Market timeframe: fixed `15m`
- Main runtime stack:
  - `apps/frontend` = Next.js dashboard
  - `apps/backend` = NestJS orchestration and APIs
  - `services/ml-engine` = FastAPI ML service
  - PostgreSQL = candles, positions, trades, config
- Current branch during this handoff: `main`

## Phase Summary

| Phase | Status | Notes |
|------|--------|-------|
| Phase 0 | Done | Labeling, eval, baseline, ML-to-trade stats, risk-synced train/eval are implemented |
| Phase 1 | Done | Ensemble registry and optional LightGBM fallback behavior are implemented |
| Phase 2 | Done | Regime gate, shadow mode, shadow log panel, delete UX and model training safety fixes are implemented |
| Phase 3 | Not started | Sentiment / LLM overlay is still deferred |
| Phase 4 | Mostly deferred | Alerts, structured logs, advanced metrics, strategies CRUD still not implemented |

---

## Phase 0

### Goal
Make the ML output and evaluation honest and aligned with the bot's actual trade logic.

### Implemented

- Trade-outcome labeling based on `TP hit before SL`, not naive next-candle up/down
- Label config synced from Risk settings during train/eval
- Honest holdout evaluation
- EMA baseline comparison
- BUY-focused metrics:
  - `precision_buy`
  - `recall_buy`
  - `f1_buy`
- ML decision context saved into trades/positions:
  - `mlSignal`
  - `mlConfidence`
  - `mlAlgorithm`
- ML trade stats API and UI

### Important files

- `services/ml-engine/labeling.py`
- `services/ml-engine/label_config.py`
- `services/ml-engine/eval_metrics.py`
- `services/ml-engine/backtest.py`
- `services/ml-engine/baseline.py`
- `apps/backend/src/application/ml/ml.controller.ts`
- `apps/backend/src/infrastructure/database/position.entity.ts`
- `apps/backend/src/infrastructure/database/trade.entity.ts`

### Status

Phase 0 is complete and should be treated as baseline behavior.

---

## Phase 1

### Goal
Upgrade from a single algorithm to a more robust ensemble without changing the bot contract.

### Implemented

- Algorithm plugin structure expanded
- Ensemble model implemented:
  - `xgboost`
  - `lightgbm`
  - `logreg`
- Weighted fusion layer
- Ensemble metrics surfaced in ML UI
- LightGBM made optional:
  - if missing, ensemble falls back to available members

### Important files

- `services/ml-engine/algorithms/__init__.py`
- `services/ml-engine/algorithms/ensemble_clf.py`
- `services/ml-engine/algorithms/xgboost_clf.py`
- `services/ml-engine/algorithms/lightgbm_clf.py`
- `services/ml-engine/algorithms/logreg_clf.py`
- `services/ml-engine/requirements.txt`

### Status

Phase 1 is complete.

### Operational note

For full ensemble behavior, `lightgbm` still needs to exist in the Python environment on the target machine.
If not installed, the service should still run with fallback members.

---

## Phase 2

### Goal
Make the bot more selective and safer when using ML signals.

### Implemented

#### A. Regime-aware gating

- Market regime classification added:
  - `high_vol`
  - `downtrend`
  - `uptrend`
  - `range`
  - `elevated_vol`
  - `neutral`
- Prediction response enriched with:
  - `prob_up`
  - `regime`
  - `regime_allow_long`
  - `regime_confidence_bump`
  - `regime_reason`
- Orchestrator uses regime + confidence bump before executing BUY

#### B. Shadow mode

- Risk config includes:
  - `mlShadowMode`
  - `mlRegimeGateEnabled`
- BUY signals can be logged without execution
- Shadow predictions available via API and panel in ML page
- **Persisted:** ML decisions (predictions + shadow / blocked) are stored in Postgres table `ml_prediction_events` so Predictions and Shadow Log survive Nest restarts (30-day retention prune)

#### B2. Hybrid holding exit (candle-close path)

On every closed candle for an active symbol:

1. **SL/TP first** via `checkPositions` (primary hard exit)
2. **Always ML predict + persist** (flat or holding) so Predictions stay fresh
3. **If OPEN (holding):**
   - `BUY` → ignore (`blockedBy: holding`); no scale-in
   - `HOLD` → keep position; SL/TP remain active
   - `SELL` + confidence ≥ threshold → `flattenAndClose(..., CLOSED_BY_SIGNAL)`; if shadow mode → log would-close only (`blockedBy: shadow_mode`)
4. **If flat:** existing entry path (regime / confidence / pair / shadow gates on BUY)

Out of scope for this step: trailing stop, breakeven, time-stop.

#### C. Model lifecycle safety and UX fixes

- Manual model delete implemented
- Delete is idempotent
- Watchlist delete dialog no longer gets stuck on partial ML delete failures
- `/predict` no longer auto-trains symbols on candle close
- Stale error/training rows are handled more honestly

#### D. Training validation improvements

- Training now validates label balance before fitting
- Timeout rows are excluded from train rows
- Label horizon was extended to align better with the live bot:
  - default `max_horizon_candles = 96`
- Label preview API/UI added
- Last training error is exposed to UI

### Important files

- `services/ml-engine/main.py`
- `services/ml-engine/regime.py`
- `services/ml-engine/labeling.py`
- `services/ml-engine/label_config.py`
- `apps/backend/src/application/orchestrator/market.orchestrator.ts`
- `apps/backend/src/application/ml/ml.controller.ts`
- `apps/backend/src/infrastructure/ml/ml-prediction-log.service.ts`
- `apps/backend/src/infrastructure/database/ml-prediction-event.entity.ts`
- `apps/backend/src/infrastructure/ml/ml-engine.service.ts`
- `apps/backend/src/infrastructure/exchange/binance-rest.service.ts`
- `apps/backend/src/infrastructure/exchange/binance-ws.service.ts`
- `apps/frontend/src/components/monitoring/MlShadowLogPanel.tsx`
- `apps/frontend/src/components/monitoring/MlPredictionDisplay.tsx`
- `apps/frontend/src/components/risk/RiskParametersDashboard.tsx`
- `apps/frontend/src/components/strategy/MlModelManagement.tsx`
- `apps/frontend/src/app/dashboard/ml-models/page.tsx`
- `apps/frontend/src/app/dashboard/page.tsx`

### Status

Phase 2 is complete from implementation standpoint.

### Important operational notes

1. Manual train is still the intended workflow.
2. Symbol add does not mean auto-train.
3. Symbol add now backfills more history for training depth.
4. If training still shows too few positive labels, user should:
   - preview label first
   - reduce TP
   - increase horizon
   - or add more history

---

## Phase 3

### Goal
Add sentiment / LLM as a slow overlay or veto filter, not as the main trading brain.

### Intended scope

- News / sentiment ingestion service
- Sentiment score or label
- Use sentiment as:
  - confidence bump
  - veto
  - HOLD filter
- Fail-open behavior if sentiment system is down

### Status

Not started.

### Important guidance

- Do not put LLM reasoning directly into the hot path of every candle.
- Prefer periodic classification and cached sentiment output.
- Keep the bot contract stable:
  - ML proposes
  - risk and safety still decide

---

## Phase 4

### Goal
Broader production hardening and operator-facing features.

### Deferred / not complete

- Telegram / Discord / email alerts
- Structured log store
- Advanced equity / performance metrics:
  - Sharpe
  - Sortino
  - Calmar
  - equity snapshots
- Strategies CRUD
- Config import/export
- Broader operational tooling

### Partially present

- Basic performance API/UI exists
- Logs page exists but is intentionally honest-empty
- Alerts are still local Zustand alerts only

### Status

Mostly deferred.

---

## How to judge models after training

Training metrics are a **first filter**, not proof of profit. Prefer this order:

1. **Preview label** — only train when the preview shows the model is trainable (enough positive / resolved rows).
2. After status `ready`, read **Prec BUY** first (false BUY is expensive for long-only).
3. Press **Eval** — compare ML holdout vs EMA baseline (win rate / avg return under simulated SL/TP).
4. Test in **paper** or **Shadow mode** before trusting validation numbers alone.
5. Do not treat Val accuracy as the only score. Call a model “good” only when Prec BUY, Eval, and paper/shadow do not conflict.

### Why this order

- Labels are `TP hit before SL` → **Prec BUY** is closest to “BUY that was right”.
- Val accuracy is easy to misread when classes are imbalanced.
- UI already exposes these signals on **ML Models** (`/dashboard/ml-models`):
  - `Val acc`, `Prec BUY`, `Recall BUY`, `F1 BUY`
  - **Eval** (holdout SL/TP sim vs EMA — not live PnL)
  - paper/live ML trade stats / Shadow Log on separate menus
- Phase 2 regime gate + shadow mode should be used to test signal selectivity without placing orders.

### Operator playbook

```text
Preview label → Train → check Prec BUY + Eval → Shadow ON (paper) → review shadow log / paper ML stats → then Shadow OFF
```

### Practical rules

- Prec BUY weak + Eval loses to EMA → do not promote; adjust Risk TP/horizon or retrain.
- Prec BUY looks fine but paper/shadow is poor → model is “smart on labels”, not on execution; hold.
- High Val accuracy with low Prec BUY → watch for false BUY.
- Metrics UI may show `n/a` if training failed (`error`) or the model never persisted metrics — that is not “missing UI”.

UI disclaimer already states validation metrics are **not live PnL**.

---

## Recommended Next Steps

If continuing on another machine, the most logical order is:

1. Verify services start cleanly:
   - frontend
   - backend
   - ml-engine
2. Check training workflow with `Preview label` before `Train`
3. Verify Phase 2 behavior:
   - regime gate
   - shadow mode
   - delete UX
4. Decide whether to start Phase 3 or finish remaining Phase 4 operational features

---

## Quick Verification Checklist

- `GET /api/ml/health`
- `GET /api/ml/models`
- `GET /api/ml/label-preview/:symbol`
- `GET /api/ml/shadow-predictions`
- `GET /api/ml/predictions` (from DB after candle closes; survives restart)
- Risk page shows:
  - regime gate toggle
  - shadow mode toggle
- ML page shows:
  - prediction regime
  - shadow log panel
  - preview label button
  - Val acc / Prec BUY / Recall BUY / Eval on ready models
- After training, follow **How to judge models after training** (Prec BUY → Eval → paper/shadow)

---

## Do Not Forget

- User owns long-running terminals
- Do not start duplicate services unless explicitly asked
- Do not commit churny `*.pkl` model buffers unless asked
- Never enable live trading by default
- Keep `closePosition(symbol, quantity)` calls strictly `quantity > 0`

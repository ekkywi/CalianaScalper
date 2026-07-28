# CalianaScalper — Phase Status Handoff

Last updated: 2026-07-28
Audience: human operator and future AI agents continuing this repo on another machine

This file complements `PROJECT_STATE.md`.
Use this document for the ML roadmap status across Phase 0 to Phase 4.

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
- `apps/backend/src/infrastructure/ml/ml-engine.service.ts`
- `apps/backend/src/infrastructure/ml/ml-shadow.service.ts`
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
- Risk page shows:
  - regime gate toggle
  - shadow mode toggle
- ML page shows:
  - prediction regime
  - shadow log panel
  - preview label button

---

## Do Not Forget

- User owns long-running terminals
- Do not start duplicate services unless explicitly asked
- Do not commit churny `*.pkl` model buffers unless asked
- Never enable live trading by default
- Keep `closePosition(symbol, quantity)` calls strictly `quantity > 0`

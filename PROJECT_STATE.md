# CalianaScalper — Project State Handoff

**Last updated:** 2026-07-28  
**Branch:** `main` (local commits ahead of origin until pushed)  
**Audience:** humans and other AI agents continuing this repo

Use this file as the source of truth for *what already works*. Do not rely on older audit/plan docs that still describe MOCK UI or broken emergency stop.

### Config architecture (4 menus)

| Menu | Scope | Role |
|------|--------|------|
| **Trading Profiles** | Per symbol library | Execution SL / TP / horizon — activate one per symbol |
| **Risk Management** | Global portfolio | Size, daily loss, drawdown, trades, confidence, ML gates — **no live SL/TP** |
| **ML Training** | Train job | Label params **manual** or **from profile** — creates a **new** model version |
| **ML Models** | Per symbol library | Activate / delete versions; does not destroy others |
| **ML Predictions** | Live signals | Latest orchestrator predictions (active model) |
| **ML Shadow Log** | Debug / shadow | Would-be BUY when shadow mode or gates block |

**Pair rule (paper = live):** active profile and active model must match on SL + TP + horizon. Mismatch or incomplete → **warn + block BUY**. Profile create does **not** auto-bind training; train does not auto-create a profile.

Live position SL/TP always come from the **active trading profile** (never from Risk defaults at trade time).

---

## 1. What this product is

| Fact | Value |
|------|--------|
| Style | Spot **long-only** crypto scalper |
| Exchange orders | **Paper** = Binance spot testnet (`setSandboxMode(true)`); **Live** = spot mainnet (gated) |
| Market data | Live Binance spot WebSocket (public mainnet) |
| Timeframe | Fixed **15m** candles |
| Stack | pnpm monorepo: `apps/frontend` (Next.js), `apps/backend` (NestJS :3001), `services/ml-engine` (FastAPI XGBoost :8000), PostgreSQL |

```text
Add active symbol → Binance WS 15m (per symbol) → Nest MarketOrchestrator → ML /predict → risk checks
  → strategy pair guard (profile ↔ model) → ccxt market order (paper|live) → positions/trades in Postgres
  → Socket.IO + REST → Next.js dashboard
```

---

## 2. Key commits (achievements)

| Commit | Summary |
|--------|---------|
| `2f84c15` | Harden exchange flatten; persist halt; live UI wiring; performance/ML/system APIs |
| `d8c5c3a` | Manual orders REST (`/api/orders`) + wire `ManualOrderEntry` |

Earlier: multi-symbol on-demand + Next UI scaffolding (`a3ac093`).

---

## 3. Features that ARE usable today

### Automated bot

- Candle closed → SL/TP check → ML predict+persist (always) → if flat: BUY entry gates; if holding: ignore BUY, optional SELL close (`CLOSED_BY_SIGNAL`)
- Position sizing from risk config + **active profile SL**; max open positions / trades / daily loss / drawdown
- BUY opens LONG after fill; SELL closes LONG while holding (no short when flat)
- **SL/TP:** from active trading profile → monitor → `flattenAndClose` (exchange first, then ledger); primary exit over ML
- **Emergency stop / resume:** halt in `system_config`; flattens with real quantity
- Pre-trade `canOpenPosition`; ledger open failure after fill → emergency flatten attempt
- Symbols CRUD + candle backfill + WS subscribe on demand
- Bot idle until ≥1 active symbol; kline WS does not connect with zero symbols
- **BUY blocked** when strategy pair is incomplete / mismatched (same in paper and live)

### Strategy libraries

- Tables: `trading_profiles`, `ml_model_registry`, `symbol_strategy_bindings` (TypeORM `synchronize: true`)
- APIs under `/api/strategy/*` (profiles CRUD/activate, models sync/activate/delete, train, label-preview, pairs)
- ML engine stores versions under `models/versions/{SYMBOL}/{model_id}/` + hot `{SYMBOL}_artifact.pkl`
- Post-train: Nest polls ML `training_status` then syncs registry + aligns active binding

### Trading mode (Paper / Live)

- Banner + switcher; mode in `system_config` key `trading_mode`
- `GET/PUT /api/system/trading-mode`, `GET /api/system/balance`, health includes `tradingMode`
- Socket.IO: `trading-mode-changed`
- Env: testnet keys, mainnet keys, `ALLOW_LIVE_TRADING`, `TRADING_MODE_DEFAULT=paper`
- Cannot switch with open positions/orders; paper→live requires confirm `"LIVE"`

### Dashboard (live data — no MOCK_* panels)

- Watchlist + symbol chart
- **Trading Profiles / Risk / ML Training / ML Models** (four menus)
- Positions + Real-time PnL; close one / all / update SL-TP
- Trade history + basic performance (`/api/performance/*`) — Sharpe/Sortino/Calmar **n/a**
- Predictions, shadow log, system health, manual MARKET/LIMIT orders
- Notifications: Zustand alerts only; logs page honest empty

### WebSocket contract

- Gateway emits: `realtime-price`, `candle-closed`, `position-opened`, `position-closed`, `trading-halted`, `trading-resumed`, `risk-breached`, `trading-mode-changed`
- Frontend must listen to **`realtime-price`** (not `candle_tick`)

---

## 4. What is NOT done / deferred

| Item | Status |
|------|--------|
| Futures / SHORT | Not supported |
| Mainnet live trading | **Gated** — needs `ALLOW_LIVE_TRADING=true` + mainnet keys |
| Manual STOP_LOSS order type | Rejected; use position SL/TP |
| Strategies marketplace CRUD | Deferred (profile/model libraries cover execution pairing) |
| Telegram / Discord / email alerts | Deferred |
| Structured system log store | Deferred |
| Real Sharpe / Sortino / Calmar / equity snapshots | Deferred |
| Config import-export UI | Deferred stubs |
| Separate DB ledgers per mode | Not done — switch blocked while flat only |

Do **not** re-add fabricated MOCK numbers to look “complete”.

---

## 5. Important files

| Area | Path |
|------|------|
| Orchestrator + pair guard | `apps/backend/src/application/orchestrator/market.orchestrator.ts` |
| Strategy service | `apps/backend/src/infrastructure/strategy/strategy.service.ts` |
| Strategy API | `apps/backend/src/application/strategy/strategy.controller.ts` |
| Entities | `trading-profile.entity.ts`, `ml-model-registry.entity.ts`, `symbol-strategy-binding.entity.ts` |
| Risk / positions | `apps/backend/src/infrastructure/risk/position-manager.service.ts` |
| Execution | `apps/backend/src/infrastructure/exchange/binance-execution.service.ts` |
| Trading mode | `apps/backend/src/application/system/trading-mode.service.ts` |
| Frontend strategy client | `apps/frontend/src/services/api-strategy.ts` |
| UI pages | `apps/frontend/src/app/dashboard/{trading-profiles,risk,ml-training,ml-models}/` |
| ML engine + version store | `services/ml-engine/main.py`, `model_store.py` |

Critical invariant: `BinanceExecutionService.closePosition(symbol, quantity)` requires **quantity > 0**. Never call with `0`.

---

## 6. How to run (operator owns terminals)

Do not start duplicate processes if the user already runs them.

1. PostgreSQL (env in `apps/backend/.env`)
2. ML: `cd services/ml-engine && source venv/bin/activate && uvicorn main:app --host 127.0.0.1 --port 8000`
3. Backend: `cd apps/backend && pnpm run start:dev` → `:3001`
4. Frontend: `cd apps/frontend && pnpm run dev` → `:3000`

```bash
curl -s http://127.0.0.1:3001/api/system/health
curl -s http://127.0.0.1:3001/api/strategy/pairs
curl -s http://127.0.0.1:8000/health
curl -s http://127.0.0.1:8000/library
```

---

## 7. Conventions for future AI work

1. **User owns long-running service terminals.** Do not bind `3000`/`3001`/`8000` unless asked.
2. Prefer HTTP checks against already-running services.
3. Safety > cosmetics: exchange flatten, pair guard, Live gates.
4. Do not commit churny `*.pkl` buffers unless asked.
5. Never enable Live without kill-switch + mainnet keys.
6. Keep profile ≠ training; match only on activate/pair.

---

## 8. Definition of done (MVP bot)

- Candle → ML → sandbox order → DB position matches exchange intent  
- SL/TP and kill switch sell on testnet  
- Profile + model libraries with BUY block on mismatch  
- Dashboard trading pages show live or honest empty  
- Paper/Live visible and switchable with safety gates  

**Not** required: Discord alerts, Sharpe ratios, strategy marketplace, unlocked mainnet by default.

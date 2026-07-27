# CalianaScalper — Project State Handoff

**Last updated:** 2026-07-27  
**Branch:** `main` (local commits ahead of origin until pushed)  
**Audience:** humans and other AI agents continuing this repo

Use this file as the source of truth for *what already works*. Do not rely on older audit/plan docs that still describe MOCK UI or broken emergency stop.

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
  → ccxt market order (paper testnet | live mainnet) → positions/trades in Postgres
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

- Candle closed → ML signal (BUY/SELL/HOLD) → confidence gate → trade
- Position sizing from risk config; max open positions / trades per day / daily loss / drawdown
- BUY opens LONG in DB after fill; SELL closes LONG (no short in spot mode)
- **SL/TP:** monitor price → `flattenAndClose` (market sell on exchange, then ledger + trade row)
- **Emergency stop / resume:** halt flag persisted in `system_config`; flattens open positions with real quantity
- Pre-trade `canOpenPosition`; if ledger open fails after fill → attempt emergency flatten
- Symbols CRUD + candle backfill + WS subscribe **on demand** (no BTCUSDT fallback when watchlist empty)
- Bot stays **idle** until at least one active symbol exists in DB; kline WS does not connect with zero symbols

### Trading mode (Paper / Live)

- Global banner + switcher in root layout (`TradingModeBanner`)
- Mode persisted in `system_config` key `trading_mode`
- `GET/PUT /api/system/trading-mode`, `GET /api/system/balance`, health includes `tradingMode`
- Socket.IO: `trading-mode-changed`
- Env:
  - `BINANCE_TESTNET_API_KEY/SECRET` (fallback: legacy `BINANCE_API_*`)
  - `BINANCE_MAINNET_API_KEY/SECRET`
  - `ALLOW_LIVE_TRADING=false` (must be `true` to enable Live)
  - `TRADING_MODE_DEFAULT=paper`
- Safety: cannot switch with open positions/orders; paper→live requires confirm body `"LIVE"`
- Manual Order Entry shows free USDT + estimated cost (`price × qty`); qty is **base asset**

### Dashboard (live data — no MOCK_* panels)

- Watchlist + symbol chart (Binance + backend symbols)
- Risk parameter sliders (`GET/PUT /api/risk/config`)
- Positions + Real-time PnL (`GET /api/risk/positions`)
- Position management: close one / close all / update SL-TP
- Trade history + basic performance stats (`/api/performance/*`) — Sharpe/Sortino/Calmar shown as **n/a**
- ML model list / retrain / last predictions (`/api/ml/*` Nest proxy → Python)
- System health (`GET /api/system/health`)
- Manual orders MARKET/LIMIT (`POST /api/orders`) — BUY opens LONG; SELL closes or reduces LONG
- Notifications: Zustand alerts only (e.g. emergency stop); no fake alert feed
- Logs page: honest empty (no structured log store yet)

### WebSocket contract

- Gateway emits: `realtime-price`, `candle-closed`, `position-opened`, `position-closed`, `trading-halted`, `trading-resumed`, `risk-breached`, `trading-mode-changed`
- Frontend must listen to **`realtime-price`** (not `candle_tick`)

---

## 4. What is NOT done / deferred

| Item | Status |
|------|--------|
| Futures / SHORT | Not supported |
| Mainnet live trading | **Gated** — needs `ALLOW_LIVE_TRADING=true` + mainnet keys; default remains paper |
| Manual STOP_LOSS order type | Rejected; use position SL/TP |
| Strategies CRUD | Deferred |
| Telegram / Discord / email alerts | Deferred |
| Structured system log store | Deferred |
| Real Sharpe / Sortino / Calmar / equity snapshots engine | Deferred (basic PnL from `trades` only) |
| Config import-export UI APIs | Deferred stubs in client |
| Separate DB ledgers per mode | Not done — switch blocked while flat only |

Do **not** re-add fabricated MOCK numbers to look “complete”.

---

## 5. Important files

| Area | Path |
|------|------|
| Orchestrator | `apps/backend/src/application/orchestrator/market.orchestrator.ts` |
| Risk / positions | `apps/backend/src/infrastructure/risk/position-manager.service.ts` |
| Execution | `apps/backend/src/infrastructure/exchange/binance-execution.service.ts` |
| Market WS (kline) | `apps/backend/src/infrastructure/exchange/binance-ws.service.ts` |
| Trading mode | `apps/backend/src/application/system/trading-mode.service.ts` |
| Orders API | `apps/backend/src/application/orders/` |
| Risk API | `apps/backend/src/application/risk/` |
| Performance / ML / System APIs | `apps/backend/src/application/{performance,ml,system}/` |
| UI gateway | `apps/backend/src/presentation/gateway/ui.gateway.ts` |
| Mode banner | `apps/frontend/src/components/layout/TradingModeBanner.tsx` |
| Frontend API client | `apps/frontend/src/services/api-extended.ts` |
| ML engine | `services/ml-engine/main.py` |
| Entities | `position.entity.ts`, `trade.entity.ts`, `system-config.entity.ts`, `order.entity.ts` |

Critical invariant: `BinanceExecutionService.closePosition(symbol, quantity)` requires **quantity > 0**. Never call with `0`.

---

## 6. How to run (operator owns terminals)

Do not start duplicate processes if the user already runs them.

1. PostgreSQL (env in `apps/backend/.env`: `DB_*`, `BINANCE_TESTNET_*` / `BINANCE_API_*`, optional mainnet + `ALLOW_LIVE_TRADING`)
2. ML: `cd services/ml-engine && source venv/bin/activate && uvicorn main:app --host 127.0.0.1 --port 8000`
3. Backend: `cd apps/backend && pnpm run start:dev` → `:3001`
4. Frontend: `cd apps/frontend && pnpm run dev` → `:3000`

Quick checks:

```bash
curl -s http://127.0.0.1:3001/api/system/health
curl -s http://127.0.0.1:3001/api/system/trading-mode
curl -s http://127.0.0.1:3001/api/system/balance
curl -s http://127.0.0.1:8000/health
```

---

## 7. Conventions for future AI work

1. **User owns long-running service terminals.** Agents should not bind `3000`/`3001`/`8000` unless explicitly asked (avoids EADDRINUSE fights).
2. Prefer verifying with HTTP against already-running services.
3. Safety > cosmetics: exchange flatten and risk must stay correct.
4. Do not commit churny `*.pkl` buffers unless the user asks.
5. Never enable Live without explicit env kill-switch + mainnet keys.
6. Phase-4 remaining items: one domain per PR (in-app event alerts, log store, metrics engine, strategies).

---

## 8. Definition of done (already met for MVP bot)

- Candle → ML → sandbox order → DB position matches exchange intent  
- SL/TP and kill switch actually sell on testnet  
- Dashboard trading pages show live or honest empty state  
- Paper/Live mode is visible and switchable with safety gates  

**Not** required for MVP: Discord alerts, Sharpe ratios, strategy marketplace, unlocked mainnet by default.

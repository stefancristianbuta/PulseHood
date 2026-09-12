# PulseHood

PulseHood is a Robinhood Chain momentum radar and paper-trading engine.

V1 is paper-only. Live execution stays disabled until the complete execution, risk, circuit-breaker, and test layers are verified.

## Chain

Robinhood Chain mainnet uses chain ID 4663 and ETH for gas.

The application supports multiple HTTP RPC providers and multiple WebSocket feeds. The public RPC and sequencer feed are development fallbacks only. Production deployments should use provider endpoints and health-ranked redundancy.

## Core strategy

Momentum score:
25% price acceleration
25% volume acceleration
20% buy pressure
15% unique buyers
10% liquidity
5% breakout

Momentum bands:
80+ candidate
85+ strong
90+ exceptional

Risk policy:
0-30 tradable
31-50 watch
51+ reject

Entry requires:
Momentum >= 80
Risk <= 30
Minimum liquidity
Minimum unique-buyer score
Buy pressure >= 62%
Positive volume acceleration
Confirmed breakout

The scanner must distinguish broad organic buyer activity from repeated activity by a small number of wallets.

## Execution model

Paper execution uses an executable quote rather than the displayed market price.

Each fill records:
DEX fee
Gas cost
Slippage
Price impact
Execution price
Execution latency

Gas cost is calculated from gas estimate, gas price, and the quoted native-token USD price.

The execution interface is shared so a future live adapter can replace the paper adapter without changing strategy code. Live mode is guarded by both TRADING_MODE=live and LIVE_ENABLED=true.

## DEX routing

The registry is dynamic. Initial discovery targets the main active Robinhood Chain venues and can be expanded as market data changes.

DEX score:
35% volume
25% liquidity
20% execution latency
10% price impact
10% recent activity

For an entry, the router will compare executable quotes and select the best net outcome instead of blindly selecting a single DEX.

## Exit model

There is no fixed take-profit target.

The position tracks price and momentum high-water marks. Strong momentum keeps the position open. Momentum deterioration or volume deterioration tightens the trailing distance. Severe momentum deterioration or a trailing breach produces a sell decision.

Position lifecycle:
DISCOVERED -> QUALIFIED -> SIGNAL -> ENTRY -> OPEN -> TRAILING -> EXIT_SIGNAL -> CLOSED

## Telemetry

Every important operation carries a correlation ID. Events include event ID, timestamp, module, token, transaction hash when available, block, latency, status, and structured payload.

Opportunity IDs are intended to make scanner-to-execution behavior traceable end to end.

## Current implementation

Implemented foundation:
config and safety gates
multi-RPC health ranking
correlated telemetry bus
momentum and risk policies
DEX scoring registry
paper execution engine
momentum-driven exit policy
CI build and test workflow

Next modules:
sequencer feed adapter
ERC-20 and DEX event decoding
pool discovery and price engine
wallet and unique-buyer engine
quote adapters for the active DEXs
position manager
circuit breakers
API
mobile-first web UI
replay and backtesting

## Development

Copy .env.example to .env and keep all provider credentials out of Git.

npm ci
npm run build
npm test
npm run dev

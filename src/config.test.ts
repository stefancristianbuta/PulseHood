import assert from 'node:assert/strict';
import test from 'node:test';
import { CHAIN, loadConfig } from './config.js';

test('defaults to paper mode and redundant Robinhood Chain RPC endpoints', () => {
  const config = loadConfig({});
  assert.equal(config.chainId, 4663);
  assert.equal(config.tradingMode, 'paper');
  assert.equal(config.liveEnabled, false);
  assert.deepEqual(config.rpcUrls, [
    'https://rpc.mainnet.chain.robinhood.com',
    'https://rpc-robinhood.blockmachine.io',
    'https://robinhood-mainnet-rpc.blockreq.com/v1/rpc/public',
  ]);
  assert.deepEqual(config.wsUrls, ['wss://feed.mainnet.chain.robinhood.com']);
});

test('parses redundant RPC and websocket providers', () => {
  const config = loadConfig({
    RPC_URLS: ' https://rpc-a.example ,https://rpc-b.example ',
    WS_URLS: ' wss://ws-a.example,wss://ws-b.example ',
    PAPER_CAPITAL_USD: '25000',
    MAX_RPC_LATENCY_MS: '500',
    MAX_BLOCK_LAG: '2',
  });
  assert.deepEqual(config.rpcUrls, ['https://rpc-a.example', 'https://rpc-b.example']);
  assert.deepEqual(config.wsUrls, ['wss://ws-a.example', 'wss://ws-b.example']);
  assert.equal(config.paperCapitalUsd, 25_000);
  assert.equal(config.maxRpcLatencyMs, 500);
  assert.equal(config.maxBlockLag, 2);
  assert.equal(config.chainId, CHAIN.id);
});

test('never allows live mode without the explicit live gate', () => {
  assert.throws(() => loadConfig({ TRADING_MODE: 'live', LIVE_ENABLED: 'false' }), /LIVE_ENABLED=true/);
  assert.equal(loadConfig({ TRADING_MODE: 'live', LIVE_ENABLED: 'true' }).tradingMode, 'live');
});

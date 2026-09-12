import assert from 'node:assert/strict';
import { encodeFunctionData, encodeEventTopics, parseAbi, toHex } from 'viem';
import { test } from 'node:test';
import {
  AbiRegistry,
  EventDecoder,
  TransactionDecoder,
  type LogEnvelope,
  type TransactionEnvelope,
} from './decoder.js';

const abi = parseAbi([
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)',
  'event Swap(address indexed sender, address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut)',
]);

const router = '0x0000000000000000000000000000000000001000' as const;
const txHash = `0x${'11'.repeat(32)}` as const;
const sender = '0x0000000000000000000000000000000000002000' as const;
const tokenIn = '0x0000000000000000000000000000000000003000' as const;
const tokenOut = '0x0000000000000000000000000000000000004000' as const;

function transaction(input: `0x${string}`): TransactionEnvelope {
  return {
    hash: txHash,
    from: sender,
    to: router,
    input,
    value: 0n,
    blockNumber: 100n,
    blockTimestamp: 1_000n,
  };
}

test('decodes a registered transaction', () => {
  const registry = new AbiRegistry();
  registry.register({ address: router, protocol: 'test-dex', abi });
  const decoder = new TransactionDecoder(registry);

  const input = encodeFunctionData({
    abi,
    functionName: 'swapExactTokensForTokens',
    args: [1_000n, 900n, [tokenIn, tokenOut], sender, 2_000n],
  });

  const result = decoder.decode(transaction(input));

  assert.equal(result.status, 'decoded');
  assert.equal(result.protocol, 'test-dex');
  assert.equal(result.functionName, 'swapExactTokensForTokens');
  assert.equal(result.args?.[0], 1_000n);
});

test('returns unknown for an unregistered address', () => {
  const decoder = new TransactionDecoder(new AbiRegistry());
  const result = decoder.decode(transaction(toHex('0x')));

  assert.equal(result.status, 'unknown');
  assert.equal(result.reason, 'address_not_registered');
});

test('decodes a registered event log', () => {
  const registry = new AbiRegistry();
  registry.register({ address: router, protocol: 'test-dex', abi });
  const decoder = new EventDecoder(registry);

  const topics = encodeEventTopics({
    abi,
    eventName: 'Swap',
    args: { sender, tokenIn, tokenOut },
  });

  const log: LogEnvelope = {
    address: router,
    data: `0x${'00'.repeat(64)}`,
    topics: [...topics],
    blockNumber: 100n,
    transactionHash: txHash,
    logIndex: 0,
  };

  const result = decoder.decode(log);

  assert.equal(result.status, 'decoded');
  assert.equal(result.eventName, 'Swap');
  assert.equal(result.protocol, 'test-dex');
});

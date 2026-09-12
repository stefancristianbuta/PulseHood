import type { DecodedEvent } from './decoder.js';

export type SwapDirection = 'BUY' | 'SELL' | 'UNKNOWN';

export interface PoolDescriptor {
  address: `0x${string}`;
  token0: `0x${string}`;
  token1: `0x${string}`;
  targetToken: `0x${string}`;
}

export interface NormalizedSwap {
  status: 'normalized' | 'unsupported' | 'invalid';
  protocol: string | undefined;
  eventName: string | undefined;
  pool: `0x${string}`;
  transactionHash: `0x${string}`;
  logIndex: number;
  direction: SwapDirection;
  targetToken: `0x${string}`;
  quoteToken: `0x${string}` | undefined;
  amountIn: bigint | undefined;
  amountOut: bigint | undefined;
  reason: string | undefined;
}

function address(value: unknown): `0x${string}` | undefined {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value)
    ? value as `0x${string}`
    : undefined;
}

function integer(value: unknown): bigint | undefined {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isInteger(value)) return BigInt(value);
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value);
  return undefined;
}

function isNamedArgs(value: readonly unknown[] | Record<string, unknown> | undefined): value is Record<string, unknown> {
  return value !== undefined && !Array.isArray(value);
}

function baseSwap(pool: PoolDescriptor, direction: SwapDirection, quoteToken: `0x${string}` | undefined, amountIn: bigint | undefined, amountOut: bigint | undefined): NormalizedSwap {
  return {
    status: 'normalized',
    protocol: undefined,
    eventName: undefined,
    direction,
    targetToken: pool.targetToken,
    quoteToken,
    amountIn,
    amountOut,
    pool: pool.address,
    transactionHash: '' as `0x${string}`,
    logIndex: 0,
    reason: undefined,
  };
}

function directSwap(args: Record<string, unknown>, pool: PoolDescriptor): NormalizedSwap | undefined {
  const tokenIn = address(args.tokenIn);
  const tokenOut = address(args.tokenOut);
  const amountIn = integer(args.amountIn);
  const amountOut = integer(args.amountOut);
  if (tokenIn === undefined || tokenOut === undefined || amountIn === undefined || amountOut === undefined) return undefined;

  const target = pool.targetToken.toLowerCase();
  const input = tokenIn.toLowerCase();
  const output = tokenOut.toLowerCase();
  const direction: SwapDirection = output === target ? 'BUY' : input === target ? 'SELL' : 'UNKNOWN';
  const quoteToken = output === target ? tokenIn : input === target ? tokenOut : undefined;
  return baseSwap(pool, direction, quoteToken, amountIn, amountOut);
}

function uniswapV2Swap(args: Record<string, unknown>, pool: PoolDescriptor): NormalizedSwap | undefined {
  const amount0In = integer(args.amount0In);
  const amount1In = integer(args.amount1In);
  const amount0Out = integer(args.amount0Out);
  const amount1Out = integer(args.amount1Out);
  if ([amount0In, amount1In, amount0Out, amount1Out].some((value) => value === undefined)) return undefined;

  const targetIs0 = pool.targetToken.toLowerCase() === pool.token0.toLowerCase();
  const targetIn = targetIs0 ? amount0In! : amount1In!;
  const targetOut = targetIs0 ? amount0Out! : amount1Out!;
  const quoteIn = targetIs0 ? amount1In! : amount0In!;
  const quoteOut = targetIs0 ? amount1Out! : amount0Out!;

  const direction: SwapDirection = targetOut > 0n && quoteIn > 0n
    ? 'BUY'
    : targetIn > 0n && quoteOut > 0n
      ? 'SELL'
      : 'UNKNOWN';

  return baseSwap(
    pool,
    direction,
    targetIs0 ? pool.token1 : pool.token0,
    direction === 'BUY' ? quoteIn : direction === 'SELL' ? targetIn : undefined,
    direction === 'BUY' ? targetOut : direction === 'SELL' ? quoteOut : undefined,
  );
}

function uniswapV3Swap(args: Record<string, unknown>, pool: PoolDescriptor): NormalizedSwap | undefined {
  const amount0 = integer(args.amount0);
  const amount1 = integer(args.amount1);
  if (amount0 === undefined || amount1 === undefined) return undefined;

  const targetIs0 = pool.targetToken.toLowerCase() === pool.token0.toLowerCase();
  const targetAmount = targetIs0 ? amount0 : amount1;
  const quoteAmount = targetIs0 ? amount1 : amount0;
  const direction: SwapDirection = targetAmount < 0n && quoteAmount > 0n
    ? 'BUY'
    : targetAmount > 0n && quoteAmount < 0n
      ? 'SELL'
      : 'UNKNOWN';

  return baseSwap(
    pool,
    direction,
    targetIs0 ? pool.token1 : pool.token0,
    direction === 'BUY' ? quoteAmount : direction === 'SELL' ? targetAmount : undefined,
    direction === 'BUY' ? -targetAmount : direction === 'SELL' ? -quoteAmount : undefined,
  );
}

export function normalizeSwapEvent(event: DecodedEvent, pool: PoolDescriptor): NormalizedSwap {
  if (event.status !== 'decoded') {
    return {
      status: 'invalid',
      protocol: event.protocol,
      eventName: event.eventName,
      pool: pool.address,
      transactionHash: event.transactionHash,
      logIndex: event.logIndex,
      direction: 'UNKNOWN',
      targetToken: pool.targetToken,
      quoteToken: undefined,
      amountIn: undefined,
      amountOut: undefined,
      reason: event.reason ?? 'event_not_decoded',
    };
  }

  if (!isNamedArgs(event.args)) {
    return {
      status: 'unsupported',
      protocol: event.protocol,
      eventName: event.eventName,
      pool: pool.address,
      transactionHash: event.transactionHash,
      logIndex: event.logIndex,
      direction: 'UNKNOWN',
      targetToken: pool.targetToken,
      quoteToken: undefined,
      amountIn: undefined,
      amountOut: undefined,
      reason: 'named_event_arguments_required',
    };
  }

  const normalized = event.eventName === 'Swap'
    ? directSwap(event.args, pool) ?? uniswapV2Swap(event.args, pool) ?? uniswapV3Swap(event.args, pool)
    : undefined;

  if (normalized === undefined) {
    return {
      status: 'unsupported',
      protocol: event.protocol,
      eventName: event.eventName,
      pool: pool.address,
      transactionHash: event.transactionHash,
      logIndex: event.logIndex,
      direction: 'UNKNOWN',
      targetToken: pool.targetToken,
      quoteToken: undefined,
      amountIn: undefined,
      amountOut: undefined,
      reason: 'unsupported_swap_shape',
    };
  }

  return {
    ...normalized,
    protocol: event.protocol,
    eventName: event.eventName,
    transactionHash: event.transactionHash,
    logIndex: event.logIndex,
  };
}

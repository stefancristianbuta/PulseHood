export interface ConstantProductQuote {
  amountIn: bigint;
  amountOut: bigint;
  feeAmount: bigint;
  reserveIn: bigint;
  reserveOut: bigint;
  reserveInAfter: bigint;
  reserveOutAfter: bigint;
  priceImpactBps: number;
}

export function quoteConstantProduct(
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
  feeBps = 30,
): ConstantProductQuote {
  if (amountIn <= 0n) throw new Error('amountIn must be positive');
  if (reserveIn <= 0n || reserveOut <= 0n) throw new Error('reserves must be positive');
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps >= 10_000) throw new Error('feeBps must be between 0 and 9999');

  const feeDenominator = 10_000n;
  const feeNumerator = feeDenominator - BigInt(feeBps);
  const amountInAfterFee = amountIn * feeNumerator / feeDenominator;
  const feeAmount = amountIn - amountInAfterFee;
  if (amountInAfterFee <= 0n) throw new Error('amountIn is too small after fees');

  const amountOut = reserveOut * amountInAfterFee / (reserveIn + amountInAfterFee);
  if (amountOut <= 0n || amountOut >= reserveOut) throw new Error('quote has no executable output');

  // Price impact measures only the AMM curve impact. The protocol fee is
  // accounted for separately through feeAmount and must not be double-counted.
  const noImpactOutput = reserveOut * amountInAfterFee / reserveIn;
  const priceImpactBps = noImpactOutput > 0n
    ? Number((noImpactOutput - amountOut) * 10_000n / noImpactOutput)
    : 10_000;

  return {
    amountIn,
    amountOut,
    feeAmount,
    reserveIn,
    reserveOut,
    reserveInAfter: reserveIn + amountIn,
    reserveOutAfter: reserveOut - amountOut,
    priceImpactBps: Math.max(0, Math.min(10_000, priceImpactBps)),
  };
}

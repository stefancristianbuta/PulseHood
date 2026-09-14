import fs from 'node:fs';

const swapPath = new URL('../src/swap-event.ts', import.meta.url);
let swap = fs.readFileSync(swapPath, 'utf8');
swap = swap.replace("trader?: `0x${string}`; reason", "trader?: `0x${string}`; token0?: `0x${string}`; token1?: `0x${string}`; reason");
fs.writeFileSync(swapPath, swap);

const radarPath = new URL('../src/radar-ingest.ts', import.meta.url);
let radar = fs.readFileSync(radarPath, 'utf8');
radar = radar.replace("pool:V4_MANAGER!,poolId:id as `0x${string}`,transactionHash:log.transactionHash,", "pool:V4_MANAGER!,poolId:id as `0x${string}`,token0:p.token0,token1:p.token1,transactionHash:log.transactionHash,");
radar = radar.replace("pool:V4_MANAGER!,transactionHash:log.transactionHash,", "pool:V4_MANAGER!,poolId:id as `0x${string}`,token0:p.token0,token1:p.token1,transactionHash:log.transactionHash,");
fs.writeFileSync(radarPath, radar);

const runtimePath = new URL('../src/trading-runtime.ts', import.meta.url);
let runtime = fs.readFileSync(runtimePath, 'utf8');
runtime = runtime.replace("const market = await this.readMarket(swap.protocol, swap.pool, swap.targetToken, swap.quoteToken);", "const market = await this.readMarket(swap.protocol, swap.pool, swap.targetToken, swap.quoteToken, swap.poolId, swap.token0, swap.token1);");
runtime = runtime.replace("private async readMarket(protocol: string | undefined, pool: Addr, target: Addr, quote: Addr | undefined): Promise<PoolMarket | undefined> {", "private async readMarket(protocol: string | undefined, pool: Addr, target: Addr, quote: Addr | undefined, poolId?: Addr | `0x${string}`, token0?: Addr, token1?: Addr): Promise<PoolMarket | undefined> {");
runtime = runtime.replace("const key = `${protocol ?? V2_PROTOCOL}:${pool.toLowerCase()}:${target.toLowerCase()}:${quote.toLowerCase()}`;", "const key = `${protocol ?? V2_PROTOCOL}:${pool.toLowerCase()}:${target.toLowerCase()}:${quote.toLowerCase()}:${poolId ?? ''}`;");
runtime = runtime.replace("const request = protocol === 'uniswap-v3' ? this.readV3Market(pool, target, quote) : this.readV2Market(pool, target, quote);", "const request = protocol === 'uniswap-v4' ? this.readV4Market(target, quote, poolId as `0x${string}` | undefined, token0, token1) : protocol === 'uniswap-v3' ? this.readV3Market(pool, target, quote) : this.readV2Market(pool, target, quote);");
const bad = /  private async readV4Market\([\s\S]*?  private async readV2Market\(pool: Addr, target: Addr, quote: Addr \| undefined\): Promise<PoolMarket \| undefined> \{/;
const good = `  private async readV4Market(target: Addr, quote: Addr | undefined, poolId?: \`0x\${string}\`, token0?: Addr, token1?: Addr): Promise<PoolMarket | undefined> {
    if (quote === undefined || poolId === undefined || token0 === undefined || token1 === undefined) return undefined;
    try {
      const stateView = '0xf3334192d15450cdd385c8b70e03f9a6bd9e673b' as Addr;
      const abi = [
        { type: 'function', name: 'getSlot0', stateMutability: 'view', inputs: [{ name: 'poolId', type: 'bytes32' }], outputs: [{ type: 'uint160' }, { type: 'int24' }, { type: 'uint24' }, { type: 'uint24' }] },
        { type: 'function', name: 'getLiquidity', stateMutability: 'view', inputs: [{ name: 'poolId', type: 'bytes32' }], outputs: [{ type: 'uint128' }] },
      ] as const;
      const [slot0, liquidity, targetDecimals, quoteDecimals] = await Promise.all([
        this.client.readContract({ address: stateView, abi, functionName: 'getSlot0', args: [poolId] }),
        this.client.readContract({ address: stateView, abi, functionName: 'getLiquidity', args: [poolId] }),
        this.client.readContract({ address: target, abi: ERC20, functionName: 'decimals' }),
        this.client.readContract({ address: quote, abi: ERC20, functionName: 'decimals' }),
      ]);
      const sqrtPriceX96 = (slot0 as readonly [bigint, number, number, number])[0];
      const liquidityRaw = liquidity as bigint;
      if (liquidityRaw <= 0n || sqrtPriceX96 <= 0n) return undefined;
      const pRaw = Number(sqrtPriceX96) ** 2 / 2 ** 192;
      const L = Number(liquidityRaw);
      if (!Number.isFinite(pRaw) || pRaw <= 0 || !Number.isFinite(L) || L <= 0) return undefined;
      const targetIs0 = token0.toLowerCase() === target.toLowerCase();
      if (token1.toLowerCase() !== quote.toLowerCase() && !targetIs0) return undefined;
      const quoteUsd = normalizedQuotePrice(quote);
      const d0 = Number(targetIs0 ? targetDecimals : quoteDecimals);
      const d1 = Number(targetIs0 ? quoteDecimals : targetDecimals);
      const priceUsd = targetIs0 ? pRaw * 10 ** (d0 - d1) * quoteUsd : (1 / pRaw) * 10 ** (d1 - d0) * quoteUsd;
      if (!Number.isFinite(priceUsd) || priceUsd <= 0) return undefined;
      const sqrtP = Number(sqrtPriceX96) / 2 ** 96;
      const decimals0 = Number(targetIs0 ? targetDecimals : quoteDecimals);
      const decimals1 = Number(targetIs0 ? quoteDecimals : targetDecimals);
      const virtual0 = L / sqrtP / 10 ** decimals0;
      const virtual1 = L * sqrtP / 10 ** decimals1;
      const liquidityUsd = targetIs0 ? virtual0 * priceUsd + virtual1 * quoteUsd : virtual0 * quoteUsd + virtual1 * priceUsd;
      return { liquidityUsd: finite(liquidityUsd), priceUsd: finite(priceUsd), quotePriceUsd: quoteUsd };
    } catch { return undefined; }
  }

  private async readV2Market(pool: Addr, target: Addr, quote: Addr | undefined): Promise<PoolMarket | undefined> {`;
if (bad.test(runtime)) runtime = runtime.replace(bad, good);
fs.writeFileSync(runtimePath, runtime);
console.log(JSON.stringify({event:'v4_market_patch',stateView:true,poolId:true,poolTokens:true,price:true,liquidity:true}));

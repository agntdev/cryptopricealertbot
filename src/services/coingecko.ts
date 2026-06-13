/**
 * CoinGecko price service.
 *
 * Fetches the current USD price and the 24h percentage change for the two
 * supported coins in a single batched request. See docs/details.md §3.
 */
import { COIN_SYMBOLS, SUPPORTED_COINS, VS_CURRENCY } from "../config";
import type { Coin } from "../types";

export interface PriceQuote {
  price: number;
  /** CoinGecko's `*_24h_change` value (signed percentage). */
  change24h: number;
}

export type Prices = Record<Coin, PriceQuote>;

/** Raised on any failure to obtain usable price data; callers skip the cycle. */
export class PriceFetchError extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "PriceFetchError";
    this.cause = cause;
  }
}

const BASE_URL =
  process.env.COINGECKO_API_BASE ?? "https://api.coingecko.com/api/v3";

/**
 * Fetch prices + 24h change for BTC and TON in one call. Throws
 * `PriceFetchError` on network failure, non-2xx, malformed JSON, or missing
 * fields. No retries — the monitor retries on its next interval.
 */
export async function fetchPrices(): Promise<Prices> {
  const ids = COIN_SYMBOLS.map((s) => SUPPORTED_COINS[s]).join(",");
  const url =
    `${BASE_URL}/simple/price?ids=${ids}` +
    `&vs_currencies=${VS_CURRENCY}&include_24hr_change=true`;

  let body: unknown;
  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) {
      throw new PriceFetchError(`CoinGecko returned HTTP ${res.status}`);
    }
    body = await res.json();
  } catch (err) {
    if (err instanceof PriceFetchError) throw err;
    throw new PriceFetchError("CoinGecko request failed", err);
  }

  const data = body as Record<string, Record<string, number> | undefined>;
  const out = {} as Prices;
  for (const symbol of COIN_SYMBOLS) {
    const id = SUPPORTED_COINS[symbol];
    const entry = data?.[id];
    const price = entry?.[VS_CURRENCY];
    const change = entry?.[`${VS_CURRENCY}_24h_change`];
    if (typeof price !== "number" || typeof change !== "number") {
      throw new PriceFetchError(`Missing price data for ${symbol} (${id})`);
    }
    out[symbol] = { price, change24h: change };
  }
  return out;
}

/**
 * Static configuration and constants.
 * See docs/details.md §1.
 */
import type { Coin } from "./types";

/** CoinGecko ids for the only two supported assets (BTC, TON). */
export const SUPPORTED_COINS: Record<Coin, string> = {
  BTC: "bitcoin",
  TON: "the-open-network",
};

/** Convenience list of supported coin symbols. */
export const COIN_SYMBOLS = Object.keys(SUPPORTED_COINS) as Coin[];

/** Fiat currency prices are quoted in. */
export const VS_CURRENCY = "usd";

/** Price-poll cadence for the background monitor (ms). */
export const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 60_000);

/** Upper bound for a user-supplied percentage threshold. */
export const MAX_THRESHOLD_PCT = 1000;

/** Type guard: is the (already upper-cased) symbol one we support? */
export function isSupportedCoin(value: string): value is Coin {
  return Object.prototype.hasOwnProperty.call(SUPPORTED_COINS, value);
}

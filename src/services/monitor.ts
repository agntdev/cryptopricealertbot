/**
 * Price monitor — polls CoinGecko, records snapshots, evaluates each enabled
 * alert against its threshold, and DMs the user when it fires.
 * See docs/details.md §5–6.
 */
import type { Bot } from "grammy";
import type { Ctx } from "../index";
import type { Repository } from "../storage/repository";
import { COIN_SYMBOLS, POLL_INTERVAL_MS } from "../config";
import type { Coin } from "../types";
import { fetchPrices } from "./coingecko";

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** Build the alert DM body (symbol, price, signed 24h change, UTC timestamp). */
export function formatAlertMessage(
  symbol: Coin,
  price: number,
  change24h: number,
  at: Date,
): string {
  const arrow = change24h >= 0 ? "▲" : "▼";
  const sign = change24h >= 0 ? "+" : "";
  const priceStr = price.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const stamp =
    `${at.getUTCFullYear()}-${pad2(at.getUTCMonth() + 1)}-${pad2(at.getUTCDate())} ` +
    `${pad2(at.getUTCHours())}:${pad2(at.getUTCMinutes())}`;
  return [
    `🚨 ${symbol} Price Alert`,
    `Price: $${priceStr}`,
    `Change (24h): ${arrow} ${sign}${change24h.toFixed(1)}%`,
    `Time: ${stamp} UTC`,
  ].join("\n");
}

/**
 * Run one monitoring cycle. Skips silently (no DMs) if the price fetch fails,
 * so a CoinGecko outage never crashes the loop.
 */
export async function runMonitorCycle(
  bot: Bot<Ctx>,
  repo: Repository,
): Promise<void> {
  let prices;
  try {
    prices = await fetchPrices();
  } catch (err) {
    console.error("[monitor] price fetch failed; skipping cycle", err);
    return;
  }

  for (const symbol of COIN_SYMBOLS) {
    repo.recordSnapshot(symbol, prices[symbol].price, prices[symbol].change24h);
  }

  for (const alert of repo.listEnabledAlerts()) {
    const quote = prices[alert.cryptoSymbol];
    if (Math.abs(quote.change24h) < alert.thresholdPct) continue;
    try {
      await bot.api.sendMessage(
        alert.userTelegramId,
        formatAlertMessage(
          alert.cryptoSymbol,
          quote.price,
          quote.change24h,
          new Date(),
        ),
      );
      // Re-arm from the just-notified price (no post-trigger suppression).
      repo.updateLastMonitoredPrice(alert.id, quote.price);
    } catch (err) {
      console.error(
        `[monitor] failed to DM user ${alert.userTelegramId}`,
        err,
      );
    }
  }
}

/** Start the recurring monitor. Returns the timer handle. */
export function startMonitor(
  bot: Bot<Ctx>,
  repo: Repository,
  intervalMs: number = POLL_INTERVAL_MS,
): ReturnType<typeof setInterval> {
  return setInterval(() => {
    void runMonitorCycle(bot, repo);
  }, intervalMs);
}

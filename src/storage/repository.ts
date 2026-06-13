/**
 * Persistence layer for the Crypto Price Alert Bot.
 *
 * `createRepository()` returns a fresh in-memory store — the harness default
 * (see docs/details.md §2). `makeBot()` creates one repository per call so the
 * test harness gets isolated state per spec. A SQLite-backed implementation of
 * the same `Repository` interface (matching storage/schema.sql) can be swapped
 * in for production without touching callers.
 */
import { COIN_SYMBOLS, SUPPORTED_COINS } from "../config";
import type { Alert, Coin, Snapshot } from "../types";

export interface CryptoRow {
  symbol: Coin;
  coingeckoId: string;
}

export interface Repository {
  /** Insert the user if absent. Idempotent. */
  upsertUser(telegramId: number): void;

  getCrypto(symbol: Coin): CryptoRow | undefined;
  listCryptos(): CryptoRow[];

  /**
   * Create or update the single alert for (user, coin). Sets enabled = true and
   * seeds last_monitored_price from the latest snapshot when not already set.
   */
  upsertAlert(telegramId: number, symbol: Coin, thresholdPct: number): Alert;

  listAlerts(telegramId: number, opts?: { enabledOnly?: boolean }): Alert[];

  /** Disable a user's alert for a coin. Returns true if a row changed. */
  disableAlert(telegramId: number, symbol: Coin): boolean;

  /** Every enabled alert across all users (monitor input). */
  listEnabledAlerts(): Alert[];

  recordSnapshot(symbol: Coin, price: number, change24hPct: number): Snapshot;
  latestSnapshot(symbol: Coin): Snapshot | undefined;

  updateLastMonitoredPrice(alertId: number, price: number): void;
}

function nowIso(): string {
  return new Date().toISOString();
}

function last<T>(arr: T[]): T | undefined {
  return arr.length ? arr[arr.length - 1] : undefined;
}

export function createRepository(): Repository {
  const users = new Map<number, { telegramId: number; createdAt: string }>();
  const cryptos = new Map<Coin, CryptoRow>(
    COIN_SYMBOLS.map((s) => [s, { symbol: s, coingeckoId: SUPPORTED_COINS[s] }]),
  );
  const alerts = new Map<number, Alert>();
  const snapshots: Snapshot[] = [];
  let alertSeq = 0;

  function findAlert(telegramId: number, symbol: Coin): Alert | undefined {
    for (const a of alerts.values()) {
      if (a.userTelegramId === telegramId && a.cryptoSymbol === symbol) return a;
    }
    return undefined;
  }

  return {
    upsertUser(telegramId) {
      if (!users.has(telegramId)) {
        users.set(telegramId, { telegramId, createdAt: nowIso() });
      }
    },

    getCrypto(symbol) {
      return cryptos.get(symbol);
    },

    listCryptos() {
      return [...cryptos.values()];
    },

    upsertAlert(telegramId, symbol, thresholdPct) {
      const existing = findAlert(telegramId, symbol);
      const latest = last(snapshots.filter((s) => s.cryptoSymbol === symbol));
      if (existing) {
        existing.thresholdPct = thresholdPct;
        existing.enabled = true;
        if (existing.lastMonitoredPrice === null && latest) {
          existing.lastMonitoredPrice = latest.price;
        }
        return existing;
      }
      const alert: Alert = {
        id: ++alertSeq,
        userTelegramId: telegramId,
        cryptoSymbol: symbol,
        thresholdPct,
        lastMonitoredPrice: latest ? latest.price : null,
        enabled: true,
        createdAt: nowIso(),
      };
      alerts.set(alert.id, alert);
      return alert;
    },

    listAlerts(telegramId, opts) {
      const enabledOnly = opts?.enabledOnly ?? false;
      return [...alerts.values()].filter(
        (a) =>
          a.userTelegramId === telegramId && (!enabledOnly || a.enabled),
      );
    },

    disableAlert(telegramId, symbol) {
      const alert = findAlert(telegramId, symbol);
      if (!alert || !alert.enabled) return false;
      alert.enabled = false;
      return true;
    },

    listEnabledAlerts() {
      return [...alerts.values()].filter((a) => a.enabled);
    },

    recordSnapshot(symbol, price, change24hPct) {
      const snap: Snapshot = {
        cryptoSymbol: symbol,
        price,
        change24hPct,
        capturedAt: nowIso(),
      };
      snapshots.push(snap);
      return snap;
    },

    latestSnapshot(symbol) {
      return last(snapshots.filter((s) => s.cryptoSymbol === symbol));
    },

    updateLastMonitoredPrice(alertId, price) {
      const alert = alerts.get(alertId);
      if (alert) alert.lastMonitoredPrice = price;
    },
  };
}

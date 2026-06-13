/**
 * Shared domain types for the Crypto Price Alert Bot.
 * See docs/design.md §1.5 (data model) and docs/details.md §1.
 */

/** The only two supported assets. */
export type Coin = "BTC" | "TON";

/** Conversation step held in the per-chat session. */
export type Step = "idle" | "awaiting_coin" | "awaiting_percent";

/** Per-chat session state, wired by createBot()'s session middleware. */
export interface Session {
  step: Step;
  /** In-progress wizard data carried between messages. */
  draft: { coin?: Coin };
}

/** Fresh session for a new chat (passed to createBot as `initial`). */
export const initialSession = (): Session => ({ step: "idle", draft: {} });

/** A user's configured alert for one coin. */
export interface Alert {
  id: number;
  userTelegramId: number;
  cryptoSymbol: Coin;
  /** Percentage move that triggers a notification. */
  thresholdPct: number;
  /** Last price we measured this alert against; null until first seen. */
  lastMonitoredPrice: number | null;
  enabled: boolean;
  createdAt: string;
}

/** A recorded price observation used for alert evaluation. */
export interface Snapshot {
  cryptoSymbol: Coin;
  price: number;
  change24hPct: number;
  capturedAt: string;
}

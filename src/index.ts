/**
 * Crypto Price Alert Bot — entry point.
 *
 * Exposes the mandatory `makeBot()` factory the test harness imports. It must
 * return a FRESH bot on every call (never a module-level singleton), so the
 * harness gets isolated state per spec. See docs/details.md §1.
 */
import { createBot, type BotContext } from "@agntdev/bot-toolkit";
import { initialSession, type Session } from "./types";

/** Bot context with our typed session attached. */
export type Ctx = BotContext<Session>;

/**
 * Build a fresh bot instance. `createBot` wires the grammY Bot, the session
 * middleware (using `initialSession`), and the error boundary for us.
 *
 * Feature tasks (FEAT_*) register their command and flow handlers here.
 */
export function makeBot() {
  const bot = createBot<Session>(process.env.BOT_TOKEN!, {
    initial: initialSession,
  });

  // Command + flow handlers are wired by the feature tasks.

  return bot;
}

// Standalone run (outside the harness): start long polling.
if (require.main === module) {
  makeBot().start();
}

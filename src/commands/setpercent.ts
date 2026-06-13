/**
 * /setpercent command — set the percentage threshold for the selected coin,
 * and capture a bare number sent while in the awaiting_percent step.
 * See docs/details.md §4.3–4.4.
 */
import type { Bot } from "grammy";
import type { Ctx } from "../index";
import type { Repository } from "../storage/repository";
import { MAX_THRESHOLD_PCT } from "../config";

/** Parse a positive percentage; null if invalid. */
function parseThreshold(raw: string): number | null {
  const n = Number(raw.trim());
  if (!Number.isFinite(n) || n <= 0 || n > MAX_THRESHOLD_PCT) return null;
  return n;
}

async function applyThreshold(
  ctx: Ctx,
  repo: Repository,
  raw: string,
): Promise<void> {
  const userId = ctx.from?.id;
  if (userId === undefined) return;

  const coin = ctx.session.draft.coin;
  if (!coin) {
    await ctx.reply("Pick a coin first with /setcrypto.");
    return;
  }

  const pct = parseThreshold(raw);
  if (pct === null) {
    // Keep the coin + step so the user can simply retry the number.
    await ctx.reply("That's not a valid %. Send a positive number like 5 or 2.5.");
    return;
  }

  repo.upsertUser(userId);
  repo.upsertAlert(userId, coin, pct);
  ctx.session.step = "idle";
  ctx.session.draft = {};
  await ctx.reply(
    `🔔 Alert set: ${coin} ±${pct}%. I'll DM you whenever ${coin}'s 24h move ` +
      `reaches ${pct}%. Add another with /setcrypto, or see all with /alerts.`,
  );
}

export function registerSetPercent(bot: Bot<Ctx>, repo: Repository): void {
  bot.command("setpercent", async (ctx) => {
    const arg = typeof ctx.match === "string" ? ctx.match : "";
    await applyThreshold(ctx, repo, arg);
  });

  // Bare number sent during the setup wizard (no command prefix).
  bot.on("message:text", async (ctx, next) => {
    const text = ctx.message.text;
    if (ctx.session.step !== "awaiting_percent" || text.startsWith("/")) {
      return next();
    }
    await applyThreshold(ctx, repo, text);
  });
}

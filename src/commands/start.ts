/**
 * /start command — register the user, greet, and prompt for coin selection.
 * See docs/details.md §4.1.
 */
import type { Bot } from "grammy";
import { inlineButton, inlineKeyboard } from "@agntdev/bot-toolkit";
import type { Ctx } from "../index";
import type { Repository } from "../storage/repository";

export const WELCOME_TEXT = [
  "👋 Welcome to Crypto Price Alert Bot!",
  "I DM you when BTC or TON moves past a % you choose.",
  "Which coin do you want to track?",
].join("\n");

/** Inline keyboard offering the two supported coins. */
export function coinKeyboard() {
  return inlineKeyboard([
    [inlineButton("BTC", "coin:BTC"), inlineButton("TON", "coin:TON")],
  ]);
}

export function registerStart(bot: Bot<Ctx>, repo: Repository): void {
  bot.command("start", async (ctx) => {
    if (ctx.from) repo.upsertUser(ctx.from.id);
    ctx.session.step = "awaiting_coin";
    ctx.session.draft = {};
    await ctx.reply(WELCOME_TEXT, { reply_markup: coinKeyboard() });
  });
}

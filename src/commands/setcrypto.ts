/**
 * /setcrypto command — choose which coin to track, via argument or inline
 * buttons. Also handles the shared `coin:<SYM>` callback used by /start.
 * See docs/details.md §4.2.
 */
import type { Bot } from "grammy";
import { inlineButton, inlineKeyboard } from "@agntdev/bot-toolkit";
import type { Ctx } from "../index";
import type { Repository } from "../storage/repository";
import { isSupportedCoin } from "../config";
import type { Coin } from "../types";

const CHOOSE_COIN = "Which coin do you want to track?";

function promptPercent(coin: Coin): string {
  return `✅ Tracking ${coin}. Now send the % change that should trigger an alert (e.g. 5 for ±5%).`;
}

function coinKeyboard() {
  return inlineKeyboard([
    [inlineButton("BTC", "coin:BTC"), inlineButton("TON", "coin:TON")],
  ]);
}

function selectCoin(ctx: Ctx, coin: Coin): void {
  ctx.session.draft.coin = coin;
  ctx.session.step = "awaiting_percent";
}

export function registerSetCrypto(bot: Bot<Ctx>, repo: Repository): void {
  bot.command("setcrypto", async (ctx) => {
    if (ctx.from) repo.upsertUser(ctx.from.id);
    const arg = (typeof ctx.match === "string" ? ctx.match : "")
      .trim()
      .toUpperCase();

    if (!arg) {
      ctx.session.step = "awaiting_coin";
      await ctx.reply(CHOOSE_COIN, { reply_markup: coinKeyboard() });
      return;
    }
    if (!isSupportedCoin(arg)) {
      await ctx.reply("I only track BTC and TON.");
      return;
    }
    selectCoin(ctx, arg);
    await ctx.reply(promptPercent(arg));
  });

  // Shared coin-selection callback (also fired from /start's keyboard).
  bot.callbackQuery(["coin:BTC", "coin:TON"], async (ctx) => {
    const coin = ctx.callbackQuery.data.split(":")[1] as Coin;
    if (ctx.from) repo.upsertUser(ctx.from.id);
    selectCoin(ctx, coin);
    await ctx.answerCallbackQuery();
    await ctx.reply(promptPercent(coin));
  });
}

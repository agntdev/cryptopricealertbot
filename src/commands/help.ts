/**
 * /help command — static command reference. See docs/details.md §4.6.
 */
import type { Bot } from "grammy";
import type { Ctx } from "../index";

export const HELP_TEXT = [
  "Crypto Price Alert Bot — commands:",
  "",
  "/start — register and choose a coin to track",
  "/setcrypto [BTC|TON] — pick which coin to track",
  "/setpercent [X] — set the % move that triggers an alert",
  "/alerts — list your active alerts",
  "/removealert [BTC|TON] — remove an alert",
  "/help — show this message",
].join("\n");

export function registerHelp(bot: Bot<Ctx>): void {
  bot.command("help", async (ctx) => {
    await ctx.reply(HELP_TEXT);
  });
}

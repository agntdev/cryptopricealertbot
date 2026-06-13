/**
 * /alerts and /removealert commands — list and disable a user's alerts.
 * See docs/details.md §4.5.
 */
import type { Bot } from "grammy";
import type { Ctx } from "../index";
import type { Repository } from "../storage/repository";
import { isSupportedCoin } from "../config";

function formatPrice(price: number | null): string {
  if (price === null) return "—";
  return (
    "$" +
    price.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

export function registerAlerts(bot: Bot<Ctx>, repo: Repository): void {
  bot.command("alerts", async (ctx) => {
    const userId = ctx.from?.id;
    if (userId === undefined) return;

    const alerts = repo.listAlerts(userId, { enabledOnly: true });
    if (alerts.length === 0) {
      await ctx.reply("You have no active alerts. Start with /setcrypto.");
      return;
    }
    const lines = alerts.map(
      (a) =>
        `• ${a.cryptoSymbol} — ±${a.thresholdPct}% (last seen ${formatPrice(
          a.lastMonitoredPrice,
        )})`,
    );
    await ctx.reply(
      ["Your active alerts:", ...lines, "Remove one with /removealert BTC."].join(
        "\n",
      ),
    );
  });

  bot.command("removealert", async (ctx) => {
    const userId = ctx.from?.id;
    if (userId === undefined) return;

    const arg = (typeof ctx.match === "string" ? ctx.match : "")
      .trim()
      .toUpperCase();
    if (!arg || !isSupportedCoin(arg)) {
      await ctx.reply("Usage: /removealert BTC or /removealert TON.");
      return;
    }
    const changed = repo.disableAlert(userId, arg);
    await ctx.reply(
      changed
        ? `🗑️ ${arg} alert removed.`
        : `You don't have an active ${arg} alert.`,
    );
  });
}

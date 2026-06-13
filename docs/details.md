# Crypto Price Alert Bot — Details Spec

The concrete, per-command behaviour contract for the Dev phase. It refines
[`docs/design.md`](./design.md) into exact inputs, validation, session
transitions, persistence effects, and output copy, and maps each behaviour to a
task key in [`docs/work_breakdown.json`](./work_breakdown.json).

Conventions used below:
- **Session** = `ctx.session` (`{ step, draft }`), wired by `createBot`
  (`@agntdev/bot-toolkit`). `draft` holds in-progress wizard data: `{ coin? }`.
- **Repo** = the persistence layer (`FEAT_STORAGE`): `users`, `cryptos`,
  `user_alerts`, `price_snapshots`.
- **Coin** ∈ `{ "BTC", "TON" }` only. Symbols are upper-cased before matching.
- All bot replies are sent with `await` (grammY); all `callback_query`
  handlers end with `ctx.answerCallbackQuery()`.

---

## 1. Foundation (`F00`)

Establishes the skeleton everything else builds on.

- `package.json` (deps: `grammy`, `@agntdev/bot-toolkit`; devDeps: `typescript`,
  test harness), `tsconfig.json`.
- `src/index.ts` exports **`export function makeBot()`** — the harness contract.
  It calls `createBot<Session>(process.env.BOT_TOKEN!, { initial })`, registers
  commands + flow handlers, and returns a **fresh** bot per call (never a
  module-level singleton). A `require.main === module` guard starts the monitor
  and `bot.start()` for standalone runs.
- `src/config.ts`: `SUPPORTED_COINS` (BTC→`bitcoin`, TON→`the-open-network`),
  `POLL_INTERVAL_MS` (default `60000`), `MAX_THRESHOLD_PCT` (`1000`),
  `VS_CURRENCY` (`usd`).
- `src/types.ts`: `Coin`, `Session = { step: Step; draft: { coin?: Coin } }`,
  `Step = "idle" | "awaiting_coin" | "awaiting_percent"`, `Alert`, `Snapshot`.
- `initial(): Session => ({ step: "idle", draft: {} })`.

Acceptance: `makeBot()` returns a bot with no handlers crashing; importing the
module has no side effects.

---

## 2. Persistence (`FEAT_STORAGE`)

Schema (`storage/schema.sql`) and a repository module. SQLite in prod; the
harness default is in-memory.

| Table | Columns | Constraints |
|---|---|---|
| `users` | `telegram_id` INTEGER PK, `created_at` TEXT | one row per Telegram user |
| `cryptos` | `symbol` TEXT PK, `coingecko_id` TEXT | seeded with BTC + TON only |
| `user_alerts` | `id` PK, `user_telegram_id` FK, `crypto_symbol` FK, `threshold_pct` REAL, `last_monitored_price` REAL NULL, `enabled` INTEGER, `created_at` TEXT | **UNIQUE(`user_telegram_id`, `crypto_symbol`)** |
| `price_snapshots` | `id` PK, `crypto_symbol` FK, `price` REAL, `change_24h_pct` REAL, `captured_at` TEXT | history for evaluation |

Repository methods (exact contract for callers):
- `upsertUser(telegramId)` — insert if absent; idempotent.
- `getCrypto(symbol)` / `listCryptos()` — read seed rows.
- `upsertAlert(telegramId, symbol, thresholdPct)` — insert or update on the
  unique pair; sets `enabled = 1`; returns the alert. Seeds
  `last_monitored_price` from the latest snapshot if available.
- `listAlerts(telegramId, { enabledOnly })` — user's alerts.
- `disableAlert(telegramId, symbol)` — sets `enabled = 0`; returns whether a row
  changed.
- `listEnabledAlerts()` — all enabled alerts across users (monitor input).
- `recordSnapshot(symbol, price, change24h)` and `latestSnapshot(symbol)`.
- `updateLastMonitoredPrice(alertId, price)`.

Seed runs at startup: ensure `cryptos` has BTC + TON; never add others.

---

## 3. CoinGecko Price Service (`FEAT_PRICES`)

`services/coingecko.ts`:
- `fetchPrices(): Promise<Record<Coin, { price: number; change24h: number }>>`
- One batched call:
  `GET /api/v3/simple/price?ids=bitcoin,the-open-network&vs_currencies=usd&include_24hr_change=true`.
- Maps `bitcoin`→BTC, `the-open-network`→TON; `change24h` from
  `*_24h_change`.
- On non-2xx / network error / malformed body: **throw** a typed error. Callers
  (the monitor) catch it and skip the cycle. No retries within a cycle.

---

## 4. Commands

### 4.1 `/start` (`FEAT_START`)

- **Trigger:** `bot.command("start")`.
- **Effect:** `repo.upsertUser(ctx.from.id)`.
- **Reply:** welcome text explaining the bot, then an inline keyboard
  `[ BTC ] [ TON ]` with `callback_data` `coin:BTC` / `coin:TON`.
- **Session:** `step = "awaiting_coin"`, `draft = {}`.
- **Copy:**
  > 👋 Welcome to Crypto Price Alert Bot!
  > I DM you when BTC or TON moves past a % you choose.
  > Which coin do you want to track?

### 4.2 `/setcrypto [BTC|TON]` (`FEAT_SETCRYPTO`)

Shares the coin-pick callback with `/start`.

- **With valid arg** (`/setcrypto btc`, case-insensitive):
  - Set `draft.coin = "BTC"`, `step = "awaiting_percent"`.
  - Reply: `✅ Tracking BTC. Now send the % change that should trigger an alert (e.g. 5 for ±5%).`
- **With no/invalid arg:** reply prompt + inline keyboard `[ BTC ] [ TON ]`,
  `step = "awaiting_coin"`.
- **Unsupported symbol** (e.g. `ETH`): reply `I only track BTC and TON.` — no
  state change.
- **Callback `coin:<SYM>`** (from `/start` or here): set `draft.coin`,
  `step = "awaiting_percent"`, edit/reply the "now send the %" prompt, then
  `answerCallbackQuery()`.

### 4.3 `/setpercent [X]` (`FEAT_SETPERCENT`)

- **Precondition:** `draft.coin` is set. If not → reply
  `Pick a coin first with /setcrypto.` and stop.
- **Parsing of X** (from arg, or from free text when `step==="awaiting_percent"`):
  - Accept positive decimals (`5`, `2.5`). Reject: non-numeric, `≤ 0`,
    `> MAX_THRESHOLD_PCT`.
  - On invalid: reply `That's not a valid %. Send a positive number like 5 or 2.5.`
    Keep `draft.coin` and `step` unchanged (user can retry).
- **Effect (valid):** `repo.upsertAlert(ctx.from.id, draft.coin, X)`; this
  creates or updates the single alert for that (user, coin) pair and seeds
  `last_monitored_price`.
- **Session:** reset to `step = "idle"`, clear `draft.coin`.
- **Reply:** `🔔 Alert set: BTC ±5%. I'll DM you whenever BTC's 24h move reaches 5%. Add another with /setcrypto, or see all with /alerts.`

### 4.4 Free-text threshold capture (`FEAT_SETPERCENT` / flow)

A plain text message (no command) is treated as the threshold **only** when
`step === "awaiting_percent"`, applying §4.3 parsing. In any other step,
unrecognized text gets a gentle `Try /help to see what I can do.`

### 4.5 `/alerts` and `/removealert [COIN]` (`FEAT_ALERTS`)

- **`/alerts`:** `repo.listAlerts(id, { enabledOnly: true })`.
  - Non-empty: one line per alert `• BTC — ±5% (last seen $63,420)`, then a hint
    `Remove one with /removealert BTC.`
  - Empty: `You have no active alerts. Start with /setcrypto.`
- **`/removealert [COIN]`:** parse + validate coin (BTC/TON).
  `repo.disableAlert(id, coin)`.
  - Changed: `🗑️ BTC alert removed.`
  - Nothing to remove: `You don't have an active BTC alert.`
  - Missing/invalid arg: `Usage: /removealert BTC or /removealert TON.`

### 4.6 `/help` (`FEAT_HELP`)

Static reference listing `/start`, `/setcrypto`, `/setpercent`, `/alerts`,
`/removealert`, `/help` with one-line descriptions.

---

## 5. Price Monitor (`FEAT_MONITOR`)

`services/monitor.ts` exports `startMonitor(bot)` which runs every
`POLL_INTERVAL_MS`. Not started under the test harness (only in the
`require.main` guard or when explicitly invoked by a spec).

Per cycle:
1. `prices = await coingecko.fetchPrices()`. On throw: `log` + `return`
   (skip cycle; no DMs).
2. For each coin: `repo.recordSnapshot(coin, price, change24h)`.
3. `alerts = repo.listEnabledAlerts()`.
4. For each alert, with `change = prices[coin].change24h`:
   - **Fires when** `Math.abs(change) >= alert.threshold_pct`.
   - On fire: send the alert DM (§6) to `alert.user_telegram_id`, then
     `repo.updateLastMonitoredPrice(alert.id, price)`.
5. **No suppression:** a fired alert re-arms immediately; it can fire again on
   the next qualifying cycle (per `general.md` Non-goals).

Each `sendMessage` is wrapped so a single failed DM (e.g. user blocked the bot)
does not abort the rest of the batch.

---

## 6. Alert DM Format

Required fields from `general.md`: symbol, current price, signed 24h % change,
timestamp.

```
🚨 {SYMBOL} Price Alert
Price: ${price, 2dp, thousands-separated}
Change (24h): {▲ +X.X% | ▼ -X.X%}
Time: {YYYY-MM-DD HH:mm} UTC
```

`▲` for `change >= 0`, `▼` for `change < 0`. Percentage printed with sign and
one decimal.

---

## 7. Error & Edge Behaviour (cross-cutting)

| Case | Behaviour | Owner |
|---|---|---|
| `/setpercent` before coin chosen | "Pick a coin first with /setcrypto." | `FEAT_SETPERCENT` |
| Unsupported coin | "I only track BTC and TON." | `FEAT_SETCRYPTO` |
| Threshold ≤ 0, non-numeric, or > max | Re-prompt, keep coin/step | `FEAT_SETPERCENT` |
| CoinGecko unreachable | Skip cycle, log, retry next interval | `FEAT_MONITOR` |
| Unknown command / stray text | Nudge to `/help` | `FEAT_HELP` / flow |
| Re-running setup for a coin | Updates existing alert (UNIQUE pair) | `FEAT_STORAGE` |
| `answerCallbackQuery` | Always called in callback handlers | `FEAT_START` / `FEAT_SETCRYPTO` |

---

## 8. Traceability

| Design.md element | Details § | work_breakdown key |
|---|---|---|
| `makeBot()` factory, config, types | §1 | `F00` |
| Data model (User/Crypto/UserAlert/PriceSnapshot) | §2 | `FEAT_STORAGE` |
| CoinGecko 24h change source | §3 | `FEAT_PRICES` |
| `/start` onboarding | §4.1 | `FEAT_START` |
| `/setcrypto` flow | §4.2 | `FEAT_SETCRYPTO` |
| `/setpercent` flow | §4.3–4.4 | `FEAT_SETPERCENT` |
| `/alerts`, `/removealert` | §4.5 | `FEAT_ALERTS` |
| `/help` | §4.6 | `FEAT_HELP` |
| PriceMonitor loop + DM dispatch | §5–6 | `FEAT_MONITOR` |
| Non-goals (BTC/TON only, repeat alerts, no groups/charts/payments) | §5, §7 | enforced across all |

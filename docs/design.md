# Crypto Price Alert Bot — Design Document

This document specifies the architecture, the full command set, and the
conversation/UX flows for the Crypto Price Alert Bot described in
[`docs/general.md`](./general.md). It is the contract the Dev and Tests phases
build against.

The bot notifies a Telegram user by direct message whenever **Bitcoin (BTC)**
or **TON** moves by a user-defined percentage threshold. Each user can run
multiple independent alerts (e.g. `BTC 5%`, `TON 3%`) and tune sensitivity per
coin.

---

## 1. Architecture

### 1.1 Stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript | Toolkit + harness are typed |
| Bot framework | [grammY](https://grammy.dev) | Idiomatic Bot API wrapper |
| Harness wrapper | `@agntdev/bot-toolkit` (`createBot` / `makeBot`) | Session + error boundary wired for the tokenless test harness |
| Price source | CoinGecko REST API | Free real-time BTC/TON market data |
| Persistence | SQLite via a `StorageAdapter` (session) + a small repository layer | Survives restarts; harness defaults to in-memory |
| Scheduler | `setInterval` poller inside the process | Continuous monitoring without external infra |

The bot is a single long-running Node process. In dev/harness it long-polls;
in production it can be switched to a webhook. No public URL is required for the
core design.

### 1.2 Component map

```
┌──────────────────────────────────────────────────────────────┐
│                         makeBot() factory                      │
│                       (src/index.ts export)                    │
│                                                                │
│   createBot<Session>(BOT_TOKEN, { initial, storage, onError }) │
└───────────────┬───────────────────────────────┬───────────────┘
                │                                 │
        Update pipeline                    Background scheduler
        (grammY middleware)                (PriceMonitor loop)
                │                                 │
   ┌────────────┴───────────┐          ┌──────────┴───────────┐
   │  commands/  flows/      │          │  services/coingecko  │
   │  /start /setcrypto      │          │  services/monitor    │
   │  /setpercent /alerts …  │          │  (fetch → diff →      │
   └────────────┬───────────┘          │   notify)             │
                │                       └──────────┬───────────┘
                ▼                                   ▼
        ┌───────────────────────────────────────────────┐
        │   storage/ repositories (User, UserAlert,       │
        │   Cryptocurrency, PriceSnapshot)                │
        └───────────────────────────────────────────────┘
```

### 1.3 Project structure

```
src/
├── index.ts              # makeBot() factory — THE mandatory harness export
├── config.ts             # env + constants (poll interval, supported coins)
├── commands/
│   ├── start.ts          # /start onboarding
│   ├── setcrypto.ts      # /setcrypto entry + coin pick
│   ├── setpercent.ts     # /setpercent entry + threshold capture
│   ├── alerts.ts         # /alerts list + /removealert
│   └── help.ts           # /help
├── flows/
│   └── alertWizard.ts    # multi-step session flow shared by setcrypto/setpercent
├── services/
│   ├── coingecko.ts      # price + 24h change fetch (BTC, TON)
│   └── monitor.ts        # PriceMonitor: poll → evaluate → dispatch DMs
├── storage/
│   ├── repository.ts     # User / UserAlert / PriceSnapshot CRUD
│   └── schema.sql        # table definitions
└── types.ts              # Session, Coin, Alert types
tests/
└── specs/                # BotSpec JSON fixtures (Tests phase)
```

### 1.4 The `makeBot()` factory (harness contract)

The harness requires a **fresh bot per spec run**, so the bot is created by an
exported factory, never a module-level singleton:

```ts
// src/index.ts
import { createBot } from "@agntdev/bot-toolkit";
import type { Session } from "./types";

export function makeBot() {
  const bot = createBot<Session>(process.env.BOT_TOKEN!, {
    initial: (): Session => ({ step: "idle", draft: {} }),
    // storage: sqliteAdapter()  // prod; omit → MemorySessionStorage in harness
  });

  registerCommands(bot);   // /start /setcrypto /setpercent /alerts /help
  registerFlows(bot);      // alertWizard step handlers
  return bot;
}

if (require.main === module) {
  const bot = makeBot();
  startMonitor(bot);       // background poller (skipped under harness)
  bot.start();             // long polling
}
```

`registerCommands`/`registerFlows` only wire handlers — all I/O lives in
`services/` and `storage/` so handlers stay testable.

### 1.5 Data model

Mirrors the Core Entities in `docs/general.md`.

| Entity | Fields | Notes |
|---|---|---|
| **User** | `telegram_id` (PK), `created_at` | One per Telegram account |
| **Cryptocurrency** | `symbol` (`BTC`\|`TON`), `coingecko_id` (`bitcoin`\|`the-open-network`) | Fixed seed set — only these two |
| **UserAlert** | `id`, `user_telegram_id` → User, `crypto_symbol` → Cryptocurrency, `threshold_pct`, `last_monitored_price`, `enabled`, `created_at` | One row per (user, coin); `threshold_pct` is the user-typed sensitivity |
| **PriceSnapshot** | `id`, `crypto_symbol` → Cryptocurrency, `price`, `change_24h_pct`, `captured_at` | History used for change calculation |

Relationships: `User 1—* UserAlert`, `UserAlert *—1 Cryptocurrency`,
`Cryptocurrency 1—* PriceSnapshot`.

A user may hold **multiple active alerts** (one per coin), satisfying the
"BTC 5%, TON 3%" requirement. The pair `(user_telegram_id, crypto_symbol)` is
unique — re-running `/setcrypto`+`/setpercent` for a coin updates the existing
alert rather than duplicating it.

### 1.6 Price monitoring & change calculation

`PriceMonitor` runs on a fixed interval (default **60s**, `POLL_INTERVAL_MS`):

1. Fetch current price + `price_change_percentage_24h` for BTC and TON in one
   batched CoinGecko call (`/simple/price?ids=bitcoin,the-open-network&vs_currencies=usd&include_24hr_change=true`).
2. Persist a `PriceSnapshot` per coin.
3. For each enabled `UserAlert`, evaluate the trigger condition (below).
4. For every alert that crosses its threshold, send a DM and update
   `last_monitored_price` so the next comparison is measured from the latest
   notified price.

**Change formula.** The primary signal is CoinGecko's 24h percentage change
(per `general.md`: "24h percentage change formula"). An alert with
`threshold_pct = X` fires when:

```
|change_24h_pct(coin)| >= X
```

The sign of `change_24h_pct` determines whether the DM reports an **increase**
(▲) or a **decrease** (▼), so a single threshold covers both directions of
movement as described in the summary.

**Repeat behaviour (per Non-goals).** Alerts are **not** suppressed after the
first trigger. After firing, `last_monitored_price` is refreshed; the alert
re-arms and fires again on the next interval where the move from that baseline
again meets the threshold. There is no one-shot mute.

### 1.7 External dependencies & resilience

- **Telegram Bot API** via grammY: `sendMessage` for alerts and replies,
  command + callback handlers, user identity from `ctx.from.id`. Token from
  `process.env.BOT_TOKEN` — never committed.
- **CoinGecko**: read-only price endpoints. Network/HTTP errors are caught;
  the monitor logs and skips the cycle (no crash, no DM) and retries next
  interval. `bot.catch()` (auto-wired by `createBot`) is the global error
  boundary so a single bad update never kills the poller.

---

## 2. Command Set

The three commands in `docs/general.md` are the core; supporting commands round
out the UX without violating any Non-goal (no groups, no charts, no payments,
only BTC/TON).

| Command | Args | Purpose |
|---|---|---|
| `/start` | — | Register the user, greet, prompt for coin selection |
| `/setcrypto` | `[BTC\|TON]` | Choose which coin to track (inline buttons if arg omitted) |
| `/setpercent` | `[X]` | Set the percentage threshold for the selected coin |
| `/alerts` | — | List the user's active alerts and their thresholds |
| `/removealert` | `[BTC\|TON]` | Disable an alert for a coin |
| `/help` | — | Show command reference |

Commands are case-sensitive (grammY). `@botusername` suffixes are auto-stripped.
Each handler validates input and replies with a clear correction on bad args
rather than failing silently.

### 2.1 Core command contracts

**`/start`**
- Upserts the `User` row for `ctx.from.id`.
- Replies with a welcome message + short explanation.
- Presents an inline keyboard `[BTC] [TON]` to begin setup, setting
  `session.step = "awaiting_coin"`.

**`/setcrypto [BTC|TON]`**
- With a valid arg: records the chosen coin into `session.draft.coin`, confirms,
  and prompts for the percentage (`session.step = "awaiting_percent"`).
- With no/invalid arg: shows the `[BTC] [TON]` inline keyboard; the
  `callback_query` selects the coin (then always `answerCallbackQuery()`).
- Rejects any symbol other than BTC/TON with a one-line explanation (Non-goal:
  only these two assets).

**`/setpercent [X]`**
- Parses `X` as a positive number (accepts `5`, `2.5`; rejects `0`, negatives,
  non-numbers, absurd values `> 1000`).
- Requires a coin already selected (`session.draft.coin`); if none, asks the
  user to run `/setcrypto` first.
- Creates or updates the `UserAlert(user, coin)` with `threshold_pct = X`,
  seeds `last_monitored_price` from the latest snapshot, sets `enabled = true`,
  and confirms: "✅ You'll be alerted when BTC moves ±5%."

### 2.2 Supporting command contracts

- **`/alerts`** — lists each active alert as `COIN — ±X%` plus the last seen
  price; empty-state nudges the user to `/setcrypto`.
- **`/removealert [COIN]`** — sets `enabled = false` for that coin's alert;
  confirms or reports nothing-to-remove.
- **`/help`** — static reference of the commands above.

---

## 3. Conversation / UX Flows

State between messages is held in `ctx.session` (`step` + `draft`), wired by
`createBot`. The `alertWizard` flow drives the two-step setup.

### 3.1 Onboarding (`/start`)

```
User: /start
Bot:  👋 Welcome to Crypto Price Alert Bot!
      I DM you when BTC or TON moves past a % you choose.
      Which coin do you want to track?
      [ BTC ]  [ TON ]            ← inline keyboard
session.step → "awaiting_coin"
```

### 3.2 Set-up wizard (`/setcrypto` → `/setpercent`)

The happy path threads coin selection into threshold capture:

```
User: taps [ BTC ]   (or: /setcrypto BTC)
Bot:  ✅ Tracking BTC.
      Now send the % change that should trigger an alert.
      e.g. send 5 for ±5%.
session.draft.coin → "BTC"; session.step → "awaiting_percent"

User: 5
Bot:  🔔 Alert set: BTC ±5%.
      I'll DM you whenever BTC's 24h move reaches 5%.
      Add another with /setcrypto, or see all with /alerts.
UserAlert(BTC) saved/updated; session.step → "idle"
```

Explicit-arg shortcut (no buttons needed):

```
User: /setcrypto TON
Bot:  ✅ Tracking TON. Send the % threshold (e.g. 3).
User: /setpercent 3
Bot:  🔔 Alert set: TON ±3%.
```

A user repeats this wizard per coin to hold simultaneous `BTC 5%` and
`TON 3%` alerts.

### 3.3 Free-text input handling

When `session.step === "awaiting_percent"`, a plain numeric message is
interpreted as the threshold (no command prefix needed). Any other step treats
unrecognized text with a gentle `/help` pointer. Invalid numbers re-prompt
without losing the selected coin:

```
User: abc           (step = awaiting_percent)
Bot:  That's not a number. Send a positive % like 5 or 2.5.
      (BTC is still selected.)
```

### 3.4 Alert delivery (background, unprompted DM)

When the monitor detects a crossing it sends a direct message containing every
field required by `general.md` — symbol, current price, signed % change, and a
timestamp:

```
🚨 BTC Price Alert
Price: $63,420.00
Change (24h): ▲ +5.2%
Time: 2026-06-13 11:48 UTC
```

For a downward move:

```
🚨 TON Price Alert
Price: $5.12
Change (24h): ▼ -3.4%
Time: 2026-06-13 11:48 UTC
```

Alerts repeat on subsequent qualifying intervals (no post-trigger suppression).

### 3.5 Managing alerts (`/alerts`, `/removealert`)

```
User: /alerts
Bot:  Your active alerts:
      • BTC — ±5%   (last seen $63,420)
      • TON — ±3%   (last seen $5.12)
      Remove one with /removealert BTC.

User: /removealert BTC
Bot:  🗑️ BTC alert removed. TON ±3% is still active.
```

### 3.6 Error & edge UX

| Situation | Behaviour |
|---|---|
| `/setpercent` before `/setcrypto` | "Pick a coin first with /setcrypto." |
| Unsupported coin (e.g. `/setcrypto ETH`) | "I only track BTC and TON." |
| Threshold ≤ 0 or non-numeric | Re-prompt, keep selected coin |
| CoinGecko unreachable | Monitor skips the cycle, logs, retries next interval; no spurious DMs |
| Unknown command / stray text | Friendly nudge to `/help` |

---

## 4. Traceability to `docs/general.md`

| general.md requirement | Where satisfied |
|---|---|
| `/start`, `/setcrypto`, `/setpercent` | §2.1, §3.1–3.2 |
| Track only BTC & TON | §1.5 (fixed seed), §2.1, §3.6 |
| Continuous monitoring at intervals | §1.6 `PriceMonitor` (60s default) |
| 24h % change formula | §1.6 trigger condition |
| DM with symbol, price, % change, timestamp | §3.4 alert format |
| Persistent preferences across sessions | §1.5 data model + SQLite storage |
| Multiple active alerts per user | §1.5 unique `(user, coin)`, §3.2 |
| No groups/channels, charts, payments | Non-goals honoured; commands DM-only, no chart/payment surface |
| Alerts repeat (no suppression) | §1.6 re-arm, §3.4 |

---

## 5. Build Phasing (informative)

The Dev-phase DAG is expected to follow: **foundation** (`makeBot()` skeleton,
config, storage schema, types) → **features** (`/start`, `/setcrypto`,
`/setpercent`, CoinGecko service, monitor loop) → **integration** (`/alerts`,
`/removealert`, `/help`, wiring the monitor into delivery). Each command and the
monitor are independently testable via BotSpec fixtures in `tests/specs/`.

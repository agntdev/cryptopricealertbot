# Crypto Price Alert Bot Design Document

## Summary
A Telegram bot that notifies users via direct message when the price of Bitcoin (BTC) or TON (GRAM) changes by a user-defined percentage threshold. Users can customize their alert sensitivity for price increases or decreases. Designed for cryptocurrency traders and enthusiasts who want real-time price movement tracking for these two assets.

## Core Entities
- **User**: Telegram account holder with unique ID, linked to alert preferences
- **Cryptocurrency**: Tracked assets (BTC, TON) with price data source identifiers
- **UserAlert**: Association between User and Cryptocurrency with configured percentage threshold
- **PriceSnapshot**: Historical price records for alert calculation (linked to Cryptocurrency)

Relationships:
- One User → Many UserAlerts (for different coins/percentages)
- One UserAlert → One Cryptocurrency + One Percentage Threshold
- One Cryptocurrency → Many PriceSnapshots (for price change calculation)

## External Dependencies
- **Telegram Bot API**: 
  - Message handling (`sendMessage`, `start`, `command` handlers)
  - User authentication via Telegram ID
- **CoinGecko API**: 
  - Real-time price data for BTC and TON
  - Market data endpoints for percentage change calculation
- **Database**: 
  - Store User, UserAlert, and PriceSnapshot records
  - Required fields: user_telegram_id, crypto_symbol, alert_percentage, last_monitored_price

## Feature List
- `/start`: Initialize user with bot and request cryptocurrency selection
- `/setcrypto [BTC/TON]`: Specify which cryptocurrency to track
- `/setpercent [X]`: Set price change percentage threshold (X is user-typed number)
- Continuous price monitoring for BTC and TON at regular intervals
- Price change calculation using 24h percentage change formula
- Direct message alert with: 
  - Cryptocurrency symbol
  - Current price
  - Percentage change (positive/negative)
  - Timestamp of alert
- Persistent storage of user preferences across sessions
- Support for multiple active alerts per user (BTC 5%, TON 3%, etc.)

## Non-goals
- Tracking cryptocurrencies beyond Bitcoin and TON
- Group notifications or channel broadcasts
- Historical price analysis or chart generation
- Payment processing or subscription management
- Alert suppression after first trigger (alerts repeat on subsequent thresholds)
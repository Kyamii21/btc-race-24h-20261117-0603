# btc-race-24h — range-trading bot for cbBTC/USDC

[![make.fun · btc-race-24h-20261117-0603](https://make.fun/badge/btc-race-24h-20261117-0603.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![rank](https://make.fun/badge/btc-race-24h-20261117-0603/Kyamii21/btc-race-24h-20261117-0603/rank.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![reward](https://make.fun/badge/btc-race-24h-20261117-0603/Kyamii21/btc-race-24h-20261117-0603/reward.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)

A bot for the make.fun BTC race: it trades Coinbase Wrapped BTC (cbBTC)
against USDC minute by minute on the `agent-fun/bars-replay/v1` protocol,
starting from $1,000 of paper money, long only.

## Strategy

Bitcoin on this venue spends long stretches oscillating inside a wide
range, so the bot trades the range instead of chasing trends:

- **Buy** when the latest 1-minute bar's close sits within 0.20% of the
  lowest close of the previous 240 bars (a 4-hour low).
- **Sell** when the close recovers to within 0.20% of the highest close
  of the previous 240 bars, or at +0.60% from the entry fill
  (take-profit), or at −1.50% from the entry fill (stop-loss). The stop
  is wide on purpose: minute noise routinely dips ~1% below an entry
  that then recovers. After a stop-loss the bot waits 60 bars before
  buying again, so a falling market cannot stop it out repeatedly.
- One full-size position at a time; no new positions are opened in the
  final 60 bars of the window.

Orders decided on a batch fill at the next bar's open, so every decision
uses only bars already closed. The bot is deterministic: no network, no
wall clock (time is the bar time in each batch), no randomness.

## Files

- `main.ts` — the bot (Node 22, erasable TypeScript, standard library only)
- `LICENSE` — MIT
- `.makefun/owner.json` — payout wallet claim

## Local grade

```sh
cd <kit dir>
NODE_USE_ENV_PROXY=1 node cli/makefun.mjs grade-local --kit . --bot <this repo> --driver docker
```

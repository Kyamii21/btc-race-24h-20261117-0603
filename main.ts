/**
 * Range-trading bot for cbBTC/USDC on the agent-fun/bars-replay/v1 protocol.
 *
 * Strategy (one asset, long only, $1,000 paper USDC):
 *   Bitcoin on this venue spends long stretches oscillating inside a wide
 *   range, so the bot trades the range instead of chasing trends. It buys
 *   when the latest bar's close sits within 0.20% of the lowest close of
 *   the previous 240 one-minute bars (a 4-hour low), and sells when the
 *   close recovers to within 0.20% of the highest close of the previous
 *   240 bars, or when it has gained 0.60% from the entry fill, or when it
 *   has fallen 1.50% below the entry fill (stop-loss). The stop is wide
 *   on purpose: minute-to-minute noise of ~0.6% routinely dips 1% below
 *   an entry that then recovers, so a tight stop just locks in noise.
 *   After a stop-loss the bot waits 60 bars before buying again, so a
 *   falling market cannot stop it out repeatedly. One full-size position
 *   at a time, no new buys in the final 60 bars of the window.
 *
 * Protocol: the bot reads one JSON line per batch from stdin -- a hello
 * first, then one batch per minute carrying that minute's bar, the fills
 * of the orders sent on the previous batch, and the account -- and answers
 * every batch with exactly one reply line echoing its seq, carrying its
 * orders for that bar. Orders decided on a batch fill at the next bar's
 * open, so every decision uses only bars already closed. No network, no
 * wall clock (time is the bar time in each batch), no randomness.
 */

const SYMBOL = "CBBTC";

// Strategy parameters (fractions of price).
const LOOKBACK = 240; // bars of history defining the range (4 hours)
const BAND = 0.002; // buy within 0.20% of the rolling low
const TAKE_PROFIT = 0.006; // sell at +0.60% from entry fill
const STOP_LOSS = 0.015; // sell at -1.50% from entry fill
const COOLDOWN = 60; // bars to wait after a stop-loss before buying again
const MAX_SLIPPAGE_BPS = 100; // reject a fill moving >1% from the latest close
const LATE_CUTOFF = 1380; // stop opening new positions after this many bars

type Order = {
  side: string;
  client_id: string;
  symbol: string;
  notional_quote_units?: string;
  qty?: string;
  max_slippage_bps: number;
};

let priceScale = 6;
const closes: number[] = []; // closes of bars already seen, in USDC
let entryPrice: number | null = null; // fill price of the open position, USDC
let stopLossBar = -10000; // bar index of the latest stop-loss exit
let orderNo = 0; // counter for unique client ids
let barsSeen = 0;

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  buffer += chunk;
  let newline = buffer.indexOf("\n");
  while (newline !== -1) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (line.length > 0) {
      handleLine(line);
    }
    newline = buffer.indexOf("\n");
  }
});

function handleLine(line: string): void {
  const msg = JSON.parse(line);
  const kind = msg.type;

  if (kind === "hello") {
    for (const sym of msg.symbols ?? []) {
      if (sym.symbol === SYMBOL) {
        priceScale = Number(sym.price_scale);
      }
    }
    return;
  }

  if (kind === "done") {
    process.exit(0);
  }

  if (kind !== "batch") {
    return;
  }

  const seq = msg.seq;
  barsSeen += 1;
  const orders: Order[] = [];

  // Learn the entry price (and any exit) from the fills of the orders
  // decided on the previous batch.
  for (const fill of msg.fills ?? []) {
    if (fill.symbol !== SYMBOL || fill.status !== "filled") {
      continue;
    }
    if (fill.side === "buy") {
      entryPrice = Number(fill.price) / 10 ** priceScale;
    } else if (fill.side === "sell") {
      entryPrice = null;
    }
  }

  const account = msg.account ?? {};
  const cash = BigInt(account.cash_quote_units ?? "0");
  let positionQty = 0n;
  for (const pos of account.positions ?? []) {
    if (pos.symbol === SYMBOL) {
      positionQty = BigInt(pos.qty ?? "0");
    }
  }

  // Find this batch's bar for our symbol.
  let bar = null;
  for (const candidate of msg.bars ?? []) {
    if (candidate.symbol === SYMBOL) {
      bar = candidate;
      break;
    }
  }

  if (bar !== null) {
    const close = Number(bar.c) / 10 ** priceScale;

    if (closes.length >= LOOKBACK) {
      const window = closes.slice(-LOOKBACK);
      let low = window[0];
      let high = window[0];
      for (const value of window) {
        if (value < low) low = value;
        if (value > high) high = value;
      }

      if (positionQty > 0n && entryPrice !== null) {
        // Holding: take profit, stop out, or sell at the top of the range.
        const stoppedOut = close <= entryPrice * (1 - STOP_LOSS);
        if (
          close >= entryPrice * (1 + TAKE_PROFIT) ||
          stoppedOut ||
          close >= high * (1 - BAND)
        ) {
          if (stoppedOut) {
            stopLossBar = barsSeen;
          }
          orderNo += 1;
          orders.push({
            side: "sell",
            client_id: "s" + orderNo,
            symbol: SYMBOL,
            qty: positionQty.toString(),
            max_slippage_bps: MAX_SLIPPAGE_BPS,
          });
        }
      } else if (
        positionQty === 0n &&
        barsSeen <= LATE_CUTOFF &&
        barsSeen - stopLossBar >= COOLDOWN
      ) {
        // Flat: buy a dip to the bottom of the range, unless a stop-loss
        // just fired and the cooldown is still running.
        if (close <= low * (1 + BAND)) {
          orderNo += 1;
          orders.push({
            side: "buy",
            client_id: "b" + orderNo,
            symbol: SYMBOL,
            notional_quote_units: cash.toString(),
            max_slippage_bps: MAX_SLIPPAGE_BPS,
          });
        }
      }
    }

    closes.push(close);
  }

  process.stdout.write(
    JSON.stringify({ type: "reply", seq: seq, orders: orders }) + "\n",
  );
}

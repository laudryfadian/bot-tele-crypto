const WebSocket = require("ws");
const TopCoin = require("./models/topCoins");
const { processMarketData } = require("./signalEngine");

let ws;

async function startWebSocket() {
  const coins = await TopCoin.find({});
  if (coins.length === 0) return;

  // Gunakan kline 5m untuk analisis yang lebih akurat
  const timeframe = process.env.KLINE_INTERVAL || "5m";
  const streams = coins.map((c) => c.symbol.toLowerCase() + `@kline_${timeframe}`).join("/");
  const wsUrl = `wss://stream.binance.com/stream?streams=${streams}`;

  ws = new WebSocket(wsUrl);

  ws.on("open", () => console.log(`✅ Connected to Binance WebSocket (Kline ${timeframe})`));

  ws.on("message", (data) => {
    const parsed = JSON.parse(data);

    if (parsed.data && parsed.data.k) {
      // Hanya proses ketika candle sudah close
      if (parsed.data.k.x) {
        processMarketData(parsed.data);
      }
    }
  });

  ws.on("close", () => {
    console.log("⚠️ WebSocket closed. Reconnecting in 3s...");
    setTimeout(startWebSocket, 3000);
  });

  ws.on("error", (err) => console.log("❌ WebSocket error:", err.message));
}

module.exports = { startWebSocket };

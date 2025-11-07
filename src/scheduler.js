const cron = require("node-cron");
const axios = require("axios");
const TopCoin = require("./models/topCoins");
const { sendTelegram } = require("./notifier");

const intervalHours = parseInt(process.env.SCHEDULER_INTERVAL_HOURS || 5);
const coinsLimit = parseInt(process.env.COINS_LIMIT || 100);

async function fetchTopCoins() {
  try {
    const res = await axios.get("https://api.binance.com/api/v3/ticker/24hr");
    const topCoins = res.data
      .filter((c) => c.symbol.endsWith("USDT"))
      .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
      .slice(0, coinsLimit);

    await TopCoin.deleteMany({});
    await TopCoin.insertMany(
      topCoins.map((c) => ({
        symbol: c.symbol,
        priceChange: parseFloat(c.priceChange),
        priceChangePercent: parseFloat(c.priceChangePercent),
        weightedAvgPrice: parseFloat(c.weightedAvgPrice),
        prevClosePrice: parseFloat(c.prevClosePrice),
        lastPrice: parseFloat(c.lastPrice),
        lastQty: parseFloat(c.lastQty),
        quoteVolume: parseFloat(c.quoteVolume),
        openPrice: parseFloat(c.openPrice),
        highPrice: parseFloat(c.highPrice),
        lowPrice: parseFloat(c.lowPrice),
        count: parseInt(c.count),
        updatedAt: new Date(),
      })),
    );

    console.log(`✅ Top ${coinsLimit} coins updated`);
  } catch (err) {
    console.error("❌ Scheduler error:", err.message);
    sendTelegram(`❌ Scheduler error: ${err.message}`);
  }
}

function startScheduler() {
  // jalankan pertama kali saat start
  fetchTopCoins();

  // schedule tiap intervalHours
  cron.schedule(`0 */${intervalHours} * * *`, fetchTopCoins);
}

module.exports = { startScheduler };

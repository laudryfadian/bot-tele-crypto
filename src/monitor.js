const Transaction = require("./models/transaction");
const { sendTelegram } = require("./notifier");

async function monitorTransactions(latestPrices) {
  const openTransactions = await Transaction.find({ status: "OPEN" });

  for (const trx of openTransactions) {
    const currentPrice = latestPrices[trx.symbol];
    if (!currentPrice) continue;

    const profitPercent = ((currentPrice - trx.buyPrice) / trx.buyPrice) * 100;

    if (profitPercent >= trx.targetProfitPercent) {
      sendTelegram(`🚀 SELL ALERT: ${trx.symbol}\nProfit target reached: +${profitPercent.toFixed(2)}%\nCurrent Price: ${currentPrice}`);
    } else if (profitPercent <= -trx.stopLossPercent) {
      sendTelegram(`⚠️ STOP LOSS ALERT: ${trx.symbol}\nLoss: ${profitPercent.toFixed(2)}%\nCurrent Price: ${currentPrice}`);
    }
  }
}

module.exports = { monitorTransactions };

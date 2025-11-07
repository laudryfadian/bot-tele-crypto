const Transaction = require("./models/transaction");
const TopCoin = require("./models/topCoins");
const { sendTelegram } = require("./notifier");

async function handleBuy(symbol, nominalIDR) {
  const coin = await TopCoin.findOne({ symbol: symbol.toUpperCase() });
  if (!coin) {
    sendTelegram(`❌ Coin ${symbol} not found in top coins`);
    return;
  }

  const lastPrice = coin.lastPrice;
  const quantity = nominalIDR / lastPrice;

  const trx = await Transaction.create({
    symbol: symbol.toUpperCase(),
    buyPrice: lastPrice,
    nominalIDR,
    quantity,
  });

  sendTelegram(`✅ Transaction recorded
Coin: ${symbol.toUpperCase()}
Nominal: ${nominalIDR} IDR
Quantity: ${quantity.toFixed(6)}
Buy Price: ${lastPrice}`);
}

async function handleSell(symbol, sellPrice) {
  const trx = await Transaction.findOne({ symbol: symbol.toUpperCase(), status: "OPEN" });
  if (!trx) {
    sendTelegram(`❌ No open transaction for ${symbol}`);
    return;
  }

  trx.status = "SOLD";
  trx.sellPrice = sellPrice;
  trx.sellTime = new Date();
  await trx.save();

  const profitPercent = ((sellPrice - trx.buyPrice) / trx.buyPrice) * 100;

  sendTelegram(`💰 Transaction SOLD
Coin: ${symbol.toUpperCase()}
Buy Price: ${trx.buyPrice}
Sell Price: ${sellPrice}
Profit: ${profitPercent.toFixed(2)}%`);
}

module.exports = { handleBuy, handleSell };

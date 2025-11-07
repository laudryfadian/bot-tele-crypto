const mongoose = require("mongoose");

const topCoinSchema = new mongoose.Schema({
  symbol: { type: String, required: true },
  priceChange: { type: Number },
  priceChangePercent: { type: Number },
  weightedAvgPrice: { type: Number },
  prevClosePrice: { type: Number },
  lastPrice: { type: Number },
  lastQty: { type: Number },
  quoteVolume: { type: Number },
  openPrice: { type: Number },
  highPrice: { type: Number },
  lowPrice: { type: Number },
  count: { type: Number },
  updatedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("TopCoin", topCoinSchema);

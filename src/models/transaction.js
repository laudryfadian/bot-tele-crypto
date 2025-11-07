const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema({
  symbol: { type: String, required: true },
  buyPrice: { type: Number, required: true },
  nominalIDR: { type: Number, required: true },
  quantity: { type: Number, required: true },
  status: { type: String, default: "OPEN" }, // OPEN / SOLD
  buyTime: { type: Date, default: Date.now },
  targetProfitPercent: { type: Number, default: parseFloat(process.env.TARGET_PROFIT_PERCENT) },
  stopLossPercent: { type: Number, default: parseFloat(process.env.STOP_LOSS_PERCENT) },
  sellPrice: { type: Number },
  sellTime: { type: Date },
});

module.exports = mongoose.model("Transaction", transactionSchema);

require("dotenv").config();
const { Telegraf } = require("telegraf");
const { handleBuy, handleSell } = require("./transactionHandler");

const bot = new Telegraf(process.env.TG_TOKEN);

bot.start((ctx) => ctx.reply("👋 Welcome to Crypto Bot by Lodryyy"));

bot.command("buy", async (ctx) => {
  const text = ctx.message.text;
  const parts = text.split(" "); // /buy SYMBOL NOMINAL
  if (parts.length !== 3) return ctx.reply("Usage: /buy SYMBOL NOMINAL");

  const symbol = parts[1].toUpperCase();
  const nominalIDR = parseFloat(parts[2]);
  await handleBuy(symbol, nominalIDR);
});

bot.command("sell", async (ctx) => {
  const text = ctx.message.text;
  const parts = text.split(" "); // /sell SYMBOL PRICE
  if (parts.length !== 3) return ctx.reply("Usage: /sell SYMBOL PRICE");

  const symbol = parts[1].toUpperCase();
  const sellPrice = parseFloat(parts[2]);
  await handleSell(symbol, sellPrice);
});

bot
  .launch()
  .then(() => console.log("🤖 Telegram Bot launched"))
  .catch((err) => {
    console.log("⚠️ Telegram Bot launch failed:", err.message);
    console.log("⚠️ Bot will retry in background...");
  });

// Graceful stop
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

module.exports = bot;

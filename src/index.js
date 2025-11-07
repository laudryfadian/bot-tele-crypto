require("dotenv").config();
const { connectMongo } = require("./mongo");
const { startScheduler } = require("./scheduler");
const { startWebSocket } = require("./wsClient");
require("./telegramBot"); // launch Telegram bot

(async () => {
  await connectMongo();
  startScheduler();
  startWebSocket();
})();

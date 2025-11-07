const axios = require("axios");

async function sendTelegram(message) {
  try {
    await axios.post(`https://api.telegram.org/bot${process.env.TG_TOKEN}/sendMessage`, {
      chat_id: process.env.TG_CHAT_ID,
      text: message,
      parse_mode: "Markdown",
    });
  } catch (err) {
    console.error("❌ Telegram error:", err.message);
  }
}

module.exports = { sendTelegram };

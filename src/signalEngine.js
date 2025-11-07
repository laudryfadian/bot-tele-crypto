const { sendTelegram } = require("./notifier");

const candleHistory = {}; // Menyimpan beberapa candle untuk analisis lebih baik
const PRICE_CHANGE_THRESHOLD = parseFloat(process.env.PRICE_CHANGE_THRESHOLD || 3);
const VOLUME_CHANGE_THRESHOLD = parseFloat(process.env.VOLUME_CHANGE_THRESHOLD || 100); // Volume spike threshold
const HISTORY_LENGTH = 5; // Simpan 5 candle terakhir untuk rata-rata

function processMarketData(data) {
  // Data dari kline stream
  const kline = data.k;
  if (!kline) return;

  const symbol = kline.s;
  const closePrice = parseFloat(kline.c);
  const openPrice = parseFloat(kline.o);
  const highPrice = parseFloat(kline.h);
  const lowPrice = parseFloat(kline.l);
  const volume = parseFloat(kline.v);
  const quoteVolume = parseFloat(kline.q);
  const isClosed = kline.x; // Candle sudah close

  // Validasi data
  if (!closePrice || !volume || closePrice <= 0 || volume <= 0) {
    return;
  }

  // Hanya proses candle yang sudah close
  if (!isClosed) return;

  // Inisialisasi history untuk symbol
  if (!candleHistory[symbol]) {
    candleHistory[symbol] = [];
  }

  // Simpan data candle saat ini
  const currentCandle = {
    close: closePrice,
    open: openPrice,
    high: highPrice,
    low: lowPrice,
    volume: volume,
    quoteVolume: quoteVolume,
    timestamp: Date.now(),
  };

  candleHistory[symbol].push(currentCandle);

  // Batasi history
  if (candleHistory[symbol].length > HISTORY_LENGTH) {
    candleHistory[symbol].shift();
  }

  // Butuh minimal 2 candle untuk analisis
  if (candleHistory[symbol].length < 2) {
    return;
  }

  const prevCandle = candleHistory[symbol][candleHistory[symbol].length - 2];
  const currentCandleData = candleHistory[symbol][candleHistory[symbol].length - 1];

  // Hitung perubahan harga
  const priceChange = ((currentCandleData.close - prevCandle.close) / prevCandle.close) * 100;

  // Hitung rata-rata volume dari candle sebelumnya (kecuali candle terakhir)
  const volumeHistory = candleHistory[symbol].slice(0, -1).map((c) => c.volume);
  const avgVolume = volumeHistory.reduce((a, b) => a + b, 0) / volumeHistory.length;

  // Hitung volume spike (perbandingan dengan rata-rata)
  const volumeSpike = ((currentCandleData.volume - avgVolume) / avgVolume) * 100;

  // Deteksi pola candlestick
  const bodySize = Math.abs(currentCandleData.close - currentCandleData.open);
  const totalRange = currentCandleData.high - currentCandleData.low;
  const bodyRatio = totalRange > 0 ? (bodySize / totalRange) * 100 : 0;

  const isBullish = currentCandleData.close > currentCandleData.open;
  const isStrongCandle = bodyRatio > 60; // Body lebih dari 60% dari total range

  console.log(`[${symbol}] Price: ${priceChange.toFixed(2)}% | Volume: ${volumeSpike.toFixed(0)}% | Bullish: ${isBullish} | Strong: ${isStrongCandle}`);

  // BUY SIGNAL: Harga naik kuat + Volume spike + Strong bullish candle
  if (priceChange >= PRICE_CHANGE_THRESHOLD && volumeSpike >= VOLUME_CHANGE_THRESHOLD && isBullish && isStrongCandle) {
    sendTelegram(`🚀 STRONG BUY SIGNAL
━━━━━━━━━━━━━━━━━━
Pair: ${symbol}
Timeframe: ${data.k.i}

📈 Price Action:
   Change: +${priceChange.toFixed(2)}%
   Open: $${openPrice}
   Close: $${closePrice}
   High: $${highPrice}
   Low: $${lowPrice}

📊 Volume Analysis:
   Volume Spike: +${volumeSpike.toFixed(0)}%
   Current: ${volume.toFixed(2)}
   Avg: ${avgVolume.toFixed(2)}

🕯️ Candle Strength: ${bodyRatio.toFixed(0)}%
⏰ Time: ${new Date().toLocaleString()}`);
  }

  // SELL SIGNAL: Harga turun drastis + Volume spike + Strong bearish candle
  else if (priceChange <= -PRICE_CHANGE_THRESHOLD && volumeSpike >= VOLUME_CHANGE_THRESHOLD && !isBullish && isStrongCandle) {
    sendTelegram(`⚠️ STRONG SELL SIGNAL
━━━━━━━━━━━━━━━━━━
Pair: ${symbol}
Timeframe: ${data.k.i}

📉 Price Action:
   Change: ${priceChange.toFixed(2)}%
   Open: $${openPrice}
   Close: $${closePrice}
   High: $${highPrice}
   Low: $${lowPrice}

📊 Volume Analysis:
   Volume Spike: +${volumeSpike.toFixed(0)}%
   Current: ${volume.toFixed(2)}
   Avg: ${avgVolume.toFixed(2)}

🕯️ Candle Strength: ${bodyRatio.toFixed(0)}%
⏰ Time: ${new Date().toLocaleString()}`);
  }

  // WARNING: Volume spike tanpa price movement yang signifikan (bisa jadi volatility tinggi)
  else if (volumeSpike >= VOLUME_CHANGE_THRESHOLD * 1.5 && Math.abs(priceChange) < PRICE_CHANGE_THRESHOLD) {
    sendTelegram(`⚡ HIGH VOLUME ALERT
━━━━━━━━━━━━━━━━━━
Pair: ${symbol}
Volume Spike: +${volumeSpike.toFixed(0)}%
Price Change: ${priceChange.toFixed(2)}%
Current Price: $${closePrice}

⚠️ High volatility detected - Watch closely!
⏰ Time: ${new Date().toLocaleString()}`);
  }
}

module.exports = { processMarketData };

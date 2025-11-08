const { sendTelegram } = require("./notifier");

const candleHistory = {}; // Menyimpan beberapa candle untuk analisis lebih baik
const lastSignalTime = {}; // Track waktu signal terakhir untuk cooldown
const signalQueue = []; // Queue untuk menyimpan signal dan ranking

const PRICE_CHANGE_THRESHOLD = parseFloat(process.env.PRICE_CHANGE_THRESHOLD || 3);
const VOLUME_CHANGE_THRESHOLD = parseFloat(process.env.VOLUME_CHANGE_THRESHOLD || 100);
const HISTORY_LENGTH = 5;
const SIGNAL_COOLDOWN = parseInt(process.env.SIGNAL_COOLDOWN_MINUTES || 30) * 60 * 1000; // Default 30 menit
const MIN_SIGNAL_SCORE = parseFloat(process.env.MIN_SIGNAL_SCORE || 70); // Score minimum untuk notifikasi
const MAX_SIGNALS_PER_HOUR = parseInt(process.env.MAX_SIGNALS_PER_HOUR || 5); // Maksimal 5 signal per jam

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

  // Check cooldown - jangan spam signal dari coin yang sama
  const now = Date.now();
  if (lastSignalTime[symbol] && now - lastSignalTime[symbol] < SIGNAL_COOLDOWN) {
    return; // Skip, masih dalam cooldown period
  }

  // Hitung signal score (0-100) untuk ranking
  let signalScore = 0;
  let signalType = null;

  // BUY SIGNAL: Harga naik kuat + Volume spike + Strong bullish candle
  if (priceChange >= PRICE_CHANGE_THRESHOLD && volumeSpike >= VOLUME_CHANGE_THRESHOLD && isBullish && isStrongCandle) {
    signalType = "BUY";
    // Score berdasarkan kekuatan signal
    signalScore += Math.min(priceChange * 5, 40); // Max 40 points dari price change
    signalScore += Math.min(volumeSpike / 5, 30); // Max 30 points dari volume spike
    signalScore += Math.min(bodyRatio / 2, 30); // Max 30 points dari candle strength
  }

  // SELL SIGNAL: Harga turun drastis + Volume spike + Strong bearish candle
  else if (priceChange <= -PRICE_CHANGE_THRESHOLD && volumeSpike >= VOLUME_CHANGE_THRESHOLD && !isBullish && isStrongCandle) {
    signalType = "SELL";
    signalScore += Math.min(Math.abs(priceChange) * 5, 40);
    signalScore += Math.min(volumeSpike / 5, 30);
    signalScore += Math.min(bodyRatio / 2, 30);
  }

  // WARNING: Volume spike tanpa price movement yang signifikan
  else if (volumeSpike >= VOLUME_CHANGE_THRESHOLD * 1.5 && Math.abs(priceChange) < PRICE_CHANGE_THRESHOLD) {
    signalType = "VOLUME_ALERT";
    signalScore += Math.min(volumeSpike / 10, 50); // Volume alert dapat max 50 points
  }

  // Jika tidak ada signal atau score terlalu rendah, skip
  if (!signalType || signalScore < MIN_SIGNAL_SCORE) {
    return;
  }

  // Check rate limiting - batasi jumlah signal per jam
  const oneHourAgo = now - 60 * 60 * 1000;
  const recentSignals = signalQueue.filter((s) => s.timestamp > oneHourAgo);

  if (recentSignals.length >= MAX_SIGNALS_PER_HOUR) {
    // Jika sudah maksimal, hanya kirim jika score lebih tinggi dari signal terlemah
    const weakestSignal = recentSignals.reduce((min, s) => (s.score < min.score ? s : min));
    if (signalScore <= weakestSignal.score) {
      console.log(`[${symbol}] Signal skipped (score ${signalScore.toFixed(0)} too low, quota full)`);
      return;
    }
  }

  // Update tracking
  lastSignalTime[symbol] = now;
  signalQueue.push({ symbol, score: signalScore, timestamp: now });

  // Cleanup old signals dari queue
  while (signalQueue.length > 0 && signalQueue[0].timestamp < oneHourAgo) {
    signalQueue.shift();
  }

  console.log(`[${symbol}] 🎯 SIGNAL TRIGGERED | Type: ${signalType} | Score: ${signalScore.toFixed(0)}/100`);

  // Kirim notifikasi berdasarkan tipe signal
  if (signalType === "BUY") {
    const scoreEmoji = signalScore >= 90 ? "🔥🔥🔥" : signalScore >= 80 ? "🔥🔥" : "🔥";
    sendTelegram(`🚀 STRONG BUY SIGNAL ${scoreEmoji}
━━━━━━━━━━━━━━━━━━
Pair: ${symbol}
Timeframe: ${data.k.i}
💯 Signal Score: ${signalScore.toFixed(0)}/100

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
⏰ Time: ${new Date().toLocaleString()}
📊 Signals in last hour: ${recentSignals.length + 1}/${MAX_SIGNALS_PER_HOUR}`);
  } else if (signalType === "SELL") {
    const scoreEmoji = signalScore >= 90 ? "🔥🔥🔥" : signalScore >= 80 ? "🔥🔥" : "🔥";
    sendTelegram(`⚠️ STRONG SELL SIGNAL ${scoreEmoji}
━━━━━━━━━━━━━━━━━━
Pair: ${symbol}
Timeframe: ${data.k.i}
💯 Signal Score: ${signalScore.toFixed(0)}/100

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
⏰ Time: ${new Date().toLocaleString()}
📊 Signals in last hour: ${recentSignals.length + 1}/${MAX_SIGNALS_PER_HOUR}`);
  } else if (signalType === "VOLUME_ALERT") {
    sendTelegram(`⚡ HIGH VOLUME ALERT
━━━━━━━━━━━━━━━━━━
Pair: ${symbol}
💯 Signal Score: ${signalScore.toFixed(0)}/100
Volume Spike: +${volumeSpike.toFixed(0)}%
Price Change: ${priceChange.toFixed(2)}%
Current Price: $${closePrice}

⚠️ High volatility detected - Watch closely!
⏰ Time: ${new Date().toLocaleString()}`);
  }
}

module.exports = { processMarketData };

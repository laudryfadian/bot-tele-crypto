const { sendTelegram } = require("./notifier");

const candleHistory = {}; // Menyimpan candle untuk analisis teknikal
const lastSignalTime = {}; // Track waktu signal terakhir untuk cooldown
const signalQueue = []; // Queue untuk menyimpan signal dan ranking

const PRICE_CHANGE_THRESHOLD = parseFloat(process.env.PRICE_CHANGE_THRESHOLD || 3);
const VOLUME_CHANGE_THRESHOLD = parseFloat(process.env.VOLUME_CHANGE_THRESHOLD || 100);
const HISTORY_LENGTH = 20; // Butuh lebih banyak data untuk indikator teknikal
const SIGNAL_COOLDOWN = parseInt(process.env.SIGNAL_COOLDOWN_MINUTES || 30) * 60 * 1000;
const MIN_SIGNAL_SCORE = parseFloat(process.env.MIN_SIGNAL_SCORE || 70);
const MAX_SIGNALS_PER_HOUR = parseInt(process.env.MAX_SIGNALS_PER_HOUR || 5);

// ============ TECHNICAL INDICATORS ============

// Calculate RSI (Relative Strength Index)
function calculateRSI(candles, period = 14) {
  if (candles.length < period + 1) return null;

  let gains = 0;
  let losses = 0;

  // Calculate initial average gain/loss
  for (let i = candles.length - period; i < candles.length; i++) {
    const change = candles[i].close - candles[i - 1].close;
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;

  if (avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;
  const rsi = 100 - 100 / (1 + rs);

  return rsi;
}

// Calculate EMA (Exponential Moving Average)
function calculateEMA(candles, period) {
  if (candles.length < period) return null;

  const multiplier = 2 / (period + 1);
  const prices = candles.map((c) => c.close);

  // Start with SMA
  let ema = prices.slice(-period).reduce((a, b) => a + b, 0) / period;

  // Calculate EMA
  for (let i = candles.length - period + 1; i < candles.length; i++) {
    ema = (prices[i] - ema) * multiplier + ema;
  }

  return ema;
}

// Calculate MACD (Moving Average Convergence Divergence)
function calculateMACD(candles) {
  const ema12 = calculateEMA(candles, 12);
  const ema26 = calculateEMA(candles, 26);

  if (!ema12 || !ema26) return null;

  const macdLine = ema12 - ema26;
  // Simplified: return MACD line only (signal line requires more history)

  return { macdLine, ema12, ema26 };
}

// Calculate Bollinger Bands
function calculateBollingerBands(candles, period = 20, stdDev = 2) {
  if (candles.length < period) return null;

  const prices = candles.slice(-period).map((c) => c.close);
  const sma = prices.reduce((a, b) => a + b, 0) / period;

  // Calculate standard deviation
  const squaredDiffs = prices.map((p) => Math.pow(p - sma, 2));
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / period;
  const std = Math.sqrt(variance);

  return {
    upper: sma + std * stdDev,
    middle: sma,
    lower: sma - std * stdDev,
  };
}

// Detect Support and Resistance levels
function detectSupportResistance(candles) {
  if (candles.length < 5) return null;

  const lows = candles.map((c) => c.low);
  const highs = candles.map((c) => c.high);

  const support = Math.min(...lows.slice(-5));
  const resistance = Math.max(...highs.slice(-5));

  return { support, resistance };
}

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

  // Butuh minimal 15 candle untuk analisis teknikal
  if (candleHistory[symbol].length < 15) {
    return;
  }

  const prevCandle = candleHistory[symbol][candleHistory[symbol].length - 2];
  const currentCandleData = candleHistory[symbol][candleHistory[symbol].length - 1];

  // ============ BASIC METRICS ============
  const priceChange = ((currentCandleData.close - prevCandle.close) / prevCandle.close) * 100;

  const volumeHistory = candleHistory[symbol].slice(0, -1).map((c) => c.volume);
  const avgVolume = volumeHistory.reduce((a, b) => a + b, 0) / volumeHistory.length;
  const volumeSpike = ((currentCandleData.volume - avgVolume) / avgVolume) * 100;

  const bodySize = Math.abs(currentCandleData.close - currentCandleData.open);
  const totalRange = currentCandleData.high - currentCandleData.low;
  const bodyRatio = totalRange > 0 ? (bodySize / totalRange) * 100 : 0;
  const isBullish = currentCandleData.close > currentCandleData.open;
  const isStrongCandle = bodyRatio > 60;

  // ============ TECHNICAL INDICATORS ============
  const rsi = calculateRSI(candleHistory[symbol]);
  const ema12 = calculateEMA(candleHistory[symbol], 12);
  const ema26 = calculateEMA(candleHistory[symbol], 26);
  const macd = calculateMACD(candleHistory[symbol]);
  const bollinger = calculateBollingerBands(candleHistory[symbol]);
  const srLevels = detectSupportResistance(candleHistory[symbol]);

  // Check cooldown
  const now = Date.now();
  if (lastSignalTime[symbol] && now - lastSignalTime[symbol] < SIGNAL_COOLDOWN) {
    return;
  }

  // ============ ADVANCED SIGNAL DETECTION ============
  let signalScore = 0;
  let signalType = null;
  let signals = []; // Track which conditions are met

  // === STRONG BUY CONDITIONS ===
  const buyConditions = {
    priceBreakout: priceChange >= PRICE_CHANGE_THRESHOLD,
    volumeSpike: volumeSpike >= VOLUME_CHANGE_THRESHOLD,
    bullishCandle: isBullish && isStrongCandle,
    rsiOversold: rsi && rsi < 30, // RSI oversold (reversal potential)
    rsiModerate: rsi && rsi >= 30 && rsi < 50, // RSI not overbought
    emaBullish: ema12 && ema26 && ema12 > ema26, // EMA crossover bullish
    macdBullish: macd && macd.macdLine > 0,
    bollingerBounce: bollinger && currentCandleData.close <= bollinger.lower, // Price at lower band
    nearSupport: srLevels && currentCandleData.close <= srLevels.support * 1.02, // Near support level
  };

  // === STRONG SELL CONDITIONS ===
  const sellConditions = {
    priceBreakdown: priceChange <= -PRICE_CHANGE_THRESHOLD,
    volumeSpike: volumeSpike >= VOLUME_CHANGE_THRESHOLD,
    bearishCandle: !isBullish && isStrongCandle,
    rsiOverbought: rsi && rsi > 70, // RSI overbought (reversal potential)
    rsiModerate: rsi && rsi <= 70 && rsi > 50,
    emaBearish: ema12 && ema26 && ema12 < ema26, // EMA crossover bearish
    macdBearish: macd && macd.macdLine < 0,
    bollingerReject: bollinger && currentCandleData.close >= bollinger.upper, // Price at upper band
    nearResistance: srLevels && currentCandleData.close >= srLevels.resistance * 0.98, // Near resistance
  };

  // Calculate BUY score
  if (buyConditions.priceBreakout && buyConditions.volumeSpike && buyConditions.bullishCandle) {
    signalType = "BUY";

    // Base score from price action
    signalScore += Math.min(priceChange * 4, 25);
    signalScore += Math.min(volumeSpike / 6, 20);
    signalScore += Math.min(bodyRatio / 3, 15);

    // Bonus from technical indicators
    if (buyConditions.rsiOversold) {
      signalScore += 15; // Strong reversal signal
      signals.push("RSI Oversold");
    } else if (buyConditions.rsiModerate) {
      signalScore += 8;
      signals.push("RSI Moderate");
    }

    if (buyConditions.emaBullish) {
      signalScore += 10;
      signals.push("EMA Bullish Cross");
    }

    if (buyConditions.macdBullish) {
      signalScore += 8;
      signals.push("MACD Positive");
    }

    if (buyConditions.bollingerBounce) {
      signalScore += 12; // Bounce from lower band
      signals.push("Bollinger Bounce");
    }

    if (buyConditions.nearSupport) {
      signalScore += 7;
      signals.push("Near Support");
    }
  }

  // Calculate SELL score
  else if (sellConditions.priceBreakdown && sellConditions.volumeSpike && sellConditions.bearishCandle) {
    signalType = "SELL";

    signalScore += Math.min(Math.abs(priceChange) * 4, 25);
    signalScore += Math.min(volumeSpike / 6, 20);
    signalScore += Math.min(bodyRatio / 3, 15);

    if (sellConditions.rsiOverbought) {
      signalScore += 15;
      signals.push("RSI Overbought");
    } else if (sellConditions.rsiModerate) {
      signalScore += 8;
      signals.push("RSI Moderate");
    }

    if (sellConditions.emaBearish) {
      signalScore += 10;
      signals.push("EMA Bearish Cross");
    }

    if (sellConditions.macdBearish) {
      signalScore += 8;
      signals.push("MACD Negative");
    }

    if (sellConditions.bollingerReject) {
      signalScore += 12;
      signals.push("Bollinger Rejection");
    }

    if (sellConditions.nearResistance) {
      signalScore += 7;
      signals.push("Near Resistance");
    }
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

  console.log(`[${symbol}] 🎯 SIGNAL TRIGGERED | Type: ${signalType} | Score: ${signalScore.toFixed(0)}/100 | Signals: ${signals.join(", ")}`);

  // Kirim notifikasi dengan technical indicators
  if (signalType === "BUY") {
    const scoreEmoji = signalScore >= 90 ? "🔥🔥🔥" : signalScore >= 80 ? "🔥🔥" : "🔥";
    sendTelegram(`🚀 STRONG BUY SIGNAL ${scoreEmoji}
━━━━━━━━━━━━━━━━━━
Pair: ${symbol}
Timeframe: ${data.k.i}
💯 Signal Score: ${signalScore.toFixed(0)}/100

📈 Price Action:
   Change: +${priceChange.toFixed(2)}%
   Current: $${closePrice}
   High: $${highPrice}
   Low: $${lowPrice}

📊 Volume Analysis:
   Volume Spike: +${volumeSpike.toFixed(0)}%
   Current: ${volume.toFixed(2)}
   Avg: ${avgVolume.toFixed(2)}

� Technical Indicators:
   RSI: ${rsi ? rsi.toFixed(1) : "N/A"} ${rsi && rsi < 30 ? "🟢 OVERSOLD" : rsi && rsi < 50 ? "🟡" : "🔴"}
   EMA12: $${ema12 ? ema12.toFixed(8) : "N/A"}
   EMA26: $${ema26 ? ema26.toFixed(8) : "N/A"}
   MACD: ${macd ? macd.macdLine.toFixed(4) : "N/A"} ${macd && macd.macdLine > 0 ? "🟢" : "🔴"}
   BB Upper: $${bollinger ? bollinger.upper.toFixed(8) : "N/A"}
   BB Lower: $${bollinger ? bollinger.lower.toFixed(8) : "N/A"}

✅ Confirmed Signals:
   ${signals.join("\n   ")}

⏰ Time: ${new Date().toLocaleString()}
📊 Signals: ${recentSignals.length + 1}/${MAX_SIGNALS_PER_HOUR}/hour`);
  } else if (signalType === "SELL") {
    const scoreEmoji = signalScore >= 90 ? "🔥🔥🔥" : signalScore >= 80 ? "🔥🔥" : "🔥";
    sendTelegram(`⚠️ STRONG SELL SIGNAL ${scoreEmoji}
━━━━━━━━━━━━━━━━━━
Pair: ${symbol}
Timeframe: ${data.k.i}
💯 Signal Score: ${signalScore.toFixed(0)}/100

📉 Price Action:
   Change: ${priceChange.toFixed(2)}%
   Current: $${closePrice}
   High: $${highPrice}
   Low: $${lowPrice}

📊 Volume Analysis:
   Volume Spike: +${volumeSpike.toFixed(0)}%
   Current: ${volume.toFixed(2)}
   Avg: ${avgVolume.toFixed(2)}

� Technical Indicators:
   RSI: ${rsi ? rsi.toFixed(1) : "N/A"} ${rsi && rsi > 70 ? "🔴 OVERBOUGHT" : rsi && rsi > 50 ? "🟡" : "🟢"}
   EMA12: $${ema12 ? ema12.toFixed(8) : "N/A"}
   EMA26: $${ema26 ? ema26.toFixed(8) : "N/A"}
   MACD: ${macd ? macd.macdLine.toFixed(4) : "N/A"} ${macd && macd.macdLine < 0 ? "🔴" : "🟢"}
   BB Upper: $${bollinger ? bollinger.upper.toFixed(8) : "N/A"}
   BB Lower: $${bollinger ? bollinger.lower.toFixed(8) : "N/A"}

⚠️ Confirmed Signals:
   ${signals.join("\n   ")}

⏰ Time: ${new Date().toLocaleString()}
📊 Signals: ${recentSignals.length + 1}/${MAX_SIGNALS_PER_HOUR}/hour`);
  }
}

module.exports = { processMarketData };

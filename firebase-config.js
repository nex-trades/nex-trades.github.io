// ============================================================
// NEXTRADE — Firebase Configuration
// ============================================================

const firebaseConfig = {
  apiKey: "AIzaSyB0MEsycHQszPxavdE1veP3o6Hm6rGbTXs",
  authDomain: "nextrade-b7020.firebaseapp.com",
  projectId: "nextrade-b7020",
  storageBucket: "nextrade-b7020.firebasestorage.app",
  messagingSenderId: "115663396960",
  appId: "1:115663396960:web:6ca498109c6a5ab40d2305"
};

firebase.initializeApp(firebaseConfig);
const db   = firebase.firestore();
const auth = firebase.auth();

// ============================================================
// TRADING INSTRUMENTS
// ============================================================
const INSTRUMENTS = {
  forex: [
    { symbol: 'EUR/USD', name: 'Euro / US Dollar',              pip: 0.0001, defaultPrice: 1.0842 },
    { symbol: 'GBP/USD', name: 'British Pound / US Dollar',     pip: 0.0001, defaultPrice: 1.2674 },
    { symbol: 'USD/JPY', name: 'US Dollar / Japanese Yen',      pip: 0.01,   defaultPrice: 149.82 },
    { symbol: 'USD/CHF', name: 'US Dollar / Swiss Franc',       pip: 0.0001, defaultPrice: 0.9012 },
    { symbol: 'AUD/USD', name: 'Australian Dollar / US Dollar', pip: 0.0001, defaultPrice: 0.6521 },
    { symbol: 'USD/CAD', name: 'US Dollar / Canadian Dollar',   pip: 0.0001, defaultPrice: 1.3612 },
    { symbol: 'EUR/GBP', name: 'Euro / British Pound',          pip: 0.0001, defaultPrice: 0.8556 },
    { symbol: 'NZD/USD', name: 'New Zealand Dollar / USD',      pip: 0.0001, defaultPrice: 0.6018 },
  ],
  commodities: [
    { symbol: 'XAU/USD', name: 'Gold / US Dollar',     pip: 0.01, defaultPrice: 2345.00 },
    { symbol: 'XAG/USD', name: 'Silver / US Dollar',   pip: 0.001, defaultPrice: 27.85  },
    { symbol: 'WTI/USD', name: 'Crude Oil (WTI)',       pip: 0.01, defaultPrice: 78.40  },
    { symbol: 'NGAS/USD', name: 'Natural Gas',          pip: 0.001, defaultPrice: 2.145  },
    { symbol: 'XPT/USD', name: 'Platinum / US Dollar', pip: 0.01, defaultPrice: 965.00 },
  ],
  crypto: [
    { symbol: 'BTC/USD', name: 'Bitcoin / US Dollar',   pip: 1,      defaultPrice: 67420  },
    { symbol: 'ETH/USD', name: 'Ethereum / US Dollar',  pip: 0.1,    defaultPrice: 3512   },
    { symbol: 'BNB/USD', name: 'BNB / US Dollar',       pip: 0.01,   defaultPrice: 398.50 },
    { symbol: 'SOL/USD', name: 'Solana / US Dollar',    pip: 0.01,   defaultPrice: 142.30 },
    { symbol: 'XRP/USD', name: 'Ripple / US Dollar',    pip: 0.0001, defaultPrice: 0.5842 },
    { symbol: 'ADA/USD', name: 'Cardano / US Dollar',   pip: 0.0001, defaultPrice: 0.4521 },
    { symbol: 'AVAX/USD', name: 'Avalanche / US Dollar', pip: 0.01,  defaultPrice: 38.20  },
  ]
};

const ALL_INSTRUMENTS = [...INSTRUMENTS.forex, ...INSTRUMENTS.commodities, ...INSTRUMENTS.crypto];

function getInstrument(symbol) {
  return ALL_INSTRUMENTS.find(function(i) { return i.symbol === symbol; }) || null;
}

// ============================================================
// LOAD PRICES FROM FIRESTORE
// Doc IDs use '-' instead of '/' (e.g. BTC-USD, EUR-USD)
// to avoid Firestore invalid path errors.
// The 'symbol' field stores the original symbol (e.g. BTC/USD).
// ============================================================

// ── LIVE PRICE FETCHING — OPTION 2 ──
// Crypto     : CoinGecko    — direct to browser,      every 60 seconds (real)
// Forex      : Frankfurter  — Firestore cache + SIM,  seed every 60s, sim every 10s
// Commodities: GoldAPI.io   — Firestore cache + SIM,  seed periodically, sim every 10s
// One user fetches and saves to Firestore; all others read from Firestore.
// Simulation engine creates realistic trending price movement between fetches.

var PRICE_TTL       = 60  * 1000;        // 60 seconds — Forex fetch interval
var COMMODITY_TTL   = 60  * 60 * 1000;   // 1 hour     — Commodity fetch interval (100 req/month)
var SIM_TICK        = 10  * 1000;        // 10 seconds  — simulation tick speed
var GOLD_API_KEY    = 'goldapi-27edd8725217901bd1db7c85a1ca818d-io';

var CRYPTO_SYMBOLS = {
  'BTC/USD':  'bitcoin',
  'ETH/USD':  'ethereum',
  'BNB/USD':  'binancecoin',
  'SOL/USD':  'solana',
  'XRP/USD':  'ripple',
  'ADA/USD':  'cardano',
  'AVAX/USD': 'avalanche-2'
};

// ── SIMULATION ENGINE ──
// Each instrument has a hidden daily bias and trend personality.
// Prices drift in a direction, then reverse — like real markets.
// The pattern is intentionally obscured.
var _simState = {};

// Daily pip ranges per instrument (max movement per day)
var SIM_RANGES = {
  'EUR/USD': 0.0070, 'GBP/USD': 0.0090, 'USD/JPY': 0.65,
  'USD/CHF': 0.0065, 'AUD/USD': 0.0060, 'USD/CAD': 0.0065,
  'EUR/GBP': 0.0055, 'NZD/USD': 0.0050,
  'XAU/USD': 18.0,   'XAG/USD': 0.45,   'WTI/USD': 1.80,
  'NGAS/USD': 0.08,  'XPT/USD': 14.0
};

// Hidden seed — determines daily character of each instrument
// Uses day-of-year + instrument index to create unique but consistent daily patterns
function _getSimSeed(symbol, dayOffset) {
  var d = new Date();
  var doy = Math.floor((d - new Date(d.getFullYear(),0,0)) / 86400000) + (dayOffset||0);
  var idx = Object.keys(SIM_RANGES).indexOf(symbol) + 1;
  // Layered prime-based hash — creates irregular but repeatable patterns
  return ((doy * 2971 + idx * 6791) % 9973) / 9973;
}

function _initSimState(symbol, basePrice) {
  if (_simState[symbol] && _simState[symbol].base === basePrice) return;
  var seed = _getSimSeed(symbol, 0);
  var seed2 = _getSimSeed(symbol, 1);
  var range = SIM_RANGES[symbol] || 0.001;
  // Daily bias: some days more bullish, some bearish, some choppy
  // Uses a layered function to avoid obvious patterns
  var rawBias = Math.sin(seed * Math.PI * 3.7) * Math.cos(seed2 * Math.PI * 2.3);
  var bias = rawBias * 0.6; // -0.6 to +0.6 bias strength
  // Trend duration: how many ticks before reversing (8 to 24 ticks = 80s to 240s)
  var trendDuration = Math.floor(8 + seed * 16 + seed2 * 8);
  // Max single tick movement — tuned per instrument for visible movement
  // Target: 1-3 pips per tick for Forex, proportional for others
  var tickSize = range / 30 * (1 + Math.abs(bias));
  _simState[symbol] = {
    base:          basePrice,
    current:       basePrice,
    bias:          bias,
    tickSize:      tickSize,
    range:         range,
    trendDir:      bias >= 0 ? 1 : -1,
    trendCount:    0,
    trendDuration: trendDuration,
    high:          basePrice,
    low:           basePrice,
    floor:         basePrice - range,
    ceiling:       basePrice + range,
    seed:          seed
  };
}

function _tickSimPrice(symbol) {
  var s = _simState[symbol];
  if (!s) return null;
  s.trendCount++;
  // Check if trend should reverse
  if (s.trendCount >= s.trendDuration) {
    // Reverse direction — uses seed-based irregular duration so it never looks mechanical
    s.trendDir *= -1;
    var newDuration = Math.floor(6 + s.seed * 18 + Math.random() * 8);
    s.trendDuration = newDuration;
    s.trendCount = 0;
  }
  // Calculate tick movement — add slight randomness but follow trend direction
  var noise = (Math.random() - 0.5) * s.tickSize * 0.4;
  var move  = s.trendDir * s.tickSize * (0.6 + Math.random() * 0.4) + noise;
  // Apply bias — bullish days trend up more than down, bearish days opposite
  move += s.bias * s.tickSize * 0.15;
  var newPrice = s.current + move;
  // Bounce off floor/ceiling — creates natural reversals at range limits
  if (newPrice > s.ceiling) { newPrice = s.ceiling; s.trendDir = -1; s.trendCount = 0; }
  if (newPrice < s.floor)   { newPrice = s.floor;   s.trendDir =  1; s.trendCount = 0; }
  s.current = newPrice;
  if (newPrice > s.high) s.high = newPrice;
  if (newPrice < s.low)  s.low  = newPrice;
  return parseFloat(newPrice.toFixed(symbol.includes('JPY') ? 3 : symbol === 'XAU/USD' || symbol === 'WTI/USD' || symbol === 'XPT/USD' ? 2 : symbol === 'XAG/USD' || symbol === 'NGAS/USD' ? 3 : 5));
}

// ── CRYPTO: direct CoinGecko, every 60s (no simulation) ──
async function fetchCryptoPrices(pricesObj) {
  try {
    var ids = Object.values(CRYPTO_SYMBOLS).join(',');
    var r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=' + ids + '&vs_currencies=usd&_=' + Date.now());
    if (!r.ok) return;
    var data = await r.json();
    Object.keys(CRYPTO_SYMBOLS).forEach(function(sym) {
      var id = CRYPTO_SYMBOLS[sym];
      if (data[id] && data[id].usd) pricesObj[sym] = parseFloat(data[id].usd);
    });
  } catch(e) { console.error('CoinGecko fetch error:', e); }
}

// ── FOREX: Frankfurter seed + simulation ──
// On load: read last simulated price from Firestore and continue from there.
// Frankfurter is only called if no Firestore price exists yet (first ever load).
// Every 10s tick saves the current simulated price back to Firestore.
async function loadForexPrices(pricesObj) {
  try {
    var now  = Date.now();
    var snap = await db.collection('forexPrices').doc('latest').get();
    if (snap.exists) {
      var saved = snap.data();
      // Only process base symbol keys — skip sim_ keys, updatedAt, baseUpdatedAt
      var forexSyms = ['EUR/USD','GBP/USD','USD/JPY','USD/CHF','AUD/USD','USD/CAD','EUR/GBP','NZD/USD'];
      forexSyms.forEach(function(sym) {
        if (!saved[sym]) return;
        // Resume from last simulated price if available, otherwise from base
        var startPrice = saved['sim_' + sym.replace('/', '_')] || saved[sym];
        delete _simState[sym]; // force fresh init from resume price
        _initSimState(sym, startPrice);
        pricesObj[sym] = startPrice;
      });
      // Only re-fetch from Frankfurter once per day to update the base
      var baseAge = now - (saved.baseUpdatedAt || 0);
      if (baseAge < 24 * 60 * 60 * 1000) return;
    }
    // First ever load OR 24hrs since last Frankfurter fetch — get fresh base
    var r = await fetch('https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR,GBP,JPY,CHF,AUD,CAD,NZD&_=' + now);
    if (!r.ok) return;
    var data = await r.json();
    if (!data.rates) return;
    var rates  = data.rates;
    var toSave = { baseUpdatedAt: now, updatedAt: now };
    if (rates.EUR) toSave['EUR/USD'] = parseFloat((1 / rates.EUR).toFixed(5));
    if (rates.GBP) toSave['GBP/USD'] = parseFloat((1 / rates.GBP).toFixed(5));
    if (rates.JPY) toSave['USD/JPY'] = parseFloat(rates.JPY.toFixed(3));
    if (rates.CHF) toSave['USD/CHF'] = parseFloat(rates.CHF.toFixed(5));
    if (rates.AUD) toSave['AUD/USD'] = parseFloat((1 / rates.AUD).toFixed(5));
    if (rates.CAD) toSave['USD/CAD'] = parseFloat(rates.CAD.toFixed(5));
    if (rates.EUR && rates.GBP) toSave['EUR/GBP'] = parseFloat((rates.GBP / rates.EUR).toFixed(5));
    if (rates.NZD) toSave['NZD/USD'] = parseFloat((1 / rates.NZD).toFixed(5));
    await db.collection('forexPrices').doc('latest').set(toSave);
    Object.keys(toSave).forEach(function(k) {
      if (k !== 'updatedAt' && k !== 'baseUpdatedAt') {
        delete _simState[k];
        _initSimState(k, toSave[k]);
        pricesObj[k] = toSave[k];
      }
    });
  } catch(e) { console.error('Forex price error:', e); }
}

// ── COMMODITIES: GoldAPI.io seed + simulation ──
async function loadCommodityPrices(pricesObj) {
  var staticSeeds = { 'WTI/USD': 78.50, 'NGAS/USD': 2.10, 'XPT/USD': 965.00 };
  try {
    var now  = Date.now();
    var snap = await db.collection('commodityPrices').doc('latest').get();
    if (snap.exists) {
      var saved = snap.data();
      // Resume static commodities from last simulated price
      Object.keys(staticSeeds).forEach(function(sym) {
        var startPrice = saved['sim_' + sym.replace('/', '_')] || staticSeeds[sym];
        delete _simState[sym];
        _initSimState(sym, startPrice);
        pricesObj[sym] = startPrice;
      });
      // Resume Gold and Silver from last simulated price
      var goldStart   = saved['sim_XAU_USD'] || saved['XAU/USD'];
      var silverStart = saved['sim_XAG_USD'] || saved['XAG/USD'];
      if (goldStart)   { delete _simState['XAU/USD']; _initSimState('XAU/USD', goldStart);   pricesObj['XAU/USD'] = goldStart; }
      if (silverStart) { delete _simState['XAG/USD']; _initSimState('XAG/USD', silverStart); pricesObj['XAG/USD'] = silverStart; }
      // Only re-fetch from GoldAPI once per TTL interval
      var baseAge = now - (saved.baseUpdatedAt || 0);
      if (baseAge < COMMODITY_TTL) return;
    } else {
      // First ever load — use static seeds
      Object.keys(staticSeeds).forEach(function(sym) {
        _initSimState(sym, staticSeeds[sym]);
        pricesObj[sym] = staticSeeds[sym];
      });
    }
    // Fetch Gold and Silver from GoldAPI.io
    var rGold = await fetch('https://www.goldapi.io/api/XAU/USD', { headers: { 'x-access-token': GOLD_API_KEY, 'Content-Type': 'application/json' } });
    if (rGold.ok) {
      var gData = await rGold.json();
      if (gData.price) {
        delete _simState['XAU/USD'];
        _initSimState('XAU/USD', parseFloat(gData.price));
        pricesObj['XAU/USD'] = _simState['XAU/USD'].current;
      }
    }
    var rSilver = await fetch('https://www.goldapi.io/api/XAG/USD', { headers: { 'x-access-token': GOLD_API_KEY, 'Content-Type': 'application/json' } });
    if (rSilver.ok) {
      var sData = await rSilver.json();
      if (sData.price) {
        delete _simState['XAG/USD'];
        _initSimState('XAG/USD', parseFloat(sData.price));
        pricesObj['XAG/USD'] = _simState['XAG/USD'].current;
      }
    }
    var toSave = { baseUpdatedAt: now, updatedAt: now };
    if (pricesObj['XAU/USD']) toSave['XAU/USD'] = _simState['XAU/USD'] ? _simState['XAU/USD'].base : pricesObj['XAU/USD'];
    if (pricesObj['XAG/USD']) toSave['XAG/USD'] = _simState['XAG/USD'] ? _simState['XAG/USD'].base : pricesObj['XAG/USD'];
    await db.collection('commodityPrices').doc('latest').set(toSave);
  } catch(e) { console.error('Commodity price error:', e); }
}

// ── MAIN LOADER ──
async function loadLivePrices(pricesObj) {
  ALL_INSTRUMENTS.forEach(function(i) {
    if (!pricesObj[i.symbol]) pricesObj[i.symbol] = i.defaultPrice;
  });
  await Promise.all([
    fetchCryptoPrices(pricesObj),
    loadForexPrices(pricesObj),
    loadCommodityPrices(pricesObj)
  ]);
}

// ── MARKET HOURS ──
// Forex/Commodity market: Sunday 10pm UTC open, Friday 10pm UTC close

function isMarketOpen() {
  var now     = new Date();
  var utcDay  = now.getUTCDay();    // 0=Sun,1=Mon,...,5=Fri,6=Sat
  var utcMins = now.getUTCHours() * 60 + now.getUTCMinutes();
  var closeMins = 22 * 60; // 10pm UTC
  if (utcDay === 6) return false;                      // Saturday always closed
  if (utcDay === 0) return utcMins >= closeMins;       // Sunday open after 10pm UTC
  if (utcDay === 5) return utcMins < closeMins;        // Friday close at 10pm UTC
  return true;                                         // Mon-Thu always open
}

// ── START PRICE REFRESH ──
// Crypto: real CoinGecko every 60s regardless of market hours
// Forex + Commodities: simulation only runs when market is open
function startPriceRefresh(pricesObj, onUpdate) {
  loadLivePrices(pricesObj).then(function() { if (onUpdate) onUpdate(); });

  // Crypto: real data every 60s — no market hours
  setInterval(function() {
    fetchCryptoPrices(pricesObj).then(function() { if (onUpdate) onUpdate(); });
  }, 60000);

  // Forex seed refresh every 24 hours — only when market open
  setInterval(function() {
    if (isMarketOpen()) loadForexPrices(pricesObj);
  }, 24 * 60 * 60 * 1000);

  // Commodity seed refresh every hour — only when market open
  setInterval(function() {
    if (isMarketOpen()) loadCommodityPrices(pricesObj).then(function() { if (onUpdate) onUpdate(); });
  }, COMMODITY_TTL);

  // Simulation tick every 10s — pauses on weekends/after hours
  var _saveTimer = null;
  setInterval(function() {
    if (!isMarketOpen()) return;
    var simSymbols = Object.keys(SIM_RANGES);
    var changed    = false;
    var forexUpdate  = { updatedAt: Date.now() };
    var commodUpdate = { updatedAt: Date.now() };
    var forexSyms    = Object.keys({ 'EUR/USD':1,'GBP/USD':1,'USD/JPY':1,'USD/CHF':1,'AUD/USD':1,'USD/CAD':1,'EUR/GBP':1,'NZD/USD':1 });
    var commodSyms   = Object.keys({ 'XAU/USD':1,'XAG/USD':1,'WTI/USD':1,'NGAS/USD':1,'XPT/USD':1 });
    simSymbols.forEach(function(sym) {
      if (_simState[sym]) {
        var newPrice = _tickSimPrice(sym);
        if (newPrice) {
          pricesObj[sym] = newPrice;
          changed = true;
          if (forexSyms.indexOf(sym) !== -1)  forexUpdate['sim_' + sym.replace('/', '_')] = newPrice;
          if (commodSyms.indexOf(sym) !== -1) commodUpdate['sim_' + sym.replace('/', '_')] = newPrice;
        }
      }
    });
    if (changed) {
      if (onUpdate) onUpdate();
      clearTimeout(_saveTimer);
      _saveTimer = setTimeout(function() {
        db.collection('forexPrices').doc('latest').update(forexUpdate).catch(function(){});
        db.collection('commodityPrices').doc('latest').update(commodUpdate).catch(function(){});
      }, 500);
    }
  }, SIM_TICK);

  // ── MARKET CLOSE WATCHER ──
  // Checks every minute for the Friday 10pm UTC transition
  // Closes all open Forex/Commodity trades and stops copy trading engines
  var _marketWasOpen = isMarketOpen();
  var _closingForMarket = false;
  setInterval(function() {
    var nowOpen = isMarketOpen();
    if (_marketWasOpen && !nowOpen && !_closingForMarket) {
      _closingForMarket = true;
      closeAllTradesForMarketClose().then(function() { _closingForMarket = false; });
    }
    _marketWasOpen = nowOpen;
  }, 60000);
}

// Close all open Forex + Commodity trades at market close
async function closeAllTradesForMarketClose() {
  try {
    var user = auth.currentUser;
    if (!user) return;
    var snap = await db.collection('trades')
      .where('userId', '==', user.uid)
      .where('status', '==', 'open').get();
    if (snap.empty) return;
    var simSymbols = ['EUR/USD','GBP/USD','USD/JPY','USD/CHF','AUD/USD','USD/CAD','EUR/GBP','NZD/USD','XAU/USD','XAG/USD','WTI/USD','NGAS/USD','XPT/USD'];
    var closedCount = 0;
    var totalPnL    = 0;
    for (var i = 0; i < snap.docs.length; i++) {
      var doc = snap.docs[i];
      var t   = doc.data();
      if (simSymbols.indexOf(t.symbol) === -1) continue; // Skip crypto
      var exitPrice = _simState[t.symbol] ? _simState[t.symbol].current : t.entryPrice;
      var pnl       = calcPnL(t, exitPrice);
      await db.collection('trades').doc(doc.id).update({
        status: 'closed', exitPrice: exitPrice, profitLoss: pnl,
        closedAt: firebase.firestore.FieldValue.serverTimestamp(), closedBy: 'market_close'
      });
      totalPnL += pnl;
      closedCount++;
    }
    if (closedCount > 0) {
      var userSnap = await db.collection('users').doc(user.uid).get();
      var newBal   = (userSnap.data().balance || 0) + totalPnL;
      await db.collection('users').doc(user.uid).update({ balance: newBal });
      // Stop all copy trading engines for this user
      Object.keys(_copyIntervals).forEach(function(key) {
        if (key.indexOf(user.uid) === 0) {
          clearTimeout(_copyIntervals[key]);
          delete _copyIntervals[key];
        }
      });
      if (typeof showToast === 'function') {
        var pnlStr = (totalPnL >= 0 ? '+' : '') + '$' + Math.abs(totalPnL).toFixed(2);
        showToast('Market closed — ' + closedCount + ' position' + (closedCount > 1 ? 's' : '') + ' closed. P&L: ' + pnlStr, totalPnL >= 0 ? 'success' : 'error');
      }
    }
  } catch(e) { console.error('Market close error:', e); }
}

// ── COPY TRADER ENGINE ──
// 10 traders, each with a hidden personality.
// They trade Forex and Commodities only (simulation-controlled prices).
// Win rates, trade frequency, instrument bias and position sizing are hidden here.
var COPY_TRADERS = {
  'Marcus Elliot':     { wr:0.87, freq:8,  posSize:0.08, bias:{ 'EUR/USD':0.6, 'GBP/USD':0.5, 'USD/JPY':0.4 }, style:'trend'    },
  'Sophia Chen':       { wr:0.82, freq:6,  posSize:0.07, bias:{ 'EUR/USD':0.5, 'XAU/USD':0.4, 'GBP/USD':0.3 }, style:'mixed'    },
  'Micheal Robertson': { wr:0.79, freq:12, posSize:0.12, bias:{ 'GBP/USD':0.7, 'USD/JPY':0.6, 'AUD/USD':0.4 }, style:'scalp'    },
  'Lena Hartmann':     { wr:0.84, freq:4,  posSize:0.06, bias:{ 'EUR/GBP':0.6, 'USD/CHF':0.5, 'NZD/USD':0.4 }, style:'swing'    },
  'Rafael Torres':     { wr:0.76, freq:10, posSize:0.15, bias:{ 'XAU/USD':0.7, 'WTI/USD':0.6, 'XAG/USD':0.5 }, style:'breakout' },
  'Kirk Bonde':        { wr:0.91, freq:3,  posSize:0.05, bias:{ 'EUR/USD':0.7, 'USD/CHF':0.6, 'EUR/GBP':0.5 }, style:'trend'    },
  'Dmitri Volkov':     { wr:0.88, freq:9,  posSize:0.09, bias:{ 'USD/JPY':0.7, 'USD/CAD':0.6, 'AUD/USD':0.5 }, style:'algo'     },
  'Priya Nair':        { wr:0.80, freq:5,  posSize:0.07, bias:{ 'XAU/USD':0.8, 'XAG/USD':0.7, 'XPT/USD':0.5 }, style:'commodity'},
  'Carlos Mendez':     { wr:0.74, freq:11, posSize:0.13, bias:{ 'GBP/USD':0.6, 'WTI/USD':0.5, 'USD/CAD':0.4 }, style:'news'     },
  'Isabelle Fontaine': { wr:0.93, freq:2,  posSize:0.04, bias:{ 'EUR/USD':0.8, 'EUR/GBP':0.7, 'USD/CHF':0.6 }, style:'conservative'}
};

// Track active copy trader intervals per user copy session
var _copyIntervals = {};

// Called when a user copies a trader — starts auto-trading engine
// Fires 2 trades at a time, then waits interval before next pair
// Reads copyMaxTrades and copyRR from user's Firestore document
function startCopyTrading(traderName, userId, allocation, pricesObj) {
  var profile = COPY_TRADERS[traderName];
  if (!profile) return;
  var sessionKey = userId + '_' + traderName.replace(/ /g,'_');
  if (_copyIntervals[sessionKey]) return;

  db.collection('users').doc(userId).get().then(function(snap) {
    var userData  = snap.exists ? snap.data() : {};
    var maxTrades = userData.copyMaxTrades !== undefined ? userData.copyMaxTrades : 2;
    var rrRatio   = userData.copyRR        !== undefined ? userData.copyRR        : 1;
    var riskPct   = userData.copyRisk      !== undefined ? userData.copyRisk      : 3;
    var sessionData = { maxTrades: maxTrades, rrRatio: rrRatio, riskPct: riskPct, count: 0 };

    // ── Read today's already-fired trade count from Firestore ──
    var todayStr = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
    var countDocId = userId + '_' + traderName.replace(/ /g,'_') + '_' + todayStr;

    db.collection('copyTradeCounts').doc(countDocId).get().then(function(countSnap) {
      sessionData.count = (countSnap.exists && countSnap.data().count) ? countSnap.data().count : 0;

      var pairInterval = Math.floor((24 * 60 * 60 * 1000) / Math.ceil(maxTrades / 2));

      async function firePair(tradesToFire) {
        var promises = [];
        for (var i = 0; i < tradesToFire; i++) {
          promises.push(_executeCopyTrade(traderName, profile, userId, allocation, pricesObj, sessionData.rrRatio, sessionData.riskPct));
        }
        await Promise.all(promises);
        sessionData.count += tradesToFire;
        // Persist updated count to Firestore
        db.collection('copyTradeCounts').doc(countDocId).set({ count: sessionData.count, date: todayStr }, { merge: true });
      }

      function scheduleNextPair() {
        if (sessionData.count >= sessionData.maxTrades) return;
        var jitter = (Math.random() - 0.5) * pairInterval * 0.4;
        var delay  = Math.max(pairInterval + jitter, 60000);
        _copyIntervals[sessionKey] = setTimeout(async function() {
          if (!isMarketOpen()) { scheduleNextPair(); return; }
          // Re-read config + count in case admin changed it or page reloaded
          var freshSnap = await db.collection('users').doc(userId).get();
          var freshData = freshSnap.exists ? freshSnap.data() : {};
          sessionData.maxTrades = freshData.copyMaxTrades !== undefined ? freshData.copyMaxTrades : 5;
          sessionData.rrRatio   = freshData.copyRR        !== undefined ? freshData.copyRR        : 1;
          sessionData.riskPct   = freshData.copyRisk      !== undefined ? freshData.copyRisk      : 10;
          // Re-read today's count from Firestore to survive refreshes
          var freshCountSnap = await db.collection('copyTradeCounts').doc(countDocId).get();
          sessionData.count = (freshCountSnap.exists && freshCountSnap.data().count) ? freshCountSnap.data().count : 0;
          if (sessionData.count >= sessionData.maxTrades) return;
          var tradesToFire = Math.min(2, sessionData.maxTrades - sessionData.count);
          await firePair(tradesToFire);
          scheduleNextPair();
        }, delay);
      }

      // First pair — only fire if limit not already hit today
      if (sessionData.count >= sessionData.maxTrades) return;
      var firstDelay = 30000 + Math.random() * 30000;
      _copyIntervals[sessionKey] = setTimeout(async function() {
        if (!isMarketOpen()) { scheduleNextPair(); return; }
        // Re-check count right before firing (another tab may have beaten us)
        var guardSnap = await db.collection('copyTradeCounts').doc(countDocId).get();
        sessionData.count = (guardSnap.exists && guardSnap.data().count) ? guardSnap.data().count : 0;
        if (sessionData.count >= sessionData.maxTrades) { scheduleNextPair(); return; }
        var tradesToFire = Math.min(2, sessionData.maxTrades - sessionData.count);
        await firePair(tradesToFire);
        scheduleNextPair();
      }, firstDelay);
    });
  });
}

function stopCopyTrading(traderName, userId) {
  var sessionKey = userId + '_' + traderName.replace(/ /g,'_');
  if (_copyIntervals[sessionKey]) {
    clearTimeout(_copyIntervals[sessionKey]);
    delete _copyIntervals[sessionKey];
  }
}

async function _executeCopyTrade(traderName, profile, userId, allocation, pricesObj, rrRatio, riskPct) {
  rrRatio = rrRatio || 1;
  riskPct = riskPct || 10;
  try {
    // Pick instrument based on bias weights
    var instruments = Object.keys(profile.bias);
    var weights     = instruments.map(function(s) { return profile.bias[s]; });
    var totalWeight = weights.reduce(function(a,b){ return a+b; }, 0);
    var rand = Math.random() * totalWeight;
    var chosen = instruments[0];
    for (var i = 0; i < weights.length; i++) {
      rand -= weights[i];
      if (rand <= 0) { chosen = instruments[i]; break; }
    }
    var entryPrice = pricesObj[chosen];
    if (!entryPrice) return;

    // Determine trade direction using win rate + simulation trend
    var sim = _simState[chosen];
    var trendDir = sim ? sim.trendDir : 1;
    // Win rate determines how often we align with the trend
    var alignWithTrend = Math.random() < profile.wr;
    var tradeType = alignWithTrend ? (trendDir > 0 ? 'BUY' : 'SELL') : (trendDir > 0 ? 'SELL' : 'BUY');

    // ── Position sizing & TP/SL — RR ratio from admin config, 10% risk on SL ──
    // SL distances tuned for 2-5 minute trade duration (8 ticks at current sim speed)
    // TP = SL * rrRatio (set per user by admin, default 1:1)
    var SL_DIST = {
      'EUR/USD': 0.00187, 'GBP/USD': 0.00240, 'USD/JPY': 0.173,
      'USD/CHF': 0.00173, 'AUD/USD': 0.00160, 'USD/CAD': 0.00173,
      'EUR/GBP': 0.00147, 'NZD/USD': 0.00133,
      'XAU/USD': 4.8,     'XAG/USD': 0.12,    'WTI/USD': 0.48,
      'NGAS/USD': 0.0213, 'XPT/USD': 3.73
    };
    var commoditySymbols = ['XAU/USD','XAG/USD','WTI/USD','NGAS/USD','XPT/USD'];
    var isCommodity      = commoditySymbols.indexOf(chosen) !== -1;
    var slDist           = SL_DIST[chosen] || 0.0010;
    var tpDist           = slDist * rrRatio; // TP = SL * RR ratio from admin config
    var targetLoss = allocation * (riskPct / 100); // risk % of allocation on SL

    // Work backwards from SL: lotSize = targetLoss / (slDist * multiplier)
    var multiplier = chosen.includes('JPY') ? 100 : isCommodity ? 1 : 10000;
    var lotSize    = parseFloat((targetLoss / (slDist * multiplier)).toFixed(4));
    if (!lotSize || lotSize <= 0) lotSize = 0.01;

    var tp = tradeType === 'BUY' ? entryPrice + tpDist : entryPrice - tpDist;
    var sl = tradeType === 'BUY' ? entryPrice - slDist : entryPrice + slDist;

    // Save trade to Firestore
    var tradeDoc = {
      userId:       userId,
      traderName:   traderName,
      symbol:       chosen,
      type:         tradeType,
      entryPrice:   entryPrice,
      lotSize:      lotSize,
      takeProfit:   parseFloat(tp.toFixed(5)),
      stopLoss:     parseFloat(sl.toFixed(5)),
      status:       'open',
      isCopyTrade:  true,
      allocation:   allocation,
      openedAt:     firebase.firestore.FieldValue.serverTimestamp()
    };
    await db.collection('trades').add(tradeDoc);
  } catch(e) { console.error('Copy trade execution error:', e); }
}

// ============================================================
// TRADE P&L CALCULATION
// ============================================================
function calcPnL(trade, currentPrice) {
  if (!currentPrice || !trade.entryPrice) return 0;
  var multiplier = trade.symbol.includes('JPY') ? 100 : 10000;
  var cryptoSymbols = ['BTC/USD', 'ETH/USD', 'XRP/USD', 'SOL/USD', 'BNB/USD', 'ADA/USD', 'AVAX/USD'];
  var commoditySymbols = ['XAU/USD', 'XAG/USD', 'WTI/USD', 'NGAS/USD', 'XPT/USD'];
  var isCrypto = cryptoSymbols.includes(trade.symbol);
  var isCommodity = commoditySymbols.includes(trade.symbol);
  var mult = (isCrypto || isCommodity) ? 1 : multiplier;
  var priceDiff = trade.type === 'BUY'
    ? currentPrice - trade.entryPrice
    : trade.entryPrice - currentPrice;
  return parseFloat((priceDiff * trade.lotSize * mult).toFixed(2));
}

// ============================================================
// ACCOUNT ID GENERATION
// ============================================================
async function generateAccountId() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var id, exists = true;
  while (exists) {
    var rand = '';
    for (var i = 0; i < 8; i++) {
      rand += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    id = 'NXT-' + rand;
    var snap = await db.collection('users').where('accountId', '==', id).limit(1).get();
    exists = !snap.empty;
  }
  return id;
}

// ============================================================
// FORMATTING HELPERS
// ============================================================
function fmtCurrency(n, decimals) {
  decimals = decimals !== undefined ? decimals : 2;
  var num = parseFloat(n) || 0;
  var sign = num < 0 ? '-' : '';
  return sign + '$' + Math.abs(num).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

function fmtPrice(price, symbol) {
  var inst = getInstrument(symbol);
  if (!inst) return parseFloat(price).toFixed(4);
  if (symbol === 'BTC/USD') return parseFloat(price).toFixed(2);
  if (['ETH/USD', 'SOL/USD', 'BNB/USD', 'AVAX/USD'].includes(symbol)) return parseFloat(price).toFixed(2);
  if (['XRP/USD', 'ADA/USD'].includes(symbol)) return parseFloat(price).toFixed(4);
  if (symbol.includes('JPY')) return parseFloat(price).toFixed(3);
  if (['XAU/USD', 'XPT/USD', 'WTI/USD'].includes(symbol)) return '$' + parseFloat(price).toFixed(2);
  if (['XAG/USD', 'NGAS/USD'].includes(symbol)) return '$' + parseFloat(price).toFixed(3);
  return parseFloat(price).toFixed(4);
}

function fmtDate(ts) {
  if (!ts) return '--';
  var d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ============================================================
// TOAST
// ============================================================
function showToast(msg, type) {
  type = type || 'success';
  var old = document.querySelector('.nt-toast');
  if (old) old.remove();
  var t = document.createElement('div');
  t.className = 'nt-toast nt-toast--' + type;
  t.innerHTML = '<span>' + msg + '</span>';
  document.body.appendChild(t);
  setTimeout(function() { t.classList.add('show'); }, 10);
  setTimeout(function() { t.classList.remove('show'); setTimeout(function() { t.remove(); }, 300); }, 3500);
}

// ============================================================
// THEME TOGGLE
// ============================================================
function initTheme() {
  var saved = localStorage.getItem('nt-theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
  var btn = document.getElementById('themeToggle');
  if (btn) {
    var sunSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
    var moonSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z"/></svg>';
    btn.innerHTML = saved === 'dark' ? sunSvg : moonSvg;
  }
}

function toggleTheme() {
  var cur = document.documentElement.getAttribute('data-theme');
  var next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('nt-theme', next);
  var btn = document.getElementById('themeToggle');
  if (btn) {
    var sunSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
    var moonSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z"/></svg>';
    btn.innerHTML = next === 'dark' ? sunSvg : moonSvg;
  }
}

// ============================================================
// AUTH GUARDS
// ============================================================
function requireAuth(callback) {
  auth.onAuthStateChanged(function(user) {
    if (!user) { window.location.href = 'login.html'; return; }
    callback(user);
  });
}

function requireAdmin(callback) {
  auth.onAuthStateChanged(async function(user) {
    if (!user) { window.location.href = 'login.html'; return; }
    try {
      var snap = await db.collection('admins').doc(user.uid).get();
      if (!snap.exists) { window.location.href = 'dashboard.html'; return; }
      callback(user, snap.data());
    } catch(e) {
      console.error('Admin auth check failed:', e);
      var ol = document.getElementById('loadingOverlay');
      if (ol) {
        ol.innerHTML = '<div style="text-align:center;padding:40px;">' +
          '<div style="font-size:1.1rem;font-weight:700;color:#e74c3c;margin-bottom:12px;">Access Error</div>' +
          '<div style="font-size:.85rem;color:#888;max-width:340px;margin:0 auto;">' +
            'Could not verify admin privileges. Check your Firestore security rules and ensure your UID is in the <strong>admins</strong> collection.' +
          '</div>' +
          '<a href="login.html" style="display:inline-block;margin-top:20px;padding:8px 20px;background:#f0b429;color:#111;border-radius:6px;text-decoration:none;font-weight:700;">Back to Login</a>' +
        '</div>';
        ol.style.display = 'flex';
        ol.style.flexDirection = 'column';
        ol.style.justifyContent = 'center';
      }
    }
  });
}

// ============================================================
// SHARED NAV HIGHLIGHT
// ============================================================
function highlightNav() {
  var page = window.location.pathname.split('/').pop();
  document.querySelectorAll('.nav-link').forEach(function(a) {
    if (a.getAttribute('href') === page) a.classList.add('active');
  });
}

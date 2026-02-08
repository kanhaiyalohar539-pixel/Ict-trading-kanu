// ======================================================
// BASE CHART SETUP
// ======================================================
const chart = LightweightCharts.createChart(document.getElementById("chart"), {
    layout: { background: { color: "#0d0d0d" }, textColor: "#fff" },
    grid: { vertLines: { color: "#222" }, horzLines: { color: "#222" }},
    timeScale: { borderColor: "#444" },
});

const candleSeries = chart.addCandlestickSeries();
const volumeSeries = chart.addHistogramSeries({ priceFormat: { type: "volume" }});
const buySellSeries = chart.addHistogramSeries({ priceFormat: { type: "volume" }});

// ======================================================
// MULTI-SYMBOL LIVE SOCKETS
// ======================================================
let socket;
let currentSymbol = "btcusdt";

const sockets = {
    btcusdt: "wss://stream.binance.com:9443/ws/btcusdt@kline_1m",
    ethusdt: "wss://stream.binance.com:9443/ws/ethusdt@kline_1m",
};

// Forex API for XAU & XAG
async function getForex(symbol) {
    let r = await fetch(`https://api.exchangerate.host/latest?base=USD&symbols=${symbol}`);
    let d = await r.json();
    return d.rates[symbol];
}

// ======================================================
// START SOCKET FUNCTION
// ======================================================
function startSocket(sym) {
    if (socket) socket.close();
    currentSymbol = sym;

    if (sym === "xauusd" || sym === "xagusd") {
        runForex(sym);
        return;
    }

    socket = new WebSocket(sockets[sym]);

    socket.onmessage = (event) => {
        let k = JSON.parse(event.data).k;

        let candle = {
            time: k.t / 1000,
            open: +k.o,
            high: +k.h,
            low: +k.l,
            close: +k.c,
        };

        candleSeries.update(candle);

        // Volume
        volumeSeries.update({
            time: k.t / 1000,
            value: +k.v,
            color: k.c > k.o ? "#26a69a" : "#ef5350",
        });

        // FOOTPRINT BUY/SELL
        let buy = k.c > k.o ? +k.v : 0;
        let sell = k.c < k.o ? +k.v : 0;

        buySellSeries.update({
            time: k.t / 1000,
            value: buy - sell,
            color: buy > sell ? "lime" : "red",
        });

        processICT();
    };
}

// ======================================================
// FOREX LIVE EMULATION
// ======================================================
function runForex(sym) {
    setInterval(async () => {
        let p = await getForex(sym === "xauusd" ? "XAU" : "XAG");
        let t = Math.floor(Date.now() / 1000);

        candleSeries.update({
            time: t,
            open: p,
            high: p + 0.05,
            low: p - 0.05,
            close: p
        });

        volumeSeries.update({ time: t, value: Math.random() * 10 });

        processICT();
    }, 1200);
}

// Default start
startSocket("btcusdt");

// Symbol switch
window.switchSymbol = function (sym) {
    startSocket(sym);
};

// ======================================================
// ICT / MMC ENGINE
// ======================================================
function last(n = 10) {
    return candleSeries._series._data._items.slice(-n);
}

function drawLine(time, price, color) {
    const s = chart.addLineSeries({ color, lineWidth: 2 });
    s.update({ time, value: price });
}

function drawZone(start, end, high, low, color) {
    const s = chart.addAreaSeries({
        topColor: color,
        bottomColor: "rgba(0,0,0,0)",
        lineColor: color,
        lineWidth: 1
    });
    s.setData([
        { time: start, value: high },
        { time: end, value: low },
    ]);
}

// ======================================================
// LIQUIDITY (EQUAL HIGHS / LOWS)
// ======================================================
function detectLiquidity() {
    let d = last(4);
    if (d.length < 3) return;

    let a = d[d.length - 3];
    let b = d[d.length - 2];

    // EQH
    if (Math.abs(a.high - b.high) < a.high * 0.0002) {
        drawLine(b.time, b.high, "yellow");
    }

    // EQL
    if (Math.abs(a.low - b.low) < a.low * 0.0002) {
        drawLine(b.time, b.low, "yellow");
    }
}

// ======================================================
// FVG DETECTION
// ======================================================
function detectFVG() {
    let d = last(4);
    if (d.length < 3) return;

    let a = d[0], b = d[1], c = d[2];

    if (a.high < c.low) drawZone(b.time, c.time, b.high, b.low, "rgba(0,255,0,0.2)");
    if (a.low > c.high) drawZone(b.time, c.time, b.high, b.low, "rgba(255,0,0,0.2)");
}

// ======================================================
// ORDER BLOCKS
// ======================================================
function detectOrderBlocks() {
    let d = last(4);
    if (d.length < 2) return;

    let prev = d[d.length - 2];
    let lastC = d[d.length - 1];

    if (prev.close < prev.open && lastC.close > lastC.open) {
        drawZone(prev.time, lastC.time, prev.high, prev.low, "rgba(0,0,255,0.2)");
    }

    if (prev.close > prev.open && lastC.close < lastC.open) {
        drawZone(prev.time, lastC.time, prev.high, prev.low, "rgba(255,0,0,0.2)");
    }
}

// ======================================================
// BOS / MSS
// ======================================================
function detectBOS() {
    let d = last(4);
    if (d.length < 2) return;

    let prev = d[d.length - 2];
    let lastC = d[d.length - 1];

    if (lastC.high > prev.high) drawLine(lastC.time, lastC.high, "lime");
    if (lastC.low < prev.low) drawLine(lastC.time, lastC.low, "red");
}

// ======================================================
// MMC SWINGS
// ======================================================
function detectSwings() {
    let d = last(5);
    if (d.length < 5) return;

    let [a, b, c, d1, e] = d;

    if (c.high > b.high && c.high > d1.high)
        drawLine(c.time, c.high, "#00eaff");

    if (c.low < b.low && c.low < d1.low)
        drawLine(c.time, c.low, "#ff00ea");
}

// ======================================================
// PREMIUM / DISCOUNT LEVEL
// ======================================================
function detectPremiumDiscount() {
    let d = last(50);
    if (d.length < 5) return;

    let highest = Math.max(...d.map(x => x.high));
    let lowest = Math.min(...d.map(x => x.low));
    let mid = (highest + lowest) / 2;

    drawLine(d[d.length - 1].time, mid, "#888");
}

// ======================================================
// MASTER ENGINE (EVERY CANDLE)
// ======================================================
function processICT() {
    detectLiquidity();
    detectFVG();
    detectOrderBlocks();
    detectBOS();
    detectSwings();
    detectPremiumDiscount();
}
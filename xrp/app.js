/* TENBOB · XRP LIVE 24/7 - live XRP/USD price page.
   No libraries, no API keys. Sounds are synthesized live with the Web Audio API (no audio files).
   Data: Binance public websocket (port 443, then 9443, then the data-stream.binance.vision mirror),
         Binance REST polling (data-api.binance.vision / api.binance.com), then CoinGecko as last resort.
   Test options (URL):  ?demo=pump | dip | milestone | high | low | ticks    ?chart=candles    ?eur=0 */
(() => {
"use strict";
const $ = id => document.getElementById(id);
const Q = new URLSearchParams(location.search);
const CANDLES = Q.get("chart") === "candles";
const SHOW_EUR = Q.get("eur") !== "0";
const DEMO = Q.get("demo");
document.body.classList.add("front");
const TZ = "Europe/Dublin";
const WINDOW_MIN = 240;                        // chart window: 4h of 1-minute candles
const MA_EXTRA = 60;                           // extra minutes so MA50 covers the visible chart
const MOVE_PCT = 1.0, MOVE_WIN_MS = 15 * 60e3; // pump/dip trigger: 1% within 15 min
const MOVE_COOLDOWN_MS = 10 * 60e3;
const moveText = (up, pct) => "XRP " + (up ? "UP" : "DOWN") + " " + Math.abs(pct).toFixed(1) + "% IN 15 MIN";
const STEP = 0.05;                             // milestone step in USD
const WS_HOSTS = ["wss://stream.binance.com:443", "wss://stream.binance.com:9443", "wss://data-stream.binance.vision"];
const REST_HOSTS = ["https://data-api.binance.vision", "https://api.binance.com"];
const CG = "https://api.coingecko.com/api/v3";
const YT = "https://www.youtube.com/@Tenbob_YT";
const TICKER_LINES = [
  {t: "Not financial advice"},
  {t: "Like and subscribe"},
  {h: `Drop your XRP price prediction in the <a href="${YT}" target="_blank" rel="noopener">YouTube chat</a>`},
  {t: "XRP live price 24/7"},
  {t: "Prices move both ways. NFA."}
];
const TICK_GAP_MS = 1500;                      // ping/pong at most once per 1.5 s (net direction)
const HL_COOLDOWN_MS = 5 * 60e3;               // NEW DAY HIGH / LOW cooldown
if (!SHOW_EUR) $("eur").parentNode.style.display = "none";

/* ---------------- state ---------------- */
const S = {
  price: null, prevPrice: null, pct: null, hi: null, lo: null, vol: null, qvol: null, eurRate: null,
  candles: [], samples: [], lastTickAt: 0, source: "", mode: "init",
  lastMoveBanner: {pump: 0, dip: 0}, milestoneLevel: null, milestoneAt: {}, bootAt: Date.now(),
  hl: {hi: null, lo: null, at: {high: 0, low: 0}}
};
const fmt = (v, d = 4) => { const n = Number(v); return Number.isFinite(n) ? n.toFixed(d) : "-"; };
const fmtBig = v => v == null || isNaN(v) ? "-" : v >= 1e9 ? (v/1e9).toFixed(2)+"B" : v >= 1e6 ? (v/1e6).toFixed(1)+"M" : v >= 1e3 ? (v/1e3).toFixed(1)+"K" : v.toFixed(0);

/* ---------------- responsive layout: make the price as big as the screen allows ---------------- */
const L = {k: 1, chart: {x: 0, y: 0, w: 1, h: 1}, bannerY: 100};
function fitPrice(){
  const el = $("price"), plot = $("plot");
  if (!el || !plot || plot.clientWidth < 20) return;
  const portrait = innerWidth / innerHeight < 0.9;
  const scale = Math.min(innerWidth / 1920, innerHeight / 1080);
  let size = portrait
    ? Math.min(plot.clientWidth * 0.2, plot.clientHeight * 0.24, 128)
    : Math.min(250 * Math.max(scale, 0.55), plot.clientHeight * 0.36, plot.clientWidth * 0.18);
  size = Math.max(portrait ? 44 : 78, Math.floor(size || 64));
  el.style.fontSize = size + "px";
  const maxW = plot.clientWidth * (portrait ? 0.74 : 0.82);
  if (el.scrollWidth > maxW && el.scrollWidth > 0) el.style.fontSize = Math.max(32, Math.floor(size * maxW / el.scrollWidth)) + "px";
}
function layout(){
  const plot = $("plot");
  if (!plot || plot.clientWidth < 20) return;
  const portrait = innerWidth / innerHeight < 0.9;
  L.k = portrait ? Math.max(.4, innerWidth / 900) : Math.max(.5, Math.min(innerWidth / 1920, innerHeight / 1080));
  fitPrice();
  const total = Math.max(140, plot.clientHeight);
  const vh = Math.round(Math.max(46, Math.min(120, total * (portrait ? 0.18 : 0.15))));
  const h = Math.max(90, total - vh);
  const cv = $("chart");
  cv.style.top = "0px";
  cv.style.height = h + "px";
  sizeCanvas(cv, plot.clientWidth, h);
  const vc = $("volChart");
  vc.style.top = h + "px";
  vc.style.height = (total - h) + "px";
  sizeCanvas(vc, plot.clientWidth, total - h);
  L.chart = {x: 0, y: 0, w: plot.clientWidth, h};
  L.vol = {y: h, h: total - h};
  chartDirty = true;
  volAt = 0;
  sizeCanvas($("fx"), innerWidth, innerHeight);
  fxc.setTransform(devicePixelRatio || 1, 0, 0, devicePixelRatio || 1, 0, 0);
  if (window.__fitCoins) window.__fitCoins();
}
function sizeCanvas(c, w, h){ const r = devicePixelRatio || 1; c.width = Math.round(w * r); c.height = Math.round(h * r); }
let layoutT = null;
addEventListener("resize", () => { clearTimeout(layoutT); layoutT = setTimeout(layout, 60); });
addEventListener("orientationchange", () => setTimeout(layout, 250));

/* ---------------- UI updates ---------------- */
function renderPrice(){
  const p = S.price; if (p == null) return;
  const el = $("price"), txt = "$" + fmt(p);
  const relayout = txt.length !== el.textContent.length;
  el.textContent = txt;
  if (relayout) layout();
  if (S.prevPrice != null && p !== S.prevPrice){
    el.classList.remove("up", "down"); void el.offsetWidth;
    el.classList.add(p > S.prevPrice ? "up" : "down");
  }
  if (S.pct != null && isFinite(S.pct)){
    const up = S.pct >= 0;
    $("change").className = up ? "up" : "down";
    el.classList.toggle("tUp", up); el.classList.toggle("tDown", !up);
    $("arrow").textContent = up ? "▲" : "▼";
    $("pct").textContent = (up ? "+" : "") + S.pct.toFixed(2) + "%";
  }
  if (SHOW_EUR && S.eurRate) $("eur").textContent = "€" + fmt(p * S.eurRate);
  const hiTxt = S.hi != null ? "$" + fmt(S.hi) : "-", loTxt = S.lo != null ? "$" + fmt(S.lo) : "-";
  const hlRelayout = hiTxt.length !== $("hlHighV").textContent.length || loTxt.length !== $("hlLowV").textContent.length;
  $("hlHighV").textContent = hiTxt; $("hlLowV").textContent = loTxt;
  $("vol").textContent = fmtBig(S.vol);
  $("qvol").textContent = S.qvol != null ? "$" + fmtBig(S.qvol) : "-";
  document.title = "$" + fmt(p) + " XRP Live Price 24/7 | Tenbob";
  if (hlRelayout && !relayout) layout();
}
function setSource(label, cls){
  S.source = label; $("creditText").textContent = "Live: " + label;
  $("status").className = cls || "";
}

/* single entry point for every new price, regardless of source */
function onPrice(p, ts = Date.now()){
  if (!(p > 0)) return;
  S.prevPrice = S.price; S.price = p; S.lastTickAt = Date.now();
  const m = Math.floor(ts / 60e3) * 60e3, last = S.candles[S.candles.length - 1];
  if (last && last.t === m){ last.c = p; if (p > last.h) last.h = p; if (p < last.l) last.l = p; }
  else if (!last || m > last.t){ S.candles.push({t: m, o: last ? last.c : p, h: p, l: p, c: p}); trimCandles(); }
  const sl = S.samples[S.samples.length - 1];
  if (!sl || ts - sl.t >= 1000) S.samples.push({t: ts, p});
  while (S.samples.length && ts - S.samples[0].t > MOVE_WIN_MS) S.samples.shift();
  renderPrice(); checkMove(); checkMilestone(p); checkHighLow(p); tickSound(p); chartDirty = true;
}
function trimCandles(){ while (S.candles.length > WINDOW_MIN + MA_EXTRA) S.candles.shift(); }
function setCandles(arr){
  const live = S.candles.filter(c => c.t > (arr.length ? arr[arr.length-1].t : 0));
  S.candles = arr.concat(live); trimCandles();
  if (!S.samples.length){
    const now = Date.now();
    S.candles.filter(c => now - c.t <= MOVE_WIN_MS).forEach(c => S.samples.push({t: c.t + 59e3, p: c.c}));
  }
  chartDirty = true;
}

/* ---------------- pump / dip / milestone / new day high-low ---------------- */
function checkMove(){
  if (DEMO || Date.now() - S.bootAt < 20e3 || S.samples.length < 2) return;
  const now = Date.now(), p = S.price;
  let min = Infinity, max = -Infinity;
  for (const s of S.samples){ if (s.p < min) min = s.p; if (s.p > max) max = s.p; }
  if (p >= min * (1 + MOVE_PCT/100) && now - S.lastMoveBanner.pump > MOVE_COOLDOWN_MS){
    S.lastMoveBanner.pump = now; S.samples = [{t: now, p}];
    showBanner("pump", moveText(true, (p / min - 1) * 100), "XRP PUMPING");
  } else if (p <= max * (1 - MOVE_PCT/100) && now - S.lastMoveBanner.dip > MOVE_COOLDOWN_MS){
    S.lastMoveBanner.dip = now; S.samples = [{t: now, p}];
    showBanner("dip", moveText(false, (1 - p / max) * 100), "XRP DIPPING");
  }
}
function checkMilestone(p){
  const lvl = Math.floor(p / STEP + 1e-9);
  if (S.milestoneLevel == null || DEMO){ S.milestoneLevel = lvl; return; }
  if (lvl === S.milestoneLevel) return;
  const up = lvl > S.milestoneLevel, crossed = (up ? lvl : S.milestoneLevel) * STEP;
  S.milestoneLevel = lvl;
  const key = crossed.toFixed(2), now = Date.now();
  if (now - (S.milestoneAt[key] || 0) < 30 * 60e3) return;
  S.milestoneAt[key] = now;
  showBanner("mile", `XRP CROSSES $${key} ${up ? "⬆" : "⬇"}`);
}
function checkHighLow(p){
  const H = S.hl, prevHi = H.hi, prevLo = H.lo;
  H.hi = Math.max(S.hi != null ? S.hi : p, p);
  H.lo = Math.min(S.lo != null ? S.lo : p, p);
  if (DEMO || Date.now() - S.bootAt < 30e3) return;
  const now = Date.now();
  if (prevHi != null && p > prevHi && now - H.at.high > HL_COOLDOWN_MS){ H.at.high = now; showBanner("high", "NEW DAY HIGH 🎉"); }
  else if (prevLo != null && p < prevLo && now - H.at.low > HL_COOLDOWN_MS){ H.at.low = now; showBanner("low", "NEW DAY LOW 📉"); }
}

/* ---------------- banner + particle FX ---------------- */
const bannerQ = []; let bannerBusy = false;
function showBanner(kind, text, sub){ bannerQ.push({kind, text, sub}); if (!bannerBusy) nextBanner(); }
function nextBanner(){
  const b = bannerQ.shift(); if (!b){ bannerBusy = false; return; }
  bannerBusy = true;
  const move = (b.kind === "pump" || b.kind === "dip") && $("flash");
  const el = $(move ? "flash" : "banner");
  el.className = ""; void el.offsetWidth;
  if (move){
    el.classList.add(b.kind === "pump" ? "up" : "down", "show");
    $("flashTag").textContent = b.sub || (b.kind === "pump" ? "XRP PUMPING" : "XRP DIPPING");
    const ft = $("flashText");
    ft.style.fontSize = "";
    ft.textContent = b.text;
    const avail = Math.max(80, el.clientWidth - 24), w = ft.scrollWidth;
    if (w > avail) ft.style.fontSize = Math.max(16, Math.floor(parseFloat(getComputedStyle(ft).fontSize) * avail / w)) + "px";
  } else {
    $("bannerText").textContent = b.text;
    el.classList.add(b.kind, "show");
  }
  burst(b.kind); setTimeout(() => burst(b.kind, true), 900);
  playSfx(b.kind);
  if (b.kind === "high" || b.kind === "low"){
    const r = $(b.kind === "high" ? "hlHigh" : "hlLow");
    r.classList.remove("flash"); void r.offsetWidth; r.classList.add("flash");
    setTimeout(() => r.classList.remove("flash"), 5600);
  }
  setTimeout(() => { el.className = ""; nextBanner(); }, move ? 5500 : 8100);
}
const fx = $("fx"), fxc = fx.getContext("2d"); let parts = [], fxDirty = false;
function burstOrigin(){
  const node = ($("flash") && $("flash").classList.contains("show")) ? $("flashText") : $("bannerText");
  const r = node.getBoundingClientRect();
  return [innerWidth / 2, r.height ? r.top + r.height / 2 : 90];
}
function burst(kind, small){
  if (kind === "high" || kind === "low") return confetti(kind, small);
  const cols = kind === "pump" ? ["#16e08a","#7dffc4","#ffffff","#ffd23f"] :
               kind === "dip" ? ["#ff4d5e","#ff9aa4","#ffffff","#ff6a3d"] : ["#ffd23f","#fff2a8","#ffffff","#23c4ff"];
  const emo = kind === "pump" ? "🚀" : kind === "dip" ? "📉" : "⭐";
  const k = L.k, n = small ? 40 : 90, [cx, cy] = burstOrigin();
  for (let i = 0; i < n; i++){
    const a = Math.random() * Math.PI * 2, v = (6 + Math.random() * (small ? 10 : 18)) * k;
    parts.push({x: cx + Math.cos(a)*120*k, y: cy + Math.sin(a)*40*k, vx: Math.cos(a)*v*1.6, vy: Math.sin(a)*v*0.6 - 6*k, g: .35*k,
      life: 0, max: 70 + Math.random()*60, r: (4 + Math.random()*8)*k, c: cols[i % cols.length], e: i % 9 === 0 ? emo : null});
  }
}
function confetti(kind, small){
  const hi = kind === "high", k = L.k;
  const cols = hi ? ["#ff3fa4","#ffd23f","#19f08f","#23c4ff","#a45bff","#ffffff","#ff7a2f"] : ["#26508f","#5f86c9","#9fb8e6","#3a4f73"];
  const emo = hi ? "🎉" : "📉", n = hi ? (small ? 70 : 160) : (small ? 25 : 55), [cx, cy] = burstOrigin();
  const spread = Math.min(innerWidth * .8, (hi ? 300 : 700) * k);
  for (let i = 0; i < n; i++){
    const a = hi ? Math.random() * Math.PI * 2 : Math.PI * (0.15 + Math.random() * 0.7);
    const v = (hi ? 6 + Math.random() * (small ? 12 : 22) : 2 + Math.random() * 5) * k;
    parts.push({x: cx + (Math.random() - .5) * spread, y: cy + Math.sin(a) * 30 * k, vx: Math.cos(a) * v * (hi ? 1.7 : 1), vy: Math.sin(a) * v * (hi ? .7 : .5) - (hi ? 7 * k : 0), g: .35*k,
      life: 0, max: (hi ? 90 : 80) + Math.random() * 70, r: (5 + Math.random() * 7)*k, c: cols[i % cols.length],
      e: i % (hi ? 12 : 9) === 0 ? emo : null, sq: true, rot: Math.random() * 6.283, vr: (Math.random() - .5) * .4, alpha: hi ? 1 : .7});
  }
}
function drawFx(){
  if (!parts.length && !fxDirty) return;
  fxc.clearRect(0, 0, innerWidth, innerHeight); fxDirty = parts.length > 0;
  for (const p of parts){
    p.life++; p.x += p.vx; p.y += p.vy; p.vx *= .97; p.vy = p.vy * .97 + p.g;
    const a = Math.max(0, 1 - p.life / p.max);
    fxc.globalAlpha = p.alpha ? a * p.alpha : a;
    if (p.e){ fxc.font = (p.r*5)+"px serif"; fxc.fillText(p.e, p.x, p.y); }
    else if (p.sq){ p.rot += p.vr; fxc.save(); fxc.translate(p.x, p.y); fxc.rotate(p.rot); fxc.fillStyle = p.c;
      fxc.fillRect(-p.r, -p.r * .45, p.r * 2, p.r * .9 * Math.abs(Math.cos(p.rot * 1.7)) + 1); fxc.restore(); }
    else { fxc.fillStyle = p.c; fxc.beginPath(); fxc.arc(p.x, p.y, p.r * (0.5 + a/2), 0, 6.283); fxc.fill(); }
  }
  fxc.globalAlpha = 1;
  parts = parts.filter(p => p.life < p.max);
}

/* ---------------- chart (own canvas renderer, faded behind the price) ---------------- */
const FONT = getComputedStyle(document.body).fontFamily;
const cv = $("chart"), cx = cv.getContext("2d"); let chartDirty = true, dispPrice = null;
const timeFmt = new Intl.DateTimeFormat("en-GB", {timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false});
function niceStep(range, n){ const raw = range / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag; }
/* ---------- volume bars + RSI(14) strip (1-minute Binance klines, same feed as the chart) ---------- */
let volAt = 0;
function rsi14(cl){ const n = 14; if (cl.length <= n) return [];
  let g = 0, l = 0; for (let i = 1; i <= n; i++){ const d = cl[i] - cl[i-1]; if (d > 0) g += d; else l -= d; }
  g /= n; l /= n; const out = new Array(n).fill(null); out.push(l === 0 ? 100 : 100 - 100 / (1 + g / l));
  for (let i = n + 1; i < cl.length; i++){ const d = cl[i] - cl[i-1]; g = (g * (n-1) + Math.max(d, 0)) / n; l = (l * (n-1) + Math.max(-d, 0)) / n;
    out.push(l === 0 ? 100 : 100 - 100 / (1 + g / l)); } return out; }
function drawVol(){
  const cv = $("volChart"); if (!cv || !L.vol) return; const vx = cv.getContext("2d");
  const r = devicePixelRatio || 1, k = L.k, W = L.chart.w, H = L.vol.h; vx.setTransform(r, 0, 0, r, 0, 0); vx.clearRect(0, 0, W, H);
  const data = S.candles.slice(-WINDOW_MIN); if (data.length < 2) return;
  const Lm = (W < 720 ? 8 : 12) * k, R = (W < 720 ? 78 : 120) * k, pw = Math.max(40, W - Lm - R), T = 4, B = 4, ph = H - T - B;
  const t0 = data[0].t, t1 = Math.max(t0 + (WINDOW_MIN - 1) * 60e3, data[data.length-1].t), X = t => Lm + (t - t0) / (t1 - t0) * pw;
  vx.fillStyle = "rgba(5,8,16,.55)"; vx.fillRect(0, 0, W, H);
  vx.strokeStyle = "rgba(255,255,255,.12)"; vx.lineWidth = 1; vx.beginPath(); vx.moveTo(0, .5); vx.lineTo(W, .5); vx.stroke();
  const vmax = Math.max(...data.map(c => c.v || 0)); const bw = Math.max(1, pw / WINDOW_MIN * 0.7);
  if (vmax > 0) for (const c of data){ if (!c.v) continue; const bh = c.v / vmax * ph * 0.9;
    vx.fillStyle = c.c >= c.o ? "rgba(25,240,143,.55)" : "rgba(255,77,94,.55)"; vx.fillRect(X(c.t) - bw / 2, T + ph - bh, bw, bh); }
  const Y = v => T + (1 - v / 100) * ph;
  vx.setLineDash([6, 6]); vx.strokeStyle = "rgba(255,255,255,.22)";
  for (const g of [30, 70]){ vx.beginPath(); vx.moveTo(Lm, Y(g)); vx.lineTo(Lm + pw, Y(g)); vx.stroke(); }
  vx.setLineDash([]);
  const rs = rsi14(data.map(c => c.c)); let lastR = null;
  vx.strokeStyle = "#23c4ff"; vx.lineWidth = Math.max(2, 2.5 * k); vx.lineJoin = "round"; vx.beginPath(); let st = false;
  rs.forEach((v, i) => { if (v == null) return; const x = X(data[i].t), y = Y(v); st ? vx.lineTo(x, y) : vx.moveTo(x, y); st = true; lastR = v; });
  vx.stroke();
  const fs = Math.round(Math.max(14, Math.min(H * 0.3, 26 * k)));
  vx.font = `800 ${fs}px ${FONT}`; vx.textBaseline = "middle";
  vx.fillStyle = "#b4bfd8"; vx.fillText("VOL", Lm + 6, T + fs * 0.7);
  vx.fillStyle = "rgba(255,255,255,.5)"; vx.font = `700 ${Math.round(fs*0.7)}px ${FONT}`;
  vx.fillText("70", Lm + pw + 6, Y(70)); vx.fillText("30", Lm + pw + 6, Y(30));
  if (lastR != null){ const txt = "RSI " + Math.round(lastR); vx.font = `900 ${fs}px ${FONT}`;
    const tw = vx.measureText(txt).width, bx = W - tw - 16, by = H / 2;
    vx.fillStyle = "rgba(5,8,16,.9)"; vx.fillRect(bx - 8, by - fs * 0.7, tw + 16, fs * 1.4);
    vx.strokeStyle = "#23c4ff"; vx.lineWidth = 2; vx.strokeRect(bx - 8, by - fs * 0.7, tw + 16, fs * 1.4);
    vx.fillStyle = lastR >= 70 ? "#19f08f" : lastR <= 30 ? "#ff4d5e" : "#fff"; vx.fillText(txt, bx, by); }
}
function drawChart(now){
  const r = devicePixelRatio || 1, k = L.k, W = L.chart.w, H = L.chart.h;
  cx.setTransform(r, 0, 0, r, 0, 0);
  const narrow = W < 720;
  const Lm = (narrow ? 8 : 12) * k, R = (narrow ? 96 : 140) * k, T = (H < 280 ? 16 : 28) * k, B = (H < 280 ? 20 : 30) * k, pw = Math.max(40, W - Lm - R), ph = Math.max(40, H - T - B);
  cx.clearRect(0, 0, W, H);
  const data = S.candles.slice(-WINDOW_MIN);
  if (data.length < 2 || S.price == null){
    cx.fillStyle = "#8a96b3"; cx.font = `700 ${Math.round(30*k)}px ${FONT}`;
    cx.fillText("Connecting to the live feed...", Lm + 8, Math.max(24, H - 24)); return;
  }
  if (dispPrice == null) dispPrice = S.price;
  dispPrice += (S.price - dispPrice) * 0.15;
  if (Math.abs(S.price - dispPrice) < 1e-6) dispPrice = S.price;
  const last = data[data.length-1];
  let lo = Infinity, hi = -Infinity;
  for (const c of data){ const l = CANDLES ? c.l : c.c, h = CANDLES ? c.h : c.c; if (l < lo) lo = l; if (h > hi) hi = h; }
  lo = Math.min(lo, dispPrice); hi = Math.max(hi, dispPrice);
  const dHi = S.hi, dLo = S.lo, baseR = Math.max(hi - lo, hi * 0.002);
  // y-axis fits the visible data only (24h high/low lines are drawn only when they fall inside it)
  const pad = Math.max((hi - lo) * 0.07, hi * 0.0004); lo -= pad; hi += pad;
  const t0 = data[0].t, t1 = t0 + (WINDOW_MIN - 1) * 60e3 > last.t ? t0 + (WINDOW_MIN - 1) * 60e3 : last.t;
  const X = t => Lm + (t - t0) / (t1 - t0) * pw;
  const Y = v => T + (hi - v) / (hi - lo) * ph;
  const f = px => `${Math.round(px * k)}px ${FONT}`;
  const step = niceStep(hi - lo, Math.max(3, Math.round(ph / (150 * k))));
  cx.font = "700 " + f(20); cx.textBaseline = "middle";
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step){
    const y = Math.round(Y(v)) + .5;
    cx.strokeStyle = "rgba(255,255,255,.06)"; cx.lineWidth = 1; cx.beginPath(); cx.moveTo(Lm, y); cx.lineTo(Lm + pw, y); cx.stroke();
    if (W >= 560){ cx.fillStyle = "rgba(200,210,235,.55)"; cx.fillText(v.toFixed(4), Lm + pw + 16*k, y); }
  }
  cx.textBaseline = "alphabetic"; cx.textAlign = "center";
  const xStep = pw < 600 * k ? 36e5 : 18e5;
  for (let t = Math.ceil(t0 / xStep) * xStep; t <= t1; t += xStep){
    const x = X(t); cx.strokeStyle = "rgba(255,255,255,.04)"; cx.beginPath(); cx.moveTo(x, T); cx.lineTo(x, T + ph); cx.stroke();
    cx.fillStyle = "rgba(200,210,235,.5)"; cx.fillText(timeFmt.format(t), x, H - 10*k);
  }
  cx.textAlign = "left";
  const dayLine = (v, rgb, txt) => {
    if (v == null) return;
    let y = Y(v), off = "";
    if (y < T - 10*k){ y = T - 10*k; off = " ▲"; } else if (y > T + ph + 10*k){ y = T + ph + 10*k; off = " ▼"; }
    if (!off){ cx.setLineDash([14*k, 10*k]); cx.strokeStyle = `rgba(${rgb},.75)`; cx.lineWidth = 2.5*k;
      cx.beginPath(); cx.moveTo(Lm, y); cx.lineTo(Lm + pw, y); cx.stroke(); cx.setLineDash([]); }
  };
  dayLine(dHi, "25,240,143", "24H HIGH"); dayLine(dLo, "255,90,106", "24H LOW");
  // MA20 (gold) and MA50 (violet). Extra history lets both lines span the 4h window.
  const full = S.candles, off = full.length - data.length;
  const maSeries = n => {
    const out = new Array(data.length).fill(null);
    if (full.length < n) return out;
    let sum = 0;
    for (let i = 0; i < full.length; i++){
      sum += full[i].c;
      if (i >= n) sum -= full[i - n].c;
      const vi = i - off;
      if (vi >= 0 && i >= n - 1) out[vi] = sum / n;
    }
    return out;
  };
  const ma20 = maSeries(20), ma50 = maSeries(50);
  const maPath = arr => {
    const pts = [];
    arr.forEach((v, i) => { if (v != null && isFinite(v)) pts.push([X(data[i].t), Y(v)]); });
    if (pts.length < 2) return null;
    const path = new Path2D();
    path.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) path.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2);
    path.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
    return path;
  };
  const strokeMa = (arr, col, dash) => {
    const path = maPath(arr); if (!path) return;
    cx.save();
    cx.beginPath(); cx.rect(Lm, T - 2, pw, ph + 4); cx.clip();
    cx.lineJoin = "round"; cx.lineCap = "round"; cx.setLineDash(dash || []);
    cx.strokeStyle = "rgba(0,0,0,.55)"; cx.lineWidth = Math.max(2, 4 * k); cx.stroke(path);
    cx.strokeStyle = col; cx.lineWidth = Math.max(1.5, 2.4 * k); cx.stroke(path);
    cx.restore();
  };
  strokeMa(ma50, "#c48bff", [10 * k, 7 * k]);
  strokeMa(ma20, "#ffb627");
  const lastOf = a => { for (let i = a.length - 1; i >= 0; i--) if (a[i] != null && isFinite(a[i])) return a[i]; return null; };
  {
    const fs = Math.round(Math.max(11, Math.min(22, 18 * k)));
    cx.save(); cx.font = "800 " + fs + "px " + FONT; cx.textBaseline = "middle"; cx.textAlign = "left";
    const items = [["MA20", "#ffb627", lastOf(ma20), []], ["MA50", "#c48bff", lastOf(ma50), [5, 4]]]
      .map(([l, c, v, d]) => [l, c, v == null ? "--" : "$" + v.toFixed(4), d]);
    const sw = fs * 1.35, g1 = 6, g2 = 6, sep = 12, padX = 10, boxH = fs + 14;
    const ws = items.map(([l,,v]) => sw + g1 + cx.measureText(l).width + g2 + cx.measureText(v).width);
    const tot = padX * 2 + ws[0] + sep + ws[1];
    const lx = Lm + 6, ly = T + boxH * 0.62;
    cx.fillStyle = "rgba(5,8,16,.84)"; cx.strokeStyle = "rgba(255,255,255,.18)"; cx.lineWidth = 1;
    cx.beginPath();
    if (cx.roundRect) cx.roundRect(lx, ly - boxH / 2, tot, boxH, boxH / 2); else cx.rect(lx, ly - boxH / 2, tot, boxH);
    cx.fill(); cx.stroke();
    let x = lx + padX;
    items.forEach(([l, c, v, d], i) => {
      cx.setLineDash(d); cx.strokeStyle = c; cx.lineWidth = 3;
      cx.beginPath(); cx.moveTo(x, ly); cx.lineTo(x + sw - 4, ly); cx.stroke(); cx.setLineDash([]);
      let tx = x + sw + g1; cx.fillStyle = c; cx.fillText(l, tx, ly);
      tx += cx.measureText(l).width + g2; cx.fillStyle = "#fff"; cx.fillText(v, tx, ly);
      x += ws[i] + sep;
    });
    window.__maLegBox = {x: lx, y: ly - boxH / 2, w: tot, h: boxH};
    cx.restore();
  }
  const upTrend = S.pct != null && isFinite(S.pct) ? S.pct >= 0 : dispPrice >= data[0].o, col = upTrend ? "22,224,138" : "255,77,94";
  if (CANDLES){
    const bw = Math.max(1, pw / WINDOW_MIN * 0.7);
    for (let i = 0; i < data.length; i++){
      const c = data[i], cl = i === data.length - 1 ? dispPrice : c.c;
      const x = X(c.t), g = cl >= c.o; cx.strokeStyle = cx.fillStyle = g ? "#16e08a" : "#ff4d5e"; cx.lineWidth = Math.max(1, k);
      cx.beginPath(); cx.moveTo(x, Y(Math.max(c.h, cl))); cx.lineTo(x, Y(Math.min(c.l, cl))); cx.stroke();
      const y1 = Y(Math.max(c.o, cl)), y2 = Y(Math.min(c.o, cl)); cx.fillRect(x - bw/2, y1, bw, Math.max(1, y2 - y1));
    }
  } else {
    const pts = data.map((c, i) => [X(c.t), Y(i === data.length - 1 ? dispPrice : c.c)]);
    const path = new Path2D(); path.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++){
      const mx = (pts[i][0] + pts[i+1][0]) / 2, my = (pts[i][1] + pts[i+1][1]) / 2;
      path.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
    }
    const lp = pts[pts.length-1]; path.lineTo(lp[0], lp[1]);
    const fill = new Path2D(path); fill.lineTo(lp[0], T + ph); fill.lineTo(pts[0][0], T + ph); fill.closePath();
    const gr = cx.createLinearGradient(0, T, 0, T + ph);
    gr.addColorStop(0, `rgba(${col},.38)`); gr.addColorStop(.6, `rgba(${col},.08)`); gr.addColorStop(1, `rgba(${col},0)`);
    cx.fillStyle = gr; cx.fill(fill);
    cx.lineJoin = "round"; cx.lineWidth = 5 * k; cx.strokeStyle = `rgb(${col})`;
    cx.shadowColor = `rgba(${col},.7)`; cx.shadowBlur = 14 * k; cx.stroke(path); cx.shadowBlur = 0;
  }
  const yp = Y(dispPrice), xp = X(last.t);
  cx.setLineDash([8*k, 8*k]); cx.strokeStyle = `rgba(${col},.75)`; cx.lineWidth = 2*k;
  cx.beginPath(); cx.moveTo(Lm, yp); cx.lineTo(Lm + pw, yp); cx.stroke(); cx.setLineDash([]);
  const pulse = (now % 1600) / 1600;
  cx.fillStyle = `rgba(${col},${.5 * (1 - pulse)})`; cx.beginPath(); cx.arc(xp, yp, (8 + pulse * 22)*k, 0, 6.283); cx.fill();
  cx.fillStyle = "#fff"; cx.beginPath(); cx.arc(xp, yp, 8*k, 0, 6.283); cx.fill();
  cx.fillStyle = `rgb(${col})`; cx.beginPath(); cx.arc(xp, yp, 5*k, 0, 6.283); cx.fill();
  if (W < 560){ cx.textBaseline = "alphabetic"; }
  else {
  const label = dispPrice.toFixed(4);
  let tagFs = Math.round(Math.max(11, (W < 720 ? 15 : 26) * k));
  cx.font = "900 " + tagFs + "px " + FONT;
  let tw = cx.measureText(label).width;
  const gutter = Math.max(36, W - (Lm + pw) - 8);
  if (tw + 18 > gutter){
    tagFs = Math.max(10, Math.floor(tagFs * gutter / (tw + 18)));
    cx.font = "900 " + tagFs + "px " + FONT;
    tw = cx.measureText(label).width;
  }
  const th = Math.max(16, tagFs * 1.65);
  const tx = Lm + pw + 2, ty = Math.min(Math.max(yp - th / 2, T), Math.max(T, T + ph - th));
  const tip = Math.min(12, tagFs * 0.45);
  cx.fillStyle = `rgb(${col})`; cx.beginPath();
  cx.moveTo(tx, yp); cx.lineTo(tx + tip, ty); cx.lineTo(Math.min(W - 2, tx + tip + tw + tagFs * 0.7), ty);
  cx.lineTo(Math.min(W - 2, tx + tip + tw + tagFs * 0.7), ty + th); cx.lineTo(tx + tip, ty + th); cx.closePath(); cx.fill();
  cx.fillStyle = upTrend ? "#02240f" : "#fff"; cx.textBaseline = "middle";
  cx.fillText(label, tx + tip + 4, ty + th / 2 + 1); cx.textBaseline = "alphabetic";
  }
}

/* ---------------- sound (all synthesized with Web Audio, no audio files) ---------------- */
const SYNTH = (() => {
  const noiseCache = new WeakMap();
  function noise(ac){                                  // 2 s of white noise, cached per context
    let b = noiseCache.get(ac); if (b) return b;
    b = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseCache.set(ac, b); return b;
  }
  function noiseSrc(ac, t, dur){ const s = ac.createBufferSource(); s.buffer = noise(ac); s.loop = true;
    s.start(t, Math.random() * 1.5); s.stop(t + dur + .05); return s; }
  function g(ac, v, dest){ const n = ac.createGain(); n.gain.value = v; if (dest) n.connect(dest); return n; }
  function osc(ac, type, f, t, dur, dest){ const o = ac.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t);
    o.connect(dest); o.start(t); o.stop(t + dur + .05); return o; }
  function env(param, t, a, peak, dur){                  // quick attack, exponential decay
    param.setValueAtTime(0.0001, t); param.exponentialRampToValueAtTime(peak, t + a);
    param.exponentialRampToValueAtTime(0.0001, t + dur); }

  // 1) ticks: soft bell-ish ping (up) / lower pong (down)
  function blip(ac, out, t, f, dur, glide){
    const v = g(ac, 0, out); env(v.gain, t, .005, .16, dur);
    const o1 = osc(ac, "sine", f, t, dur, v);
    if (glide) o1.frequency.exponentialRampToValueAtTime(f * glide, t + dur);
    const v2 = g(ac, 0, out); env(v2.gain, t, .004, .025, dur * .6);
    osc(ac, "triangle", f * 2, t, dur, v2);
    return dur;
  }
  const ping = (ac, out, t) => blip(ac, out, t, 1567.98, .11, 1.0);     // G6
  const pong = (ac, out, t) => blip(ac, out, t, 783.99, .12, .94);      // G5 with a small droop

  // 2) whoosh (filtered noise sweep) for pump / dip / milestone banners
  function whoosh(ac, out, t, up, lvl = .16){
    const bp = ac.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 1.8;
    bp.frequency.setValueAtTime(up ? 350 : 3200, t); bp.frequency.exponentialRampToValueAtTime(up ? 3600 : 300, t + .75);
    const v = g(ac, 0, out); v.gain.setValueAtTime(0.0001, t); v.gain.exponentialRampToValueAtTime(lvl, t + .45);
    v.gain.exponentialRampToValueAtTime(0.0001, t + .9);
    noiseSrc(ac, t, .9).connect(bp); bp.connect(v);
    const tv = g(ac, 0, out); tv.gain.setValueAtTime(0.0001, t); tv.gain.exponentialRampToValueAtTime(lvl * .25, t + .4);
    tv.gain.exponentialRampToValueAtTime(0.0001, t + .85);
    const o = osc(ac, "sine", up ? 220 : 880, t, .85, tv); o.frequency.exponentialRampToValueAtTime(up ? 880 : 220, t + .8);
    return 1;
  }
  const pump = (ac, out, t) => whoosh(ac, out, t, true);
  const dip = (ac, out, t) => whoosh(ac, out, t, false);
  function mile(ac, out, t){
    whoosh(ac, out, t, true, .12);
    [[1567.98, .55], [2093, .7]].forEach(([f, d]) => { const v = g(ac, 0, out); env(v.gain, t + d, .005, .07, t + d + .6 - t - d);
      osc(ac, "sine", f, t + d, .6, v); });
    return 1.4;
  }

  // 3) NEW DAY HIGH: brassy arpeggio fanfare + synthesized crowd cheer
  function brass(ac, dest, f, t, dur, lvl, vib){
    const v = g(ac, 0, dest);
    v.gain.setValueAtTime(0.0001, t); v.gain.exponentialRampToValueAtTime(.2 * lvl, t + .025);
    v.gain.setValueAtTime(.2 * lvl, t + dur * .7); v.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.Q.value = 2;
    lp.frequency.setValueAtTime(f * 1.5, t); lp.frequency.exponentialRampToValueAtTime(f * 6, t + .05);
    lp.frequency.exponentialRampToValueAtTime(f * 3, t + Math.min(dur, .4)); lp.connect(v);
    for (const c of [-7, 7]){
      const o = osc(ac, "sawtooth", f, t, dur, lp); o.detune.value = c;
      if (vib){ const l = ac.createOscillator(), ld = g(ac, 0); l.frequency.value = 5.5;
        ld.gain.setValueAtTime(0, t); ld.gain.linearRampToValueAtTime(f * .008, t + dur * .6);
        l.connect(ld); ld.connect(o.frequency); l.start(t); l.stop(t + dur + .05); }
    }
  }
  function cheer(ac, out, t, dur){
    const bus = g(ac, 0, out);
    bus.gain.setValueAtTime(0.0001, t); bus.gain.exponentialRampToValueAtTime(.32, t + .35);
    bus.gain.setValueAtTime(.32, t + dur * .55); bus.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    // crowd "yeah": noise through moving vowel-like formants with random amplitude flutter
    [[550, 3.3], [1100, 4.7], [1900, 6.1], [2900, 7.9]].forEach(([f, r], i) => {
      const bp = ac.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 3; bp.frequency.setValueAtTime(f * .8, t);
      bp.frequency.linearRampToValueAtTime(f * 1.15, t + dur * .5); bp.frequency.linearRampToValueAtTime(f, t + dur);
      const amp = g(ac, .5, bus), lfo = ac.createOscillator(), ld = g(ac, .35);
      lfo.frequency.value = r + Math.random() * 2; lfo.connect(ld); ld.connect(amp.gain); lfo.start(t); lfo.stop(t + dur + .05);
      noiseSrc(ac, t, dur).connect(bp); bp.connect(amp);
    });
    // scattered hand claps
    for (let i = 0; i < 26; i++){
      const ct = t + .15 + Math.random() * dur * .8, hp = ac.createBiquadFilter(); hp.type = "bandpass"; hp.frequency.value = 1200 + Math.random() * 900; hp.Q.value = 1.2;
      const v = g(ac, 0, out); env(v.gain, ct, .002, .12 + Math.random() * .12, ct + .07 - ct);
      noiseSrc(ac, ct, .08).connect(hp); hp.connect(v);
    }
    // a whistle from the crowd
    const wv = g(ac, 0, out); wv.gain.setValueAtTime(0.0001, t + .5); wv.gain.exponentialRampToValueAtTime(.035, t + .6);
    wv.gain.exponentialRampToValueAtTime(0.0001, t + 1.15);
    const w = osc(ac, "sine", 1700, t + .5, .7, wv); w.frequency.exponentialRampToValueAtTime(2700, t + .85); w.frequency.exponentialRampToValueAtTime(2300, t + 1.15);
  }
  function high(ac, out, t){
    const bus = g(ac, .9, out);
    const N = [523.25, 659.25, 783.99, 1046.5];                   // C5 E5 G5 C6
    N.forEach((f, i) => brass(ac, bus, f, t + i * .11, i === 3 ? 1.25 : .2, 1, i === 3));
    [261.63, 392, 523.25, 659.25].forEach(f => brass(ac, bus, f, t + .33, 1.25, .55, true));   // C major chord under the top note
    [2093, 2637, 3136, 4186].forEach((f, i) => { const v = g(ac, 0, out), tt = t + .45 + i * .09;   // sparkle
      env(v.gain, tt, .004, .05, tt + .35 - tt); osc(ac, "triangle", f, tt, .35, v); });
    cheer(ac, out, t + .2, 2.6);
    return 2.9;
  }

  // 4) NEW DAY LOW: sad trombone "wah wah wah waaah" (detuned saws, plunger-mute filter, vibrato on the last note)
  function low(ac, out, t){
    const bus = g(ac, .8, out);
    const N = [[293.66, 0, .44], [277.18, .5, .44], [261.63, 1.0, .44], [246.94, 1.5, 1.2]];   // D4 C#4 C4 B3
    N.forEach(([f, st, dur], i) => {
      const t0 = t + st, last = i === 3;
      const v = g(ac, 0, bus);
      v.gain.setValueAtTime(0.0001, t0); v.gain.exponentialRampToValueAtTime(.26, t0 + .05);
      v.gain.setValueAtTime(.26, t0 + dur * .75); v.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      const wah = ac.createBiquadFilter(); wah.type = "lowpass"; wah.Q.value = 6;
      wah.frequency.setValueAtTime(320, t0); wah.frequency.exponentialRampToValueAtTime(1500, t0 + .14);
      wah.frequency.exponentialRampToValueAtTime(last ? 700 : 550, t0 + dur); wah.connect(v);
      for (const c of [-12, 0, 11]){
        const o = osc(ac, "sawtooth", f * .97, t0, dur, wah); o.detune.value = c;
        o.frequency.exponentialRampToValueAtTime(f, t0 + .07);                       // slide in
        if (last){
          o.frequency.setValueAtTime(f, t0 + .5); o.frequency.exponentialRampToValueAtTime(f * .93, t0 + dur);   // droop at the end
          const l = ac.createOscillator(), ld = g(ac, 0); l.frequency.value = 6;
          ld.gain.setValueAtTime(0, t0 + .1); ld.gain.linearRampToValueAtTime(f * .035, t0 + dur * .8);
          l.connect(ld); ld.connect(o.frequency); l.start(t0); l.stop(t0 + dur + .05);
        }
      }
    });
    return 2.8;
  }
  return {ping, pong, pump, dip, mile, high, low};
})();
function sfxChain(ac, vol){                       // master volume -> gentle limiter -> speakers
  const m = ac.createGain(); m.gain.value = vol;
  const lim = ac.createDynamicsCompressor();
  lim.threshold.value = -6; lim.knee.value = 0; lim.ratio.value = 12; lim.attack.value = .003; lim.release.value = .25;
  m.connect(lim); lim.connect(ac.destination); return m;
}

/* sound settings: OFF by default (browser autoplay rules); the choice is remembered on this device */
const store = {
  get(k, d){ try { const v = localStorage.getItem("tenbobxrp." + k); return v == null ? d : v; } catch(e){ return d; } },
  set(k, v){ try { localStorage.setItem("tenbobxrp." + k, String(v)); } catch(e){} }
};
let soundOn = store.get("sound", "0") === "1";
let volume = (() => { const v = parseFloat(store.get("vol", "0.5")); return isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5; })();
let ticksOn = store.get("ticks", "1") !== "0";
let AC = null, SFX_OUT = null;
function ensureAC(){
  if (AC) return AC;
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    SFX_OUT = sfxChain(AC, volume);
    AC.onstatechange = updateSoundUI;
  } catch(e){ AC = null; }
  return AC;
}
const audioRunning = () => !!AC && AC.state === "running";
function startAudio(){                                  // must be called from a tap/click/key
  if (!ensureAC()) return Promise.resolve(false);
  const p = AC.state === "running" ? Promise.resolve() : AC.resume();
  return p.then(() => { updateSoundUI(); return audioRunning(); }, () => false);
}
function setSound(on){
  soundOn = on; store.set("sound", on ? "1" : "0");
  if (on) startAudio().then(ok => { if (ok) playSfx("ping"); });
  else if (audioRunning()) AC.suspend().catch(() => {});
  updateSoundUI();
}
function updateSoundUI(){
  const b = $("sndBtn"), live = soundOn && audioRunning();
  b.classList.toggle("on", live);
  b.setAttribute("aria-pressed", String(live));
  b.textContent = live ? "Sound ON" : "Tap for sound";
  b.title = live ? "Tap to mute (M)" : "Tap to turn sound on (M)";
  $("ticksBtn").textContent = "Ticks: " + (ticksOn ? "ON" : "OFF");
  $("ticksBtn").setAttribute("aria-pressed", String(ticksOn));
}
function playSfx(name){
  if (!soundOn || !audioRunning() || !SYNTH[name]) return;
  try { SYNTH[name](AC, SFX_OUT, AC.currentTime + .02); } catch(e){}
}
/* price-tick ping/pong: at most once per TICK_GAP_MS, direction = net move since the last tick sound */
const TK = {ref: null, last: 0, timer: null};
function tickSound(p){
  if (DEMO === "ticks") return;
  if (TK.ref == null){ TK.ref = p; return; }
  const wait = TK.last + TICK_GAP_MS - performance.now();
  if (wait <= 0) flushTick(); else if (!TK.timer) TK.timer = setTimeout(flushTick, wait);
}
function flushTick(){
  TK.timer = null; const p = S.price;
  if (p == null || p === TK.ref) return;
  if (ticksOn) playSfx(p > TK.ref ? "ping" : "pong");
  TK.ref = p; TK.last = performance.now();
}

/* ---------------- controls: sound / volume / ticks / fullscreen, auto-hide when idle ---------------- */
$("volume").value = volume;
$("sndBtn").addEventListener("click", () => {
  if (soundOn && !audioRunning()) startAudio().then(ok => { if (ok) playSfx("ping"); });   // remembered "on" but browser had it blocked
  else setSound(!soundOn);
});
$("volume").addEventListener("input", e => {
  volume = +e.target.value; store.set("vol", volume);
  if (SFX_OUT) SFX_OUT.gain.setTargetAtTime(volume, AC.currentTime, .02);
});
$("volume").addEventListener("change", () => { if (soundOn) startAudio().then(ok => { if (ok) playSfx("ping"); }); });
$("ticksBtn").addEventListener("click", () => { ticksOn = !ticksOn; store.set("ticks", ticksOn ? "1" : "0"); updateSoundUI(); });
// any tap/key starts audio if the visitor already chose "sound on" on an earlier visit
const gestureStart = e => { if (soundOn && !audioRunning() && !(e.target && e.target.closest && e.target.closest("#sndBtn"))) startAudio(); };
addEventListener("pointerdown", gestureStart, true); addEventListener("keydown", gestureStart, true);

const docEl = document.documentElement;
const fsEnabled = document.fullscreenEnabled || document.webkitFullscreenEnabled;
const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
if (!fsEnabled) document.body.classList.add("nofs");
function toggleFs(){
  if (fsEl()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  else { const r = (docEl.requestFullscreen || docEl.webkitRequestFullscreen).call(docEl); if (r && r.catch) r.catch(() => {}); }
}
const fsLabel = () => { $("fsBtn").textContent = fsEl() ? "⛶ Exit full screen" : "⛶ Full screen"; };
$("fsBtn").addEventListener("click", toggleFs);
document.addEventListener("fullscreenchange", fsLabel); document.addEventListener("webkitfullscreenchange", fsLabel);
addEventListener("keydown", e => {
  if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName) && e.key !== "f" && e.key !== "m") return;
  if (e.key === "f" || e.key === "F"){ if (fsEnabled) toggleFs(); }
  else if (e.key === "m" || e.key === "M") $("sndBtn").click();
});

// keep the screen awake while the page is visible (TVs / tablets), where supported
let wakeLock = null;
async function keepAwake(){
  try { if ("wakeLock" in navigator && !wakeLock && document.visibilityState === "visible"){
    wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release", () => { wakeLock = null; }); } } catch(e){}
}
document.addEventListener("visibilitychange", keepAwake);
addEventListener("pointerdown", keepAwake, {once: true});

// hide the controls (and mouse cursor) after a few seconds without movement; show again on move / tap / key
let idleT = null;
function wake(){
  document.body.classList.remove("idle");
  clearTimeout(idleT);
  idleT = setTimeout(() => document.body.classList.add("idle"), 4000);
}
["mousemove", "pointerdown", "touchstart", "keydown", "wheel"].forEach(ev => addEventListener(ev, wake, {passive: true, capture: true}));
$("controls").addEventListener("focusin", wake);
wake(); clearTimeout(idleT); idleT = setTimeout(() => document.body.classList.add("idle"), 7000);   // a bit longer on first load
updateSoundUI();

/* test / debugging helper */
window.__xrpSfx = {play: playSfx, ctx: () => AC, on: () => soundOn};

/* ---------------- main loop (~30fps, rAF) ---------------- */
let lastFrame = 0;
function loop(now){
  requestAnimationFrame(loop);
  if (now - lastFrame < 33) return; lastFrame = now;
  drawChart(now); drawFx(); if (now - volAt > 500){ volAt = now; drawVol(); }
}

/* ---------------- rotating ticker lines ---------------- */
let tIdx = 0, tEl = null;
function rotateTicker(){
  const box = $("tickerText"), s = document.createElement("div"), t = document.createElement("span"), line = TICKER_LINES[tIdx++ % TICKER_LINES.length];
  s.className = "tline"; s.appendChild(t);
  if (line.h) t.innerHTML = line.h; else t.textContent = line.t;
  s.style.transform = "translateY(100%)"; s.style.opacity = "0"; box.appendChild(s);
  requestAnimationFrame(() => requestAnimationFrame(() => { s.style.transform = "translateY(0)"; s.style.opacity = "1"; }));
  if (tEl){ const old = tEl; old.style.transform = "translateY(-100%)"; old.style.opacity = "0"; setTimeout(() => old.remove(), 700); }
  tEl = s;
}
rotateTicker(); setInterval(rotateTicker, 6000);

/* ---------------- networking ---------------- */
async function getJSON(url, ms = 8000){
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms);
  try { const r = await fetch(url, {signal: ac.signal, cache: "no-store"}); if (!r.ok) throw new Error(r.status); return await r.json(); }
  finally { clearTimeout(t); }
}
async function restAny(path){
  for (const h of REST_HOSTS){ try { return {host: h, data: await getJSON(h + path)}; } catch(e){} }
  throw new Error("all binance REST hosts failed");
}
function applyTicker24(d){
  S.pct = +d.priceChangePercent; S.hi = +d.highPrice; S.lo = +d.lowPrice; S.vol = +d.volume; S.qvol = +d.quoteVolume;
  onPrice(+d.lastPrice);
}
async function seedBinance(){
  const {data} = await restAny("/api/v3/klines?symbol=XRPUSDT&interval=1m&limit=" + (WINDOW_MIN + MA_EXTRA));
  setCandles(data.map(k => ({t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5]})));
  try { applyTicker24((await restAny("/api/v3/ticker/24hr?symbol=XRPUSDT")).data); } catch(e){}
  return true;
}
async function seedCoinGecko(){
  const d = await getJSON(CG + "/coins/ripple/market_chart?vs_currency=usd&days=1");
  const pr = d.prices || [], cut = Date.now() - (WINDOW_MIN + MA_EXTRA) * 60e3;
  const arr = pr.filter(p => p[0] >= cut).map(p => { const t = Math.floor(p[0]/60e3)*60e3; return {t, o: p[1], h: p[1], l: p[1], c: p[1]}; });
  if (arr.length) setCandles(arr);
  if (pr.length){ S.hi = Math.max(...pr.map(p => p[1])); S.lo = Math.min(...pr.map(p => p[1])); }
}
async function pollCoinGecko(usePrice){
  try {
    const d = (await getJSON(CG + "/simple/price?ids=ripple&vs_currencies=usd,eur&include_24hr_change=true&include_24hr_vol=true")).ripple;
    if (d.usd && d.eur) S.eurRate = d.eur / d.usd;
    if (usePrice){ S.pct = d.usd_24h_change; if (d.usd_24h_vol){ S.qvol = d.usd_24h_vol; S.vol = d.usd_24h_vol / d.usd; } onPrice(d.usd); }
    else renderPrice();
    return true;
  } catch(e){ return false; }
}

/* websockets with auto-reconnect and host failover (443 -> 9443 -> binance.vision mirror) */
let wsHostIdx = 0, wsFails = 0, sockets = [], restTimer = null, cgTimer = null, wsGen = 0;
function openWS(){
  sockets.forEach(s => { try { s.onclose = null; s.close(); } catch(e){} }); sockets = [];
  const gen = ++wsGen, host = WS_HOSTS[wsHostIdx % WS_HOSTS.length];
  let gotMsg = false;
  const mk = (stream, onMsg) => {
    const ws = new WebSocket(host + "/ws/" + stream);
    ws.onmessage = ev => { gotMsg = true; wsFails = 0; S.mode = "ws"; stopPolling();
      setSource(host.includes("vision") ? "Binance public feed (mirror)" : "Binance public feed");
      try { onMsg(JSON.parse(ev.data)); } catch(e){} };
    ws.onerror = () => {};
    ws.onclose = () => { if (sockets.includes(ws)) scheduleReconnect(gotMsg); };
    sockets.push(ws);
  };
  mk("xrpusdt@ticker", d => { S.pct = +d.P; S.hi = +d.h; S.lo = +d.l; S.vol = +d.v; S.qvol = +d.q; onPrice(+d.c, d.E || Date.now()); });
  mk("xrpusdt@kline_1m", d => { const k = d.k; if (!k) return;
    const c = {t: k.t, o: +k.o, h: +k.h, l: +k.l, c: +k.c, v: +k.v}, last = S.candles[S.candles.length-1];
    if (last && last.t === c.t) Object.assign(last, c); else if (!last || c.t > last.t){ S.candles.push(c); trimCandles(); }
    chartDirty = true; });
  setTimeout(() => { if (!gotMsg && gen === wsGen) scheduleReconnect(false); }, 7000);   // nothing within 7 s -> next host
}
let reconnectT = null;
function scheduleReconnect(hadData){
  if (reconnectT) return;
  sockets.forEach(s => { try { s.onclose = null; s.close(); } catch(e){} }); sockets = [];
  if (!hadData){ wsFails++; wsHostIdx++; }
  if (wsFails >= WS_HOSTS.length) startPolling();          // websockets look blocked -> REST / CoinGecko polling meanwhile
  const delay = hadData ? 2000 : Math.min(60000, 1000 * Math.pow(2, Math.min(Math.max(0, wsFails - 1), 6)));
  setSource((S.source || "Binance public feed").replace(/ · reconnecting\.\.\.$/, "") + " · reconnecting...", "warn");
  reconnectT = setTimeout(() => { reconnectT = null; openWS(); }, delay);
}
async function restPollOnce(){
  try { const {data} = await restAny("/api/v3/ticker/24hr?symbol=XRPUSDT"); applyTicker24(data);
        setSource("Binance public feed · REST", "warn"); return true; }
  catch(e){ return false; }
}
function startPolling(){
  if (restTimer || cgTimer) return;
  S.mode = "poll";
  const tick = async () => {
    if (await restPollOnce()) return;
    if (!cgTimer){                                           // Binance fully blocked -> CoinGecko every 30 s
      clearInterval(restTimer); restTimer = null;
      const cg = async () => { if (await pollCoinGecko(true)) setSource("CoinGecko", "warn"); else setSource("offline · retrying…", "bad"); };
      cg(); cgTimer = setInterval(cg, 30000);
      if (S.candles.length < 2) seedCoinGecko().catch(() => {});
    }
  };
  tick(); restTimer = setInterval(tick, 5000);
}
function stopPolling(){ clearInterval(restTimer); clearInterval(cgTimer); restTimer = cgTimer = null; }

/* watchdog: stale data -> reconnect; periodic reseed to heal gaps (e.g. after the tab slept) */
setInterval(() => { if (S.mode === "ws" && Date.now() - S.lastTickAt > 45000) scheduleReconnect(true); }, 10000);
setInterval(() => { if (S.mode !== "poll" || restTimer) seedBinance().catch(() => {}); }, 30 * 60e3);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && Date.now() - S.lastTickAt > 60000) seedBinance().catch(() => {});
});

/* ---------------- boot ---------------- */
layout();
if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout);
requestAnimationFrame(loop);
(async () => {
  setSource("connecting...", "warn");
  try { await seedBinance(); setSource("Binance public feed", "warn"); }
  catch(e){ try { await seedCoinGecko(); } catch(e2){} }
  openWS();
  const eur = async () => { if (cgTimer) return;
    try { const {data} = await restAny("/api/v3/ticker/price?symbol=EURUSDT"); S.eurRate = 1 / +data.price; renderPrice(); }
    catch(e){ pollCoinGecko(false); } };
  if (SHOW_EUR){ eur(); setInterval(eur, 5 * 60e3); }
})();


/* ---------------- Buddha frog ---------------- */
(function(){
  const M = $("mascot");
  if (!M) return;
  if (Q.get("mascot") === "0"){ M.classList.add("off"); return; }
  const BUB = M.querySelector(".bub");
  const TEST = Q.get("mascottest");
  const TXT = {pump: ["XRP UP", "NICE MOVE", "LETS GO"], dip: ["HODL", "STAY CALM", "BREATHE"],
               mile: ["NEW LEVEL", "STEADY"], calm: ["NAMASTE", "BE WATER"]};
  const MOODS = {up: "XRP UP", big: "BIG MOVE", down: "HODL", flat: "CHILL"};
  let mood = null, moodSaidAt = 0, state = "calm", until = 0, sayT = 0, lockUntil = 0;
  const MOOD_FORCE = MOODS[Q.get("mood")] ? Q.get("mood") : null;
  const pick = a => a[Math.floor(Math.random() * a.length)];
  function say(t, ms){ BUB.textContent = t; M.classList.add("say"); clearTimeout(sayT); sayT = setTimeout(() => M.classList.remove("say"), ms); }
  function setMood(m){
    if (m === mood) return;
    M.classList.remove("m-up", "m-big", "m-down", "m-flat");
    mood = m; M.classList.add("m-" + m);
    if (state === "calm" && Date.now() > lockUntil){ say(MOODS[m], MOOD_FORCE ? 1e9 : 7000); moodSaidAt = Date.now(); }
  }
  function moodFrom(ch15){
    const pct = S.pct;
    let m = pct == null || !isFinite(pct) ? "flat" : pct >= 3 ? "big" : pct >= 0.5 ? "up" : pct <= -0.5 ? "down" : "flat";
    if (ch15 != null){ if (ch15 >= 0.6 && (m === "flat" || m === "down")) m = "up"; else if (ch15 <= -0.6 && m !== "down") m = "down"; }
    return m;
  }
  function jump(){ M.classList.remove("jump"); void M.offsetWidth; M.classList.add("jump"); clearTimeout(jump.t); jump.t = setTimeout(() => M.classList.remove("jump"), 2200); }
  function setFrog(s, ms){
    if (TEST && s !== TEST) return;
    state = s; until = Date.now() + (ms || 0);
    M.classList.remove("pump", "dip", "mile");
    if (s !== "calm"){ void M.offsetWidth; M.classList.add(s); }
    if (s !== "calm" && Date.now() > lockUntil) say(pick(TXT[s]), Math.min(ms || 8000, 8000));
    else if (MOOD_FORCE && mood) say(MOODS[mood], 1e9);
  }
  window.__mascot = {set: setFrog, setMood, jump};
  if (MOOD_FORCE) setMood(MOOD_FORCE); else setMood("flat");
  if (TEST){ const s = ["pump", "dip", "mile", "calm"].includes(TEST) ? TEST : "calm"; setFrog(s, 1e12); say(pick(TXT[s] || TXT.calm), 1e9); return; }
  const orig = showBanner;
  showBanner = function(kind, text, sub){
    if (kind === "pump" || kind === "high"){ setFrog("pump", 45000); jump(); }
    else if (kind === "dip" || kind === "low") setFrog("dip", 45000);
    else if (kind === "mile" && state === "calm") setFrog("mile", 3500);
    return orig(kind, text, sub);
  };
  const buf = [];
  setInterval(() => {
    const price = S.price, now = Date.now(); if (!(price > 0)) return;
    buf.push({t: now, p: price}); while (buf.length && now - buf[0].t > MOVE_WIN_MS) buf.shift();
    const ch = (price / buf[0].p - 1) * 100;
    if (!MOOD_FORCE){
      setMood(moodFrom(buf.length > 1 && now - buf[0].t > 60e3 ? ch : null));
      if (state === "calm" && now > lockUntil && now - moodSaidAt > 120e3){ moodSaidAt = now; say(MOODS[mood], 6000); }
    }
    if (now > until){
      if (ch >= MOVE_PCT && state !== "pump") setFrog("pump", 30000);
      else if (ch <= -MOVE_PCT && state !== "dip") setFrog("dip", 30000);
      else if (state !== "calm" && Math.abs(ch) < MOVE_PCT) setFrog("calm");
      else if (state !== "calm") until = now + 10000;
    }
  }, 5000);
})();

/* ---------------- coin strip: majors on Binance, XRPL meme market caps ---------------- */
(function(){
  if (Q.get("coins") === "0"){ const el = $("coins"); if (el) el.style.display = "none"; return; }
  const SHOW_MEMES = Q.get("memes") !== "0";
  const el = $("coins");
  if (!el) return;
  const MAJORS = [["BTC","BTCUSDT"],["ETH","ETHUSDT"],["SOL","SOLUSDT"],["ONDO","ONDOUSDT"],["BNB","BNBUSDT"],["HBAR","HBARUSDT"],["FET","FETUSDT"],["WLFI","WLFIUSDT"]];
  const MEMES = [
    ["FUZZY","46555A5A59000000000000000000000000000000","rhCAT4hRdi2Y9puNdkpMzxrdKa5wkppR62"],
    ["BCHAMP","424348414D500000000000000000000000000000","rhYhn7s6z4HAfuJm7ehuSE7wxepRoUPwpi"],
    ["PHNIX","50484E4958000000000000000000000000000000","rDFXbW2ZZCG5WgPtqwNiA2xZokLMm9ivmN"],
    ["UGA","UGA","rBFJGmWj6YaabVCxfsjiCM8pfYXs8xFdeC"],
    ["SEAL","5345414C00000000000000000000000000000000","r4pXXQzJ8soYSX4QKeeW4BzRQS1PCtVYLJ"],
    ["CULT","43554C5400000000000000000000000000000000","rCULtAKrKbQjk1Tpmg5hkw4dpcf9S9KCs"],
    ["ARMY","41524D5900000000000000000000000000000000","rGG3wQ4kUzd7Jnmk1n5NWPZjjut62kCBfC"]
  ];
  const data = {};
  const tmo = (ms) => { const c = new AbortController(); setTimeout(() => c.abort(), ms); return c.signal; };
  function fmtPx(p){
    if (!(p > 0) || !isFinite(p)) return "--";
    if (p >= 10000) return "$" + (p / 1000).toFixed(1) + "K";
    if (p >= 1000) return "$" + Math.round(p).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    if (p >= 1) return "$" + p.toFixed(2);
    if (p >= 0.01) return "$" + p.toFixed(4);
    const digits = Math.min(8, Math.floor(-Math.log10(p)) + 2);
    return "$" + p.toFixed(digits);
  }
  function fmtMC(v){
    if (!(v > 0) || !isFinite(v)) return "--";
    const u = v >= 1e9 ? [1e9, "B"] : v >= 1e6 ? [1e6, "M"] : v >= 1e3 ? [1e3, "K"] : [1, ""];
    return "$" + (v / u[0]).toFixed(1) + u[1];
  }
  async function pollMajors(){
    const syms = MAJORS.map(m => m[1]);
    const apply = t => { const m = MAJORS.find(x => x[1] === t.symbol); if (m && +t.lastPrice > 0) data[m[0]] = {p:+t.lastPrice, c:+t.priceChangePercent}; };
    for (const h of REST_HOSTS){
      try {
        const r = await fetch(h + "/api/v3/ticker/24hr?symbols=" + encodeURIComponent(JSON.stringify(syms)), {signal: tmo(8000)});
        if (!r.ok) continue;
        (await r.json()).forEach(apply);
        if (Object.keys(data).length) return;
      } catch (e) {}
    }
    await Promise.all(syms.map(async sym => {
      for (const h of REST_HOSTS){
        try { apply(await getJSON(h + "/api/v3/ticker/24hr?symbol=" + sym, 8000)); return; } catch (e) {}
      }
    }));
  }
  const XRPL_RPC = ["https://xrplcluster.com", "https://s1.ripple.com:51234", "https://s2.ripple.com:51234"];
  async function ammPriceXrp(cur, iss){
    for (const u of XRPL_RPC){
      try {
        const r = await fetch(u, {method:"POST", headers:{"content-type":"application/json"}, signal: tmo(8000),
          body: JSON.stringify({method:"amm_info", params:[{asset:{currency:"XRP"}, asset2:{currency:cur, issuer:iss}}]})});
        const j = await r.json(); const a = j.result && j.result.amm;
        if (a && +a.amount2.value > 0) return (+a.amount / 1e6) / (+a.amount2.value);
      } catch (e) {}
    }
    return null;
  }
  const supC = {};
  async function supplyOf(cur, iss){
    const key = cur + "." + iss, cached = supC[key];
    if (cached && Date.now() - cached.t < 3600000) return cached.v;
    for (const u of XRPL_RPC){
      try {
        const r = await fetch(u, {method:"POST", headers:{"content-type":"application/json"}, signal: tmo(8000),
          body: JSON.stringify({method:"gateway_balances", params:[{account:iss, ledger_index:"validated"}]})});
        const j = await r.json(), o = j.result && j.result.obligations;
        if (o && o[cur] != null && isFinite(+o[cur])){ supC[key] = {t: Date.now(), v: +o[cur]}; return +o[cur]; }
      } catch (e) {}
    }
    return cached ? cached.v : null;
  }
  async function pollMemes(){
    const got = new Set();
    try {
      const ids = MEMES.map(m => m[1] + "." + m[2]).join(",");
      const r = await fetch("https://api.dexscreener.com/tokens/v1/xrpl/" + ids, {signal: tmo(10000)});
      if (r.ok){
        const best = {};
        (await r.json()).forEach(row => {
          const ad = row.baseToken && row.baseToken.address; if (!ad || !(+row.priceUsd > 0)) return;
          const liq = (row.liquidity && row.liquidity.usd) || 0;
          if (!best[ad] || liq > best[ad].liq){
            const mc = +row.marketCap > 0 ? +row.marketCap : (+row.fdv > 0 ? +row.fdv : null);
            const ch = row.priceChange && row.priceChange.h24 != null ? +row.priceChange.h24 : null;
            best[ad] = {liq, p:+row.priceUsd, mc, c: ch};
          }
        });
        MEMES.forEach(m => {
          const b = best[m[1] + "." + m[2]];
          if (!b) return;
          const prev = data[m[0]] || {};
          data[m[0]] = {p:b.p, c:b.c, mc: b.mc != null ? b.mc : (prev.mc != null ? prev.mc : null)};
          got.add(m[0]);
        });
      }
    } catch (e) {}
    const xu = S.price;
    if (!(xu > 0) && got.size < MEMES.length){ setTimeout(pollMemes, 8000); return; }
    for (const m of MEMES){
      if (got.has(m[0]) || !(xu > 0)) continue;
      const px = await ammPriceXrp(m[1], m[2]);
      if (!(px > 0)) continue;
      const prev = data[m[0]] || {};
      const sup = await supplyOf(m[1], m[2]);
      data[m[0]] = {p: px * xu, c: prev.c != null ? prev.c : null, mc: sup ? px * xu * sup : (prev.mc != null ? prev.mc : null)};
    }
  }
  const MEME_SET = new Set(MEMES.map(m => m[0]));
  const PAGES = [{tag:false, s:["BTC","ETH","BNB","SOL"]}, {tag:false, s:["HBAR","FET","ONDO","WLFI"]}];
  if (SHOW_MEMES) PAGES.push({tag:true, s:["FUZZY","BCHAMP","PHNIX","UGA"]}, {tag:true, s:["SEAL","CULT","ARMY"]});
  const cell = s => '<span class="ci' + (MEME_SET.has(s) ? " m" : "") + '" data-s="' + s + '"><b>' + s + '</b><span class="cp">--</span><span class="pc na">--</span></span>';
  el.innerHTML = PAGES.map((pg, i) => '<div class="cpage' + (i ? "" : " on") + '">' +
    (pg.tag ? '<span class="ctag">XRPL MCs</span>' : "") + pg.s.map(cell).join("") + "</div>").join("");
  const pages = [...el.querySelectorAll(".cpage")];
  let cur = 0;
  function fit(pg){
    pg.style.transform = "translateX(-50%)";
    const w = pg.scrollWidth, avail = el.clientWidth - 6;
    const k = w > 0 && avail > 0 ? Math.min(1, avail / w) : 1;
    pg.style.transform = "translateX(-50%) scale(" + k.toFixed(3) + ")";
  }
  function show(i){
    pages[cur].classList.remove("on");
    cur = ((i % pages.length) + pages.length) % pages.length;
    pages[cur].classList.add("on");
    fit(pages[cur]);
  }
  function renderCoins(){
    el.querySelectorAll(".ci").forEach(ci => {
      const d = data[ci.dataset.s] || {}, c = d.c;
      const cp = ci.children[1], pc = ci.children[2];
      const pt = MEME_SET.has(ci.dataset.s) ? fmtMC(d.mc) : fmtPx(d.p);
      if (cp.textContent !== pt) cp.textContent = pt;
      const cls = (c == null || !isFinite(c)) ? "pc na" : "pc " + (c >= 0 ? "up" : "dn");
      const txt = (c == null || !isFinite(c)) ? "--" : (c >= 0 ? "+" : "") + c.toFixed(1) + "%";
      if (pc.textContent !== txt) pc.textContent = txt;
      if (pc.className !== cls) pc.className = cls;
    });
  }
  renderCoins();
  fit(pages[0]);
  window.__fitCoins = () => pages.forEach(fit);
  setTimeout(() => window.__fitCoins(), 400);
  setTimeout(() => window.__fitCoins(), 1500);
  if (pages.length > 1) setInterval(() => show(cur + 1), 8000);
  setInterval(renderCoins, 5000);
  pollMajors().then(renderCoins);
  setInterval(() => pollMajors().then(renderCoins), 15000);
  if (SHOW_MEMES){ setTimeout(pollMemes, 1500); setInterval(pollMemes, 60000); }
  window.__coins = data;
})();

/* ---------------- MA20 / MA50 cross label ---------------- */
(function(){
  const el = $("maCross"); if (!el) return;
  let sign = null, lastAt = 0, hideT = 0;
  const maClosed = n => {
    const c = S.candles, e = c.length - 1;
    if (e < n) return null;
    let s = 0;
    for (let i = e - n; i < e; i++) s += c[i].c;
    return s / n;
  };
  function place(gold){
    const box = window.__maLegBox, plot = $("plot");
    el.textContent = gold ? "GOLDEN CROSS . MA20 ABOVE MA50" : "DEATH CROSS . MA20 BELOW MA50";
    el.className = gold ? "gold" : "death";
    if (box && plot){
      const right = box.x + box.w + 10;
      if (right + 220 < plot.clientWidth){ el.style.left = right + "px"; el.style.top = Math.max(0, box.y) + "px"; }
      else { el.style.left = box.x + "px"; el.style.top = Math.max(0, box.y - 34) + "px"; }
    }
    void el.offsetWidth; el.classList.add("on");
    clearTimeout(hideT); hideT = setTimeout(() => el.classList.remove("on"), 9000);
  }
  const check = () => {
    const a = maClosed(20), b = maClosed(50);
    if (a == null || b == null) return;
    const sg = a > b ? 1 : a < b ? -1 : 0;
    if (!sg) return;
    if (sign != null && sg !== sign && Date.now() - lastAt > 30 * 60e3 && !DEMO){ lastAt = Date.now(); place(sg > 0); }
    sign = sg;
  };
  setInterval(check, 15000);
  setTimeout(check, 5000);
})();

/* ---------------- subscribe card ---------------- */
(function(){
  const card = $("subCard"); if (!card) return;
  if (Q.get("sub") === "0"){ card.remove(); return; }
  const test = Q.get("subtest") === "1";
  const first = test ? 2500 : 120000, every = test ? 30000 : 15 * 60e3;
  const show = () => { card.classList.remove("show"); void card.offsetWidth; card.classList.add("show"); setTimeout(() => card.classList.remove("show"), 10100); };
  setTimeout(() => { show(); setInterval(show, every); }, first);
})();

/* ---------------- demo mode (testing only) ---------------- */
if (DEMO){
  const go = () => {
    const p = S.price || 1;
    if (DEMO === "pump") showBanner("pump", moveText(true, 1.2), "XRP PUMPING");
    else if (DEMO === "dip") showBanner("dip", moveText(false, 1.4), "XRP DIPPING");
    else if (DEMO === "milestone") showBanner("mile", `XRP CROSSES $${(Math.round(p / STEP) * STEP).toFixed(2)} ⬆`);
  };
  if (DEMO === "high" || DEMO === "low"){
    const hl = () => DEMO === "high" ? showBanner("high", "NEW DAY HIGH 🎉") : showBanner("low", "NEW DAY LOW 📉");
    setTimeout(hl, 3000); setInterval(hl, 12000);
  } else if (DEMO === "ticks"){
    let up = true; setInterval(() => { playSfx(up ? "ping" : "pong"); up = !up; }, 1500);
  } else { setTimeout(go, 3000); setInterval(go, 10000); }
}
window.__xrp = S;
})();

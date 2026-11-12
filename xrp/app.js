/* TENBOB · XRP LIVE 24/7 - website page matching stream overlay v22.
   No libraries, no API keys. Sounds are synthesized live with the Web Audio API; spoken callouts load only after sound is on.
   Data: Binance public websocket (data-stream.binance.vision, then 9443, then 443) for price + 5m/4h/1d klines,
         Binance REST (data-api.binance.vision / api.binance.com), CoinGecko last resort,
         big trades on Binance, Coinbase, Kraken, Bybit and Upbit, XRP/BTC, Fear & Greed,
         XRP Ledger 24h txn count (XRPScan + rippled), XRPL meme caps via DexScreener.
   Test options (URL):  ?demo=pump | dip | milestone | high | low | ticks    ?alerttest=1 | up | down    ?crosstest=1
                        ?subtest=1    ?mood=up | big | down | flat    ?eur=0    ?view=5m|4h|1d    ?rotate=0    ?rotsec=N    ?panels=0 */
(() => {
"use strict";
const $ = id => document.getElementById(id);
const Q = new URLSearchParams(location.search);
const SHOW_EUR = Q.get("eur") !== "0";
const DEMO = Q.get("demo");
const TZ = "Europe/Dublin";
const MA_EXTRA = 50;                           // extra closed candles so MA50 spans the visible window
const ROTATE = Q.get("rotate") !== "0";
const ROT_SEC = (() => { const v = parseFloat(Q.get("rotsec")); return isFinite(v) && v >= 1 ? v : 60; })();
const VIEW_PIN = ({"5m":"5m","4h":"4h","1d":"1d"}[(Q.get("view") || "").toLowerCase()] || null);
const VIEWS = {
  "5m": {id:"5m", label:"5M · 1 HOUR",  tf:"5m", interval: 5 * 60e3,     visible: 12, keep: 12 + MA_EXTRA},
  "4h": {id:"4h", label:"4H · 1 WEEK",  tf:"4h", interval: 4 * 3600e3,   visible: 42, keep: 42 + MA_EXTRA},
  "1d": {id:"1d", label:"1D · 1 MONTH", tf:"1d", interval: 24 * 3600e3,  visible: 30, keep: 30 + MA_EXTRA}
};
const ROT_ORDER = ["5m", "4h", "1d"];
const MOVE_PCT = 1.0, MOVE_WIN_MS = 15 * 60e3; // pump/dip trigger: 1% within 15 min
const MOVE_COOLDOWN_MS = 10 * 60e3;
const moveText = (up, pct) => "XRP " + (up ? "UP" : "DOWN") + " " + Math.abs(pct).toFixed(1) + "% IN 15 MIN";
const STEP = 0.05;                             // level step in USD
const WS_HOSTS = ["wss://data-stream.binance.vision", "wss://stream.binance.com:9443", "wss://stream.binance.com:443"];
const REST_HOSTS = ["https://data-api.binance.vision", "https://api.binance.com"];
const CG = "https://api.coingecko.com/api/v3";
const TICK_GAP_MS = 1500;                      // ping/pong at most once per 1.5 s (net direction)
const HL_COOLDOWN_MS = 5 * 60e3;               // NEW DAY HIGH / LOW cooldown

/* ---------------- state ---------------- */
const S = {
  price: null, prevPrice: null, pct: null, hi: null, lo: null, vol: null, qvol: null, eurRate: null,
  xrplTx: null, xrplMode: "warm",
  candles: [],                 // short 1-minute history for the 15-min move only
  klines: {"5m": [], "4h": [], "1d": []},
  view: VIEW_PIN || "5m",
  samples: [], lastTickAt: 0, source: "", mode: "init",
  lastMoveBanner: {pump: 0, dip: 0}, milestoneLevel: null, milestoneAt: {}, bootAt: Date.now(),
  hl: {hi: null, lo: null, at: {high: 0, low: 0}}
};
const fmt = (v, d = 4) => { const n = Number(v); return Number.isFinite(n) ? n.toFixed(d) : "--"; };
const fmtBig = v => v == null || isNaN(v) ? "--" : v >= 1e9 ? (v/1e9).toFixed(2)+"B" : v >= 1e6 ? (v/1e6).toFixed(1)+"M" : v >= 1e3 ? (v/1e3).toFixed(1)+"K" : v.toFixed(0);
const fmtTrades = v => { if (v == null || !isFinite(v) || v <= 0) return "—";
  if (v >= 1e9) return (v/1e9).toFixed(2)+"B";
  if (v >= 1e6) return (v/1e6).toFixed(1)+"M";
  if (v >= 1e3) return (v/1e3).toFixed(v >= 1e5 ? 0 : 1)+"K";
  return String(Math.round(v)); };
const fmtXrpl = () => {
  if (S.xrplTx != null && isFinite(S.xrplTx) && S.xrplTx > 0) return (S.xrplMode === "est" ? "~" : "") + fmtTrades(S.xrplTx);
  return "warming up";
};
function currentView(){ return VIEWS[VIEW_PIN || S.view] || VIEWS["5m"]; }
function viewSeries(view){ const id = (view || currentView()).id; return S.klines[id] || (S.klines[id] = []); }
function viewReady(id){ const v = (id && VIEWS[id]) || currentView(); const arr = viewSeries(v); return S.price != null && arr && arr.length >= 2; }
function applyLiveCandle(arr, interval, p, ts){
  const m = Math.floor(ts / interval) * interval, last = arr[arr.length - 1];
  if (last && last.t === m){ last.c = p; if (p > last.h) last.h = p; if (p < last.l) last.l = p; }
  else if (!last || m > last.t) arr.push({t: m, o: last ? last.c : p, h: p, l: p, c: p});
}

/* ---------------- responsive layout ---------------- */
const MONO = getComputedStyle(document.documentElement).getPropertyValue("--mono").trim() || "monospace";
const L = {k: 1, narrow: false, chart: {w: 1, h: 1}};
const measure = (() => { const c = document.createElement("canvas").getContext("2d");
  return (txt, px) => { c.font = "800 " + px + "px " + MONO; const m = c.measureText(txt);
    return {w: (m.actualBoundingBoxLeft + m.actualBoundingBoxRight) || m.width, asc: m.actualBoundingBoxAscent || px * .72}; }; })();
function layout(){
  const W = innerWidth, H = innerHeight, body = document.body;
  L.narrow = W < 760 || W / H < 0.9;
  body.classList.toggle("narrow", L.narrow);
  body.classList.toggle("short", !L.narrow && H < 560);
  // --k: 1 at 1920x1080 (same proportions as the stream card), shrinks with the window
  L.k = L.narrow ? Math.max(.35, W / 1100) : Math.max(.42, Math.min(W / 1920, H / 1080));
  document.documentElement.style.setProperty("--k", L.k.toFixed(4));
  fitHead();
  sizeChart();
  sizeCanvas($("fx"), innerWidth, innerHeight);
  fxc.setTransform(devicePixelRatio || 1, 0, 0, devicePixelRatio || 1, 0, 0);
  if (window.__fitCoins) window.__fitCoins();
}
/* price ink fills the left column (about 42% of the card on a wide screen) and leaves the frog a column on phones */
function fitHead(){
  const card = $("card"), el = $("price");
  const cs = getComputedStyle(card), inner = card.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  if (inner < 50) return;
  const txt = el.textContent.length > 3 && el.textContent.indexOf("-") < 0 ? el.textContent : "$0.0000";
  const ink100 = measure(txt, 100);
  const inkW = L.narrow ? inner * 0.72 : Math.min(inner * 0.42, 820 * L.k);
  const fs = Math.max(L.narrow ? 36 : 56, Math.min(L.narrow ? 64 : 168, 100 * inkW / ink100.w, card.clientHeight * (L.narrow ? 0.16 : 0.24)));
  el.style.fontSize = fs.toFixed(1) + "px";
  const t = $("dpT");
  if (t){
    const rows = L.narrow ? 2 : 4;
    window.__panelRows = rows;
    const headH = t.clientHeight || 0, chrome = L.narrow ? 28 : 36;
    const rh = Math.max(L.narrow ? 22 : 28, Math.min(56, Math.floor((headH - chrome) / rows)));
    t.style.setProperty("--rh", rh + "px");
  }
}
function sizeCanvas(c, w, h){ const r = devicePixelRatio || 1; c.width = Math.max(1, Math.round(w * r)); c.height = Math.max(1, Math.round(h * r)); }
function sizeChart(){
  const w = $("chartWrap"); L.chart = {w: Math.max(10, w.clientWidth), h: Math.max(10, w.clientHeight)};
  sizeCanvas($("chart"), L.chart.w, L.chart.h);
  const fade = $("chartFade"); if (fade) sizeCanvas(fade, L.chart.w, L.chart.h);
  chartDirty = true;
}
let layoutT = null;
const relayout = () => { clearTimeout(layoutT); layoutT = setTimeout(layout, 80); };
addEventListener("resize", relayout);
addEventListener("orientationchange", () => setTimeout(layout, 250));

/* ---------------- UI updates (price painted at most once a second, trailing update keeps it exact) ---------------- */
function putText(id, text){ const n = $(id); if (n && n.textContent !== text) n.textContent = text; }
let shownP = null, rpAt = -1e9, rpT = 0;
function renderPrice(){
  if (document.hidden) return;
  const now = performance.now();
  if (now - rpAt < 1000){ if (!rpT) rpT = setTimeout(() => { rpT = 0; renderPrice(); }, 1000 - (now - rpAt)); return; }
  rpAt = now;
  const p = S.price; if (p == null) return;
  const el = $("price"), txt = "$" + fmt(p);
  const sizeChange = txt.length !== el.textContent.length;
  if (el.textContent !== txt) el.textContent = txt;
  if (sizeChange) layout();
  if (shownP != null && p !== shownP){
    el.classList.remove("up", "down"); void el.offsetWidth;
    el.classList.add(p > shownP ? "up" : "down");
  }
  shownP = p;
  if (S.pct != null && isFinite(S.pct)){
    const up = S.pct >= 0;
    $("change").className = "box " + (up ? "up" : "down");
    el.classList.toggle("neg", !up);
    putText("pct", (up ? "+" : "") + S.pct.toFixed(2) + "%");
  }
  putText("hlHighV", S.hi != null ? "$" + fmt(S.hi) : "--");
  putText("hlLowV", S.lo != null ? "$" + fmt(S.lo) : "--");
  putText("vol", fmtBig(S.vol));
  putText("qvol", S.qvol != null ? "$" + fmtBig(S.qvol) : "--");
  putText("tcount", fmtXrpl());
  const title = txt + " XRP Live Price 24/7 | Tenbob";
  if (document.title !== title) document.title = title;
}
function setSource(label, cls){
  S.source = label;                                          // credit line stays the full source list; the dot shows feed health
  const st = $("status"); if (st) st.className = cls || "";
}

/* single entry point for every new price, regardless of source */
function onPrice(p, ts = Date.now()){
  if (!(p > 0)) return;
  S.prevPrice = S.price; S.price = p; S.lastTickAt = Date.now();
  applyLiveCandle(S.candles, 60e3, p, ts);
  for (const v of Object.values(VIEWS)) applyLiveCandle(viewSeries(v), v.interval, p, ts);
  trimCandles();
  const sl = S.samples[S.samples.length - 1];
  if (!sl || ts - sl.t >= 1000) S.samples.push({t: ts, p});
  if (S.samples.length && ts - S.samples[0].t > MOVE_WIN_MS){
    const cut = ts - MOVE_WIN_MS; let drop = 0;
    while (drop < S.samples.length && S.samples[drop].t <= cut) drop++;
    if (drop) S.samples.splice(0, drop);
  }
  if (S.samples.length > 1200) S.samples.splice(0, S.samples.length - 900);
  renderPrice(); checkMove(); checkMilestone(p); checkHighLow(p); tickSound(p); chartDirty = true;
}
function trimCandles(){
  while (S.candles.length > 20) S.candles.shift();
  for (const v of Object.values(VIEWS)){ const arr = viewSeries(v); while (arr.length > v.keep) arr.shift(); }
}
function setCandles(arr){
  const live = S.candles.filter(c => c.t > (arr.length ? arr[arr.length-1].t : 0));
  S.candles = arr.concat(live); trimCandles();
  if (!S.samples.length){
    const now = Date.now();
    S.candles.filter(c => now - c.t <= MOVE_WIN_MS).forEach(c => S.samples.push({t: c.t + 59e3, p: c.c}));
  }
  chartDirty = true;
}
function setViewKlines(id, arr){
  const v = VIEWS[id]; if (!v || !arr || !arr.length) return;
  const cur = viewSeries(v);
  const older = cur.filter(c => c.t < arr[0].t);
  const live = cur.filter(c => c.t > arr[arr.length - 1].t);
  S.klines[id] = older.concat(arr, live);
  while (S.klines[id].length > v.keep) S.klines[id].shift();
  chartDirty = true;
}

/* ---------------- pump / dip / level / new day high-low ---------------- */
function checkMove(){
  if (DEMO || Date.now() - S.bootAt < 20e3 || S.samples.length < 2) return;
  const now = Date.now(), p = S.price;
  let min = Infinity, max = -Infinity;
  for (const s of S.samples){ if (s.p < min) min = s.p; if (s.p > max) max = s.p; }
  if (p >= min * (1 + MOVE_PCT/100) && now - S.lastMoveBanner.pump > MOVE_COOLDOWN_MS){
    S.lastMoveBanner.pump = now; S.samples = [{t: now, p}];
    showBanner("pump", moveText(true, (p / min - 1) * 100), "XRP PUMPING 🚀");
  } else if (p <= max * (1 - MOVE_PCT/100) && now - S.lastMoveBanner.dip > MOVE_COOLDOWN_MS){
    S.lastMoveBanner.dip = now; S.samples = [{t: now, p}];
    showBanner("dip", moveText(false, (1 - p / max) * 100), "XRP DIPPING 📉");
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
  for (const old of Object.keys(S.milestoneAt)) if (now - S.milestoneAt[old] > 6 * 3600e3) delete S.milestoneAt[old];
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

/* ---------------- alerts: banner / big move flash + particle FX ---------------- */
const bannerQ = []; let bannerBusy = false;
let showBanner = function(kind, text, sub){
  if (document.hidden) return;
  if (bannerQ.length >= 3) bannerQ.shift();
  bannerQ.push({kind, text, sub});
  if (!bannerBusy) nextBanner();
};
function nextBanner(){
  const b = bannerQ.shift(); if (!b){ bannerBusy = false; return; }
  bannerBusy = true;
  const move = b.kind === "pump" || b.kind === "dip";
  const el = $(move ? "flash" : "banner");
  el.className = ""; void el.offsetWidth;
  if (move){
    el.classList.add(b.kind === "pump" ? "up" : "down", "show");
    $("flashTag").textContent = b.sub || (b.kind === "pump" ? "XRP PUMPING 🚀" : "XRP DIPPING 📉");
    const ft = $("flashText"); ft.style.fontSize = ""; ft.textContent = b.text;
    if (!L.narrow){
      const avail = el.clientWidth - 60, w = ft.scrollWidth;          // one layout read per alert: shrink if too wide
      if (w > avail) ft.style.fontSize = Math.max(18, Math.floor(parseFloat(getComputedStyle(ft).fontSize) * avail / w)) + "px";
    }
  } else { $("bannerText").textContent = b.text; el.classList.add(b.kind, "show"); }
  burst(b.kind); setTimeout(() => burst(b.kind, true), 900);
  playSfx(b.kind);
  if (window.__voice) window.__voice.callout(b.kind, b.text);         // spoken callout (when sound is on) + matching frog bubble
  if (b.kind === "high" || b.kind === "low"){
    const r = $(b.kind === "high" ? "hlHigh" : "hlLow");
    r.classList.remove("flash"); void r.offsetWidth; r.classList.add("flash");
    setTimeout(() => r.classList.remove("flash"), 5600);
  }
  setTimeout(() => { el.className = ""; nextBanner(); }, move ? 5500 : 8100);
}
const fx = $("fx"), fxc = fx.getContext("2d"); let parts = [], fxDirty = false;
function burstOrigin(){ const r = $("chartWrap").getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }
function burst(kind, small){
  if (kind === "high" || kind === "low") return confetti(kind, small);
  const cols = kind === "pump" ? ["#16e08a","#7dffc4","#ffffff","#ffd23f"] :
               kind === "dip" ? ["#ff4d5e","#ff9aa4","#ffffff","#ff6a3d"] : ["#ffd23f","#fff2a8","#ffffff","#23c4ff"];
  const emo = kind === "pump" ? "🚀" : kind === "dip" ? "📉" : "⭐";
  const k = Math.max(.5, L.k), n = small ? 20 : 45, [cx, cy] = burstOrigin();
  for (let i = 0; i < n; i++){
    const a = Math.random() * Math.PI * 2, v = (6 + Math.random() * (small ? 10 : 18)) * k;
    parts.push({x: cx + Math.cos(a)*120*k, y: cy + Math.sin(a)*40*k, vx: Math.cos(a)*v*1.6, vy: Math.sin(a)*v*0.6 - 6*k, g: .35*k,
      life: 0, max: 70 + Math.random()*60, r: (4 + Math.random()*8)*k, c: cols[i % cols.length], e: i % 9 === 0 ? emo : null});
  }
  kick();
}
function confetti(kind, small){
  const hi = kind === "high", k = Math.max(.5, L.k);
  const cols = hi ? ["#ff3fa4","#ffd23f","#19f08f","#23c4ff","#a45bff","#ffffff","#ff7a2f"] : ["#26508f","#5f86c9","#9fb8e6","#3a4f73"];
  const emo = hi ? "🎉" : "📉", n = hi ? (small ? 35 : 80) : (small ? 14 : 28), [cx, cy] = burstOrigin();
  const spread = Math.min(innerWidth * .8, (hi ? 300 : 700) * k);
  for (let i = 0; i < n; i++){
    const a = hi ? Math.random() * Math.PI * 2 : Math.PI * (0.15 + Math.random() * 0.7);
    const v = (hi ? 6 + Math.random() * (small ? 12 : 22) : 2 + Math.random() * 5) * k;
    parts.push({x: cx + (Math.random() - .5) * spread, y: cy + Math.sin(a) * 30 * k, vx: Math.cos(a) * v * (hi ? 1.7 : 1), vy: Math.sin(a) * v * (hi ? .7 : .5) - (hi ? 7 * k : 0), g: .35*k,
      life: 0, max: (hi ? 90 : 80) + Math.random() * 70, r: (5 + Math.random() * 7)*k, c: cols[i % cols.length],
      e: i % (hi ? 12 : 9) === 0 ? emo : null, sq: true, rot: Math.random() * 6.283, vr: (Math.random() - .5) * .4, alpha: hi ? 1 : .7});
  }
  kick();
}
function drawFx(){
  if (parts.length > 200) parts.splice(0, parts.length - 200);
  if (!parts.length && !fxDirty) return;
  fxc.clearRect(0, 0, innerWidth, innerHeight); fxDirty = parts.length > 0;
  for (const p of parts){
    for (let s = 0; s < 2; s++){ p.life++; p.x += p.vx; p.y += p.vy; p.vx *= .97; p.vy = p.vy * .97 + p.g; if (p.sq) p.rot += p.vr; }   // 2 physics steps per frame (~30 fps)
    const a = Math.max(0, 1 - p.life / p.max);
    fxc.globalAlpha = p.alpha ? a * p.alpha : a;
    if (p.e){ fxc.font = (p.r*5)+"px serif"; fxc.fillText(p.e, p.x, p.y); }
    else if (p.sq){ fxc.save(); fxc.translate(p.x, p.y); fxc.rotate(p.rot); fxc.fillStyle = p.c;
      fxc.fillRect(-p.r, -p.r * .45, p.r * 2, p.r * .9 * Math.abs(Math.cos(p.rot * 1.7)) + 1); fxc.restore(); }
    else { fxc.fillStyle = p.c; fxc.beginPath(); fxc.arc(p.x, p.y, p.r * (0.5 + a/2), 0, 6.283); fxc.fill(); }
  }
  fxc.globalAlpha = 1;
  parts = parts.filter(p => p.life < p.max);
}

/* ---------------- chart: v22 candlesticks + MA20/MA50 + live price tag + Dublin time axis ---------------- */
const cv = $("chart"), cx = cv.getContext("2d"); let chartDirty = true;
const cvFade = $("chartFade"), cxFade = cvFade.getContext("2d");
const timeFmt = new Intl.DateTimeFormat("en-GB", {timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false});
const dateLblFmt = new Intl.DateTimeFormat("en-GB", {timeZone: TZ, day: "numeric", month: "short"});
const dublinPartFmt = new Intl.DateTimeFormat("en-GB", {timeZone: TZ, weekday: "short", year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false});
function dublinParts(ts){ const o = {}; for (const part of dublinPartFmt.formatToParts(new Date(ts))) if (part.type !== "literal") o[part.type] = part.value; return o; }
function niceStep(range, n){ const raw = range / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag; }
function fmtAxisPrice(v, step){
  const d = Math.max(0, Math.min(6, Math.ceil(-Math.log10(step) - 1e-12)));
  return "$" + Number(v).toFixed(d);
}
function axisValues(lo, hi){
  const range = (hi - lo) || 1e-6;
  const collect = step => {
    const vals = [];
    const start = Math.ceil(lo / step - 1e-12) * step;
    for (let v = start; v <= hi + step * 1e-9; v = +(v + step).toPrecision(12)){
      vals.push(v); if (vals.length > 12) break;
    }
    return vals;
  };
  const scoreOf = vals => (vals.length >= 4 && vals.length <= 5) ? (5 - vals.length) * 0.1
    : (vals.length < 4 ? 50 + (4 - vals.length) * 10 : 2 + (vals.length - 5));
  let best = null;
  for (let n = 3; n <= 10; n++){
    const step = niceStep(range, n);
    if (!(step > 0) || !isFinite(step)) continue;
    for (const s of [step, step * 2]){
      const vals = collect(s), score = scoreOf(vals);
      if (!best || score < best.score) best = {step: s, vals, score};
    }
  }
  if (best && best.vals.length > 5){
    const vals = best.vals.slice();
    while (vals.length > 5){
      const d0 = vals[0] - lo, d1 = hi - vals[vals.length - 1];
      if (d0 <= d1) vals.shift(); else vals.pop();
    }
    best = {step: best.step, vals, score: best.score};
  }
  return best || {step: range, vals: [lo, hi]};
}
function chartMetrics(W){
  const prop = W / 1680;
  const ck = L.narrow ? Math.max(0.5, Math.min(0.62, prop * 2.6)) : Math.max(0.72, Math.min(1.05, prop));
  return {
    ck,
    R: Math.round(L.narrow ? Math.max(76, 120 * ck) : 120 * ck),
    Lpad: L.narrow ? 4 : Math.round(16 * ck),
    T: L.narrow ? 4 : 8,
    B: L.narrow ? 26 : Math.round(40 * ck),
    fontAxis: Math.max(11, Math.round(22 * ck)),
    fontTag: Math.max(11, Math.round(20 * ck)),
    tagH: L.narrow ? 18 : Math.max(22, Math.round(28 * ck))
  };
}
function drawPriceAxis(lo, hi, Y, x0, x1, h, hideY, hideH, labelMaxY, m){
  const {step, vals} = axisValues(lo, hi);
  cx.save();
  cx.setLineDash([]); cx.lineWidth = 1;
  cx.font = "600 " + m.fontAxis + "px " + MONO; cx.textBaseline = "middle"; cx.textAlign = "left";
  const hidePad = (hideH || 0) / 2 + 4;
  const lyMax = labelMaxY != null ? labelMaxY : h - 13;
  for (const v of vals){
    const y = Math.round(Y(v)) + 0.5;
    if (y > lyMax + 8) continue;
    cx.strokeStyle = "rgba(255,255,255,.055)";
    cx.beginPath(); cx.moveTo(x0, y); cx.lineTo(x1, y); cx.stroke();
    if (hideY != null && hideH && Math.abs(y - hideY) < hidePad) continue;
    const ly = Math.min(Math.max(y, m.fontAxis / 2 + 1), lyMax);
    cx.fillStyle = "rgba(214,226,222,.92)";
    cx.fillText(fmtAxisPrice(v, step), x1 + 8, ly);
  }
  cx.restore();
}
function drawLivePriceLine(y, x0, x1, price, up, yMax, m){
  const col = up ? "#19f08f" : "#ff4d5e";
  const ink = up ? "#041016" : "#ffffff";
  const yHi = yMax != null ? yMax : 1e9;
  const yy = Math.round(Math.min(Math.max(y, 2), yHi)) + 0.5;
  cx.save();
  cx.setLineDash([3, 5]); cx.lineWidth = Math.max(1, 1.4 * m.ck); cx.lineCap = "butt"; cx.strokeStyle = col;
  cx.beginPath(); cx.moveTo(x0, yy); cx.lineTo(x1, yy); cx.stroke();
  cx.setLineDash([]);
  const label = "$" + fmt(price);
  cx.font = "700 " + m.fontTag + "px " + MONO; cx.textAlign = "left"; cx.textBaseline = "middle";
  const tw = cx.measureText(label).width, padX = L.narrow ? 4 : 7, th = m.tagH, tagW = tw + padX * 2;
  let ty = Math.min(Math.max(yy, th / 2 + 2), yHi - th / 2 - 2);
  const tx = x1 + 6, r = 4, bx = tx, by = ty - th / 2;
  cx.beginPath();
  cx.moveTo(bx + r, by); cx.lineTo(bx + tagW - r, by); cx.quadraticCurveTo(bx + tagW, by, bx + tagW, by + r);
  cx.lineTo(bx + tagW, by + th - r); cx.quadraticCurveTo(bx + tagW, by + th, bx + tagW - r, by + th);
  cx.lineTo(bx + r, by + th); cx.quadraticCurveTo(bx, by + th, bx, by + th - r);
  cx.lineTo(bx, by + r); cx.quadraticCurveTo(bx, by, bx + r, by); cx.closePath();
  cx.fillStyle = col; cx.fill();
  cx.fillStyle = ink; cx.fillText(label, bx + padX, ty + 0.5);
  cx.restore();
}
function timeAxisLabels(view, data, X){
  if (!data.length) return [];
  const out = [];
  if (view.id === "5m"){
    const hits = [];
    for (let i = 0; i < data.length; i++){
      const part = dublinParts(data[i].t), minute = parseInt(part.minute, 10);
      if (minute % 15 === 0) hits.push({i, x: X(i), text: timeFmt.format(new Date(data[i].t))});
    }
    if (hits.length >= 4 && hits.length <= 7) return hits;
    if (hits.length > 7){
      const step = Math.ceil(hits.length / 6);
      return hits.filter((_, k) => k % step === 0).slice(0, 7);
    }
    const hits10 = [];
    for (let i = 0; i < data.length; i++){
      const part = dublinParts(data[i].t), minute = parseInt(part.minute, 10);
      if (minute % 10 === 0) hits10.push({i, x: X(i), text: timeFmt.format(new Date(data[i].t))});
    }
    if (hits10.length >= 4) return hits10.slice(0, 7);
    const n = Math.min(5, data.length), step = Math.max(1, Math.floor((data.length - 1) / Math.max(1, n - 1)));
    for (let i = 0; i < data.length; i += step) out.push({i, x: X(i), text: timeFmt.format(new Date(data[i].t))});
    return out.slice(0, 7);
  }
  if (view.id === "4h"){
    let lastKey = null;
    for (let i = 0; i < data.length; i++){
      const part = dublinParts(data[i].t), key = part.year + "-" + part.month + "-" + part.day;
      if (key === lastKey) continue;
      lastKey = key;
      out.push({i, x: X(i), text: part.weekday, hour: part.hour, minute: part.minute});
    }
    if (out.length > 7){
      if (out[0].hour !== "00" || out[0].minute !== "00") out.shift();
      if (out.length > 7){
        const mid = out.slice(1, -1), keep = [], step = Math.ceil(mid.length / Math.max(1, 5));
        for (let k = 0; k < mid.length; k += step) keep.push(mid[k]);
        const trimmed = [out[0]].concat(keep, out[out.length - 1]).slice(0, 7);
        out.length = 0; out.push.apply(out, trimmed);
      }
    }
    return out.map(({i, x, text}) => ({i, x, text}));
  }
  const step = 7;
  for (let i = 0; i < data.length; i += step) out.push({i, x: X(i), text: dateLblFmt.format(new Date(data[i].t))});
  if (out.length < 4 && data.length >= 4){
    out.length = 0;
    const n = Math.min(5, data.length), st = Math.max(1, Math.floor((data.length - 1) / Math.max(1, n - 1)));
    for (let i = 0; i < data.length; i += st) out.push({i, x: X(i), text: dateLblFmt.format(new Date(data[i].t))});
  }
  return out.slice(0, 7);
}
function drawTimeAxis(view, data, X, Lpad, pw, plotBottom, m){
  const labels = timeAxisLabels(view, data, X);
  if (!labels.length) return;
  const y0 = plotBottom;
  cx.save();
  cx.setLineDash([]);
  cx.strokeStyle = "rgba(255,255,255,.12)"; cx.lineWidth = 1;
  cx.beginPath(); cx.moveTo(Lpad, Math.round(y0) + 0.5); cx.lineTo(Lpad + pw, Math.round(y0) + 0.5); cx.stroke();
  cx.font = "600 " + m.fontAxis + "px " + MONO; cx.textBaseline = "top"; cx.fillStyle = "rgba(214,226,222,.92)";
  const yTick1 = y0 + Math.max(4, 7 * m.ck), yText = y0 + Math.max(6, 10 * m.ck), minL = 2, maxR = Lpad + pw - 2, gap = L.narrow ? 6 : 12;
  const placed = [];
  for (const lb of labels){
    const tw = cx.measureText(lb.text).width, half = tw / 2;
    let tx = lb.x;
    if (tx - half < minL) tx = minL + half;
    if (tx + half > maxR) tx = maxR - half;
    placed.push({x: lb.x, tx, tw, left: tx - half, right: tx + half, text: lb.text});
  }
  for (let i = 1; i < placed.length; i++){
    const need = placed[i - 1].right + gap - placed[i].left;
    if (need <= 0) continue;
    const room = maxR - placed[i].right;
    if (room >= need){ placed[i].tx += need; placed[i].left += need; placed[i].right += need; }
    else placed[i].drop = true;
  }
  cx.lineWidth = 1.5; cx.lineCap = "butt"; cx.strokeStyle = "rgba(255,255,255,.32)";
  cx.textAlign = "center";
  for (const lb of placed){
    if (lb.drop) continue;
    const tickX = Math.round(lb.x) + 0.5;
    cx.beginPath(); cx.moveTo(tickX, y0); cx.lineTo(tickX, yTick1); cx.stroke();
    cx.fillText(lb.text, lb.tx, yText);
  }
  cx.restore();
}
function drawChart(){
  const r = devicePixelRatio || 1, W = L.chart.w, H = L.chart.h, m = chartMetrics(W);
  cx.setTransform(r, 0, 0, r, 0, 0); cx.clearRect(0, 0, W, H);
  const view = currentView(), VIS = view.visible, full = viewSeries(view);
  const data = full.slice(-VIS);
  const Lpad = m.Lpad, pw = W - Lpad - m.R, T = m.T, ph = H - T - m.B;
  if (data.length < 2 || S.price == null || pw < 20 || ph < 20){
    cx.fillStyle = "#93a7a3"; cx.font = "700 " + Math.round(Math.max(13, 22 * m.ck)) + "px " + MONO;
    cx.fillText("Connecting to live feed...", Lpad + 8, H / 2); return;
  }
  const price = S.price, last = data[data.length - 1], off = full.length - data.length;
  const maAt = (k, n) => {
    if (k >= full.length - 1) k = full.length - 2;
    if (k < n - 1 || k < 0) return null;
    let s = 0; for (let j = k - n + 1; j <= k; j++) s += full[j].c; return s / n;
  };
  const ma20s = data.map((_, i) => maAt(off + i, 20));
  const ma50s = data.map((_, i) => maAt(off + i, 50));
  let lo = Infinity, hi = -Infinity;
  for (const c of data){
    const cl = (c === last) ? price : c.c;
    const low = Math.min(c.l, cl), high = Math.max(c.h, cl);
    if (low < lo) lo = low; if (high > hi) hi = high;
  }
  lo = Math.min(lo, price); hi = Math.max(hi, price);
  for (const v of ma20s.concat(ma50s)){ if (v != null && isFinite(v)){ if (v < lo) lo = v; if (v > hi) hi = v; } }
  const pad = Math.max((hi - lo) * 0.03, hi * 0.0004); lo -= pad; hi += pad;
  const slot = pw / Math.max(1, VIS);
  const X = i => Lpad + (i + 0.5 + (VIS - data.length)) * slot;
  const Y = v => T + (hi - v) / (hi - lo) * ph;
  const yp = Y(price), liveUp = price >= last.o;
  drawPriceAxis(lo, hi, Y, Lpad, Lpad + pw, H, yp, m.tagH, T + ph - 2, m);
  cx.save();
  cx.beginPath(); cx.rect(Lpad, T - 1, pw, ph + 2); cx.clip();
  const bw = Math.max(L.narrow ? 2.2 : 5 * m.ck, slot * 0.74), wickW = slot >= 14 ? 2.2 * m.ck : 1.5 * m.ck;
  for (let i = 0; i < data.length; i++){
    const c = data[i], cl = i === data.length - 1 ? price : c.c;
    const x = X(i), up = cl >= c.o;
    const yH = Y(Math.max(c.h, cl)), yL = Y(Math.min(c.l, cl));
    const y1 = Math.min(Y(c.o), Y(cl)), y2 = Math.max(Y(c.o), Y(cl));
    cx.strokeStyle = cx.fillStyle = up ? "#19f08f" : "#ff4d5e";
    cx.lineWidth = Math.max(1, wickW); cx.lineCap = "butt";
    cx.beginPath(); cx.moveTo(x, yH); cx.lineTo(x, yL); cx.stroke();
    cx.fillRect(x - bw / 2, y1, bw, Math.max(1.5, y2 - y1));
  }
  const maPath = arr => { const pts = []; arr.forEach((v, i) => { if (v != null && isFinite(v)) pts.push([X(i), Y(v)]); });
    if (pts.length < 2) return null; const path = new Path2D(); path.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) path.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + pts[i+1][0]) / 2, (pts[i][1] + pts[i+1][1]) / 2);
    path.lineTo(pts[pts.length-1][0], pts[pts.length-1][1]); return path; };
  const maLine = (arr, col, dash, lw) => { const path = maPath(arr); if (!path) return;
    cx.lineJoin = cx.lineCap = "round"; cx.setLineDash(dash || []); cx.strokeStyle = col; cx.lineWidth = lw; cx.stroke(path); cx.setLineDash([]); };
  maLine(ma50s, "rgba(215,170,255,1)", [7, 4], Math.max(1.6, 2.8 * m.ck));
  maLine(ma20s, "rgba(255,207,77,.85)", [13, 9], Math.max(1.4, 2.5 * m.ck));
  cx.restore();
  drawLivePriceLine(yp, Lpad, Lpad + pw, price, liveUp, T + ph - 2, m);
  drawTimeAxis(view, data, X, Lpad, pw, T + ph, m);
}

/* ---------------- sound (all synthesized with Web Audio, same sounds as the stream overlay) ---------------- */
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
  // PUMP: celebration = air horn blasts + rising fanfare + crowd cheer
  function horn(ac, out, t, dur){
    const v = g(ac, 0, out); v.gain.setValueAtTime(0.0001, t); v.gain.exponentialRampToValueAtTime(.22, t + .03);
    v.gain.setValueAtTime(.22, t + dur - .06); v.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const f = ac.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 2600; f.Q.value = 2; f.connect(v);
    [466.16, 587.33, 698.46].forEach(fr => [-9, 9].forEach(c => { const o = osc(ac, "sawtooth", fr, t, dur, f); o.detune.value = c; }));
  }
  function pump(ac, out, t){
    whoosh(ac, out, t, true);
    horn(ac, out, t + .05, .28); horn(ac, out, t + .4, .28); horn(ac, out, t + .75, .9);
    const bus = g(ac, .8, out);
    [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => brass(ac, bus, f, t + 1.0 + i * .1, i === 4 ? 1.1 : .18, .9, i === 4));
    cheer(ac, out, t + .3, 2.8);
    return 3.2;
  }
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
function sfxChain(ac, vol){                       // master volume -> limiter -> speakers
  const m = ac.createGain(); m.gain.value = vol;
  const lim = ac.createDynamicsCompressor();
  lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = .001; lim.release.value = .2;
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
let AC = null, SFX_OUT = null, SFX_DUCK = null;
function ensureAC(){
  if (AC) return AC;
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    SFX_OUT = sfxChain(AC, volume);
    SFX_DUCK = AC.createGain(); SFX_DUCK.connect(SFX_OUT);         // alert sounds go through this so the voice can duck them
    AC.onstatechange = updateSoundUI;
  } catch(e){ AC = null; }
  return AC;
}
const audioRunning = () => !!AC && AC.state === "running";
let voiceLoading = false;
function loadVoice(){                                     // spoken callouts (~300 KB) are fetched only once sound is on
  if (window.__VOICE_CLIPS || voiceLoading) return; voiceLoading = true;
  const s = document.createElement("script"); s.src = "voice.js?v=22"; s.async = true; s.onerror = () => { voiceLoading = false; }; document.head.appendChild(s);
}
function startAudio(){                                    // must be called from a tap/click/key
  if (!ensureAC()) return Promise.resolve(false);
  const p = AC.state === "running" ? Promise.resolve() : AC.resume();
  return p.then(() => { updateSoundUI(); if (audioRunning()) loadVoice(); return audioRunning(); }, () => false);
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
  b.textContent = live ? "Sound: ON" : "Tap for sound";
  b.title = live ? "Tap to mute (M)" : "Alert sounds and voice (M)";
  $("ticksBtn").textContent = "Ticks: " + (ticksOn ? "ON" : "OFF");
  $("ticksBtn").setAttribute("aria-pressed", String(ticksOn));
}
function playSfx(name){
  if (!soundOn || !audioRunning() || !SYNTH[name]) return;
  try { SYNTH[name](AC, SFX_DUCK || SFX_OUT, AC.currentTime + .02); } catch(e){}
}
/* voice callouts: decoded on first use, played after the alert sound (which ducks under it); the frog bubble shows the same line */
window.__voice = (() => {
  const bufs = {};
  const BUB = {pump: "XRP PUMPING!", dip: "XRP DIPPING", high: "NEW DAY HIGH!", low: "NEW DAY LOW", golden: "GOLDEN CROSS!", death: "DEATH CROSS",
               lvl_up: "NEW LEVEL!", lvl_dn: "BELOW KEY LEVEL"};
  const DELAY = {pump: 1.0, dip: .55, high: .9, low: .7, mile: .6, golden: .15, death: .15};
  let busyUntil = 0;
  const VC = () => window.__VOICE_CLIPS || {};
  const b64 = b => { const bin = atob(b), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; };
  function get(id){
    if (bufs[id]) return bufs[id];
    bufs[id] = new Promise((res, rej) => AC.decodeAudioData(b64(VC()[id]), res, rej));
    bufs[id].catch(() => { delete bufs[id]; }); return bufs[id];
  }
  function clipFor(kind, text){
    if (kind === "mile"){
      const m = /\$(\d+\.\d\d)\s*(⬆|⬇)/.exec(text || ""), up = !m || m[2] === "⬆";
      if (m && VC()[(up ? "up_" : "dn_") + m[1]]) return [(up ? "up_" : "dn_") + m[1], (up ? "ABOVE $" : "BELOW $") + m[1] + (up ? "!" : "")];
      return up ? ["lvl_up", BUB.lvl_up] : ["lvl_dn", BUB.lvl_dn];
    }
    return [kind, BUB[kind]];
  }
  const say = (t, ms) => { if (t && window.__mascot) window.__mascot.say(t, ms); };
  const log = [];
  async function callout(kind, text){
    const [id, bub] = clipFor(kind, text), delay = DELAY[kind] != null ? DELAY[kind] : .3;
    if (!soundOn || !audioRunning() || !VC()[id]){ setTimeout(() => say(bub, 6500), delay * 1000); return; }
    let buf; try { buf = await get(id); } catch(e){ say(bub, 6500); return; }
    const t0 = Math.max(AC.currentTime + delay, busyUntil + .25), dur = buf.duration;
    const src = AC.createBufferSource(); src.buffer = buf; src.connect(SFX_OUT); src.start(t0);
    const d = SFX_DUCK.gain; d.setTargetAtTime(.3, Math.max(AC.currentTime, t0 - .12), .05); d.setTargetAtTime(1, t0 + dur, .2);
    busyUntil = t0 + dur; log.push(id);
    if (window.__music) window.__music.duck(Math.max(0, t0 - AC.currentTime), dur);   // music dips under the voice
    setTimeout(() => say(bub, Math.max(5000, dur * 1000 + 3000)), Math.max(0, (t0 - AC.currentTime) * 1000));
  }
  return {callout, log};
})();
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

/* ---------------- controls: sound / volume / ticks / full screen ---------------- */
$("volume").value = volume;
$("sndBtn").addEventListener("click", () => {
  if (soundOn && !audioRunning()) startAudio().then(ok => { if (ok) playSfx("ping"); });   // remembered "on" but the browser had it blocked
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
window.__xrpVolume = () => volume;

const docEl = document.documentElement;
const fsEnabled = document.fullscreenEnabled || document.webkitFullscreenEnabled;
const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
if (!fsEnabled) document.body.classList.add("nofs");
function toggleFs(){
  if (fsEl()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  else { const r = (docEl.requestFullscreen || docEl.webkitRequestFullscreen).call(docEl); if (r && r.catch) r.catch(() => {}); }
}
function onFullscreen(){ const on = !!fsEl(); document.body.classList.toggle("isfs", on); $("fsBtn").textContent = on ? "Exit full screen" : "Full screen"; setTimeout(layout, 60); }
$("fsBtn").addEventListener("click", toggleFs);
document.addEventListener("fullscreenchange", onFullscreen);
document.addEventListener("webkitfullscreenchange", onFullscreen);
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
// hide the mouse cursor in full screen after a few seconds without movement
let idleT = null;
function wake(){ document.body.classList.remove("idle"); clearTimeout(idleT); idleT = setTimeout(() => document.body.classList.add("idle"), 4000); }
["mousemove", "pointerdown", "keydown"].forEach(ev => addEventListener(ev, wake, {passive: true, capture: true}));
updateSoundUI();
window.__xrpSfx = {play: playSfx, ctx: () => AC, on: () => soundOn};

/* ---------------- main loop: rAF only while confetti flies, otherwise a 4 Hz timer; chart redrawn at most once a second ---------------- */
let lastFrame = 0, chartAt = -1e9, loopT = 0, rafOn = false;
function loop(now){
  rafOn = false;
  if (document.hidden){ parts.length = 0; fxc.clearRect(0, 0, innerWidth, innerHeight); return; }
  if (now - lastFrame >= 30){
    lastFrame = now;
    if ((chartDirty && now - chartAt >= 1000) || now - chartAt >= 5000){ chartAt = now; chartDirty = false; drawChart(); }
    drawFx();
  }
  if (parts.length || fxDirty){ rafOn = true; requestAnimationFrame(loop); }
  else { clearTimeout(loopT); loopT = setTimeout(() => { rafOn = true; requestAnimationFrame(loop); }, 250); }
}
function kick(){ if (!rafOn){ clearTimeout(loopT); rafOn = true; requestAnimationFrame(loop); } }

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
async function seedKlines(interval, limit){
  const {data} = await restAny("/api/v3/klines?symbol=XRPUSDT&interval=" + interval + "&limit=" + limit);
  return data.map(k => ({t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5]}));
}
async function refreshKlines(full){
  await Promise.all(Object.values(VIEWS).map(async v => {
    try { setViewKlines(v.id, await seedKlines(v.tf, full ? v.keep : 3)); } catch(e){}
  }));
}
async function seedBinance(){
  const jobs = Object.values(VIEWS).map(v => seedKlines(v.tf, v.keep).then(arr => ({id: v.id, arr})).catch(() => ({id: v.id, arr: null})));
  jobs.push(seedKlines("1m", 20).then(arr => ({id: "1m", arr})).catch(() => ({id: "1m", arr: null})));
  const results = await Promise.all(jobs);
  let any = false;
  for (const r of results){
    if (r.id === "1m"){ if (r.arr && r.arr.length){ setCandles(r.arr); any = true; } }
    else if (r.arr && r.arr.length){ setViewKlines(r.id, r.arr); any = true; }
  }
  try { applyTicker24((await restAny("/api/v3/ticker/24hr?symbol=XRPUSDT")).data); any = true; } catch(e){}
  if (!any) throw new Error("binance seed empty");
  return true;
}
async function seedCoinGecko(){
  const d = await getJSON(CG + "/coins/ripple/market_chart?vs_currency=usd&days=30");
  const pr = d.prices || [];
  if (!pr.length) return;
  const fold = interval => {
    const out = [];
    for (const p of pr){
      const t = Math.floor(p[0] / interval) * interval, px = p[1], last = out[out.length - 1];
      if (last && last.t === t){ last.h = Math.max(last.h, px); last.l = Math.min(last.l, px); last.c = px; }
      else out.push({t, o: px, h: px, l: px, c: px});
    }
    return out;
  };
  const m1 = pr.filter(p => p[0] >= Date.now() - 20 * 60e3).map(p => { const t = Math.floor(p[0]/60e3)*60e3; return {t, o: p[1], h: p[1], l: p[1], c: p[1]}; });
  if (m1.length) setCandles(m1);
  for (const v of Object.values(VIEWS)){
    if (viewSeries(v).length) continue;
    const arr = fold(v.interval);
    if (arr.length) setViewKlines(v.id, arr.slice(-v.keep));
  }
  S.hi = Math.max(...pr.map(p => p[1])); S.lo = Math.min(...pr.map(p => p[1]));
  if (pr.length) onPrice(pr[pr.length - 1][1], pr[pr.length - 1][0]);
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
  const applyKline = (arr, c) => {
    const last = arr[arr.length - 1];
    if (last && last.t === c.t) Object.assign(last, c);
    else if (!last || c.t > last.t) arr.push(c);
    trimCandles(); chartDirty = true;
  };
  mk("xrpusdt@kline_1m", d => { const k = d.k; if (!k) return;
    applyKline(S.candles, {t: k.t, o: +k.o, h: +k.h, l: +k.l, c: +k.c, v: +k.v}); });
  for (const v of Object.values(VIEWS)){
    mk("xrpusdt@kline_" + v.tf, d => { const k = d.k; if (!k) return;
      applyKline(viewSeries(v), {t: k.t, o: +k.o, h: +k.h, l: +k.l, c: +k.c, v: +k.v}); });
  }
  setTimeout(() => { if (!gotMsg && gen === wsGen) scheduleReconnect(false); }, 7000);
}
let reconnectT = null;
function scheduleReconnect(hadData){
  if (reconnectT) return;
  sockets.forEach(s => { try { s.onclose = null; s.close(); } catch(e){} }); sockets = [];
  if (!hadData){ wsFails++; wsHostIdx++; }
  if (wsFails >= WS_HOSTS.length) startPolling();
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
    if (!cgTimer){
      clearInterval(restTimer); restTimer = null;
      const cg = async () => { if (await pollCoinGecko(true)) setSource("CoinGecko", "warn"); else setSource("offline · retrying...", "bad"); };
      cg(); cgTimer = setInterval(cg, 30000);
      if (!Object.values(VIEWS).some(v => viewSeries(v).length >= 2)) seedCoinGecko().catch(() => {});
    }
  };
  tick(); restTimer = setInterval(tick, 5000);
}
function stopPolling(){ clearInterval(restTimer); clearInterval(cgTimer); restTimer = cgTimer = null; }
setInterval(() => { if (!document.hidden && S.mode === "ws" && Date.now() - S.lastTickAt > 45000) scheduleReconnect(true); }, 10000);
setInterval(() => { if (!document.hidden) refreshKlines(false).catch(() => {}); }, 20e3);
setInterval(() => { if (!document.hidden) refreshKlines(true).catch(() => {}); }, 3 * 60e3);
document.addEventListener("visibilitychange", () => {
  if (document.hidden){ parts.length = 0; return; }
  chartDirty = true; kick(); renderPrice();
  if (Date.now() - S.lastTickAt > 60000) seedBinance().catch(() => {});
});

/* ---------------- boot ---------------- */
layout();
if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout);
if (window.ResizeObserver) new ResizeObserver(relayout).observe($("card"));
kick();
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

/* ---------------- Buddha frog: moods, speech bubble, motion (v18 engine, v22 bubble stays in the card) ---------------- */
(function(){
  const CR = $("mascot"), BUB = $("bub");
  if (!CR || !BUB) return;
  const TXT = {pump: ["XRP UP!", "NICE MOVE", "LET'S GO"], dip: ["HODL", "STAY CALM", "BREATHE"],
               mile: ["NEW LEVEL", "OMMMM"], calm: ["NAMASTE", "BE WATER"]};
  const MOODS = {up: "XRP UP!", big: "XRP UP BIG!", down: "HODL", flat: "CHILL"};   // short, no promises
  let mood = null, moodSaidAt = 0, state = "calm", until = 0, sayT = 0, lockUntil = 0;
  const MOOD_FORCE = MOODS[Q.get("mood")] ? Q.get("mood") : null;
  const pick = a => a[Math.floor(Math.random() * a.length)];
  function say(t, ms){ BUB.textContent = t; CR.classList.add("say"); clearTimeout(sayT); sayT = setTimeout(() => CR.classList.remove("say"), ms); }
  function callSay(t, ms){ lockUntil = Date.now() + ms; say(t, ms); }
  function setMood(m){
    if (m === mood) return;
    CR.classList.remove("m-up", "m-big", "m-down", "m-flat"); mood = m; CR.classList.add("m-" + m);
    if (state === "calm" && Date.now() > lockUntil){ say(MOODS[m], MOOD_FORCE ? 1e9 : 7000); moodSaidAt = Date.now(); }
  }
  function moodFrom(ch15){
    const pct = S.pct;
    let m = pct == null || !isFinite(pct) ? "flat" : pct >= 3 ? "big" : pct >= 0.5 ? "up" : pct <= -0.5 ? "down" : "flat";
    if (ch15 != null){ if (ch15 >= 0.6 && (m === "flat" || m === "down")) m = "up"; else if (ch15 <= -0.6 && m !== "down") m = "down"; }
    return m;
  }
  const BODY = CR.querySelector(".body"), SWR = CR.querySelector(".swr"), POP = CR.querySelector(".pop");
  const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const TGT = {flat: {br: 1,  bA: 0, bF: .7,  sA: .7,  wA: 0,   wF: 2.8, y0: 0, ln: 0},
               up:   {br: 1,  bA: 4, bF: .8,  sA: 1.0, wA: 0,   wF: 2.8, y0: 0, ln: 0},
               big:  {br: .8, bA: 7, bF: 1.1, sA: 1.3, wA: 0,   wF: 2.8, y0: 0, ln: 0},
               down: {br: .7, bA: 0, bF: .7,  sA: .3,  wA: .9,  wF: 2.6, y0: 4, ln: -1.2},
               pump: {br: .8, bA: 8, bF: 1.25,sA: 1.3, wA: 0,   wF: 2.8, y0: 0, ln: 0},
               dip:  {br: .6, bA: 0, bF: .7,  sA: .2,  wA: 1.6, wF: 3.3, y0: 6, ln: -1.6},
               mile: {br: 1,  bA: 5, bF: 1.0, sA: 1.0, wA: 0,   wF: 2.8, y0: 0, ln: 0}};
  const cur = Object.assign({}, TGT.flat), ph = {br: 0, b: 0, s: 0, w: 0}, imp = [];
  const target = () => { const t = (state !== "calm" && TGT[state]) || TGT[mood] || TGT.flat;
    return reduced ? Object.assign({}, t, {br: 0, sA: 0, bA: 0, wA: 0}) : t; };
  function impulse(k, opt){ if (imp.length >= 4) imp.shift(); imp.push(Object.assign({k, t0: performance.now(), d: 700, h: 22}, opt || {})); }
  let lastF = performance.now(), lastTf = "";
  function frame(now){
    if (!BODY || reduced) return;
    requestAnimationFrame(frame);
    let dt = (now - lastF) / 1000; lastF = now; if (dt <= 0) return; if (dt > .25) dt = .25;
    const T = target(), e = 1 - Math.exp(-dt / .7);
    for (const k in cur) cur[k] += (T[k] - cur[k]) * e;
    ph.br += dt * 2 * Math.PI / 4.6; ph.b += dt * Math.PI * cur.bF; ph.s += dt * 2 * Math.PI / 8.5; ph.w += dt * 2 * Math.PI * cur.wF;
    for (const k in ph) if (ph[k] > 2000 * Math.PI) ph[k] -= 2000 * Math.PI;
    const brS = (1 - Math.cos(ph.br)) / 2;
    let x = 0, y = cur.y0 - 1.6 * cur.br * brS, rot = cur.ln + cur.sA * Math.sin(ph.s), sx = 1 + .006 * cur.br * brS, sy = 1 + .014 * cur.br * brS;
    const b = Math.abs(Math.sin(ph.b)), sq = .03 * (cur.bA / 8) * Math.pow(1 - b, 6);
    y -= cur.bA * b; sx += sq; sy -= sq;
    rot += cur.wA * (.65 * Math.sin(ph.w) + .35 * Math.sin(1.73 * ph.w + 1.1)); x += cur.wA * 1.5 * Math.sin(1.31 * ph.w + .4);
    for (let i = imp.length - 1; i >= 0; i--){
      const I = imp[i], u = (now - I.t0) / I.d; if (u < 0) continue; if (u >= 1){ imp.splice(i, 1); continue; }
      if (I.k === "hop"){
        if (u < .14){ const q = Math.sin(Math.PI * u / .14) * .05; sy -= q; sx += q * .7; }
        else if (u < .86){ const v = (u - .14) / .72, q = Math.sin(Math.PI * v); y -= I.h * q; sy += .03 * q; sx -= .015 * q; rot += (I.rot || -1.5) * q; }
        else { const q = Math.sin(Math.PI * (u - .86) / .14) * .04; sy -= q; sx += q * .7; }
      } else if (I.k === "flinch"){
        const k2 = (1 - u) * (1 - u), w = Math.sin(2 * Math.PI * 5 * u);
        x += 5 * k2 * w; rot += -1.8 * k2 * Math.sin(2 * Math.PI * 5 * u + .6); y += 4 * Math.sin(Math.PI * Math.min(1, u * 2)) * (1 - u);
      }
    }
    const tf = "translate(" + x.toFixed(2) + "px," + y.toFixed(2) + "px) rotate(" + rot.toFixed(3) + "deg) scale(" + sx.toFixed(4) + "," + sy.toFixed(4) + ")";
    if (tf !== lastTf){ lastTf = tf; BODY.style.transform = tf; if (SWR) SWR.style.transform = tf; }
  }
  requestAnimationFrame(frame);
  function jump(){ const t = performance.now(); for (let i = 0; i < 3; i++) impulse("hop", {t0: t + i * 640, d: 620, h: 18}); }
  function set(s, ms){
    state = s; until = Date.now() + (ms || 0);
    CR.classList.remove("pump", "dip", "mile");
    if (s !== "calm"){ void CR.offsetWidth; CR.classList.add(s); }
    if (s !== "calm" && Date.now() > lockUntil) say(pick(TXT[s]), Math.min(ms || 8000, 8000));
    else if (MOOD_FORCE && mood) say(MOODS[mood], 1e9);
  }
  let tradeAt = 0;
  const popTxt = v => v >= 1e6 ? "+$" + (v / 1e6).toFixed(v >= 1e7 ? 0 : 1) + "M" : "+$" + Math.round(v / 1e3) + "K";
  function trade(p){
    const now = Date.now(); if (!p || now - tradeAt < 4000) return false; tradeAt = now;
    if (p.sell) impulse("flinch", {d: 600});
    else { impulse("hop", {d: 640, h: 16}); if (POP){ POP.textContent = popTxt(p.n); POP.classList.remove("go"); void POP.offsetWidth; POP.classList.add("go"); } }
    return true;
  }
  window.__mascot = {set: (s, ms) => set(s, ms || 20000), setMood, jump, say: callSay, trade, get state(){ return state; }, get mood(){ return mood; }};
  if (MOOD_FORCE) setMood(MOOD_FORCE); else setMood("flat");
  const orig = showBanner;
  showBanner = function(kind, text, sub){
    if (kind === "pump" || kind === "high"){ set("pump", 45000); jump(); }        // sparkles + celebratory jump
    else if (kind === "dip" || kind === "low") set("dip", 45000);                  // sweat + shake
    else if (kind === "mile" && state === "calm") set("mile", 3500);
    return orig(kind, text, sub);
  };
  const buf = [];
  function refreshMood(){
    const price = S.price, now = Date.now(); if (!(price > 0)) return;
    buf.push({t: now, p: price}); while (buf.length && now - buf[0].t > MOVE_WIN_MS) buf.shift();
    const ch = (price / buf[0].p - 1) * 100;
    if (!MOOD_FORCE){
      setMood(moodFrom(buf.length > 1 && now - buf[0].t > 60e3 ? ch : null));
      if (state === "calm" && now > lockUntil && now - moodSaidAt > 120e3){ moodSaidAt = now; say(MOODS[mood], 6000); }
    }
    if (now > until){
      if (ch >= MOVE_PCT && state !== "pump") set("pump", 30000);
      else if (ch <= -MOVE_PCT && state !== "dip") set("dip", 30000);
      else if (state !== "calm" && Math.abs(ch) < MOVE_PCT) set("calm");
      else if (state !== "calm") until = now + 10000;
    }
  }
  setTimeout(refreshMood, 1200);
  setInterval(refreshMood, 5000);
})();

/* ---------------- coin strip: majors on Binance, XRPL meme market caps ---------------- */
(function(){
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
  // rotating pages (cross-faded by opacity only): 4 coins per page on wide screens, 2 on phones
  const MAJ = ["BTC","ETH","BNB","SOL","HBAR","FET","ONDO","WLFI"], MEM = ["FUZZY","BCHAMP","PHNIX","UGA","SEAL","CULT","ARMY"];
  const cell = s => '<span class="ci' + (MEME_SET.has(s) ? " m" : "") + '" data-s="' + s + '"><b>' + s + '</b><span class="cp">--</span><span class="pc na">--</span></span>';
  let pages = [], cur = 0, perPage = 0;
  function build(){
    const per = L.narrow ? 2 : 4; if (per === perPage) return; perPage = per;
    const P = [];
    for (let i = 0; i < MAJ.length; i += per) P.push({tag: false, s: MAJ.slice(i, i + per)});
    if (SHOW_MEMES) for (let i = 0; i < MEM.length; i += per) P.push({tag: true, s: MEM.slice(i, i + per)});
    el.innerHTML = P.map((pg, i) => '<div class="cpage' + (i ? "" : " on") + '">' +
      (pg.tag ? '<span class="ctag">XRPL MCs</span>' : "") + pg.s.map(cell).join("") + "</div>").join("");
    pages = [...el.querySelectorAll(".cpage")]; cur = 0; renderCoins();
  }
  function fit(pg){
    pg.style.transform = "translate(-50%,-50%)";
    const w = pg.scrollWidth, avail = el.clientWidth - 6;
    const k = w > 0 && avail > 0 ? Math.min(1, avail / w) : 1;
    if (k < 1) pg.style.transform = "translate(-50%,-50%) scale(" + k.toFixed(3) + ")";
  }
  function show(i){
    if (document.hidden || !pages.length) return;
    pages[cur].classList.remove("on");
    cur = ((i % pages.length) + pages.length) % pages.length;
    pages[cur].classList.add("on"); fit(pages[cur]);
  }
  function renderCoins(){
    if (document.hidden) return;
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
  window.__fitCoins = () => { build(); pages.forEach(fit); };
  window.__fitCoins();
  setTimeout(() => pages.forEach(fit), 1500);
  setInterval(() => show(cur + 1), 8000);
  setInterval(() => { if (!document.hidden){ renderCoins(); if (pages[cur]) fit(pages[cur]); } }, 5000);
  pollMajors().then(renderCoins);
  setInterval(() => { if (!document.hidden) pollMajors().then(renderCoins); }, 15000);
  if (SHOW_MEMES){ setTimeout(pollMemes, 1500); setInterval(() => { if (!document.hidden) pollMemes(); }, 60000); }
  window.__coins = data;
})();

/* ---------------- MA20 / MA50 cross label (closed candles, 30 min cooldown) ---------------- */
(function(){
  const el = $("maCross"); if (!el) return;
  let sign = null, lastAt = 0, hideT = 0;
  const maClosed = n => { const c = viewSeries(currentView()), e = c.length - 1; if (e < n) return null; let s = 0; for (let i = e - n; i < e; i++) s += c[i].c; return s / n; };
  function show(gold){
    el.textContent = gold ? "GOLDEN CROSS" : "DEATH CROSS";
    el.className = gold ? "gold" : "death";
    if (window.__voice) window.__voice.callout(gold ? "golden" : "death");
    void el.offsetWidth; el.classList.add("on");
    clearTimeout(hideT); hideT = setTimeout(() => el.classList.remove("on"), 9000);
  }
  const check = () => {
    const a = maClosed(20), b = maClosed(50); if (a == null || b == null) return;
    const sg = a > b ? 1 : a < b ? -1 : 0; if (!sg) return;
    if (sign != null && sg !== sign && Date.now() - lastAt > 30 * 60e3 && !DEMO){ lastAt = Date.now(); show(sg > 0); }
    sign = sg;
  };
  setInterval(check, 15000); setTimeout(check, 5000);
  window.__maReset = () => { sign = null; };
  if (Q.get("crosstest") === "1"){ let g = true; setTimeout(() => { show(g); setInterval(() => { g = !g; show(g); }, 12000); }, 3000); }
  window.__cross = show;
})();

/* ---------------- SUBSCRIBE prompt: every 15 min (first after 2 min), 10 s ---------------- */
(function(){
  const card = $("subCard"); if (!card) return;
  if (Q.get("sub") === "0"){ card.remove(); return; }
  const test = Q.get("subtest") === "1";
  const first = test ? 2500 : 120000, every = test ? 30000 : 15 * 60e3;
  const show = () => { if (document.hidden) return; card.classList.remove("show"); void card.offsetWidth; card.classList.add("show"); setTimeout(() => card.classList.remove("show"), 10100); };
  setTimeout(() => { show(); setInterval(show, every); }, first);
  window.__sub = show;
})();

/* ---------------- test modes (only with URL options) ---------------- */
if (DEMO){
  const go = () => {
    const p = S.price || 1;
    if (DEMO === "pump") showBanner("pump", moveText(true, 1.2), "XRP PUMPING 🚀");
    else if (DEMO === "dip") showBanner("dip", moveText(false, 1.4), "XRP DIPPING 📉");
    else if (DEMO === "milestone") showBanner("mile", `XRP CROSSES $${(Math.round(p / STEP) * STEP).toFixed(2)} ⬆`);
  };
  if (DEMO === "high" || DEMO === "low"){
    const hl = () => DEMO === "high" ? showBanner("high", "NEW DAY HIGH 🎉") : showBanner("low", "NEW DAY LOW 📉");
    setTimeout(hl, 3000); setInterval(hl, 12000);
  } else if (DEMO === "ticks"){
    let up = true; setInterval(() => { playSfx(up ? "ping" : "pong"); up = !up; }, 1500);
  } else { setTimeout(go, 3000); setInterval(go, 10000); }
}
{ const at = Q.get("alerttest");
  if (at){
    let n = 0;
    const fire = () => { const up = at === "up" ? true : at === "down" ? false : (n++ % 2 === 0);
      showBanner(up ? "pump" : "dip", moveText(up, up ? 1.2 : 1.4), up ? "XRP PUMPING 🚀" : "XRP DIPPING 📉"); };
    setTimeout(() => { fire(); setInterval(fire, 10000); }, 3000);
  }
}
/* ---------------- v22: 5M · 1 HOUR / 4H · 1 WEEK / 1D · 1 MONTH rotation ---------------- */
(function chartRotation(){
  const lbl = $("chartViewLbl"), wrap = $("chartView");
  const tick = wrap && wrap.querySelector("#chartViewTick b");
  const rotating = ROTATE && !VIEW_PIN;
  if (wrap) wrap.classList.toggle("norot", !rotating);
  let rotAt = 0;
  function paintLabel(){
    const v = currentView();
    if (lbl && lbl.textContent !== v.label) lbl.textContent = v.label;
  }
  function setProgress(p){
    if (!tick) return;
    tick.style.transform = "scaleX(" + Math.max(0, Math.min(1, p)).toFixed(4) + ")";
  }
  function snapshotFade(){
    if (!cvFade || !cv.width) return;
    cxFade.setTransform(1, 0, 0, 1, 0, 0);
    cxFade.clearRect(0, 0, cvFade.width, cvFade.height);
    cxFade.drawImage(cv, 0, 0);
    const r = devicePixelRatio || 1;
    cxFade.setTransform(r, 0, 0, r, 0, 0);
  }
  function switchView(id, instant){
    if (!VIEWS[id] || (S.view === id && !instant)) return;
    if (!instant && viewReady(S.view) && cv.width){
      snapshotFade();
      cvFade.style.transition = "none";
      cvFade.style.opacity = "1";
      void cvFade.offsetWidth;
    }
    S.view = id;
    if (window.__maReset) window.__maReset();
    paintLabel();
    drawChart();
    chartDirty = false;
    if (!instant && cvFade){
      cvFade.style.transition = "opacity .4s ease";
      cvFade.style.opacity = "0";
    } else if (cvFade) cvFade.style.opacity = "0";
  }
  function pickNext(from){
    const i = Math.max(0, ROT_ORDER.indexOf(from));
    for (let k = 1; k <= ROT_ORDER.length; k++){
      const id = ROT_ORDER[(i + k) % ROT_ORDER.length];
      if (viewReady(id)) return id;
    }
    return from;
  }
  function tickRot(){
    if (!rotating){ setProgress(0); return; }
    if (!rotAt){ if (viewReady(S.view)) rotAt = Date.now(); setProgress(0); return; }
    const elapsed = Date.now() - rotAt, period = ROT_SEC * 1000;
    setProgress(elapsed / period);
    if (elapsed >= period){
      const n = pickNext(S.view);
      if (n !== S.view) switchView(n);
      rotAt = Date.now();
      setProgress(0);
    }
  }
  paintLabel();
  setInterval(tickRot, 200);
  window.__chartView = {
    get id(){ return currentView().id; },
    show(id, instant){ if (VIEWS[id] && (viewReady(id) || instant)){ switchView(id, !!instant); rotAt = Date.now(); } return currentView().id; }
  };
})();

/* ---------------- XRPL 24h transaction count ---------------- */
(function xrplTxns(){
  const HOSTS = ["wss://xrplcluster.com", "wss://s2.ripple.com", "wss://s1.ripple.com"];
  const METRICS = "https://api.xrpscan.com/api/v1/metrics/metric";
  let seed = null, seedAt = 0, added = 0, addedFrom = 0, live = false, lastLedger = 0, lastMsg = 0;
  function paint(){
    const now = Date.now();
    let v = null, mode = "warm";
    if (seed != null && seedAt){
      v = seed - seed * Math.min(1, (now - seedAt) / 86400e3) + added;
      mode = "seed";
    } else if (addedFrom && now - addedFrom >= 120e3 && added > 0){
      v = added * (86400 / ((now - addedFrom) / 1000));
      mode = "est";
    }
    S.xrplTx = v; S.xrplMode = mode;
    const el = $("tcount"); if (el && el.textContent !== fmtXrpl()) el.textContent = fmtXrpl();
  }
  async function pollMetrics(){
    try {
      const arr = await getJSON(METRICS, 20000);
      if (!arr || arr.length < 2) throw new Error("empty");
      const today = arr[arr.length - 1], yday = arr[arr.length - 2];
      const t0 = Date.parse(today.date);
      const frac = Math.min(1, Math.max(0, (Date.now() - t0) / 86400e3));
      const tc = +((today.metric || {}).transaction_count), yc = +((yday.metric || {}).transaction_count);
      if (!isFinite(tc) || !isFinite(yc)) throw new Error("bad metric");
      seed = tc + yc * (1 - frac); seedAt = Date.now(); added = 0; addedFrom = seedAt;
      paint(); return true;
    } catch(e){ return false; }
  }
  pollMetrics(); setInterval(pollMetrics, 15 * 60e3); setInterval(paint, 1000);
  let ws = null, hostI = 0, fails = 0, retryT = 0, born = 0;
  function connect(){
    clearTimeout(retryT); retryT = 0;
    if (ws){ try { ws.onclose = ws.onmessage = ws.onerror = null; ws.close(); } catch(e){} ws = null; }
    let s; try { s = new WebSocket(HOSTS[hostI % HOSTS.length]); } catch(e){ return retry(false); }
    ws = s; born = Date.now(); let got = false;
    s.onopen = () => { try { s.send(JSON.stringify({command:"subscribe", streams:["ledger"]})); } catch(e){} };
    s.onmessage = ev => {
      let m; try { m = JSON.parse(ev.data); } catch(e){ return; }
      if (!m || m.txn_count == null) return;
      const idx = m.ledger_index, c = +m.txn_count;
      if (!isFinite(c) || c < 0 || idx === lastLedger) return;
      lastLedger = idx; if (!addedFrom) addedFrom = Date.now();
      added += c; lastMsg = Date.now(); live = got = true; fails = 0;
    };
    s.onerror = () => {};
    s.onclose = () => { if (ws === s) retry(got); };
  }
  function retry(had){
    if (retryT) return; live = false;
    if (ws){ try { ws.onclose = ws.onmessage = null; ws.close(); } catch(e){} ws = null; }
    if (!had){ fails++; hostI++; }
    retryT = setTimeout(connect, had ? 2000 : Math.min(60e3, 1000 * Math.pow(2, Math.min(fails, 6))));
  }
  setInterval(() => {
    if (!ws || retryT) return;
    const ref = lastMsg > born ? lastMsg : born;
    if (Date.now() - ref > (lastMsg ? 30e3 : 12e3)) retry(!!lastMsg);
  }, 5000);
  connect();
  window.__xrpl = {get value(){ return S.xrplTx; }, get mode(){ return S.xrplMode; }, get live(){ return live; }};
})();

/* ---------------- data panels: big trades, XRP/EUR, XRP/BTC, Fear & Greed ---------------- */
(function dataPanels(){
  const root = $("dataP"); if (!root) return;
  if (Q.get("panels") === "0"){ root.remove(); return; }
  const thrQ = parseFloat(Q.get("bigtrade"));
  const BIG = isFinite(thrQ) && thrQ > 0 ? thrQ : 25000;
  const money = v => v >= 1e9 ? "$" + (v/1e9).toFixed(2) + "B" : v >= 1e6 ? "$" + (v/1e6).toFixed(2) + "M" : v >= 1e3 ? "$" + (v/1e3).toFixed(v >= 1e5 ? 0 : 1) + "K" : "$" + v.toFixed(0);
  const qty = v => v >= 1e6 ? (v/1e6).toFixed(2) + "M" : v >= 1e3 ? (v/1e3).toFixed(1) + "K" : v.toFixed(0);
  const thr = v => money(v).replace(".0K", "K").replace(".00M", "M");
  const pctTxt = v => (v >= 0 ? "+" : "") + v.toFixed(2) + "%";
  const setTxt = (el, t) => { if (el && el.textContent !== t) el.textContent = t; };
  const setCls = (el, c) => { if (el && el.className !== c) el.className = c; };
  const rowsEl = $("dpTrows"), dot = $("dpTdot");
  const title = $("dpTk"); if (title) title.textContent = "BIG TRADES ≥ " + thr(BIG) + " · 5 EXCHANGES";
  const rowCap = () => window.__panelRows || (L.narrow ? 2 : 4);
  const rows = [], queue = [];
  const feeds = {};
  let pend = null, pendT = 0, lastMsg = 0, everLive = false;
  const anyLive = () => Object.keys(feeds).some(k => feeds[k].live);
  function accept(p){
    if (!p || !(p.n >= BIG)) return;
    queue.push(p); const cap = rowCap(); if (queue.length > cap) queue.shift();
  }
  function flush(){ clearTimeout(pendT); pendT = 0; const p = pend; pend = null; accept(p); }
  function onAgg(d){
    const price = +d.p, q = +d.q, T = d.T, sell = !!d.m;
    if (!(price > 0) || !(q > 0)) return;
    if (pend && pend.T === T && pend.sell === sell){ pend.q += q; pend.n += price * q; pend.p = price; }
    else { flush(); pend = {ex:"BIN", T: T, sell, q, n: price * q, p: price}; }
    clearTimeout(pendT); pendT = setTimeout(flush, 350);
  }
  function onPub(ex, price, q, sell, ts){
    if (!(price > 0) || !(q > 0)) return;
    accept({ex, T: ts || Date.now(), sell: !!sell, q, n: price * q, p: price});
  }
  const ageTxt = t => { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 60 ? s + "s" : s < 3600 ? Math.floor(s / 60) + "m" : Math.floor(s / 3600) + "h"; };
  function addRow(p){
    if (!rowsEl) return;
    const el = document.createElement("div"); el.className = "tr flash " + (p.sell ? "s" : "b");
    el.innerHTML = '<span class="sd"></span><span class="ex"></span><span class="am"><span class="nv"></span><span class="qx"></span></span><span class="ag"></span>';
    el.children[0].textContent = p.sell ? "SELL" : "BUY";
    el.children[1].textContent = p.ex || "BIN";
    el.children[2].children[0].textContent = money(p.n);
    el.children[2].children[1].textContent = qty(p.q) + " XRP @ " + p.p.toFixed(3);
    const ag = el.children[3]; ag.textContent = ageTxt(p.T);
    const em = rowsEl.querySelector(".empty"); if (em) em.remove();
    rowsEl.prepend(el); rows.unshift({el, ag, t: p.T});
    while (rows.length > rowCap()){ const r = rows.pop(); r.el.remove(); }
    setTimeout(() => el.classList.remove("flash"), 1700);
    if (window.__mascot && window.__mascot.trade) window.__mascot.trade(p);
  }
  setInterval(() => { const p = queue.shift(); if (p) addRow(p); }, 250);
  function setEmpty(){
    if (!rowsEl || rows.length) return;
    let em = rowsEl.querySelector(".empty");
    if (!em){ rowsEl.textContent = ""; em = document.createElement("div"); em.className = "empty"; rowsEl.appendChild(em); }
    setTxt(em, anyLive() ? "waiting for " + thr(BIG) + "+ trades…" : "—");
  }
  function tradeFeed(name, urls, hello, onRaw, ping){
    const st = feeds[name] = {live:false, ever:false, last:0, url:null};
    let i = 0, fails = 0, ws = null, retryT = 0, born = 0, pingT = 0;
    function stopPing(){ clearInterval(pingT); pingT = 0; }
    function connect(){
      clearTimeout(retryT); retryT = 0; stopPing();
      if (ws){ try { ws.onclose = ws.onmessage = ws.onerror = null; ws.close(); } catch(e){} ws = null; }
      const url = urls[i % urls.length];
      let s; try { s = new WebSocket(url); } catch(e){ return retry(false); }
      ws = s; st.url = url; born = Date.now(); let got = false;
      s.binaryType = "arraybuffer";
      s.onopen = () => {
        try { if (hello){ const h = hello(); s.send(typeof h === "string" ? h : JSON.stringify(h)); } } catch(e){}
        if (ping) pingT = setInterval(() => { try { if (s.readyState === 1) s.send(typeof ping === "string" ? ping : JSON.stringify(ping)); } catch(e){} }, 20000);
      };
      s.onmessage = ev => { Promise.resolve(onRaw(ev, s)).then(ok => { if (ok){ got = true; fails = 0; st.last = lastMsg = Date.now(); st.live = st.ever = true; } }).catch(() => {}); };
      s.onerror = () => {};
      s.onclose = () => { if (ws === s) retry(got); };
    }
    function retry(had){
      if (retryT) return; st.live = false; stopPing();
      if (ws){ try { ws.onclose = ws.onmessage = null; ws.close(); } catch(e){} ws = null; }
      if (!had){ fails++; i++; }
      retryT = setTimeout(connect, had ? 2000 : Math.min(60e3, 1000 * Math.pow(2, Math.min(fails, 6))));
    }
    setInterval(() => {
      if (!ws || retryT) return;
      const ref = st.last > born ? st.last : born;
      if (Date.now() - ref > (st.last ? 30e3 : 12e3)) retry(!!st.last);
    }, 5000);
    connect();
  }
  function evText(ev){
    const d = ev.data;
    if (typeof d === "string") return Promise.resolve(d);
    if (d instanceof ArrayBuffer) return Promise.resolve(new TextDecoder().decode(d));
    if (d && typeof Blob !== "undefined" && d instanceof Blob) return d.text();
    return Promise.resolve(String(d || ""));
  }
  function evJSON(ev){ return evText(ev).then(s => { try { return JSON.parse(s); } catch(e){ return null; } }); }
  const B = {c: null, P: null, at: 0};
  const onBtc = d => { const c = +d.c, P = +d.P; if (c > 0){ B.c = c; B.P = isFinite(P) ? P : null; B.at = Date.now(); } };
  async function btcRest(){
    try { const {data} = await restAny("/api/v3/ticker/24hr?symbol=XRPBTC"); onBtc({c: data.lastPrice, P: data.priceChangePercent}); } catch(e){}
  }
  btcRest(); setInterval(() => { if (Date.now() - B.at > 25e3) btcRest(); }, 30e3);
  tradeFeed("BIN", WS_HOSTS.map(h => h + "/stream?streams=xrpusdt@aggTrade/xrpbtc@ticker"), null, ev => evJSON(ev).then(m => {
    if (!m || !m.data) return false;
    if (m.stream === "xrpusdt@aggTrade") onAgg(m.data); else if (m.stream === "xrpbtc@ticker") onBtc(m.data);
    return true;
  }));
  tradeFeed("CB", ["wss://ws-feed.exchange.coinbase.com"],
    () => ({type:"subscribe", product_ids:["XRP-USD"], channels:["matches"]}), ev => evJSON(ev).then(m => {
      if (!m) return false;
      if (m.type === "match" || m.type === "last_match"){
        onPub("CB", +m.price, +m.size, String(m.side).toLowerCase() === "buy", m.time ? Date.parse(m.time) : Date.now());
        return true;
      }
      return m.type === "subscriptions" || m.type === "heartbeat";
    }));
  tradeFeed("KRK", ["wss://ws.kraken.com/v2"],
    () => ({method:"subscribe", params:{channel:"trade", symbol:["XRP/USD"]}}), ev => evJSON(ev).then(m => {
      if (!m) return false;
      if (m.channel === "trade" && Array.isArray(m.data)){
        for (const d of m.data){
          const price = +d.price, q = +(d.qty != null ? d.qty : d.q);
          onPub("KRK", price, q, String(d.side).toLowerCase() === "sell", d.timestamp ? Date.parse(d.timestamp) : Date.now());
        }
        return true;
      }
      return m.method === "subscribe" || m.channel === "heartbeat";
    }), {method:"ping"});
  tradeFeed("BYB", ["wss://stream.bybit.com/v5/public/spot"],
    () => ({op:"subscribe", args:["publicTrade.XRPUSDT"]}), ev => evJSON(ev).then(m => {
      if (!m) return false;
      if (m.topic && String(m.topic).indexOf("publicTrade") === 0 && Array.isArray(m.data)){
        for (const d of m.data) onPub("BYB", +d.p, +d.v, String(d.S).toLowerCase() === "sell", d.T || Date.now());
        return true;
      }
      return m.op === "subscribe" || m.op === "pong" || m.success === true;
    }), {op:"ping"});
  let upbitKrw = 0;
  tradeFeed("UPB", ["wss://api.upbit.com/websocket/v1"],
    () => JSON.stringify([{ticket:"tenbob-xrp"},{type:"trade", codes:["KRW-XRP"]}]), ev => evJSON(ev).then(m => {
      if (!m) return false;
      if (m.type === "trade" || m.code === "KRW-XRP"){
        const krw = +m.trade_price, q = +m.trade_volume;
        if (krw > 0) upbitKrw = krw;
        const usdPx = S.price > 0 ? S.price : 0;
        const fx = (upbitKrw > 0 && usdPx > 0) ? (upbitKrw / usdPx) : 0;
        onPub("UPB", fx > 0 ? krw / fx : 0, q, String(m.ask_bid).toUpperCase() === "ASK", m.trade_timestamp || m.timestamp || Date.now());
        return true;
      }
      return false;
    }));
  const F = {v: null, k: "", at: 0};
  async function fng(){
    let ok = false;
    try {
      const j = await getJSON("https://api.alternative.me/fng/?limit=1", 10000), d = j && j.data && j.data[0];
      const v = d ? parseInt(d.value, 10) : NaN;
      if (isFinite(v)){ F.v = Math.max(0, Math.min(100, v)); F.k = String(d.value_classification || ""); F.at = Date.now(); ok = true; }
    } catch(e){}
    setTimeout(fng, ok ? 3600e3 : 300e3);
  }
  fng();
  const mV = $("dpMv"), mC = $("dpMc"), bV = $("dpBv"), bC = $("dpBc"), fV = $("dpFv"), fM = $("dpFm"), fP = $("dpF");
  const fColor = v => v < 25 ? "dn" : v < 45 ? "fo" : v <= 55 ? "fn" : v < 75 ? "fg" : "up";
  const FCOL = {dn: "#ff4d5e", fo: "#ff8a3d", fn: "#ffcf4d", fg: "#9be15d", up: "#22f08a"};
  function render(){
    const now = Date.now();
    everLive = everLive || anyLive();
    if (anyLive() && now - lastMsg > 15e3) Object.keys(feeds).forEach(k => { if (now - feeds[k].last > 15e3) feeds[k].live = false; });
    setCls(dot, "dot " + (anyLive() ? "ok" : everLive && now - lastMsg < 120e3 ? "warn" : "bad"));
    for (const r of rows) setTxt(r.ag, ageTxt(r.t));
    setEmpty();
    const fresh = !!(S.lastTickAt && now - S.lastTickAt < 5 * 60e3) || S.price != null;
    const eurPx = (SHOW_EUR && fresh && S.price > 0 && S.eurRate) ? S.price * S.eurRate : null;
    setTxt(mV, eurPx != null ? "€" + fmt(eurPx) : "—");
    const pc = S.pct;
    if (fresh && pc != null && isFinite(pc)){ setTxt(mC, pctTxt(pc)); setCls(mC, "dch " + (pc >= 0 ? "up" : "dn")); }
    else { setTxt(mC, "—"); setCls(mC, "dch na"); }
    const bOk = B.c != null && now - B.at < 5 * 60e3;
    setTxt(bV, bOk ? B.c.toFixed(8) : "—");
    if (bOk && B.P != null){ setTxt(bC, pctTxt(B.P)); setCls(bC, "dch " + (B.P >= 0 ? "up" : "dn")); }
    else { setTxt(bC, "—"); setCls(bC, "dch na"); }
    const fOk = F.v != null && now - F.at < 26 * 3600e3;
    if (fV && fOk){
      const c = fColor(F.v);
      if (fV._v !== F.v + F.k){ fV._v = F.v + F.k; fV.textContent = ""; fV.append(document.createTextNode(String(F.v)));
        const sm = document.createElement("small"); sm.style.color = FCOL[c]; sm.textContent = F.k; fV.append(sm); fV.style.color = FCOL[c]; }
      if (fM){ const l = F.v + "%"; if (fM.style.left !== l) fM.style.left = l; }
      if (fP && fP.classList.contains("nodata")) fP.classList.remove("nodata");
    } else if (fV){
      if (fV._v !== "-"){ fV._v = "-"; fV.textContent = "—"; fV.style.color = ""; }
      if (fP && !fP.classList.contains("nodata")) fP.classList.add("nodata");
    }
  }
  render(); setInterval(render, 1000);
  window.__panels = {get rows(){ return rows.length; }, get live(){ return anyLive(); }, BIG};
})();

window.__xrp = S;
window.__alert = (kind, text, sub) => showBanner(kind, text, sub);   // for testing in the browser console
})();

/* TENBOB · XRP LIVE 24/7 - live XRP/USD price page (v16 card look, matches the stream overlay v16).
   No libraries, no API keys. Sounds are synthesized live with the Web Audio API; spoken callouts load only after sound is on.
   Data: Binance public websocket (port 443, then 9443, then the data-stream.binance.vision mirror),
         Binance REST polling (data-api.binance.vision / api.binance.com), then CoinGecko as last resort.
   Test options (URL):  ?demo=pump | dip | milestone | high | low | ticks    ?alerttest=1 | up | down    ?crosstest=1
                        ?subtest=1    ?mood=up | big | down | flat    ?eur=0 */
(() => {
"use strict";
const $ = id => document.getElementById(id);
const Q = new URLSearchParams(location.search);
const SHOW_EUR = Q.get("eur") !== "0";
const DEMO = Q.get("demo");
const WINDOW_MIN = 240;                        // 4h of 1-minute candles
const MA_EXTRA = 60;                           // extra minutes so the average covers the visible chart
const MOVE_PCT = 1.0, MOVE_WIN_MS = 15 * 60e3; // pump/dip trigger: 1% within 15 min
const MOVE_COOLDOWN_MS = 10 * 60e3;
const moveText = (up, pct) => "XRP " + (up ? "UP" : "DOWN") + " " + Math.abs(pct).toFixed(1) + "% IN 15 MIN";
const STEP = 0.05;                             // level step in USD
const WS_HOSTS = ["wss://stream.binance.com:443", "wss://stream.binance.com:9443", "wss://data-stream.binance.vision"];
const REST_HOSTS = ["https://data-api.binance.vision", "https://api.binance.com"];
const CG = "https://api.coingecko.com/api/v3";
const TICK_GAP_MS = 1500;                      // ping/pong at most once per 1.5 s (net direction)
const HL_COOLDOWN_MS = 5 * 60e3;               // NEW DAY HIGH / LOW cooldown
if (!SHOW_EUR) $("eurStat").style.display = "none";

/* ---------------- state ---------------- */
const S = {
  price: null, prevPrice: null, pct: null, hi: null, lo: null, vol: null, qvol: null, eurRate: null,
  candles: [], samples: [], lastTickAt: 0, source: "", mode: "init",
  lastMoveBanner: {pump: 0, dip: 0}, milestoneLevel: null, milestoneAt: {}, bootAt: Date.now(),
  hl: {hi: null, lo: null, at: {high: 0, low: 0}}
};
const fmt = (v, d = 4) => { const n = Number(v); return Number.isFinite(n) ? n.toFixed(d) : "--"; };
const fmtBig = v => v == null || isNaN(v) ? "--" : v >= 1e9 ? (v/1e9).toFixed(2)+"B" : v >= 1e6 ? (v/1e6).toFixed(1)+"M" : v >= 1e3 ? (v/1e3).toFixed(1)+"K" : v.toFixed(0);

/* ---------------- characters (art has a baked soft dark edge; red tint baked as a second image) ---------------- */
const CHAR = {leopard: {w: 150, h: 194, p: 12}, uga: {w: 199, h: 194, p: 12}, cyborg: {w: 176, h: 194, p: 12}, frog: {w: 219, h: 255, p: 12}};
// face effect spots (fractions of each character box): sweat on the brow, sparkles around the head
const FXPOS = {leopard: {sw: [.05, .07], sp: [[.62, .30], [.02, .48], [.36, .22]]},
               uga:     {sw: [.05, .25], sp: [[.70, .36], [.02, .55], [.42, .24]]},
               cyborg:  {sw: [.11, .16], sp: [[.70, .30], [.02, .50], [.40, .22]]},
               frog:    {sw: [.06, .14], sp: [[.80, .30], [.02, .40], [.40, .08]]}};
document.querySelectorAll("#crew .cw").forEach(cw => {
  const n = cw.dataset.c, c = CHAR[n], f = FXPOS[n];
  const place = img => Object.assign(img.style, {left: (-c.p / c.w * 100) + "%", top: (-c.p / c.h * 100) + "%",
    width: ((c.w + 2 * c.p) / c.w * 100) + "%", height: ((c.h + 2 * c.p) / c.h * 100) + "%"});
  const art = new Image(); art.className = "art"; art.alt = ""; art.decoding = "async"; art.src = "char-" + n + ".webp"; place(art);
  const tint = new Image(); tint.className = "tint"; tint.alt = ""; tint.decoding = "async"; tint.src = "char-" + n + "-tint.webp"; place(tint);
  cw.append(art, tint);
  const sw = document.createElement("span"); sw.className = "fx sw"; sw.style.left = f.sw[0] * 100 + "%"; sw.style.top = f.sw[1] * 100 + "%"; cw.appendChild(sw);
  f.sp.forEach((p, i) => { const e = document.createElement("span"); e.className = "fx sp sp" + (i + 1); e.style.left = p[0] * 100 + "%"; e.style.top = p[1] * 100 + "%"; cw.appendChild(e); });
});

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
/* price ink = 50% of the card's inner width on wide screens (as on the stream); the 4 characters fill the space to its right,
   frog a bit taller than the digits, crew as tall as fits with equal gaps. On phones the price spans the card and the crew sit below it. */
function fitHead(){
  const card = $("card"), el = $("price"), crew = $("crew");
  const cs = getComputedStyle(card), inner = card.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  if (inner < 50) return;
  const txt = el.textContent.length > 3 && el.textContent.indexOf("-") < 0 ? el.textContent : "$0.0000";
  const ink100 = measure(txt, 100);
  const AR = n => CHAR[n].w / CHAR[n].h, crewAR = AR("leopard") + AR("uga") + AR("cyborg");
  let fs, frogH, crewH, gap;
  if (!L.narrow){
    const inkW = Math.min(inner * 0.5, 924 * L.k);
    fs = Math.min(100 * inkW / ink100.w, card.clientHeight * 0.27);   // keep room for the boxes and the chart on short screens
    const inkH = ink100.asc * fs / 100;
    frogH = Math.round(inkH * 1.2);
    gap = Math.round(14 * L.k + 2);
    const frogW = frogH * AR("frog"), avail = inner - ink100.w * fs / 100 - 24;
    crewH = Math.min(frogH, Math.floor((avail - frogW - 4 * gap) / crewAR));
    if (crewH < frogH * 0.6){                            // narrow desktop window: shrink the price to make room
      crewH = Math.round(frogH * 0.75);
      const need = crewH * crewAR + frogW + 4 * gap + 24;
      fs = Math.max(40, Math.min(fs, 100 * (inner - need) / ink100.w));
    }
  } else {
    fs = Math.min(100 * inner * 0.9 / ink100.w, 120);
    gap = 8;
    crewH = Math.max(50, Math.min(120, Math.floor((inner - 4 * gap) / (crewAR + AR("frog")))));
    frogH = crewH;
  }
  el.style.fontSize = fs.toFixed(1) + "px";
  crew.style.setProperty("--ch", crewH + "px");
  crew.style.setProperty("--fh", frogH + "px");
  crew.style.setProperty("--cg", gap + "px");
  crew.style.setProperty("--bf", Math.round(L.narrow ? Math.max(13, crewH * 0.16) : Math.max(14, 39 * L.k)) + "px");
  crew.style.setProperty("--bgap", Math.round(L.narrow ? 12 : Math.max(10, frogH * 0.12)) + "px");
  document.querySelectorAll("#crew .cw").forEach(cw => { const n = cw.dataset.c, h = n === "frog" ? frogH : crewH; cw.style.width = Math.round(h * AR(n)) + "px"; });
}
function sizeCanvas(c, w, h){ const r = devicePixelRatio || 1; c.width = Math.max(1, Math.round(w * r)); c.height = Math.max(1, Math.round(h * r)); }
function sizeChart(){
  const w = $("chartWrap"); L.chart = {w: Math.max(10, w.clientWidth), h: Math.max(10, w.clientHeight)};
  sizeCanvas($("chart"), L.chart.w, L.chart.h); chartDirty = true;
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
  if (SHOW_EUR && S.eurRate) putText("eur", "€" + fmt(p * S.eurRate));
  putText("hlHighV", S.hi != null ? "$" + fmt(S.hi) : "--");
  putText("hlLowV", S.lo != null ? "$" + fmt(S.lo) : "--");
  putText("vol", fmtBig(S.vol));
  putText("qvol", S.qvol != null ? "$" + fmtBig(S.qvol) : "--");
  const title = txt + " XRP Live Price 24/7 | Tenbob";
  if (document.title !== title) document.title = title;
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
  if (S.samples.length && ts - S.samples[0].t > MOVE_WIN_MS){
    const cut = ts - MOVE_WIN_MS; let drop = 0;
    while (drop < S.samples.length && S.samples[drop].t <= cut) drop++;
    if (drop) S.samples.splice(0, drop);
  }
  if (S.samples.length > 1200) S.samples.splice(0, S.samples.length - 900);
  renderPrice(); checkMove(); checkMilestone(p); checkHighLow(p); tickSound(p); chartDirty = true;
}
function trimCandles(){ const max = WINDOW_MIN + MA_EXTRA; if (S.candles.length > max) S.candles.splice(0, S.candles.length - max); }
function setCandles(arr){
  const live = S.candles.filter(c => c.t > (arr.length ? arr[arr.length-1].t : 0));
  S.candles = arr.concat(live); trimCandles();
  if (!S.samples.length){
    const now = Date.now();
    S.candles.filter(c => now - c.t <= MOVE_WIN_MS).forEach(c => S.samples.push({t: c.t + 59e3, p: c.c}));
  }
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

/* ---------------- chart: plain line (2-minute steps, last 4 h) + one faint dashed average (MA20) ---------------- */
const cv = $("chart"), cx = cv.getContext("2d"); let chartDirty = true;
function drawChart(){
  const r = devicePixelRatio || 1, W = L.chart.w, H = L.chart.h;
  cx.setTransform(r, 0, 0, r, 0, 0); cx.clearRect(0, 0, W, H);
  if (S.candles.length < 2 || S.price == null){
    cx.fillStyle = "#93a7a3"; cx.font = "700 " + Math.round(Math.max(14, 30 * L.k)) + "px " + MONO;
    cx.fillText("Connecting to live feed...", 10, H / 2); return;
  }
  const full = S.candles, n = full.length, STEPM = 2, hist = [];
  for (let k = n - 1; k >= 0; k -= STEPM) hist.unshift(k === n - 1 ? S.price : full[k].c);
  const ser = hist.slice(-120), off = hist.length - ser.length;
  const ma = ser.map((_, i) => { const j = off + i; let a = 0, q = 0; for (let k = Math.max(0, j - 19); k <= j; k++){ a += hist[k]; q++; } return a / q; });
  let mn = Infinity, mx = -Infinity; for (const v of ser){ if (v < mn) mn = v; if (v > mx) mx = v; }
  const rg = (mx - mn) || 1e-6;
  const LW = Math.max(2.5, 4 * L.k), PT = H * 6 / 90, PH = H * 78 / 90;
  const Xi = i => LW / 2 + i / (ser.length - 1) * (W - LW), Yv = v => PT + PH - (v - mn) / rg * PH;
  const upT = S.pct != null && isFinite(S.pct) ? S.pct >= 0 : ser[ser.length - 1] >= ser[0];
  cx.lineJoin = "round"; cx.lineCap = "round"; cx.setLineDash([]);
  cx.beginPath(); ser.forEach((v, i) => i ? cx.lineTo(Xi(i), Yv(v)) : cx.moveTo(Xi(i), Yv(v)));
  cx.strokeStyle = upT ? "#22f08a" : "#ff4d5e"; cx.lineWidth = LW; cx.stroke();
  const dk = Math.max(.55, L.k);
  cx.beginPath(); ma.forEach((v, i) => i ? cx.lineTo(Xi(i), Yv(v)) : cx.moveTo(Xi(i), Yv(v)));
  cx.strokeStyle = "rgba(255,207,77,.6)"; cx.lineWidth = Math.max(1.5, 2.5 * L.k); cx.lineCap = "butt"; cx.setLineDash([13 * dk, 9 * dk]); cx.stroke(); cx.setLineDash([]);
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
  const s = document.createElement("script"); s.src = "voice.js?v=16"; s.async = true; s.onerror = () => { voiceLoading = false; }; document.head.appendChild(s);
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
      if (S.candles.length < 2) seedCoinGecko().catch(() => {});
    }
  };
  tick(); restTimer = setInterval(tick, 5000);
}
function stopPolling(){ clearInterval(restTimer); clearInterval(cgTimer); restTimer = cgTimer = null; }
setInterval(() => { if (!document.hidden && S.mode === "ws" && Date.now() - S.lastTickAt > 45000) scheduleReconnect(true); }, 10000);
setInterval(() => { if (!document.hidden && (S.mode !== "poll" || restTimer)) seedBinance().catch(() => {}); }, 30 * 60e3);
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

/* ---------------- the crew (frog + 3 characters): one mood and one reaction for all four ---------------- */
(function(){
  const CR = $("crew"), BUB = $("bub");
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
  function jump(){ CR.classList.remove("jump"); void CR.offsetWidth; CR.classList.add("jump"); clearTimeout(jump.t); jump.t = setTimeout(() => CR.classList.remove("jump"), 2200); }
  function set(s, ms){
    state = s; until = Date.now() + (ms || 0);
    CR.classList.remove("pump", "dip", "mile");
    if (s !== "calm"){ void CR.offsetWidth; CR.classList.add(s); }
    if (s !== "calm" && Date.now() > lockUntil) say(pick(TXT[s]), Math.min(ms || 8000, 8000));
    else if (MOOD_FORCE && mood) say(MOODS[mood], 1e9);
  }
  window.__mascot = {set: (s, ms) => set(s, ms || 20000), setMood, jump, say: callSay, get state(){ return state; }, get mood(){ return mood; }};
  if (MOOD_FORCE) setMood(MOOD_FORCE); else setMood("flat");
  const orig = showBanner;
  showBanner = function(kind, text, sub){
    if (kind === "pump" || kind === "high"){ set("pump", 45000); jump(); }        // sparkles + celebratory jump
    else if (kind === "dip" || kind === "low") set("dip", 45000);                  // sweat + shake
    else if (kind === "mile" && state === "calm") set("mile", 3500);
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
      if (ch >= MOVE_PCT && state !== "pump") set("pump", 30000);
      else if (ch <= -MOVE_PCT && state !== "dip") set("dip", 30000);
      else if (state !== "calm" && Math.abs(ch) < MOVE_PCT) set("calm");
      else if (state !== "calm") until = now + 10000;
    }
  }, 5000);
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
  const maClosed = n => { const c = S.candles, e = c.length - 1; if (e < n) return null; let s = 0; for (let i = e - n; i < e; i++) s += c[i].c; return s / n; };
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
window.__xrp = S;
window.__alert = (kind, text, sub) => showBanner(kind, text, sub);   // for testing in the browser console
})();

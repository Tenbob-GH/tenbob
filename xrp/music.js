/* Background music: OFF by default (browsers block autoplay), one tap on "Music" starts it.
   Upbeat CC0 tracks in ./music/ (credits in music/LICENCES.txt). Shuffled playlist, loops forever,
   2 s fade between tracks, dips under the spoken alerts, follows the Vol slider (capped low). */
(() => {
"use strict";
const DIR = "music/";
const TRACKS = [
  ["upbeat-1-funky-disco-beats.mp3", "Funky Disco Beats", "Fupi"],
  ["upbeat-2-joyfully.mp3", "Joyfully", "MintoDog"],
  ["upbeat-3-cool-city.mp3", "Cool City", "MintoDog"],
  ["upbeat-4-funked-up.mp3", "Funked Up", "Joth"],
  ["upbeat-5-urban-theme.mp3", "Urban Theme", "MintoDog"],
  ["upbeat-6-space-city.mp3", "Space City", "MintoDog"]
];
const btn = document.getElementById("musicBtn"), label = document.getElementById("trackName");
const XF = 2, DUCK_TO = 0.35;
const base = () => Math.min(0.5, 0.5 * (window.__xrpVolume ? window.__xrpVolume() : 0.5));   // 0.25 at the default Vol
let on = false, order = [], pos = 0, last = -1, cur = null, live = [], timer = 0, duck = 1, duckFrom = 0, duckUntil = 0;
function shuffle(){ const a = TRACKS.map((_, i) => i); for (let i = a.length - 1; i > 0; i--){ const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  if (a[0] === last && a.length > 1) [a[0], a[1]] = [a[1], a[0]]; return a; }
function next(){ if (pos >= order.length){ order = shuffle(); pos = 0; } return last = order[pos++]; }
function render(){
  btn.classList.toggle("on", on); btn.setAttribute("aria-pressed", String(on));
  btn.textContent = on ? "Music: ON" : "Music: OFF";
  if (!on) label.textContent = "";
}
function start(){
  const i = next(), t = TRACKS[i], a = new Audio(DIR + t[0]);
  a.preload = "auto"; a._f = 0; a._dir = 1; a.volume = 0;
  a.onerror = () => { a._dead = true; };
  live.push(a); cur = a;
  label.textContent = "Now playing: " + t[1] + " · " + t[2] + " (CC0)";
  return a.play().catch(() => { a._dead = true; throw new Error("blocked"); });
}
function tick(){
  const now = performance.now() / 1000;
  const target = now >= duckFrom && now < duckUntil ? DUCK_TO : 1;
  duck += (target - duck) * (target < duck ? 0.35 : 0.08);
  if (cur && cur._dead){ cur._dir = -1; start().catch(() => {}); }
  else if (cur && cur._dir > 0 && (cur.ended || (cur.duration > 0 && cur.duration - cur.currentTime <= XF))){ cur._dir = -1; start().catch(() => {}); }
  let sum = 0; for (const a of live){ a._f = Math.min(1, Math.max(0, a._f + a._dir * 0.1 / XF)); if (!a._dead) sum += a._f; }
  const norm = sum > 1 ? 1 / sum : 1, b = base();
  for (let i = live.length - 1; i >= 0; i--){
    const a = live[i];
    try { a.volume = Math.min(1, Math.max(0, b * duck * a._f * norm)); } catch(e){}
    if ((a._dir < 0 && a._f <= 0) || a._dead){ a.pause(); a.removeAttribute("src"); try { a.load(); } catch(e){} live.splice(i, 1); }
  }
}
function play(){
  on = true; render(); order = shuffle(); pos = 0;
  start().then(() => { clearInterval(timer); timer = setInterval(tick, 100); },
               () => { stop(); btn.textContent = "Tap for music"; });
}
function stop(){
  on = false; clearInterval(timer); timer = 0;
  live.forEach(a => { a.pause(); a.removeAttribute("src"); try { a.load(); } catch(e){} }); live = []; cur = null; render();
}
btn.addEventListener("click", () => {
  if (on) stop(); else play();
  if (typeof gtag === "function") try { gtag("event", "music_toggle", {music_on: on}); } catch(e){}
});
window.__music = {
  duck(delay, dur){ const now = performance.now() / 1000; duckFrom = now + Math.max(0, delay - 0.15); duckUntil = Math.max(duckUntil, now + delay + dur + 0.3); },
  setVol(){ /* picked up on the next tick */ },
  get on(){ return on; }, get live(){ return live; }, get current(){ return cur && cur.src; }
};
render();
})();
